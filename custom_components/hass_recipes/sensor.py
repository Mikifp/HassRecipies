"""One sensor per kitchen timer, so timers can sit on a dashboard.

The state is the moment the timer ends (a ``timestamp``), which Lovelace cards
render as a live countdown. The entity exists only while the timer does.
"""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .const import DOMAIN, EVENT_COOKING_RECIPE_CHANGED, SIGNAL_TIMERS, TIMER_UNIQUE_PREFIX
from .entity import DEVICE_INFO, TRACKER_DEVICE, get_manager
from .store import RecipeStore, cooking_pages
from .tracker import Tracker
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

    # two sensors for every person in the calorie tracker (made as people are added)
    tracker: Tracker = hass.data[f"{DOMAIN}_tracker"]
    people: set[str] = set()

    @callback
    def _people() -> None:
        new = [p["id"] for p in tracker.persons() if p["id"] not in people]
        people.update(new)
        async_add_entities([TrackerSensor(tracker, pid, kind) for pid in new for kind in ("today", "remaining")])
        for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
            if reg_entry.unique_id.startswith("tracker_") and reg_entry.unique_id.split("_")[1] not in {p["id"] for p in tracker.persons()}:
                registry.async_remove(reg_entry.entity_id)

    _people()
    entry.async_on_unload(tracker.add_listener(_people))

    @callback
    def _midnight(_now) -> None:
        # a new day starts at zero: the sensors read the date again
        for sensor in list(TrackerSensor.live):
            sensor.async_write_ha_state()

    entry.async_on_unload(async_track_time_change(hass, _midnight, hour=0, minute=0, second=5))


class RecipeTimerSensor(SensorEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True
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
    _attr_has_entity_name = True
    _attr_translation_key = "cooking"
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


class TrackerSensor(SensorEntity):
    """Calories eaten today, or left of the day's goal, for one person of the calorie tracker."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_native_unit_of_measurement = "kcal"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:fire"
    _attr_device_info = TRACKER_DEVICE
    live: set["TrackerSensor"] = set()

    def __init__(self, tracker: Tracker, person_id: str, kind: str) -> None:
        self._tracker = tracker
        self._person_id = person_id
        self._kind = kind
        self._attr_unique_id = f"tracker_{person_id}_{kind}"

    @property
    def name(self) -> str:
        person = self._tracker._persons.get(self._person_id)
        who = person["name"] if person else ""
        return f"{who} calories {'today' if self._kind == 'today' else 'remaining'}".strip()

    def _totals(self) -> dict | None:
        if self._person_id not in self._tracker._persons:
            return None
        return self._tracker.today_totals(self._person_id, dt_util.now().date())

    @property
    def available(self) -> bool:
        return self._person_id in self._tracker._persons

    @property
    def native_value(self):
        totals = self._totals()
        if totals is None:
            return None
        return totals["kcal"] if self._kind == "today" else totals["remaining"]

    @property
    def extra_state_attributes(self):
        totals = self._totals()
        if totals is None:
            return {}
        return {"protein": totals["protein"], "carbs": totals["carbs"], "fat": totals["fat"], "goal": totals["goal"]}

    async def async_added_to_hass(self) -> None:
        TrackerSensor.live.add(self)
        self._stop = self._tracker.add_listener(self._update)

    async def async_will_remove_from_hass(self) -> None:
        TrackerSensor.live.discard(self)
        self._stop()

    @callback
    def _update(self) -> None:
        if self.hass is not None and self.entity_id:
            self.async_write_ha_state()
