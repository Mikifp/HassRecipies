"""Ingredients as data: items with ids, a note and alternatives, and steps that link by id."""

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


class _Bus:
    def async_fire(self, name, data=None):
        pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)

pkg = types.ModuleType("hr_i")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_i"] = pkg
store_mod = importlib.import_module("hr_i.store")
ing = importlib.import_module("hr_i.ingredients")


def _make(saved=None):
    _Store.saved = saved
    store = store_mod.RecipeStore(types.SimpleNamespace(bus=_Bus()))
    asyncio.run(store.async_load())
    return store


def _ids(recipe):
    return [i["id"] for i in recipe["ingredient_items"]]


def _linked(recipe, step=0):
    """The raw text of the ingredients a step links to."""
    by_id = {i["id"]: i["raw"] for i in recipe["ingredient_items"]}
    return [by_id[i] for i in recipe["instructions"][step]["ingredient_ids"]]


LINES = ["## Dough", "200 g butter || 180 g coconut oil // room temperature", "3 dl flour", "1 tsk salt"]


def test_typed_lines_become_items_with_a_note_alternatives_and_the_parsed_amount():
    store = _make()
    r = store.create({"name": "Cake", "ingredients": LINES})
    header, butter, flour, salt = r["ingredient_items"]
    assert header["header"] and header["raw"] == "Dough"
    assert (butter["raw"], butter["comment"], butter["alternatives"]) == ("200 g butter", "room temperature", ["180 g coconut oil"])
    assert (butter["quantity"], butter["unit"], butter["food"], butter["grams"]) == (200.0, "g", "butter", 200.0)
    assert butter["substitutes"][0]["food"] == "coconut oil"  # the alternative is understood too
    assert len({i["id"] for i in r["ingredient_items"]}) == 4 and all(i["id"] for i in r["ingredient_items"])
    # what still reads strings gets the typed lines back, and the parsed form is the item itself
    assert r["ingredients"] == LINES and r["parsed_ingredients"] == r["ingredient_items"]


def test_a_step_links_to_an_ingredient_by_id_and_the_old_index_follows_it():
    store = _make()
    r = store.create({"name": "Cake", "ingredients": LINES, "instructions": [{"text": "Mix", "ingredients": [1, 2]}, "Bake"]})
    assert _linked(r) == ["200 g butter", "3 dl flour"] and r["instructions"][0]["ingredients"] == [1, 2]
    before = _ids(r)
    # a client that sends the lines in another order (indexes of the steps untouched): the links stay with the ingredients
    again = store.update(r["id"], {"ingredients": [LINES[0], LINES[2], LINES[1], LINES[3]]})
    assert _linked(again) == ["200 g butter", "3 dl flour"]
    assert again["instructions"][0]["ingredients"] == [1, 2]  # butter is at 2 and flour at 1 now, sorted
    assert _ids(again)[1:3] == [before[2], before[1]]  # flour and butter swapped, with their ids


def test_reordering_the_items_keeps_the_links_without_rewriting_them():
    store = _make()
    r = store.create({"name": "Cake", "ingredient_items": [{"raw": "1 egg"}, {"raw": "2 dl milk"}, {"raw": "salt", "comment": "a pinch"}]})
    egg, milk, salt = r["ingredient_items"]
    r = store.update(r["id"], {"instructions": [{"text": "Whisk", "ingredient_ids": [egg["id"], salt["id"]]}]})
    assert r["instructions"][0]["ingredients"] == [0, 2]
    moved = [dict(salt), dict(egg), dict(milk)]  # what a client sends back after dragging salt to the top
    r = store.update(r["id"], {"ingredient_items": moved})
    assert _linked(r) == ["1 egg", "salt"] and r["instructions"][0]["ingredients"] == [0, 1]  # the same ids, new places (salt is first now)
    assert _ids(r) == [salt["id"], egg["id"], milk["id"]]
    assert r["ingredients"][0] == "salt // a pinch"


def test_removing_an_ingredient_drops_its_links_and_a_new_one_gets_a_new_id():
    store = _make()
    r = store.create({"name": "Cake", "ingredients": ["1 egg", "2 dl milk"], "instructions": [{"text": "Mix", "ingredients": [0, 1]}]})
    egg, milk = r["ingredient_items"]
    r = store.update(r["id"], {"ingredient_items": [dict(milk), {"raw": "3 dl cream"}]})
    assert _linked(r) == ["2 dl milk"]
    assert egg["id"] not in _ids(r) and _ids(r)[0] == milk["id"] and _ids(r)[1] not in (egg["id"], milk["id"])


def test_an_id_that_is_taken_or_missing_is_made_again():
    store = _make()
    r = store.create({"name": "Cake", "ingredient_items": [{"id": "a", "raw": "1 egg"}, {"id": "a", "raw": "2 dl milk"}, {"raw": "salt"}]})
    ids = _ids(r)
    assert ids[0] == "a" and len(set(ids)) == 3 and all(ids)


def test_a_recipe_saved_before_ingredients_had_ids_is_converted_when_it_is_read():
    old = {
        "recipes": {
            "r1": {
                "id": "r1", "name": "Old", "ingredients": ["1 egg", "2 dl milk"],
                "instructions": [{"text": "Mix", "ingredients": [1], "timer": None}, "Bake"],
                "parsed_ingredients": [{"stale": True}, {"stale": True}],
            }
        }
    }
    store = _make(old)
    r = store.get("r1")
    assert [i["raw"] for i in r["ingredient_items"]] == ["1 egg", "2 dl milk"] and _linked(r) == ["2 dl milk"]
    assert r["ingredient_items"][0]["quantity"] == 1.0 and "stale" not in r["parsed_ingredients"][0]
    # kept, so the ids stay when it is saved and read again
    store.update("r1", {"notes": "x"})
    again = _make(_Store.saved).get("r1")
    assert _ids(again) == _ids(r) and _linked(again) == ["2 dl milk"]


def test_what_is_stored_is_the_items_and_the_links_and_the_parsed_form_is_not_stored_twice():
    store = _make()
    r = store.create({"name": "Cake", "ingredients": ["1 egg"], "instructions": [{"text": "Mix", "ingredients": [0]}]})
    saved = _Store.saved["recipes"][r["id"]]
    assert "parsed_ingredients" not in saved
    assert saved["ingredient_items"][0]["id"] == r["ingredient_items"][0]["id"]
    assert saved["instructions"][0]["ingredient_ids"] == [r["ingredient_items"][0]["id"]]
    exported = store.export()["recipes"][0]
    assert "parsed_ingredients" not in exported and exported["ingredients"] == ["1 egg"]  # still readable by older versions


def test_the_typed_lines_roundtrip_through_an_item():
    for line in ("200 g butter", "200 g butter // room temperature", "200 g butter || 180 g oil || 3 dl cream", "200 g butter || 180 g oil // soft", "## Sauce"):
        item = ing.structured(ing.split_line(line))
        assert ing.compose_line(item) == line
    assert ing.split_line("2 dl milk")["alternatives"] == [] and ing.split_line("## Sauce") == {"header": True, "raw": "Sauce", "comment": "", "alternatives": []}
    # separators typed inside a part cannot break the structure
    item = ing.structured({"raw": "a || b // c", "alternatives": ["x // y"]})
    assert "||" not in item["raw"] and "//" not in item["raw"] and "//" not in item["alternatives"][0]


def test_steps_given_as_plain_text_or_sections_have_no_links():
    store = _make()
    r = store.create({"name": "X", "ingredients": ["1 egg"], "instructions": ["Plain", {"text": "Part", "section": True}, {"text": "Mix", "ingredient_ids": ["nope", "also-nope"]}]})
    assert [s["ingredient_ids"] for s in r["instructions"]] == [[], [], []]
    assert [s["section"] for s in r["instructions"]] == [False, True, False]
