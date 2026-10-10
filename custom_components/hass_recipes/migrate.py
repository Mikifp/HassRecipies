"""Import/export helpers: native JSON, Mealie, Paprika and schema.org recipes.

Everything here is pure Python (no Home Assistant imports) so it can be tested
on its own. Converters return dicts shaped like the store's editable fields;
step links to ingredients are kept where the source format has them.
"""

from __future__ import annotations

import base64
import binascii
import gzip
import io
import json
import re
from typing import Any
import zipfile

from .scraper import _find_recipe, _minutes, recipe_from_node, split_yield

MAX_RECIPES = 5000
MAX_ENTRY_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024

EXPORT_FORMAT = "hass_recipes"
EXPORT_VERSION = 1


class MigrationError(Exception):
    """The uploaded data could not be understood."""


def _names(items: Any) -> list[str]:
    """['a', {'name': 'b'}] -> ['a', 'b'] (Mealie uses objects, others strings)."""
    out: list[str] = []
    for item in items or []:
        name = item.get("name") if isinstance(item, dict) else item
        if isinstance(name, str) and name.strip():
            out.append(name.strip())
    return out


def _clock_minutes(value: Any) -> int | None:
    """Minutes from numbers or text like '1 hr 30 min', 'PT15M', '45'."""
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"\d+", text):
            return int(text)
        return _minutes(text)
    return None


def _lines(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [line.strip() for line in re.split(r"\r?\n+", value) if line.strip()]
    return []


# ---------- Mealie ----------
def _camel(key: str) -> str:
    head, *rest = key.split("_")
    out = head + "".join(part.capitalize() for part in rest)
    return "orgURL" if out == "orgUrl" else out


def _camelize(obj: Any) -> Any:
    """Mealie's file exports use snake_case keys, its API uses camelCase; unify."""
    if isinstance(obj, dict):
        return {_camel(k) if isinstance(k, str) else k: _camelize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_camelize(v) for v in obj]
    return obj



def from_mealie(d: dict[str, Any], base_url: str = "") -> dict[str, Any]:
    ingredients: list[str] = []
    ref_index: dict[str, int] = {}
    for ing in d.get("recipeIngredient") or []:
        if isinstance(ing, str):
            text = ing.strip()
            ref = None
        else:
            if (section := (ing.get("title") or "").strip()):
                ingredients.append(f"## {section}")
            text = (ing.get("display") or ing.get("originalText") or "").strip()
            if not text:
                unit = (ing.get("unit") or {}).get("name", "") if isinstance(ing.get("unit"), dict) else ""
                food = (ing.get("food") or {}).get("name", "") if isinstance(ing.get("food"), dict) else ""
                qty = ing.get("quantity")
                qty_text = "" if not qty else f"{qty:g}"
                text = " ".join(p for p in (qty_text, unit, food, ing.get("note") or "") if p).strip()
            ref = ing.get("referenceId")
        if not text:
            continue
        if ref:
            ref_index[ref] = len(ingredients)
        ingredients.append(text)

    steps: list[dict[str, Any]] = []
    for step in d.get("recipeInstructions") or []:
        if isinstance(step, str):
            text, links = step.strip(), []
        else:
            text = (step.get("text") or step.get("summary") or "").strip()
            if (title := (step.get("title") or "").strip()) and text:
                steps.append({"text": title, "ingredients": [], "timer": None, "section": True})
            links = sorted(
                {
                    ref_index[r["referenceId"]]
                    for r in step.get("ingredientReferences") or []
                    if r.get("referenceId") in ref_index
                }
            )
        if text:
            steps.append({"text": text, "ingredients": links, "timer": None})

    notes = "\n\n".join(
        (f"{n.get('title')}\n" if n.get("title") else "") + (n.get("text") or "")
        for n in d.get("notes") or []
        if isinstance(n, dict) and (n.get("text") or n.get("title"))
    )
    image = ""
    if base_url and d.get("image") and d.get("id"):
        image = f"{base_url}/api/media/recipes/{d['id']}/images/original.webp"
    servings, yield_amount, yield_unit = split_yield(
        str(d.get("recipeYield") or d.get("recipeServings") or "")
    )
    return {
        "name": (d.get("name") or "Imported recipe").strip(),
        "description": (d.get("description") or "").strip(),
        "image": image,
        "ingredients": ingredients,
        "instructions": steps,
        "tags": _names(d.get("tags")),
        "categories": _names(d.get("recipeCategory")),
        "tools": _names(d.get("tools")),
        "servings": servings,
        "yield_amount": yield_amount,
        "yield_unit": yield_unit,
        "prep_time": _clock_minutes(d.get("prepTime")),
        "cook_time": _clock_minutes(d.get("cookTime") or d.get("performTime")),
        "total_time": _clock_minutes(d.get("totalTime")),
        "source_url": d.get("orgURL") or "",
        "notes": notes,
    }


# ---------- Paprika ----------
def from_paprika(d: dict[str, Any]) -> dict[str, Any]:
    notes = "\n\n".join(p for p in (d.get("notes"), d.get("source") and f"Source: {d['source']}") if p)
    directions = _lines(d.get("directions"))
    servings, yield_amount, yield_unit = split_yield(str(d.get("servings") or ""))
    recipe = {
        "name": (d.get("name") or "Imported recipe").strip(),
        "description": (d.get("description") or "").strip(),
        "image": d.get("image_url") or "",
        "ingredients": _lines(d.get("ingredients")),
        "instructions": [{"text": t, "ingredients": [], "timer": None} for t in directions],
        "tags": [],
        "categories": _names(d.get("categories")),
        "tools": [],
        "servings": servings,
        "yield_amount": yield_amount,
        "yield_unit": yield_unit,
        "prep_time": _clock_minutes(d.get("prep_time")),
        "cook_time": _clock_minutes(d.get("cook_time")),
        "total_time": _clock_minutes(d.get("total_time")),
        "source_url": d.get("source_url") or "",
        "notes": notes,
    }
    if photo := d.get("photo_data"):
        try:
            recipe["_image"] = base64.b64decode(photo)
        except (binascii.Error, ValueError):
            pass
    return recipe


# ---------- sniffing ----------
def _looks_mealie(d: dict[str, Any]) -> bool:
    return "recipeIngredient" in d and (
        "slug" in d
        or any(isinstance(i, dict) for i in d.get("recipeIngredient") or [])
        or any(isinstance(i, dict) and "text" in i and "@type" not in i for i in d.get("recipeInstructions") or [])
    ) and "@type" not in d


def convert(obj: Any, base_url: str = "") -> list[dict[str, Any]]:
    """Turn any supported JSON document into a list of recipe dicts."""
    if isinstance(obj, list):
        return [r for item in obj for r in convert(item, base_url)]
    if not isinstance(obj, dict):
        return []
    if obj.get("format") == EXPORT_FORMAT and isinstance(obj.get("recipes"), list):
        out = []
        for r in obj["recipes"]:
            if not isinstance(r, dict) or not r.get("name"):
                continue
            r = dict(r)
            if data := r.pop("image_data", None):  # photos embedded by our exporter
                try:
                    r["_image"] = base64.b64decode(data)
                except (binascii.Error, ValueError):
                    pass
            out.append(r)
        return out
    if "recipe_ingredient" in obj or "recipe_instructions" in obj:
        obj = _camelize(obj)  # Mealie file export (snake_case)
    if "@type" in obj or "@graph" in obj:
        node = _find_recipe(obj)
        return [recipe_from_node(node, "", obj.get("url", ""))] if node else []
    if "directions" in obj and "ingredients" in obj and isinstance(obj.get("ingredients"), str):
        return [from_paprika(obj)]
    if _looks_mealie(obj):
        return [from_mealie(obj, base_url)]
    if isinstance(obj.get("recipes"), list):  # generic wrapper
        return convert(obj["recipes"], base_url)
    if isinstance(obj.get("ingredients"), list) and obj.get("name"):
        return [obj]  # already native-shaped
    return []


def _json(data: bytes) -> Any:
    return json.loads(data.decode("utf-8-sig"))


def parse_upload(data: bytes) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse an uploaded file into (recipes, cookbooks).

    Accepts a native export, Mealie recipe JSON, schema.org JSON, a Paprika
    ``.paprikarecipes`` archive, or a zip containing any of those.
    """
    recipes: list[dict[str, Any]] = []
    cookbooks: list[dict[str, Any]] = []
    seen: list[str] = []  # what the file contained, for the error message

    def take(obj: Any, label: str = "") -> None:
        if len(seen) < 6:
            if isinstance(obj, dict):
                seen.append(f"{label or 'JSON'} (keys: {', '.join(list(obj)[:8])})")
            elif isinstance(obj, list):
                first = obj[0] if obj and isinstance(obj[0], dict) else {}
                seen.append(f"{label or 'JSON'} (list of {len(obj)}; keys: {', '.join(list(first)[:8])})")
        if isinstance(obj, dict) and obj.get("format") == EXPORT_FORMAT:
            cookbooks.extend(c for c in obj.get("cookbooks", []) if isinstance(c, dict) and c.get("name"))
        recipes.extend(convert(obj))

    def read_zip(blob: bytes, depth: int = 0) -> None:
        total = 0
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            infos = [i for i in zf.infolist() if not i.is_dir() and i.file_size <= MAX_ENTRY_BYTES]
            images: dict[str, list[zipfile.ZipInfo]] = {}
            for info in infos:
                if info.filename.lower().endswith((".webp", ".jpg", ".jpeg", ".png")):
                    folder = info.filename.rsplit("/", 1)[0] if "/" in info.filename else ""
                    images.setdefault(folder, []).append(info)

            def photo_for(path: str) -> bytes | None:
                """Mealie keeps <slug>/<slug>.json next to <slug>/images/original.webp."""
                folder = path.rsplit("/", 1)[0] if "/" in path else ""
                candidates = images.get(f"{folder}/images" if folder else "images", []) + images.get(folder, [])
                if not candidates:
                    return None
                def rank(i: zipfile.ZipInfo) -> int:
                    base = i.filename.rsplit("/", 1)[-1].lower()
                    if base.startswith("original."):
                        return 0  # the full-size image
                    return 2 if base.startswith(("min-", "tiny-", "thumb")) else 1

                return zf.read(min(candidates, key=rank))

            for info in infos:
                total += info.file_size
                if total > MAX_TOTAL_BYTES:
                    raise MigrationError("The archive is too large")
                raw = zf.read(info)
                name = info.filename.lower()
                try:
                    if raw[:2] == b"\x1f\x8b":  # Paprika entries are gzipped JSON
                        raw = gzip.decompress(raw)
                    if raw[:4] == b"PK\x03\x04" and depth < 1:
                        read_zip(raw, depth + 1)
                    elif name.endswith((".json", ".paprikarecipe")) or raw.lstrip()[:1] in (b"{", b"["):
                        before = len(recipes)
                        take(_json(raw), info.filename)
                        added = recipes[before:]
                        if len(added) == 1 and "_image" not in added[0] and (photo := photo_for(info.filename)):
                            added[0]["_image"] = photo
                except (ValueError, OSError, zipfile.BadZipFile):
                    continue  # skip entries that are not recipes (images etc.)
                if len(recipes) > MAX_RECIPES:
                    raise MigrationError(f"More than {MAX_RECIPES} recipes in one file")

    try:
        if data[:4] == b"PK\x03\x04":
            read_zip(data)
        else:
            if data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            take(_json(data))
    except (ValueError, OSError, zipfile.BadZipFile) as err:
        raise MigrationError(f"Could not read that file: {err}") from err
    if len(recipes) > MAX_RECIPES:
        raise MigrationError(f"More than {MAX_RECIPES} recipes in one file")
    if not recipes:
        hint = ""
        if any(s.startswith("database.json") for s in seen):
            hint = " This looks like a full Mealie backup (database.json), which is not supported yet."
        detail = f" Found: {'; '.join(seen)}." if seen else ""
        raise MigrationError(f"No recipes found in that file.{hint}{detail}")
    return recipes, cookbooks
