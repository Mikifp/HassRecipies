"""Button that stops the timer alarm, for dashboards."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import DEVICE_INFO, get_manager


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(
        [
            StopAlarmButton(get_manager(hass)),
            StepButton(hass.data[DOMAIN], 1, "Next step", "mdi:skip-next", "next_step"),
            StepButton(hass.data[DOMAIN], -1, "Previous step", "mdi:skip-previous", "previous_step"),
        ]
    )


class StopAlarmButton(ButtonEntity):
    _attr_name = "Stop timer alarm"
    _attr_icon = "mdi:bell-off"
    _attr_unique_id = f"{DOMAIN}_stop_timer_alarm"
    _attr_device_info = DEVICE_INFO

    def __init__(self, manager) -> None:
        self._manager = manager

    async def async_press(self) -> None:
        self._manager.stop_alarms()


class StepButton(ButtonEntity):
    """Move the cooking recipe on (or back) a page, for automations and dashboards."""

    def __init__(self, store, delta: int, name: str, icon: str, key: str) -> None:
        self._store = store
        self._delta = delta
        self._attr_name = name
        self._attr_icon = icon
        self._attr_unique_id = f"{DOMAIN}_{key}"
        self._attr_device_info = DEVICE_INFO

    async def async_press(self) -> None:
        self._store.set_cooking(delta=self._delta)
