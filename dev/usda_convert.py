"""Convert USDA FoodData Central Foundation Foods into the compact file the integration ships with:
custom_components/hass_recipes/data/usda.json.

Download "Foundation Foods" (JSON) from https://fdc.nal.usda.gov/download-datasets, unzip it, and run:

    python dev/usda_convert.py path/to/FoodData_Central_foundation_food_json_2026-10-29.json 2026-10-29 "October 2026"

FoodData Central is public domain (CC0 1.0). The credit the USDA asks for is stored in the output
file and shown in the panel wherever nutrition is displayed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).parents[1] / "custom_components/hass_recipes/data/usda.json"

# output key -> USDA nutrient ids to try in order (all per 100 g edible part)
NUTRIENTS = {
    "kcal": (1008, 2047, 2048),  # Energy; the Atwater general / specific factor values when there is no plain energy
    "protein": (1003,),
    "fat": (1004, 1085),  # Total lipid (fat); the labelling value when missing
    "carbs": (1005, 1050),  # by difference; by summation when missing
    "fibre": (1079, 2033),
    "sugars": (2000, 1063),
    "sat_fat": (1258,),
}
SODIUM = 1093  # mg; salt = sodium x 2.5
FIELDS = ["id", "name_en", "group", *NUTRIENTS, "salt"]


def _value(food: dict, ids: tuple[int, ...]) -> float | None:
    by_id = {n["nutrient"]["id"]: n.get("amount") for n in food["foodNutrients"] if n.get("nutrient")}
    for nutrient_id in ids:
        amount = by_id.get(nutrient_id)
        if amount is not None:
            return round(float(amount), 2)
    return None


def main(path: str, version: str, date: str) -> None:
    data = json.loads(Path(path).read_text(encoding="utf-8"))["FoundationFoods"]
    rows = []
    for food in sorted(data, key=lambda f: f["description"].casefold()):
        values = [_value(food, ids) for ids in NUTRIENTS.values()]
        sodium = _value(food, (SODIUM,))
        values.append(None if sodium is None else round(sodium * 2.5 / 1000, 2))
        if values[0] is None:  # no energy at all: nothing to calculate with
            continue
        rows.append([food["fdcId"], food["description"], (food.get("foodCategory") or {}).get("description", ""), *values])
    out = {
        "source": "usda",
        "version": version,
        "date": date,
        "license": "Public domain (CC0 1.0)",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution": f"U.S. Department of Agriculture, Agricultural Research Service. FoodData Central ({date}). Foundation Foods",
        "url": "https://fdc.nal.usda.gov",
        "fields": FIELDS,
        "foods": rows,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} foods, {OUT.stat().st_size / 1024:.0f} KB -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
