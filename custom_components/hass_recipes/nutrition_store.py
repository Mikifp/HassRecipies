"""The user's foods and what the nutrition calculation knows about them. Kept in its own store,
beside the recipes.

The foods (``foods.py``) are the source of truth. The calculation still reads *custom ingredients*
and *links* (ingredient name -> food); they are derived from the foods, so older data and the
panel's Check ingredients page keep working.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import NUTRITION_STORAGE_KEY, STORAGE_VERSION
from .foods import SOURCE_NONE, FoodBook, FoodError, clean_unit_grams
from .nutrition import (
    NUTRIENTS,
    SOURCE_CUSTOM,
    SOURCE_FRIDA,
    SOURCE_IGNORE,
    FoodDatabase,
    calculate,
    clean_custom,
    describe,
    food_key,
    resolve,
    search,
)
from .store import RecipeStore

MAX_UNIT_GRAMS = 10000


class NutritionError(ValueError):
    """Raised for a link, food or custom ingredient that cannot be saved."""


class Nutrition:
    """The foods, and the calculation that uses them, plus the Frida data."""

    def __init__(self, hass: HomeAssistant, recipes: RecipeStore, db: FoodDatabase) -> None:
        self._hass = hass
        self._recipes = recipes
        self.db = db
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, NUTRITION_STORAGE_KEY)
        self.book = FoodBook(db)
        self._derived: tuple[dict, dict] | None = None

    async def async_load(self) -> None:
        # older data (links and custom ingredients) is turned into foods the first time it is read
        self.book = FoodBook.from_data(self.db, await self._store.async_load())
        self._derived = None

    def _save(self) -> None:
        self._derived = None
        self._store.async_delay_save(self.book.to_data, 1)

    def _views(self) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        if self._derived is None:
            self._derived = (self.book.custom(), self.book.links())
        return self._derived

    # ---- reading ----
    def for_recipe(self, recipe_id: str) -> dict[str, Any] | None:
        recipe = self._recipes.get(recipe_id)
        if recipe is None:
            return None
        custom, links = self._views()
        return calculate(recipe, recipe.get("parsed_ingredients") or [], self.db, custom, links)

    def search(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        return search(self.db, self._views()[0], query, limit)

    def custom_foods(self) -> list[dict[str, Any]]:
        return sorted(self._views()[0].values(), key=lambda f: f["name"].casefold())

    def links(self) -> dict[str, dict[str, Any]]:
        return dict(self._views()[1])

    # ---- links ----
    def set_link(
        self,
        food: str,
        source: str | None,
        food_id: Any = None,
        unit_grams: dict[str, float] | None = None,
    ) -> dict[str, Any] | None:
        """Say which food an ingredient name is (``source=None`` forgets it).

        ``unit_grams`` ({"dåse": 400}) gives the weight of one unit the parser cannot weigh by
        itself; it is kept with the food.
        """
        key = food_key(food)
        if not key:
            raise NutritionError("An ingredient name is needed")
        try:
            if source is None:
                self.book.unlink_key(key)
            elif source == SOURCE_IGNORE:
                self.book.ignore_key(key)
            elif source == SOURCE_FRIDA:
                if self.db.get(food_id) is None:
                    raise NutritionError(f"Unknown Frida food: {food_id!r}")
                target = self.book.ensure_frida_food(int(food_id), key)
                self.book.link_key(key, target["id"], unit_grams)
            elif source == SOURCE_CUSTOM:
                target = self.book.foods.get(str(food_id))
                if target is None or target["source"] != SOURCE_CUSTOM:
                    raise NutritionError(f"Unknown custom ingredient: {food_id!r}")
                self.book.link_key(key, target["id"], unit_grams)
            else:
                raise NutritionError(f"Unknown source: {source!r}")
        except FoodError as err:
            raise NutritionError(str(err)) from err
        self._save()
        return self.links().get(key)

    def set_unit_grams(self, food: str, unit: str, grams: float | None) -> None:
        """Remember what one unit of this food weighs.

        Without a food yet, the one the calculation uses now (a standard choice or a clear search
        hit) becomes the food, so giving a weight also confirms it.
        """
        key = food_key(food)
        found = self.book.food_for_key(key)
        if found is None:
            current = resolve(self.db, *self._views(), food)
            if not current or current.get("source") not in (SOURCE_FRIDA, SOURCE_CUSTOM):
                raise NutritionError("Choose the food first")
            if current["source"] == SOURCE_FRIDA:
                found = self.book.ensure_frida_food(int(current["id"]), key)
                self.book.link_key(key, found["id"])
            else:
                found = self.book.foods.get(str(current["id"]))
                if found is None:
                    raise NutritionError("Choose the food first")
                self.book.link_key(key, found["id"])
        unit_grams = dict(found["unit_grams"])
        if grams is None:
            unit_grams.pop(unit, None)
        elif 0 < grams <= MAX_UNIT_GRAMS:
            unit_grams[unit] = float(grams)
        else:
            raise NutritionError("Weight must be between 0 and 10 kg")
        found["unit_grams"] = clean_unit_grams(unit_grams)
        self._save()

    # ---- custom ingredients (foods with values of their own) ----
    def save_custom(self, data: dict[str, Any], food_id: str | None = None) -> dict[str, Any]:
        food = clean_custom(data)
        if not food["name"]:
            raise NutritionError("A custom ingredient needs a name")
        if food["kcal"] is None:
            raise NutritionError("A custom ingredient needs its energy (kcal per 100 g)")
        try:
            if food_id is not None:
                current = self.book.foods.get(food_id)
                if current is None or current["source"] != SOURCE_CUSTOM:
                    raise NutritionError(f"Unknown custom ingredient: {food_id!r}")
                saved = self.book.update(food_id, {"name": food["name"], "values": food})
            else:
                saved = self.book.create({"name": food["name"], "source": SOURCE_CUSTOM, "values": food})
        except FoodError as err:
            raise NutritionError(str(err)) from err
        self._save()
        return self.book.custom()[saved["id"]]

    def delete_custom(self, food_id: str) -> bool:
        food = self.book.foods.get(food_id)
        if food is None or food["source"] != SOURCE_CUSTOM:
            return False
        self.book.delete(food_id)
        self._save()
        return True

    # ---- the foods themselves ----
    def _usage(self) -> tuple[dict[str, set[str]], dict[str, Counter]]:
        """Which recipes use each ingredient name (as a key), and how it is written there."""
        used: dict[str, set[str]] = {}
        written: dict[str, Counter] = {}
        for recipe in self._recipes.list():
            for parsed in recipe.get("parsed_ingredients") or []:
                if parsed.get("header"):
                    continue
                text = parsed.get("food") or parsed.get("text", "")
                key = food_key(text)
                if not key:
                    continue
                used.setdefault(key, set()).add(recipe["id"])
                written.setdefault(key, Counter())[text.strip()] += 1
        return used, written

    def _describe_food(self, food: dict[str, Any], used: dict[str, set[str]]) -> dict[str, Any]:
        frida = self.db.get(food["frida_id"]) if food["source"] == SOURCE_FRIDA else None
        values = (
            {k: frida.get(k) for k in NUTRIENTS}
            if frida
            else {k: food["values"].get(k) for k in NUTRIENTS}
        )
        recipes: set[str] = set()
        for key in self.book._keys(food):
            recipes |= used.get(key, set())
        return {
            "id": food["id"],
            "name": food["name"],
            "aliases": list(food["aliases"]),
            "source": food["source"] if (frida or food["source"] != SOURCE_FRIDA) else SOURCE_NONE,
            "frida_id": food["frida_id"],
            "frida_name": frida["name_da"] if frida else "",
            "values": values,
            "unit_grams": dict(food["unit_grams"]),
            "section": food["section"],
            "used_in": len(recipes),
            "recipes": sorted(recipes)[:30],
        }

    def foods_overview(self) -> dict[str, Any]:
        """Every food, and the ingredient names in recipes that are not a food yet (with a suggestion)."""
        used, written = self._usage()
        foods = sorted((self._describe_food(f, used) for f in self.book.foods.values()), key=lambda f: f["name"].casefold())
        known = self.book.by_key()
        custom, links = self._views()
        review = []
        for key, recipes in used.items():
            if key in known or key in self.book.ignored:
                continue
            guess = resolve(self.db, custom, links, key)
            suggestion = None
            if guess and guess.get("source") in (SOURCE_FRIDA, SOURCE_CUSTOM):
                suggestion = {
                    **{k: guess[k] for k in ("source", "id", "name", "name_en", "group", *NUTRIENTS)},
                    # "standard": an everyday word with a standard choice; "guess": the best search hit
                    "confidence": "standard" if guess.get("default") else "guess",
                }
            review.append(
                {
                    "key": key,
                    "name": written[key].most_common(1)[0][0],
                    "used_in": len(recipes),
                    "recipes": sorted(recipes)[:10],
                    "suggestion": suggestion,
                }
            )
        review.sort(key=lambda r: (-r["used_in"], r["key"]))
        return {
            "foods": foods,
            "review": review,
            "ignored": list(self.book.ignored),
            "counts": {
                "foods": len(foods),
                "mine": sum(1 for f in foods if f["source"] == SOURCE_CUSTOM),
                "frida": sum(1 for f in foods if f["source"] == SOURCE_FRIDA),
                "none": sum(1 for f in foods if f["source"] == SOURCE_NONE),
                "review": len(review),
            },
        }

    def save_food(self, data: dict[str, Any], food_id: str | None = None) -> dict[str, Any]:
        """Create a food, or change one (only what is given changes)."""
        try:
            saved = self.book.update(food_id, data) if food_id else self.book.create(data)
        except FoodError as err:
            raise NutritionError(str(err)) from err
        self._save()
        return self._describe_food(saved, self._usage()[0])

    def delete_food(self, food_id: str) -> bool:
        if not self.book.delete(food_id):
            return False
        self._save()
        return True

    def merge_foods(self, target_id: str, source_ids: list[str]) -> dict[str, Any]:
        try:
            merged = self.book.merge(target_id, source_ids)
        except FoodError as err:
            raise NutritionError(str(err)) from err
        self._save()
        return self._describe_food(merged, self._usage()[0])

    def link_to_food(self, key: str, food_id: str) -> dict[str, Any]:
        """Say that an ingredient name is one of the user's foods (it becomes another name of it)."""
        try:
            food = self.book.link_key(key, food_id)
        except FoodError as err:
            raise NutritionError(str(err)) from err
        self._save()
        return self._describe_food(food, self._usage()[0])

    def adopt(self, keys: list[str]) -> int:
        """Make foods of ingredient names, the way the calculation already reads them (suggestions accepted)."""
        done = 0
        for raw in keys:
            key = food_key(raw)
            if not key or self.book.food_for_key(key):
                continue
            guess = resolve(self.db, *self._views(), key)
            if not guess:
                continue
            try:
                if guess["source"] == SOURCE_FRIDA:
                    food = self.book.ensure_frida_food(int(guess["id"]), key)
                    self.book.link_key(key, food["id"])
                elif guess["source"] == SOURCE_CUSTOM and str(guess["id"]) in self.book.foods:
                    self.book.link_key(key, str(guess["id"]))
                else:
                    continue
            except FoodError:
                continue
            done += 1
        if done:
            self._save()
        return done

    # ---- export / import (part of the recipe backup) ----
    def export(self) -> dict[str, Any]:
        # the older keys keep a backup readable by the version before the foods
        return {**self.book.to_data(), "links": self.links(), "custom": list(self._views()[0].values())}

    def import_data(self, data: dict[str, Any] | None) -> int:
        """Add foods from an export; the foods already here are kept (a name that matches is one food)."""
        if not isinstance(data, dict):
            return 0
        other = FoodBook.from_data(self.db, data)
        added = self.book.merge_book(other)
        self._save()
        return added


__all__ = ["Nutrition", "NutritionError", "SOURCE_NONE", "describe"]
