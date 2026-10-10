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
