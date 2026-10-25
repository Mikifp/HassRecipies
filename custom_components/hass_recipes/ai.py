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


async def async_tidy(hass: HomeAssistant, text: str, url: str = "") -> dict[str, Any]:
    """Ask the configured AI Task entity to read the text as a recipe."""
    if not available(hass):
        raise RecipeImportError("This Home Assistant has no AI Task. Add an AI such as Google Gemini or Ollama first.")
    try:
        async with asyncio.timeout(_TIMEOUT):
            result = await hass.services.async_call(
                "ai_task",
                "generate_data",
                {
                    "task_name": "Recipe import",
                    "instructions": _INSTRUCTIONS + text[:_MAX_CHARS],
                    "structure": _STRUCTURE,
                },
                blocking=True,
                return_response=True,
            )
    except TimeoutError as err:
        raise RecipeImportError("The AI took too long to answer") from err
    except HomeAssistantError as err:
        if "preferred entity" in str(err):
            raise RecipeImportError(
                "No AI is chosen for AI tasks. In Home Assistant open Settings > System > AI tasks and pick one."
            ) from err
        raise RecipeImportError(f"The AI could not read the text: {err}") from err
    data = (result or {}).get("data")
    if not isinstance(data, dict):
        raise RecipeImportError("The AI gave no answer")
    return recipe_from_ai(data, url)
