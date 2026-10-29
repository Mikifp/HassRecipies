"""Shared device for the timer entities."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN
from .timers import TimerManager

DEVICE_INFO = DeviceInfo(
    identifiers={(DOMAIN, "timers")},
    translation_key="timers",  # "Recipe timers" in translations/<language>.json
    entry_type=DeviceEntryType.SERVICE,
)


def get_manager(hass) -> TimerManager:
    return hass.data[f"{DOMAIN}_timers"]

TRACKER_DEVICE = DeviceInfo(
    identifiers={(DOMAIN, "tracker")},
    name="Calorie tracker",
    entry_type=DeviceEntryType.SERVICE,
)
