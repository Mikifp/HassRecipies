"""Keep the dashboard cards registered as a Lovelace resource.

Home Assistant loads dashboard resources itself and waits for them before it builds a
dashboard, so the cards are there when a view renders. That is more dependable than
the extra module injected into the index page, which a page rendered early (or kept by
the app) can miss. Only dashboards in storage mode can be edited from here; with YAML
resources the line has to be added by hand.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

RESOURCE_TYPE = "module"


def _collection(hass: HomeAssistant) -> Any | None:
    """The Lovelace resource collection, across the shapes Home Assistant has used."""
    data = hass.data.get("lovelace")
    if data is None:
        return None
    if isinstance(data, dict):  # older versions kept a plain dict
        return data.get("resources")
    return getattr(data, "resources", None)


def _ours(item: dict[str, Any], path: str) -> bool:
    return str(item.get("url", "")).split("?", 1)[0] == path


async def _ensure_loaded(resources: Any) -> None:
    if hasattr(resources, "async_load") and not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True


async def async_ensure_resource(hass: HomeAssistant, path: str, version: str | int) -> bool:
    """Make sure exactly one resource points at ``path`` with the current ``?v=``.

    Returns False when it cannot be done (YAML resources, or Lovelace is not there yet).
    An entry added by hand for the same file is adopted rather than duplicated.
    """
    resources = _collection(hass)
    if resources is None or not hasattr(resources, "async_create_item"):
        return False
    url = f"{path}?v={version}"
    try:
        await _ensure_loaded(resources)
        mine = [i for i in resources.async_items() if _ours(i, path)]
        if not mine:
            await resources.async_create_item({"res_type": RESOURCE_TYPE, "url": url})
            return True
        first, extra = mine[0], mine[1:]
        if first.get("url") != url or first.get("type") != RESOURCE_TYPE:
            await resources.async_update_item(first["id"], {"res_type": RESOURCE_TYPE, "url": url})
        for item in extra:
            await resources.async_delete_item(item["id"])
        return True
    except Exception as err:  # noqa: BLE001 - never let this stop the integration loading
        _LOGGER.warning("Could not register the dashboard cards as a resource: %s", err)
        return False


async def async_remove_resource(hass: HomeAssistant, path: str) -> None:
    """Remove the resource (the integration was deleted)."""
    resources = _collection(hass)
    if resources is None or not hasattr(resources, "async_delete_item"):
        return
    try:
        await _ensure_loaded(resources)
        for item in [i for i in resources.async_items() if _ours(i, path)]:
            await resources.async_delete_item(item["id"])
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Could not remove the dashboard resource: %s", err)
