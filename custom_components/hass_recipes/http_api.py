"""HTTP endpoints: file import/export and photo upload/serving.

Files and photos can be several MB, which is too large for a comfortable
WebSocket message, so the panel talks to these plain HTTP views instead.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .images import MAX_IMAGE_BYTES, ImageStore, id_from_url, image_url
from .migrate import MigrationError, parse_upload

try:  # moved in recent Home Assistant releases
    from homeassistant.helpers.http import KEY_HASS
except ImportError:  # pragma: no cover
    KEY_HASS = "hass"


def _images(hass: HomeAssistant) -> ImageStore:
    return hass.data[f"{DOMAIN}_images"]


def attach_images(images: ImageStore, recipes: list[dict[str, Any]]) -> None:
    """Blocking: persist ``_image`` bytes and point ``image`` at the stored file."""
    for recipe in recipes:
        data = recipe.pop("_image", None)
        if not data:
            continue
        try:
            recipe["image"] = image_url(images.save(data))
        except ValueError:
            continue  # unsupported/oversized photo: keep the recipe without it


class RecipesImportView(HomeAssistantView):
    """POST raw file bytes to /api/hass_recipes/import."""

    url = "/api/hass_recipes/import"
    name = "api:hass_recipes:import"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        store = hass.data.get(DOMAIN)
        if store is None:
            return self.json_message("Recipes is not loaded", 503)
        data = await request.read()
        if not data:
            return self.json_message("Empty upload", 400)

        def work() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
            recipes, cookbooks = parse_upload(data)  # CPU-bound: keep off the event loop
            attach_images(_images(hass), recipes)
            return recipes, cookbooks

        try:
            recipes, cookbooks = await hass.async_add_executor_job(work)
        except MigrationError as err:
            return self.json_message(str(err), 400)
        return self.json(store.import_many(recipes, cookbooks))


class RecipesExportView(HomeAssistantView):
    """GET /api/hass_recipes/export: everything, with uploaded photos embedded."""

    url = "/api/hass_recipes/export"
    name = "api:hass_recipes:export"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        store = hass.data.get(DOMAIN)
        if store is None:
            return self.json_message("Recipes is not loaded", 503)
        document = store.export()

        def embed() -> None:
            images = _images(hass)
            for recipe in document["recipes"]:
                image_id = id_from_url(recipe.get("image", ""))
                if image_id and (blob := images.read(image_id)):
                    recipe["image_data"] = base64.b64encode(blob).decode()
                    recipe["image"] = ""

        await hass.async_add_executor_job(embed)
        return self.json(document)


class RecipesUploadImageView(HomeAssistantView):
    """POST an image (raw bytes) to /api/hass_recipes/upload_image."""

    url = "/api/hass_recipes/upload_image"
    name = "api:hass_recipes:upload_image"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        if request.content_length and request.content_length > MAX_IMAGE_BYTES:
            return self.json_message("Image is larger than 10 MB", 413)
        data = await request.read()
        if not data:
            return self.json_message("Empty upload", 400)
        try:
            image_id = await hass.async_add_executor_job(_images(hass).save, data)
        except ValueError as err:
            return self.json_message(str(err), 400)
        return self.json({"image": image_url(image_id)})


class RecipesAlarmView(HomeAssistantView):
    """GET /api/hass_recipes/alarm.wav: the chime played on speakers.

    Speakers cannot send an auth header, so this one file is public.
    """

    url = "/api/hass_recipes/alarm.wav"
    name = "api:hass_recipes:alarm"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        path = Path(__file__).parent / "sounds" / "alarm.wav"
        return web.FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


class RecipesImageView(HomeAssistantView):
    """GET /api/hass_recipes/image/<id>.

    No auth header: <img> tags cannot send one. The 128-bit random id is the
    capability, so images are only reachable by someone who has the link.
    """

    url = "/api/hass_recipes/image/{image_id}"
    name = "api:hass_recipes:image"
    requires_auth = False

    async def get(self, request: web.Request, image_id: str) -> web.StreamResponse:
        hass = request.app[KEY_HASS]
        images = hass.data.get(f"{DOMAIN}_images")
        path = await hass.async_add_executor_job(images.path, image_id) if images else None
        if path is None:
            return web.Response(status=404)
        return web.FileResponse(
            path, headers={"Cache-Control": "public, max-age=31536000, immutable"}
        )
