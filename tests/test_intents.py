"""Spoken answers for the cooking voice commands (no Home Assistant needed)."""

import importlib
from pathlib import Path
import sys
import types


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


class _IntentHandler:
    pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub(
    "homeassistant.helpers.intent",
    IntentHandler=_IntentHandler,
    Intent=object,
    IntentResponse=object,
    async_register=lambda *a, **k: None,
    async_remove=lambda *a, **k: None,
)
_stub("homeassistant.helpers.storage", Store=object)

pkg = types.ModuleType("hr_i")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_i"] = pkg
intents = importlib.import_module("hr_i.intents")


def test_ingredients_are_read_with_the_scale_applied():
    assert intents.spoken_ingredient("250 g flour", 2, "en") == "500 g flour"
    assert intents.spoken_ingredient("2 eggs", 1.5, "en") == "3 eggs"
    assert intents.spoken_ingredient("salt to taste", 2, "en") == "salt to taste"


def test_danish_uses_a_decimal_comma():
    assert intents.spoken_ingredient("1 dl mælk", 1.5, "da") == "1,5 dl mælk"


def test_durations_are_spoken_in_the_users_language():
    assert intents._duration("en", 125) == "2 minutes and 5 seconds"
    assert intents._duration("en", 60) == "1 minute"
    assert intents._duration("da", 125) == "2 minutter og 5 sekunder"
    assert intents._duration("da", 61) == "1 minut og 1 sekund"


def test_every_bundled_sentence_file_covers_the_same_intents():
    import re

    folder = Path(__file__).parents[1] / "custom_components/hass_recipes/sentences"
    found = {f.stem: set(re.findall(r"^  (HassRecipes\w+):", f.read_text(encoding="utf-8"), re.M)) for f in folder.glob("*.yaml")}
    assert len(found) >= 2
    assert all(names == set(intents.ALL_INTENTS) for names in found.values()), found
