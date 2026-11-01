"""Imported ingredient lines are tidied into the way recipes are written here (no Home Assistant needed)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "ingredient_tidy", Path(__file__).parents[1] / "custom_components/hass_recipes/ingredient_tidy.py"
)
tidy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tidy)

ARLA = (
    """1 fintsnittet spidskål (ca. 600 g)
2 tsk groft salt
400 g hakket grisekød
½ bundt finthakket forårsløg
2 finthakkede fed hvidløg
3 spsk soja
2 spsk ristet sesamolie
1 spsk fintrevet frisk ingefær
1 pakke gyoza- eller wontondej (ca. 200 g)
4 dl hønsebouillon
150 g revet mozzarellaost
½ bundt forårsløg i ringe
crispy chiliolie""",
    """600 g spidskål (1 stk) // fintsnittet
2 tsk salt // groft
400 g hakket grisekød
0,5 bundt forårsløg // finthakket
2 fed hvidløg // finthakkede
3 spsk soja
2 spsk ristet sesamolie
1 spsk ingefær // fintrevet frisk
1 pakke gyozadej (ca. 200 g) || 1 pakke wontondej (ca. 200 g)
4 dl hønsebouillon
150 g mozzarellaost // revet
0,5 bundt forårsløg // i ringe
crispy chiliolie""",
)

VALDEMARSRO = (
    """50 g bacon
2 løg, finthakket
2 fed hvidløg, finthakket
2 tsk tørret timian
500 g hakket oksekød
1 dl rødvin
100 g soltørrede tomater i olie, finthakket
2 spsk rød balsamico
800 g hakkede tomater på dåse
2 spsk olivenolie
salt og friskkværnet peber
400 g spaghetti
75 g parmesan, friskrevet
2 dryp olivenolie""",
    """50 g bacon
2 løg // finthakket
2 fed hvidløg // finthakket
2 tsk timian // tørret
500 g hakket oksekød
1 dl rødvin
100 g soltørrede tomater // i olie, finthakket
2 spsk rød balsamico
800 g hakkede tomater // på dåse
2 spsk olivenolie
salt
peber // friskkværnet
400 g spaghetti
75 g parmesan // friskrevet
2 dryp olivenolie""",
)

LOUISE = (
    """500 g spaghetti
parmesan
## Tomatsauce
3 dåser hele flåede tomater
1 lille løg
1 fed hvidløg
1 spsk olivenolie
1 spsk sukker
1 tsk groft salt
1 tsk oregano
Friskkværnet sort peber
## Kødboller
400 g hakket oksekød
400 g hakket svinekød
2 løg
2 fed hvidløg
1 chili (finthakket)
1 æg
1 dl rasp
5 spsk parmesan (fintrevet)
1 dl mælk
2 tsk tørret timian
1 ½ spsk hakket persille eller tørret
¾ tsk salt
peber
olie (til stegning)""",
    """500 g spaghetti
parmesan
## Tomatsauce
3 dåser flåede tomater // hele
1 løg // lille
1 fed hvidløg
1 spsk olivenolie
1 spsk sukker
1 tsk salt // groft
1 tsk oregano
sort peber // Friskkværnet
## Kødboller
400 g hakket oksekød
400 g hakket svinekød
2 løg
2 fed hvidløg
1 chili // finthakket
1 æg
1 dl rasp
5 spsk parmesan // fintrevet
1 dl mælk
2 tsk timian // tørret
1,5 spsk persille // hakket eller tørret
0,75 tsk salt
peber
olie // til stegning""",
)


def _check(pair):
    raw, wanted = pair
    assert tidy.tidy_ingredients(raw.splitlines()) == wanted.splitlines()


def test_arla_dumpling_lasagne():
    _check(ARLA)


def test_valdemarsro_bolognese():
    _check(VALDEMARSRO)


def test_louises_spaghetti_and_meatballs():
    _check(LOUISE)


def test_a_line_already_in_the_house_style_is_left_alone():
    for line in ["2 løg // finthakket", "200 g smør || 180 g olie", "## Dej", "2 cups flour"]:
        assert tidy.tidy_line(line) == [line]


def test_fractions_become_decimals():
    assert tidy.tidy_line("¼ tsk salt") == ["0,25 tsk salt"]
    assert tidy.tidy_line("1/2 dl mælk") == ["0,5 dl mælk"]
    assert tidy.tidy_line("1 1/2 dl mælk") == ["1,5 dl mælk"]
    assert tidy.tidy_line("2-3 spsk olie") == ["2-3 spsk olie"]
