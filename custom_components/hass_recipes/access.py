"""Who may change recipes: everyone (the default) or only administrators."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .const import CONF_EDIT_ACCESS, DOMAIN, EDIT_ADMINS


def edit_restricted(hass: HomeAssistant) -> bool:
    entry = hass.data.get(f"{DOMAIN}_entry")
    return bool(entry) and entry.options.get(CONF_EDIT_ACCESS) == EDIT_ADMINS


def can_edit(hass: HomeAssistant, user) -> bool:
    """True when ``user`` may create, change, import or delete recipes and plan meals."""
    if not edit_restricted(hass):
        return True
    return bool(user is not None and getattr(user, "is_admin", False))
