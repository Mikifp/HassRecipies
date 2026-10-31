"""A food from a barcode: the code is checked and an Open Food Facts product becomes a food of the user's own."""

import importlib
from pathlib import Path
import sys
import types

pkg = types.ModuleType("hr_b")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_b"] = pkg
bc = importlib.import_module("hr_b.barcode")


def _raises(func, *args):
    try:
        func(*args)
    except bc.BarcodeError as err:
        return str(err)
    raise AssertionError("expected a BarcodeError")


def test_a_barcode_is_digits_only():
    assert bc.clean_code(" 5701234 567890 ") == "5701234567890"
    for bad in ("", "abc", "1234567", "123456789012345", "5701234567890/../x"):
        _raises(bc.clean_code, bad)


def test_a_product_becomes_a_food_with_its_portion_and_pack():
    product = {
        "product_name": "Havregryn",
        "brands": "Quaker, Other",
        "serving_quantity": "40",
        "product_quantity": "1000",
        "nutriments": {"energy-kcal_100g": 372, "proteins_100g": 13, "fat_100g": 7, "carbohydrates_100g": 59, "fiber_100g": 10, "salt_100g": 0.01},
    }
    food = bc.food_from_product(product, "5701234567890")
    assert food["name"] == "Havregryn (Quaker)" and food["barcode"] == "5701234567890" and food["source"] == "custom"
    assert food["values"]["kcal"] == 372 and food["values"]["protein"] == 13 and "sugars" not in food["values"]
    assert food["unit_grams"] == {"portion": 40.0, "pakke": 1000.0}


def test_energy_is_read_from_kilojoules_when_there_are_no_kcal_and_missing_energy_is_refused():
    food = bc.food_from_product({"product_name_da": "Saft", "nutriments": {"energy_100g": 418.4}}, "12345678")
    assert round(food["values"]["kcal"]) == 100
    _raises(bc.food_from_product, {"product_name": "X", "nutriments": {}}, "12345678")
    _raises(bc.food_from_product, {"nutriments": {"energy-kcal_100g": 5}}, "12345678")
