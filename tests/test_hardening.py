"""Trash and undo, summaries, who may edit, copying a week, and summed shopping lists."""

import asyncio
from datetime import UTC, datetime, timedelta
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
    def __init__(self):
        self.events = []

    def async_fire(self, name, data=None):
        self.events.append((name, data))


class HomeAssistantError(Exception):
    pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)
_stub("homeassistant.exceptions", HomeAssistantError=HomeAssistantError, ServiceValidationError=HomeAssistantError)

pkg = types.ModuleType("hr_h")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_h"] = pkg
store_mod = importlib.import_module("hr_h.store")
plan_mod = importlib.import_module("hr_h.mealplan")
shop = importlib.import_module("hr_h.shopping")
access = importlib.import_module("hr_h.access")


def _make():
    _Store.saved = None
    hass = types.SimpleNamespace(bus=_Bus(), data={})
    recipes = store_mod.RecipeStore(hass)
    asyncio.run(recipes.async_load())
    plan = plan_mod.MealPlan(hass, recipes)
    asyncio.run(plan.async_load())
    return hass, recipes, plan


# ---- trash ----
def test_a_deleted_recipe_can_be_restored_with_everything():
    hass, store, _plan = _make()
    recipe = store.create({"name": "Soup", "ingredients": ["2 eggs"], "instructions": [{"text": "Boil", "timers": [{"seconds": 60}]}]})
    assert store.delete(recipe["id"]) is True
    assert store.get(recipe["id"]) is None
    assert [t["name"] for t in store.trash()] == ["Soup"]
    back = store.restore(recipe["id"])
    assert back["id"] == recipe["id"] and back["name"] == "Soup"
    assert store.get(recipe["id"])["instructions"][0]["timers"][0]["seconds"] == 60
    assert store.trash() == []
    assert store.restore("nope") is None


def test_bulk_delete_goes_to_the_trash_and_purge_removes_for_good():
    _hass, store, _plan = _make()
    ids = [store.create({"name": f"R{i}"})["id"] for i in range(3)]
    assert store.bulk_delete(ids[:2]) == 2
    assert len(store.trash()) == 2
    assert store.purge_trash(ids[0]) == 1 and len(store.trash()) == 1
    assert store.purge_trash() == 1 and store.trash() == []


def test_the_trash_is_kept_for_thirty_days_and_capped():
    hass, store, _plan = _make()
    old = store.create({"name": "Old"})
    store.delete(old["id"])
    store._trash[0]["deleted_at"] = (datetime.now(UTC) - timedelta(days=31)).isoformat()
    store._save()
    again = store_mod.RecipeStore(hass)
    asyncio.run(again.async_load())
    assert again.trash() == []  # too old: gone on load
    for i in range(store_mod.TRASH_MAX + 5):
        r = again.create({"name": f"n{i}"})
        again.delete(r["id"])
    assert len(again.trash()) == store_mod.TRASH_MAX


def test_a_restored_recipe_gets_a_new_id_if_its_id_was_taken():
    _hass, store, _plan = _make()
    r = store.create({"name": "A"})
    store.delete(r["id"])
    store._recipes[r["id"]] = {"id": r["id"], "name": "Impostor", "ingredients": [], "instructions": []}
    back = store.restore(r["id"])
    assert back["id"] != r["id"] and back["name"] == "A"


# ---- summaries ----
def test_summaries_leave_out_the_steps():
    _hass, store, _plan = _make()
    store.create({"name": "Soup", "ingredients": ["1 onion"], "instructions": ["Boil"], "tags": ["quick"]})
    s = store.summaries()[0]
    assert s["name"] == "Soup" and s["tags"] == ["quick"] and s["ingredients"] == ["1 onion"]
    assert "instructions" not in s and "parsed_ingredients" not in s and "notes" not in s


# ---- permissions ----
def _entry_hass(option):
    entry = types.SimpleNamespace(options={"edit_access": option} if option else {})
    return types.SimpleNamespace(data={"hass_recipes_entry": entry})


def test_everyone_may_edit_unless_restricted_to_administrators():
    user, admin = types.SimpleNamespace(is_admin=False), types.SimpleNamespace(is_admin=True)
    assert access.can_edit(_entry_hass(None), user) is True
    assert access.can_edit(_entry_hass("everyone"), user) is True
    restricted = _entry_hass("admins")
    assert access.can_edit(restricted, user) is False
    assert access.can_edit(restricted, None) is False
    assert access.can_edit(restricted, admin) is True


# ---- copying a week ----
def test_copy_a_week_onto_the_next_without_duplicating():
    _hass, recipes, plan = _make()
    soup = recipes.create({"name": "Soup"})
    plan.add("2026-10-05", "dinner", recipe_id=soup["id"], scale=2)
    plan.add("2026-10-07", "lunch", title="Leftovers", note="cold")
    assert plan.copy("2026-10-05", "2026-10-12") == {"added": 2, "removed": 0}
    got = plan.list("2026-10-12", "2026-10-18")
    assert [(e["date"], e["slot"], e["title"]) for e in got] == [
        ("2026-10-12", "dinner", "Soup"),
        ("2026-10-14", "lunch", "Leftovers"),
    ]
    assert got[0]["scale"] == 2.0 and got[1]["note"] == "cold" and got[0]["recipe_id"] == soup["id"]
    assert plan.copy("2026-10-05", "2026-10-12") == {"added": 0, "removed": 0}  # nothing twice


def test_copy_can_replace_the_target_days():
    _hass, _recipes, plan = _make()
    plan.add("2026-10-05", "dinner", title="A")
    plan.add("2026-10-12", "dinner", title="Old")
    assert plan.copy("2026-10-05", "2026-10-12", replace=True) == {"added": 1, "removed": 1}
    assert [e["title"] for e in plan.list("2026-10-12", "2026-10-12")] == ["A"]
    try:
        plan.copy("2026-10-05", "2026-10-05")
    except plan_mod.MealPlanError:
        pass
    else:
        raise AssertionError("copying onto itself should be refused")


# ---- shopping list: amounts are added together ----
def test_the_same_ingredient_is_summed_across_meals():
    _hass, recipes, plan = _make()
    a = recipes.create({"name": "Pancakes", "ingredients": ["200 g flour", "2 eggs", "3 dl milk", "salt"]})
    b = recipes.create({"name": "Bread", "ingredients": ["500 g flour", "1 egg", "1 dl milk", "salt"]})
    entries = [
        {"recipe_id": a["id"], "scale": None},
        {"recipe_id": b["id"], "scale": 2},
        {"recipe_id": None, "title": "Leftovers"},
    ]
    lines, count = shop.aggregate_plan_items(recipes, entries, "grams")
    joined = " | ".join(lines)
    assert count == 2
    assert any(l.endswith("flour") and l.startswith("1200 g") for l in lines), joined  # 200 + 2 * 500
    assert sum(1 for l in lines if l.endswith("salt")) == 1  # one salt line, not two
    assert any("eggs" in l or "egg" in l for l in lines)


def test_without_grams_the_same_unit_is_summed():
    _hass, recipes, _plan = _make()
    a = recipes.create({"name": "A", "ingredients": ["2 tsk salt", "1 løg"]})
    b = recipes.create({"name": "B", "ingredients": ["3 tsk salt", "2 løg"]})
    lines, _ = shop.aggregate_plan_items(
        recipes, [{"recipe_id": a["id"]}, {"recipe_id": b["id"]}], "original"
    )
    assert any(l.startswith("5 tsk") for l in lines), lines
    assert any(l.startswith("3 ") and l.endswith("løg") for l in lines), lines
