"""Kitchen timers kept on the server.

Unlike browser timers they are shared by every device, survive restarts and
still fire when no panel is open. Finishing fires ``hass_recipes_timer_finished``
and, if configured, calls a notify service.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
import logging
from typing import Any
import uuid

from homeassistant.components.media_player.browse_media import async_process_play_media_url
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.network import NoURLAvailableError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.helpers.storage import Store

from .const import (
    ALARM_PATH,
    CONF_NOTIFY_SERVICE,
    CONF_SPEAKER_SOUND,
    CONF_SPEAKERS,
    CONF_TTS_ENTITY,
    EVENT_TIMER_FINISHED,
    SIGNAL_TIMERS,
    SOUND_BOTH,
    SOUND_CHIME,
    SOUND_SPEECH,
    STORAGE_VERSION,
    TIMERS_STORAGE_KEY,
)

_LOGGER = logging.getLogger(__name__)


class TimerManager:
    def __init__(self, hass: HomeAssistant, get_options: Callable[[], Mapping[str, object]]) -> None:
        self._hass = hass
        self._get_options = get_options
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, TIMERS_STORAGE_KEY)
        self._timers: dict[str, dict[str, Any]] = {}
        self._unsubs: dict[str, CALLBACK_TYPE] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._timers = {t["id"]: t for t in (data or {}).get("timers", [])}
        now = datetime.now(UTC)
        for timer in list(self._timers.values()):
            if timer["done"]:
                continue
            ends = datetime.fromisoformat(timer["ends_at"])
            if ends <= now:
                self._finish(timer["id"])  # expired while Home Assistant was down
            else:
                self._schedule(timer["id"], ends)

    @callback
    def async_unload(self) -> None:
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"timers": list(self._timers.values())}, 1)

    def _changed(self) -> None:
        self._save()
        async_dispatcher_send(self._hass, SIGNAL_TIMERS)

    def snapshot(self) -> dict[str, Any]:
        """Client view; times are epoch ms and ``now_ms`` lets clients correct clock skew."""
        timers = [
            {
                "id": t["id"],
                "key": t["key"],
                "label": t["label"],
                "recipe_id": t.get("recipe_id"),
                "step": t.get("step"),
                "done": t["done"],
                "ends_at_ms": int(datetime.fromisoformat(t["ends_at"]).timestamp() * 1000),
            }
            for t in sorted(self._timers.values(), key=lambda t: t["ends_at"])
        ]
        return {"now_ms": int(datetime.now(UTC).timestamp() * 1000), "timers": timers}

    def _schedule(self, timer_id: str, ends: datetime) -> None:
        @callback
        def _fire(_now: datetime) -> None:
            self._unsubs.pop(timer_id, None)
            self._finish(timer_id)

        self._unsubs[timer_id] = async_track_point_in_utc_time(self._hass, _fire, ends)

    def start(
        self,
        key: str,
        label: str,
        seconds: int,
        recipe_id: str | None = None,
        recipe_name: str | None = None,
        step: int | None = None,
    ) -> dict[str, Any]:
        for existing in self._timers.values():
            if existing["key"] == key and not existing["done"]:
                return existing
        ends = datetime.now(UTC) + timedelta(seconds=seconds)
        timer = {
            "id": uuid.uuid4().hex,
            "key": key,
            "label": label,
            "recipe_id": recipe_id,
            "recipe_name": recipe_name,
            "step": step,
            "ends_at": ends.isoformat(),
            "done": False,
        }
        self._timers[timer["id"]] = timer
        self._schedule(timer["id"], ends)
        self._changed()
        return timer

    def dismiss(self, timer_id: str) -> bool:
        timer = self._timers.pop(timer_id, None)
        if timer is None:
            return False
        if unsub := self._unsubs.pop(timer_id, None):
            unsub()
        self._changed()
        return True

    @callback
    def _finish(self, timer_id: str) -> None:
        timer = self._timers.get(timer_id)
        if timer is None or timer["done"]:
            return
        timer["done"] = True
        self._hass.bus.async_fire(
            EVENT_TIMER_FINISHED,
            {
                "timer_id": timer["id"],
                "label": timer["label"],
                "recipe_id": timer.get("recipe_id"),
                "recipe_name": timer.get("recipe_name"),
                "step": timer.get("step"),
            },
        )
        options = self._get_options()
        if service := options.get(CONF_NOTIFY_SERVICE):
            self._hass.async_create_task(self._notify(str(service), timer))
        if options.get(CONF_SPEAKERS):
            self._hass.async_create_task(self.async_play_alarm(timer["label"]))
        self._changed()

    async def _notify(self, service: str, timer: dict[str, Any]) -> None:
        try:
            await self._hass.services.async_call(
                "notify",
                service,
                {"title": "Timer finished", "message": timer["label"]},
                blocking=True,
            )
        except HomeAssistantError as err:
            _LOGGER.warning("Could not send timer notification via notify.%s: %s", service, err)

    async def async_play_alarm(self, label: str, *, raise_errors: bool = False) -> None:
        """Play the chime and/or speak the label on the configured speakers."""
        options = self._get_options()
        speakers = list(options.get(CONF_SPEAKERS) or [])
        if not speakers:
            return
        mode = options.get(CONF_SPEAKER_SOUND) or SOUND_CHIME
        try:
            if mode in (SOUND_CHIME, SOUND_BOTH):
                url = async_process_play_media_url(self._hass, ALARM_PATH)
                await self._hass.services.async_call(
                    "media_player",
                    "play_media",
                    {"media_content_id": url, "media_content_type": "music"},
                    target={"entity_id": speakers},
                    blocking=True,
                )
            if mode == SOUND_BOTH:
                await asyncio.sleep(3.5)  # let the chime finish before speaking
            if mode in (SOUND_SPEECH, SOUND_BOTH):
                tts = options.get(CONF_TTS_ENTITY) or next(
                    iter(sorted(self._hass.states.async_entity_ids("tts"))), None
                )
                if not tts:
                    raise HomeAssistantError("No text-to-speech entity is available")
                text = "Timer finished. " + label.replace(" \u00b7 ", ", ")
                for speaker in speakers:
                    await self._hass.services.async_call(
                        "tts",
                        "speak",
                        {"media_player_entity_id": speaker, "message": text},
                        target={"entity_id": str(tts)},
                        blocking=True,
                    )
        except (HomeAssistantError, NoURLAvailableError) as err:
            _LOGGER.warning("Could not play the timer sound on %s: %s", speakers, err)
            if raise_errors:
                raise HomeAssistantError(
                    f"Could not play the timer sound: {err}. Speakers need a reachable "
                    "internal URL (Settings > System > Network)."
                ) from err
