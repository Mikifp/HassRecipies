"""The user's foods: one entry for each thing an ingredient line can be ("smør", "hakkede tomater").

A food has a name, other names it goes by ("butter"), what one unit of it weighs ("1 dåse = 400 g"),
where it is in the shop, and its nutrition: a Frida food, the user's own values, or none yet.

The nutrition calculation (``nutrition.py``) works on two plain dicts, *custom ingredients* and
*links* (ingredient name -> food); this module is the source of truth they are derived from, so the
calculation did not have to change. Free of Home Assistant imports, so it can be tested on its own.
"""

from __future__ import annotations

from typing import Any
import uuid

from .nutrition import (
    NUTRIENTS,
    SOURCE_CUSTOM,
    SOURCE_FRIDA,
    SOURCE_IGNORE,
    SOURCE_USDA,
    FoodDatabase,
    clean_custom,
    food_key,
)

SOURCE_NONE = "none"
MAX_UNIT_GRAMS = 10000
MAX_NAMES = 40


class FoodError(ValueError):
    """Raised for a food that cannot be saved."""


def clean_unit_grams(raw: Any) -> dict[str, float]:
    """What one unit weighs: {"dåse": 400}. Anything that is not a sensible weight is dropped."""
    out: dict[str, float] = {}
    for unit, grams in (raw or {}).items():
        try:
            value = float(grams)
        except (TypeError, ValueError):
            continue
        unit = str(unit).strip()[:40]
        if unit and 0 < value <= MAX_UNIT_GRAMS:
            out[unit] = round(value, 2)
    return out


def clean_names(raw: Any) -> list[str]:
    """Other names, without empties or repeats (two names that read the same are one)."""
    names: list[str] = []
    seen: set[str] = set()
    for item in raw or []:
        name = str(item).strip()[:120]
        key = food_key(name)
        if key and key not in seen:
            seen.add(key)
            names.append(name)
    return names[:MAX_NAMES]


def _title(key: str) -> str:
    return key[:1].upper() + key[1:]


class FoodBook:
    """All foods, plus the ingredient names that are counted as nothing (water, salt to taste)."""

    def __init__(self, db: FoodDatabase) -> None:
        self.db = db
        self.foods: dict[str, dict[str, Any]] = {}
        self.ignored: list[str] = []

    # ---- loading and saving ----
    @classmethod
    def from_data(cls, db: FoodDatabase, data: dict[str, Any] | None) -> FoodBook:
        data = data or {}
        book = cls(db)
        if "foods" in data:
            for item in data.get("foods") or []:
                if isinstance(item, dict) and item.get("id") and item.get("name"):
                    book.foods[str(item["id"])] = book._clean(item, str(item["id"]), check=False)
            book.ignored = [k for k in (food_key(x) for x in data.get("ignored") or []) if k]
        else:
            book.add_legacy(data.get("links") or {}, data.get("custom") or [])
        return book

    def to_data(self) -> dict[str, Any]:
        return {"foods": list(self.foods.values()), "ignored": list(self.ignored)}

    def add_legacy(self, links: dict[str, Any], custom: list[dict[str, Any]] | dict[str, Any]) -> int:
        """Take in the older kind of data: custom ingredients and ingredient name -> food links.

        Each custom ingredient becomes a food; names linked to the same food become one food with
        those names. Existing foods are kept; returns how many foods were added.
        """
        before = len(self.foods)
        ids: dict[str, str] = {}
        items = custom.values() if isinstance(custom, dict) else custom
        for item in items:
            if not isinstance(item, dict):
                continue
            values = clean_custom(item)
            if not values["name"] or values["kcal"] is None:
                continue
            existing = self.by_key().get(food_key(values["name"]))
            if existing:
                ids[str(item.get("id"))] = existing
                continue
            fid = str(item.get("id") or uuid.uuid4().hex)
            self.foods[fid] = self._clean({**values, "source": SOURCE_CUSTOM, "values": values}, fid, check=False)
            ids[str(item.get("id"))] = fid
        for raw_key, link in links.items():
            key = food_key(raw_key)
            if not key or not isinstance(link, dict):
                continue
            source = link.get("source")
            grams = clean_unit_grams(link.get("unit_grams"))
            if source == SOURCE_IGNORE:
                if key not in self.ignored and key not in self.by_key():
                    self.ignored.append(key)
                continue
            if self.by_key().get(key):
                continue
            if source == SOURCE_CUSTOM:
                fid = ids.get(str(link.get("id")))
                if fid:
                    self._add_name(self.foods[fid], key, grams)
            elif source == SOURCE_FRIDA and self.db.get(link.get("id")) is not None:
                food = self.ensure_frida_food(int(link["id"]), key)
                if key not in self._keys(food):
                    self._add_name(food, key, grams)
                else:
                    food["unit_grams"] = {**grams, **food["unit_grams"]}
        return len(self.foods) - before

    # ---- looking up ----
    @staticmethod
    def _keys(food: dict[str, Any]) -> list[str]:
        keys = [food_key(food["name"])]
        keys += [food_key(a) for a in food.get("aliases") or []]
        return [k for k in keys if k]

    def by_key(self) -> dict[str, str]:
        """Ingredient name (as a key) -> id of the food it is. A name belongs to the first food that has it."""
        out: dict[str, str] = {}
        for food in self.foods.values():
            for key in self._keys(food):
                out.setdefault(key, food["id"])
        return out

    def custom(self) -> dict[str, dict[str, Any]]:
        """The foods with values of their own, in the shape the calculation reads."""
        return {
            f["id"]: {"id": f["id"], "name": f["name"], **{k: f["values"].get(k) for k in NUTRIENTS}}
            for f in self.foods.values()
            if f["source"] == SOURCE_CUSTOM
        }

    def links(self) -> dict[str, dict[str, Any]]:
        """Ingredient name -> {source, id, unit_grams} for every name that has a food with nutrition."""
        out: dict[str, dict[str, Any]] = {key: {"source": SOURCE_IGNORE, "id": None} for key in self.ignored}
        for food in self.foods.values():
            if food["source"] == SOURCE_NONE:
                continue
            link: dict[str, Any] = {
                "source": food["source"],
                "id": food["frida_id"] if food["source"] == SOURCE_FRIDA else food["usda_id"] if food["source"] == SOURCE_USDA else food["id"],
            }
            if food["unit_grams"]:
                link["unit_grams"] = dict(food["unit_grams"])
            for key in self._keys(food):
                out.setdefault(key, link)
        return out

    def food_for_key(self, key: str) -> dict[str, Any] | None:
        fid = self.by_key().get(food_key(key))
        return self.foods.get(fid) if fid else None

    # ---- making a food ----
    def _clean(self, data: dict[str, Any], fid: str, check: bool = True) -> dict[str, Any]:
        name = str(data.get("name", "")).strip()[:120]
        if not name:
            raise FoodError("A food needs a name")
        source = data.get("source") or SOURCE_NONE
        frida_id = None
        usda_id = None
        values: dict[str, Any] = {k: None for k in NUTRIENTS}
        if source == SOURCE_FRIDA:
            found = self.db.get(data.get("frida_id"))
            if found is None:
                if check:
                    raise FoodError(f"Unknown Frida food: {data.get('frida_id')!r}")
                source = SOURCE_NONE
            else:
                frida_id = int(found["id"])
        elif source == SOURCE_USDA:
            found = self.db.get_usda(data.get("usda_id"))
            if found is None:
                if check:
                    raise FoodError(f"Unknown USDA food: {data.get('usda_id')!r}")
                source = SOURCE_NONE
            else:
                usda_id = int(found["id"])
        elif source == SOURCE_CUSTOM:
            cleaned = clean_custom({"name": name, **(data.get("values") or {})})
            if cleaned["kcal"] is None:
                if check:
                    raise FoodError("Give the energy (kcal per 100 g) of your own values")
                source = SOURCE_NONE
            else:
                values = {k: cleaned[k] for k in NUTRIENTS}
        elif source != SOURCE_NONE:
            raise FoodError(f"Unknown source: {source!r}")
        return {
            "id": fid,
            "name": name,
            "aliases": clean_names(data.get("aliases")),
            "source": source,
            "frida_id": frida_id,
            "usda_id": usda_id,
            "values": values,
            "unit_grams": clean_unit_grams(data.get("unit_grams")),
            "section": str(data.get("section") or "").strip()[:60],
            # made for an ingredient name by choosing a food for it, not by the user on the Foods page
            "auto": bool(data.get("auto")),
        }

    def _check_names(self, food: dict[str, Any], own_id: str | None) -> None:
        taken = self.by_key()
        for key in self._keys(food):
            owner = taken.get(key)
            if owner and owner != own_id:
                raise FoodError(f"“{key}” is already a name of {self.foods[owner]['name']}")

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        food = self._clean(data, uuid.uuid4().hex)
        self._check_names(food, None)
        for key in self._keys(food):
            if key in self.ignored:
                self.ignored.remove(key)
        self.foods[food["id"]] = food
        return food

    def update(self, fid: str, data: dict[str, Any]) -> dict[str, Any]:
        if fid not in self.foods:
            raise FoodError("Food not found")
        old = self.foods[fid]
        merged = {**old, **{k: v for k, v in data.items() if k in ("name", "aliases", "source", "frida_id", "usda_id", "values", "unit_grams", "section")}}
        if data.get("source") == SOURCE_CUSTOM and "values" not in data:
            merged["values"] = old["values"]
        food = self._clean(merged, fid)
        food["auto"] = False  # a food the user has edited is theirs
        self._check_names(food, fid)
        self.foods[fid] = food
        for key in self._keys(food):
            if key in self.ignored:
                self.ignored.remove(key)
        return food

    def delete(self, fid: str) -> bool:
        return self.foods.pop(fid, None) is not None

    def merge(self, target_id: str, source_ids: list[str]) -> dict[str, Any]:
        """Fold foods into another one: their names become names of the target."""
        target = self.foods.get(target_id)
        if target is None:
            raise FoodError("Food not found")
        for sid in source_ids:
            source = self.foods.get(sid)
            if source is None or sid == target_id:
                continue
            for name in [source["name"], *source["aliases"]]:
                if food_key(name) not in self._keys(target):
                    target["aliases"].append(name)
            target["aliases"] = clean_names(target["aliases"])
            target["unit_grams"] = {**source["unit_grams"], **target["unit_grams"]}
            if target["source"] == SOURCE_NONE and source["source"] != SOURCE_NONE:
                for k in ("source", "frida_id", "usda_id", "values"):
                    target[k] = source[k]
            if not target["section"]:
                target["section"] = source["section"]
            del self.foods[sid]
        return target

    # ---- ingredient names ----
    def _add_name(self, food: dict[str, Any], key: str, grams: dict[str, float] | None = None) -> None:
        if key and key not in self._keys(food):
            food["aliases"] = clean_names([*food["aliases"], key])
        if grams:
            food["unit_grams"] = {**grams, **food["unit_grams"]}
        if key in self.ignored:
            self.ignored.remove(key)

    def _drop_name(self, key: str) -> None:
        """Take an ingredient name away from the food that has it as another name (not as its own name)."""
        for food in self.foods.values():
            food["aliases"] = [a for a in food["aliases"] if food_key(a) != key or food_key(food["name"]) == key]

    def ensure_frida_food(self, frida_id: int, key: str) -> dict[str, Any]:
        """The food for a Frida food: one that already has this name, else one that is already that Frida food, else a new one."""
        found = self.food_for_key(key)
        if found and found["source"] == SOURCE_FRIDA and found["frida_id"] == frida_id:
            return found
        for food in self.foods.values():
            if food["source"] == SOURCE_FRIDA and food["frida_id"] == frida_id:
                return food
        food = self._clean(
            {"name": _title(key) or "Food", "source": SOURCE_FRIDA, "frida_id": frida_id, "auto": True}, uuid.uuid4().hex
        )
        self.foods[food["id"]] = food
        return food

    def ensure_usda_food(self, usda_id: int, key: str) -> dict[str, Any]:
        """The food for a USDA food: one that already has this name, else one that is already that USDA food, else a new one."""
        found = self.food_for_key(key)
        if found and found["source"] == SOURCE_USDA and found["usda_id"] == usda_id:
            return found
        for food in self.foods.values():
            if food["source"] == SOURCE_USDA and food["usda_id"] == usda_id:
                return food
        food = self._clean({"name": _title(key) or "Food", "source": SOURCE_USDA, "usda_id": usda_id, "auto": True}, uuid.uuid4().hex)
        self.foods[food["id"]] = food
        return food

    def link_key(self, key: str, fid: str, grams: dict[str, float] | None = None) -> dict[str, Any]:
        """Say that an ingredient name is this food."""
        key = food_key(key)
        food = self.foods.get(fid)
        if food is None:
            raise FoodError("Food not found")
        owner = self.food_for_key(key)
        if owner and owner["id"] != fid and food_key(owner["name"]) == key:
            raise FoodError(f"“{key}” is the name of {owner['name']}: merge the foods instead")
        self._drop_name(key)
        self._add_name(food, key, clean_unit_grams(grams))
        return food

    def ignore_key(self, key: str) -> None:
        """Count an ingredient name as nothing (water, salt to taste)."""
        key = food_key(key)
        owner = self.food_for_key(key)
        if owner and food_key(owner["name"]) == key:
            if not owner["auto"]:
                raise FoodError(f"“{owner['name']}” is one of your foods: delete or rename it on the Foods page first")
            self.unlink_key(key)  # a food made for this name alone goes with it
        self._drop_name(key)
        if key and key not in self.ignored:
            self.ignored.append(key)

    def unlink_key(self, key: str) -> None:
        """Forget what an ingredient name is, so it is matched afresh.

        A food made for this name alone goes with it. A food the user made keeps its own name:
        it is changed or deleted on the Foods page.
        """
        key = food_key(key)
        self._drop_name(key)
        if key in self.ignored:
            self.ignored.remove(key)
        owner = self.food_for_key(key)
        if owner and food_key(owner["name"]) == key:
            if not owner["auto"]:
                raise FoodError(f"“{owner['name']}” is one of your foods: change or delete it on the Foods page")
            if owner["aliases"]:
                owner["name"] = owner["aliases"].pop(0)
            else:
                del self.foods[owner["id"]]

    # ---- backup ----
    def merge_book(self, other: FoodBook) -> int:
        """Add the foods of another book that are not here yet (by name); returns how many were added."""
        added = 0
        for food in other.foods.values():
            keys = self._keys(food)
            existing = next((self.by_key()[k] for k in keys if k in self.by_key()), None)
            if existing:
                target = self.foods[existing]
                for name in [food["name"], *food["aliases"]]:
                    if food_key(name) not in self.by_key():
                        target["aliases"].append(name)
                target["unit_grams"] = {**food["unit_grams"], **target["unit_grams"]}
                continue
            fid = food["id"] if food["id"] not in self.foods else uuid.uuid4().hex
            clean = self._clean({**food, "values": food["values"]}, fid, check=False)
            clean["aliases"] = [a for a in clean["aliases"] if food_key(a) not in self.by_key()]
            self.foods[fid] = clean
            added += 1
        for key in other.ignored:
            if key not in self.ignored and key not in self.by_key():
                self.ignored.append(key)
        return added
