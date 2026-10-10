"""Tests for the uploaded-photo store."""

import importlib.util
import os
from pathlib import Path
import tempfile
import time

spec = importlib.util.spec_from_file_location(
    "images", Path(__file__).parents[1] / "custom_components/hass_recipes/images.py"
)
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_detect_ext():
    assert images.detect_ext(b"\xff\xd8\xff\xe0abc") == "jpg"
    assert images.detect_ext(PNG) == "png"
    assert images.detect_ext(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
    assert images.detect_ext(b"<svg onload=alert(1)>") is None
    assert images.detect_ext(b"<html></html>") is None


def test_save_serve_and_path_safety():
    with tempfile.TemporaryDirectory() as tmp:
        store = images.ImageStore(Path(tmp) / "images")
        image_id = store.save(PNG)
        assert image_id.endswith(".png") and store.read(image_id) == PNG
        assert images.id_from_url(images.image_url(image_id)) == image_id
        for bad in ("../../etc/passwd", "x.png", image_id + "/..", "A" * 32 + ".png"):
            assert store.path(bad) is None
        try:
            store.save(b"not an image")
        except ValueError:
            pass
        else:
            raise AssertionError("accepted a non-image")


def test_sweep_only_removes_old_unreferenced():
    with tempfile.TemporaryDirectory() as tmp:
        store = images.ImageStore(Path(tmp))
        keep, old_orphan, fresh_orphan = store.save(PNG), store.save(PNG), store.save(PNG)
        past = time.time() - 7200
        for name in (keep, old_orphan):
            os.utime(Path(tmp) / name, (past, past))
        assert store.sweep({keep}) == 1
        assert store.path(keep) and store.path(fresh_orphan) and store.path(old_orphan) is None
