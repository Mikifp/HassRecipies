"""Import recipes from web pages via schema.org JSON-LD."""

from __future__ import annotations

import asyncio
import html
from html.parser import HTMLParser
import json
import re
from typing import Any
from urllib.parse import urlparse

from aiohttp import ClientError, ClientSession, ClientTimeout

try:
    from .ingredients import link_ingredients
except ImportError:  # loaded on its own (tests): importing a page then leaves the steps unlinked
    link_ingredients = None

try:
    from .textimport import parse_text
except ImportError:  # loaded on its own (tests)
    import importlib.util as _ilu
    from pathlib import Path as _Path

    _spec = _ilu.spec_from_file_location("hass_recipes_textimport", _Path(__file__).with_name("textimport.py"))
    _mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    parse_text = _mod.parse_text

_LD_JSON = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)
_DURATION = re.compile(
    r"^P(?:(?P<d>\d+)D)?(?:T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?)?$"
)
_BREAKS = re.compile(r"<(?:br|/p|/li|/div)[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
_MAX_BYTES = 5 * 1024 * 1024


class RecipeImportError(Exception):
    """Raised when a recipe cannot be imported."""


def _text(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(_TAGS.sub("", _BREAKS.sub(" ", str(value))))
    return re.sub(r"\s+", " ", text).strip()


def _minutes(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = _DURATION.match(value.strip().upper())
    if not match:
        # Non-ISO text such as "1 hr 30 min" or "10 min + chill time".
        hours = re.search(r"(\d+(?:\.\d+)?)\s*h", value, re.IGNORECASE)
        mins = re.search(r"(\d+)\s*m", value, re.IGNORECASE)
        total = round(float(hours.group(1)) * 60) if hours else 0
        total += int(mins.group(1)) if mins else 0
        return total or None
    parts = {k: int(v) for k, v in match.groupdict(default="0").items()}
    total = parts["d"] * 1440 + parts["h"] * 60 + parts["m"] + (1 if parts["s"] >= 30 else 0)
    return total or None


def _is_recipe(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    kind = node.get("@type")
    kinds = kind if isinstance(kind, list) else [kind]
    return "Recipe" in kinds


def _find_recipe(node: Any) -> dict[str, Any] | None:
    if _is_recipe(node):
        return node
    if isinstance(node, list):
        for item in node:
            if (found := _find_recipe(item)) is not None:
                return found
    elif isinstance(node, dict):
        for key in ("@graph", "mainEntity", "mainEntityOfPage"):
            if key in node and (found := _find_recipe(node[key])) is not None:
                return found
    return None


def _image(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return _image(value[0]) if value else ""
    if isinstance(value, dict):
        return _image(value.get("url") or value.get("contentUrl") or "")
    return ""


def _steps(value: Any) -> list[Any]:
    """Flatten instructions; HowToSection names become {"text", "section": True}."""
    if value is None:
        return []
    if isinstance(value, str):
        lines = re.split(r"\r?\n+", value)
        return [t for line in lines if (t := _text(line))]
    if isinstance(value, list):
        return [step for item in value for step in _steps(item)]
    if isinstance(value, dict):
        if "itemListElement" in value:
            inner = _steps(value["itemListElement"])
            title = _text(value.get("name"))
            if title and inner and "HowToSection" in str(value.get("@type")):
                return [{"text": title, "section": True}, *inner]
            return inner
        return _steps(value.get("text") or value.get("name"))
    return []


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [t for part in value.split(",") if (t := _text(part))]
    if isinstance(value, list):
        return [t for part in value for t in _list(part)]
    return []


_VOID = {"br", "img", "hr", "input", "meta", "link", "source", "wbr"}


class _ListExtractor(HTMLParser):
    """Collect <li> texts inside containers that look like ingredient/step lists.

    Some sites (e.g. Webflow ones) put the list in the page body and only add it
    to the JSON-LD with client-side JavaScript, so the raw JSON-LD lacks it.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ingredients: list[str] = []
        self.instructions: list[str] = []
        self._stack: list[tuple[str, str | None]] = []  # (tag, kind) kind: ing|ins
        self._li: list[str] | None = None
        self._li_kind: str | None = None
        self._p: list[str] | None = None  # <p> text inside a list container
        self._p_bold = False

    @staticmethod
    def _kind(attrs: dict[str, str | None]) -> str | None:
        classes = (attrs.get("class") or "").lower().split()
        itemprop = (attrs.get("itemprop") or "").lower()
        if itemprop == "recipeingredient" or any(
            c in ("ingredients-list", "ingredient-list", "recipe-ingredients") for c in classes
        ):
            return "ing"
        if itemprop == "recipeinstructions" or any(
            c in ("directions-list", "instructions-list", "recipe-instructions", "recipe-steps")
            for c in classes
        ):
            return "ins"
        return None

    def _current(self) -> str | None:
        for _, kind in reversed(self._stack):
            if kind:
                return kind
        return None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            return
        kind = self._kind(dict(attrs))
        if tag == "p" and self._current() and self._li is None and self._p is None:
            self._p, self._p_bold = [], False
        elif tag in ("strong", "b") and self._p is not None:
            self._p_bold = True
        self._stack.append((tag, kind))
        if tag == "li" and self._current() and self._li is None:
            self._li, self._li_kind = [], self._current()
        elif (
            kind == "ing"
            and tag != "li"
            and self._li is None
            and (dict(attrs).get("itemprop") or "").lower() == "recipeingredient"
        ):
            # itemprop on a non-list element: treat its whole text as one ingredient
            self._li, self._li_kind = [], "ing-single"
            self._single_depth = len(self._stack)

    def handle_endtag(self, tag: str) -> None:
        if tag in _VOID or not self._stack:
            return
        if tag == "p" and self._p is not None:
            # A bold or colon-terminated paragraph between lists is a section title.
            title = re.sub(r"\s+", " ", "".join(self._p)).strip().strip("\u200d")
            kind = self._current()
            if title and (self._p_bold or title.endswith(":")):
                title = title.rstrip(":").strip()
                if kind == "ins":
                    self.instructions.append({"text": title, "section": True})
                elif kind == "ing":
                    self.ingredients.append(f"## {title}")
            self._p = None
        while self._stack:
            popped, _ = self._stack.pop()
            if popped == tag:
                break
        if self._li is not None and (
            tag == "li" or (self._li_kind == "ing-single" and len(self._stack) < self._single_depth)
        ):
            text = re.sub(r"\s+", " ", "".join(self._li)).strip().strip("\u200d")
            if text:
                (self.instructions if self._li_kind == "ins" else self.ingredients).append(text)
            self._li = self._li_kind = None

    def handle_data(self, data: str) -> None:
        if self._li is not None:
            self._li.append(data)
        elif self._p is not None:
            self._p.append(data)


def _html_lists(page: str) -> tuple[list[str], list[str]]:
    parser = _ListExtractor()
    try:
        parser.feed(page)
    except Exception:  # noqa: BLE001 - malformed HTML must never break an import
        pass
    return parser.ingredients, parser.instructions


class _GroupExtractor(HTMLParser):
    """Ingredient groups ("For the dough", "Frosting") as recipe plugins print them in the page.

    schema.org lists the ingredients flat, so the group names only exist in the HTML. Understands
    WP Recipe Maker (``wprm-recipe-ingredient-group``) and the Tasty Recipes / Mediavine Create
    cards, where a heading inside the ingredients box starts a group.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.groups: list[dict[str, Any]] = []
        self._stack: list[tuple[str, str | None]] = []
        self._buf: list[str] = []
        self._box = 0  # depth inside a Tasty / Create ingredients box
        self._wprm = 0  # depth inside a WP Recipe Maker ingredient group

    def _group(self) -> dict[str, Any]:
        if not self.groups:
            self.groups.append({"name": "", "items": []})
        return self.groups[-1]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            return
        classes = (dict(attrs).get("class") or "").lower().split()
        kind: str | None = None
        if "wprm-recipe-ingredient-group" in classes:
            self.groups.append({"name": "", "items": []})
            self._wprm += 1
            kind = "wprm"
        elif self._wprm and ("wprm-recipe-group-name" in classes or "wprm-recipe-ingredient-group-name" in classes):
            kind = "name"
        elif self._wprm and tag == "li" and "wprm-recipe-ingredient" in classes:
            kind = "item"
        elif any(c in ("tasty-recipes-ingredients", "mv-create-ingredients") for c in classes):
            self._box += 1
            kind = "box"
        elif self._box and tag in ("h3", "h4", "h5") and "wprm-recipe-ingredient-group" not in classes:
            kind = "name"
            last = self.groups[-1] if self.groups else None
            if not last or last["items"] or last["name"]:
                self.groups.append({"name": "", "items": []})
        elif self._box and tag == "li":
            kind = "item"
        self._stack.append((tag, kind))
        if kind in ("name", "item"):
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                popped = self._stack[i:]
                del self._stack[i:]
                break
        else:
            return
        for _, kind in reversed(popped):
            if kind == "box":
                self._box -= 1
            elif kind == "wprm":
                self._wprm -= 1
            elif kind in ("name", "item"):
                text = re.sub(r"\s+", " ", html.unescape("".join(self._buf))).strip()
                self._buf = []
                if not text:
                    continue
                group = self._group()
                if kind == "name":
                    group["name"] = text.rstrip(":").strip()
                else:
                    group["items"].append(text)

    def handle_data(self, data: str) -> None:
        if any(kind in ("name", "item") for _, kind in self._stack):
            self._buf.append(data)


def _ingredient_groups(page: str) -> list[dict[str, Any]]:
    parser = _GroupExtractor()
    try:
        parser.feed(page)
    except Exception:  # noqa: BLE001 - malformed HTML must never break an import
        return []
    return [g for g in parser.groups if g["items"]]


def _apply_groups(recipe: dict[str, Any], groups: list[dict[str, Any]]) -> None:
    """Put the page's ingredient group names into the flat ingredient list as "## name" headings.

    Only when the page lists exactly the ingredients we have, so every item can be placed. Step
    sections that line up with the groups one-to-one take the groups' names, so a section is
    called the same in both lists.
    """
    ingredients = [i for i in recipe.get("ingredients") or [] if not str(i).startswith("## ")]
    if not any(g["name"] for g in groups) or sum(len(g["items"]) for g in groups) != len(ingredients):
        return
    merged: list[str] = []
    at = 0
    for g in groups:
        if g["name"]:
            merged.append(f"## {g['name']}")
        merged.extend(ingredients[at : at + len(g["items"])])
        at += len(g["items"])
    recipe["ingredients"] = merged
    names = [g["name"] for g in groups if g["name"]]
    steps = recipe.get("instructions") or []
    sections = [i for i, st in enumerate(steps) if isinstance(st, dict) and st.get("section")]
    if len(sections) == len(names):
        for i, name in zip(sections, names):
            steps[i] = {**steps[i], "text": name}


_SERVING_WORDS = {
    "serving", "servings", "portion", "portions", "person", "persons", "people",
    "personer", "port", "porter", "portioner", "pers", "pers.", "servings.",
}
_YIELD = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s+(.+?)\s*$")


def split_yield(text: str) -> tuple[str, float | None, str]:
    """Split a recipeYield like "12 cookies" into (servings, amount, unit).

    "4 servings" / "4" stay servings; "12 cookies" becomes a yield, which is how
    the panel scales things that are counted in pieces rather than portions.
    """
    text = (text or "").strip()
    match = _YIELD.match(text)
    if match and match.group(2).strip().lower() not in _SERVING_WORDS:
        unit = match.group(2).strip()
        if len(unit) <= 40 and not re.search(r"\d", unit):
            return "", float(match.group(1).replace(",", ".")), unit
    return text, None, ""


def _tidy_tags(tags: list[str]) -> list[str]:
    """Drop SEO-style keyword phrases; keep short, tag-like values."""
    return [t for t in tags if len(t) <= 30 and len(t.split()) <= 3][:12]


def _scrapers_parse(page: str, url: str) -> dict[str, Any] | None:
    """Parse with the recipe-scrapers library (site-specific scrapers + schema.org).

    Returns None when the library is unavailable or cannot read the page.
    """
    try:
        from recipe_scrapers import scrape_html  # noqa: PLC0415 - optional, slow import
    except ImportError:
        return None
    try:
        scraper = scrape_html(page, org_url=url, supported_only=False)
    except Exception:  # noqa: BLE001 - the library raises many exception types
        return None

    def get(name: str) -> Any:
        try:
            value = getattr(scraper, name)()
        except Exception:  # noqa: BLE001
            return None
        return None if value in (None, "", []) else value

    def minutes(name: str) -> int | None:
        value = get(name)
        return int(value) if isinstance(value, (int, float)) and value > 0 else None

    result: dict[str, Any] = {
        "name": _text(get("title")),
        "description": _text(get("description")),
        "image": get("image") or "",
        "ingredients": [t for i in get("ingredients") or [] if (t := _text(i))],
        "instructions": [t for i in get("instructions_list") or [] if (t := _text(i))],
        **dict(zip(("servings", "yield_amount", "yield_unit"), split_yield(_text(get("yields"))))),
        "prep_time": minutes("prep_time"),
        "cook_time": minutes("cook_time"),
        "total_time": minutes("total_time"),
        "categories": _list(get("category")),
    }
    keywords = get("keywords")
    keywords = keywords if isinstance(keywords, list) else _list(keywords)
    result["tags"] = _tidy_tags(_list(get("cuisine")) + [t for k in keywords if (t := _text(k))])
    return result


def _merge(primary: dict[str, Any] | None, fallback: dict[str, Any] | None, url: str) -> dict[str, Any]:
    """Overlay ``primary`` on ``fallback``, field by field, ignoring empty values."""
    if primary is None and fallback is None:
        raise RecipeImportError("No recipe data found on that page")
    merged: dict[str, Any] = {}
    for source in (fallback or {}, primary or {}):
        for key, value in source.items():
            if value not in (None, "", []):
                merged[key] = value
    if not merged.get("ingredients") and not merged.get("instructions"):
        raise RecipeImportError("No recipe data found on that page")
    seen = {c.casefold() for c in merged.get("categories", [])}
    merged["tags"] = [t for t in merged.get("tags", []) if t.casefold() not in seen]
    # recipe-scrapers flattens sections; keep our own copy when it adds headings
    # to the very same items.
    own = fallback or {}
    for key, is_section in (
        ("ingredients", lambda i: isinstance(i, str) and i.startswith("## ")),
        ("instructions", lambda i: isinstance(i, dict) and i.get("section")),
    ):
        mine = own.get(key) or []
        if any(is_section(i) for i in mine):
            titles = {(i if isinstance(i, str) else i.get("text", "")).removeprefix("## ").casefold() for i in mine if is_section(i)}

            def plain(items: list[Any], skip: set[str] = frozenset()) -> list[str]:
                texts = [i if isinstance(i, str) else i.get("text") for i in items if not is_section(i)]
                return [t for t in texts if str(t).casefold() not in skip]

            # recipe-scrapers lists a section's name as a step of its own: look past those
            if plain(mine) == plain(merged.get(key, []), titles):
                merged[key] = mine
    merged.setdefault("name", "Imported recipe")
    merged["source_url"] = url
    return merged


def parse_page(page: str, url: str) -> dict[str, Any]:
    """Best-effort import: recipe-scrapers first, then our own JSON-LD/HTML parser."""
    try:
        own: dict[str, Any] | None = parse_recipe(page, url)
    except RecipeImportError:
        own = None
    recipe = _merge(_scrapers_parse(page, url), own, url)
    if not any(str(i).startswith("## ") for i in recipe.get("ingredients") or []):
        _apply_groups(recipe, _ingredient_groups(page))
    # a step that names an ingredient links to it, so the panel can show it as a chip in the text
    if link_ingredients is not None:
        recipe["instructions"] = link_ingredients(recipe.get("ingredients") or [], recipe.get("instructions") or [])
    return recipe


def parse_recipe(page: str, url: str) -> dict[str, Any]:
    """Extract a recipe dict from an HTML page."""
    node = None
    for raw in _LD_JSON.findall(page):
        try:
            data = json.loads(raw.strip())
        except ValueError:
            continue
        if (node := _find_recipe(data)) is not None:
            break
    if node is None:
        raise RecipeImportError("No schema.org recipe data found on that page")
    return recipe_from_node(node, page, url)


def recipe_from_node(node: dict[str, Any], page: str, url: str) -> dict[str, Any]:
    """Build a recipe dict from a schema.org Recipe node.

    ``page`` (may be empty) is only used for the HTML list fallback.
    """
    yield_ = node.get("recipeYield", "")
    if isinstance(yield_, list):
        yield_ = yield_[0] if yield_ else ""

    seen: set[str] = set()

    def unique(items: list[str]) -> list[str]:
        return [t for t in items if not (t.casefold() in seen or seen.add(t.casefold()))]

    categories = unique(_list(node.get("recipeCategory")))
    unique_tags = unique(
        _tidy_tags(_list(node.get("recipeCuisine")) + _list(node.get("keywords")))
    )

    ingredients = [
        t for i in node.get("recipeIngredient", node.get("ingredients", [])) if (t := _text(i))
    ]
    instructions = _steps(node.get("recipeInstructions"))
    if page and (not ingredients or not instructions):
        html_ingredients, html_instructions = _html_lists(page)
        ingredients = ingredients or html_ingredients
        instructions = instructions or html_instructions

    servings, yield_amount, yield_unit = split_yield(_text(yield_))
    return {
        "name": _text(node.get("name")) or "Imported recipe",
        "description": _text(node.get("description")),
        "image": _image(node.get("image")),
        "ingredients": ingredients,
        "instructions": instructions,
        "tags": unique_tags,
        "categories": categories,
        "servings": servings,
        "yield_amount": yield_amount,
        "yield_unit": yield_unit,
        "prep_time": _minutes(node.get("prepTime")),
        "cook_time": _minutes(node.get("cookTime")),
        "total_time": _minutes(node.get("totalTime")),
        "source_url": url,
    }


def parse_pasted(text: str, url: str = "") -> dict[str, Any]:
    """Whatever the user pasted: page source, schema.org Recipe JSON, or plain text (a recipe or a transcript)."""
    text = text.strip()
    url = url.strip()
    if not text:
        raise RecipeImportError("Paste something to import")
    if text[0] in "{[":
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if data is not None:
            node = _find_recipe(data)
            if node is None:
                raise RecipeImportError("No schema.org Recipe found in that JSON")
            recipe = recipe_from_node(node, "", url or _text(node.get("url")))
            if not recipe["ingredients"] and not recipe["instructions"]:
                raise RecipeImportError("That Recipe has no ingredients or instructions")
            if link_ingredients is not None:
                recipe["instructions"] = link_ingredients(recipe["ingredients"], recipe["instructions"])
            return recipe
    if re.search(r"<\s*(?:!doctype|html|head|body|script|div|ul|ol|li|p)\b", text[:200000], re.IGNORECASE):
        return parse_page(text, url)
    try:
        recipe = parse_text(text, url)
    except ValueError as err:
        raise RecipeImportError(str(err)) from err
    if link_ingredients is not None:
        recipe["instructions"] = link_ingredients(recipe["ingredients"], recipe["instructions"])
    return recipe


async def async_import_text(text: str, url: str = "") -> dict[str, Any]:
    """Parse pasted page source, Recipe JSON or plain text into a recipe preview."""
    if len(text) > _MAX_BYTES:
        raise RecipeImportError("That text is too large")
    return await asyncio.get_running_loop().run_in_executor(None, parse_pasted, text, url)


async def async_import_html(page: str, url: str = "") -> dict[str, Any]:
    """Parse a recipe from page source the user pasted (for sites that refuse automated requests)."""
    if len(page) > _MAX_BYTES:
        raise RecipeImportError("That page source is too large")
    return await asyncio.get_running_loop().run_in_executor(None, parse_page, page, url.strip())


async def async_import_url(session: ClientSession, url: str) -> dict[str, Any]:
    """Fetch a URL and parse the recipe on it."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise RecipeImportError("Only http(s) URLs can be imported")
    try:
        async with session.get(
            url,
            timeout=ClientTimeout(total=20),
            headers={"User-Agent": "Mozilla/5.0 (HomeAssistant hass_recipes)"},
        ) as resp:
            resp.raise_for_status()
            # StreamReader.read(n) returns whatever is buffered, not the whole
            # body, so read chunks until EOF or the size cap.
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.content.iter_chunked(65536):
                chunks.append(chunk)
                size += len(chunk)
                if size >= _MAX_BYTES:
                    break
            body = b"".join(chunks)
            page = body.decode(resp.get_encoding() or "utf-8", errors="replace")
    except (ClientError, TimeoutError, LookupError) as err:
        raise RecipeImportError(f"Could not fetch page: {err}") from err
    # Parsing is CPU-bound (bs4/extruct): keep it off the event loop.
    return await asyncio.get_running_loop().run_in_executor(None, parse_page, page, url)
