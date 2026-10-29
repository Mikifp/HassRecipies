"""Groups of ingredient names that look like the same food (suggestions, nothing is changed here)."""

from __future__ import annotations

import os
import re
from typing import Any

SOURCE_NEW = "new"
MAX_GROUP = 8
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
# Words that say how something is cut or how much of it, not what it is
_STOP = frozenset(
    "eller og til med uden fra som ekstra extra fint grov stor store lille små frisk friske fresh frisk hakket finthakket "
    "revet skåret skiver stykker dåse dåser pakke pakker gram stk spsk tsk knsp bundt fed ca evt cut chopped grated "
    "sliced minced large small medium whole or and the of with for ripe can cans package cup cups tbsp tsp pinch".split()
)


def _words(key: str) -> list[str]:
    return [w for w in _WORD.findall(key.casefold()) if len(w) >= 3 and w not in _STOP]


def _stem(word: str) -> str:
    """Compound words share their start: vaniljeekstrakt and vaniljesukker both begin with vanilje."""
    return word[:6] if len(word) >= 7 else word


def _title(text: str) -> str:
    return text[:1].upper() + text[1:]


def suggest_groups(review: list[dict[str, Any]], foods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group the names in `review` that look like one food.

    1. Names that contain all the words of a food you already have go to that food.
    2. Names whose best guess is the same Frida or USDA food go to a new food of it.
    3. Names that share a word go to a new food without nutrition.
    """
    free = {r["key"]: r for r in review}
    groups: list[dict[str, Any]] = []

    def add(keys: list[str], reason: str, why: str, target: dict[str, Any], match: bool) -> None:
        for k in keys:
            free.pop(k, None)
        groups.append({"id": keys[0], "keys": keys, "reason": reason, "why": why, "target": target, "match": match})

    # 1. a food you already have
    index: list[tuple[set[str], dict[str, Any]]] = []
    for food in foods:
        for name in (food["name"], *food.get("aliases", [])):
            words = set(_words(name))
            if words:
                index.append((words, food))
    by_food: dict[str, list[str]] = {}
    for key, row in list(free.items()):
        sugg = row.get("suggestion") or {}
        target = None
        if sugg.get("source") == "custom" and any(f["id"] == str(sugg.get("id")) for f in foods):
            target = str(sugg["id"])
        else:
            words = set(_words(key))
            hits: dict[str, int] = {}
            for fwords, food in index:
                if fwords <= words:
                    hits[food["id"]] = max(hits.get(food["id"], 0), len(fwords))
            # two different foods in one name (smør eller olie): not for us to choose
            ranked = sorted(hits.items(), key=lambda h: -h[1])
            if ranked and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
                target = ranked[0][0]
        if target:
            by_food.setdefault(target, []).append(key)
    names = {f["id"]: f for f in foods}
    for fid, keys in by_food.items():
        food = names[fid]
        add(keys, "food", food["name"], {"kind": "food", "food_id": fid, "name": food["name"], "source": food["source"]}, True)

    # 2. the same best guess
    by_guess: dict[tuple[str, Any], list[str]] = {}
    for key, row in free.items():
        sugg = row.get("suggestion") or {}
        if sugg.get("source") in ("frida", "usda"):
            by_guess.setdefault((sugg["source"], sugg["id"]), []).append(key)
    for (source, sid), keys in by_guess.items():
        if len(keys) < 2:
            continue
        sugg = free[keys[0]]["suggestion"]
        target = {"kind": SOURCE_NEW, "name": _title(keys[0]), "source": source, "source_id": sid}
        add(keys[:MAX_GROUP], "guess", sugg["name"], target, True)

    # 3. a shared word
    by_word: dict[str, list[str]] = {}
    for key in free:
        for stem in {_stem(w) for w in _words(key)}:
            by_word.setdefault(stem, []).append(key)
    for stem, keys in sorted(by_word.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        keys = [k for k in keys if k in free]
        if len(keys) < 2:
            continue
        keys = keys[:MAX_GROUP]
        shared = os.path.commonprefix([next(w for w in _words(k) if _stem(w) == stem) for k in keys]) or stem
        target = {"kind": SOURCE_NEW, "name": _title(shared), "source": "none", "source_id": None}
        add(keys, "words", shared, target, False)

    groups.sort(key=lambda g: (not g["match"], -len(g["keys"]), g["id"]))
    return groups
