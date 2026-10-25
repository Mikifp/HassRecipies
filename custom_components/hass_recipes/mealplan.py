"""A simple meal plan: which recipe is cooked on which day, in which slot.

Entries are kept in their own store. An entry points at a recipe but also keeps the
recipe's name, so deleting a recipe leaves the day's plan readable.
"""

from __future__ import annotations

import copy
from datetime import date, time, timedelta
from typing import Any
import re
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import EVENT_MEAL_PLAN_CHANGED, MEALPLAN_STORAGE_KEY, STORAGE_VERSION
from .localize import slot_name
from .store import RecipeStore

MAX_RANGE_DAYS = 400
MAX_MEALS = 12

# The meals of the day. The user can rename, add, remove and reorder them; the built-in ones have no name
# of their own, so they are shown in the language of the user. ``words`` are what a recipe's categories
# are matched against to choose the meal ("aftensmad" is dinner). Colours are the names Home Assistant's
# own colour picker uses.
DEFAULT_MEALS: tuple[dict[str, Any], ...] = (
    {"id": "breakfast", "name": "", "color": "amber", "time": "07:30", "minutes": 45, "words": ["morgenmad", "breakfast", "brunch"]},
    {"id": "lunch", "name": "", "color": "green", "time": "12:00", "minutes": 60, "words": ["frokost", "lunch"]},
    {"id": "dinner", "name": "", "color": "blue", "time": "18:00", "minutes": 60, "words": ["aftensmad", "dinner", "hovedret", "middag"]},
    {"id": "dessert", "name": "", "color": "pink", "time": "19:30", "minutes": 30, "words": ["dessert", "desert", "efterret", "nachspeise"]},
    {"id": "snack", "name": "", "color": "purple", "time": "15:00", "minutes": 30, "words": ["snack", "mellemmåltid"]},
)
COLORS = frozenset(
    "red pink purple deep-purple indigo blue light-blue cyan teal green light-green lime yellow amber orange "
    "deep-orange brown light-grey grey dark-grey blue-grey black white".split()
)
_TIME = re.compile(r"^(\d{1,2}):(\d{2})(?::\d{2})?$")


class MealPlanError(ValueError):
    """Raised for input that cannot be a plan entry (bad date or slot)."""


def parse_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as err:
        raise MealPlanError(f"Not a valid date: {value!r} (use YYYY-MM-DD)") from err


def parse_time(value: Any) -> time:
    match = _TIME.match(str(value).strip())
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        raise MealPlanError(f"Not a valid time: {value!r} (use HH:MM)")
    return time(int(match.group(1)), int(match.group(2)))


class MealPlan:
    def __init__(self, hass: HomeAssistant, recipes: RecipeStore) -> None:
        self._hass = hass
        self._recipes = recipes
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, MEALPLAN_STORAGE_KEY)
        self._entries: dict[str, dict[str, Any]] = {}
        self._meals: list[dict[str, Any]] = copy.deepcopy(list(DEFAULT_MEALS))

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._entries = {e["id"]: e for e in (data or {}).get("entries", [])}
        if (data or {}).get("meals"):
            self._meals = data["meals"]

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"entries": list(self._entries.values()), "meals": self._meals}, 1)

    def _changed(self, day: str | None = None) -> None:
        self._save()
        self._hass.bus.async_fire(EVENT_MEAL_PLAN_CHANGED, {"date": day})

    # ---- the meals of the day ----
    def meals(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._meals)

    def slots(self) -> tuple[str, ...]:
        return tuple(m["id"] for m in self._meals)

    def meal(self, slot: str) -> dict[str, Any] | None:
        return next((m for m in self._meals if m["id"] == slot), None)

    def meal_name(self, language: str | None, slot: str) -> str:
        """The name of a meal: its own, or the built-in one in the user's language."""
        meal = self.meal(slot)
        return (meal or {}).get("name") or slot_name(language, slot)

    def check_slot(self, slot: str) -> str:
        if self.meal(slot) is None:
            raise MealPlanError(f"Unknown meal {slot!r}; use one of {', '.join(self.slots())}")
        return slot

    def set_meals(self, meals: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace the meals of the day (their order is the order they are listed in)."""
        if not 1 <= len(meals) <= MAX_MEALS:
            raise MealPlanError(f"Have between 1 and {MAX_MEALS} meals")
        clean: list[dict[str, Any]] = []
        for raw in meals:
            clock = parse_time(raw.get("time", "12:00"))
            color = str(raw.get("color") or "blue")
            if color not in COLORS:
                raise MealPlanError(f"Not a colour: {color!r}")
            meal_id = str(raw.get("id") or uuid.uuid4().hex[:8])
            if any(m["id"] == meal_id for m in clean):
                raise MealPlanError(f"Two meals share the id {meal_id!r}")
            words = []
            for word in raw.get("words") or []:
                word = str(word).strip().casefold()
                if word and word not in words:
                    words.append(word)
            builtin = next((m for m in DEFAULT_MEALS if m["id"] == meal_id), None)
            name = str(raw.get("name") or "").strip()
            if not name and builtin is None:
                raise MealPlanError("Give every new meal a name")
            clean.append(
                {
                    "id": meal_id,
                    "name": name,
                    "color": color,
                    "time": f"{clock.hour:02d}:{clock.minute:02d}",
                    "minutes": int(raw.get("minutes") or 60),
                    "words": words[:12],
                }
            )
        gone = {m["id"] for m in self._meals} - {m["id"] for m in clean}
        for meal_id in gone:
            used = sum(1 for e in self._entries.values() if e["slot"] == meal_id)
            if used:
                raise MealPlanError(f"{used} planned meals are in {self.meal_name(None, meal_id)}: move or remove them first")
        self._meals = clean
        self._changed(None)
        return self.meals()

    def _public(self, entry: dict[str, Any]) -> dict[str, Any]:
        """The entry as clients see it: the live recipe name wins over the stored one."""
        recipe = self._recipes.get(entry["recipe_id"]) if entry.get("recipe_id") else None
        return {
            **entry,
            "title": recipe["name"] if recipe else entry.get("title", ""),
            "recipe_exists": recipe is not None,
            "image": recipe.get("image", "") if recipe else "",
            "total_time": recipe.get("total_time") if recipe else None,
            "servings": recipe.get("servings", "") if recipe else "",
        }

    def list(self, start: date | str, end: date | str) -> list[dict[str, Any]]:
        """Entries from ``start`` to ``end`` inclusive, in day then slot order."""
        first, last = parse_date(start), parse_date(end)
        if (last - first).days > MAX_RANGE_DAYS:
            raise MealPlanError(f"Ask for at most {MAX_RANGE_DAYS} days at a time")
        lo, hi = first.isoformat(), last.isoformat()
        chosen = [e for e in self._entries.values() if lo <= e["date"] <= hi]
        order = {m["id"]: i for i, m in enumerate(self._meals)}
        chosen.sort(key=lambda e: (e["date"], order.get(e["slot"], len(order)), e["title"].casefold()))
        return [self._public(e) for e in chosen]

    def get(self, entry_id: str) -> dict[str, Any] | None:
        entry = self._entries.get(entry_id)
        return self._public(entry) if entry else None

    def add(
        self,
        day: str | date,
        slot: str,
        recipe_id: str | None = None,
        title: str | None = None,
        scale: float | None = None,
        note: str = "",
    ) -> dict[str, Any]:
        day = parse_date(day).isoformat()
        self.check_slot(slot)
        recipe = self._recipes.get(recipe_id) if recipe_id else None
        if recipe_id and recipe is None:
            raise MealPlanError(f"Recipe not found: {recipe_id}")
        name = (title or "").strip() or (recipe["name"] if recipe else "")
        if not name:
            raise MealPlanError("A meal needs a recipe or a title")
        entry = {
            "id": uuid.uuid4().hex,
            "date": day,
            "slot": slot,
            "recipe_id": recipe_id if recipe else None,
            "title": recipe["name"] if recipe else name,
            "scale": float(scale) if scale else None,  # None: the recipe's own default
            "note": note.strip(),
        }
        self._entries[entry["id"]] = entry
        self._changed(day)
        return self._public(entry)

    def update(self, entry_id: str, **fields: Any) -> dict[str, Any] | None:
        entry = self._entries.get(entry_id)
        if entry is None:
            return None
        before = entry["date"]
        if fields.get("date") is not None:
            entry["date"] = parse_date(fields["date"]).isoformat()
        if fields.get("slot") is not None:
            entry["slot"] = self.check_slot(fields["slot"])
        if "scale" in fields:
            entry["scale"] = float(fields["scale"]) if fields["scale"] else None
        if fields.get("note") is not None:
            entry["note"] = str(fields["note"]).strip()
        if fields.get("recipe_id"):
            recipe = self._recipes.get(fields["recipe_id"])
            if recipe is None:
                raise MealPlanError(f"Recipe not found: {fields['recipe_id']}")
            entry["recipe_id"], entry["title"] = recipe["id"], recipe["name"]
        elif fields.get("title") is not None and not entry.get("recipe_id"):
            entry["title"] = str(fields["title"]).strip() or entry["title"]
        self._changed(entry["date"] if before == entry["date"] else None)
        return self._public(entry)

    def delete(self, entry_id: str) -> bool:
        entry = self._entries.pop(entry_id, None)
        if entry is None:
            return False
        self._changed(entry["date"])
        return True

    def clear(self, start: str | date, end: str | date | None = None, slot: str | None = None) -> int:
        """Remove entries in a range (a single day when ``end`` is omitted), optionally one slot."""
        first = parse_date(start)
        last = parse_date(end) if end else first
        lo, hi = first.isoformat(), last.isoformat()
        doomed = [
            e["id"]
            for e in self._entries.values()
            if lo <= e["date"] <= hi and (slot is None or e["slot"] == slot)
        ]
        for entry_id in doomed:
            del self._entries[entry_id]
        if doomed:
            self._changed(None)
        return len(doomed)

    def copy(self, source: str | date, target: str | date, days: int = 7, replace: bool = False) -> dict[str, int]:
        """Copy ``days`` days from ``source`` onto the days starting at ``target``.

        Meals already on the target days are kept unless ``replace`` is set; a meal
        that is already there (same slot, recipe or title) is not added twice.
        """
        first, to = parse_date(source), parse_date(target)
        if days < 1 or days > 62:
            raise MealPlanError("Copy between 1 and 62 days at a time")
        offset = (to - first).days
        if offset == 0:
            raise MealPlanError("The source and the target are the same days")
        removed = 0
        if replace:
            removed = self.clear(to, to + timedelta(days=days - 1))
        existing = {
            (e["date"], e["slot"], e.get("recipe_id") or e["title"].casefold())
            for e in self._entries.values()
        }
        added = 0
        for entry in self.list(first, first + timedelta(days=days - 1)):
            day = (parse_date(entry["date"]) + timedelta(days=offset)).isoformat()
            ident = (day, entry["slot"], entry.get("recipe_id") or entry["title"].casefold())
            if ident in existing:
                continue
            existing.add(ident)
            new = {
                "id": uuid.uuid4().hex,
                "date": day,
                "slot": entry["slot"],
                "recipe_id": entry.get("recipe_id") if entry.get("recipe_exists") else None,
                "title": entry["title"],
                "scale": entry.get("scale"),
                "note": entry.get("note", ""),
            }
            self._entries[new["id"]] = new
            added += 1
        if added or removed:
            self._changed(None)
        return {"added": added, "removed": removed}

    def detach_recipe(self, recipe_id: str) -> int:
        """A recipe was deleted: keep its entries as plain titles."""
        touched = 0
        for entry in self._entries.values():
            if entry.get("recipe_id") == recipe_id:
                entry["recipe_id"] = None
                touched += 1
        if touched:
            self._changed(None)
        return touched

    def week(self, anchor: date | str) -> tuple[date, date]:
        """Monday to Sunday around ``anchor``."""
        day = parse_date(anchor)
        monday = day - timedelta(days=day.weekday())
        return monday, monday + timedelta(days=6)
