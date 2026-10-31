"""A packaged food from its barcode, read from Open Food Facts (https://world.openfoodfacts.org, ODbL).

Only the lookup of one scanned product is done, never a bulk copy, as the project asks. The product becomes
one of the user's own foods (values per 100 g, and the weight of one portion or pack when the label has it).
Free of Home Assistant imports, so it can be tested on its own.
"""

from __future__ import annotations

import re
from typing import Any

API_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = "product_name,product_name_da,brands,nutriments,serving_quantity,product_quantity"
USER_AGENT = "HassRecipes (Home Assistant integration; https://github.com/Mikifp/HassRecipies)"
_CODE = re.compile(r"^\d{8,14}$")
KJ_PER_KCAL = 4.184

# our nutrient -> the Open Food Facts nutriment (per 100 g)
_NUTRIMENTS = {
    "protein": "proteins_100g",
    "fat": "fat_100g",
    "carbs": "carbohydrates_100g",
    "fibre": "fiber_100g",
    "sugars": "sugars_100g",
    "sat_fat": "saturated-fat_100g",
    "salt": "salt_100g",
}


class BarcodeError(ValueError):
    """A barcode that cannot be looked up, or a product that cannot be used."""


def clean_code(code: Any) -> str:
    code = re.sub(r"\s+", "", str(code or ""))
    if not _CODE.match(code):
        raise BarcodeError("A barcode has 8 to 14 digits")
    return code


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def food_from_product(product: dict[str, Any], code: str) -> dict[str, Any]:
    """The data of a custom food from an Open Food Facts product."""
    name = str(product.get("product_name_da") or product.get("product_name") or "").strip()
    if not name:
        raise BarcodeError("This product has no name in Open Food Facts")
    brand = str(product.get("brands") or "").split(",")[0].strip()
    if brand and brand.casefold() not in name.casefold():
        name = f"{name} ({brand})"
    nutriments = product.get("nutriments") or {}
    kcal = _number(nutriments.get("energy-kcal_100g"))
    if kcal is None:
        kj = _number(nutriments.get("energy_100g"))
        kcal = None if kj is None else kj / KJ_PER_KCAL
    if kcal is None:
        raise BarcodeError("This product has no energy value in Open Food Facts")
    values: dict[str, Any] = {"kcal": round(kcal, 1)}
    for key, source in _NUTRIMENTS.items():
        number = _number(nutriments.get(source))
        if number is not None:
            values[key] = round(number, 2)
    unit_grams: dict[str, float] = {}
    portion = _number(product.get("serving_quantity"))
    if portion and portion > 0:
        unit_grams["portion"] = portion
    pack = _number(product.get("product_quantity"))
    if pack and pack > 0 and pack != portion:
        unit_grams["pakke"] = pack
    return {"name": name[:120], "source": "custom", "values": values, "unit_grams": unit_grams, "barcode": code}
