"""Send a recipe's ingredients to a Home Assistant to-do / shopping list."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .ingredients import format_ingredient
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
    return {"recipe": recipe["name"], "entity_id": entity_id, "added": added, "skipped": skipped}


async def async_add_plan_to_shopping_list(
    hass: HomeAssistant,
    store: RecipeStore,
    entries: list[dict[str, Any]],
    entity_id: str,
    units: str = "grams",
) -> dict[str, Any]:
    """Send the ingredients of every planned recipe to a to-do list.

    Amounts are not summed across meals: an item already on the list (from an
    earlier meal in the same run or from before) is skipped, as for a single recipe.
    """
    added: list[str] = []
    skipped: list[str] = []
    meals = 0
    for entry in entries:
        recipe = store.get(entry.get("recipe_id") or "")
        if recipe is None:
            continue  # a free-text meal has no ingredients
        result = await async_add_to_shopping_list(
            hass,
            store,
            {
                "recipe": recipe["id"],
                "entity_id": entity_id,
                "units": units,
                **({"scale": entry["scale"]} if entry.get("scale") else {}),
            },
        )
        meals += 1
        added += result["added"]
        skipped += result["skipped"]
    return {"entity_id": entity_id, "meals": meals, "added": added, "skipped": skipped}
