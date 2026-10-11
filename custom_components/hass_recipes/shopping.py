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
    hass: HomeAssistant, store: RecipeStore, data: dict[str, Any]
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
    chosen = [i for i in chosen if not parsed[i].get("header")]
    items = [
        format_ingredient(parsed[i], scale, data.get("units", "grams"), mark_approx=False)
        for i in chosen
    ]

    entity_id = data["entity_id"]
    added, skipped = await _send_to_list(hass, entity_id, items)
    return {"recipe": recipe["name"], "entity_id": entity_id, "added": added, "skipped": skipped}


def aggregate_plan_items(
    store: RecipeStore, entries: list[dict[str, Any]], units: str = "grams"
) -> tuple[list[str], int]:
    """One line per ingredient for all planned recipes, with amounts added together.

    The same food in the same kind of amount (weight, volume or a counted unit) is
    summed across meals and across a recipe planned twice. Returns the lines and the
    number of recipes that contributed.
    """
    totals: dict[tuple[str, str, str], dict[str, Any]] = {}
    order: list[tuple[str, str, str]] = []
    recipes = 0
    for entry in entries:
        recipe = store.get(entry.get("recipe_id") or "")
        if recipe is None:
            continue  # a free-text meal has no ingredients
        recipes += 1
        scale = float(entry.get("scale") or recipe.get("default_scale") or 1)
        for parsed in recipe["parsed_ingredients"]:
            if parsed.get("header"):
                continue
            food = (parsed.get("food") or parsed.get("text") or "").strip()
            if not food:
                continue
            if parsed.get("quantity") is None:
                key, amount, unit = (food.casefold(), "text", ""), None, ""
            elif units == "grams" and parsed.get("grams") is not None:
                key, amount, unit = (food.casefold(), "g", ""), parsed["grams"] * scale, "g"
            elif units == "grams" and parsed.get("ml") is not None:
                key, amount, unit = (food.casefold(), "ml", ""), parsed["ml"] * scale, "ml"
            else:
                unit = (parsed.get("unit_text") or "").casefold()
                key, amount = (food.casefold(), "n", unit), parsed["quantity"] * scale
            slot = totals.get(key)
            if slot is None:
                slot = totals[key] = {"food": food, "amount": 0.0, "unit": unit, "kind": key[1],
                                      "text": parsed.get("text") or food, "note": parsed.get("note") or ""}
                order.append(key)
            if amount is not None:
                slot["amount"] += amount
    lines: list[str] = []
    for key in order:
        slot = totals[key]
        if slot["kind"] == "text":
            lines.append(slot["text"])
            continue
        if slot["kind"] in ("g", "ml"):
            amount_text = f"{_format_grams(slot['amount'])} {slot['unit']}"
        else:
            amount_text = format_number(slot["amount"]) + (f" {slot['unit']}" if slot["unit"] else "")
        note = f", {slot['note']}" if slot["note"] else ""
        lines.append(f"{amount_text} {slot['food']}{note}")
    return lines, recipes


async def async_add_plan_to_shopping_list(
    hass: HomeAssistant,
    store: RecipeStore,
    entries: list[dict[str, Any]],
    entity_id: str,
    units: str = "grams",
) -> dict[str, Any]:
    """Send the ingredients of every planned recipe to a to-do list, amounts summed."""
    items, meals = aggregate_plan_items(store, entries, units)
    added, skipped = await _send_to_list(hass, entity_id, items)
    return {"entity_id": entity_id, "meals": meals, "added": added, "skipped": skipped}
