"""Persistent recipe storage."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    EVENT_COOKING_RECIPE_CHANGED,
    EVENT_RECIPE_ADDED,
    EVENT_RECIPE_DELETED,
    EVENT_RECIPE_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .ingredients import is_header, parse_ingredient

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


MAX_TIMER_SECONDS = 7 * 86400


def normalize_timers(step: dict[str, Any]) -> list[dict[str, Any]]:
    """A step's timers as [{"seconds", "label"}], from ``timers`` or the older ``timer``."""
    found: list[dict[str, Any]] = []
    raw = step.get("timers")
    for item in raw if isinstance(raw, list) else []:
        seconds, label = (item, "") if not isinstance(item, dict) else (item.get("seconds"), item.get("label", ""))
        if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds > 0:
            found.append({"seconds": int(min(seconds, MAX_TIMER_SECONDS)), "label": str(label or "").strip()[:60]})
    if not found:
        legacy = step.get("timer")
        if isinstance(legacy, (int, float)) and not isinstance(legacy, bool) and legacy > 0:
            found.append({"seconds": int(min(legacy, MAX_TIMER_SECONDS)), "label": ""})
    return found


def normalize_step(step: Any) -> dict[str, Any]:
    """Return a step as {"text", "ingredients", "timer", "timers"}.

    ``ingredients`` are indexes into the recipe's ingredient list. ``timers`` is any
    number of {"seconds", "label"}; ``timer`` is the first one's duration (or None),
    kept for older clients. Plain strings (older data, imports) are accepted too.
    """
    if isinstance(step, str):
        return {"text": step, "ingredients": [], "timer": None, "timers": [], "section": False}
    if step.get("section"):
        return {"text": step.get("text", ""), "ingredients": [], "timer": None, "timers": [], "section": True}
    links = {i for i in step.get("ingredients", []) if isinstance(i, int) and i >= 0}
    timers = normalize_timers(step)
    return {
        "text": step.get("text", ""),
        "ingredients": sorted(links),
        "timer": timers[0]["seconds"] if timers else None,
        "timers": timers,
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


def step_timer_specs(
    recipe_id: str, recipe_name: str, step_number: int, step_index: int, timers: list[dict[str, Any]]
) -> list[tuple[str, str, int]]:
    """(key, label, seconds) for each timer of a step.

    The first timer keeps the key ``<recipe>:<step>`` that single timers always had, so
    a timer started before an update is still recognised; later ones add ``:<n>``.
    """
    specs = []
    for n, timer in enumerate(timers):
        key = f"{recipe_id}:{step_index}" + (f":{n}" if n else "")
        label = f"{recipe_name} · step {step_number}"
        if timer.get("label"):
            label += f" · {timer['label']}"
        elif len(timers) > 1:
            label += f" · timer {n + 1}"
        specs.append((key, label, int(timer["seconds"])))
    return specs


def cooking_pages(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    """What a cook card steps through: an ingredients page, then each real step.

    Section headings are skipped. The index into this list is the "cooking step".
    """
    pages: list[dict[str, Any]] = []
    if any(not is_header(i) for i in recipe.get("ingredients", [])):
        pages.append({"kind": "ingredients"})
    for index, step in enumerate(recipe.get("instructions", [])):
        step = normalize_step(step)
        if step.get("section"):
            continue
        pages.append(
            {
                "kind": "step",
                "index": index,
                "text": step.get("text", ""),
                "timer": step.get("timer"),
                "timers": step.get("timers") or [],
                "ingredients": step.get("ingredients", []),
            }
        )
    return pages


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
        self._cooking_id: str | None = None  # recipe shown by the dashboard cook cards
        self._cooking_step = 0  # page within it (see cooking_pages)
        self._cooking_scale = 1.0  # multiplier, shared by every card and voice answer

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._recipes = (data or {}).get("recipes", {})
        self._cookbooks = (data or {}).get("cookbooks", {})
        cooking = (data or {}).get("cooking_recipe_id")
        self._cooking_id = cooking if cooking in self._recipes else None
        self._cooking_step = int((data or {}).get("cooking_step") or 0) if self._cooking_id else 0
        self._cooking_scale = float((data or {}).get("cooking_scale") or 1) if self._cooking_id else 1.0
        for recipe in self._recipes.values():
            _normalize_steps(recipe)

    def _save(self) -> None:
        self._store.async_delay_save(
            lambda: {
                "recipes": self._recipes,
                "cookbooks": self._cookbooks,
                "cooking_recipe_id": self._cooking_id,
                "cooking_step": self._cooking_step,
                "cooking_scale": self._cooking_scale,
            },
            1,
        )

    @property
    def cooking_recipe_id(self) -> str | None:
        return self._cooking_id

    @property
    def cooking_step(self) -> int:
        return self._cooking_step

    @property
    def cooking_scale(self) -> float:
        return self._cooking_scale

    def cooking_state(self) -> dict[str, Any]:
        recipe = self._recipes.get(self._cooking_id or "")
        pages = cooking_pages(recipe) if recipe else []
        return {
            "recipe_id": self._cooking_id,
            "step": self._cooking_step,
            "scale": self._cooking_scale,
            "pages": len(pages),
        }

    def set_cooking(
        self,
        recipe_id: str | None | type[Ellipsis] = ...,
        step: int | None = None,
        scale: float | None = None,
        delta: int = 0,
    ) -> bool:
        """Choose the recipe the cook cards show, and where in it they are.

        ``recipe_id=None`` clears it. Choosing a recipe starts at its first page and
        its own default scale unless ``step`` / ``scale`` say otherwise.
        """
        if recipe_id is not ... and recipe_id is not None and recipe_id not in self._recipes:
            return False
        before = (self._cooking_id, self._cooking_step, self._cooking_scale)
        if recipe_id is not ...:
            if recipe_id != self._cooking_id:
                self._cooking_id = recipe_id
                recipe = self._recipes.get(recipe_id or "")
                self._cooking_step = 0
                self._cooking_scale = float((recipe or {}).get("default_scale") or 1)
        if self._cooking_id is None:
            self._cooking_step, self._cooking_scale = 0, 1.0
        else:
            if scale is not None and scale > 0:
                self._cooking_scale = float(scale)
            pages = len(cooking_pages(self._recipes[self._cooking_id]))
            wanted = self._cooking_step if step is None else step
            self._cooking_step = max(0, min(wanted + delta, max(pages - 1, 0)))
        if (self._cooking_id, self._cooking_step, self._cooking_scale) != before:
            self._save()
            self._hass.bus.async_fire(
                EVENT_COOKING_RECIPE_CHANGED,
                {
                    "recipe_id": self._cooking_id,
                    "step": self._cooking_step,
                    "scale": self._cooking_scale,
                    "recipe_changed": self._cooking_id != before[0],
                },
            )
        return True

    def set_cooking_recipe(self, recipe_id: str | None) -> bool:
        return self.set_cooking(recipe_id)

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
        if recipe_id == self._cooking_id:
            self.set_cooking_recipe(None)
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
        if self._cooking_id not in self._recipes:
            self.set_cooking_recipe(None)
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
