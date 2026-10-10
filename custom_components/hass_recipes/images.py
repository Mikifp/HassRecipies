"""Uploaded recipe photos, stored as plain files under <config>/hass_recipes/images.

Files are named by a random 128-bit id, so the image URL is unguessable and can be
used in ``<img>`` tags without an auth header (which browsers cannot send).
"""

from __future__ import annotations

from pathlib import Path
import re
import time
import uuid

URL_PREFIX = "/api/hass_recipes/image/"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
_ID = re.compile(r"^[0-9a-f]{32}\.(?:jpg|png|gif|webp)$")


def detect_ext(data: bytes) -> str | None:
    """File extension from magic bytes, or None if it is not a supported image."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"GIF8":
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def image_url(image_id: str) -> str:
    return f"{URL_PREFIX}{image_id}"


def id_from_url(url: str) -> str | None:
    """The image id if ``url`` points at one of our uploads."""
    if isinstance(url, str) and url.startswith(URL_PREFIX):
        candidate = url[len(URL_PREFIX):].split("?", 1)[0]
        if _ID.match(candidate):
            return candidate
    return None


class ImageStore:
    """Blocking file operations: call from an executor."""

    def __init__(self, directory: Path) -> None:
        self._dir = directory

    def save(self, data: bytes) -> str:
        ext = detect_ext(data)
        if ext is None:
            raise ValueError("Unsupported image type (use JPEG, PNG, WebP or GIF)")
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("Image is larger than 10 MB")
        self._dir.mkdir(parents=True, exist_ok=True)
        image_id = f"{uuid.uuid4().hex}.{ext}"
        (self._dir / image_id).write_bytes(data)
        return image_id

    def path(self, image_id: str) -> Path | None:
        if not _ID.match(image_id):
            return None
        path = self._dir / image_id
        return path if path.is_file() else None

    def read(self, image_id: str) -> bytes | None:
        path = self.path(image_id)
        return path.read_bytes() if path else None

    def sweep(self, referenced: set[str], min_age: float = 3600.0) -> int:
        """Delete files no recipe points at (older than ``min_age`` seconds)."""
        if not self._dir.is_dir():
            return 0
        removed = 0
        cutoff = time.time() - min_age
        for path in self._dir.iterdir():
            if path.name in referenced or not _ID.match(path.name):
                continue
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed += 1
            except OSError:
                continue
        return removed
