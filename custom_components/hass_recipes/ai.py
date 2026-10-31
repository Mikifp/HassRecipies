"""Tidy pasted text into a recipe with the AI the user has set up in Home Assistant (AI Task)."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .scraper import RecipeImportError

_MAX_CHARS = 30000
_TIMEOUT = 180

_INSTRUCTIONS = """Extract the recipe from the text below. The text may be a typed recipe, a web page or a video transcript.
- Keep the language of the text. Do not invent anything that is not in the text.
- name: a short recipe title.
- ingredients: one entry per ingredient, amount first, e.g. "200 g butter". Where a transcript says an amount aloud, include it. Merge duplicates.
- instructions: the method as clear, separate steps in order, in the imperative. Remove greetings, sponsor messages and chatter.
- times in whole minutes (prep_time, cook_time, total_time) only if the text states them; servings as written (e.g. "4").
- tags and categories only if the text clearly supports them.

TEXT:
"""

_STRUCTURE = {
    "name": {"selector": {"text": {}}, "description": "Recipe title", "required": True},
    "description": {"selector": {"text": {"multiline": True}}, "description": "One or two sentences about the dish"},
    "ingredients": {"selector": {"text": {"multiple": True}}, "description": "Ingredients, amount first", "required": True},
    "instructions": {"selector": {"text": {"multiple": True}}, "description": "Method steps in order", "required": True},
    "servings": {"selector": {"text": {}}, "description": "Servings as written"},
    "prep_time": {"selector": {"number": {"min": 0}}, "description": "Prep time in minutes"},
    "cook_time": {"selector": {"number": {"min": 0}}, "description": "Cook time in minutes"},
    "total_time": {"selector": {"number": {"min": 0}}, "description": "Total time in minutes"},
    "tags": {"selector": {"text": {"multiple": True}}, "description": "Short tags"},
    "categories": {"selector": {"text": {"multiple": True}}, "description": "Categories such as Dinner or Dessert"},
}


def available(hass: HomeAssistant) -> bool:
    """True when Home Assistant has the AI Task service (an AI integration may still need to be set up)."""
    return hass.services.has_service("ai_task", "generate_data")


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [t for v in value if (t := " ".join(str(v).split()))]


def _minutes(value: Any) -> int | None:
    try:
        n = round(float(value))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def recipe_from_ai(data: dict[str, Any], url: str = "") -> dict[str, Any]:
    """Shape what the AI returned like every other import."""
    ingredients = _strings(data.get("ingredients"))
    instructions = _strings(data.get("instructions"))
    if not ingredients and not instructions:
        raise RecipeImportError("The AI did not find a recipe in that text")
    return {
        "name": " ".join(str(data.get("name") or "").split())[:200] or "Imported recipe",
        "description": str(data.get("description") or "").strip(),
        "image": "",
        "ingredients": ingredients,
        "instructions": instructions,
        "tags": _strings(data.get("tags")),
        "categories": _strings(data.get("categories")),
        "servings": str(data.get("servings") or "").strip(),
        "yield_amount": None,
        "yield_unit": "",
        "prep_time": _minutes(data.get("prep_time")),
        "cook_time": _minutes(data.get("cook_time")),
        "total_time": _minutes(data.get("total_time")),
        "source_url": url,
    }


async def _generate(hass: HomeAssistant, task: str, instructions: str, structure: dict[str, Any], entity_id: str | None) -> Any:
    data = {"task_name": task, "instructions": instructions, "structure": structure}
    if entity_id:
        data["entity_id"] = entity_id
    async with asyncio.timeout(_TIMEOUT):
        return await hass.services.async_call("ai_task", "generate_data", data, blocking=True, return_response=True)


async def _ask(hass: HomeAssistant, task: str, instructions: str, structure: dict[str, Any]) -> dict[str, Any]:
    """Run an AI task with the AI the user picked for AI tasks (when none is picked, the only AI Task entity); the answer as a dict."""
    if not available(hass):
        raise RecipeImportError("This Home Assistant has no AI Task. Add an AI such as Google Gemini or Ollama first.")
    try:
        try:
            result = await _generate(hass, task, instructions, structure, None)
        except HomeAssistantError as err:
            if "preferred entity" not in str(err):
                raise
            entities = sorted(hass.states.async_entity_ids("ai_task"))
            if not entities:
                raise RecipeImportError(
                    "No AI is set up for AI tasks. Add an integration such as Google Generative AI first."
                ) from err
            result = await _generate(hass, task, instructions, structure, entities[0])
    except TimeoutError as err:
        raise RecipeImportError("The AI took too long to answer") from err
    except HomeAssistantError as err:
        raise RecipeImportError(f"The AI could not answer: {err}") from err
    data = (result or {}).get("data")
    if not isinstance(data, dict):
        raise RecipeImportError("The AI gave no answer")
    return data


async def async_tidy(hass: HomeAssistant, text: str, url: str = "") -> dict[str, Any]:
    """Ask the AI Task entity to read the text as a recipe."""
    data = await _ask(hass, "Recipe import", _INSTRUCTIONS + text[:_MAX_CHARS], _STRUCTURE)
    return recipe_from_ai(data, url)


_DISH_INSTRUCTIONS = """Estimate what one normal portion of this dish is made of, as eaten. The dish may be written in Danish or English.
- ingredients: one entry per ingredient, as "<grams> g <food>", e.g. "90 g pasta, kogt". Give the weight as eaten (cooked pasta, fried meat) and name the food in a form a food composition table knows: short, in the language of the dish, no brands. Include oil, butter and sauce that are normally used.
- Keep to 3-12 ingredients; leave out salt, pepper and herbs.
- name: the dish, short.
Do not explain. If the text is not a dish or a food, return no ingredients.

DISH: """

_DISH_STRUCTURE = {
    "name": {"selector": {"text": {}}, "description": "The dish, short", "required": True},
    "ingredients": {"selector": {"text": {"multiple": True}}, "description": "Ingredients as '<grams> g <food>'", "required": True},
}


async def async_estimate_dish(hass: HomeAssistant, description: str) -> dict[str, Any]:
    """What a dish without a recipe is probably made of: a name and ingredient lines with weights (one normal portion)."""
    data = await _ask(hass, "Estimate a dish", _DISH_INSTRUCTIONS + description[:300], _DISH_STRUCTURE)
    lines = _strings(data.get("ingredients"))[:15]
    if not lines:
        raise RecipeImportError("The AI could not tell what that dish is made of. Try describing it differently")
    return {"name": " ".join(str(data.get("name") or description).split())[:120], "lines": lines}
