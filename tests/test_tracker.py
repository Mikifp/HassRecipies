"""The calorie tracker: persons, entries that keep the nutrition they were logged with, days, ranges,
the meal plan and recent items (no Home Assistant needed)."""

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
    data: dict = {}

    def __init__(self, _hass, _version, key):
        self.key = key

    async def async_load(self):
        return _Store.data.get(self.key)

    def async_delay_save(self, fn, delay=0):
        _Store.data[self.key] = fn()


class _Bus:
    def __init__(self):
        self.events = []

    def async_fire(self, name, data=None):
        self.events.append((name, data))


class _HAError(Exception):
    pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)
_stub("homeassistant.exceptions", HomeAssistantError=_HAError, ServiceValidationError=_HAError)

pkg = types.ModuleType("hr_t")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_t"] = pkg
store_mod = importlib.import_module("hr_t.store")
plan_mod = importlib.import_module("hr_t.mealplan")
nu = importlib.import_module("hr_t.nutrition")
ns = importlib.import_module("hr_t.nutrition_store")
tr = importlib.import_module("hr_t.tracker")

DB = nu.FoodDatabase.load()
DAY = "2026-10-29"


def _make():
    _Store.data = {}
    hass = types.SimpleNamespace(bus=_Bus(), data={})
    recipes = store_mod.RecipeStore(hass)
    asyncio.run(recipes.async_load())
    plan = plan_mod.MealPlan(hass, recipes)
    asyncio.run(plan.async_load())
    nutrition = ns.Nutrition(hass, recipes, DB)
    asyncio.run(nutrition.async_load())
    tracker = tr.Tracker(hass, nutrition, plan)
    asyncio.run(tracker.async_load())
    return hass, recipes, plan, nutrition, tracker


def _raises(fn):
    try:
        fn()
    except tr.TrackerError:
        return True
    return False


def _food(nutrition, name="Havregryn", kcal=370, **extra):
    return nutrition.save_food({"name": name, "source": "custom", "values": {"kcal": kcal, "protein": 13, "carbs": 60, "fat": 7}, **extra})


def test_a_person_is_made_once_for_a_user_and_one_by_name():
    *_, t = _make()
    anna = t.ensure_user("u1", "Anna")
    assert t.ensure_user("u1", "Anna Changed")["id"] == anna["id"] and len(t.persons()) == 1
    mikkel = t.add_person("  Mikkel ")
    assert mikkel["name"] == "Mikkel" and mikkel["user_id"] is None
    assert _raises(lambda: t.add_person("mikkel")) and _raises(lambda: t.add_person(" "))


def test_a_food_is_logged_in_grams_or_a_unit_with_its_nutrition_kept():
    _h, _r, _p, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    oats = _food(n, unit_grams={"dl": 40})
    e = t.add(anna["id"], DAY, "breakfast", "food", food_id=oats["id"], amount=60, unit="g")
    assert (e["name"], e["grams"], e["kcal"], e["protein"]) == ("Havregryn", 60, 222, 7.8)
    e2 = t.add(anna["id"], DAY, "breakfast", "food", food_id=oats["id"], amount=2, unit="dl")
    assert e2["grams"] == 80 and e2["kcal"] == 296
    assert _raises(lambda: t.add(anna["id"], DAY, "breakfast", "food", food_id=oats["id"], amount=1, unit="spsk"))
    # a snapshot: changing the food later leaves the logged day as it was
    n.save_food({"values": {"kcal": 100}}, oats["id"])
    assert t.entry(e["id"])["kcal"] == 222


def test_a_recipe_is_logged_by_servings_and_a_quick_entry_by_its_energy():
    _h, recipes, _p, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    oats = _food(n)
    r = recipes.create({"name": "Grød", "servings": "2", "ingredients": ["100 g havregryn"]})
    n.link_to_food("havregryn", oats["id"])
    one = t.add(anna["id"], DAY, "breakfast", "recipe", recipe_id=r["id"])
    assert one["name"] == "Grød" and one["kcal"] == 185  # 370 kcal for the recipe, 2 servings
    assert t.add(anna["id"], DAY, "breakfast", "recipe", recipe_id=r["id"], servings=3)["kcal"] == 555
    q = t.add(anna["id"], DAY, "snack", "quick", name="Kage", kcal=300, fat=12)
    assert (q["kcal"], q["fat"], q["protein"]) == (300, 12, None)
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "quick", name="Kage"))
    assert _raises(lambda: t.add(anna["id"], DAY, "brunchish", "quick", name="x", kcal=1))
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "food", food_id="nope", amount=1))
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "quick", name="x", kcal=-5))


def test_a_recipe_can_be_logged_by_what_it_makes_or_by_weight():
    _h, recipes, _p, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    oats = _food(n)
    r = recipes.create({"name": "Boller", "servings": "4", "yield_amount": 24, "yield_unit": "boller", "ingredients": ["600 g havregryn"]})
    n.link_to_food("havregryn", oats["id"])  # 600 g of 370 kcal / 100 g = 2220 kcal in all
    two = t.add(anna["id"], DAY, "snack", "recipe", recipe_id=r["id"], by="yield", amount=2)
    assert (two["kcal"], two["by"], two["amount"], two["unit"]) == (185, "yield", 2, "boller")  # 2 of 24
    grams = t.add(anna["id"], DAY, "dinner", "recipe", recipe_id=r["id"], by="grams", amount=150)
    assert grams["kcal"] == 555 and "unit" not in grams  # 150 of the 600 g
    servings = t.add(anna["id"], DAY, "dinner", "recipe", recipe_id=r["id"], by="servings", amount=1)
    assert servings["kcal"] == 555  # 1 of 4
    assert t.update(grams["id"], amount=300)["kcal"] == 1110
    assert t.update(grams["id"], by="yield", amount=12)["kcal"] == 1110
    assert t.update(servings["id"], servings=2)["kcal"] == 1110
    plain = recipes.create({"name": "Plain", "ingredients": ["100 g havregryn"]})
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "recipe", recipe_id=plain["id"], by="yield", amount=1))
    nothing = recipes.create({"name": "Nothing", "ingredients": ["noget ukendt"]})
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "recipe", recipe_id=nothing["id"], by="grams", amount=100))
    assert _raises(lambda: t.add(anna["id"], DAY, "snack", "recipe", recipe_id=r["id"], by="nope", amount=1))
    basis = n.recipe_basis(r["id"])
    assert (basis["yield_amount"], basis["yield_unit"], basis["grams"], basis["servings"]) == (24, "boller", 600, 4)
    # the same amount of the same recipe is one recent item, a different way to measure is another
    assert len({(x["by"], x["amount"]) for x in t.recent(anna["id"]) if x.get("recipe_id")}) >= 3


def test_a_day_has_totals_against_the_goal_and_entries_can_be_changed_and_removed():
    _h, _r, _p, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    assert t.set_goals(anna["id"], {"kcal": "1900", "protein": 95, "fat": ""})["goals"] == {"kcal": 1900, "protein": 95}
    a = t.add(anna["id"], DAY, "lunch", "quick", name="Suppe", kcal=250, protein=10)
    t.add(anna["id"], DAY, "breakfast", "quick", name="Kaffe", kcal=50)
    day = t.day(anna["id"], DAY)
    assert [e["name"] for e in day["entries"]] == ["Kaffe", "Suppe"]  # in the order of the meals
    assert day["totals"] == {"kcal": 300, "protein": 10, "carbs": 0, "fat": 0}
    t.update(a["id"], kcal=400, meal="dinner")
    assert t.entry(a["id"])["meal"] == "dinner" and t.day(anna["id"], DAY)["totals"]["kcal"] == 450
    assert t.today_totals(anna["id"], __import__("datetime").date(2026, 10, 29))["remaining"] == 1450
    assert t.delete(a["id"]) and not t.delete(a["id"])
    assert t.day(anna["id"], DAY)["totals"]["kcal"] == 50


def test_each_person_has_their_own_log_and_deleting_a_person_deletes_it():
    *_, t = _make()
    anna = t.ensure_user("u1", "Anna")
    mikkel = t.add_person("Mikkel")
    t.add(anna["id"], DAY, "lunch", "quick", name="A", kcal=100)
    t.add(mikkel["id"], DAY, "lunch", "quick", name="M", kcal=500)
    assert t.day(anna["id"], DAY)["totals"]["kcal"] == 100 and t.day(mikkel["id"], DAY)["totals"]["kcal"] == 500
    assert t.delete_person(mikkel["id"]) is True
    assert not t.delete_person(mikkel["id"]) and [p["name"] for p in t.persons()] == ["Anna"]
    assert t.day(anna["id"], DAY)["totals"]["kcal"] == 100 and not [e for e in t._entries.values() if e["person_id"] == mikkel["id"]]


def test_a_range_gives_each_day_and_averages_the_days_that_were_logged():
    *_, t = _make()
    anna = t.ensure_user("u1", "Anna")
    t.add(anna["id"], "2026-10-26", "lunch", "quick", name="A", kcal=1800)
    t.add(anna["id"], "2026-10-28", "lunch", "quick", name="B", kcal=2000, protein=100)
    r = t.range(anna["id"], "2026-10-26", "2026-10-29")
    assert [d["kcal"] for d in r["days"]] == [1800, 0, 2000, 0]
    assert [d["logged"] for d in r["days"]] == [True, False, True, False]
    assert r["average"]["kcal"] == 1900 and r["logged_days"] == 2
    assert _raises(lambda: t.range(anna["id"], "2026-10-29", "2026-10-26"))


def test_a_planned_meal_is_offered_until_it_is_logged_as_eaten():
    _h, recipes, plan, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    oats = _food(n)
    r = recipes.create({"name": "Grød", "servings": "1", "ingredients": ["100 g havregryn"]})
    n.link_to_food("havregryn", oats["id"])
    planned = plan.add(DAY, "dinner", recipe_id=r["id"])
    plan.add(DAY, "lunch", title="Eating out")  # no recipe: nothing to count
    [offer] = t.planned(anna["id"], DAY)
    assert offer["plan_id"] == planned["id"] and offer["kcal"] == 370 and offer["meal"] == "dinner"
    t.add(anna["id"], DAY, "dinner", "recipe", recipe_id=r["id"], plan_id=planned["id"])
    assert t.planned(anna["id"], DAY) == []
    other = t.add_person("Mikkel")
    assert len(t.planned(other["id"], DAY)) == 1  # it is still planned for someone who did not log it


def test_recent_items_are_distinct_newest_first_and_can_be_starred():
    *_, t = _make()
    anna = t.ensure_user("u1", "Anna")
    for name in ("A", "B", "A"):
        t.add(anna["id"], DAY, "snack", "quick", name=name, kcal=100)
    assert [x["name"] for x in t.recent(anna["id"])] == ["A", "B"]
    entry = t.entries(anna["id"], DAY, DAY)[0]
    assert t.toggle_favourite(anna["id"], entry["id"]) is True
    assert [f["name"] for f in t.day(anna["id"], DAY)["favourites"]] == ["A"]
    assert t.toggle_favourite(anna["id"], entry["id"]) is False and t.day(anna["id"], DAY)["favourites"] == []


def test_the_usual_items_of_a_meal_and_copying_a_day():
    _h, recipes, _p, n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    oats = _food(n)
    for day in ("2026-10-26", "2026-10-27", "2026-10-28"):
        t.add(anna["id"], day, "breakfast", "food", food_id=oats["id"], amount=60)
    t.add(anna["id"], "2026-10-28", "breakfast", "quick", name="Kaffe", kcal=5)
    t.add(anna["id"], "2026-10-28", "lunch", "quick", name="Suppe", kcal=250)
    d = t.day(anna["id"], DAY)
    usual = d["usual"]
    assert [u["name"] for u in usual["breakfast"]] == ["Havregryn", "Kaffe"]  # most often first
    assert usual["breakfast"][0]["food_id"] == oats["id"] and usual["lunch"][0]["name"] == "Suppe"
    t.add(anna["id"], DAY, "breakfast", "food", food_id=oats["id"], amount=60)
    assert [u["name"] for u in t.day(anna["id"], DAY)["usual"]["breakfast"]] == ["Kaffe"]  # already eaten today
    assert d["previous"] == {"date": "2026-10-28", "count": 3}
    assert t.previous(anna["id"], "2026-10-29") == {"date": "2026-10-28", "count": 3}
    assert t.copy_day(anna["id"], "2026-10-28", "2026-10-30") == {"added": 3, "skipped": 0}
    copied = t.day(anna["id"], "2026-10-30")
    assert [e["name"] for e in copied["entries"]] == ["Havregryn", "Kaffe", "Suppe"] and copied["totals"]["kcal"] == 477
    n.delete_food(oats["id"])
    assert t.copy_day(anna["id"], "2026-10-28", "2026-10-31") == {"added": 2, "skipped": 1}  # the food is gone


PROFILE = {"sex": "female", "age": 34, "height_cm": 168, "weight_kg": 78, "target_kg": 70, "activity": "light"}


def test_the_calculator_gives_maintenance_and_a_target_for_each_pace():
    calc = importlib.import_module("hr_t.calorie_calc")
    r = calc.calculate(PROFILE, __import__("datetime").date(2026, 10, 29))
    assert (r["bmr"], r["maintenance"], r["to_lose"]) == (1499, 2061, 8.0)
    half = r["options"][1]
    assert (half["pace"], half["kcal"], half["deficit"], half["weeks"], half["reached"]) == (0.5, 1511, 550, 16, "2027-02-18")
    assert half["macros"] == {"protein": 125, "carbs": 159, "fat": 42}
    assert not any(o["below_minimum"] for o in r["options"])
    thin = calc.calculate({**PROFILE, "weight_kg": 50, "height_cm": 150, "activity": "sedentary", "target_kg": None}, None)
    assert thin["options"][2]["below_minimum"] and thin["options"][0]["weeks"] is None  # a warning flag, the target is still given
    male = calc.calculate({**PROFILE, "sex": "male"}, None)
    assert male["bmr"] == 1499 + 166 and male["minimum"] == 1500
    for bad in ({"sex": "x"}, {"activity": "none"}, {"age": 5}, {"height_cm": "tall"}, {"weight_kg": 0}):
        try:
            calc.calculate({**PROFILE, **bad}, None)
        except calc.CalcError:
            continue
        raise AssertionError(bad)


def test_a_profile_and_weights_give_the_deficit_of_a_day_and_a_week():
    *_, t = _make()
    anna = t.ensure_user("u1", "Anna")
    assert t.day(anna["id"], DAY)["maintenance"] is None  # no profile yet
    t.set_profile(anna["id"], PROFILE)
    assert t.day(anna["id"], DAY)["maintenance"] == 2061  # from the weight in the profile
    t.log_weight(anna["id"], "2026-10-26", 78)
    t.log_weight(anna["id"], "2026-10-29", 77.4)
    assert t.day(anna["id"], "2026-10-28")["maintenance"] == 2061 and t.day(anna["id"], DAY)["maintenance"] < 2061
    t.add(anna["id"], "2026-10-26", "lunch", "quick", name="A", kcal=1500)
    t.add(anna["id"], "2026-10-28", "lunch", "quick", name="B", kcal=1700)
    r = t.range(anna["id"], "2026-10-26", "2026-10-29")
    assert [d["deficit"] for d in r["days"]] == [561, None, 361, None]
    assert (r["deficit_total"], r["deficit_average"], r["kg"]) == (922, 461, 0.12)
    assert r["weights"] == [{"date": "2026-10-26", "kg": 78.0}, {"date": "2026-10-29", "kg": 77.4}]
    assert t.delete_weight(anna["id"], "2026-10-29") and not t.delete_weight(anna["id"], "2026-10-29")
    assert _raises(lambda: t.log_weight(anna["id"], DAY, 5)) and _raises(lambda: t.set_profile(anna["id"], {**PROFILE, "sex": "x"}))
    t.set_profile(anna["id"], {k: v for k, v in PROFILE.items() if k != "weight_kg"})
    assert t.needs(t.person(anna["id"]), "2026-10-20") is not None  # the first logged weight stands in before it


def test_changes_are_announced_and_saved():
    hass, _r, _p, _n, t = _make()
    anna = t.ensure_user("u1", "Anna")
    seen = []
    t.add_listener(lambda: seen.append(1))
    t.add(anna["id"], DAY, "snack", "quick", name="A", kcal=100)
    assert seen == [1] and hass.bus.events[-1][0] == "hass_recipes_tracker_changed"
    assert _Store.data["hass_recipes.tracker"]["entries"][0]["name"] == "A"
