"""Searching the recipe sites by their sitemaps (the network is a stand-in)."""

import asyncio
import importlib.util
from pathlib import Path
import sys

_spec = importlib.util.spec_from_file_location("hr_sites", Path(__file__).parents[1] / "custom_components/hass_recipes/recipe_sites.py")
rs = importlib.util.module_from_spec(_spec)
sys.modules["hr_sites"] = rs
_spec.loader.exec_module(rs)


def _sitemap(*urls):
    return "<urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>"


def _index(*urls):
    return "<sitemapindex>" + "".join(f"<sitemap><loc>{u}</loc></sitemap>" for u in urls) + "</sitemapindex>"


class Net:
    """Pages by address; an address not there is an error. Keeps what was asked for."""

    def __init__(self, pages):
        self.pages = pages
        self.asked = []

    async def __call__(self, url, limit):
        self.asked.append(url)
        if url not in self.pages:
            raise OSError("HTTP 404")
        return self.pages[url][:limit]


VALDE = "https://www.valdemarsro.dk"
ARLA = "https://www.arla.dk"
DK = "https://www.dk-kogebogen.dk"


def _net():
    return Net(
        {
            f"{VALDE}/robots.txt": f"User-agent: *\nDisallow: /wp-admin/\nDisallow: /hemmelig-*\nSitemap: {VALDE}/sitemap_index.xml\n",
            f"{VALDE}/sitemap_index.xml": _index(f"{VALDE}/post-sitemap.xml", f"{VALDE}/page-sitemap.xml", "https://other.example/post-sitemap.xml"),
            f"{VALDE}/post-sitemap.xml": _sitemap(
                f"{VALDE}/risengroed/",
                f"{VALDE}/risengroedsvafler/",
                f"{VALDE}/boller-i-fad/",
                f"{VALDE}/hemmelig-risengroed/",
                f"{VALDE}/madplan-uge-43/",
                f"{VALDE}/linda-castillo-boganbefaling/",
                "https://other.example/risengroed/",
            ),
            f"{VALDE}/page-sitemap.xml": _sitemap(f"{VALDE}/risengroed-side/"),
            f"{ARLA}/robots.txt": f"Sitemap: {ARLA}/sitemap.index.xml\n",
            f"{ARLA}/sitemap.index.xml": _index(f"{ARLA}/sitemap.xml?type=Recipes"),
            f"{ARLA}/sitemap.xml?type=Recipes": _sitemap(f"{ARLA}/opskrifter/risengroed-med-kanel/", f"{ARLA}/opskrifter/pizza-margherita/", f"{ARLA}/produkter/risengroed/"),
            f"{DK}/robots.txt": "User-agent: *\nDisallow: /udskrift/*\n",
            f"{DK}/sitemap/sitemap.xml": _sitemap(f"{DK}/retter/hovedretter/", f"{DK}/retter/hovedretter/fisk/", f"{DK}/retter/dessert/risretter/"),
            f"{DK}/retter/hovedretter/fisk/": '<a href="/opskrifter/201/torsk-i-filodej">Torsk i filodej</a> <a href="/opskrifter/202/fisk-i-fad">Fisk i fad med æbler</a> <a href="/opskrifter/202/fisk-i-fad">Læs mere</a> <a href="/om-os">Om os</a>',
            f"{DK}/retter/dessert/risretter/": '<a href="/opskrifter/301/risengroed">Risengrød</a> <a href="/opskrifter/302/vegansk-risengroed">Vegansk <b>risengrød</b></a>',
        }
    )


def _run(coro):
    return asyncio.run(coro)


def test_words_and_titles_follow_how_a_site_writes_its_addresses():
    assert rs.ascii_words("Risengrød med æbler") == ["risengroed", "med", "aebler"]
    assert rs.title_from_slug("kylling-i-hvidloegssauce/") == "Kylling i hvidløgssauce"
    assert rs.title_from_slug("gryderet-med-kaal") == "Gryderet med kål"


def test_robots_txt_gives_the_sitemaps_and_the_rules_for_everyone():
    maps, rules = rs.parse_robots("User-agent: Bad\nDisallow: /\nUser-agent: *\nDisallow: /wp-admin/ # x\nDisallow: /udskrift/*\nSitemap: https://a.dk/s.xml\n")
    assert maps == ["https://a.dk/s.xml"] and rules == ["/wp-admin/", "/udskrift/*"]
    assert rs.blocked("/wp-admin/x", "/wp-admin/") and rs.blocked("/udskrift/1/x", "/udskrift/*") and not rs.blocked("/opskrifter/1", "/udskrift/*")
    assert rs.blocked("/a.pdf", "/*.pdf$") and not rs.blocked("/a.pdf?x", "/*.pdf$")


def test_a_search_matches_recipe_names_not_other_pages_or_other_sites():
    sites = rs.RecipeSites(_net())
    hits = _run(sites.search(["valdemarsro"], "risengrød", titles=False))
    assert [h["title"] for h in hits] == ["Risengrød", "Risengrødsvafler"]  # no page, madplan, book review, blocked or foreign address
    assert hits[0]["url"] == f"{VALDE}/risengroed/" and hits[0]["site_name"] == "Valdemarsro"
    assert _run(sites.search(["valdemarsro"], "boller", titles=False))[0]["title"] == "Boller i fad"
    assert _run(sites.search(["valdemarsro"], "x", titles=False)) == [] and _run(sites.search([], "boller")) == []
    assert _run(sites.search(["nope"], "boller")) == []


def test_every_word_must_match_and_a_compound_matches_a_part():
    sites = rs.RecipeSites(_net())
    assert [h["title"] for h in _run(sites.search(["arla"], "pizza margherita", titles=False))] == ["Pizza margherita"]
    assert _run(sites.search(["arla"], "pizza kylling", titles=False)) == []
    assert [h["title"] for h in _run(sites.search(["valdemarsro"], "vafler", titles=False))] == ["Risengrødsvafler"]


def test_a_site_without_recipes_in_its_sitemaps_is_read_from_its_category_pages():
    net = _net()
    sites = rs.RecipeSites(net)
    hits = _run(sites.search(["dkkogebogen"], "risengrød", titles=False))
    assert [h["title"] for h in hits] == ["Risengrød", "Vegansk risengrød"]
    found = _run(sites.search(["dkkogebogen"], "fisk", titles=False))
    assert [h["title"] for h in found] == ["Fisk i fad med æbler"]  # once, the "read more" link is not a name
    assert f"{DK}/retter/hovedretter/" not in net.asked  # only the subcategories are read, not the main categories


def test_the_lists_are_kept_for_a_day_and_read_again_after_it():
    net = _net()
    now = [1000.0]
    sites = rs.RecipeSites(net, lambda: now[0])
    _run(sites.search(["arla"], "pizza", titles=False))
    first = len(net.asked)
    _run(sites.search(["arla"], "pizza", titles=False))
    assert len(net.asked) == first  # nothing read again
    now[0] += 24 * 3600 + 1
    _run(sites.search(["arla"], "pizza", titles=False))
    assert len(net.asked) > first


def test_a_site_that_cannot_be_read_does_not_break_the_search_and_is_tried_again_soon():
    net = Net({})
    now = [0.0]
    sites = rs.RecipeSites(net, lambda: now[0])
    assert _run(sites.search(["arla", "valdemarsro"], "pizza", titles=False)) == []
    asked = len(net.asked)
    now[0] += 600
    _run(sites.search(["arla"], "pizza", titles=False))
    assert len(net.asked) == asked  # not yet
    now[0] += 1300
    net.pages.update(_net().pages)
    assert [h["title"] for h in _run(sites.search(["arla"], "margherita", titles=False))] == ["Pizza margherita"]


def test_results_come_from_each_site_in_turn_best_match_first():
    net = _net()
    net.pages[f"{ARLA}/sitemap.xml?type=Recipes"] = _sitemap(*[f"{ARLA}/opskrifter/pizza-nr-{n}/" for n in range(30)] + [f"{ARLA}/opskrifter/pizza/"])
    net.pages[f"{VALDE}/post-sitemap.xml"] = _sitemap(f"{VALDE}/pizza-med-skinke/", f"{VALDE}/pizza/")
    sites = rs.RecipeSites(net)
    hits = _run(sites.search(["arla", "valdemarsro"], "pizza", limit=8, titles=False))
    assert [h["title"] for h in hits][:2] == ["Pizza", "Pizza"]  # the dish itself first
    assert {h["site"] for h in hits} == {"arla", "valdemarsro"} and len(hits) == 8
    assert sum(h["site"] == "valdemarsro" for h in hits) == 2 and sum(h["site"] == "arla" for h in hits) == 6  # the small site gives all it has, the big one fills the rest
    four = _run(sites.search(["arla", "valdemarsro"], "pizza", limit=20, titles=False))
    assert len(four) == 20 and sum(h["site"] == "valdemarsro" for h in four) == 2


def test_real_titles_are_read_from_the_pages_of_the_hits():
    net = _net()
    net.pages[f"{VALDE}/risengroed/"] = '<html><head><title>Risengrød | Valdemarsro</title></head><body><h1>Risengrød, den bedste</h1></body></html>'
    sites = rs.RecipeSites(net)
    hits = _run(sites.search(["valdemarsro"], "risengrød"))
    assert hits[0]["title"] == "Risengrød, den bedste" and hits[1]["title"] == "Risengrødsvafler"  # no page, the guess stands
    assert rs.page_title("<head><meta property='og:title' content='Boller – Arla'></head>") == "Boller"


def test_what_was_read_is_kept_and_used_after_a_restart():
    net = _net()
    first = rs.RecipeSites(net)
    _run(first.search(["valdemarsro", "dkkogebogen"], "risengrød", titles=False))
    data = first.to_data()
    again = rs.RecipeSites(Net({}), lambda: 10.0)  # no network at all
    again.load({**data, "nope": {"recipes": []}, "arla": "bad"})
    assert [h["title"] for h in _run(again.search(["dkkogebogen"], "vegansk", titles=False))] == ["Vegansk risengrød"]
    assert again.status() == {"valdemarsro": 2 + 1, "dkkogebogen": 3} or set(again.status()) == {"valdemarsro", "dkkogebogen"}


def test_the_sites_are_known_by_address():
    assert rs.site_of("https://www.arla.dk/opskrifter/x/").id == "arla"
    assert rs.site_of("https://valdemarsro.dk/x/").id == "valdemarsro"  # with or without www
    assert rs.site_of("https://example.com/x") is None
