"""The meal plan as a Home Assistant calendar.

Each planned meal is an event at a fixed time for its slot, so it shows up in the
calendar dashboard and can trigger automations ("when dinner starts").
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, EVENT_MEAL_PLAN_CHANGED
from .entity import DEVICE_INFO
from .localize import slot_name
from .mealplan import MealPlan

# slot -> (start, length in minutes)
SLOT_TIMES: dict[str, tuple[time, int]] = {
    "breakfast": (time(7, 30), 45),
    "lunch": (time(12, 0), 60),
    "snack": (time(15, 0), 30),
    "dinner": (time(18, 0), 60),
}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([MealPlanCalendar(hass.data[f"{DOMAIN}_plan"])])


def _event(entry: dict, language: str | None = None) -> CalendarEvent:
    start_time, minutes = SLOT_TIMES[entry["slot"]]
    start = dt_util.as_local(datetime.combine(date.fromisoformat(entry["date"]), start_time, dt_util.get_default_time_zone()))
    summary = entry["title"]
    return CalendarEvent(
        start=start,
        end=start + timedelta(minutes=minutes),
        summary=summary,
        description=" · ".join(
            part for part in (slot_name(language, entry["slot"]), entry.get("note") or "") if part
        ),
        uid=entry["id"],
    )


class MealPlanCalendar(CalendarEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_translation_key = "meal_plan"
    _attr_icon = "mdi:silverware-fork-knife"
    _attr_unique_id = f"{DOMAIN}_meal_plan"
    _attr_device_info = DEVICE_INFO

    def __init__(self, plan: MealPlan) -> None:
        self._plan = plan

    @property
    def event(self) -> CalendarEvent | None:
        """The meal in progress, or the next one."""
        now = dt_util.now()
        today = now.date()
        for entry in self._plan.list(today, today + timedelta(days=60)):
            event = _event(entry, self.hass.config.language)
            if event.end > now:
                return event
        return None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        first = dt_util.as_local(start_date).date() - timedelta(days=1)
        last = dt_util.as_local(end_date).date()
        events = [_event(e, hass.config.language) for e in self._plan.list(first, last)]
        return [e for e in events if e.end > start_date and e.start < end_date]

    async def async_added_to_hass(self) -> None:
        @callback
        def _changed(_event) -> None:
            self.async_write_ha_state()

        self.async_on_remove(self.hass.bus.async_listen(EVENT_MEAL_PLAN_CHANGED, _changed))
