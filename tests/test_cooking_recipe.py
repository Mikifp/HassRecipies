"""The shared cooking state (recipe, page and scale) is stored server-side and survives deletes."""

import asyncio
import importlib
from pathlib import Path
import sys
import types


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


class _Store:
    saved = None

    def __init__(self, *a, **k):
        pass

    async def async_load(self):
        return _Store.saved

    def async_delay_save(self, fn, delay=0):
        _Store.saved = fn()


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)

pkg = types.ModuleType("hr_c")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_c"] = pkg
store_mod = importlib.import_module("hr_c.store")


class _Bus:
    def __init__(self):
        self.events = []

    def async_fire(self, name, data=None):
        self.events.append((name, data))


def _make():
    _Store.saved = None
    hass = types.SimpleNamespace(bus=_Bus())
    store = store_mod.RecipeStore(hass)
    asyncio.run(store.async_load())
    return hass, store


def test_choose_clear_and_reject_unknown():
    hass, store = _make()
    recipe = store.create({"name": "Lasagne"})
    assert store.cooking_recipe_id is None
    assert store.set_cooking_recipe("nope") is False
    assert store.set_cooking_recipe(recipe["id"]) is True
    assert store.cooking_recipe_id == recipe["id"]
    name, data = hass.bus.events[-1]
    assert name == "hass_recipes_cooking_recipe_changed"
    assert data == {"recipe_id": recipe["id"], "step": 0, "scale": 1.0, "recipe_changed": True}
    assert store.set_cooking_recipe(None) is True and store.cooking_recipe_id is None


def test_choice_is_persisted_and_cleared_when_the_recipe_is_deleted():
    hass, store = _make()
    recipe = store.create({"name": "Lasagne"})
    store.set_cooking_recipe(recipe["id"])
    assert _Store.saved["cooking_recipe_id"] == recipe["id"]

    again = store_mod.RecipeStore(hass)
    asyncio.run(again.async_load())
    assert again.cooking_recipe_id == recipe["id"]

    assert again.delete(recipe["id"]) is True
    assert again.cooking_recipe_id is None
    assert _Store.saved["cooking_recipe_id"] is None


def _recipe(store):
    return store.create(
        {
            "name": "Pancakes",
            "default_scale": 2,
            "ingredients": ["## Batter", "2 eggs", "250 g flour"],
            "instructions": [
                {"text": "Mix", "section": False, "ingredients": [1, 2]},
                {"text": "Rest", "section": True},
                {"text": "Fry", "timer": 120},
            ],
        }
    )


def test_pages_start_with_ingredients_and_skip_section_headings():
    _hass, store = _make()
    pages = store_mod.cooking_pages(_recipe(store))
    assert [p["kind"] for p in pages] == ["ingredients", "step", "step"]
    assert [p.get("text") for p in pages[1:]] == ["Mix", "Fry"]
    assert pages[2]["timer"] == 120


def test_choosing_starts_at_first_page_and_the_recipes_default_scale():
    _hass, store = _make()
    recipe = _recipe(store)
    store.set_cooking(recipe["id"])
    assert store.cooking_state() == {"recipe_id": recipe["id"], "step": 0, "scale": 2.0, "pages": 3}


def test_step_moves_are_clamped_and_scale_is_kept():
    hass, store = _make()
    recipe = _recipe(store)
    store.set_cooking(recipe["id"], scale=3)
    store.set_cooking(delta=1)
    store.set_cooking(delta=5)  # past the end
    assert store.cooking_step == 2 and store.cooking_scale == 3.0
    store.set_cooking(delta=-9)  # before the start
    assert store.cooking_step == 0
    store.set_cooking(step=2)
    assert store.cooking_step == 2
    last = hass.bus.events[-1]
    assert last[0] == "hass_recipes_cooking_recipe_changed" and last[1]["step"] == 2


def test_state_survives_a_reload_and_clears_with_the_recipe():
    hass, store = _make()
    recipe = _recipe(store)
    store.set_cooking(recipe["id"], step=1, scale=1.5)
    again = store_mod.RecipeStore(hass)
    asyncio.run(again.async_load())
    assert (again.cooking_step, again.cooking_scale) == (1, 1.5)
    again.delete(recipe["id"])
    assert again.cooking_state()["recipe_id"] is None and again.cooking_step == 0


def test_a_step_can_carry_any_number_of_timers():
    step = store_mod.normalize_step(
        {"text": "Roast", "timers": [{"seconds": 1800, "label": "roast"}, {"seconds": 600, "label": "rest"}, 45]}
    )
    assert step["timer"] == 1800  # the first, for older clients
    assert [(t["seconds"], t["label"]) for t in step["timers"]] == [(1800, "roast"), (600, "rest"), (45, "")]


def test_the_older_single_timer_still_works():
    step = store_mod.normalize_step({"text": "Simmer", "timer": 300})
    assert step["timers"] == [{"seconds": 300, "label": ""}] and step["timer"] == 300
    assert store_mod.normalize_step("plain text")["timers"] == []
    assert store_mod.normalize_step({"text": "x", "timers": [{"seconds": 0}, {"seconds": -5}, "bad"]})["timers"] == []


def test_timer_keys_keep_the_old_key_for_the_first_timer():
    specs = store_mod.step_timer_specs(
        "abc", "Roast", 2, 3, [{"seconds": 1800, "label": "roast"}, {"seconds": 600, "label": ""}, {"seconds": 60, "label": ""}]
    )
    assert specs == [
        ("abc:3", "Roast · step 2 · roast", 1800),
        ("abc:3:1", "Roast · step 2 · timer 2", 600),
        ("abc:3:2", "Roast · step 2 · timer 3", 60),
    ]
    single = store_mod.step_timer_specs("abc", "Roast", 2, 3, [{"seconds": 60, "label": ""}])
    assert single == [("abc:3", "Roast · step 2", 60)]  # unchanged for one timer


def test_stored_steps_and_pages_carry_all_timers():
    _hass, store = _make()
    recipe = store.create(
        {
            "name": "Roast",
            "instructions": [{"text": "Roast", "timers": [{"seconds": 1800, "label": "roast"}, {"seconds": 600}]}],
        }
    )
    assert len(recipe["instructions"][0]["timers"]) == 2
    pages = store_mod.cooking_pages(recipe)
    assert [t["seconds"] for t in pages[-1]["timers"]] == [1800, 600] and pages[-1]["timer"] == 1800
