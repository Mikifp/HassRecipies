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


def test_import_pasted_html():
    import asyncio

    r = asyncio.run(scraper.async_import_html(PAGE, " https://example.com/p "))
    assert r["name"] == "Pancakes & Syrup"
    assert r["source_url"] == "https://example.com/p"


def test_import_pasted_html_without_recipe():
    import asyncio

    try:
        asyncio.run(scraper.async_import_html("<html><body>nothing</body></html>"))
    except scraper.RecipeImportError:
        return
    raise AssertionError("expected RecipeImportError")


def test_pasted_schema_json():
    import json

    doc = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Recipe",
                "name": "Soup",
                "recipeIngredient": ["1 l stock", "2 carrots"],
                "recipeInstructions": [{"@type": "HowToStep", "text": "Boil the stock."}],
                "recipeYield": "4 servings",
                "totalTime": "PT30M",
            }
        ],
    }
    r = scraper.parse_pasted(json.dumps(doc), "https://example.com/soup")
    assert r["name"] == "Soup"
    assert r["ingredients"] == ["1 l stock", "2 carrots"]
    assert r["total_time"] == 30
    assert r["source_url"] == "https://example.com/soup"
    # a bare Recipe object works too
    assert scraper.parse_pasted(json.dumps(doc["@graph"][0]))["name"] == "Soup"


def test_pasted_json_without_recipe():
    try:
        scraper.parse_pasted('{"@type": "Person", "name": "x"}')
    except scraper.RecipeImportError:
        return
    raise AssertionError("expected RecipeImportError")


TEXT_RECIPE = """Banana bread
A moist loaf.

Ingredients
- 3 ripe bananas
- 200 g flour

Instructions
1. Mash the bananas.
2. Mix in the flour.
3. Bake for 50 minutes.

Notes
Keeps for three days.
"""


def test_pasted_text_with_headings():
    r = scraper.parse_pasted(TEXT_RECIPE)
    assert r["name"] == "Banana bread"
    assert r["ingredients"] == ["3 ripe bananas", "200 g flour"]
    assert [s["text"] if isinstance(s, dict) else s for s in r["instructions"]] == [
        "Mash the bananas.",
        "Mix in the flour.",
        "Bake for 50 minutes.",
    ]
    assert "A moist loaf." in r["description"] and "three days" in r["description"]


def test_pasted_danish_headings():
    r = scraper.parse_pasted("Pandekager\n\nIngredienser:\n2 dl mel\n3 æg\n\nFremgangsmåde:\nPisk det hele sammen.\nSteg dem.")
    assert r["ingredients"] == ["2 dl mel", "3 æg"]
    assert len(r["instructions"]) == 2


TRANSCRIPT = """0:00
[Music]
0:05
today we are making pancakes you need 200 g flour and 2 eggs
0:12
and 3 dl milk. Whisk everything together until smooth.
0:20
Fry them in butter for two minutes on each side.
"""


def test_pasted_transcript():
    r = scraper.parse_pasted(TRANSCRIPT)
    texts = [s["text"] if isinstance(s, dict) else s for s in r["instructions"]]
    assert texts and "0:05" not in " ".join(texts) and "[Music]" not in " ".join(texts)
    assert "200 g flour" in r["ingredients"]
    assert "2 eggs" in r["ingredients"]
    assert "3 dl milk" in r["ingredients"]
    assert not any("minutes" in i for i in r["ingredients"])


def test_pasted_text_too_short():
    try:
        scraper.parse_pasted("hello")
    except scraper.RecipeImportError:
        return
    raise AssertionError("expected RecipeImportError")


GROUPED = """
<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Buns",
 "recipeIngredient":["360 grams flour","3 large eggs","120 grams powdered sugar","7 ounces cheese"],
 "recipeInstructions":[
  {"@type":"HowToSection","name":"For the Dough","itemListElement":[
    {"@type":"HowToStep","text":"Mix the flour and eggs."},{"@type":"HowToStep","text":"Bake."}]},
  {"@type":"HowToSection","name":"For the Topping","itemListElement":[
    {"@type":"HowToStep","text":"Cream the sugar and cheese."}]}]}
</script></head><body>
<div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name">Brioche Dough</h4>
 <ul><li class="wprm-recipe-ingredient"><span>360</span> <span>grams</span> <span>flour</span></li>
 <li class="wprm-recipe-ingredient"><span>3</span> <span>large</span> <span>eggs</span></li></ul></div>
<div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name">Frosting</h4>
 <ul><li class="wprm-recipe-ingredient">120 grams powdered sugar</li>
 <li class="wprm-recipe-ingredient">7 ounces cheese</li></ul></div>
<div class="wprm-recipe-instruction-group"><h4 class="wprm-recipe-group-name wprm-recipe-instruction-group-name">For the Dough</h4></div>
</body></html>
"""


def test_ingredient_groups_come_from_the_page():
    r = scraper.parse_page(GROUPED, "https://example.com/buns")
    assert r["ingredients"] == [
        "## Brioche Dough",
        "360 grams flour",
        "3 large eggs",
        "## Frosting",
        "120 grams powdered sugar",
        "7 ounces cheese",
    ]
    sections = [s["text"] for s in r["instructions"] if isinstance(s, dict) and s.get("section")]
    # step sections that line up with the groups take the groups' names
    assert sections == ["Brioche Dough", "Frosting"]


def test_ingredient_groups_ignored_when_items_do_not_match():
    page = GROUPED.replace('<li class="wprm-recipe-ingredient">7 ounces cheese</li>', "")
    r = scraper.parse_page(page, "https://example.com/buns")
    assert not any(str(i).startswith("## ") for i in r["ingredients"])
