"""Diagnostics download: what a bug report needs, without recipe contents."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CARDS_JS, CONF_NOTIFY_SERVICE, CONF_SPEAKERS, DOMAIN, FRONTEND_URL
from .lovelace_resource import _collection, resource_mode


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    store = hass.data.get(DOMAIN)
    timers = hass.data.get(f"{DOMAIN}_timers")
    plan = hass.data.get(f"{DOMAIN}_plan")
    resources = _collection(hass)
    cards_path = f"{FRONTEND_URL}/{CARDS_JS}"
    registered = []
    if resources is not None and hasattr(resources, "async_items"):
        registered = [i.get("url") for i in resources.async_items() if str(i.get("url", "")).startswith(cards_path)]
    options = dict(entry.options)
    return {
        "language": hass.config.language,
        "assets_version": hass.data.get(f"{DOMAIN}_assets_version"),
        "recipes": len(store.list()) if store else None,
        "trash": len(store.trash()) if store else None,
        "cooking": store.cooking_state() if store else None,
        "timers": len(timers.timers) if timers else None,
        "plan_entries": len(plan._entries) if plan else None,  # noqa: SLF001
        "cards_resource": {"mode": resource_mode(hass), "registered_urls": registered},
        "options": {
            **{k: v for k, v in options.items() if k not in (CONF_NOTIFY_SERVICE, CONF_SPEAKERS)},
            "notify_service_set": bool(options.get(CONF_NOTIFY_SERVICE)),
            "speakers": len(options.get(CONF_SPEAKERS) or []),
        },
    }
