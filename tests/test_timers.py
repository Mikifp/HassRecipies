"""Tests for the repeating speaker alarm in TimerManager, using a fake Home Assistant."""

import asyncio
import importlib
from pathlib import Path
import sys
import types


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


class HomeAssistantError(Exception):
    pass


class _Store:
    def __init__(self, *a, **k):
        pass

    async def async_load(self):
        return None

    def async_delay_save(self, *a, **k):
        pass


for pkg in ("homeassistant", "homeassistant.components", "homeassistant.components.media_player", "homeassistant.helpers"):
    _stub(pkg)
_stub("homeassistant.components.media_player.browse_media", async_process_play_media_url=lambda hass, url: "http://ha.local" + url)
_stub("homeassistant.core", CALLBACK_TYPE=object, HomeAssistant=object, Event=object, State=object, callback=lambda f: f)
_stub("homeassistant.exceptions", HomeAssistantError=HomeAssistantError)
_stub("homeassistant.helpers.dispatcher", async_dispatcher_send=lambda *a, **k: None)
def _track_state(hass, entity_ids, cb):
    hass.listeners.append(cb)
    return lambda: hass.listeners.remove(cb)


_stub(
    "homeassistant.helpers.event",
    async_track_point_in_utc_time=lambda hass, cb, when: (lambda: None),
    async_track_state_change_event=_track_state,
)
_stub("homeassistant.helpers.storage", Store=_Store)
_stub("homeassistant.helpers.network", NoURLAvailableError=type("NoURLAvailableError", (Exception,), {}))

pkg = types.ModuleType("hr_t")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_t"] = pkg
timers = importlib.import_module("hr_t.timers")

_real_sleep = asyncio.sleep


class FakeServices:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    async def async_call(self, domain, service, data=None, target=None, blocking=False, **kw):
        self.calls.append((domain, service, data, target))
        if self.fail and domain == "media_player" and service == "play_media":
            raise HomeAssistantError("speaker offline")


class FakeHass:
    def __init__(self, fail=False):
        loop = asyncio.get_event_loop()
        self.loop = loop
        self.services = FakeServices(fail)
        self.bus = types.SimpleNamespace(async_fire=lambda *a, **k: None)
        self.states = types.SimpleNamespace(async_entity_ids=lambda d: ["tts.cloud"])
        self.listeners = []

    def async_create_task(self, coro):
        return asyncio.ensure_future(coro)


def _run(options, scenario, fail=False):
    async def main():
        async def fast(delay, *a, **k):
            await _real_sleep(0.01)

        asyncio.sleep = fast  # make the 5 s pauses 10 ms
        try:
            hass = FakeHass(fail)
            mgr = timers.TimerManager(hass, lambda: options)
            timer = mgr.start("k", "Pancakes · step 2", 60, recipe_id="r", step=1)
            await scenario(hass, mgr, timer)
            return hass
        finally:
            asyncio.sleep = _real_sleep

    return asyncio.run(main())


def _plays(hass):
    return [c for c in hass.services.calls if c[:2] == ("media_player", "play_media")]


BASE = {"speakers": ["media_player.kitchen"], "speaker_sound": "chime", "alarm_repeat": True, "alarm_minutes": 5}


def test_repeats_until_dismissed_and_then_stops():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.15)
        state["while_ringing"] = len(_plays(hass))
        mgr.dismiss(timer["id"])
        await _real_sleep(0.05)
        state["at_dismiss"] = len(_plays(hass))
        await _real_sleep(0.15)
        state["after"] = len(_plays(hass))
        state["stopped"] = [c for c in hass.services.calls if c[:2] == ("media_player", "media_stop")]
        state["alarms_left"] = len(mgr._alarms)

    _run(BASE, scenario)
    assert state["while_ringing"] >= 3, state
    assert state["after"] == state["at_dismiss"], state  # nothing plays after dismiss
    assert state["stopped"] and state["alarms_left"] == 0


def test_no_repeat_plays_once():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.15)
        state["n"] = len(_plays(hass))

    _run({**BASE, "alarm_repeat": False}, scenario)
    assert state["n"] == 1


def test_safety_limit_ends_the_alarm():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.4)
        state["n1"] = len(_plays(hass))
        await _real_sleep(0.2)
        state["n2"] = len(_plays(hass))

    _run({**BASE, "alarm_minutes": 0.0005}, scenario)  # 30 ms
    assert 1 <= state["n1"] < 20 and state["n1"] == state["n2"], state


def test_stale_timer_is_silent_and_failure_does_not_loop():
    state = {}

    async def stale(hass, mgr, timer):
        mgr._finish(timer["id"], stale=True)
        await _real_sleep(0.1)
        state["stale"] = len(_plays(hass))

    _run(BASE, stale)
    assert state["stale"] == 0

    async def broken(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.2)
        state["broken"] = len(_plays(hass))

    _run(BASE, broken, fail=True)
    assert state["broken"] == 1  # one attempt, then give up instead of retrying forever


def test_speech_and_stop_alarms_service():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.1)
        state["speak"] = [c for c in hass.services.calls if c[:2] == ("tts", "speak")]
        state["dismissed"] = mgr.stop_alarms()
        state["left"] = len(mgr._timers)

    _run({**BASE, "speaker_sound": "speech"}, scenario)
    assert state["speak"], state
    assert "Pancakes, step 2" in state["speak"][0][2]["message"]
    assert state["speak"][0][3] == {"entity_id": "tts.cloud"}
    assert state["dismissed"] == 1 and state["left"] == 0


def _speaker_event(old, new, position=0.0, duration=3.2):
    from datetime import UTC, datetime

    attrs = {"media_position": position, "media_duration": duration, "media_position_updated_at": datetime.now(UTC)}
    mk = lambda state, a: types.SimpleNamespace(state=state, attributes=a, entity_id="media_player.kitchen")
    return types.SimpleNamespace(data={"old_state": mk(old, attrs), "new_state": mk(new, {})})


def _stop_scenario(old, new, **kw):
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.05)
        mgr._grace_until = 0.0  # as if the clip has been playing for a while
        for cb in list(hass.listeners):
            cb(_speaker_event(old, new, **kw))
        await _real_sleep(0.05)
        state["timers"] = len(mgr._timers)
        state["alarms"] = len(mgr._alarms)
        state["listeners"] = len(hass.listeners)

    _run(BASE, scenario)
    return state


def test_tapping_the_speaker_silences_the_alarm():
    state = _stop_scenario("playing", "paused", position=0.5)
    assert state == {"timers": 0, "alarms": 0, "listeners": 0}


def test_saying_stop_silences_the_alarm():
    state = _stop_scenario("playing", "idle", position=0.8)
    assert state["timers"] == 0 and state["alarms"] == 0


def test_clip_ending_naturally_keeps_the_alarm():
    state = _stop_scenario("playing", "idle", position=3.0)
    assert state["timers"] == 1 and state["alarms"] == 1


def test_manager_exposes_timers_for_entities():
    state = {}

    async def scenario(hass, mgr, timer):
        state["before"] = (list(mgr.timers), mgr.any_finished)
        mgr._finish(timer["id"])
        state["finished"] = mgr.any_finished
        mgr.dismiss(timer["id"])
        state["after"] = (list(mgr.timers), mgr.any_finished)

    _run(BASE, scenario)
    assert state["before"][1] is False and len(state["before"][0]) == 1
    assert state["finished"] is True
    assert state["after"] == ([], False)


def test_snooze_silences_a_finished_timer_and_counts_down_again():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.1)
        state["ringing"] = len(_plays(hass))
        state["snoozed"] = mgr.snooze(90)
        await _real_sleep(0.05)
        after = len(_plays(hass))
        await _real_sleep(0.15)
        state["quiet"] = len(_plays(hass)) == after
        t = mgr.timers[timer["id"]]
        state["done"], state["seconds"] = t["done"], t["seconds"]
        state["stopped"] = [c for c in hass.services.calls if c[:2] == ("media_player", "media_stop")]
        state["finished_after"] = mgr.any_finished

    _run(BASE, scenario)
    assert state["ringing"] >= 1 and state["snoozed"] == 1
    assert state["quiet"] and state["done"] is False and state["seconds"] == 90
    assert state["stopped"] and state["finished_after"] is False


def test_snooze_leaves_running_timers_alone():
    state = {}

    async def scenario(hass, mgr, timer):
        state["count"] = mgr.snooze(60)

    _run(BASE, scenario)
    assert state["count"] == 0
