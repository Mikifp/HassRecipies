"""The meal plan store: ordering, validation, and what happens when a recipe goes away."""

import asyncio
from datetime import date
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


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)

pkg = types.ModuleType("hr_m")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_m"] = pkg
store_mod = importlib.import_module("hr_m.store")
plan_mod = importlib.import_module("hr_m.mealplan")


def _make():
    _Store.saved = None
    hass = types.SimpleNamespace(bus=_Bus())
    recipes = store_mod.RecipeStore(hass)
    asyncio.run(recipes.async_load())
    plan = plan_mod.MealPlan(hass, recipes)
    asyncio.run(plan.async_load())
    return hass, recipes, plan


def test_entries_come_back_in_day_then_slot_order():
    _hass, recipes, plan = _make()
    soup = recipes.create({"name": "Soup"})
    plan.add("2026-10-12", "dinner", recipe_id=soup["id"])
    plan.add("2026-10-11", "dinner", title="Takeaway")
    plan.add("2026-10-12", "breakfast", title="Porridge")
    plan.add("2026-10-20", "lunch", title="Outside the range")
    got = plan.list("2026-10-11", "2026-10-12")
    assert [(e["date"], e["slot"], e["title"]) for e in got] == [
        ("2026-10-11", "dinner", "Takeaway"),
        ("2026-10-12", "breakfast", "Porridge"),
        ("2026-10-12", "dinner", "Soup"),
    ]


def test_dessert_is_its_own_meal_between_dinner_and_snack():
    _hass, _recipes, plan = _make()
    plan.add("2026-10-12", "snack", title="Fruit")
    plan.add("2026-10-12", "dessert", title="Ice cream")
    plan.add("2026-10-12", "dinner", title="Roast")
    assert [e["slot"] for e in plan.list("2026-10-12", "2026-10-12")] == ["dinner", "dessert", "snack"]


def test_bad_input_is_rejected():
    _hass, recipes, plan = _make()
    for call in (
        lambda: plan.add("not-a-date", "dinner", title="x"),
        lambda: plan.add("2026-10-11", "brunch", title="x"),
        lambda: plan.add("2026-10-11", "dinner"),
        lambda: plan.add("2026-10-11", "dinner", recipe_id="missing"),
        lambda: plan.list("2026-01-01", "2028-01-01"),
    ):
        try:
            call()
        except plan_mod.MealPlanError:
            continue
        raise AssertionError("expected MealPlanError")


def test_a_recipe_keeps_its_live_name_and_a_deleted_one_keeps_its_title():
    hass, recipes, plan = _make()
    recipe = recipes.create({"name": "Soup"})
    entry = plan.add("2026-10-11", "dinner", recipe_id=recipe["id"], scale=2)
    recipes.update(recipe["id"], {"name": "Tomato soup"})
    assert plan.get(entry["id"])["title"] == "Tomato soup"
    assert plan.get(entry["id"])["recipe_exists"] is True
    recipes.delete(recipe["id"])
    assert plan.detach_recipe(recipe["id"]) == 1
    after = plan.get(entry["id"])
    assert after["recipe_exists"] is False and after["scale"] == 2.0
    assert after["title"] == "Soup"  # the name when it was planned


def test_update_move_clear_and_events():
    hass, _recipes, plan = _make()
    a = plan.add("2026-10-11", "dinner", title="A")
    plan.add("2026-10-11", "lunch", title="B")
    moved = plan.update(a["id"], date="2026-10-13", slot="lunch", note=" late ")
    assert (moved["date"], moved["slot"], moved["note"]) == ("2026-10-13", "lunch", "late")
    assert plan.update("nope", note="x") is None
    assert plan.clear("2026-10-11", slot="lunch") == 1
    assert plan.clear("2026-10-01", "2026-10-31") == 1
    assert plan.delete(a["id"]) is False
    names = {n for n, _ in hass.bus.events}
    assert names == {"hass_recipes_meal_plan_changed"}
    assert _Store.saved["entries"] == []


def test_week_runs_monday_to_sunday():
    _hass, _recipes, plan = _make()
    first, last = plan.week("2026-10-14")  # a Wednesday
    assert (first, last) == (date(2026, 10, 12), date(2026, 10, 18))


def _meal(**kw):
    return {"time": "12:00", "color": "blue", **kw}


def test_the_meals_of_the_day_can_be_defined():
    _hass, _recipes, plan = _make()
    assert plan.slots() == ("breakfast", "lunch", "dinner", "dessert", "snack")
    # rename a built-in one, add one of your own, drop two, and put them in a new order
    got = plan.set_meals(
        [
            _meal(id="dinner", name="Supper", color="red", time="18:30", words=["Aftensmad ", "aftensmad", "main"]),
            _meal(name="Elevenses", color="teal", time="11:00", minutes=20, words=["tea"]),
            _meal(id="breakfast", time="07:00"),
        ]
    )
    assert [m["name"] for m in got] == ["Supper", "Elevenses", ""]
    assert got[0]["words"] == ["aftensmad", "main"] and got[0]["time"] == "18:30"
    new_id = got[1]["id"]
    assert plan.slots() == ("dinner", new_id, "breakfast")
    plan.add("2026-10-12", new_id, title="Biscuits")
    plan.add("2026-10-12", "breakfast", title="Porridge")
    plan.add("2026-10-12", "dinner", title="Roast")
    assert [e["title"] for e in plan.list("2026-10-12", "2026-10-12")] == ["Roast", "Biscuits", "Porridge"]
    assert plan.meal_name("da", "dinner") == "Supper" and plan.meal_name("da", "breakfast") == "Morgenmad"
    # the choice is saved with the plan and comes back
    assert [m["id"] for m in _Store.saved["meals"]] == ["dinner", new_id, "breakfast"]


def test_meals_in_use_cannot_be_removed_and_bad_meals_are_rejected():
    _hass, _recipes, plan = _make()
    plan.add("2026-10-12", "lunch", title="Soup")
    keep = [_meal(id=m["id"]) for m in plan.meals() if m["id"] != "lunch"]
    for bad in (
        keep,  # lunch still has a meal planned in it
        [],
        [_meal(time="25:00", id="dinner")],
        [_meal(time="noon", id="dinner")],
        [_meal(color="mauve", id="dinner")],
        [_meal(name="", id="mine")],  # a new meal needs a name
        [_meal(id="dinner"), _meal(id="dinner")],
    ):
        try:
            plan.set_meals(bad)
        except plan_mod.MealPlanError:
            continue
        raise AssertionError(f"accepted {bad}")
    assert len(plan.meals()) == 5
    plan.clear("2026-10-12")
    assert len(plan.set_meals(keep)) == 4
    try:
        plan.add("2026-10-12", "lunch", title="Soup")
    except plan_mod.MealPlanError:
        return
    raise AssertionError("a removed meal was accepted")
