"""Tidy imported ingredient lines into the way the recipes are written here.

A web page says ``2 finthakkede fed hvidløg``; here it is ``2 fed hvidløg // finthakkede``: the amount, the
unit and the food first, how it is prepared in the note after `` // ``. Fractions become decimals
(``½`` is ``0,5``), ``X- eller Ydej`` becomes two alternatives (`` || ``), and ``salt og peber`` becomes two lines.
"""

from __future__ import annotations

import re

_FRACTIONS = {
    "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
    "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
}
_FRAC_CHARS = "".join(_FRACTIONS)
_QTY = re.compile(
    rf"^(?:(?P<whole>\d+)\s*(?P<uni>[{_FRAC_CHARS}])"  # 1 ½
    rf"|(?P<uni_only>[{_FRAC_CHARS}])"  # ½
    r"|(?P<w2>\d+)\s+(?P<n>\d+)/(?P<d>\d+)"  # 1 1/2
    r"|(?P<n2>\d+)/(?P<d2>\d+)"  # 1/2
    r"|(?P<plain>\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?))"  # 2, 1,5, 2-3
    r"(?![\d/])"
)

UNITS = {
    "g", "kg", "mg", "dl", "cl", "ml", "l", "liter", "tsk", "spsk", "knivspids", "nip", "dryp", "håndfuld",
    "fed", "bundt", "pakke", "pakker", "dåse", "dåser", "stk", "stk.", "skive", "skiver", "stang", "stænger",
    "stilk", "stilke", "bæger", "glas", "pose", "poser", "kvist", "kviste", "knold", "knolde", "cup", "cups",
    "tbsp", "tsp", "oz", "lb", "clove", "cloves",
}

# how a food is prepared or what it is like: said before the food on a page, kept in the note here
_ADJECTIVES = {
    "finthakket", "finthakkede", "grofthakket", "grofthakkede", "fintsnittet", "fintsnittede", "snittet",
    "snittede", "skåret", "skårne", "finskåret", "finskårne", "revet", "revne", "fintrevet", "fintrevne",
    "grofttrevet", "grofttrevne", "friskrevet", "friskrevne", "tørret", "tørrede", "friskkværnet", "kværnet",
    "groft", "frisk", "friske", "hele", "lille", "små", "store", "stor", "skrællet", "skrællede", "pillet",
    "pillede", "presset", "pressede", "smeltet", "smeltede", "optøet", "optøede", "hakket", "hakkede",
}
_MINCED = {"hakket", "hakkede"}  # part of the name in "hakket oksekød" and "hakkede tomater", a note on herbs
_PREPOSITIONS = {"i", "på", "til"}
_AMOUNT_PAREN = re.compile(r"\d")
_WEIGHT_PAREN = re.compile(r"^(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(g|kg|ml|dl|cl|l)$", re.IGNORECASE)
_PAREN = re.compile(r"\(([^()]*)\)")
_ALT = re.compile(r"^(?P<a>\S+)-\s+eller\s+(?P<b>\S+)$")
_SUFFIXES = ("dej", "ost", "kød", "bouillon", "olie", "mel", "sauce", "salat", "pasta", "brød", "løg", "sirup", "fløde")


def _decimal(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _quantity(text: str) -> tuple[str, str]:
    """(the amount as written here, the rest of the line); ("", text) when it does not start with an amount."""
    m = _QTY.match(text)
    if not m:
        return "", text
    g = m.groupdict()
    if g["uni"]:
        qty = _decimal(int(g["whole"]) + _FRACTIONS[g["uni"]])
    elif g["uni_only"]:
        qty = _decimal(_FRACTIONS[g["uni_only"]])
    elif g["w2"]:
        qty = _decimal(int(g["w2"]) + int(g["n"]) / int(g["d"]))
    elif g["n2"]:
        qty = _decimal(int(g["n2"]) / int(g["d2"]))
    else:
        qty = g["plain"]
    return qty, text[m.end():].strip()


def _is_adjective(words: list[str]) -> bool:
    """Whether the first word is one to move to the note (``hakket`` stays in ``hakket oksekød``)."""
    if len(words) < 2:
        return False
    word = words[0].casefold()
    if word not in _ADJECTIVES:
        return False
    if word in _MINCED:
        nxt = words[1].casefold()
        return not (nxt.endswith("kød") or nxt == "tomater")
    return True


def _alternatives(food: str) -> list[str]:
    """``gyoza- eller wontondej`` -> [``gyozadej``, ``wontondej``]; the food itself when it is not like that."""
    m = _ALT.match(food)
    if m:
        b = m.group("b")
        for suffix in _SUFFIXES:
            if b.casefold().endswith(suffix) and len(b) > len(suffix):
                return [m.group("a") + suffix, b]
    return [food]


def tidy_line(line: str) -> list[str]:
    """One imported ingredient line as one or more lines in the way recipes are written here."""
    text = " ".join(str(line).split())
    if not text or text.startswith("#") or " // " in text or " || " in text:
        return [text] if text else []
    # "salt og friskkværnet peber": two things on one line
    if not re.search(r"\d", text) and " og " in text and "," not in text and "(" not in text:
        return [out for part in text.split(" og ") for out in tidy_line(part)]

    qty, rest = _quantity(text)
    notes_paren: list[str] = []
    amount_parens: list[str] = []
    for m in _PAREN.finditer(rest):
        inner = m.group(1).strip()
        (amount_parens if _AMOUNT_PAREN.search(inner) else notes_paren).append(inner)
    rest = " ".join(_PAREN.sub(" ", rest).split())
    main, _, tail = rest.partition(",")
    words = main.split()
    tail = tail.strip()
    if not words:
        return [text]

    lead: list[str] = []
    # an adjective said before the unit: "2 finthakkede fed hvidløg"
    if qty and len(words) > 2 and words[0].casefold() in _ADJECTIVES and words[1].casefold() in UNITS:
        lead.append(words.pop(0))
    unit = ""
    if qty and words and words[0].casefold() in UNITS:
        unit = words.pop(0)
    while _is_adjective(words):
        lead.append(words.pop(0))
    if not words:
        return [text]
    # "persille eller tørret": the other choice goes in the note too
    if len(words) >= 3 and words[-2].casefold() == "eller" and words[-1].casefold() in _ADJECTIVES:
        lead.append(f"eller {words[-1]}")
        words = words[:-2]
    prep = ""
    for i in range(1, len(words) - 1):
        if words[i].casefold() in _PREPOSITIONS:
            prep = " ".join(words[i:])
            words = words[:i]
            break
    food = " ".join(words)

    note = ", ".join(p for p in [" ".join(lead), ", ".join(notes_paren), prep, tail] if p)
    parens = " ".join(f"({p})" for p in amount_parens)

    # "1 fintsnittet spidskål (ca. 600 g)": the weight is the amount, the count goes in brackets
    if qty and not unit and len(amount_parens) == 1:
        w = _WEIGHT_PAREN.match(amount_parens[0])
        if w:
            qty, unit, parens = w.group(1), w.group(2).lower(), f"({qty} stk)"

    def compose(name: str) -> str:
        return " ".join(p for p in [qty, unit, name, parens] if p)

    result = " || ".join(compose(name) for name in _alternatives(food))
    return [f"{result} // {note}" if note else result]


def tidy_ingredients(lines: list[str]) -> list[str]:
    """Tidy a whole ingredient list (headings are left as they are)."""
    out: list[str] = []
    for line in lines:
        out.extend(tidy_line(line) if isinstance(line, str) else [line])
    return out
