"""The web session for reading recipe pages and sitemaps.

Some sites (Arla) send headers longer than the 8 KB the shared session accepts, so reading recipes uses a
session of its own with a higher limit.
"""

from __future__ import annotations

from aiohttp import ClientSession
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_create_clientsession

from .const import DOMAIN

_KEY = f"{DOMAIN}_page_session"


def page_session(hass: HomeAssistant) -> ClientSession:
    session = hass.data.get(_KEY)
    if session is None:
        session = hass.data[_KEY] = async_create_clientsession(hass, max_field_size=65536, max_line_size=65536)
    return session
