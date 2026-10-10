"""Tests for import conversion (native, Mealie, Paprika, schema.org, zips)."""

import gzip
import importlib
import io
import json
from pathlib import Path
import sys
import types
import zipfile

# Load custom_components/hass_recipes as a bare package so relative imports work
# without Home Assistant installed.
try:
    import aiohttp  # noqa: F401
except ImportError:
    stub = types.ModuleType("aiohttp")
    stub.ClientError = Exception
    stub.ClientSession = object
    stub.ClientTimeout = lambda **kw: None
    sys.modules["aiohttp"] = stub

pkg = types.ModuleType("hr_pkg")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_pkg"] = pkg
migrate = importlib.import_module("hr_pkg.migrate")

MEALIE = {
    "id": "abc-123", "slug": "pancakes", "name": "Pancakes", "description": "Fluffy",
    "image": "xyz", "recipeYield": "4 servings", "prepTime": "10 minutes",
    "cookTime": "1 Hour 5 Minutes", "totalTime": None, "orgURL": "https://example.com/p",
    "recipeCategory": [{"name": "Breakfast", "slug": "breakfast"}],
    "tags": [{"name": "quick"}], "tools": [{"name": "Pan"}],
    "recipeIngredient": [
        {"quantity": 2.0, "unit": {"name": "cup"}, "food": {"name": "flour"}, "note": "", "display": "2 cups flour", "referenceId": "r1"},
        {"quantity": 1.0, "unit": None, "food": {"name": "egg"}, "note": "", "display": "", "originalText": "1 egg", "referenceId": "r2"},
        {"quantity": 0, "unit": None, "food": None, "note": "pinch of salt", "display": "", "referenceId": "r3"},
    ],
    "recipeInstructions": [
        {"title": "Batter", "text": "Mix flour and egg.", "ingredientReferences": [{"referenceId": "r1"}, {"referenceId": "r2"}, {"referenceId": "nope"}]},
        {"title": "", "text": "Fry.", "ingredientReferences": []},
    ],
    "notes": [{"title": "Tip", "text": "Rest the batter"}],
}

PAPRIKA = {
    "name": "Chili", "ingredients": "1 lb beef\n2 cans beans", "directions": "Brown beef.\n\nSimmer 1 hour.",
    "servings": "6", "prep_time": "15 min", "cook_time": "1 hr", "categories": ["Dinner"],
    "source_url": "https://example.com/chili", "notes": "Spicy", "source": "Grandma",
}

SCHEMA = {
    "@context": "https://schema.org", "@type": "Recipe", "name": "Toast",
    "recipeIngredient": ["2 slices bread"], "recipeInstructions": [{"@type": "HowToStep", "text": "Toast it."}],
    "recipeCategory": "Breakfast",
}


def test_mealie_conversion():
    [r] = migrate.convert(MEALIE, "https://mealie.local")
    assert r["name"] == "Pancakes" and r["servings"] == "4 servings"
    assert r["ingredients"] == ["2 cups flour", "1 egg", "pinch of salt"]
    assert (r["prep_time"], r["cook_time"], r["total_time"]) == (10, 65, None)
    assert r["categories"] == ["Breakfast"] and r["tags"] == ["quick"] and r["tools"] == ["Pan"]
    assert r["instructions"][0] == {"text": "Batter", "ingredients": [], "timer": None, "section": True}
    assert r["instructions"][1] == {"text": "Mix flour and egg.", "ingredients": [0, 1], "timer": None}
    assert r["image"] == "https://mealie.local/api/media/recipes/abc-123/images/original.webp"
    assert r["source_url"] == "https://example.com/p"
    assert "Rest the batter" in r["notes"]


def test_paprika_conversion():
    [r] = migrate.convert(PAPRIKA)
    assert r["ingredients"] == ["1 lb beef", "2 cans beans"]
    assert [s["text"] for s in r["instructions"]] == ["Brown beef.", "Simmer 1 hour."]
    assert (r["prep_time"], r["cook_time"]) == (15, 60)
    assert r["categories"] == ["Dinner"] and "Grandma" in r["notes"]


def test_schema_org_conversion():
    [r] = migrate.convert(SCHEMA)
    assert r["name"] == "Toast" and r["ingredients"] == ["2 slices bread"]
    assert r["instructions"] == ["Toast it."] and r["categories"] == ["Breakfast"]


def test_native_roundtrip_document():
    doc = {"format": "hass_recipes", "version": 1,
           "recipes": [{"name": "A", "ingredients": ["1 egg"], "instructions": []}],
           "cookbooks": [{"name": "Quick", "tags": ["quick"]}]}
    recipes, books = migrate.parse_upload(json.dumps(doc).encode())
    assert [r["name"] for r in recipes] == ["A"] and books[0]["name"] == "Quick"


def test_paprikarecipes_archive():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Chili.paprikarecipe", gzip.compress(json.dumps(PAPRIKA).encode()))
        zf.writestr("Toast.paprikarecipe", gzip.compress(json.dumps({**PAPRIKA, "name": "Beans"}).encode()))
    recipes, _ = migrate.parse_upload(buf.getvalue())
    assert sorted(r["name"] for r in recipes) == ["Beans", "Chili"]


def test_mealie_zip_with_recipe_json_and_images():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pancakes/pancakes.json", json.dumps(MEALIE))
        zf.writestr("pancakes/images/original.webp", b"\x00\x01binary")
    recipes, _ = migrate.parse_upload(buf.getvalue())
    assert [r["name"] for r in recipes] == ["Pancakes"]


def test_rejects_garbage():
    for blob in (b"not json at all", b"{}", b"[]"):
        try:
            migrate.parse_upload(blob)
        except migrate.MigrationError:
            continue
        raise AssertionError(f"accepted {blob!r}")


def test_mealie_file_export_uses_snake_case():
    """Mealie's zip export dumps the model without aliases (snake_case keys)."""
    snake = {
        "id": "abc-123", "slug": "pancakes", "name": "Pancakes", "image": "xyz",
        "recipe_yield": "4 servings", "prep_time": "10 minutes", "cook_time": "1 Hour 5 Minutes",
        "org_url": "https://example.com/p",
        "recipe_category": [{"name": "Breakfast", "slug": "breakfast"}],
        "tags": [{"name": "quick"}], "tools": [],
        "recipe_ingredient": [
            {"quantity": 2.0, "unit": {"name": "cup"}, "food": {"name": "flour"}, "note": "",
             "display": "2 cups flour", "original_text": None, "reference_id": "r1"},
        ],
        "recipe_instructions": [
            {"title": "", "text": "Mix.", "ingredient_references": [{"reference_id": "r1"}]},
        ],
        "notes": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("recipes/pancakes/pancakes.json", json.dumps(snake))
        zf.writestr("recipes/pancakes/images/original.webp", b"\x00")
    [r], _ = migrate.parse_upload(buf.getvalue())
    assert r["name"] == "Pancakes" and r["servings"] == "4 servings"
    assert r["ingredients"] == ["2 cups flour"]
    assert r["instructions"] == [{"text": "Mix.", "ingredients": [0], "timer": None}]
    assert (r["prep_time"], r["cook_time"]) == (10, 65)
    assert r["categories"] == ["Breakfast"] and r["tags"] == ["quick"]
    assert r["source_url"] == "https://example.com/p"
    # a bare .json of the same shape works too
    [r2], _ = migrate.parse_upload(json.dumps(snake).encode())
    assert r2["name"] == "Pancakes"


WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 20


def test_images_are_attached_from_mealie_zip_and_paprika():
    import base64

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("recipes/pancakes/pancakes.json", json.dumps(MEALIE))
        zf.writestr("recipes/pancakes/images/min-original.webp", b"RIFFthumb")
        zf.writestr("recipes/pancakes/images/original.webp", WEBP)
    [r], _ = migrate.parse_upload(buf.getvalue())
    assert r["_image"] == WEBP  # prefers "original" over the thumbnail

    paprika = {**PAPRIKA, "photo_data": base64.b64encode(JPEG).decode()}
    [p], _ = migrate.parse_upload(json.dumps(paprika).encode())
    assert p["_image"] == JPEG


def test_native_export_embeds_images():
    import base64

    doc = {"format": "hass_recipes", "version": 1, "cookbooks": [],
           "recipes": [{"name": "A", "ingredients": [], "instructions": [],
                        "image_data": base64.b64encode(JPEG).decode()}]}
    [r], _ = migrate.parse_upload(json.dumps(doc).encode())
    assert r["_image"] == JPEG and "image_data" not in r
