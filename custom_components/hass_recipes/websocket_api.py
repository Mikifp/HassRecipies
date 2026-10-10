"""WebSocket API used by the Recipes panel."""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import ClientError, ClientTimeout

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import voluptuous as vol

from .const import DOMAIN, SIGNAL_TIMERS
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from .images import MAX_IMAGE_BYTES, image_url
from .migrate import from_mealie
from .scraper import RecipeImportError, async_import_url
from .store import RecipeStore

_STEP = vol.Schema(
    {
        vol.Required("text"): str,
        vol.Optional("ingredients", default=[]): [vol.All(int, vol.Range(min=0))],
        vol.Optional("timer"): vol.Any(None, vol.All(int, vol.Range(min=1, max=7 * 86400))),
        vol.Optional("section", default=False): bool,
    }
)

_RECIPE_FIELDS = {
    vol.Optional("name"): vol.All(str, vol.Length(min=1, max=200)),
    vol.Optional("description"): str,
    vol.Optional("image"): str,
    vol.Optional("ingredients"): [str],
    vol.Optional("instructions"): [vol.Any(str, _STEP)],
    vol.Optional("tags"): [str],
    vol.Optional("categories"): [str],
    vol.Optional("tools"): [str],
    vol.Optional("servings"): str,
    # what the ingredients, as written, make (e.g. 8 "pancakes") and the multiplier
    # the recipe opens at (2 = show it as a double batch)
    vol.Optional("yield_amount"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0.01, max=100000))),
    vol.Optional("yield_unit"): vol.All(str, vol.Length(max=40)),
    vol.Optional("default_scale"): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=100)),
    vol.Optional("prep_time"): vol.Any(None, vol.All(int, vol.Range(min=0))),
    vol.Optional("cook_time"): vol.Any(None, vol.All(int, vol.Range(min=0))),
    vol.Optional("total_time"): vol.Any(None, vol.All(int, vol.Range(min=0))),
    vol.Optional("source_url"): str,
    vol.Optional("notes"): str,
}


def _store(hass: HomeAssistant) -> RecipeStore:
    return hass.data[DOMAIN]


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all commands (idempotent per HA run)."""
    for command in (
        ws_list,
        ws_get,
        ws_create,
        ws_update,
        ws_delete,
        ws_import_url,
        ws_import_urls,
        ws_bulk_update,
        ws_bulk_delete,
        ws_cookbook_create,
        ws_cookbook_update,
        ws_cookbook_delete,
        ws_subscribe_timers,
        ws_timer_start,
        ws_timer_dismiss,
        ws_migrate_mealie,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list"})
@callback
def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    connection.send_result(
        msg["id"],
        {"recipes": store.list(), "tags": store.tags(), "cookbooks": store.cookbooks()},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/get", vol.Required("recipe_id"): str}
)
@callback
def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    recipe = _store(hass).get(msg["recipe_id"])
    if recipe is None:
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"], recipe)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/create", **_RECIPE_FIELDS}
)
@callback
def ws_create(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _store(hass).create(msg))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/update", vol.Required("recipe_id"): str, **_RECIPE_FIELDS}
)
@callback
def ws_update(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    recipe = _store(hass).update(msg["recipe_id"], msg)
    if recipe is None:
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"], recipe)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/delete", vol.Required("recipe_id"): str}
)
@callback
def ws_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not _store(hass).delete(msg["recipe_id"]):
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_url",
        vol.Required("url"): str,
        # When true the parsed recipe is saved; otherwise returned as a preview.
        vol.Optional("save", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_import_url(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    try:
        data = await async_import_url(async_get_clientsession(hass), msg["url"])
    except RecipeImportError as err:
        connection.send_error(msg["id"], "import_failed", str(err))
        return
    result = _store(hass).create(data) if msg["save"] else data
    connection.send_result(msg["id"], result)


_MAX_BULK = 25


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_urls",
        vol.Required("urls"): vol.All([str], vol.Length(min=1, max=_MAX_BULK)),
    }
)
@websocket_api.async_response
async def ws_import_urls(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Import several URLs and save each success; failures are reported per URL."""
    session = async_get_clientsession(hass)
    store = _store(hass)
    gate = asyncio.Semaphore(3)

    async def one(url: str) -> dict[str, Any]:
        async with gate:
            try:
                data = await async_import_url(session, url)
            except RecipeImportError as err:
                return {"url": url, "ok": False, "error": str(err)}
        recipe = store.create(data)
        return {"url": url, "ok": True, "id": recipe["id"], "name": recipe["name"]}

    urls = list(dict.fromkeys(u.strip() for u in msg["urls"] if u.strip()))
    connection.send_result(msg["id"], {"results": await asyncio.gather(*(one(u) for u in urls))})


_FACET_LISTS = vol.Schema(
    {
        vol.Optional("tags", default=[]): [str],
        vol.Optional("categories", default=[]): [str],
        vol.Optional("tools", default=[]): [str],
    }
)
_IDS = vol.All([str], vol.Length(min=1, max=1000))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/bulk_update",
        vol.Required("recipe_ids"): _IDS,
        vol.Optional("add", default={}): _FACET_LISTS,
        vol.Optional("remove", default={}): _FACET_LISTS,
    }
)
@callback
def ws_bulk_update(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    count = _store(hass).bulk_update(msg["recipe_ids"], msg["add"], msg["remove"])
    connection.send_result(msg["id"], {"updated": count})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/bulk_delete", vol.Required("recipe_ids"): _IDS}
)
@callback
def ws_bulk_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], {"deleted": _store(hass).bulk_delete(msg["recipe_ids"])})


_COOKBOOK_FIELDS = {
    vol.Optional("name"): vol.All(str, vol.Length(min=1, max=100)),
    vol.Optional("categories"): [str],
    vol.Optional("tags"): [str],
    vol.Optional("tools"): [str],
    vol.Optional("query"): str,
}


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/cookbook_create", **_COOKBOOK_FIELDS}
)
@callback
def ws_cookbook_create(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], _store(hass).cookbook_create(msg))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/cookbook_update",
        vol.Required("cookbook_id"): str,
        **_COOKBOOK_FIELDS,
    }
)
@callback
def ws_cookbook_update(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    cookbook = _store(hass).cookbook_update(msg["cookbook_id"], msg)
    if cookbook is None:
        connection.send_error(msg["id"], "not_found", "Cookbook not found")
        return
    connection.send_result(msg["id"], cookbook)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/cookbook_delete", vol.Required("cookbook_id"): str}
)
@callback
def ws_cookbook_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if not _store(hass).cookbook_delete(msg["cookbook_id"]):
        connection.send_error(msg["id"], "not_found", "Cookbook not found")
        return
    connection.send_result(msg["id"])


def _timers(hass: HomeAssistant):
    return hass.data[f"{DOMAIN}_timers"]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe_timers"})
@callback
def ws_subscribe_timers(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Push the full timer list now and whenever it changes."""
    manager = _timers(hass)

    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], manager.snapshot()))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_TIMERS, forward)
    connection.send_result(msg["id"])
    forward()


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/timer_start",
        vol.Required("key"): str,
        vol.Required("label"): vol.All(str, vol.Length(min=1, max=200)),
        vol.Required("seconds"): vol.All(int, vol.Range(min=1, max=7 * 86400)),
        vol.Optional("recipe_id"): str,
        vol.Optional("step"): vol.All(int, vol.Range(min=0)),
    }
)
@callback
def ws_timer_start(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    recipe = _store(hass).get(msg.get("recipe_id", ""))
    timer = _timers(hass).start(
        msg["key"],
        msg["label"],
        msg["seconds"],
        recipe_id=msg.get("recipe_id"),
        recipe_name=recipe["name"] if recipe else None,
        step=msg.get("step"),
    )
    connection.send_result(msg["id"], {"id": timer["id"]})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/timer_dismiss", vol.Required("timer_id"): str}
)
@callback
def ws_timer_dismiss(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    _timers(hass).dismiss(msg["timer_id"])
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/migrate_mealie",
        vol.Required("url"): vol.All(str, vol.Length(min=8, max=300)),
        vol.Required("token"): vol.All(str, vol.Length(min=1, max=4000)),
    }
)
@websocket_api.async_response
async def ws_migrate_mealie(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Pull every recipe from a running Mealie server using an API token (admin only)."""
    base = msg["url"].strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        connection.send_error(msg["id"], "invalid_url", "The Mealie URL must start with http:// or https://")
        return
    session = async_get_clientsession(hass)
    headers = {"Authorization": f"Bearer {msg['token'].strip()}", "Accept": "application/json"}
    timeout = ClientTimeout(total=30)

    async def get_json(path: str, params: dict[str, Any] | None = None) -> Any:
        async with session.get(f"{base}{path}", headers=headers, params=params, timeout=timeout) as resp:
            if resp.status == 401:
                raise PermissionError("Mealie rejected the API token (401)")
            resp.raise_for_status()
            return await resp.json()

    try:
        slugs: list[str] = []
        page = 1
        while True:
            data = await get_json("/api/recipes", {"page": page, "perPage": 100})
            slugs += [i["slug"] for i in data.get("items", []) if i.get("slug")]
            if page >= int(data.get("total_pages", 1) or 1) or page >= 200:
                break
            page += 1
    except PermissionError as err:
        connection.send_error(msg["id"], "unauthorized", str(err))
        return
    except (ClientError, TimeoutError, ValueError, KeyError) as err:
        connection.send_error(msg["id"], "mealie_unreachable", f"Could not read recipes from Mealie: {err}")
        return

    gate = asyncio.Semaphore(4)
    failed: list[dict[str, str]] = []
    recipes: list[dict[str, Any]] = []

    images = hass.data[f"{DOMAIN}_images"]

    async def download_image(recipe: dict[str, Any]) -> None:
        """Keep a local copy so the recipe still has its photo once Mealie is gone."""
        try:
            async with session.get(recipe["image"], headers=headers, timeout=timeout) as resp:
                resp.raise_for_status()
                blob = await resp.content.read(MAX_IMAGE_BYTES + 1)
            recipe["image"] = image_url(await hass.async_add_executor_job(images.save, blob))
        except (ClientError, TimeoutError, ValueError):
            pass  # leave the link to the Mealie server in place

    async def fetch(slug: str) -> None:
        async with gate:
            try:
                recipe = from_mealie(await get_json(f"/api/recipes/{slug}"), base)
            except (ClientError, TimeoutError, ValueError, PermissionError) as err:
                failed.append({"slug": slug, "error": str(err)})
                return
            if recipe.get("image"):
                await download_image(recipe)
            recipes.append(recipe)

    await asyncio.gather(*(fetch(s) for s in slugs))
    result = _store(hass).import_many(recipes)
    connection.send_result(
        msg["id"], {**result, "found": len(slugs), "failed": failed}
    )
