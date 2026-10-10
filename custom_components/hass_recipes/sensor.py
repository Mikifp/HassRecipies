"""One sensor per kitchen timer, so timers can sit on a dashboard.

The state is the moment the timer ends (a ``timestamp``), which Lovelace cards
render as a live countdown. The entity exists only while the timer does.
"""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, EVENT_COOKING_RECIPE_CHANGED, SIGNAL_TIMERS, TIMER_UNIQUE_PREFIX
from .entity import DEVICE_INFO, get_manager
from .store import RecipeStore, cooking_pages
from .timers import TimerManager


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    manager = get_manager(hass)
    registry = er.async_get(hass)
    async_add_entities([CookingSensor(hass.data[DOMAIN])])

    # drop entities of timers that no longer exist (e.g. left over after a crash)
    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if reg_entry.domain != "sensor" or not reg_entry.unique_id.startswith(TIMER_UNIQUE_PREFIX):
            continue
        if reg_entry.unique_id[len(TIMER_UNIQUE_PREFIX) :] not in manager.timers:
            registry.async_remove(reg_entry.entity_id)

    known: set[str] = set()

    @callback
    def _sync() -> None:
        known.intersection_update(manager.timers)
        new = [tid for tid in manager.timers if tid not in known]
        if new:
            known.update(new)
            async_add_entities([RecipeTimerSensor(manager, tid) for tid in new])

    _sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_TIMERS, _sync))


class RecipeTimerSensor(SensorEntity):
    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:timer-sand"
    _attr_device_info = DEVICE_INFO

    def __init__(self, manager: TimerManager, timer_id: str) -> None:
        self._manager = manager
        self._timer_id = timer_id
        self._attr_unique_id = f"{TIMER_UNIQUE_PREFIX}{timer_id}"
        self._attr_name = manager.timers[timer_id]["label"]

    @property
    def native_value(self) -> datetime | None:
        timer = self._manager.timers.get(self._timer_id)
        return datetime.fromisoformat(timer["ends_at"]) if timer else None

    @property
    def extra_state_attributes(self) -> dict:
        timer = self._manager.timers.get(self._timer_id) or {}
        return {
            "label": timer.get("label"),
            "finished": timer.get("done", False),
            "recipe_id": timer.get("recipe_id"),
            "recipe_name": timer.get("recipe_name"),
            "step": timer.get("step"),
            "timer_id": self._timer_id,
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_TIMERS, self._update))

    @callback
    def _update(self) -> None:
        if self._timer_id in self._manager.timers:
            self.async_write_ha_state()
        else:
            # dismissed: delete the entity from the registry too, not just the state
            registry = er.async_get(self.hass)
            if self.entity_id and registry.async_get(self.entity_id):
                registry.async_remove(self.entity_id)
            else:
                self.hass.async_create_task(self.async_remove())


class CookingSensor(SensorEntity):
    """The recipe being cooked: its name as the state, where you are as attributes."""

    _attr_should_poll = False
    _attr_name = "Cooking"
    _attr_icon = "mdi:chef-hat"
    _attr_unique_id = f"{DOMAIN}_cooking"
    _attr_device_info = DEVICE_INFO

    def __init__(self, store: RecipeStore) -> None:
        self._store = store

    @property
    def native_value(self) -> str | None:
        recipe = self._store.get(self._store.cooking_recipe_id or "")
        return recipe["name"] if recipe else None

    @property
    def extra_state_attributes(self) -> dict:
        recipe = self._store.get(self._store.cooking_recipe_id or "")
        if not recipe:
            return {"recipe_id": None}
        pages = cooking_pages(recipe)
        page = pages[min(self._store.cooking_step, len(pages) - 1)] if pages else {}
        steps = [p for p in pages if p["kind"] == "step"]
        number = None
        if page.get("kind") == "step":
            number = steps.index(page) + 1
        return {
            "recipe_id": recipe["id"],
            "page": self._store.cooking_step,
            "pages": len(pages),
            "on_ingredients": page.get("kind") == "ingredients",
            "step_number": number,
            "steps": len(steps),
            "step_text": page.get("text"),
            "step_timer_seconds": page.get("timer"),
            "step_timers": [t["seconds"] for t in page.get("timers", [])],
            "scale": self._store.cooking_scale,
        }

    async def async_added_to_hass(self) -> None:
        @callback
        def _changed(_event) -> None:
            self.async_write_ha_state()

        for event in (EVENT_COOKING_RECIPE_CHANGED, f"{DOMAIN}_recipe_updated", f"{DOMAIN}_recipe_deleted"):
            self.async_on_remove(self.hass.bus.async_listen(event, _changed))
