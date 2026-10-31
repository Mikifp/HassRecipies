"""Calories and macros per recipe: matching ingredients to Frida foods, custom
ingredients, unit weights, and the stored links."""

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

pkg = types.ModuleType("hr_n")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_n"] = pkg
store_mod = importlib.import_module("hr_n.store")
nu = importlib.import_module("hr_n.nutrition")
ns = importlib.import_module("hr_n.nutrition_store")

DB = nu.FoodDatabase.load()


def _make():
    _Store.data = {}
    hass = types.SimpleNamespace(bus=_Bus())
    recipes = store_mod.RecipeStore(hass)
    asyncio.run(recipes.async_load())
    nutrition = ns.Nutrition(hass, recipes, DB)
    asyncio.run(nutrition.async_load())
    return recipes, nutrition


def _item(result, text):
    return next(i for i in result["items"] if i["text"] == text)


# ---- the bundled data -----------------------------------------------------------

def test_frida_data_is_bundled_with_its_attribution():
    assert len(DB.foods) > 1000
    assert DB.meta["license"] == "CC BY 4.0"
    assert "Danish Food Composition Database" in DB.meta["attribution"]
    flour = DB.get(1301)
    assert flour["name_da"] == "Hvedemel" and 300 < flour["kcal"] < 400


def test_every_default_word_points_at_a_real_food():
    missing = set(nu.DEFAULT_LINKS.values()) - {f["name_da"] for f in DB.defaults.values()}
    assert not missing


# ---- matching ---------------------------------------------------------------------

def test_everyday_words_use_the_defaults():
    for word, expected in (
        ("æg", "Æg, høne, skrabehøns, rå"),
        ("mælk", "Sødmælk, konventionel (ikke-økologisk)"),
        ("Hakkede tomater", "Tomat, flået, konserves"),
        ("butter", "Smør, saltet"),
    ):
        match = nu.resolve(DB, {}, {}, word)
        assert match["name"] == expected and match["default"] and not match["auto"]


def test_a_clear_search_hit_is_used_but_marked_unconfirmed():
    match = nu.resolve(DB, {}, {}, "rød peberfrugt")
    assert match["name"] == "Peberfrugt, rød, rå" and match["auto"]


def test_nothing_is_guessed_for_an_unknown_food():
    assert nu.resolve(DB, {}, {}, "drageblod") is None


def test_search_finds_danish_and_english_names():
    assert DB.search("hakket oksekød", 1)[0][1]["name_da"].startswith("Oksekød, hakket")
    assert DB.search("peanut butter", 1)[0][1]["name_da"] == "Jordnøddesmør"
    assert DB.search("kartofler", 1)[0][1]["name_da"] == "Kartoffel, uspec., rå"


def test_servings_are_read_from_free_text():
    assert nu.parse_servings("4") == 4
    assert nu.parse_servings("4-6 personer") == 4
    assert nu.parse_servings("Serves 2,5") == 2.5
    assert nu.parse_servings("") is None and nu.parse_servings("a few") is None


# ---- a whole recipe ------------------------------------------------------------------

def test_a_recipe_is_summed_and_divided_by_servings():
    recipes, nutrition = _make()
    recipe = recipes.create(
        {
            "name": "Pandekager",
            "servings": "4 personer",
            "ingredients": ["## Dej", "250 g hvedemel", "5 dl mælk", "3 æg", "50 g smør", "salt"],
        }
    )
    result = nutrition.for_recipe(recipe["id"])
    flour, milk, eggs = DB.get(1301), DB.defaults["mælk"], DB.defaults["æg"]
    butter = DB.defaults["smør"]
    milk_grams = _item(result, "5 dl mælk")["grams"]
    expected = (
        flour["kcal"] * 2.5 + milk["kcal"] * milk_grams / 100 + eggs["kcal"] * 1.5 + butter["kcal"] * 0.5
    )
    assert abs(result["total"]["kcal"] - expected) < 1
    assert abs(result["per_serving"]["kcal"] - expected / 4) < 1
    assert result["servings"] == 4 and result["counted"] == 4
    # "salt" has no amount: listed, not guessed, and the header is skipped
    assert _item(result, "salt")["status"] == "no_grams"
    assert result["missing"] == 1 and not result["complete"]
    assert all(i["text"] != "Dej" for i in result["items"])
    assert result["source"]["license"] == "CC BY 4.0"


def test_a_range_counts_as_its_middle():
    recipes, nutrition = _make()
    recipe = recipes.create({"name": "x", "ingredients": ["100-200 g hvedemel"]})
    assert _item(nutrition.for_recipe(recipe["id"]), "100-200 g hvedemel")["grams"] == 150


def test_ignored_ingredients_count_as_nothing_and_do_not_block_complete():
    recipes, nutrition = _make()
    recipe = recipes.create({"name": "x", "ingredients": ["100 g hvedemel", "salt og peber"]})
    nutrition.set_link("salt og peber", nu.SOURCE_IGNORE)
    result = nutrition.for_recipe(recipe["id"])
    assert _item(result, "salt og peber")["status"] == "ignored"
    assert result["complete"]


# ---- links and unit weights --------------------------------------------------------

def test_a_link_overrides_the_default_and_survives_a_reload():
    recipes, nutrition = _make()
    recipe = recipes.create({"name": "x", "ingredients": ["2 æg"]})
    nutrition.set_link("Æg", nu.SOURCE_FRIDA, 848)  # duck egg, on purpose
    assert _item(nutrition.for_recipe(recipe["id"]), "2 æg")["match"]["id"] == 848
    again = ns.Nutrition(types.SimpleNamespace(bus=_Bus()), recipes, DB)
    asyncio.run(again.async_load())
    assert _item(again.for_recipe(recipe["id"]), "2 æg")["match"]["id"] == 848
    nutrition.set_link("æg", None)  # forget: back to the default
    assert _item(nutrition.for_recipe(recipe["id"]), "2 æg")["match"]["default"]


def test_a_unit_weight_makes_a_can_countable():
    recipes, nutrition = _make()
    recipe = recipes.create({"name": "x", "ingredients": ["2 dåser hakkede tomater"]})
    before = _item(nutrition.for_recipe(recipe["id"]), "2 dåser hakkede tomater")
    assert before["status"] == "no_grams" and before["unit"] == "can"
    nutrition.set_unit_grams("hakkede tomater", "can", 400)
    after = _item(nutrition.for_recipe(recipe["id"]), "2 dåser hakkede tomater")
    assert after["status"] == "ok" and after["grams"] == 800
    # the default food became a real link carrying the weight
    assert nutrition.links()["hakkede tomater"]["unit_grams"] == {"can": 400}


def test_bad_links_are_refused():
    _recipes, nutrition = _make()
    for call in (
        lambda: nutrition.set_link("x", nu.SOURCE_FRIDA, 999999),
        lambda: nutrition.set_link("x", nu.SOURCE_CUSTOM, "nope"),
        lambda: nutrition.set_link("x", "elsewhere", 1),
        lambda: nutrition.set_link("  ", nu.SOURCE_IGNORE),
        lambda: nutrition.set_unit_grams("drageblod", "can", 400),
    ):
        try:
            call()
        except ns.NutritionError:
            continue
        raise AssertionError("expected NutritionError")


# ---- custom ingredients ------------------------------------------------------------

def test_a_custom_ingredient_named_like_the_line_is_used():
    recipes, nutrition = _make()
    pesto = nutrition.save_custom({"name": "Hjemmelavet pesto", "kcal": 450, "fat": 45, "protein": "5"})
    assert pesto["protein"] == 5.0 and pesto["carbs"] is None
    recipe = recipes.create({"name": "x", "servings": "2", "ingredients": ["100 g hjemmelavet pesto"]})
    result = nutrition.for_recipe(recipe["id"])
    item = _item(result, "100 g hjemmelavet pesto")
    assert item["match"]["source"] == nu.SOURCE_CUSTOM and not item["match"]["auto"]
    assert result["total"]["kcal"] == 450 and result["per_serving"]["fat"] == 22.5
    # a nutrient nobody knows stays unknown instead of becoming 0
    assert result["total"]["carbs"] is None


def test_nutrition_is_also_given_per_100_g_and_per_unit_the_recipe_makes():
    recipes, nutrition = _make()
    nutrition.save_custom({"name": "Hjemmelavet pesto", "kcal": 450, "fat": 45, "protein": "5"})
    r = recipes.create({"name": "x", "servings": "2", "yield_amount": 12, "yield_unit": "boller", "ingredients": ["200 g hjemmelavet pesto", "1 salt til smag"]})
    result = nutrition.for_recipe(r["id"])
    assert result["total"]["kcal"] == 900 and result["weight"] == 200.0 and result["weight_uncounted"] == 0
    assert result["per_100g"]["kcal"] == 450 and result["per_100g"]["protein"] == 5 and result["per_100g"]["carbs"] is None
    assert result["per_unit"]["kcal"] == 75 and result["makes"] == 12 and result["yield_unit"] == "boller"
    plain = recipes.create({"name": "y", "ingredients": ["100 g hjemmelavet pesto"]})
    result = nutrition.for_recipe(plain["id"])
    assert result["per_unit"] is None and result["makes"] is None and result["per_100g"]["fat"] == 45
    # an ingredient without nutrition values still weighs: per 100 g is of the whole weight, its numbers are 0
    diluted = nutrition.for_recipe(recipes.create({"name": "w", "ingredients": ["200 g hjemmelavet pesto", "200 g ukendt pulver"]})["id"])
    assert diluted["weight"] == 400.0 and diluted["weight_uncounted"] == 200.0
    assert diluted["total"]["kcal"] == 900 and diluted["per_100g"]["kcal"] == 225
    nothing = nutrition.for_recipe(recipes.create({"name": "z", "ingredients": ["noget ukendt"]})["id"])
    assert nothing["per_100g"] is None and nothing["weight"] == 0


def test_custom_ingredients_appear_in_search_first():
    _recipes, nutrition = _make()
    nutrition.save_custom({"name": "Hvedemel, mit eget", "kcal": 350})
    hits = nutrition.search("hvedemel")
    assert hits[0]["source"] == nu.SOURCE_CUSTOM or hits[0]["name"] == "Hvedemel"
    assert any(h["source"] == nu.SOURCE_CUSTOM for h in hits[:3])


def test_a_custom_ingredient_needs_a_name_and_energy():
    _recipes, nutrition = _make()
    for data in ({"name": "", "kcal": 100}, {"name": "Noget"}):
        try:
            nutrition.save_custom(data)
        except ns.NutritionError:
            continue
        raise AssertionError("expected NutritionError")


def test_deleting_a_custom_ingredient_forgets_its_links():
    recipes, nutrition = _make()
    food = nutrition.save_custom({"name": "Kokos-pesto", "kcal": 300})
    nutrition.set_link("grøn pesto", nu.SOURCE_CUSTOM, food["id"])
    assert nutrition.delete_custom(food["id"])
    assert "grøn pesto" not in nutrition.links()
    assert not nutrition.delete_custom(food["id"])


def test_export_and_import_bring_custom_ingredients_and_links():
    _recipes, nutrition = _make()
    food = nutrition.save_custom({"name": "Kokos-pesto", "kcal": 300})
    nutrition.set_link("grøn pesto", nu.SOURCE_CUSTOM, food["id"], {"jar": 190})
    nutrition.set_link("æg", nu.SOURCE_FRIDA, 848)
    document = nutrition.export()

    _recipes2, other = _make()
    assert other.import_data(document) == 2  # the custom food and the Frida food
    links = other.links()
    new_id = other.custom_foods()[0]["id"]
    assert links["grøn pesto"] == {"source": "custom", "id": new_id, "unit_grams": {"jar": 190}}
    assert links["æg"]["id"] == 848
    assert other.import_data(document) == 0  # importing again adds nothing


def test_numbers_pick_the_right_variant():
    assert DB.search("oksekød hakket 15-20", 1)[0][1]["name_da"] == "Oksekød, hakket, 15-20% fedt, rå"
    assert DB.search("fløde 18%", 1)[0][1]["name_da"] == "Fløde 18 %"


def test_a_compound_ending_is_a_closer_match_than_its_start():
    assert nu.score("mælk", "Sødmælk, økologisk") > nu.score("mælk", "Mælkebøtte, blade, rå")


# ---- USDA Foundation Foods -----------------------------------------------------------

def test_usda_foundation_foods_are_bundled_with_their_credit():
    assert len(DB.usda) > 300
    assert DB.usda_meta["license"].startswith("Public domain") and "FoodData Central" in DB.usda_meta["attribution"]
    cheddar = next(f for f in DB.usda.values() if f["name_en"] == "Cheese, cheddar")
    assert 380 < cheddar["kcal"] < 430


def test_a_name_only_usda_knows_is_matched_by_it_while_frida_stays_first_where_it_is_clear():
    recipes, nutrition = _make()
    r = recipes.create({"name": "x", "ingredients": ["100 g hummus", "2 æg", "100 g hvedemel"]})
    result = nutrition.for_recipe(r["id"])
    hummus = _item(result, "100 g hummus")["match"]
    assert hummus["source"] == "usda" and hummus["auto"] and 150 < hummus["kcal"] < 400
    assert _item(result, "2 æg")["match"]["source"] == "frida"
    assert _item(result, "100 g hvedemel")["match"]["source"] == "frida"
    assert [s["source"] for s in result["sources"]] == ["frida", "usda"]


def test_search_lists_usda_foods_and_a_link_to_one_counts_its_values():
    recipes, nutrition = _make()
    assert any(h["source"] == "usda" for h in nutrition.search("hummus", 10))
    r = recipes.create({"name": "x", "ingredients": ["100 g kikærtepure"]})
    usda_id = next(h["id"] for h in nutrition.search("hummus", 10) if h["source"] == "usda")
    nutrition.set_link("kikærtepure", "usda", usda_id)
    item = _item(nutrition.for_recipe(r["id"]), "100 g kikærtepure")
    assert item["status"] == "ok" and item["match"]["source"] == "usda" and item["match"]["linked"]
    assert item["values"]["kcal"] == DB.get_usda(usda_id)["kcal"]
