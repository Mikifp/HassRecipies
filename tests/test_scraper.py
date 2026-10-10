"""Tests for the JSON-LD recipe parser (no Home Assistant needed)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "scraper", Path(__file__).parents[1] / "custom_components/hass_recipes/scraper.py"
)
scraper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scraper)

PAGE = """
<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","name":"Site"},
 {"@type":["Recipe"],"name":"Pancakes &amp; Syrup","image":{"@type":"ImageObject","url":"https://x/y.jpg"},
  "prepTime":"PT10M","cookTime":"PT1H5M","totalTime":"PT1H15M","recipeYield":["4","4 servings"],
  "recipeIngredient":["2 cups flour","1 egg"],"keywords":"breakfast, Sweet","recipeCategory":["Breakfast"],
  "recipeInstructions":[{"@type":"HowToSection","name":"Batter","itemListElement":
     [{"@type":"HowToStep","text":"Mix."},{"@type":"HowToStep","text":"Rest."}]},
   {"@type":"HowToStep","text":"Fry <b>well</b>."}]}
]}
</script></head></html>
"""


def test_parse_full_recipe():
    r = scraper.parse_recipe(PAGE, "https://example.com/p")
    assert r["name"] == "Pancakes & Syrup"
    assert r["image"] == "https://x/y.jpg"
    assert (r["prep_time"], r["cook_time"], r["total_time"]) == (10, 65, 75)
    assert r["servings"] == "4"
    assert r["ingredients"] == ["2 cups flour", "1 egg"]
    # HowToSection names are kept as section headings
    assert r["instructions"] == [{"text": "Batter", "section": True}, "Mix.", "Rest.", "Fry well."]
    assert r["categories"] == ["Breakfast"]
    assert r["tags"] == ["Sweet"]
    assert r["source_url"] == "https://example.com/p"


def test_no_recipe():
    import pytest

    with pytest.raises(scraper.RecipeImportError):
        scraper.parse_recipe("<html></html>", "https://x")


def test_split_yield():
    s = scraper.split_yield
    assert s("4 servings") == ("4 servings", None, "")
    assert s("4") == ("4", None, "")
    assert s("12 cookies") == ("", 12.0, "cookies")
    assert s("8 small pancakes") == ("", 8.0, "small pancakes")
    assert s("2,5 dl sauce") == ("", 2.5, "dl sauce")
    assert s("6 personer") == ("6 personer", None, "")
    assert s("Makes about a dozen") == ("Makes about a dozen", None, "")
    assert s("") == ("", None, "")


def test_recipe_yield_becomes_unit_yield():
    page = '<script type="application/ld+json">{"@type":"Recipe","name":"B","recipeYield":"12 buns","recipeIngredient":["1 egg"],"recipeInstructions":"Bake."}</script>'
    r = scraper.parse_recipe(page, "u")
    assert (r["servings"], r["yield_amount"], r["yield_unit"]) == ("", 12.0, "buns")
