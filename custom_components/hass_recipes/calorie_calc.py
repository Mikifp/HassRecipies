"""Energy needs and a calorie target for a pace of weight loss (metric units).

Resting energy is the Mifflin-St Jeor estimate, maintenance is that times an activity factor, and a pace of
weight loss in kg a week is a daily deficit (about 7,700 kcal to a kg of body weight). These are estimates.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

KCAL_PER_KG = 7700.0
ACTIVITY = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "hard": 1.725}
PACES = (0.25, 0.5, 0.75)
# below this a diet is not advised without a doctor (a warning only: the target is still given)
MIN_KCAL = {"female": 1200, "male": 1500}
SEXES = ("female", "male")


class CalcError(ValueError):
    """Numbers that cannot be a person (a weight of zero, an unknown activity)."""


def _positive(value: Any, what: str, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as err:
        raise CalcError(f"{what} must be a number") from err
    if not low <= number <= high:
        raise CalcError(f"{what} must be between {low:g} and {high:g}")
    return number


def bmr(sex: str, weight_kg: float, height_cm: float, age: int) -> float:
    """Resting energy a day (Mifflin-St Jeor)."""
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return base + (5 if sex == "male" else -161)


def macro_split(kcal: float, weight_kg: float) -> dict[str, float]:
    """A starting split for a target: protein 1.6 g a kg, fat a quarter of the energy, carbs the rest."""
    protein = 1.6 * weight_kg
    fat = 0.25 * kcal / 9
    carbs = max(0.0, (kcal - protein * 4 - fat * 9) / 4)
    return {"protein": round(protein), "carbs": round(carbs), "fat": round(fat)}


def calculate(profile: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Resting and maintenance energy and, for each pace, the daily target, a warning and when the target weight is reached."""
    sex = profile.get("sex")
    if sex not in SEXES:
        raise CalcError("Choose female or male")
    activity = profile.get("activity")
    if activity not in ACTIVITY:
        raise CalcError("Choose how active you are")
    age = int(_positive(profile.get("age"), "Age", 14, 110))
    height = _positive(profile.get("height_cm"), "Height", 100, 250)
    weight = _positive(profile.get("weight_kg"), "Weight", 30, 400)
    target = profile.get("target_kg")
    target = None if target in (None, "") else _positive(target, "Target weight", 30, 400)
    resting = bmr(sex, weight, height, age)
    maintenance = resting * ACTIVITY[activity]
    today = today or date.today()
    to_lose = None if target is None else weight - target
    options = []
    for pace in PACES:
        kcal = maintenance - pace * KCAL_PER_KG / 7
        weeks = None if not to_lose or to_lose <= 0 else to_lose / pace
        options.append(
            {
                "pace": pace,
                "kcal": round(kcal),
                "deficit": round(maintenance - kcal),
                "below_minimum": kcal < MIN_KCAL[sex],
                "weeks": None if weeks is None else round(weeks),
                "reached": None if weeks is None else (today + timedelta(days=round(weeks * 7))).isoformat(),
                "macros": macro_split(kcal, weight),
            }
        )
    return {
        "bmr": round(resting),
        "maintenance": round(maintenance),
        "minimum": MIN_KCAL[sex],
        "to_lose": None if to_lose is None else round(to_lose, 1),
        "options": options,
    }


def clean_profile(raw: dict[str, Any]) -> dict[str, Any]:
    """What is stored on a person: the numbers checked (the target weight and the pace are optional)."""
    calculate({**raw, "weight_kg": raw.get("weight_kg") or 70})  # raises for what cannot be a person
    clean: dict[str, Any] = {"sex": raw["sex"], "activity": raw["activity"], "age": int(raw["age"]), "height_cm": float(raw["height_cm"])}
    if raw.get("weight_kg") not in (None, ""):
        clean["weight_kg"] = _positive(raw["weight_kg"], "Weight", 30, 400)
    if raw.get("target_kg") not in (None, ""):
        clean["target_kg"] = _positive(raw["target_kg"], "Target weight", 30, 400)
    if raw.get("pace") not in (None, ""):
        clean["pace"] = _positive(raw["pace"], "Pace", 0.05, 1.5)
    return clean
