"""Search Danish recipe sites (Valdemarsro, Madens Verden, Louises madblog, DK-kogebogen, Arla).

The sites are searched by their sitemaps: every recipe's address ends in its name
("kylling-i-cremet-parmesan-og-hvidloegssauce"), and a search matches the words of that name. Nothing
but the sitemaps is read until a recipe is opened; then the page is imported like any pasted link.
A site without its recipes in the sitemaps (DK-kogebogen) is read from its category pages instead.
The lists are kept for a day, and each site's robots.txt is respected.

The idea, and the list of sites, come from the integration ha-middagsro (MIT license).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
import html
import logging
import re
import time
from typing import Any
from urllib.parse import urljoin, urlparse

_LOGGER = logging.getLogger(__name__)

CACHE_SECONDS = 24 * 3600
RETRY_SECONDS = 1800  # when a list could not be read
MAX_SITEMAPS = 40  # files of one site
MAX_LISTINGS = 150  # category pages of a site without its recipes in the sitemaps
LISTING_BATCH = 6
MAX_RESULTS = 30
MIN_WORD = 2

Fetch = Callable[[str, int], Awaitable[str]]


@dataclass(frozen=True, slots=True)
class Site:
    """A recipe site."""

    id: str
    name: str
    base: str
    # What a recipe's address looks like (others are articles, categories ...).
    recipe: str = r"^/[a-z0-9-]+/?$"
    # Sitemaps with these words are not recipes.
    skip_maps: tuple[str, ...] = ("page", "category", "tag", "author", "attachment", "media")
    # Category pages that list the recipes, for a site whose sitemaps do not have them.
    listing: str | None = None
    # Sitemaps to start from when robots.txt does not name them.
    maps: tuple[str, ...] = ("/sitemap.xml", "/sitemap_index.xml")


SITES: dict[str, Site] = {
    s.id: s
    for s in (
        Site("valdemarsro", "Valdemarsro", "https://www.valdemarsro.dk"),
        Site("madensverden", "Madens Verden", "https://madensverden.dk"),
        Site("louisesmadblog", "Louises madblog", "https://www.louisesmadblog.dk"),
        Site(
            "dkkogebogen",
            "DK-kogebogen",
            "https://www.dk-kogebogen.dk",
            recipe=r"^/opskrifter/\d+/[a-z0-9-]+/?$",
            listing=r"^/retter/[a-z0-9-]+/[a-z0-9-]+/?$",
            maps=("/sitemap/sitemap.xml",),
        ),
        Site(
            "arla",
            "Arla",
            "https://www.arla.dk",
            recipe=r"^/opskrifter/[a-z0-9-]+/?$",
            maps=("/sitemap.index.xml",),
        ),
    )
}

# Not recipes, whatever the address looks like.
_NOT_RECIPES = re.compile(r"madplan|indkoebsliste|guide|tips|konkurrence|nyhedsbrev|om-mig|kontakt|inspiration|boganbefaling")
# Link texts that are not a recipe's name.
_GENERIC = re.compile(r"(?i)^(se|læs) (mere|opskrift)|^opskrift(en)?$|^klik")
_DANISH = str.maketrans({"æ": "ae", "ø": "oe", "å": "aa", "é": "e", "ü": "u", "ö": "oe", "ä": "ae"})
_BACK = (("oe", "ø"), ("aa", "å"), ("ae", "æ"))
_LOC = re.compile(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>")
_LINK = re.compile(r"<a\b[^>]*?href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.DOTALL | re.IGNORECASE)


def ascii_words(text: str) -> list[str]:
    """Words as a site writes them in an address: æ is ae, ø oe, å aa."""
    return re.findall(r"[a-z0-9]+", text.lower().translate(_DANISH))


def title_from_slug(slug: str) -> str:
    """"kylling-i-hvidloegssauce" -> "Kylling i hvidløgssauce" (a fair guess at the title)."""
    words = []
    for part in slug.strip("/").split("-"):
        word = part
        for plain, danish in _BACK:
            word = word.replace(plain, danish)
        words.append(word)
    text = " ".join(w for w in words if w)
    return text[:1].upper() + text[1:]


def blocked(path: str, rule: str) -> bool:
    """Whether a robots.txt Disallow rule covers a path ("*" is anything, "$" the end)."""
    pattern = re.escape(rule).replace(r"\*", ".*")
    if pattern.endswith(r"\$"):
        pattern = pattern[:-2] + "$"
    return re.match(pattern, path) is not None


def parse_robots(text: str) -> tuple[list[str], list[str]]:
    """(sitemaps, disallowed paths for everyone) from a robots.txt."""
    maps: list[str] = []
    disallowed: list[str] = []
    applies = False
    for raw_line in text.splitlines():
        line = raw_line.split("#")[0].strip()
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "sitemap" and value:
            maps.append(value)
        elif key == "user-agent":
            applies = value == "*"
        elif key == "disallow" and applies and value:
            disallowed.append(value)
    return maps, disallowed


def clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def page_title(page: str) -> str:
    """A recipe page's title: its heading, else og:title or <title> without the site's name."""
    heading = re.search(r"<h1\b[^>]*>(.*?)</h1>", page, re.DOTALL | re.IGNORECASE)
    if heading and (text := clean_text(heading.group(1))):
        return text[:120]
    meta = re.search(r"<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']*)", page, re.IGNORECASE) or re.search(
        r"<title\b[^>]*>(.*?)</title>", page, re.DOTALL | re.IGNORECASE
    )
    if not meta:
        return ""
    return re.split(r"\s+[|–-]\s+", clean_text(meta.group(1)))[0][:120]


def page_image(page: str, base: str) -> str:
    """A recipe page's picture: its og:image (or twitter:image), as a full http(s) address."""
    for tag in re.findall(r"<meta\b[^>]*>", page[:200_000], re.IGNORECASE):
        if re.search(r"(?:property|name)=[\"'](?:og:image|twitter:image)(?::url)?[\"']", tag, re.IGNORECASE):
            content = re.search(r"content=[\"']([^\"']+)", tag, re.IGNORECASE)
            if content:
                url = urljoin(base, html.unescape(content.group(1)).strip())
                if urlparse(url).scheme in ("http", "https") and len(url) <= 500:
                    return url
    return ""


def site_of(url: str) -> Site | None:
    """The site an address is on."""
    host = (urlparse(url).hostname or "").removeprefix("www.")
    return next((s for s in SITES.values() if (urlparse(s.base).hostname or "").removeprefix("www.") == host), None)


@dataclass(slots=True)
class _Index:
    """A site's recipes: address -> (words of its name, title)."""

    recipes: dict[str, tuple[frozenset[str], str]] = field(default_factory=dict)
    loaded: float = 0.0
    failed: int = 0  # lists that could not be read

    def fresh(self, now: float) -> bool:
        keep = CACHE_SECONDS if self.recipes and not self.failed else RETRY_SECONDS
        return now - self.loaded < keep


def matches(words: frozenset[str], query: list[str]) -> bool:
    """Every word of the query starts a word of the name, or is inside one (a compound: "gryde" in "gryderet")."""
    return all(any(w.startswith(q) or q in w for w in words) for q in query)


class RecipeSites:
    """Search the sites, keeping each site's list of recipes for a day."""

    def __init__(self, fetch: Fetch, clock: Callable[[], float] = time.time) -> None:
        self._fetch = fetch
        self._clock = clock
        self._indexes: dict[str, _Index] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._titles: dict[str, str] = {}
        self._images: dict[str, str] = {}
        self._on_change: Callable[[], None] | None = None

    # ---- what is kept between restarts ----
    def to_data(self) -> dict[str, Any]:
        return {
            sid: {"loaded": ix.loaded, "recipes": [[u, t] for u, (_w, t) in ix.recipes.items()]}
            for sid, ix in self._indexes.items()
            if ix.recipes and not ix.failed
        }

    def load(self, data: dict[str, Any] | None) -> None:
        for sid, saved in (data or {}).items():
            if sid not in SITES or not isinstance(saved, dict):
                continue
            recipes = {}
            for url, title in saved.get("recipes", []):
                slug = [p for p in urlparse(url).path.split("/") if p][-1:] or [""]
                recipes[url] = (frozenset(ascii_words(slug[0]) + ascii_words(title)), title)
            self._indexes[sid] = _Index(recipes, float(saved.get("loaded", 0)), 0)

    def on_change(self, func: Callable[[], None]) -> None:
        self._on_change = func

    # ---- reading a site ----
    async def _get(self, url: str, limit: int) -> str:
        return await self._fetch(url, limit)

    async def _read(self, url: str, limit: int) -> str | None:
        try:
            return await self._get(url, limit)
        except Exception as err:  # a network or HTTP error: the list is read again later
            _LOGGER.debug("Could not read %s: %s", url, err)
            return None

    async def _index(self, site: Site) -> _Index:
        lock = self._locks.setdefault(site.id, asyncio.Lock())
        async with lock:
            index = self._indexes.get(site.id)
            if index and index.fresh(self._clock()):
                return index
            fresh = await self._read_site(site)
            if index is not None and len(index.recipes) > len(fresh.recipes) and fresh.failed:
                index.loaded, index.failed = self._clock(), fresh.failed  # keep what was read before; try again later
                return index
            self._indexes[site.id] = fresh
            if self._on_change and fresh.recipes and not fresh.failed:
                self._on_change()
            return fresh

    async def _read_site(self, site: Site) -> _Index:
        robots = await self._read(f"{site.base}/robots.txt", 200_000)
        maps, disallowed = parse_robots(robots or "")
        queue = [m for m in maps if site_of(m) is site] or [f"{site.base}{m}" for m in site.maps]
        seen: set[str] = set()
        failed = 0
        found: dict[str, tuple[frozenset[str], str]] = {}
        pattern = re.compile(site.recipe)
        listing = re.compile(site.listing) if site.listing else None
        listings: list[str] = []
        while queue and len(seen) < MAX_SITEMAPS:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            text = await self._read(url, 15_000_000)
            if text is None:
                failed += 1
                continue
            locs = [html.unescape(loc) for loc in _LOC.findall(text)]
            if "<sitemapindex" in text:
                queue += [loc for loc in locs if site_of(loc) is site and not any(w in loc.lower() for w in site.skip_maps)]
                continue
            for loc in locs:
                path = urlparse(loc).path
                if site_of(loc) is not site:
                    continue
                if listing and listing.match(path):
                    listings.append(loc)
                    continue
                if not pattern.match(path) or _NOT_RECIPES.search(path) or any(blocked(path, r) for r in disallowed):
                    continue
                slug = [p for p in path.split("/") if p][-1]
                found[loc] = (frozenset(ascii_words(slug)), title_from_slug(slug))
        if listing and listings:
            failed += await self._read_listings(site, listings, found, disallowed)
        if not found and failed == 0:
            failed = 1  # nothing found: try again sooner than in a day
        return _Index(found, self._clock(), failed)

    async def _read_listings(self, site: Site, queue: list[str], found: dict[str, tuple[frozenset[str], str]], disallowed: list[str]) -> int:
        """The recipes linked from a site's category pages. Returns how many pages could not be read."""
        pattern = re.compile(site.recipe)
        seen: set[str] = set()
        failed = 0
        while queue and len(seen) < MAX_LISTINGS:
            batch: list[str] = []
            while queue and len(batch) < LISTING_BATCH and len(seen) + len(batch) < MAX_LISTINGS:
                url = queue.pop(0).rstrip("/") + "/"
                if url not in seen and not any(blocked(urlparse(url).path, r) for r in disallowed):
                    seen.add(url)
                    batch.append(url)
            pages = await asyncio.gather(*(self._read(u, 2_000_000) for u in batch))
            for url, text in zip(batch, pages, strict=True):
                if text is None:
                    failed += 1
                    continue
                for href, label in _LINK.findall(text):
                    loc = urljoin(url, html.unescape(href)).split("#")[0]
                    path = urlparse(loc).path
                    if site_of(loc) is not site or not pattern.match(path) or any(blocked(path, r) for r in disallowed):
                        continue
                    title = clean_text(label)
                    if title and not _GENERIC.match(title) and loc not in found:
                        slug = [p for p in path.split("/") if p][-1]
                        found[loc] = (frozenset(ascii_words(slug)) | frozenset(ascii_words(title)), title[:120])
                        self._titles[loc] = title[:120]
        return failed

    # ---- searching ----
    async def search(self, site_ids: list[str], query: str, limit: int = MAX_RESULTS, titles: bool = True) -> list[dict[str, Any]]:
        """Recipes whose name has every word of the query, best first, a few from each site in turn."""
        words = [w for w in ascii_words(query) if len(w) >= MIN_WORD]
        sites = [SITES[s] for s in dict.fromkeys(site_ids) if s in SITES]
        if not words or not sites:
            return []
        indexes = await asyncio.gather(*(self._index(site) for site in sites))
        hits: list[tuple[int, int, int, dict[str, Any]]] = []
        for order, (site, index) in enumerate(zip(sites, indexes, strict=True)):
            for url, (name_words, title) in index.recipes.items():
                if matches(name_words, words):
                    # Exact words first, then short names (the dish itself, not a variant).
                    exact = sum(q in name_words for q in words)
                    hits.append((-exact, len(name_words), order, {"site": site.id, "site_name": site.name, "url": url, "title": title}))
        hits.sort(key=lambda h: h[:3])
        out: list[dict[str, Any]] = []
        taken: dict[str, int] = {}
        per_site = max(4, limit // max(1, len(sites)))
        rest: list[dict[str, Any]] = []
        for _, _, _, hit in hits:
            if len(out) >= limit:
                break
            if taken.get(hit["site"], 0) < per_site:
                out.append(hit)
                taken[hit["site"]] = taken.get(hit["site"], 0) + 1
            else:
                rest.append(hit)
        out += rest[: limit - len(out)]  # when some sites have little to give, the others fill the list
        if titles:
            await self._real_titles(out)
        return out

    async def _real_titles(self, hits: list[dict[str, Any]]) -> None:
        """The real titles of the hits (an address leaves out æ, ø and å on some sites), and their pictures."""
        semaphore = asyncio.Semaphore(8)

        async def read(url: str) -> None:
            async with semaphore:
                page = await self._read(url, 300_000)
                if page:
                    if found := page_title(page):
                        self._titles[url] = found
                    self._images[url] = page_image(page, url)

        missing = {hit["url"] for hit in hits if hit["url"] not in self._titles or hit["url"] not in self._images}
        if missing:
            try:
                await asyncio.wait_for(asyncio.gather(*(read(u) for u in missing)), timeout=12)
            except TimeoutError:
                pass
        for hit in hits:
            hit["title"] = self._titles.get(hit["url"], hit["title"])
            hit["image"] = self._images.get(hit["url"], "")

    def status(self) -> dict[str, Any]:
        """How many recipes each site's list has (0 until it has been read)."""
        return {sid: len(ix.recipes) for sid, ix in self._indexes.items()}
