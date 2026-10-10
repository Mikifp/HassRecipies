"""Assist voice commands for cooking: next step, read the ingredients, time left.

The handlers live here; the sentences ship as YAML in ``sentences/`` and are copied
into ``<config>/custom_sentences/<language>/`` (the place Home Assistant reads
custom sentences from) when the integration starts.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent

from .const import DOMAIN
from .ingredients import is_header, parse_ingredient
from .store import RecipeStore, cooking_pages

_LOGGER = logging.getLogger(__name__)

INTENT_NEXT = "HassRecipesNextStep"
INTENT_PREVIOUS = "HassRecipesPreviousStep"
INTENT_REPEAT = "HassRecipesRepeatStep"
INTENT_INGREDIENTS = "HassRecipesReadIngredients"
INTENT_TIME_LEFT = "HassRecipesTimeLeft"
INTENT_START_TIMER = "HassRecipesStartTimer"

_TEXT = {
    "en": {
        "nothing": "You haven't picked a recipe to cook yet.",
        "ingredients_page": "Ingredients for {name}: {items}.",
        "no_ingredients": "{name} has no ingredients listed.",
        "step": "Step {n} of {total}: {text}",
        "no_steps": "{name} has no steps.",
        "start": "That was the start of {name}.",
        "end": "That was the last step. Enjoy!",
        "no_timers": "There are no timers running.",
        "left": "{label}: {left} left",
        "done": "{label} is finished",
        "no_step_timer": "This step has no timer.",
        "timer_started": "Timer started for {left}.",
        "timer_running": "That timer is already running.",
        "min": "{n} minute{s}",
        "sec": "{n} second{s}",
        "and": " and ",
    },
    "da": {
        "nothing": "Du har ikke valgt en opskrift endnu.",
        "ingredients_page": "Ingredienser til {name}: {items}.",
        "no_ingredients": "{name} har ingen ingredienser.",
        "step": "Trin {n} af {total}: {text}",
        "no_steps": "{name} har ingen trin.",
        "start": "Det var begyndelsen af {name}.",
        "end": "Det var sidste trin. Velbekomme!",
        "no_timers": "Der kører ingen timere.",
        "left": "{label}: {left} tilbage",
        "done": "{label} er færdig",
        "no_step_timer": "Dette trin har ingen timer.",
        "timer_started": "Timer startet på {left}.",
        "timer_running": "Den timer kører allerede.",
        "min": "{n} minut{s}",
        "sec": "{n} sekund{s}",
        "and": " og ",
    },
}


def _t(language: str | None) -> dict[str, str]:
    return _TEXT.get((language or "en").split("-")[0], _TEXT["en"])


def _plural(language: str | None, word: str, n: int) -> str:
    base = (language or "en").split("-")[0]
    suffix = "" if n == 1 else ("s" if base == "en" else "ter" if word == "min" else "er")
    return suffix


def _duration(language: str | None, seconds: float) -> str:
    t = _t(language)
    seconds = max(1, int(round(seconds)))
    minutes, secs = divmod(seconds, 60)
    parts = []
    if minutes:
        parts.append(t["min"].format(n=minutes, s=_plural(language, "min", minutes)))
    if secs and minutes < 10:
        parts.append(t["sec"].format(n=secs, s=_plural(language, "sec", secs)))
    return t["and"].join(parts)


def _number(language: str | None, value: float) -> str:
    text = f"{round(value, 2):g}"
    return text.replace(".", ",") if (language or "en").startswith("da") else text


def spoken_ingredient(line: str, scale: float, language: str | None = None) -> str:
    """One ingredient as it is read out, scaled."""
    parsed = parse_ingredient(line.partition(" || ")[0])
    quantity = parsed.get("quantity")
    if quantity is None:
        return parsed.get("food") or line
    amount = _number(language, quantity * scale)
    if parsed.get("quantity_max"):
        amount += " to " if not (language or "").startswith("da") else " til "
        amount += _number(language, parsed["quantity_max"] * scale)
    parts = [amount, parsed.get("unit_text") or "", parsed.get("food") or ""]
    return " ".join(p for p in parts if p)


def _cooking(hass: HomeAssistant):
    store: RecipeStore = hass.data[DOMAIN]
    recipe = store.get(store.cooking_recipe_id or "")
    return store, recipe


def _page_text(hass: HomeAssistant, language: str | None) -> str:
    store, recipe = _cooking(hass)
    t = _t(language)
    if recipe is None:
        return t["nothing"]
    pages = cooking_pages(recipe)
    if not pages:
        return t["no_steps"].format(name=recipe["name"])
    page = pages[min(store.cooking_step, len(pages) - 1)]
    if page["kind"] == "ingredients":
        items = [
            spoken_ingredient(i, store.cooking_scale, language)
            for i in recipe.get("ingredients", [])
            if not is_header(i)
        ]
        if not items:
            return t["no_ingredients"].format(name=recipe["name"])
        return t["ingredients_page"].format(name=recipe["name"], items=", ".join(items))
    steps = [p for p in pages if p["kind"] == "step"]
    return t["step"].format(n=steps.index(page) + 1, total=len(steps), text=page["text"])


class _CookingIntent(intent.IntentHandler):
    platforms = {DOMAIN}

    def __init__(self, intent_type: str) -> None:
        self.intent_type = intent_type

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        language = intent_obj.language
        store, recipe = _cooking(hass)
        t = _t(language)
        speech = t["nothing"]
        if recipe is not None:
            speech = self._answer(hass, store, recipe, language, t)
        response = intent_obj.create_response()
        response.async_set_speech(speech)
        return response

    def _answer(self, hass, store, recipe, language, t) -> str:
        kind = self.intent_type
        pages = cooking_pages(recipe)
        if kind in (INTENT_NEXT, INTENT_PREVIOUS):
            before = store.cooking_step
            store.set_cooking(delta=1 if kind == INTENT_NEXT else -1)
            if store.cooking_step == before and pages:
                return t["end"] if kind == INTENT_NEXT else t["start"].format(name=recipe["name"])
            return _page_text(hass, language)
        if kind == INTENT_REPEAT:
            return _page_text(hass, language)
        if kind == INTENT_INGREDIENTS:
            items = [
                spoken_ingredient(i, store.cooking_scale, language)
                for i in recipe.get("ingredients", [])
                if not is_header(i)
            ]
            if not items:
                return t["no_ingredients"].format(name=recipe["name"])
            return t["ingredients_page"].format(name=recipe["name"], items=", ".join(items))
        if kind == INTENT_START_TIMER:
            page = pages[min(store.cooking_step, len(pages) - 1)] if pages else {}
            seconds = page.get("timer")
            if not seconds:
                return t["no_step_timer"]
            timers = hass.data[f"{DOMAIN}_timers"]
            key = f"{recipe['id']}:{page['index']}"
            if any(x["key"] == key and not x["done"] for x in timers.timers.values()):
                return t["timer_running"]
            steps = [p for p in pages if p["kind"] == "step"]
            timers.start(
                key,
                f"{recipe['name']} · step {steps.index(page) + 1}",
                seconds,
                recipe_id=recipe["id"],
                recipe_name=recipe["name"],
                step=page["index"],
            )
            return t["timer_started"].format(left=_duration(language, seconds))
        return t["nothing"]


class _TimeLeftIntent(_CookingIntent):
    """Works without a chosen recipe: it answers for every running timer."""

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        language = intent_obj.language
        t = _t(language)
        timers = hass.data[f"{DOMAIN}_timers"]
        snap = timers.snapshot()
        now = snap["now_ms"]
        parts = []
        for timer in snap["timers"]:
            label = timer["label"].replace(" · ", ", ")
            if timer["done"]:
                parts.append(t["done"].format(label=label))
            else:
                parts.append(t["left"].format(label=label, left=_duration(language, (timer["ends_at_ms"] - now) / 1000)))
        response = intent_obj.create_response()
        response.async_set_speech(". ".join(parts) if parts else t["no_timers"])
        return response


ALL_INTENTS = (INTENT_NEXT, INTENT_PREVIOUS, INTENT_REPEAT, INTENT_INGREDIENTS, INTENT_TIME_LEFT, INTENT_START_TIMER)


def async_remove_intents(hass: HomeAssistant) -> None:
    for kind in ALL_INTENTS:
        intent.async_remove(hass, kind)


def async_setup_intents(hass: HomeAssistant) -> None:
    for kind in (INTENT_NEXT, INTENT_PREVIOUS, INTENT_REPEAT, INTENT_INGREDIENTS, INTENT_START_TIMER):
        intent.async_register(hass, _CookingIntent(kind))
    intent.async_register(hass, _TimeLeftIntent(INTENT_TIME_LEFT))


def _install_sentences_sync(config_dir: Path, source: Path) -> bool:
    changed = False
    for file in sorted(source.glob("*.yaml")):
        target = config_dir / "custom_sentences" / file.stem / "hass_recipes.yaml"
        content = file.read_text(encoding="utf-8")
        if target.exists() and target.read_text(encoding="utf-8") == content:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        changed = True
    return changed


async def async_install_sentences(hass: HomeAssistant) -> None:
    """Copy the bundled sentences where Assist reads custom sentences from."""
    source = Path(__file__).parent / "sentences"
    try:
        changed = await hass.async_add_executor_job(
            _install_sentences_sync, Path(hass.config.config_dir), source
        )
    except OSError as err:
        _LOGGER.warning("Could not install the Assist sentences: %s", err)
        return
    if changed and hass.services.has_service("conversation", "reload"):
        await hass.services.async_call("conversation", "reload", {}, blocking=False)
