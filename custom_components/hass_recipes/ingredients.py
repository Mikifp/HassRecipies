"""Parse ingredient lines into quantity / unit / food and convert to grams.

Deliberately dependency-free. Anything that cannot be understood is returned
with ``quantity=None`` so callers can show the original text untouched.
"""

from __future__ import annotations

import re
from typing import Any

_FRACTIONS = {
    "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
    "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
    "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}
_FRACTION_RE = re.compile(r"(\d+)?\s*([" + "".join(_FRACTIONS) + r"])")

_NUM = r"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)"
_QTY = re.compile(rf"^\s*(?P<a>{_NUM})(?:\s*(?:-|–|—|to\s)\s*(?P<b>{_NUM}))?(?![\d/])")
_PAREN = re.compile(r"\(([^)]*)\)")
_FL_OZ = re.compile(r"^\s*(fl(?:uid)?\.?\s*(?:oz|ounces?)\.?)\s*", re.IGNORECASE)
# A unit is a whole word. Any letter counts (not just a-z), otherwise "2 løg" would read
# the "l" of "løg" as litres and leave "øg" as the food.
_WORD = re.compile(r"^\s*([^\W\d_]+)\.?\s*")
_METRIC = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|grams?|ml|l|litres?|liters?|oz|lbs?)\b", re.IGNORECASE)

# canonical unit -> (kind, factor to grams / millilitres)
UNITS: dict[str, tuple[str, float]] = {
    "g": ("weight", 1.0),
    "kg": ("weight", 1000.0),
    "mg": ("weight", 0.001),
    "oz": ("weight", 28.3495),
    "lb": ("weight", 453.592),
    "ml": ("volume", 1.0),
    "cl": ("volume", 10.0),
    "dl": ("volume", 100.0),
    "l": ("volume", 1000.0),
    "krm": ("volume", 1.0),  # Swedish kryddmått
    "dsp": ("volume", 10.0),  # dessert spoon
    "tsp": ("volume", 4.92892),
    "tbsp": ("volume", 14.7868),
    "fl_oz": ("volume", 29.5735),
    "cup": ("volume", 236.588),
    "pint": ("volume", 473.176),
    "quart": ("volume", 946.353),
    "gallon": ("volume", 3785.41),
}
_COUNT_UNITS = (
    "pinch dash clove can package stick slice piece bunch sprig head handful jar bottle bag sheet"
).split()

_ALIASES: dict[str, str] = {}


def _alias(canonical: str, *names: str) -> None:
    for name in names:
        _ALIASES[name] = canonical


_alias("g", "g", "gram", "grams", "gr", "gramme", "grammes")
_alias("kg", "kg", "kgs", "kilogram", "kilograms", "kilo", "kilos")
_alias("mg", "mg", "milligram", "milligrams")
_alias("oz", "oz", "ounce", "ounces")
_alias("lb", "lb", "lbs", "pound", "pounds")
_alias("ml", "ml", "milliliter", "milliliters", "millilitre", "millilitres")
_alias("cl", "cl", "centiliter", "centilitre", "centiliters", "centilitres")
_alias("dl", "dl", "deciliter", "decilitre", "deciliters", "decilitres")
_alias("l", "l", "liter", "liters", "litre", "litres")
_alias("tsp", "tsp", "tsps", "teaspoon", "teaspoons")
_alias("tbsp", "tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons")
_alias("cup", "cup", "cups", "c")
_alias("pint", "pint", "pints", "pt")
_alias("quart", "quart", "quarts", "qt")
_alias("gallon", "gallon", "gallons", "gal")
for _u in _COUNT_UNITS:
    _alias(_u, _u, _u + "s", _u + "es")

# ---- units in other languages ------------------------------------------------------
# Abbreviations are matched with or without a trailing dot, case-insensitively, and
# only as a whole word ("2 el Zucker", not the "el" inside "eller"). Spoon sizes follow
# the usual metric kitchen values (1 tsk/TL = 5 ml, 1 spsk/EL = 15 ml).
_alias("g", "gramm", "gramo", "gramos", "grammo", "grammi", "gramme", "grämm")
_alias("kg", "kilogramm", "kilogramo", "kilogramos", "kilogramme", "kilogrammes", "chilo", "chili", "chilogrammo", "chilogrammi")
_alias("ml", "mililitro", "mililitros", "millilitro", "millilitri", "millilitre")
_alias("cl", "centilitro", "centilitros", "centilitri")
_alias("dl", "deziliter", "decilitro", "decilitros", "decilitri", "décilitre", "décilitres")
_alias("l", "litro", "litros", "litri")
_alias(
    "tsp",
    # da / no / sv / fi / nl / de / es / it / fr
    "tsk", "teske", "teskefuld", "teskefulde", "tesked", "teskedar", "ts", "teskje", "tl", "theelepel", "theelepels",
    "teelöffel", "teeloeffel", "cucharadita", "cucharaditas", "cdta", "cucchiaino", "cucchiaini", "càc", "cac",
)
_alias(
    "tbsp",
    "spsk", "spiseske", "spiseskefuld", "spiseskefulde", "msk", "matsked", "matskedar", "ss", "spiseskje", "rkl", "el",
    "eetlepel", "eetlepels", "esslöffel", "essloeffel", "cucharada", "cucharadas", "cda", "cucchiaio", "cucchiai",
    "cs", "càs", "cas",
)
_alias("dsp", "dsk", "dessertske", "dessertskefuld", "dessertsked", "dessertskje", "dessertspoon", "dessertspoons")
_alias("krm", "krm", "kryddmått")
_alias("cup", "kop", "kopper", "kopp", "koppar", "kopje", "kopjes", "tasse", "tassen", "taza", "tazas", "tazza", "tazze")
_alias("pinch", "knsp", "knivspids", "knivsspids", "prise", "prisen", "messerspitze", "messerspitzen", "klype", "pizca", "pizcas", "pizzico", "pizzichi", "snufje", "snufjes", "mespunt", "pincée", "pincee", "pincées", "ripaus")
_alias("dash", "stænk", "spritzer", "trait", "chorrito", "chorro", "goccio", "scheut")
_alias("clove", "fed", "fedd", "klyfta", "klyftor", "zehe", "zehen", "gousse", "gousses", "diente", "dientes", "spicchio", "spicchi", "teen", "tenen", "teentje", "teentjes")
_alias("piece", "stk", "st", "stykke", "stykker", "stück", "stueck", "stücke", "stuk", "stuks", "pièce", "pièces", "piece", "pieza", "piezas", "unidad", "unidades", "pezzo", "pezzi", "kpl")
_alias("bunch", "bundt", "bundter", "knippe", "knippen", "bund", "bündel", "bouquet", "botte", "bottes", "manojo", "manojos", "ramillete", "mazzo", "mazzetto", "mazzi", "bos", "bosje", "bossen", "nippa")
_alias("can", "dåse", "dåser", "daase", "boks", "bokser", "burk", "burkar", "dose", "dosen", "boîte", "boite", "boîtes", "lata", "latas", "scatola", "scatole", "lattina", "blik", "blikje", "blikken", "tölkki", "purkki")
_alias("jar", "glas", "bocal", "frasco", "frascos", "vasetto", "barattolo", "pot", "potje")
_alias("package", "pk", "pakke", "pakker", "paket", "förp", "packung", "packungen", "päckchen", "paeckchen", "pck", "paquet", "paquets", "sachet", "paquete", "paquetes", "sobre", "pacchetto", "confezione", "confezioni", "bustina", "pak", "pakje")
_alias("bag", "pose", "poser", "påse", "påsar", "tüte", "tüten", "sac", "sachets", "bolsa", "bolsas", "sacchetto", "sacchetti", "zak", "zakje", "zakjes")
_alias("handful", "håndfuld", "haandfuld", "håndfulde", "näve", "nävar", "handvoll", "poignée", "poignee", "poignées", "puñado", "punado", "puñados", "manciata", "manciate", "handvol")
_alias("slice", "skive", "skiver", "skiva", "skivor", "scheibe", "scheiben", "tranche", "tranches", "rebanada", "rebanadas", "lonja", "loncha", "fetta", "fette", "plak", "plakje", "plakken", "viipale")
_alias("sprig", "kvist", "kviste", "zweig", "zweige", "brin", "brins", "ramita", "ramitas", "rama", "rametto", "ramoscello", "takje", "takjes", "oksa")
_alias("head", "hoved", "hoveder", "kopf", "köpfe", "tête", "tete", "têtes", "cabeza", "cabezas", "testa", "teste", "krop", "kroppen")
_alias("bottle", "flaske", "flasker", "flaska", "flaskor", "flasche", "flaschen", "bouteille", "bouteilles", "botella", "botellas", "bottiglia", "bottiglie", "fles", "flessen")
_alias("sheet", "ark", "blatt", "blätter", "feuille", "feuilles", "hoja", "hojas", "foglio", "fogli", "vel", "vellen")

# A word that may sit between a unit and the food ("2 cucharadas de azúcar").
_LINK_WORDS = re.compile(r"^\s*(?:de|del|di|d'|van|af|av|von|vom|des|du)\s+", re.IGNORECASE)

# Grams per millilitre, matched as whole words (plural-insensitive), longest
# phrase first. Values are typical figures for the form usually used in recipes
# (e.g. flour spooned, onion chopped); they are estimates, which is why callers
# show the result as approximate.
DENSITY: dict[str, float] = {
    # liquids
    "water": 1.0, "stock": 1.0, "broth": 1.0, "bouillon": 1.0, "coffee": 1.0, "espresso": 1.0,
    "tea": 1.0, "wine": 0.99, "beer": 1.01, "rum": 0.94, "vodka": 0.94, "whiskey": 0.94,
    "brandy": 0.94, "juice": 1.04, "lemon juice": 1.03, "lime juice": 1.03,
    "orange juice": 1.04, "vinegar": 1.01, "soy sauce": 1.22, "tamari": 1.22,
    "fish sauce": 1.2, "worcestershire": 1.15, "hot sauce": 1.0, "oyster sauce": 1.3,
    # dairy
    "milk": 1.03, "buttermilk": 1.03, "evaporated milk": 1.06, "condensed milk": 1.3,
    "sweetened condensed milk": 1.3, "coconut milk": 1.0, "coconut cream": 1.0,
    "almond milk": 1.0, "oat milk": 1.0, "soy milk": 1.03, "milk powder": 0.51,
    "cream": 0.99, "heavy cream": 0.99, "whipping cream": 0.99, "double cream": 0.99,
    "single cream": 1.0, "half and half": 1.0, "half & half": 1.0, "sour cream": 0.97,
    "creme fraiche": 0.99, "yogurt": 1.03, "yoghurt": 1.03, "greek yogurt": 1.06,
    "greek yoghurt": 1.06, "ice cream": 0.55, "cream cheese": 0.98, "ricotta": 1.04,
    "cottage cheese": 0.96, "mascarpone": 1.0, "quark": 1.03, "cheese": 0.47,
    "parmesan": 0.42, "pecorino": 0.42, "cheddar": 0.48, "mozzarella": 0.48,
    "feta": 0.63, "goat cheese": 0.9, "butter": 0.96, "margarine": 0.96, "ghee": 0.91,
    "shortening": 0.8, "lard": 0.87,
    # oils
    "oil": 0.92, "olive oil": 0.91, "vegetable oil": 0.92, "canola oil": 0.92,
    "sunflower oil": 0.92, "sesame oil": 0.92, "coconut oil": 0.92, "avocado oil": 0.92,
    # sweeteners
    "sugar": 0.845, "granulated sugar": 0.845, "caster sugar": 0.845, "superfine sugar": 0.845,
    "white sugar": 0.845, "brown sugar": 0.9, "light brown sugar": 0.9, "dark brown sugar": 0.9,
    "muscovado": 0.9, "powdered sugar": 0.51, "confectioners sugar": 0.51,
    "icing sugar": 0.51, "coconut sugar": 0.68, "honey": 1.42, "maple syrup": 1.32,
    "syrup": 1.3, "molasses": 1.4, "agave": 1.36, "corn syrup": 1.38, "golden syrup": 1.4,
    "jam": 1.35, "jelly": 1.35, "marmalade": 1.35, "nutella": 1.2,
    # flours, starches, baking
    "flour": 0.53, "all-purpose flour": 0.53, "plain flour": 0.53, "bread flour": 0.51,
    "cake flour": 0.48, "whole wheat flour": 0.51, "wholemeal flour": 0.51,
    "self-rising flour": 0.53, "self raising flour": 0.53, "almond flour": 0.41,
    "ground almond": 0.41, "coconut flour": 0.47, "rye flour": 0.43, "oat flour": 0.39,
    "rice flour": 0.67, "cornmeal": 0.66, "polenta": 0.66, "semolina": 0.71,
    "cornstarch": 0.54, "cornflour": 0.54, "corn starch": 0.54, "potato starch": 0.68,
    "tapioca": 0.51, "breadcrumb": 0.46, "panko": 0.21, "cocoa": 0.36,
    "cocoa powder": 0.36, "baking powder": 0.93, "baking soda": 0.93,
    "bicarbonate of soda": 0.93, "yeast": 0.62, "cream of tartar": 0.6,
    "gelatin": 0.6, "vanilla": 0.88, "vanilla extract": 0.88, "vanilla paste": 1.1,
    # salt & spices
    "salt": 1.2, "kosher salt": 0.9, "sea salt": 1.0, "flaky salt": 0.6,
    "pepper": 0.5, "black pepper": 0.5, "cinnamon": 0.53, "nutmeg": 0.45, "cumin": 0.45,
    "paprika": 0.5, "chili powder": 0.55, "cayenne": 0.5, "garlic powder": 0.6,
    "onion powder": 0.47, "ginger": 0.38, "turmeric": 0.65, "curry powder": 0.45,
    "oregano": 0.2, "basil": 0.15, "thyme": 0.3, "rosemary": 0.3, "parsley": 0.15,
    "chili flakes": 0.4, "red pepper flakes": 0.4, "mustard": 1.05, "dijon": 1.05,
    # grains, legumes, pasta
    "rice": 0.78, "brown rice": 0.8, "basmati": 0.78, "quinoa": 0.72, "couscous": 0.73,
    "oats": 0.34, "rolled oats": 0.34, "oatmeal": 0.34, "pasta": 0.42, "lentil": 0.81,
    "chickpea": 0.85, "black bean": 0.78, "kidney bean": 0.8, "barley": 0.8,
    "bulgur": 0.6, "popcorn": 0.8, "cooked rice": 0.67, "cooked pasta": 0.6,
    "cooked quinoa": 0.78, "cooked bean": 0.73, "cooked lentil": 0.83,
    # nuts, seeds, dried fruit
    "almond": 0.6, "sliced almond": 0.39, "walnut": 0.5, "pecan": 0.46, "peanut": 0.62,
    "cashew": 0.58, "pistachio": 0.52, "hazelnut": 0.57, "pine nut": 0.57,
    "sesame seed": 0.61, "chia seed": 0.8, "flaxseed": 0.71, "flax seed": 0.71,
    "sunflower seed": 0.59, "pumpkin seed": 0.55, "poppy seed": 0.6,
    "coconut": 0.34, "shredded coconut": 0.34, "desiccated coconut": 0.34,
    "peanut butter": 1.08, "almond butter": 1.06, "tahini": 1.01,
    "chocolate chip": 0.72, "raisin": 0.61, "sultana": 0.61, "dried cranberry": 0.51,
    "date": 0.62, "currant": 0.6,
    # produce (as typically measured: chopped / sliced / whole berries)
    "onion": 0.68, "carrot": 0.54, "celery": 0.43, "bell pepper": 0.63, "tomato": 0.76,
    "mushroom": 0.3, "spinach": 0.13, "kale": 0.1, "lettuce": 0.15, "cabbage": 0.3,
    "broccoli": 0.38, "cauliflower": 0.45, "potato": 0.63, "banana": 0.95,
    "apple": 0.53, "blueberry": 0.63, "strawberry": 0.7, "raspberry": 0.52,
    "corn": 0.65, "pea": 0.65, "pumpkin puree": 1.03, "applesauce": 1.08,
    "tomato sauce": 1.03, "tomato puree": 1.05, "tomato paste": 1.1, "passata": 1.03,
    "salsa": 1.05, "ketchup": 1.15, "mayonnaise": 0.95, "mayo": 0.95,
    # Danish staples (water and salt are spelled the same or covered above)
    "vand": 1.0, "mel": 0.53, "hvedemel": 0.53, "fuldkornshvedemel": 0.51, "rugmel": 0.43,
    "havregryn": 0.34, "sukker": 0.845, "flormelis": 0.51, "farin": 0.9, "brun farin": 0.9,
    "rørsukker": 0.845, "smør": 0.96, "mælk": 1.03, "sødmælk": 1.03, "letmælk": 1.03,
    "minimælk": 1.03, "kærnemælk": 1.03, "fløde": 0.99, "piskefløde": 0.99,
    "madlavningsfløde": 0.99, "cremefraiche": 0.99, "skyr": 1.05, "rømme": 0.97,
    "olie": 0.92, "olivenolie": 0.91, "rapsolie": 0.92, "solsikkeolie": 0.92,
    "honning": 1.42, "sirup": 1.3, "ahornsirup": 1.32, "peber": 0.5, "kanel": 0.53,
    "kakao": 0.36, "bagepulver": 0.93, "natron": 0.93, "gær": 0.62, "tørgær": 0.62,
    "vaniljesukker": 0.9, "ris": 0.78, "linse": 0.81, "linser": 0.81, "mandel": 0.6,
    "mandler": 0.6, "valnød": 0.5, "valnødder": 0.5, "rosin": 0.61, "rosiner": 0.61,
    "tomatpuré": 1.1, "sennep": 1.05, "eddike": 1.01, "citronsaft": 1.03, "rødvin": 0.99,
    "hvidvin": 0.99, "øl": 1.01, "kaffe": 1.0, "løg": 0.68, "gulerod": 0.54, "gulerødder": 0.54,
    "kartoffel": 0.63, "kartofler": 0.63, "svampe": 0.3, "champignon": 0.3,
}

# Grams for one piece when there is no unit ("2 eggs", "1 onion").
PIECE_GRAMS: dict[str, float] = {
    "egg yolk": 18.0, "egg white": 33.0, "egg": 50.0, "onion": 150.0, "shallot": 40.0,
    "potato": 170.0, "sweet potato": 200.0, "tomato": 120.0, "carrot": 60.0,
    "bell pepper": 150.0, "banana": 120.0, "apple": 180.0, "avocado": 150.0,
    "lemon": 85.0, "lime": 65.0, "orange": 150.0, "zucchini": 200.0, "courgette": 200.0,
    "cucumber": 300.0, "ladyfinger": 10.0, "tortilla": 45.0,
    # Danish
    "æg": 50.0, "æggeblomme": 18.0, "æggeblommer": 18.0, "æggehvide": 33.0, "æggehvider": 33.0,
    "løg": 150.0, "rødløg": 150.0, "skalotteløg": 40.0, "kartoffel": 170.0, "kartofler": 170.0,
    "tomat": 120.0, "tomater": 120.0, "gulerod": 60.0, "gulerødder": 60.0, "peberfrugt": 150.0,
    "peberfrugter": 150.0, "banan": 120.0, "bananer": 120.0, "æble": 180.0, "æbler": 180.0,
    "citron": 85.0, "citroner": 85.0, "appelsin": 150.0, "appelsiner": 150.0, "squash": 200.0,
    "agurk": 300.0, "agurker": 300.0, "avokado": 150.0,
}

# (unit, food keyword) -> grams per unit
UNIT_FOOD_GRAMS: dict[tuple[str, str], float] = {
    ("clove", "garlic"): 3.0,
    ("stick", "butter"): 113.0,
    ("slice", "bread"): 30.0,
    ("slice", "bacon"): 15.0,
    ("slice", "cheese"): 20.0,
    ("head", "garlic"): 50.0,
    ("bunch", "parsley"): 60.0,
    ("sprig", "thyme"): 1.0,
    ("sprig", "rosemary"): 2.0,
    ("clove", "hvidløg"): 3.0,
    ("head", "hvidløg"): 50.0,
    ("slice", "brød"): 30.0,
    ("slice", "ost"): 20.0,
    ("bunch", "persille"): 60.0,
    ("sprig", "timian"): 1.0,
    ("sprig", "rosmarin"): 2.0,
}


def _singular(word: str) -> str:
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith(("oes", "ches", "shes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us")):
        return word[:-1]
    return word


def _words(text: str) -> str:
    """Normalise to ' singular words ' so phrases can be matched on boundaries."""
    return " " + " ".join(_singular(w) for w in re.findall(r"[^\W\d_]+", text.lower())) + " "


_DENSITY_KEYS = sorted(((_words(k), v) for k, v in DENSITY.items()), key=lambda kv: -len(kv[0]))
_PIECE_KEYS = sorted(((_words(k), v) for k, v in PIECE_GRAMS.items()), key=lambda kv: -len(kv[0]))
_UNIT_FOOD_KEYS = [(u, _words(k), v) for (u, k), v in UNIT_FOOD_GRAMS.items()]


# "¹/₂" (superscript over subscript, as many sites write fractions) is just 1/2
_SUPER_SUB = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉⁄", "01234567890123456789/")


def _expand_fractions(text: str) -> str:
    text = text.translate(_SUPER_SUB)
    return _FRACTION_RE.sub(
        lambda m: (f"{m.group(1)} " if m.group(1) else "") + _FRACTIONS[m.group(2)], text
    )


def _to_float(text: str) -> float:
    text = text.strip().replace(",", ".")
    if " " in text:
        whole, frac = text.split(None, 1)
        return float(whole) + _to_float(frac)
    if "/" in text:
        num, den = text.split("/")
        return float(num) / float(den)
    return float(text)


def _metric(text: str) -> tuple[str, float] | None:
    """Find a metric amount like '38g' or '360 mL'; returns ('g'|'ml', value)."""
    found: dict[str, float] = {}
    for m in _METRIC.finditer(text):
        value = _to_float(m.group(1))
        unit = _ALIASES.get(m.group(2).lower().rstrip("."), m.group(2).lower())
        kind, factor = UNITS.get(unit, (None, 0))
        if kind == "weight":
            found.setdefault("g", value * factor)
        elif kind == "volume":
            found.setdefault("ml", value * factor)
    for key in ("g", "ml"):
        if key in found:
            return key, found[key]
    return None


def _density(food: str) -> float | None:
    padded = _words(food)
    for key, value in _DENSITY_KEYS:
        if key in padded:
            return value
    return None


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


SUBSTITUTE_SEP = " || "
_HEADER = re.compile(r"^#{1,6}\s+")


def is_header(line: str) -> bool:
    """Lines starting with '## ' are section headings, not ingredients."""
    return bool(_HEADER.match(line.strip()))


def parse_ingredient(line: str) -> dict[str, Any]:
    """Return a structured view of one ingredient line.

    Two inline conventions keep the stored data a plain list of strings:
    ``## Dough`` is a section heading, and ``200 g butter || 180 g coconut oil``
    carries a substitute with its own amount (parsed into ``substitute``).
    """
    if is_header(line):
        title = _HEADER.sub("", line.strip()).strip()
        return {**_empty(title), "header": True}
    if SUBSTITUTE_SEP in line:
        main, _, alt = line.partition(SUBSTITUTE_SEP)
        result = _parse_line(main.strip())
        result["substitute"] = _parse_line(alt.strip()) if alt.strip() else None
        return result
    return _parse_line(line)


def _empty(line: str) -> dict[str, Any]:
    return {
        "text": line,
        "quantity": None,
        "quantity_max": None,
        "unit": None,
        "unit_text": None,
        "food": line.strip(),
        "note": "",
        "grams": None,
        "grams_max": None,
        "ml": None,
        "approximate": False,
        "header": False,
        "substitute": None,
    }


def _parse_line(line: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "text": line,
        "quantity": None,
        "quantity_max": None,
        "unit": None,
        "unit_text": None,
        "food": line.strip(),
        "note": "",
        "grams": None,
        "grams_max": None,
        "ml": None,
        "approximate": False,
        "header": False,
        "substitute": None,
    }
    text = _expand_fractions(line.strip())
    m = _QTY.match(text)
    if not m:
        return result
    quantity = _to_float(m.group("a"))
    quantity_max = _to_float(m.group("b")) if m.group("b") else None
    rest = text[m.end():]

    # "2 (7-oz/200g) packages": parenthetical size *before* the unit is per unit.
    per_unit: tuple[str, float] | None = None
    pm = re.match(r"^\s*\(([^)]*)\)\s*", rest)
    if pm:
        per_unit = _metric(pm.group(1))
        rest = rest[pm.end():]

    unit = unit_text = None
    fl = _FL_OZ.match(rest)
    if fl:
        unit, unit_text, rest = "fl_oz", fl.group(1), rest[fl.end():]
    else:
        wm = _WORD.match(rest)
        if wm and (canonical := _ALIASES.get(wm.group(1).lower())):
            unit, unit_text, rest = canonical, wm.group(1), rest[wm.end():]

    rest = re.sub(r"^\s*of\s+", "", rest.strip(), flags=re.IGNORECASE)
    if unit:
        rest = _LINK_WORDS.sub("", rest)
    parens = _PAREN.findall(rest)
    cleaned = re.sub(r"\s+", " ", _PAREN.sub("", rest)).strip()
    food, _, note = cleaned.partition(",")
    food = food.strip(" .;:") or line.strip()
    paren_metric = _metric(" ".join(parens))

    def amount(q: float) -> tuple[float | None, float | None, bool]:
        """(grams, ml, approximate) for quantity ``q``."""
        grams = ml = None
        approx = False
        if per_unit:
            kind, val = per_unit
            grams, ml = (val * q, None) if kind == "g" else (None, val * q)
        elif paren_metric:
            kind, val = paren_metric
            scaled = val * q / quantity if quantity else val
            grams, ml = (scaled, None) if kind == "g" else (None, scaled)
        elif unit in UNITS:
            kind, factor = UNITS[unit]
            if kind == "weight":
                grams = q * factor
            else:
                ml = q * factor
        elif unit is None or unit == "piece":
            padded = _words(food)
            for key, per in _PIECE_KEYS:
                if key in padded:
                    grams, approx = q * per, True
                    break
        elif unit:
            padded = _words(food)
            for u, keyword, per in _UNIT_FOOD_KEYS:
                if u == unit and keyword in padded:
                    grams, approx = q * per, True
                    break
        if grams is None and ml is not None:
            density = _density(food)
            if density:
                grams, approx = ml * density, True
        return grams, ml, approx

    grams, ml, approx = amount(quantity)
    result.update(
        quantity=round(quantity, 3),  # keep 0.75 / 0.333 exact enough to show as ¾ / ⅓
        quantity_max=None if quantity_max is None else round(quantity_max, 3),
        unit=unit,
        unit_text=unit_text,
        food=food,
        note=note.strip(" ."),
        grams=_round(grams),
        ml=_round(ml),
        approximate=approx,
    )
    if quantity_max is not None:
        gmax, _, _ = amount(quantity_max)
        result["grams_max"] = _round(gmax)
    return result


# Units that count discrete things; estimated weights for these are not shown.
COUNT_AS_ITEMS = frozenset({"clove", "slice", "piece", "sprig", "head", "bunch", "handful", "sheet"})

_GLYPHS = [(0.125, "⅛"), (0.25, "¼"), (1 / 3, "⅓"), (0.5, "½"), (2 / 3, "⅔"), (0.75, "¾"), (0.875, "⅞")]


def format_number(n: float) -> str:
    """Friendly quantity: 1.5 -> '1½', 0.333 -> '⅓', 12.04 -> '12'."""
    if n >= 10:
        return f"{round(n * 10) / 10:g}"
    whole = int(n + 0.02)
    frac = n - whole
    if frac < 0.02:
        return str(whole)
    for value, glyph in _GLYPHS:
        if abs(frac - value) < 0.03:
            return f"{whole}{glyph}" if whole else glyph
    return f"{round(n, 2):g}"


def _format_grams(g: float) -> str:
    if g >= 100:
        return str(round(g))
    if g >= 10:
        return f"{round(g * 2) / 2:g}"
    return f"{round(g, 1):g}"


def format_ingredient(
    parsed: dict[str, Any], scale: float = 1.0, mode: str = "grams", mark_approx: bool = True
) -> str:
    """Render a parsed ingredient scaled by ``scale``; mirrors the panel's display."""
    if parsed.get("quantity") is None:
        return parsed["text"]
    food = parsed["food"] + (f", {parsed['note']}" if parsed.get("note") else "")
    # Whole items ("3 eggs", "2 cloves garlic") read better as counts than as
    # estimated weights, unless the line itself gave an exact metric amount.
    countable = parsed.get("approximate") and (parsed.get("unit") is None or parsed["unit"] in COUNT_AS_ITEMS)
    if mode == "grams" and not countable:
        tilde = "≈ " if parsed.get("approximate") and mark_approx else ""
        if parsed.get("grams") is not None:
            hi = f"–{_format_grams(parsed['grams_max'] * scale)}" if parsed.get("grams_max") is not None else ""
            return f"{tilde}{_format_grams(parsed['grams'] * scale)}{hi} g {food}"
        if parsed.get("ml") is not None:
            return f"{_format_grams(parsed['ml'] * scale)} ml {food}"
    if scale == 1:
        return parsed["text"]
    qty = format_number(parsed["quantity"] * scale)
    if parsed.get("quantity_max") is not None:
        qty += "–" + format_number(parsed["quantity_max"] * scale)
    return " ".join(part for part in (qty, parsed.get("unit_text") or "", food) if part)
