"""The user's foods: names and other names, unit weights, nutrition, merging, and what the
calculation reads from them (no Home Assistant needed)."""

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
    def async_fire(self, name, data=None):
        pass


for pkg in ("homeassistant", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.core", HomeAssistant=object)
_stub("homeassistant.helpers.storage", Store=_Store)

pkg = types.ModuleType("hr_f")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_f"] = pkg
store_mod = importlib.import_module("hr_f.store")
nu = importlib.import_module("hr_f.nutrition")
foods = importlib.import_module("hr_f.foods")
ns = importlib.import_module("hr_f.nutrition_store")

DB = nu.FoodDatabase.load()
HVEDEMEL = 1301  # Frida: Hvedemel


def _make(saved=None):
    _Store.data = {ns.NUTRITION_STORAGE_KEY: saved} if saved else {}
    hass = types.SimpleNamespace(bus=_Bus())
    recipes = store_mod.RecipeStore(hass)
    asyncio.run(recipes.async_load())
    nutrition = ns.Nutrition(hass, recipes, DB)
    asyncio.run(nutrition.async_load())
    return recipes, nutrition


def _raises(call):
    try:
        call()
    except (foods.FoodError, ns.NutritionError):
        return True
    return False


# ---- older data becomes foods ----------------------------------------------------

def test_links_and_custom_ingredients_of_the_older_version_become_foods():
    legacy = {
        "links": {
            "hvedemel": {"source": "frida", "id": HVEDEMEL, "unit_grams": {"cup": 120}},
            "mel": {"source": "frida", "id": HVEDEMEL},
            "grøn pesto": {"source": "custom", "id": "c1", "unit_grams": {"jar": 190}},
            "vand": {"source": "ignore", "id": None},
        },
        "custom": [{"id": "c1", "name": "Kokos-pesto", "kcal": 300, "fat": 30}],
    }
    _recipes, n = _make(legacy)
    by_name = {f["name"]: f for f in n.book.foods.values()}
    assert set(by_name) == {"Hvedemel", "Kokos-pesto"}
    flour, pesto = by_name["Hvedemel"], by_name["Kokos-pesto"]
    assert flour["aliases"] == ["mel"] and flour["unit_grams"] == {"cup": 120} and flour["auto"] is True
    assert pesto["id"] == "c1" and pesto["aliases"] == ["grøn pesto"] and pesto["unit_grams"] == {"jar": 190}
    assert pesto["source"] == "custom" and pesto["auto"] is False
    assert n.book.ignored == ["vand"]
    # what the calculation reads is the same as before
    links = n.links()
    assert links["hvedemel"] == {"source": "frida", "id": HVEDEMEL, "unit_grams": {"cup": 120}}
    assert links["mel"]["id"] == HVEDEMEL
    assert links["grøn pesto"] == {"source": "custom", "id": "c1", "unit_grams": {"jar": 190}}
    assert links["vand"]["source"] == "ignore"
    assert n.custom_foods()[0]["name"] == "Kokos-pesto" and n.custom_foods()[0]["kcal"] == 300


def test_foods_are_saved_in_the_new_shape_and_read_back():
    _recipes, n = _make()
    created = n.save_food({"name": "Smør", "aliases": ["butter"], "source": "frida", "frida_id": HVEDEMEL, "unit_grams": {"dl": 95}})
    saved = ns.NUTRITION_STORAGE_KEY
    n._store.async_delay_save(n.book.to_data, 0)
    _recipes2, again = _make(_Store.data[saved])
    assert again.book.foods[created["id"]]["aliases"] == ["butter"]
    assert again.links()["butter"]["unit_grams"] == {"dl": 95}


# ---- making and changing foods ---------------------------------------------------

def test_a_food_has_a_name_other_names_weights_and_nutrition():
    _recipes, n = _make()
    food = n.save_food(
        {
            "name": "Smør",
            "aliases": ["butter", " Butter ", "saltet smør", ""],
            "source": "custom",
            "values": {"kcal": 740, "fat": 82},
            "unit_grams": {"dl": 95, "tsk": 0, "x": "abc"},
            "section": "Mejeri",
        }
    )
    assert food["aliases"] == ["butter", "saltet smør"]  # no repeats, no empties
    assert food["unit_grams"] == {"dl": 95.0}  # only sensible weights
    assert food["values"]["kcal"] == 740 and food["section"] == "Mejeri" and food["source"] == "custom"
    # every name of the food is read as the food
    assert {"smør", "butter", "saltet smør"} <= set(n.links())


def test_bad_foods_are_refused():
    _recipes, n = _make()
    n.save_food({"name": "Smør", "aliases": ["butter"]})
    for data in (
        {"name": ""},
        {"name": "Mel", "source": "frida", "frida_id": 999999},
        {"name": "Mel", "source": "custom", "values": {}},  # own values need the energy
        {"name": "Mel", "source": "elsewhere"},
        {"name": "Butter"},  # already another name of Smør
        {"name": "Mel", "aliases": ["smør"]},
    ):
        assert _raises(lambda d=data: n.save_food(d)), data


def test_changing_a_food_keeps_what_is_not_given():
    _recipes, n = _make()
    food = n.save_food({"name": "Smør", "aliases": ["butter"], "unit_grams": {"dl": 95}, "section": "Mejeri"})
    changed = n.save_food({"aliases": ["butter", "kærnesmør"]}, food["id"])  # only the other names are given
    assert changed["unit_grams"] == {"dl": 95.0} and changed["section"] == "Mejeri"
    assert changed["aliases"] == ["butter", "kærnesmør"]
    assert n.delete_food(food["id"]) and not n.delete_food(food["id"])
    assert "butter" not in n.links()


def test_foods_can_be_merged_and_keep_the_names_and_weights():
    _recipes, n = _make()
    a = n.save_food({"name": "Rødløg", "unit_grams": {"stk": 90}})
    b = n.save_food({"name": "Løg", "aliases": ["onion"], "source": "frida", "frida_id": HVEDEMEL, "unit_grams": {"stk": 110, "bundt": 200}})
    merged = n.merge_foods(b["id"], [a["id"]])
    assert set(merged["aliases"]) == {"onion", "Rødløg"}
    assert merged["unit_grams"] == {"stk": 110.0, "bundt": 200.0}  # the target's own weight wins
    assert [f["name"] for f in n.foods_overview()["foods"]] == ["Løg"]
    assert "rødløg" in n.links()
    # a food without nutrition takes it from the one it is merged with
    c = n.save_food({"name": "Hvedemel"})
    d = n.save_food({"name": "Mel", "source": "frida", "frida_id": HVEDEMEL})
    assert n.merge_foods(c["id"], [d["id"]])["source"] == "frida"


# ---- ingredient names ------------------------------------------------------------

def test_linking_a_name_makes_a_food_for_it_and_forgetting_removes_it_again():
    _recipes, n = _make()
    n.set_link("Æg", "frida", 848)
    egg = n.book.food_for_key("æg")
    assert egg["auto"] and egg["frida_id"] == 848
    n.set_link("hønseæg", "frida", 848)  # the same Frida food: one food with two names
    assert len(n.book.foods) == 1
    assert n.book.food_for_key("æg")["aliases"] == ["hønseæg"]
    n.set_link("hønseæg", None)
    n.set_link("æg", None)
    assert n.book.foods == {}


def test_a_food_of_your_own_is_not_forgotten_by_resetting_a_name():
    _recipes, n = _make()
    food = n.save_food({"name": "Kokos-pesto", "source": "custom", "values": {"kcal": 300}})
    assert _raises(lambda: n.set_link("Kokos-pesto", None))
    assert food["id"] in n.book.foods
    n.set_link("grøn pesto", "custom", food["id"])
    n.set_link("grøn pesto", None)  # a name added to it can be taken away again
    assert n.book.foods[food["id"]]["aliases"] == []


def test_unit_weights_belong_to_the_food_and_a_weight_on_the_line_still_wins():
    recipes, n = _make()
    n.set_link("hakkede tomater", "frida", HVEDEMEL)
    n.set_unit_grams("hakkede tomater", "can", 400)
    n.set_link("flåede tomater", "frida", HVEDEMEL)  # another name for the same food shares the weight
    r = recipes.create({"name": "x", "ingredients": ["1 dåse flåede tomater", "1 dåse (240 g) flåede tomater"]})
    result = n.for_recipe(r["id"])
    by_text = {i["text"]: i for i in result["items"]}
    assert by_text["1 dåse flåede tomater"]["grams"] == 400
    assert by_text["1 dåse (240 g) flåede tomater"]["grams"] == 240


def test_ignored_names_and_foods_do_not_clash():
    _recipes, n = _make()
    n.set_link("vand", "ignore")
    assert n.book.ignored == ["vand"]
    n.save_food({"name": "Vand"})  # a food of that name takes it out of the ignored ones
    assert n.book.ignored == []


def test_a_name_can_be_linked_to_a_food_of_your_own_and_unlinked_again():
    _recipes, n = _make()
    food = n.save_food({"name": "Hvedemel", "source": "frida", "frida_id": HVEDEMEL})
    linked = n.link_to_food("Mel, hvid", food["id"])
    assert linked["aliases"] == ["mel hvid"] and n.links()["mel hvid"]["id"] == HVEDEMEL
    assert _raises(lambda: n.link_to_food("x", "nope"))
    other = n.save_food({"name": "Kartoffelmel"})
    assert _raises(lambda: n.link_to_food("hvedemel", other["id"]))  # that is the name of another food
    n.set_link("mel hvid", None)
    assert n.book.foods[food["id"]]["aliases"] == []


# ---- the overview and adopting suggestions ---------------------------------------

def test_the_overview_lists_foods_with_use_and_names_in_recipes_that_need_a_food():
    recipes, n = _make()
    recipes.create({"name": "A", "ingredients": ["200 g hvedemel", "2 æg", "100 g drageblod"]})
    recipes.create({"name": "B", "ingredients": ["300 g hvedemel", "1 dl mælk"]})
    flour = n.save_food({"name": "Hvedemel", "source": "frida", "frida_id": HVEDEMEL})
    overview = n.foods_overview()
    [food] = overview["foods"]
    assert food["id"] == flour["id"] and food["used_in"] == 2 and food["frida_name"] == "Hvedemel"
    review = {r["key"]: r for r in overview["review"]}
    assert set(review) == {"æg", "drageblod", "mælk"}
    assert review["æg"]["suggestion"]["confidence"] == "standard" and review["æg"]["used_in"] == 1
    assert review["drageblod"]["suggestion"] is None
    assert overview["counts"] == {"foods": 1, "mine": 0, "frida": 1, "none": 0, "review": 3}


def test_adopting_suggestions_makes_foods_the_calculation_already_used():
    recipes, n = _make()
    r = recipes.create({"name": "A", "ingredients": ["2 æg", "100 g drageblod", "1 dl mælk"]})
    before = n.for_recipe(r["id"])
    assert n.adopt(["æg", "mælk", "drageblod", "æg"]) == 2  # the unknown one is skipped, no repeats
    after = n.for_recipe(r["id"])
    assert [i["status"] for i in after["items"]] == [i["status"] for i in before["items"]]
    assert {f["name"] for f in n.foods_overview()["foods"]} == {"Æg", "Mælk"}
    assert [x["key"] for x in n.foods_overview()["review"]] == ["drageblod"]


# ---- backup ---------------------------------------------------------------------

def test_foods_travel_in_the_backup_and_an_older_backup_still_reads():
    _recipes, n = _make()
    n.save_food({"name": "Smør", "aliases": ["butter"], "source": "custom", "values": {"kcal": 740}, "unit_grams": {"dl": 95}})
    n.set_link("vand", "ignore")
    document = n.export()
    assert {"foods", "ignored", "links", "custom"} <= set(document)  # the older keys keep an older version able to read it
    _r2, other = _make()
    assert other.import_data(document) == 1
    assert other.links()["butter"]["unit_grams"] == {"dl": 95.0} and other.book.ignored == ["vand"]
    assert other.import_data(document) == 0  # again: nothing new
    # a backup from before the foods
    _r3, old = _make()
    assert old.import_data({"custom": [{"id": "z", "name": "Pesto", "kcal": 300}], "links": {"grøn pesto": {"source": "custom", "id": "z"}}}) == 1
    assert old.links()["grøn pesto"]["source"] == "custom"


# ---- a recipe's ingredients and their foods --------------------------------------

def test_a_recipe_shows_which_food_each_line_is_and_which_names_are_not_one_yet():
    recipes, n = _make()
    r = recipes.create({"name": "x", "ingredients": ["200 g hvedemel", "2 æg", "100 g drageblod", "50 g bagepulver"]})
    n.save_food({"name": "Hvedemel", "source": "frida", "frida_id": HVEDEMEL})
    result = n.for_recipe(r["id"])
    by = {i["text"]: i for i in result["items"]}
    assert by["200 g hvedemel"]["own_food"]["name"] == "Hvedemel"
    assert by["2 æg"]["own_food"] is None and by["100 g drageblod"]["own_food"] is None
    assert result["unlinked"] == 3 and result["standard"] == ["æg"]  # only everyday words have a standard choice


def test_saving_a_recipe_makes_foods_of_its_standard_names_but_not_of_guesses():
    recipes, n = _make()
    r = recipes.create({"name": "x", "ingredients": ["2 æg", "100 g bagepulver", "1 dl mælk"]})
    assert n.auto_link(r["id"]) == 2
    assert {f["name"] for f in n.foods_overview()["foods"]} == {"Æg", "Mælk"}
    assert [x["key"] for x in n.foods_overview()["review"]] == ["bagepulver"]
    assert n.auto_link(r["id"]) == 0  # again: nothing new
    n.set_link("æg", None)  # a name reset on purpose is made a food again the next time the recipe is saved
    assert n.auto_link(r["id"]) == 1
    n.set_link("mælk", "ignore")  # counted as nothing: the food made for it goes, and it is left alone from now on
    assert n.auto_link(r["id"]) == 0 and n.book.ignored == ["mælk"]
    assert {f["name"] for f in n.foods_overview()["foods"]} == {"Æg"}
    mine = n.save_food({"name": "Kokos"})
    assert _raises(lambda: n.set_link("kokos", "ignore"))  # a food you made is not removed by Don't count
