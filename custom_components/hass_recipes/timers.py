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
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.network import NoURLAvailableError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_point_in_utc_time, async_track_state_change_event
from homeassistant.helpers.storage import Store

from .alarm_sound import CHIME_SECONDS, LONG_SECONDS
from .localize import words
from .const import (
    ALARM_LONG_PATH,
    ALARM_PATH,
    CONF_ALARM_MINUTES,
    CONF_ALARM_REPEAT,
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

_PLAYING = ("playing", "buffering")
# A speaker that stops with more than this left of the clip was stopped by a person
_EARLY_STOP_SECONDS = 1.5
# Ignore speaker state changes while we start something ourselves, and this long after the call returns
# (the speaker moves through buffering / idle on its way to playing). Keep it well under the length of
# the chime, or a stop during the chime is never noticed.
_CALL_GRACE_SECONDS = 4.0
_START_GRACE_SECONDS = 1.2
# The bundled chime (sounds/alarm.wav) lasts this long
_CHIME_SECONDS = CHIME_SECONDS


class TimerManager:
    def __init__(self, hass: HomeAssistant, get_options: Callable[[], Mapping[str, object]]) -> None:
        self._hass = hass
        self._get_options = get_options
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, TIMERS_STORAGE_KEY)
        self._timers: dict[str, dict[str, Any]] = {}
        self._unsubs: dict[str, CALLBACK_TYPE] = {}
        self._alarms: dict[str, asyncio.Task] = {}  # timer id -> repeating alarm
        self._grace_until = 0.0  # loop time before which speaker changes are our own doing
        self._clip_end: float | None = None  # loop time the chime ends, for speakers that do not report their position

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self._timers = {t["id"]: t for t in (data or {}).get("timers", [])}
        now = datetime.now(UTC)
        for timer in list(self._timers.values()):
            if timer["done"]:
                continue
            ends = datetime.fromisoformat(timer["ends_at"])
            if ends <= now:
                # expired while Home Assistant was down: announce it, but never
                # blast a stale alarm out of the speakers
                self._finish(timer["id"], stale=True)
            else:
                self._schedule(timer["id"], ends)

    @property
    def timers(self) -> Mapping[str, dict[str, Any]]:
        """Live timers by id; read-only for entities."""
        return self._timers

    @property
    def any_finished(self) -> bool:
        """True while a timer has finished and has not been dismissed."""
        return any(t["done"] for t in self._timers.values())

    @callback
    def async_unload(self) -> None:
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()
        for task in self._alarms.values():
            task.cancel()
        self._alarms.clear()

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
                "total_ms": int(t["seconds"] * 1000) if t.get("seconds") else None,
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
            "seconds": seconds,
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
        if (alarm := self._alarms.pop(timer_id, None)) is not None:
            alarm.cancel()  # stop repeating, and cut off whatever is playing now
            self._hass.async_create_task(self._stop_speakers())
        self._changed()
        return True

    @callback
    def stop_alarms(self) -> int:
        """Dismiss every finished timer, which also silences their alarms."""
        finished = [t["id"] for t in self._timers.values() if t["done"]]
        for timer_id in finished:
            self.dismiss(timer_id)
        return len(finished)

    @callback
    def snooze(self, seconds: int = 120, timer_id: str | None = None) -> int:
        """Give finished timers more time: silence them and count down again."""
        targets = [
            t["id"]
            for t in self._timers.values()
            if t["done"] and (timer_id is None or t["id"] == timer_id)
        ]
        for tid in targets:
            timer = self._timers[tid]
            ends = datetime.now(UTC) + timedelta(seconds=seconds)
            timer.update({"done": False, "ends_at": ends.isoformat(), "seconds": seconds})
            if (alarm := self._alarms.pop(tid, None)) is not None:
                alarm.cancel()
            if unsub := self._unsubs.pop(tid, None):
                unsub()
            self._schedule(tid, ends)
        if targets:
            if not any(t["done"] for t in self._timers.values()):
                self._hass.async_create_task(self._stop_speakers())
            self._changed()
        return len(targets)

    @callback
    def _finish(self, timer_id: str, stale: bool = False) -> None:
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
        if options.get(CONF_SPEAKERS) and not stale:
            self._alarms[timer_id] = self._hass.async_create_task(
                self._alarm_loop(timer_id, timer["label"])
            )
        self._changed()

    async def _notify(self, service: str, timer: dict[str, Any]) -> None:
        try:
            await self._hass.services.async_call(
                "notify",
                service,
                {
                    "title": words(self._hass.config.language)["timer_finished"],
                    "message": timer["label"],
                },
                blocking=True,
            )
        except HomeAssistantError as err:
            _LOGGER.warning("Could not send timer notification via notify.%s: %s", service, err)

    async def _alarm_loop(self, timer_id: str, label: str) -> None:
        """Sound the alarm, then keep repeating until dismissed or the time limit."""
        options = self._get_options()
        repeat = options.get(CONF_ALARM_REPEAT, True)
        limit = float(options.get(CONF_ALARM_MINUTES) or 5) * 60
        pause = {SOUND_CHIME: 3.0, SOUND_SPEECH: 8.0, SOUND_BOTH: 6.0}.get(
            options.get(CONF_SPEAKER_SOUND) or SOUND_CHIME, 5.0
        )
        # a chime on its own is played as the long alarm, which has to finish before it is played again
        clip = LONG_SECONDS if (options.get(CONF_SPEAKER_SOUND) or SOUND_CHIME) == SOUND_CHIME else 0.0
        started = self._hass.loop.time()
        unwatch = self._watch_speakers()
        try:
            while True:
                if not await self.async_play_alarm(label):
                    return  # misconfigured: do not hammer a broken speaker
                if not repeat:
                    return
                await asyncio.sleep(clip + pause)
                if timer_id not in self._timers or self._hass.loop.time() - started > limit:
                    return
        except asyncio.CancelledError:
            raise
        finally:
            unwatch()
            self._alarms.pop(timer_id, None)

    def _watch_speakers(self) -> CALLBACK_TYPE:
        """Silence the alarms when someone taps the speaker or says "stop" to it.

        Either makes the speaker stop or pause while our clip still has time left,
        which is told apart from the clip simply ending.
        """
        speakers = list(self._get_options().get(CONF_SPEAKERS) or [])
        if not speakers:
            return lambda: None

        @callback
        def _changed(event: Event) -> None:
            old: State | None = event.data.get("old_state")
            new: State | None = event.data.get("new_state")
            if old is None or new is None or old.state not in _PLAYING or new.state in _PLAYING:
                return
            if self._hass.loop.time() < self._grace_until:
                return
            remaining = _seconds_left(old)
            if remaining is None and self._clip_end is not None:
                remaining = self._clip_end - self._hass.loop.time()  # the speaker does not say: go by our own clock
            if remaining is not None and remaining > _EARLY_STOP_SECONDS:
                _LOGGER.debug("%s was stopped by hand; silencing timer alarms", new.entity_id)
                self.stop_alarms()

        return async_track_state_change_event(self._hass, speakers, _changed)

    async def _stop_speakers(self) -> None:
        speakers = list(self._get_options().get(CONF_SPEAKERS) or [])
        if not speakers:
            return
        try:
            await self._hass.services.async_call(
                "media_player", "media_stop", {}, target={"entity_id": speakers}
            )
        except HomeAssistantError:
            pass  # not every player supports stop; the alarm has stopped repeating anyway

    async def async_play_alarm(self, label: str, *, raise_errors: bool = False) -> bool:
        """Play the chime and/or speak the label once. Returns False if it failed."""
        options = self._get_options()
        speakers = list(options.get(CONF_SPEAKERS) or [])
        if not speakers:
            return False
        mode = options.get(CONF_SPEAKER_SOUND) or SOUND_CHIME
        self._grace_until = self._hass.loop.time() + _CALL_GRACE_SECONDS
        self._clip_end = None
        try:
            if mode in (SOUND_CHIME, SOUND_BOTH):
                long = mode == SOUND_CHIME  # with speech after it, the short chime keeps the wait short
                url = async_process_play_media_url(self._hass, ALARM_LONG_PATH if long else ALARM_PATH)
                await self._hass.services.async_call(
                    "media_player",
                    "play_media",
                    {"media_content_id": url, "media_content_type": "music"},
                    target={"entity_id": speakers},
                    blocking=True,
                )
                now = self._hass.loop.time()
                self._grace_until = now + _START_GRACE_SECONDS
                self._clip_end = now + (LONG_SECONDS if long else _CHIME_SECONDS)
            if mode == SOUND_BOTH:
                await asyncio.sleep(3.5)  # let the chime finish before speaking
                self._grace_until = self._hass.loop.time() + _CALL_GRACE_SECONDS
                self._clip_end = None
            if mode in (SOUND_SPEECH, SOUND_BOTH):
                tts = options.get(CONF_TTS_ENTITY) or next(
                    iter(sorted(self._hass.states.async_entity_ids("tts"))), None
                )
                if not tts:
                    raise HomeAssistantError("No text-to-speech entity is available")
                text = f"{words(self._hass.config.language)['timer_finished']}. " + label.replace(" \u00b7 ", ", ")
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
            return False
        if mode in (SOUND_SPEECH, SOUND_BOTH):
            self._clip_end = None  # how long the speech lasts is not known
            self._grace_until = self._hass.loop.time() + _START_GRACE_SECONDS
        return True


def _seconds_left(state: State) -> float | None:
    """How much of the playing clip remained at ``state``, if the player says."""
    attrs = state.attributes
    duration = attrs.get("media_duration")
    position = attrs.get("media_position")
    if duration is None or position is None:
        return None
    try:
        elapsed = float(position)
        if (updated := attrs.get("media_position_updated_at")) is not None:
            elapsed += max(0.0, (datetime.now(UTC) - updated).total_seconds())
        return float(duration) - elapsed
    except (TypeError, ValueError):
        return None
