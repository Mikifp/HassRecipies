"""Turn plain text into a recipe: a typed-up recipe, copied text, or a video transcript.

Without any AI this is a best-effort reading. A text that has "Ingredients" and "Instructions"
headings (English or Danish) is split at them. Anything else is treated as spoken or running text:
the sentences become the steps and amounts such as "200 g butter" are picked out as ingredients.
The result is only a first draft that is reviewed in the editor before it is saved.
"""

from __future__ import annotations

import re
from typing import Any

MIN_CHARS = 20
_CHUNK_WORDS = 28  # captions without punctuation are cut into steps of about this many words

_ING_HEAD = r"(?:ingredients?|ingredienser|du skal bruge|you(?:'| wi)ll need|what you(?:'| wi)ll need|what you need)"
_STEP_HEAD = r"(?:instructions?|directions?|method|steps?|preparation|procedure|fremgangsm[åa]de|s[åa]dan g[øo]r du|tilberedning|metode|zubereitung)"
_NOTE_HEAD = r"(?:notes?|noter|tips?|bem[æa]rkninger)"
_HEAD = re.compile(
    rf"^\s*(?:#+\s*)?(?:\*\*)?(?:(?P<ing>{_ING_HEAD})|(?P<step>{_STEP_HEAD})|(?P<note>{_NOTE_HEAD}))(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$",
    re.IGNORECASE,
)
_BULLET = re.compile(r"^\s*(?:[-*•▪◦·]+|\d+\s*[.)]|step\s*\d+\s*[:.)-])\s+", re.IGNORECASE)

# transcript noise: "0:05", "01:02:03", "[Music]", WEBVTT/SRT cue lines
_CUE = re.compile(r"^\s*(?:\d+\s*)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?.*)?$")
_STAMP = re.compile(r"^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s+")
_NOISE = re.compile(r"\[[^\]]{1,30}\]|\((?:music|applause|laughter|musik)\)", re.IGNORECASE)

_UNITS = (
    r"kg|g|grams?|gram|mg|ml|cl|dl|l|liters?|litres?|tsp|teaspoons?|tbsp|tablespoons?|cups?|spsk|tsk|"
    r"knsp|stk|dåser?|dåse|pinch(?:es)?|nip|oz|ounces?|lbs?|pounds?|cloves?|fed|bundt|bunch(?:es)?"
)
_COUNT_NOUNS = r"eggs?|æg|onions?|løg|cloves?|fed|lemons?|citron(?:er)?|carrots?|gulerødder?|tomatoes|tomater?|potatoes|kartofler"
_STOP = {
    "and", "og", "with", "med", "in", "i", "to", "til", "until", "indtil", "for", "of", "af", "the", "a", "an",
    "then", "så", "into", "from", "fra", "on", "på", "is", "er", "are", "at", "or", "eller", "that", "which",
}
_QTY = r"(?:\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?|\d+\s*/\s*\d+|[½¼¾⅓⅔])"
_AMOUNT = re.compile(
    rf"(?<![\w/.,])(?P<qty>{_QTY})\s*(?:(?P<unit>{_UNITS})\b\.?|(?=(?:{_COUNT_NOUNS})\b))\s*(?P<rest>(?:af\s+|of\s+)?[A-Za-zÆØÅæøå][\wÆØÅæøå'-]*(?:\s+[A-Za-zÆØÅæøå][\wÆØÅæøå'-]*){{0,3}})",
    re.IGNORECASE,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[\"'(]?[A-ZÆØÅ0-9])")


def _clean_line(line: str) -> str:
    line = _NOISE.sub(" ", line)
    line = _STAMP.sub("", line)
    return re.sub(r"\s+", " ", line).strip()


def _lines(text: str) -> list[str]:
    out = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.strip().upper().startswith("WEBVTT") or _CUE.match(raw):
            continue
        out.append(_clean_line(raw))
    return out


def _items(lines: list[str]) -> list[str]:
    return [t for line in lines if (t := _BULLET.sub("", line).strip())]


def _sentences(lines: list[str]) -> list[str]:
    prose = " ".join(line for line in lines if line)
    parts = [p.strip() for p in _SENTENCE.split(prose) if p.strip()]
    steps: list[str] = []
    for part in parts:
        words = part.split()
        if len(words) > _CHUNK_WORDS * 2:  # no punctuation (auto captions): cut at word boundaries
            for i in range(0, len(words), _CHUNK_WORDS):
                steps.append(" ".join(words[i : i + _CHUNK_WORDS]))
        elif steps and len(words) < 4:  # fragments belong to the sentence before
            steps[-1] = f"{steps[-1]} {part}"
        else:
            steps.append(part)
    return steps


def find_amounts(text: str) -> list[str]:
    """Ingredients named with an amount ("200 g butter", "2 eggs") in running text."""
    found: list[str] = []
    seen: set[str] = set()
    for m in _AMOUNT.finditer(text):
        words = m.group("rest").split()
        kept: list[str] = []
        for i, w in enumerate(words):
            if i > 0 and w.lower() in _STOP:
                break
            kept.append(w)
        if kept and kept[0].lower() in {"of", "af"}:
            kept = kept[1:]
        if not kept:
            continue
        qty = re.sub(r"\s+", " ", m.group("qty")).strip()
        unit = m.group("unit")
        item = " ".join([qty, *([unit] if unit else []), *kept]).strip()
        key = " ".join(kept).casefold()
        if key not in seen:
            seen.add(key)
            found.append(item)
    return found


def parse_text(text: str, url: str = "") -> dict[str, Any]:
    """Best-effort recipe out of plain text."""
    text = (text or "").strip()
    if len(text) < MIN_CHARS:
        raise ValueError("Paste a longer text to import")
    lines = _lines(text)

    ingredients: list[str] = []
    steps: list[str] = []
    notes: list[str] = []
    intro: list[str] = []
    mode = None
    for line in lines:
        m = _HEAD.match(line) if line else None
        if m:
            mode = "ing" if m.group("ing") else "step" if m.group("step") else "note"
            continue
        if not line:
            continue
        if mode == "ing":
            ingredients.append(line)
        elif mode == "step":
            steps.append(line)
        elif mode == "note":
            notes.append(line)
        else:
            intro.append(line)

    if ingredients or steps:
        ingredients = _items(ingredients)
        steps = _items(steps)
        if not steps and intro:  # ingredients under a heading, the method written as plain text
            steps = _sentences(intro)
            intro = []
    else:
        # no headings: spoken or running text; a short first line without a full stop is the title
        title = ""
        first = _BULLET.sub("", intro[0]).strip()
        if len(intro) > 1 and len(first.split()) <= 8 and not first.endswith((".", "!", "?", ",")):
            title, intro = first, intro[1:]
        steps = _sentences(intro)
        ingredients = find_amounts(" ".join(intro))
        intro = [title] if title else []

    name = ""
    description = ""
    if intro:
        first = _BULLET.sub("", intro[0]).strip()
        if len(first) <= 100 and not first.endswith((".", "!", "?")):
            name = first
            description = " ".join(intro[1:])[:500]
        else:
            description = " ".join(intro)[:500]
    if not ingredients and not steps:
        raise ValueError("No recipe could be read from that text")
    if not name and not ingredients and len(steps) == 1:
        name = steps[0][:60]
    if notes:
        description = (description + "\n" if description else "") + " ".join(notes)

    return {
        "name": name or "Imported recipe",
        "description": description.strip(),
        "image": "",
        "ingredients": ingredients,
        "instructions": steps,
        "tags": [],
        "categories": [],
        "servings": "",
        "yield_amount": None,
        "yield_unit": "",
        "prep_time": None,
        "cook_time": None,
        "total_time": None,
        "source_url": url,
    }
