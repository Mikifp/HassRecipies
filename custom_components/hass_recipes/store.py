"""Persistent recipe storage."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    EVENT_RECIPE_ADDED,
    EVENT_RECIPE_DELETED,
    EVENT_RECIPE_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .ingredients import parse_ingredient

# Fields a client may set on a recipe.
EDITABLE_FIELDS = (
    "name",
    "description",
    "image",
    "ingredients",
    "instructions",
    "tags",
    "categories",
    "tools",
    "servings",
    "yield_amount",
    "yield_unit",
    "default_scale",
    "prep_time",
    "cook_time",
    "total_time",
    "source_url",
    "notes",
)


def normalize_step(step: Any) -> dict[str, Any]:
    """Return a step as {"text", "ingredients", "timer"}.

    ``ingredients`` are indexes into the recipe's ingredient list and ``timer``
    is a duration in seconds (or None). Plain strings (older data, imports) are
    accepted too.
    """
    if isinstance(step, str):
        return {"text": step, "ingredients": [], "timer": None, "section": False}
    if step.get("section"):
        return {"text": step.get("text", ""), "ingredients": [], "timer": None, "section": True}
    links = {i for i in step.get("ingredients", []) if isinstance(i, int) and i >= 0}
    timer = step.get("timer")
    return {
        "text": step.get("text", ""),
        "ingredients": sorted(links),
        "timer": timer if isinstance(timer, int) and timer > 0 else None,
        "section": False,
    }


def _normalize_steps(recipe: dict[str, Any]) -> None:
    """Normalize steps in place and drop links to ingredients that don't exist."""
    count = len(recipe.get("ingredients", []))
    steps = [normalize_step(s) for s in recipe.get("instructions", [])]
    for step in steps:
        step["ingredients"] = [i for i in step["ingredients"] if i < count]
    recipe["instructions"] = steps
    # Derived, never client-editable: recomputed so parser improvements apply.
    recipe["parsed_ingredients"] = [parse_ingredient(i) for i in recipe.get("ingredients", [])]
    recipe.setdefault("categories", [])
    recipe.setdefault("tools", [])
    recipe.setdefault("yield_amount", None)
    recipe.setdefault("yield_unit", "")
    recipe.setdefault("default_scale", 1)


COOKBOOK_FIELDS = ("name", "categories", "tags", "tools", "query")
FACETS = ("tags", "categories", "tools")


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    """Keep only editable fields."""
    return {key: data[key] for key in EDITABLE_FIELDS if key in data}


class RecipeStore:
    """Wraps a HA Store holding all recipes keyed by id."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._recipes: dict[str, dict[str, Any]] = {}
        self._cookbooks: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._recipes = (data or {}).get("recipes", {})
        self._cookbooks = (data or {}).get("cookbooks", {})
        for recipe in self._recipes.values():
            _normalize_steps(recipe)

    def _save(self) -> None:
        self._store.async_delay_save(
            lambda: {"recipes": self._recipes, "cookbooks": self._cookbooks}, 1
        )

    def _fire(self, event: str, recipe: dict[str, Any]) -> None:
        """Announce a change on the HA bus so automations can react."""
        self._hass.bus.async_fire(
            event,
            {
                "recipe_id": recipe["id"],
                "name": recipe["name"],
                "categories": recipe.get("categories", []),
                "tags": recipe.get("tags", []),
            },
        )

    def list(self) -> list[dict[str, Any]]:
        return sorted(self._recipes.values(), key=lambda r: r["name"].casefold())

    def get(self, recipe_id: str) -> dict[str, Any] | None:
        return self._recipes.get(recipe_id)

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC).isoformat()
        recipe = {
            "id": uuid.uuid4().hex,
            "name": "Untitled recipe",
            "description": "",
            "image": "",
            "ingredients": [],
            "instructions": [],
            "tags": [],
            "categories": [],
            "tools": [],
            "servings": "",
            "yield_amount": None,
            "yield_unit": "",
            "default_scale": 1,
            "prep_time": None,
            "cook_time": None,
            "total_time": None,
            "source_url": "",
            "notes": "",
            **_clean(data),
            "created": now,
            "updated": now,
        }
        _normalize_steps(recipe)
        self._recipes[recipe["id"]] = recipe
        self._save()
        self._fire(EVENT_RECIPE_ADDED, recipe)
        return recipe

    def update(self, recipe_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        recipe = self._recipes.get(recipe_id)
        if recipe is None:
            return None
        recipe.update(_clean(data))
        _normalize_steps(recipe)
        recipe["updated"] = datetime.now(UTC).isoformat()
        self._save()
        self._fire(EVENT_RECIPE_UPDATED, recipe)
        return recipe

    def delete(self, recipe_id: str) -> bool:
        recipe = self._recipes.pop(recipe_id, None)
        if recipe is None:
            return False
        self._save()
        self._fire(EVENT_RECIPE_DELETED, recipe)
        return True

    # ---- export / import ----
    def export(self) -> dict[str, Any]:
        """A self-contained document: everything needed to rebuild this library."""
        derived = {"parsed_ingredients"}
        return {
            "format": "hass_recipes",
            "version": 1,
            "exported": datetime.now(UTC).isoformat(),
            "recipes": [
                {k: v for k, v in r.items() if k not in derived} for r in self.list()
            ],
            "cookbooks": [
                {k: v for k, v in c.items() if k != "id"} for c in self.cookbooks()
            ],
        }

    def import_many(
        self, recipes: list[dict[str, Any]], cookbooks: list[dict[str, Any]] | None = None
    ) -> dict[str, int]:
        """Add recipes/cookbooks, skipping ones that already exist (same name + source)."""

        def key(r: dict[str, Any]) -> tuple[str, str]:
            return (str(r.get("name", "")).strip().casefold(), str(r.get("source_url", "")).strip().casefold())

        seen = {key(r) for r in self._recipes.values()}
        added = skipped = 0
        for data in recipes:
            k = key(data)
            if not k[0] or k in seen:
                skipped += 1
                continue
            seen.add(k)
            self.create(data)
            added += 1
        have = {c["name"].casefold() for c in self._cookbooks.values()}
        books = 0
        for book in cookbooks or []:
            name = str(book.get("name", "")).strip()
            if name and name.casefold() not in have:
                have.add(name.casefold())
                self.cookbook_create(book)
                books += 1
        return {"added": added, "skipped": skipped, "cookbooks": books}

    # ---- bulk operations ----
    def bulk_update(
        self,
        recipe_ids: list[str],
        add: dict[str, list[str]],
        remove: dict[str, list[str]],
    ) -> int:
        """Add/remove tags, categories or tools on many recipes; returns recipes touched."""
        now = datetime.now(UTC).isoformat()
        touched = 0
        for recipe_id in dict.fromkeys(recipe_ids):
            recipe = self._recipes.get(recipe_id)
            if recipe is None:
                continue
            for facet in FACETS:
                values = list(recipe.get(facet, []))
                drop = {v.casefold() for v in remove.get(facet, [])}
                values = [v for v in values if v.casefold() not in drop]
                have = {v.casefold() for v in values}
                for value in add.get(facet, []):
                    value = value.strip()
                    if value and value.casefold() not in have:
                        values.append(value)
                        have.add(value.casefold())
                recipe[facet] = values
            recipe["updated"] = now
            touched += 1
        if touched:
            self._save()
        return touched

    def bulk_delete(self, recipe_ids: list[str]) -> int:
        deleted = 0
        for recipe_id in dict.fromkeys(recipe_ids):
            if (recipe := self._recipes.pop(recipe_id, None)) is not None:
                deleted += 1
                self._fire(EVENT_RECIPE_DELETED, recipe)
        if deleted:
            self._save()
        return deleted

    # ---- cookbooks: saved filters over categories / tags / tools / text ----
    def cookbooks(self) -> list[dict[str, Any]]:
        return sorted(self._cookbooks.values(), key=lambda c: c["name"].casefold())

    def cookbook_create(self, data: dict[str, Any]) -> dict[str, Any]:
        cookbook = {
            "id": uuid.uuid4().hex,
            "name": "Cookbook",
            "categories": [],
            "tags": [],
            "tools": [],
            "query": "",
            **{k: data[k] for k in COOKBOOK_FIELDS if k in data},
        }
        self._cookbooks[cookbook["id"]] = cookbook
        self._save()
        return cookbook

    def cookbook_update(self, cookbook_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        cookbook = self._cookbooks.get(cookbook_id)
        if cookbook is None:
            return None
        cookbook.update({k: data[k] for k in COOKBOOK_FIELDS if k in data})
        self._save()
        return cookbook

    def cookbook_delete(self, cookbook_id: str) -> bool:
        if self._cookbooks.pop(cookbook_id, None) is None:
            return False
        self._save()
        return True

    def tags(self) -> list[str]:
        found = {t for r in self._recipes.values() for t in r.get("tags", [])}
        return sorted(found, key=str.casefold)
