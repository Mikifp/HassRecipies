"""Words put together in Python follow Home Assistant's language."""

import asyncio
import importlib
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).parents[1] / "custom_components/hass_recipes"


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


class _Store:
    def __init__(self, *a, **k):
        pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)
pkg = types.ModuleType("hr_loc")
pkg.__path__ = [str(ROOT)]
sys.modules["hr_loc"] = pkg
loc = importlib.import_module("hr_loc.localize")
store = importlib.import_module("hr_loc.store")


def test_language_codes_map_to_a_table_and_unknown_ones_to_english():
    assert loc.base_language("da") == "da" and loc.base_language("da-DK") == "da"
    assert loc.base_language("nb_NO") == "nb" and loc.base_language("no") == "nb"
    assert loc.base_language("de-AT") == "de"
    assert loc.base_language("xx") == "en" and loc.base_language(None) == "en"


def test_timer_labels_use_the_users_words():
    assert loc.step_label("en", "Roast", 2) == "Roast · step 2"
    assert loc.step_label("da", "Stegt and", 2) == "Stegt and · trin 2"
    assert loc.step_label("de", "Braten", 3, name="ruhen") == "Braten · Schritt 3 · ruhen"
    assert loc.step_label("fr", "Rôti", 1, timer_n=2) == "Rôti · étape 1 · minuteur 2"


def test_meal_names_and_alerts():
    assert loc.slot_name("da", "dinner") == "Aftensmad"
    assert loc.slot_name("sv", "breakfast") == "Frukost"
    assert loc.slot_name("en", "snack") == "Snack"
    assert loc.words("da")["timer_finished"] == "Timer færdig"
    assert loc.words("it")["timer_finished"] == "Timer terminato"


def test_every_language_has_every_word():
    keys = set(loc._WORDS["en"])
    for code, table in loc._WORDS.items():
        assert set(table) == keys, code
        assert set(table["slots"]) == {"breakfast", "lunch", "dinner", "dessert", "snack"}, code


def test_step_timer_specs_follow_the_language():
    specs = store.step_timer_specs(
        "r1", "Steg", 2, 1, [{"seconds": 60, "label": ""}, {"seconds": 30, "label": ""}], language="da"
    )
    assert [s[1] for s in specs] == ["Steg · trin 2 · timer 1", "Steg · trin 2 · timer 2"]


def test_entity_and_device_names_are_translated_for_every_translation_file():
    strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))
    da = json.loads((ROOT / "translations/da.json").read_text(encoding="utf-8"))
    assert strings["device"]["timers"]["name"] and da["device"]["timers"]["name"]
    for domain, names in strings["entity"].items():
        for key in names:
            assert da["entity"][domain][key]["name"], (domain, key)
    # the code asks for exactly these keys
    code = "".join((ROOT / f).read_text(encoding="utf-8") for f in ("button.py", "sensor.py", "select.py", "binary_sensor.py", "calendar.py"))
    for domain, names in strings["entity"].items():
        for key in names:
            assert f'"{key}"' in code, key
