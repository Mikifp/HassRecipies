"""A calorie tracker: what each person has eaten, day by day, with a goal.

Persons are Home Assistant users (one is made for each, on first use) or names added by hand. An entry is a
snapshot: it keeps the energy and macros it had when it was logged, so changing a food later does not rewrite
a past day. Meals are the meal plan's own (breakfast, lunch, ...), so a planned meal can be logged as eaten.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import EVENT_TRACKER_CHANGED, STORAGE_VERSION, TRACKER_STORAGE_KEY
from .mealplan import MealPlan, MealPlanError, parse_date
from .nutrition_store import Nutrition, NutritionError

NUTRIENTS = ("kcal", "protein", "carbs", "fat")
MAX_RANGE_DAYS = 400
MAX_PERSONS = 30
KINDS = ("recipe", "food", "quick")


class TrackerError(ValueError):
    """Input that cannot be tracked (unknown person, meal or food, a negative amount)."""


def _num(value: Any, what: str, allow_zero: bool = True) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as err:
        raise TrackerError(f"{what} must be a number") from err
    if number < 0 or (number == 0 and not allow_zero) or number > 1_000_000:
        raise TrackerError(f"{what} is out of range")
    return number


def _round(values: dict[str, Any]) -> dict[str, float | None]:
    return {k: None if values.get(k) is None else round(float(values[k]), 1) for k in NUTRIENTS}


def _sum(entries: list[dict[str, Any]]) -> dict[str, float]:
    return {k: round(sum(e.get(k) or 0 for e in entries), 1) for k in NUTRIENTS}


class Tracker:
    def __init__(self, hass: HomeAssistant, nutrition: Nutrition, plan: MealPlan) -> None:
        self._hass = hass
        self._nutrition = nutrition
        self._plan = plan
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, TRACKER_STORAGE_KEY)
        self._persons: dict[str, dict[str, Any]] = {}
        self._entries: dict[str, dict[str, Any]] = {}
        self._listeners: list[Any] = []

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._persons = {p["id"]: p for p in data.get("persons", [])}
        self._entries = {e["id"]: e for e in data.get("entries", [])}

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"persons": list(self._persons.values()), "entries": list(self._entries.values())}, 1)

    def add_listener(self, func):
        """Call ``func`` when anything changes; returns the function that stops it."""
        self._listeners.append(func)
        return lambda: self._listeners.remove(func) if func in self._listeners else None

    def _changed(self, person_id: str, day: str | None = None) -> None:
        self._save()
        self._hass.bus.async_fire(EVENT_TRACKER_CHANGED, {"person_id": person_id, "date": day})
        for func in list(self._listeners):
            func()

    # ---- persons ----
    def persons(self) -> list[dict[str, Any]]:
        return sorted((dict(p, goals=dict(p["goals"])) for p in self._persons.values()), key=lambda p: p["name"].casefold())

    def person(self, person_id: str) -> dict[str, Any]:
        person = self._persons.get(person_id)
        if person is None:
            raise TrackerError("Person not found")
        return person

    def person_for_user(self, user_id: str | None) -> dict[str, Any] | None:
        return next((p for p in self._persons.values() if user_id and p.get("user_id") == user_id), None)

    def ensure_user(self, user_id: str, name: str) -> dict[str, Any]:
        """The person of a Home Assistant user, made on first use."""
        found = self.person_for_user(user_id)
        if found:
            return found
        person = {"id": uuid.uuid4().hex, "name": (name or "User").strip()[:60], "user_id": user_id, "goals": {}, "favourites": []}
        self._persons[person["id"]] = person
        self._save()
        return person

    async def async_sync_users(self) -> None:
        """A person for every active Home Assistant user."""
        for user in await self._hass.auth.async_get_users():
            if getattr(user, "is_active", True) and not getattr(user, "system_generated", False):
                self.ensure_user(user.id, user.name)

    def add_person(self, name: str) -> dict[str, Any]:
        name = " ".join(str(name).split())[:60]
        if not name:
            raise TrackerError("Give the person a name")
        if len(self._persons) >= MAX_PERSONS:
            raise TrackerError("Too many people")
        if any(p["name"].casefold() == name.casefold() for p in self._persons.values()):
            raise TrackerError(f"There is already a person called {name}")
        person = {"id": uuid.uuid4().hex, "name": name, "user_id": None, "goals": {}, "favourites": []}
        self._persons[person["id"]] = person
        self._changed(person["id"])
        return person

    def delete_person(self, person_id: str) -> bool:
        if person_id not in self._persons:
            return False
        del self._persons[person_id]
        self._entries = {k: e for k, e in self._entries.items() if e["person_id"] != person_id}
        self._changed(person_id)
        return True

    def set_goals(self, person_id: str, goals: dict[str, Any]) -> dict[str, Any]:
        person = self.person(person_id)
        clean: dict[str, float] = {}
        for key in NUTRIENTS:
            value = goals.get(key)
            if value in (None, ""):
                continue
            number = _num(value, key)
            if number > 0:
                clean[key] = round(number, 1)
        person["goals"] = clean
        self._changed(person_id)
        return person

    # ---- entries ----
    def _check_meal(self, meal: str) -> None:
        if meal not in self._plan.slots():
            raise TrackerError(f"Unknown meal: {meal}")

    def _compute(self, entry: dict[str, Any]) -> dict[str, Any]:
        """The name, amounts and nutrition of an entry from what it is (recipe, food or quick)."""
        kind = entry["kind"]
        try:
            if kind == "recipe":
                by = entry.get("by") or "servings"
                amount = _num(entry.get("amount", entry.get("servings", 1)), "Amount", allow_zero=False)
                values = self._nutrition.recipe_amount(entry.get("recipe_id") or "", amount, by)
                if values is None:
                    raise TrackerError("Recipe not found")
                recipe = self._nutrition._recipes.get(entry["recipe_id"])
                entry.update(name=recipe["name"], by=by, amount=amount)
                entry.pop("servings", None)
                if by == "yield":
                    entry["unit"] = (recipe.get("yield_unit") or "").strip()
                else:
                    entry.pop("unit", None)
            elif kind == "food":
                amount = _num(entry.get("amount", 100), "Amount", allow_zero=False)
                unit = str(entry.get("unit") or "g")
                found = self._nutrition.food_amount(entry.get("food_id") or "", amount, unit)
                values = found
                entry.update(name=found["name"], amount=amount, unit=unit, grams=round(found["grams"], 1))
            else:
                name = " ".join(str(entry.get("name") or "").split())[:120]
                if not name:
                    raise TrackerError("Give the entry a name")
                if entry.get("kcal") in (None, ""):
                    raise TrackerError("Give the entry its energy (kcal)")
                values = {k: (_num(entry[k], k) if entry.get(k) not in (None, "") else None) for k in NUTRIENTS}
                entry["name"] = name
        except NutritionError as err:
            raise TrackerError(str(err)) from err
        if values.get("kcal") is None:
            raise TrackerError("This has no energy value yet: add its nutrition first")
        entry.update(_round(values))
        return entry

    def add(self, person_id: str, day: str, meal: str, kind: str, **fields: Any) -> dict[str, Any]:
        self.person(person_id)
        if kind not in KINDS:
            raise TrackerError(f"Unknown kind: {kind}")
        self._check_meal(meal)
        try:
            day = parse_date(day).isoformat()
        except MealPlanError as err:
            raise TrackerError(str(err)) from err
        keep = ("recipe_id", "food_id", "by", "servings", "amount", "unit", "name", "kcal", "protein", "carbs", "fat", "plan_id")
        entry = {
            "id": uuid.uuid4().hex,
            "person_id": person_id,
            "date": day,
            "meal": meal,
            "kind": kind,
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **{k: v for k, v in fields.items() if k in keep and v is not None},
        }
        self._compute(entry)
        self._entries[entry["id"]] = entry
        self._changed(person_id, day)
        return entry

    def entry(self, entry_id: str) -> dict[str, Any]:
        entry = self._entries.get(entry_id)
        if entry is None:
            raise TrackerError("Entry not found")
        return entry

    def update(self, entry_id: str, **fields: Any) -> dict[str, Any]:
        old = self.entry(entry_id)
        entry = dict(old)
        if "meal" in fields:
            self._check_meal(fields["meal"])
            entry["meal"] = fields["meal"]
        if "date" in fields:
            try:
                entry["date"] = parse_date(fields["date"]).isoformat()
            except MealPlanError as err:
                raise TrackerError(str(err)) from err
        for key in ("by", "servings", "amount", "unit", "name", "kcal", "protein", "carbs", "fat"):
            if key in fields and fields[key] is not None:
                if key == "servings" and entry["kind"] == "recipe":
                    entry["by"], entry["amount"] = "servings", fields[key]
                    continue
                if key in ("name", "kcal", "protein", "carbs", "fat") and entry["kind"] != "quick":
                    continue  # a recipe or a food is given by what it is
                entry[key] = fields[key]
        self._compute(entry)
        self._entries[entry_id] = entry
        self._changed(entry["person_id"], entry["date"])
        return entry

    def delete(self, entry_id: str) -> bool:
        entry = self._entries.pop(entry_id, None)
        if entry is None:
            return False
        self._changed(entry["person_id"], entry["date"])
        return True

    def entries(self, person_id: str, start: str, end: str) -> list[dict[str, Any]]:
        order = {m["id"]: i for i, m in enumerate(self._plan.meals())}
        chosen = [e for e in self._entries.values() if e["person_id"] == person_id and start <= e["date"] <= end]
        chosen.sort(key=lambda e: (e["date"], order.get(e["meal"], len(order)), e["created"]))
        return [dict(e) for e in chosen]

    # ---- a day, a range, the plan ----
    def day(self, person_id: str, day: str) -> dict[str, Any]:
        person = self.person(person_id)
        day = parse_date(day).isoformat()
        entries = self.entries(person_id, day, day)
        return {
            "person": dict(person, goals=dict(person["goals"])),
            "date": day,
            "entries": entries,
            "totals": _sum(entries),
            "planned": self.planned(person_id, day),
            "recent": self.recent(person_id),
            "favourites": list(person.get("favourites", [])),
            "usual": self.usual(person_id, entries),
            "previous": self.previous(person_id, day),
        }

    def planned(self, person_id: str, day: str) -> list[dict[str, Any]]:
        """Meals in the plan for ``day`` that are not logged yet, with the energy of one serving."""
        logged = {e.get("plan_id") for e in self._entries.values() if e["person_id"] == person_id and e["date"] == day}
        out = []
        for plan in self._plan.list(day, day):
            if not plan.get("recipe_id") or not plan.get("recipe_exists") or plan["id"] in logged:
                continue
            per = self._nutrition.recipe_amount(plan["recipe_id"], 1.0)
            out.append(
                {"plan_id": plan["id"], "meal": plan["slot"], "recipe_id": plan["recipe_id"], "name": plan["title"],
                 **(_round(per) if per else {k: None for k in NUTRIENTS})}
            )
        return out

    def range(self, person_id: str, start: str, end: str) -> dict[str, Any]:
        person = self.person(person_id)
        first, last = parse_date(start), parse_date(end)
        if last < first or (last - first).days > MAX_RANGE_DAYS:
            raise TrackerError(f"Ask for 1 to {MAX_RANGE_DAYS} days at a time")
        entries = self.entries(person_id, first.isoformat(), last.isoformat())
        by_day: dict[str, list[dict[str, Any]]] = {}
        for e in entries:
            by_day.setdefault(e["date"], []).append(e)
        days = []
        for n in range((last - first).days + 1):
            d = (first + timedelta(days=n)).isoformat()
            days.append({"date": d, "logged": d in by_day, **_sum(by_day.get(d, []))})
        logged = [d for d in days if d["logged"]]
        average = {k: round(sum(d[k] for d in logged) / len(logged), 1) for k in NUTRIENTS} if logged else {k: None for k in NUTRIENTS}
        return {"person": dict(person, goals=dict(person["goals"])), "days": days, "average": average, "logged_days": len(logged)}

    # ---- recent and favourite items ----
    @staticmethod
    def _template(entry: dict[str, Any]) -> dict[str, Any]:
        keys = ("kind", "recipe_id", "food_id", "by", "amount", "unit", "name", "kcal", "protein", "carbs", "fat")
        return {k: entry[k] for k in keys if entry.get(k) is not None}

    @staticmethod
    def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
        keys = ("kind", "recipe_id", "food_id", "by", "amount", "unit", "name")
        return all(a.get(k) == b.get(k) for k in keys)

    def recent(self, person_id: str, limit: int = 8) -> list[dict[str, Any]]:
        mine = sorted((e for e in self._entries.values() if e["person_id"] == person_id), key=lambda e: e["created"], reverse=True)
        out: list[dict[str, Any]] = []
        for e in mine:
            t = self._template(e)
            if not any(self._same(t, o) for o in out):
                out.append(t)
            if len(out) >= limit:
                break
        return out

    def usual(self, person_id: str, today: list[dict[str, Any]], limit: int = 3) -> dict[str, list[dict[str, Any]]]:
        """What the person eats most in each meal (not what is already logged there today): one tap adds it."""
        counts: dict[str, list[list[Any]]] = {}
        mine = sorted((e for e in self._entries.values() if e["person_id"] == person_id), key=lambda e: e["created"], reverse=True)
        for e in mine:
            template = self._template(e)
            slot = counts.setdefault(e["meal"], [])
            found = next((c for c in slot if self._same(c[0], template)), None)
            if found:
                found[1] += 1
            else:
                slot.append([template, 1])
        usual: dict[str, list[dict[str, Any]]] = {}
        for meal, slot in counts.items():
            here = [self._template(e) for e in today if e["meal"] == meal]
            ranked = sorted(slot, key=lambda c: -c[1])  # a stable sort: the newest first among equals
            usual[meal] = [c[0] for c in ranked if not any(self._same(c[0], h) for h in here)][:limit]
        return usual

    def previous(self, person_id: str, day: str) -> dict[str, Any]:
        """The day before: its date and how many entries it has (to offer copying it)."""
        before = (parse_date(day) - timedelta(days=1)).isoformat()
        return {"date": before, "count": len(self.entries(person_id, before, before))}

    def copy_day(self, person_id: str, source: str, target: str) -> dict[str, int]:
        """Log what was eaten on ``source`` again on ``target``, in the same meals (what cannot be logged now is skipped)."""
        added = skipped = 0
        for e in self.entries(person_id, source, source):
            # a recipe or a food is given by what it is (its name comes from it); a quick entry carries its own
            fields = {k: v for k, v in self._template(e).items() if k != "kind" and (k != "name" or e["kind"] == "quick")}
            try:
                self.add(person_id, target, e["meal"], e["kind"], **fields)
                added += 1
            except TrackerError:
                skipped += 1
        return {"added": added, "skipped": skipped}

    def toggle_favourite(self, person_id: str, entry_id: str) -> bool:
        """Star (or unstar) what an entry is. Returns whether it is a favourite now."""
        person = self.person(person_id)
        template = self._template(self.entry(entry_id))
        favourites = person.setdefault("favourites", [])
        found = next((f for f in favourites if self._same(f, template)), None)
        if found:
            favourites.remove(found)
        else:
            favourites.append(template)
            del favourites[:-30]
        self._changed(person_id)
        return found is None

    # ---- sensors ----
    def today_totals(self, person_id: str, today: date) -> dict[str, Any]:
        person = self.person(person_id)
        entries = self.entries(person_id, today.isoformat(), today.isoformat())
        totals = _sum(entries)
        goal = person["goals"].get("kcal")
        return {**totals, "goal": goal, "remaining": None if goal is None else round(goal - totals["kcal"], 1)}
