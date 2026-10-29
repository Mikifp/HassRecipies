"""What the user taught the nutrition calculation: which food an ingredient name is,
and their own custom ingredients. Kept in its own store, beside the recipes."""

from __future__ import annotations

from typing import Any
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import NUTRITION_STORAGE_KEY, STORAGE_VERSION
from .nutrition import (
    SOURCE_CUSTOM,
    SOURCE_FRIDA,
    SOURCE_IGNORE,
    FoodDatabase,
    calculate,
    clean_custom,
    food_key,
    resolve,
    search,
)
from .store import RecipeStore

MAX_UNIT_GRAMS = 10000


class NutritionError(ValueError):
    """Raised for a link or custom ingredient that cannot be saved."""


class Nutrition:
    """Links (ingredient name -> food) and custom ingredients, plus the Frida data."""

    def __init__(self, hass: HomeAssistant, recipes: RecipeStore, db: FoodDatabase) -> None:
        self._hass = hass
        self._recipes = recipes
        self.db = db
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, NUTRITION_STORAGE_KEY)
        self._links: dict[str, dict[str, Any]] = {}
        self._custom: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._links = {k: v for k, v in (data.get("links") or {}).items() if isinstance(v, dict)}
        self._custom = {k: v for k, v in (data.get("custom") or {}).items() if isinstance(v, dict) and v.get("id")}

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"links": self._links, "custom": self._custom}, 1)

    # ---- reading ----
    def for_recipe(self, recipe_id: str) -> dict[str, Any] | None:
        recipe = self._recipes.get(recipe_id)
        if recipe is None:
            return None
        return calculate(recipe, recipe.get("parsed_ingredients") or [], self.db, self._custom, self._links)

    def search(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        return search(self.db, self._custom, query, limit)

    def custom_foods(self) -> list[dict[str, Any]]:
        return sorted(self._custom.values(), key=lambda f: f["name"].casefold())

    def links(self) -> dict[str, dict[str, Any]]:
        return dict(self._links)

    # ---- links ----
    def set_link(
        self,
        food: str,
        source: str | None,
        food_id: Any = None,
        unit_grams: dict[str, float] | None = None,
    ) -> dict[str, Any] | None:
        """Say which food an ingredient name is (``source=None`` forgets it).

        ``unit_grams`` ({"can": 400}) gives the weight of one unit the parser cannot
        weigh by itself; it is kept with the link.
        """
        key = food_key(food)
        if not key:
            raise NutritionError("An ingredient name is needed")
        if source is None:
            self._links.pop(key, None)
            self._save()
            return None
        if source == SOURCE_FRIDA:
            if self.db.get(food_id) is None:
                raise NutritionError(f"Unknown Frida food: {food_id!r}")
            food_id = int(food_id)
        elif source == SOURCE_CUSTOM:
            if str(food_id) not in self._custom:
                raise NutritionError(f"Unknown custom ingredient: {food_id!r}")
            food_id = str(food_id)
        elif source == SOURCE_IGNORE:
            food_id = None
        else:
            raise NutritionError(f"Unknown source: {source!r}")
        grams = {
            str(unit): float(value)
            for unit, value in (unit_grams or {}).items()
            if isinstance(value, (int, float)) and 0 < value <= MAX_UNIT_GRAMS
        }
        link: dict[str, Any] = {"source": source, "id": food_id}
        if grams:
            link["unit_grams"] = grams
        self._links[key] = link
        self._save()
        return link

    def set_unit_grams(self, food: str, unit: str, grams: float | None) -> None:
        """Remember what one unit of this food weighs, keeping (or creating) its link.

        Without a link yet, the food the calculation uses now (a default or a clear
        search hit) becomes the link, so giving a weight also confirms the food.
        """
        key = food_key(food)
        link = dict(self._links.get(key) or {})
        if not link:
            current = resolve(self.db, self._custom, self._links, food)
            if not current or current.get("source") not in (SOURCE_FRIDA, SOURCE_CUSTOM):
                raise NutritionError("Choose the food first")
            link = {"source": current["source"], "id": current["id"]}
        unit_grams = dict(link.get("unit_grams") or {})
        if grams is None:
            unit_grams.pop(unit, None)
        elif 0 < grams <= MAX_UNIT_GRAMS:
            unit_grams[unit] = float(grams)
        else:
            raise NutritionError("Weight must be between 0 and 10 kg")
        link["unit_grams"] = unit_grams
        if not unit_grams:
            link.pop("unit_grams")
        self._links[key] = link
        self._save()

    # ---- custom ingredients ----
    def save_custom(self, data: dict[str, Any], food_id: str | None = None) -> dict[str, Any]:
        food = clean_custom(data)
        if not food["name"]:
            raise NutritionError("A custom ingredient needs a name")
        if food["kcal"] is None:
            raise NutritionError("A custom ingredient needs its energy (kcal per 100 g)")
        if food_id is not None and food_id not in self._custom:
            raise NutritionError(f"Unknown custom ingredient: {food_id!r}")
        food["id"] = food_id or uuid.uuid4().hex
        self._custom[food["id"]] = food
        self._save()
        return food

    def delete_custom(self, food_id: str) -> bool:
        if self._custom.pop(food_id, None) is None:
            return False
        # links to it would point at nothing; forget them so the name is matched afresh
        self._links = {
            k: v for k, v in self._links.items() if not (v.get("source") == SOURCE_CUSTOM and v.get("id") == food_id)
        }
        self._save()
        return True

    # ---- export / import (part of the recipe backup) ----
    def export(self) -> dict[str, Any]:
        return {"links": self._links, "custom": list(self._custom.values())}

    def import_data(self, data: dict[str, Any] | None) -> int:
        """Add custom ingredients and links from an export; existing ones are kept."""
        if not isinstance(data, dict):
            return 0
        added = 0
        ids: dict[str, str] = {}
        names = {food_key(f["name"]): f["id"] for f in self._custom.values()}
        for item in data.get("custom") or []:
            if not isinstance(item, dict):
                continue
            food = clean_custom(item)
            if not food["name"] or food["kcal"] is None:
                continue
            existing = names.get(food_key(food["name"]))
            if existing:
                ids[str(item.get("id"))] = existing
                continue
            food["id"] = uuid.uuid4().hex
            self._custom[food["id"]] = food
            names[food_key(food["name"])] = food["id"]
            ids[str(item.get("id"))] = food["id"]
            added += 1
        for key, link in (data.get("links") or {}).items():
            key = food_key(key)
            if not key or key in self._links or not isinstance(link, dict):
                continue
            source = link.get("source")
            if source == SOURCE_CUSTOM:
                if str(link.get("id")) not in ids:
                    continue
                link = {**link, "id": ids[str(link.get("id"))]}
            elif source == SOURCE_FRIDA:
                if self.db.get(link.get("id")) is None:
                    continue
            elif source != SOURCE_IGNORE:
                continue
            self._links[key] = {k: link[k] for k in ("source", "id", "unit_grams") if k in link}
        self._save()
        return added
