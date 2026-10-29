"""Send a recipe's ingredients to a Home Assistant to-do / shopping list."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .ingredients import _format_grams, format_ingredient, format_number
from .store import RecipeStore


def _base_servings(servings: str | None) -> float | None:
    match = re.search(r"\d+(?:[.,]\d+)?", servings or "")
    return float(match.group(0).replace(",", ".")) if match else None


def find_recipe(store: RecipeStore, ident: str) -> dict[str, Any]:
    """Look a recipe up by id, falling back to a case-insensitive name match."""
    recipe = store.get(ident)
    if recipe is None:
        wanted = ident.strip().casefold()
        recipe = next((r for r in store.list() if r["name"].casefold() == wanted), None)
    if recipe is None:
        raise ServiceValidationError(f"Recipe not found: {ident}")
    return recipe


async def _send_to_list(hass: HomeAssistant, entity_id: str, items: list[str]) -> tuple[list[str], list[str]]:
    """Add each item to a to-do list unless it is already waiting on it."""
    existing: set[str] = set()
    try:  # skip things already waiting on the list
        response = await hass.services.async_call(
            "todo",
            "get_items",
            {"status": ["needs_action"]},
            target={"entity_id": entity_id},
            blocking=True,
            return_response=True,
        )
        existing = {
            item["summary"].casefold() for item in (response or {}).get(entity_id, {}).get("items", [])
        }
    except HomeAssistantError:
        pass

    added: list[str] = []
    skipped: list[str] = []
    for item in items:
        if item.casefold() in existing:
            skipped.append(item)
            continue
        await hass.services.async_call(
            "todo", "add_item", {"item": item}, target={"entity_id": entity_id}, blocking=True
        )
        existing.add(item.casefold())
        added.append(item)
    return added, skipped


async def async_add_to_shopping_list(
    hass: HomeAssistant, store: RecipeStore, data: dict[str, Any], nutrition: Any = None
) -> dict[str, Any]:
    recipe = find_recipe(store, data["recipe"])
    if (makes := data.get("makes")) is not None:
        written = recipe.get("yield_amount")
        if not written:
            raise ServiceValidationError(f"{recipe['name']} has no yield to scale from")
        scale = makes / written
    elif (servings := data.get("servings")) is not None:
        base = _base_servings(recipe.get("servings"))
        if not base:
            raise ServiceValidationError(f"{recipe['name']} has no numeric servings to scale from")
        scale = servings / base
    elif data.get("scale") is not None:
        scale = float(data["scale"])
    else:
        scale = float(recipe.get("default_scale") or 1)

    parsed = recipe["parsed_ingredients"]
    indexes = data.get("ingredients")
    chosen = range(len(parsed)) if indexes is None else [i for i in indexes if 0 <= i < len(parsed)]
    rows = [(parsed[i], scale) for i in chosen if not parsed[i].get("header")]
    items = _collect(rows, data.get("units", "grams"), nutrition, exact=True)

    entity_id = data["entity_id"]
    added, skipped = await _send_to_list(hass, entity_id, items)
    return {"recipe": recipe["name"], "entity_id": entity_id, "added": added, "skipped": skipped}


def _lower(name: str) -> str:
    """A food's name as a shopping line has it (Mel -> mel, but not UHT or A38)."""
    return name if name[1:2].isupper() else name[:1].lower() + name[1:]


def _collect(rows: list[tuple[dict[str, Any], float]], units: str, nutrition: Any = None, exact: bool = False) -> list[str]:
    """One line per food for ingredient lines ((parsed line, scale) pairs), amounts added together.

    A line that is one of the user's foods is that food, whatever it is called in the recipe, and
    its amount is added up in grams when the line's weight can be told (also from "2 løg"). Other
    lines are told apart by their name, and the same food in the same kind of amount is summed.
    Lines come in the order of the foods' shop sections, the foods without one last. With ``exact``,
    a food that only one line names is given as that line is written (ranges and all).
    """
    totals: dict[tuple[str, str, str], dict[str, Any]] = {}
    order: list[tuple[str, str, str]] = []
    for parsed, scale in rows:
        food = (parsed.get("food") or parsed.get("text") or "").strip()
        if not food:
            continue
        own = nutrition.shopping_food(parsed) if nutrition is not None else None
        ident = f"food:{own['id']}" if own else food.casefold()
        label = _lower(own["name"]) if own else food
        if parsed.get("quantity") is None:
            key, amount, unit = (ident, "text", ""), None, ""
        elif units == "grams" and own and own["grams"] is not None:
            key, amount, unit = (ident, "g", ""), own["grams"] * scale, "g"
        elif units == "grams" and parsed.get("grams") is not None:
            key, amount, unit = (ident, "g", ""), parsed["grams"] * scale, "g"
        elif units == "grams" and parsed.get("ml") is not None:
            key, amount, unit = (ident, "ml", ""), parsed["ml"] * scale, "ml"
        else:
            unit = (parsed.get("unit_text") or "").casefold()
            key, amount = (ident, "n", unit), parsed["quantity"] * scale
        slot = totals.get(key)
        if slot is None:
            slot = totals[key] = {"food": label, "amount": 0.0, "unit": unit, "kind": key[1],
                                  "text": label if own else (parsed.get("text") or food),
                                  "note": parsed.get("note") or "", "section": (own or {}).get("section") or "",
                                  "rows": 0, "first": (parsed, scale)}
            order.append(key)
        slot["rows"] += 1
        if amount is not None:
            slot["amount"] += amount
    order.sort(key=lambda k: (not totals[k]["section"], totals[k]["section"].casefold()))
    lines: list[str] = []
    for key in order:
        slot = totals[key]
        if exact and slot["rows"] == 1:
            parsed, scale = slot["first"]
            lines.append(format_ingredient(parsed, scale, units, mark_approx=False))
            continue
        if slot["kind"] == "text":
            lines.append(slot["text"])
            continue
        if slot["kind"] in ("g", "ml"):
            amount_text = f"{_format_grams(slot['amount'])} {slot['unit'] or slot['kind']}"
        else:
            amount_text = format_number(slot["amount"]) + (f" {slot['unit']}" if slot["unit"] else "")
        note = f", {slot['note']}" if slot["note"] else ""
        lines.append(f"{amount_text} {slot['food']}{note}")
    return lines


def aggregate_plan_items(
    store: RecipeStore, entries: list[dict[str, Any]], units: str = "grams", nutrition: Any = None
) -> tuple[list[str], int]:
    """One line per food for all planned recipes, with amounts added together (see ``_collect``).

    Returns the lines and the number of recipes that contributed.
    """
    rows: list[tuple[dict[str, Any], float]] = []
    recipes = 0
    for entry in entries:
        recipe = store.get(entry.get("recipe_id") or "")
        if recipe is None:
            continue  # a free-text meal has no ingredients
        recipes += 1
        scale = float(entry.get("scale") or recipe.get("default_scale") or 1)
        rows.extend((p, scale) for p in recipe["parsed_ingredients"] if not p.get("header"))
    return _collect(rows, units, nutrition), recipes


async def async_add_plan_to_shopping_list(
    hass: HomeAssistant,
    store: RecipeStore,
    entries: list[dict[str, Any]],
    entity_id: str,
    units: str = "grams",
    nutrition: Any = None,
) -> dict[str, Any]:
    """Send the ingredients of every planned recipe to a to-do list, amounts summed."""
    items, meals = aggregate_plan_items(store, entries, units, nutrition)
    added, skipped = await _send_to_list(hass, entity_id, items)
    return {"entity_id": entity_id, "meals": meals, "added": added, "skipped": skipped}
