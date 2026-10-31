"""The picture of a recipe page, for the results of a recipe-site search."""

import importlib
from pathlib import Path
import sys
import types

pkg = types.ModuleType("hr_i")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_i"] = pkg
sites = importlib.import_module("hr_i.recipe_sites")


def test_the_picture_is_the_og_image_made_into_a_full_address():
    page = '<html><head><meta property="og:title" content="X"><meta property="og:image" content="/wp/billede.jpg?a=1&amp;b=2"></head></html>'
    assert sites.page_image(page, "https://www.valdemarsro.dk/kylling/") == "https://www.valdemarsro.dk/wp/billede.jpg?a=1&b=2"
    page = '<meta content="https://cdn.example.com/a.jpg" name="twitter:image">'
    assert sites.page_image(page, "https://x.dk/r/") == "https://cdn.example.com/a.jpg"


def test_a_page_without_a_picture_or_with_an_unsafe_one_gives_none():
    assert sites.page_image("<html></html>", "https://x.dk/") == ""
    assert sites.page_image('<meta property="og:image" content="javascript:alert(1)">', "https://x.dk/") == ""
    assert sites.page_image('<meta property="og:image" content="data:image/png;base64,AAAA">', "https://x.dk/") == ""
