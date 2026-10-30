"""Calories and macros per recipe, from the Danish Food Composition Database (Frida)
and the user's own custom ingredients.

Deliberately free of Home Assistant imports so it can be tested on its own; the
persistent part (links and custom ingredients) lives in ``nutrition_store.py``.

How a recipe is calculated:

* each ingredient line is already parsed into grams by ``ingredients.py``;
* its food ("hakket oksekød") is looked up in the *links* the user confirmed
  (food name -> Frida food or custom ingredient). Without a link the best search
  hit is used when it is a clear match, marked ``auto`` so the panel can ask the
  user to confirm it;
* a link can also say how many grams one unit weighs ("1 dåse" = 400 g), for
  amounts the parser cannot turn into grams;
* values per 100 g are scaled by the grams and summed; per serving divides by
  the first number in the recipe's servings.

The result is an estimate. Lines without a match or without a weight are listed
instead of guessed.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

NUTRIENTS = ("kcal", "protein", "fat", "carbs", "fibre", "sugars", "sat_fat", "salt")
SOURCE_FRIDA = "frida"
SOURCE_CUSTOM = "custom"
SOURCE_USDA = "usda"  # USDA FoodData Central, Foundation Foods
SOURCE_IGNORE = "ignore"  # "salt to taste", "water": counted as nothing, on purpose

DATA_FILE = Path(__file__).parent / "data" / "frida.json"
USDA_FILE = Path(__file__).parent / "data" / "usda.json"

# An unconfirmed best hit is used only when it is at least this good (see score()).
AUTO_MATCH_SCORE = 1.05

_WORD = re.compile(r"[^\W\d_]+")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
# words that say how something is prepared or bought, not what it is
_STOP = frozenset(
    """
    og eller evt eventuelt fx f.eks til af med uden i en et ca lidt godt gerne frisk friske fersk ferske
    fint groft grofthakket finthakket små store stor lille mellemstore økologisk økologiske
    and or of the a an to taste fresh large small medium finely roughly chopped optional organic
    """.split()
)
_ENDINGS = ("erne", "ene", "ede", "ets", "ers", "er", "et", "en", "es", "e", "s", "r")
_RAW = frozenset({"rå", "råt", "raw", "uspec", "all", "varieties"})
# Danish plurals the stemmer cannot undo
_IRREGULAR = {"kartofl": "kartoffel", "gulerødd": "gulerod", "gulerød": "gulerod", "fødd": "fod"}

# What everyday recipe words most often mean, as Frida's Danish food names (names rather than
# ids, so they survive a new Frida version; a name that disappears is simply skipped). Without
# these, "æg" would be a duck egg and "mælk" goat milk just as well as anything else.
DEFAULT_LINKS: dict[str, str] = {
    **dict.fromkeys(("æg", "hele æg", "egg", "eggs", "whole egg"), "Æg, høne, skrabehøns, rå"),
    **dict.fromkeys(("æggeblomme", "æggeblommer", "egg yolk", "egg yolks"), "Æg, høne, blomme, rå"),
    **dict.fromkeys(("æggehvide", "æggehvider", "egg white", "egg whites"), "Æg, høne, æggehvide, rå"),
    **dict.fromkeys(("løg", "rødløg", "skalotteløg", "onion", "onions", "red onion", "shallot", "shallots"), "Løg, rå"),
    **dict.fromkeys(("hvidløg", "garlic", "garlic clove", "garlic cloves"), "Hvidløg, rå"),
    **dict.fromkeys(("smør", "butter", "salted butter"), "Smør, saltet"),
    **dict.fromkeys(("usaltet smør", "unsalted butter"), "Smør, usaltet"),
    **dict.fromkeys(("mælk", "sødmælk", "milk", "whole milk"), "Sødmælk, konventionel (ikke-økologisk)"),
    **dict.fromkeys(("letmælk", "semi-skimmed milk"), "Letmælk, konventionel (ikke-økologisk)"),
    **dict.fromkeys(("minimælk", "skimmetmælk", "skummetmælk", "skimmed milk"), "Minimælk, 0.5 % fedt"),
    **dict.fromkeys(("sukker", "hvidt sukker", "sugar", "granulated sugar", "caster sugar", "white sugar"), "Sukker, stødt melis (sakkarose)"),
    **dict.fromkeys(("brun farin", "brown sugar"), "Sukker, brun farin"),
    **dict.fromkeys(("mel", "hvedemel", "flour", "all-purpose flour", "plain flour", "wheat flour"), "Hvedemel"),
    **dict.fromkeys(("kartoffel", "kartofler", "potato", "potatoes"), "Kartoffel, uspec., rå"),
    **dict.fromkeys(("tomat", "tomater", "tomato", "tomatoes", "cherrytomater", "cherry tomatoes"), "Tomat, uspec., rå"),
    **dict.fromkeys(
        ("hakkede tomater", "flåede tomater", "tomater på dåse", "canned tomatoes", "chopped tomatoes", "diced tomatoes"),
        "Tomat, flået, konserves",
    ),
    **dict.fromkeys(("tomatpuré", "tomatpure", "tomatkoncentrat", "tomato paste"), "Tomatpure, koncentreret"),
    **dict.fromkeys(("pasta", "spaghetti", "penne", "tagliatelle", "fusilli", "lasagneplader", "makaroni"), "Pasta, rå"),
    **dict.fromkeys(("ris", "rice", "jasminris", "basmatiris", "white rice"), "Ris, polerede, rå"),
    **dict.fromkeys(("olivenolie", "olie", "olive oil", "oil"), "Olivenolie"),
    **dict.fromkeys(("rapsolie", "neutral olie", "vegetable oil", "canola oil"), "Rapsolie"),
    **dict.fromkeys(("salt", "groft salt", "flagesalt", "sea salt", "kosher salt"), "Salt, stensalt, køkkensalt"),
    **dict.fromkeys(("peber", "sort peber", "pepper", "black pepper"), "Peber, sort"),
    **dict.fromkeys(("piskefløde", "fløde", "heavy cream", "whipping cream", "double cream", "cream"), "Fløde 38 %, piskefløde"),
    **dict.fromkeys(("madlavningsfløde",), "Fløde 18 %"),
    **dict.fromkeys(("citron", "lemon"), "Citron, rå"),
    **dict.fromkeys(("citronsaft", "lemon juice"), "Citronsaft, friskpresset"),
    **dict.fromkeys(("gulerod", "gulerødder", "carrot", "carrots"), "Gulerødder, dansk, uden skræl, rå"),
    **dict.fromkeys(("kyllingebryst", "kyllingefilet", "kyllingebrystfilet", "chicken breast"), "Kylling, kød, rå"),
    **dict.fromkeys(("bacon", "bacon i tern", "baconterninger"), "Bacon, stegestykke, rå"),
    **dict.fromkeys(("revet ost", "ost", "cheese"), "Ost, fast, 45+, alle typer"),
    **dict.fromkeys(("havregryn", "oats", "rolled oats"), "Havregryn, uspec."),
    **dict.fromkeys(("tørgær", "dry yeast"), "Gær, tørret"),
    **dict.fromkeys(("vand", "koldt vand", "lunkent vand", "water"), "Vand, postevand"),
    **dict.fromkeys(("hvidvin", "white wine"), "Hvidvin, uspec."),
    **dict.fromkeys(("rødvin", "red wine"), "Rødvin, uspec."),
    **dict.fromkeys(("yoghurt", "yoghurt naturel", "plain yogurt"), "Yoghurt naturel, sødmælk"),
}


def stem(word: str) -> str:
    """A crude Danish/English stem, enough to equate "tomater" and "tomat"."""
    word = word.casefold()
    for end in _ENDINGS:
        if len(word) - len(end) >= 3 and word.endswith(end):
            return word[: -len(end)]
    return word


def food_key(text: str) -> str:
    """How a food name is stored as a link key: lower case, single spaces."""
    return " ".join(_WORD.findall(str(text).casefold()))


def _tokens(text: str, stop: bool = True) -> list[str]:
    words = _WORD.findall(str(text).casefold())
    stems = [stem(w) for w in words if not (stop and w in _STOP)]
    return [_IRREGULAR.get(w, w) for w in stems]


def _word_match(q: str, name_words: list[str]) -> float:
    """1 for the same word; less when one is part of a compound of the other.

    A Danish compound ends in what it is ("sødmælk" is milk), so a match at the end
    counts more than one at the start ("mælkebøtte" is a dandelion).
    """
    best = 0.0
    for w in name_words:
        if q == w:
            return 1.0
        short, long_ = (q, w) if len(q) <= len(w) else (w, q)
        if len(short) >= 3 and long_.endswith(short):
            best = max(best, 0.9)
        elif len(short) >= 4 and long_.startswith(short):
            best = max(best, 0.6)
    return best


def score(query: str, name: str) -> float:
    """How well a food name matches what a recipe calls an ingredient (0..~1.3).

    Every query word must be found (exactly, or inside a compound word) for a high
    score. The food's main word (before the first comma, as in "Løg, rå") counts
    extra, plain raw foods are preferred, and long specialised names lose a little.
    """
    q_words = _tokens(query)
    if not q_words:
        return 0.0
    head, _, _rest = name.partition(",")
    n_words = _tokens(name, stop=False)
    if not n_words:
        return 0.0
    head_words = _tokens(head, stop=False)
    matches = [_word_match(q, n_words) for q in q_words]
    if not all(matches):
        return sum(matches) / len(q_words) * 0.5
    total = sum(matches) / len(q_words)
    # the food's main word(s) are what the recipe asked for, not a side word ("peanut butter")
    head_hits = [max((_word_match(h, q_words),), default=0) for h in head_words]
    if head_words and all(head_hits):
        total += 0.2 if min(head_hits) == 1.0 else 0.1
    lowered = {w.casefold() for w in _WORD.findall(name)}
    if lowered & _RAW:
        total += 0.08
    extra = max(0, len(n_words) - len(q_words))
    total -= 0.04 * extra
    # numbers tell variants apart: "fløde 18 %", "oksekød hakket 15-20"
    q_numbers = set(_NUMBER.findall(query))
    if q_numbers:
        n_numbers = set(_NUMBER.findall(name))
        total += 0.1 * len(q_numbers & n_numbers) - 0.05 * len(q_numbers - n_numbers)
    return round(total, 4)


class FoodDatabase:
    """The bundled Frida foods, searchable by Danish or English name."""

    def __init__(self, data: dict[str, Any], usda: dict[str, Any] | None = None) -> None:
        self.meta = {k: v for k, v in data.items() if k not in ("foods", "fields")}
        # USDA Foundation Foods: English names, a second source beside Frida (Frida wins a tie)
        self.usda_meta = {k: v for k, v in (usda or {}).items() if k not in ("foods", "fields")}
        self.usda: dict[int, dict[str, Any]] = {}
        for row in (usda or {}).get("foods", []):
            item = dict(zip(usda["fields"], row))
            self.usda[int(item["id"])] = item
        fields = data["fields"]
        self.foods: dict[int, dict[str, Any]] = {}
        for row in data["foods"]:
            item = dict(zip(fields, row))
            self.foods[int(item["id"])] = item
        by_name = {f["name_da"]: f for f in self.foods.values()}
        self.defaults: dict[str, dict[str, Any]] = {
            key: by_name[name] for key, name in DEFAULT_LINKS.items() if name in by_name
        }

    @classmethod
    def load(cls, path: Path = DATA_FILE, usda_path: Path | None = USDA_FILE) -> FoodDatabase:
        usda = json.loads(usda_path.read_text(encoding="utf-8")) if usda_path and usda_path.exists() else None
        return cls(json.loads(path.read_text(encoding="utf-8")), usda)

    def get_usda(self, food_id: int | str) -> dict[str, Any] | None:
        try:
            return self.usda.get(int(food_id))
        except (TypeError, ValueError):
            return None

    def search_usda(self, query: str, limit: int = 10) -> list[tuple[float, dict[str, Any]]]:
        """Best USDA matches first, as (score, food)."""
        if not _tokens(query):
            return []
        hits = [(s, food) for food in self.usda.values() if (s := score(query, food["name_en"])) > 0.3]
        hits.sort(key=lambda h: (-h[0], len(h[1]["name_en"])))
        return hits[:limit]

    def get(self, food_id: int | str) -> dict[str, Any] | None:
        try:
            return self.foods.get(int(food_id))
        except (TypeError, ValueError):
            return None

    def search(self, query: str, limit: int = 10) -> list[tuple[float, dict[str, Any]]]:
        """Best matches first, as (score, food)."""
        if not _tokens(query):
            return []
        hits = []
        for food in self.foods.values():
            s = max(score(query, food["name_da"]), score(query, food["name_en"]) - 0.02)
            if s > 0.3:
                hits.append((s, food))
        hits.sort(key=lambda h: (-h[0], len(h[1]["name_da"])))
        return hits[:limit]


# ---- custom ingredients --------------------------------------------------------

def clean_custom(data: dict[str, Any]) -> dict[str, Any]:
    """A custom ingredient as stored: a name and values per 100 g (missing = None)."""
    food: dict[str, Any] = {"name": str(data.get("name", "")).strip()[:120]}
    for key in NUTRIENTS:
        value = data.get(key)
        if value in (None, ""):
            food[key] = None
            continue
        try:
            food[key] = max(0.0, min(float(value), 1000.0 if key == "kcal" else 100.0))
        except (TypeError, ValueError):
            food[key] = None
    return food


def _custom_hits(query: str, custom: dict[str, dict[str, Any]]) -> list[tuple[float, dict[str, Any]]]:
    hits = []
    for food in custom.values():
        s = score(query, food["name"])
        if food_key(food["name"]) == food_key(query):
            s = max(s, 1.5)  # a custom ingredient named exactly like this always wins
        if s > 0.3:
            hits.append((s, food))
    hits.sort(key=lambda h: -h[0])
    return hits


# ---- describing a food for the panel --------------------------------------------

def describe(source: str, food: dict[str, Any]) -> dict[str, Any]:
    if source == SOURCE_CUSTOM:
        return {"source": SOURCE_CUSTOM, "id": food["id"], "name": food["name"], "name_en": "", "group": "",
                **{k: food.get(k) for k in NUTRIENTS}}
    if source == SOURCE_USDA:
        return {"source": SOURCE_USDA, "id": food["id"], "name": food["name_en"], "name_en": food["name_en"],
                "group": food.get("group", ""), **{k: food.get(k) for k in NUTRIENTS}}
    return {"source": SOURCE_FRIDA, "id": food["id"], "name": food["name_da"], "name_en": food["name_en"],
            "group": food.get("group", ""), **{k: food.get(k) for k in NUTRIENTS}}


def search(
    db: FoodDatabase, custom: dict[str, dict[str, Any]], query: str, limit: int = 15
) -> list[dict[str, Any]]:
    """Custom ingredients and Frida foods for a search box, best first."""
    # the user's own ingredients go before Frida foods that match about as well
    hits = [(s + 0.15, describe(SOURCE_CUSTOM, f)) for s, f in _custom_hits(query, custom)]
    hits += [(s, describe(SOURCE_FRIDA, f)) for s, f in db.search(query, limit)]
    hits += [(s - 0.05, describe(SOURCE_USDA, f)) for s, f in db.search_usda(query, limit)]  # a Frida food wins a tie
    hits.sort(key=lambda h: -h[0])
    return [{**food, "score": round(s, 3)} for s, food in hits[:limit]]


def resolve(
    db: FoodDatabase,
    custom: dict[str, dict[str, Any]],
    links: dict[str, dict[str, Any]],
    food: str,
) -> dict[str, Any] | None:
    """The food an ingredient name stands for: its link, or a clear search hit (``auto``)."""
    link = links.get(food_key(food))
    if link:
        source = link.get("source")
        if source == SOURCE_IGNORE:
            return {"source": SOURCE_IGNORE, "id": None, "name": "", "auto": False, "linked": True, "unit_grams": {}}
        if source == SOURCE_CUSTOM:
            target = custom.get(str(link.get("id")))
        elif source == SOURCE_USDA:
            target = db.get_usda(link.get("id"))
        else:
            target = db.get(link.get("id"))
        if target is not None:
            return {
                **describe(source, target),
                "auto": False,
                "linked": True,
                "unit_grams": dict(link.get("unit_grams") or {}),
            }
        unit_grams = dict(link.get("unit_grams") or {})
    else:
        unit_grams = {}
    custom_hits = _custom_hits(food, custom)
    if custom_hits and custom_hits[0][0] >= 1.5:  # named exactly like the ingredient
        return {**describe(SOURCE_CUSTOM, custom_hits[0][1]), "auto": False, "unit_grams": unit_grams}
    default = db.defaults.get(food_key(food))
    if default is not None:
        return {**describe(SOURCE_FRIDA, default), "auto": False, "default": True, "unit_grams": unit_grams}
    if custom_hits and custom_hits[0][0] >= AUTO_MATCH_SCORE:
        return {**describe(SOURCE_CUSTOM, custom_hits[0][1]), "auto": True, "unit_grams": unit_grams}
    hits = db.search(food, 2)
    if hits and hits[0][0] >= AUTO_MATCH_SCORE:
        return {**describe(SOURCE_FRIDA, hits[0][1]), "auto": True, "unit_grams": unit_grams}
    usda_hits = db.search_usda(food, 2)  # only when Frida has nothing clear
    if usda_hits and usda_hits[0][0] >= AUTO_MATCH_SCORE:
        return {**describe(SOURCE_USDA, usda_hits[0][1]), "auto": True, "unit_grams": unit_grams}
    return None


# ---- the calculation --------------------------------------------------------------

_SERVINGS = re.compile(r"\d+(?:[.,]\d+)?")


def parse_servings(value: Any) -> float | None:
    """The first number in a servings text ("4", "4-6 personer", "Serves 2")."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if value > 0 else None
    match = _SERVINGS.search(str(value or ""))
    if not match:
        return None
    number = float(match.group(0).replace(",", "."))
    return number if number > 0 else None


def _grams(parsed: dict[str, Any], unit_grams: dict[str, Any]) -> float | None:
    grams = parsed.get("grams")
    if grams is not None and parsed.get("grams_max") is not None:
        grams = (grams + parsed["grams_max"]) / 2
    if grams is None and parsed.get("quantity") is not None:
        per = unit_grams.get(parsed.get("unit") or "piece")
        if isinstance(per, (int, float)) and per > 0:
            quantity = parsed["quantity"]
            if parsed.get("quantity_max") is not None:
                quantity = (quantity + parsed["quantity_max"]) / 2
            grams = quantity * per
    return grams


def calculate(
    recipe: dict[str, Any],
    parsed_ingredients: list[dict[str, Any]],
    db: FoodDatabase,
    custom: dict[str, dict[str, Any]],
    links: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Nutrition for a whole recipe (as written, scale 1) and per serving."""
    totals = {k: 0.0 for k in NUTRIENTS}
    known = {k: False for k in NUTRIENTS}
    items = []
    counted = 0
    counted_grams = 0.0  # what the counted ingredients weigh: the weight the totals are of
    for index, parsed in enumerate(parsed_ingredients):
        if parsed.get("header"):
            continue
        food_name = parsed.get("food") or parsed.get("text", "")
        match = resolve(db, custom, links, food_name)
        grams = _grams(parsed, (match or {}).get("unit_grams") or {})
        item: dict[str, Any] = {
            "index": index,
            "text": parsed.get("text", ""),
            "food": food_name,
            "key": food_key(food_name),
            "unit": parsed.get("unit"),
            "unit_text": parsed.get("unit_text") or "",
            "quantity": parsed.get("quantity"),
            "grams": None if grams is None else round(grams, 1),
            "match": match,
        }
        if match and match["source"] == SOURCE_IGNORE:
            item["status"] = "ignored"
        elif match is None:
            item["status"] = "no_match"
        elif grams is None:
            item["status"] = "no_grams"
        else:
            item["status"] = "ok"
            counted += 1
            counted_grams += grams
            values = {}
            for key in NUTRIENTS:
                per100 = match.get(key)
                if per100 is not None:
                    value = per100 * grams / 100
                    totals[key] += value
                    known[key] = True
                    values[key] = round(value, 1)
            item["values"] = values
        items.append(item)

    servings = parse_servings(recipe.get("servings"))
    total = {k: round(totals[k], 1) if known[k] else None for k in NUTRIENTS}
    per_serving = (
        {k: None if v is None else round(v / servings, 1) for k, v in total.items()} if servings else None
    )
    # per 100 g of what was counted, and per unit of what the recipe says it makes (24 boller)
    per_100g = (
        {k: None if v is None else round(v * 100 / counted_grams, 1) for k, v in total.items()} if counted_grams > 0 else None
    )
    yield_amount = recipe.get("yield_amount")
    makes = float(yield_amount) if isinstance(yield_amount, (int, float)) and not isinstance(yield_amount, bool) and yield_amount > 0 else None
    per_unit = {k: None if v is None else round(v / makes, 1) for k, v in total.items()} if makes else None
    missing = [i for i in items if i["status"] in ("no_match", "no_grams")]
    return {
        "total": total,
        "per_serving": per_serving,
        "per_100g": per_100g,
        "weight": round(counted_grams, 1),
        "per_unit": per_unit,
        "makes": makes,
        "yield_unit": str(recipe.get("yield_unit") or "").strip(),
        "servings": servings,
        "items": items,
        "counted": counted,
        "missing": len(missing),
        "unconfirmed": sum(1 for i in items if i["match"] and i["match"].get("auto")),
        "complete": counted > 0 and not missing,
        "source": {k: db.meta.get(k) for k in ("version", "date", "license", "license_url", "attribution", "url")},
        "sources": [
            {k: meta.get(k) for k in ("source", "version", "date", "license", "license_url", "attribution", "url")}
            for meta in (db.meta, db.usda_meta)
            if meta
        ],
    }
