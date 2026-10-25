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
        self.config = types.SimpleNamespace(language="en")
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


def _stop_without_position(old, new, ended_ago=None):
    """A speaker that reports no duration or position: only our own clock can tell a stop from the end."""
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.05)
        mgr._grace_until = 0.0
        if ended_ago is not None:
            mgr._clip_end = hass.loop.time() - ended_ago
        mk = lambda st: types.SimpleNamespace(state=st, attributes={}, entity_id="media_player.kitchen")
        event = types.SimpleNamespace(data={"old_state": mk(old), "new_state": mk(new)})
        for cb in list(hass.listeners):
            cb(event)
        await _real_sleep(0.05)
        state["timers"] = len(mgr._timers)

    _run(BASE, scenario)
    return state


def test_a_chime_alone_is_played_as_the_long_alarm_so_there_is_something_to_stop():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.05)
        state["urls"] = [c[2]["media_content_id"] for c in _plays(hass)]
        state["clip_end_in"] = mgr._clip_end - hass.loop.time()
        mgr.dismiss(timer["id"])

    _run(BASE, scenario)
    assert state["urls"] and all(u.endswith("/alarm_long.wav") for u in state["urls"])
    assert state["clip_end_in"] > 10  # the whole long alarm is ahead of us, not three seconds


def test_the_chime_before_speech_stays_short():
    state = {}

    async def scenario(hass, mgr, timer):
        mgr._finish(timer["id"])
        await _real_sleep(0.1)
        state["urls"] = [c[2]["media_content_id"] for c in _plays(hass)]
        mgr.dismiss(timer["id"])

    _run({**BASE, "speaker_sound": "both"}, scenario)
    assert state["urls"] and all(u.endswith("/alarm.wav") for u in state["urls"])


def test_the_long_alarm_file_is_the_chime_repeated():
    import io
    import wave

    sound = importlib.import_module("hr_t.alarm_sound")
    with wave.open(io.BytesIO(sound.long_wav())) as clip:
        seconds = clip.getnframes() / clip.getframerate()
    assert abs(seconds - sound.LONG_SECONDS) < 0.01
    assert sound.LONG_SECONDS > 3 * sound.CHIME_SECONDS


def test_a_speaker_that_reports_no_position_is_still_noticed_when_stopped():
    # the chime has just started (our clock says it has about 3 s left): stopping it dismisses the alarm
    assert _stop_without_position("playing", "idle")["timers"] == 0
    assert _stop_without_position("playing", "paused")["timers"] == 0


def test_a_chime_that_ends_by_itself_keeps_the_alarm_even_without_a_position():
    assert _stop_without_position("playing", "idle", ended_ago=0.2)["timers"] == 1


def test_a_stop_during_the_chime_is_not_swallowed_by_the_start_grace():
    # the grace after starting the clip must be shorter than the chime, or a stop in the chime is ignored
    assert timers._START_GRACE_SECONDS < timers._CHIME_SECONDS - timers._EARLY_STOP_SECONDS


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


def test_the_spoken_alert_follows_the_configured_language():
    spoken = {}

    async def scenario(hass, mgr, timer):
        hass.config.language = "da"
        await mgr.async_play_alarm("Pandekager \u00b7 trin 2")
        spoken["da"] = [c for c in hass.services.calls if c[0] == "tts"][-1][2]["message"]
        hass.config.language = "de"
        await mgr.async_play_alarm("Pfannkuchen \u00b7 Schritt 2")
        spoken["de"] = [c for c in hass.services.calls if c[0] == "tts"][-1][2]["message"]
        hass.config.language = "xx"  # unknown: English
        await mgr.async_play_alarm("Pancakes")
        spoken["xx"] = [c for c in hass.services.calls if c[0] == "tts"][-1][2]["message"]

    _run({**BASE, "speaker_sound": "speech"}, scenario)
    assert spoken["da"] == "Timer f\u00e6rdig. Pandekager, trin 2"
    assert spoken["de"] == "Timer abgelaufen. Pfannkuchen, Schritt 2"
    assert spoken["xx"] == "Timer finished. Pancakes"
