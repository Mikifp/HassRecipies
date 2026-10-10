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
            plain = lambda items: [i if isinstance(i, str) else i.get("text") for i in items if not is_section(i)]  # noqa: E731
            if plain(mine) == plain(merged.get(key, [])):
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
    return _merge(_scrapers_parse(page, url), own, url)


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
