"""Tests for ingredient parsing and gram conversion (no Home Assistant needed)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "ingredients", Path(__file__).parents[1] / "custom_components/hass_recipes/ingredients.py"
)
ing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ing)
parse = ing.parse_ingredient


def test_weight_units_are_exact():
    r = parse("2 lb potatoes")
    assert (r["quantity"], r["unit"], r["food"]) == (2.0, "lb", "potatoes")
    assert r["grams"] == 907.2 and not r["approximate"]
    assert parse("8 oz cheddar")["grams"] == 226.8


def test_parenthetical_metric_wins():
    r = parse("3 Tbsp (38g) granulated sugar")
    assert r["grams"] == 38.0 and not r["approximate"]
    assert r["food"] == "granulated sugar"


def test_volume_with_density_is_approximate():
    r = parse("1½ cups all-purpose flour")
    assert r["quantity"] == 1.5 and r["unit"] == "cup"
    assert r["grams"] == 188.1 and r["approximate"]  # 1.5 * 236.6 * 0.53


def test_volume_without_density_has_ml_only():
    r = parse("1 cup mystery")
    assert r["ml"] == 236.6 and r["grams"] is None


def test_per_unit_parenthetical():
    r = parse("2 (7-oz/200g) packages ladyfingers")
    assert r["unit"] == "package" and r["grams"] == 400.0


def test_ranges_fractions_and_notes():
    r = parse("1/2-1 tsp salt, to taste")
    assert (r["quantity"], r["quantity_max"], r["unit"]) == (0.5, 1.0, "tsp")
    assert r["food"] == "salt" and r["note"] == "to taste"
    assert r["grams_max"] is not None


def test_counts_and_unparsed():
    assert parse("3 large eggs")["grams"] == 150.0
    r = parse("Salt, to taste")
    assert r["quantity"] is None and r["grams"] is None and r["food"] == "Salt, to taste"


def test_fl_oz_and_metric_ml():
    assert parse("8 fl oz milk")["ml"] == 236.6
    assert parse("250 ml water")["grams"] == 250.0


def test_whole_word_matching():
    # "oil" must not match inside "boiled"/"foil"; plurals still match.
    assert parse("1 cup boiled something")["grams"] is None
    assert parse("1 cup foil")["grams"] is None
    assert parse("2 tbsp olive oil")["grams"] == 26.9
    assert parse("1 cup walnuts")["approximate"]


def test_longest_phrase_wins():
    assert parse("1 cup cooked rice")["grams"] < parse("1 cup rice")["grams"]
    assert parse("1 cup sour cream")["grams"] < parse("1 cup honey")["grams"]


def test_format_ingredient():
    fmt = ing.format_ingredient
    flour = parse("1½ cups all-purpose flour")
    assert fmt(flour, 2, "grams") == "≈ 376 g all-purpose flour"
    assert fmt(flour, 2, "grams", mark_approx=False) == "376 g all-purpose flour"
    assert fmt(flour, 2, "original") == "3 cups all-purpose flour"
    # exact metric amounts are kept in grams even for count units
    assert fmt(parse("2 (7-oz/200g) packages ladyfingers"), 1, "grams") == "400 g ladyfingers"
    # counted items stay counts
    assert fmt(parse("3 large eggs"), 2, "grams") == "6 large eggs"
    assert fmt(parse("2 cloves garlic, minced"), 2, "grams") == "4 cloves garlic, minced"
    assert fmt(parse("Salt, to taste"), 3) == "Salt, to taste"


def test_section_headings_and_substitutes():
    h = parse("## Cream")
    assert h["header"] and h["food"] == "Cream" and h["quantity"] is None
    assert not parse("2 cups flour")["header"]
    r = parse("200 g butter || 3/4 cup coconut oil")
    assert (r["quantity"], r["unit"], r["food"], r["grams"]) == (200.0, "g", "butter", 200.0)
    alt = r["substitute"]
    assert (alt["quantity"], alt["unit"], alt["food"]) == (0.75, "cup", "coconut oil")
    assert alt["grams"] is not None and alt["approximate"]
    assert r["text"] == "200 g butter"
    assert parse("1 egg")["substitute"] is None


def test_words_with_non_ascii_letters_are_not_cut_into_units():
    # "l" of "løg" is not litres, "g" of "gærn" is not grams, "c" of "cæsar" is not a cup
    onion = parse("2 løg")
    assert (onion["quantity"], onion["unit"], onion["food"]) == (2.0, None, "løg")
    assert onion["ml"] is None
    assert parse("1 løg, hakket")["food"] == "løg"
    assert parse("3 gærn")["unit"] is None
    assert parse("2 cæsarsalater")["unit"] is None
    assert parse("2 æg")["food"] == "æg"


def test_real_units_next_to_non_ascii_foods_still_work():
    litres = parse("2 l væske")
    assert (litres["unit"], litres["ml"], litres["food"]) == ("l", 2000.0, "væske")
    grams = parse("250 g løg")
    assert (grams["unit"], grams["grams"], grams["food"]) == ("g", 250.0, "løg")
    deci = parse("3 dl fløde")
    assert (deci["unit"], deci["ml"]) == ("dl", 300.0)


def test_danish_units_convert_like_their_english_counterparts():
    tsp = parse("2 tsk salt")
    assert (tsp["unit"], round(tsp["ml"], 1), tsp["food"]) == ("tsp", 9.9, "salt")
    tbsp = parse("1 spsk smør")
    assert tbsp["unit"] == "tbsp" and tbsp["grams"] == 14.2
    assert parse("3 dl mel")["grams"] == 159.0
    clove = parse("2 fed hvidløg")
    assert (clove["unit"], clove["grams"]) == ("clove", 6.0)
    assert parse("1 knsp salt")["unit"] == "pinch"
    assert parse("1 dsk honning")["unit"] == "dsp"
    assert parse("2 spiseskefulde sukker")["unit"] == "tbsp"


def test_a_counted_piece_uses_the_weight_of_one_piece():
    onions = parse("2 stk. løg")
    assert (onions["unit"], onions["unit_text"], onions["grams"]) == ("piece", "stk", 300.0)
    assert parse("1 stk citron")["grams"] == 85.0
    assert parse("2 løg")["grams"] == 300.0  # no unit at all: same answer


def test_units_in_other_languages():
    for line, unit in [
        ("2 EL Zucker", "tbsp"),
        ("1 TL Salz", "tsp"),
        ("3 Zehen Knoblauch", "clove"),
        ("1 Prise Salz", "pinch"),
        ("1 msk smör", "tbsp"),
        ("1 krm salt", "krm"),
        ("2 ss sukker", "tbsp"),
        ("2 cucharadas de azúcar", "tbsp"),
        ("2 dientes de ajo", "clove"),
        ("1 cucchiaino di sale", "tsp"),
        ("2 eetlepels suiker", "tbsp"),
        ("1 blik tomaten", "can"),
        ("2 tranches de pain", "slice"),
    ]:
        assert parse(line)["unit"] == unit, line


def test_link_words_between_unit_and_food_are_dropped_only_after_a_unit():
    assert parse("2 cucharadas de azúcar")["food"] == "azúcar"
    assert parse("1 cucchiaino di sale")["food"] == "sale"
    assert parse("2 de Jonge")["food"] == "de Jonge"  # no unit: leave the text alone


def test_english_units_are_unchanged_by_the_other_languages():
    assert parse("2 cups flour")["unit"] == "cup"
    assert parse("1 tbsp butter")["unit"] == "tbsp"
    assert parse("3 cloves garlic")["unit"] == "clove"
    assert parse("1 can tomatoes")["unit"] == "can"
    assert parse("2 l water")["ml"] == 2000.0


def test_superscript_fractions_are_read_as_fractions():
    potatoes = parse("1 ¹/₂ kilogram kartofler")
    assert (potatoes["quantity"], potatoes["unit"], potatoes["grams"], potatoes["food"]) == (1.5, "kg", 1500.0, "kartofler")
    tea = parse("³/₄ teske salt")
    assert (tea["quantity"], tea["unit"]) == (0.75, "tsp")


def test_a_danish_drys_is_a_dash():
    muskat = parse("1 drys muskatnød")
    assert (muskat["unit"], muskat["food"]) == ("dash", "muskatnød")


def test_an_ingredient_can_have_any_number_of_substitutes():
    p = parse("200 g smør || 180 g kokosolie || 2 dl fløde || 150 g margarine")
    assert (p["food"], p["grams"]) == ("smør", 200.0)
    assert [s["food"] for s in p["substitutes"]] == ["kokosolie", "fløde", "margarine"]
    assert p["substitutes"][0]["grams"] == 180.0
    assert p["substitute"]["food"] == "kokosolie"  # the first, for older clients


def test_no_substitutes_and_blank_ones():
    assert parse("2 eggs")["substitutes"] == [] and parse("2 eggs")["substitute"] is None
    assert parse("2 eggs || ")["substitutes"] == []
    assert parse("## Dough")["substitutes"] == []
    assert [s["food"] for s in parse("1 butter ||  || 1 oil")["substitutes"]] == ["oil"]


def test_ingredient_note_is_kept_apart_from_the_food():
    plain = parse("200 g butter")
    noted = parse("200 g butter // room temperature")
    assert noted["comment"] == "room temperature"
    assert noted["food"] == plain["food"] == "butter"
    assert noted["grams"] == plain["grams"] == 200
    assert plain["comment"] == ""


def test_ingredient_note_after_substitutes():
    r = parse("200 g butter || 180 g coconut oil // soft")
    assert r["comment"] == "soft"
    assert r["substitutes"][0]["food"] == "coconut oil"


def test_danish_spoon_plurals_are_units():
    for line in ("2 teskeer bagepulver", "1 ¹/₂ spiseskeer hvidvinseddike", "2 dessertskeer sukker"):
        r = parse(line)
        assert r["unit"] is not None, line
        assert r["quantity"] is not None
    assert parse("2 teskeer bagepulver")["food"] == "bagepulver"


def test_food_words_pick_the_noun():
    assert ing.food_words("1 ¹/₂ kilogram kartofler")[0][0] == "kartofler"
    assert ing.food_words("2 stk røde løg")[0][0] == "løg"
    assert ing.food_words("280 gram sukker jeg brugte halv brun farin")[0][0] == "sukker"
    words, compound = ing.food_words("2 tsk salt og peber")
    assert compound and words[0] == "salt og peber"


def test_a_step_links_the_ingredients_it_names():
    ingredients = ["## Kage", "175 gram smør", "2 stykker æg", "salt og peber", "1 dl mælk"]
    steps = [
        {"text": "Kage", "section": True},
        "Smelt smørret og pisk æggene. Smag til med salt og peber.",
        "Tilsæt smør igen og rør.",
        "Hæld mælk i.",
    ]
    out = ing.link_ingredients(ingredients, steps)
    assert out[0] == {"text": "Kage", "section": True}
    assert out[1]["ingredients"] == [1, 2, 3]
    # an ingredient links to the first step that names it
    assert out[2]["ingredients"] == []
    assert out[3]["ingredients"] == [4]


def test_steps_that_already_have_links_are_left_alone():
    out = ing.link_ingredients(["1 egg", "1 dl milk"], [{"text": "Add the milk and egg.", "ingredients": [0]}, "Pour milk."])
    assert out[0]["ingredients"] == [0]
    assert out[1]["ingredients"] == [1]


def test_parenthetical_amount_is_kept_and_scaled():
    p = ing.parse_ingredient("100 g sukker (100 ml)")
    assert p["parens"] == ["100 ml"]
    # the amount written in grams stays the basis; the bracket is only another measure
    assert p["grams"] == 100 and not p["paren_basis"]
    assert ing.format_ingredient(p, 1) == "100 g sukker (100 ml)"
    assert ing.format_ingredient(p, 2) == "200 g sukker (200 ml)"
    assert ing.format_ingredient(p, 2, mode="original") == "200 g sukker (200 ml)"


def test_parenthetical_with_prefix_and_ranges():
    p = ing.parse_ingredient("2 dl mel (ca. 120 g)")
    assert p["parens"] == ["ca. 120 g"]
    # a volume told in grams by the brackets: the written weight beats a density guess
    assert p["grams"] == 120.0 and p["paren_basis"]
    assert ing.format_ingredient(p, 2) == "240 g mel"
    assert ing.scale_paren("ca. 120 g", 1.5) == "ca. 180 g"
    assert ing.scale_paren("1-2 stk", 2) == "2–4 stk"
    # a remark that does not start with an amount is not an amount
    assert ing.parse_ingredient("1 tsk salt (fint)")["parens"] == []
