"""The timer alarm: the bundled chime, and a longer version of it that is played on speakers.

A single chime lasts about three seconds, so between repeats there was mostly silence and nothing
to stop. The long alarm is the chime several times over, so a speaker is sounding for most of the
time and can be stopped by hand (which dismisses the alarm).
"""

from __future__ import annotations

from functools import lru_cache
import io
from pathlib import Path
import wave

SOUND = Path(__file__).parent / "sounds" / "alarm.wav"
REPEATS = 5
GAP_SECONDS = 1.0


def _read() -> tuple[wave._wave_params, bytes]:
    with wave.open(str(SOUND)) as clip:
        return clip.getparams(), clip.readframes(clip.getnframes())


_PARAMS, _FRAMES = _read()  # at import, which Home Assistant does off the event loop
CHIME_SECONDS = _PARAMS.nframes / _PARAMS.framerate
LONG_SECONDS = REPEATS * CHIME_SECONDS + (REPEATS - 1) * GAP_SECONDS


@lru_cache(maxsize=1)
def long_wav() -> bytes:
    """The chime ``REPEATS`` times with a short gap in between, as a WAV file."""
    silence = bytes(int(GAP_SECONDS * _PARAMS.framerate) * _PARAMS.sampwidth * _PARAMS.nchannels)
    out = io.BytesIO()
    with wave.open(out, "wb") as clip:
        clip.setnchannels(_PARAMS.nchannels)
        clip.setsampwidth(_PARAMS.sampwidth)
        clip.setframerate(_PARAMS.framerate)
        clip.writeframes(silence.join([_FRAMES] * REPEATS))
    return out.getvalue()
