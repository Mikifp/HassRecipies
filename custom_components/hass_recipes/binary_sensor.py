"""On while a kitchen timer has finished and not been dismissed."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_TIMERS
from .entity import DEVICE_INFO, get_manager


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([TimerAlarmSensor(get_manager(hass))])


class TimerAlarmSensor(BinarySensorEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_translation_key = "timer_alarm"
    _attr_icon = "mdi:bell-ring"
    _attr_unique_id = f"{DOMAIN}_timer_alarm"
    _attr_device_info = DEVICE_INFO

    def __init__(self, manager) -> None:
        self._manager = manager

    @property
    def is_on(self) -> bool:
        return self._manager.any_finished

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_TIMERS, self._update)
        )

    @callback
    def _update(self) -> None:
        self.async_write_ha_state()
