"""Words the integration itself says or writes: timer alerts, labels, meal names.

Everything else a user reads is in ``translations/`` (settings, services, entity names),
``sentences/`` (Assist) or the front-end files. These are the few strings that are put
together in Python, so they follow the language Home Assistant is set to. An unknown
language falls back to English.
"""

from __future__ import annotations

from typing import Any

# language -> words
_WORDS: dict[str, dict[str, Any]] = {
    "en": {
        "timer_finished": "Timer finished",
        "test_timer": "Test timer",
        "step": "step",
        "timer": "timer",
        "slots": {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "dessert": "Dessert", "snack": "Snack"},
    },
    "da": {
        "timer_finished": "Timer færdig",
        "test_timer": "Testtimer",
        "step": "trin",
        "timer": "timer",
        "slots": {"breakfast": "Morgenmad", "lunch": "Frokost", "dinner": "Aftensmad", "dessert": "Dessert", "snack": "Mellemmåltid"},
    },
    "de": {
        "timer_finished": "Timer abgelaufen",
        "test_timer": "Test-Timer",
        "step": "Schritt",
        "timer": "Timer",
        "slots": {"breakfast": "Frühstück", "lunch": "Mittagessen", "dinner": "Abendessen", "dessert": "Dessert", "snack": "Snack"},
    },
    "sv": {
        "timer_finished": "Timern är klar",
        "test_timer": "Testtimer",
        "step": "steg",
        "timer": "timer",
        "slots": {"breakfast": "Frukost", "lunch": "Lunch", "dinner": "Middag", "dessert": "Efterrätt", "snack": "Mellanmål"},
    },
    "nb": {
        "timer_finished": "Timeren er ferdig",
        "test_timer": "Testtimer",
        "step": "trinn",
        "timer": "timer",
        "slots": {"breakfast": "Frokost", "lunch": "Lunsj", "dinner": "Middag", "dessert": "Dessert", "snack": "Mellommåltid"},
    },
    "nl": {
        "timer_finished": "Timer afgelopen",
        "test_timer": "Testtimer",
        "step": "stap",
        "timer": "timer",
        "slots": {"breakfast": "Ontbijt", "lunch": "Lunch", "dinner": "Avondeten", "dessert": "Dessert", "snack": "Tussendoortje"},
    },
    "fr": {
        "timer_finished": "Minuteur terminé",
        "test_timer": "Minuteur de test",
        "step": "étape",
        "timer": "minuteur",
        "slots": {"breakfast": "Petit-déjeuner", "lunch": "Déjeuner", "dinner": "Dîner", "dessert": "Dessert", "snack": "Collation"},
    },
    "es": {
        "timer_finished": "Temporizador terminado",
        "test_timer": "Temporizador de prueba",
        "step": "paso",
        "timer": "temporizador",
        "slots": {"breakfast": "Desayuno", "lunch": "Almuerzo", "dinner": "Cena", "dessert": "Postre", "snack": "Merienda"},
    },
    "it": {
        "timer_finished": "Timer terminato",
        "test_timer": "Timer di prova",
        "step": "passo",
        "timer": "timer",
        "slots": {"breakfast": "Colazione", "lunch": "Pranzo", "dinner": "Cena", "dessert": "Dolce", "snack": "Spuntino"},
    },
}
_ALIASES = {"no": "nb", "nn": "nb"}


def base_language(language: str | None) -> str:
    code = (language or "en").lower().replace("_", "-").split("-")[0]
    code = _ALIASES.get(code, code)
    return code if code in _WORDS else "en"


def words(language: str | None) -> dict[str, Any]:
    return _WORDS[base_language(language)]


def slot_name(language: str | None, slot: str) -> str:
    return words(language)["slots"].get(slot, slot.capitalize())


def step_label(language: str | None, recipe_name: str, number: int, name: str = "", timer_n: int = 0) -> str:
    """``Recipe · step 2`` plus ``· name`` or ``· timer 2``, in the user's language."""
    w = words(language)
    label = f"{recipe_name} · {w['step']} {number}"
    if name:
        label += f" · {name}"
    elif timer_n:
        label += f" · {w['timer']} {timer_n}"
    return label
