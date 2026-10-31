"""WebSocket API used by the Recipes panel."""

from __future__ import annotations

import asyncio
import functools
from typing import Any

from aiohttp import ClientError, ClientTimeout

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import voluptuous as vol

from .access import can_edit
from .ai import async_tidy, available as ai_available
from .const import DOMAIN, SIGNAL_TIMERS
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from .images import MAX_IMAGE_BYTES, image_url
from .ingredients import link_ingredients
from .mealplan import MealPlanError
from .migrate import from_mealie
from .nutrition import NUTRIENTS, SOURCE_CUSTOM, SOURCE_FRIDA, SOURCE_IGNORE, SOURCE_USDA, food_key as _key
from .nutrition_store import Nutrition, NutritionError
from .barcode import API_URL, FIELDS, USER_AGENT, BarcodeError, clean_code, food_from_product
from .calorie_calc import CalcError, calculate
from .tracker import Tracker, TrackerError
from .page_session import page_session
from .recipe_sites import MAX_RESULTS, SITES, RecipeSites
from .scraper import RecipeImportError, async_import_html, async_import_text, async_import_url
from .store import RecipeStore

_STEP = vol.Schema(
    {
        vol.Required("text"): str,
        # what the step uses: the ids of the recipe's ingredient items (older clients send indexes in ``ingredients``)
        vol.Optional("ingredient_ids"): [vol.All(str, vol.Length(max=64))],
        vol.Optional("ingredients"): [vol.All(int, vol.Range(min=0))],
        vol.Optional("timer"): vol.Any(None, vol.All(int, vol.Range(min=1, max=7 * 86400))),
        # any number of timers per step, each with an optional label ("simmer", "rest")
        vol.Optional("timers", default=[]): [
            {
                vol.Required("seconds"): vol.All(int, vol.Range(min=1, max=7 * 86400)),
                vol.Optional("label", default=""): vol.All(str, vol.Length(max=60)),
            }
        ],
        vol.Optional("section", default=False): bool,
    }
)

_ITEM = vol.Schema(
    {
        vol.Optional("id"): vol.All(str, vol.Length(max=64)),
        vol.Optional("header", default=False): bool,
        vol.Required("raw"): vol.All(str, vol.Length(max=500)),
        vol.Optional("comment", default=""): vol.All(str, vol.Length(max=500)),
        vol.Optional("alternatives", default=[]): [vol.All(str, vol.Length(max=500))],
    },
    extra=vol.ALLOW_EXTRA,  # a client may send an item back as it got it, with the worked-out amounts
)

_RECIPE_FIELDS = {
    vol.Optional("name"): vol.All(str, vol.Length(min=1, max=200)),
    vol.Optional("description"): str,
    vol.Optional("image"): str,
    vol.Optional("ingredients"): [str],
    # ingredients as data: an id (kept across saves), what was typed, a note and alternatives
    vol.Optional("ingredient_items"): [_ITEM],
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



_DENIED = "Only administrators can change recipes (see the integration's options)."


def _edits(func):
    """Refuse the command unless the user may change recipes."""

    @functools.wraps(func)
    def wrapper(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        if not can_edit(hass, connection.user):
            connection.send_error(msg["id"], "unauthorized", _DENIED)
            return
        return func(hass, connection, msg)

    return wrapper


def _edits_async(func):
    @functools.wraps(func)
    async def wrapper(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        if not can_edit(hass, connection.user):
            connection.send_error(msg["id"], "unauthorized", _DENIED)
            return
        return await func(hass, connection, msg)

    return wrapper


def _store(hass: HomeAssistant) -> RecipeStore:
    return hass.data[DOMAIN]


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all commands (idempotent per HA run)."""
    for command in (
        ws_list,
        ws_get,
        ws_summaries,
        ws_cooking,
        ws_trash,
        ws_restore,
        ws_purge,
        ws_plan_copy,
        ws_set_cooking_recipe,
        ws_set_cooking,
        ws_timer_snooze,
        ws_plan_list,
        ws_plan_meals_set,
        ws_plan_add,
        ws_plan_update,
        ws_plan_delete,
        ws_plan_clear,
        ws_plan_cook,
        ws_create,
        ws_update,
        ws_delete,
        ws_import_url,
        ws_import_urls,
        ws_import_html,
        ws_import_text,
        ws_bulk_update,
        ws_bulk_delete,
        ws_cookbook_create,
        ws_cookbook_update,
        ws_cookbook_delete,
        ws_subscribe_timers,
        ws_timer_start,
        ws_timer_dismiss,
        ws_migrate_mealie,
        ws_nutrition,
        ws_nutrition_search,
        ws_nutrition_link,
        ws_nutrition_unit_grams,
        ws_nutrition_custom_list,
        ws_nutrition_custom_save,
        ws_nutrition_custom_delete,
        ws_foods,
        ws_foods_save,
        ws_foods_delete,
        ws_foods_merge,
        ws_foods_adopt,
        ws_foods_link,
        ws_foods_assign,
        ws_foods_names,
        ws_tracker_day,
        ws_tracker_range,
        ws_tracker_add,
        ws_tracker_update,
        ws_tracker_delete,
        ws_tracker_goals,
        ws_tracker_person_add,
        ws_tracker_person_delete,
        ws_tracker_favourite,
        ws_tracker_log_plan,
        ws_tracker_recipe,
        ws_tracker_copy,
        ws_tracker_calc,
        ws_tracker_profile,
        ws_tracker_weight,
        ws_tracker_weight_delete,
        ws_tracker_water,
        ws_tracker_water_goal,
        ws_barcode,
        ws_sites,
        ws_sites_search,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list"})
@callback
def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    connection.send_result(
        msg["id"],
        {
            "recipes": store.list(),
            "tags": store.tags(),
            "cookbooks": store.cookbooks(),
            "cooking_recipe_id": store.cooking_recipe_id,
            "cooking_step": store.cooking_step,
            "cooking_scale": store.cooking_scale,
            "can_edit": can_edit(hass, connection.user),
            "ai_available": ai_available(hass),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/summaries"})
@callback
def ws_summaries(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The recipes without their steps: what a list or a search needs."""
    store = _store(hass)
    connection.send_result(
        msg["id"],
        {
            "recipes": store.summaries(),
            "cookbooks": store.cookbooks(),
            "cooking_recipe_id": store.cooking_recipe_id,
            "can_edit": can_edit(hass, connection.user),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cooking"})
@callback
def ws_cooking(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The shared cooking state and the one recipe it points at, in full."""
    store = _store(hass)
    state = store.cooking_state()
    connection.send_result(msg["id"], {**state, "recipe": store.get(state["recipe_id"] or "")})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/trash"})
@callback
def ws_trash(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"recipes": _store(hass).trash()})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/restore", vol.Required("recipe_id"): str}
)
@_edits
@callback
def ws_restore(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    recipe = _store(hass).restore(msg["recipe_id"])
    if recipe is None:
        connection.send_error(msg["id"], "not_found", "That recipe is not in the trash any more")
        return
    connection.send_result(msg["id"], {"id": recipe["id"], "name": recipe["name"]})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/purge", vol.Optional("recipe_id"): str}
)
@_edits
@callback
def ws_purge(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Empty the trash, or remove one recipe from it for good."""
    connection.send_result(msg["id"], {"removed": _store(hass).purge_trash(msg.get("recipe_id"))})


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
    {
        vol.Required("type"): f"{DOMAIN}/set_cooking_recipe",
        vol.Required("recipe_id"): vol.Any(None, str),
    }
)
@callback
def ws_set_cooking_recipe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Pick the recipe the dashboard cook card shows by default (null clears it)."""
    if not _store(hass).set_cooking_recipe(msg["recipe_id"]):
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_cooking",
        vol.Optional("recipe_id"): vol.Any(None, str),
        vol.Optional("step"): vol.All(int, vol.Range(min=0)),
        vol.Optional("delta"): vol.All(int, vol.Range(min=-1000, max=1000)),
        vol.Optional("scale"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000)),
    }
)
@callback
def ws_set_cooking(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Move the shared cooking state: recipe, step (absolute or relative) and scale."""
    store = _store(hass)
    kwargs: dict[str, Any] = {
        "step": msg.get("step"),
        "scale": msg.get("scale"),
        "delta": msg.get("delta", 0),
    }
    if "recipe_id" in msg:
        kwargs["recipe_id"] = msg["recipe_id"]
    if not store.set_cooking(**kwargs):
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"], store.cooking_state())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/create", **_RECIPE_FIELDS}
)
@callback
@_edits
def ws_create(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _store(hass).create(msg))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/update", vol.Required("recipe_id"): str, **_RECIPE_FIELDS}
)
@callback
@_edits
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
@_edits
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
    if msg["save"] and not can_edit(hass, connection.user):
        connection.send_error(msg["id"], "unauthorized", _DENIED)
        return
    try:
        data = await async_import_url(page_session(hass), msg["url"])
    except RecipeImportError as err:
        connection.send_error(msg["id"], "import_failed", str(err))
        return
    result = _store(hass).create(data) if msg["save"] else data
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_html",
        vol.Required("html"): vol.All(str, vol.Length(min=1)),
        vol.Optional("url", default=""): str,
    }
)
@websocket_api.async_response
async def ws_import_html(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Parse pasted page source into a recipe preview (nothing is saved until the editor is saved)."""
    try:
        data = await async_import_html(msg["html"], msg["url"])
    except RecipeImportError as err:
        connection.send_error(msg["id"], "import_failed", str(err))
        return
    connection.send_result(msg["id"], data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_text",
        vol.Required("text"): vol.All(str, vol.Length(min=1)),
        vol.Optional("url", default=""): str,
        # tidy the text with the AI set up in Home Assistant (AI Task); the plain reading is the fallback
        vol.Optional("ai", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_import_text(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Read a recipe out of pasted page source, schema.org Recipe JSON or plain text (nothing is saved)."""
    data = None
    ai_error = ""
    if msg["ai"]:
        if not can_edit(hass, connection.user):
            connection.send_error(msg["id"], "unauthorized", _DENIED)
            return
        try:
            data = await async_tidy(hass, msg["text"], msg["url"].strip())
            data["instructions"] = link_ingredients(data["ingredients"], data["instructions"])
        except RecipeImportError as err:
            ai_error = str(err)
    if data is None:
        try:
            data = await async_import_text(msg["text"], msg["url"])
        except RecipeImportError as err:
            connection.send_error(msg["id"], "import_failed", f"{ai_error} {err}".strip())
            return
        if ai_error:
            data["ai_error"] = ai_error
    connection.send_result(msg["id"], data)


_MAX_BULK = 25


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_urls",
        vol.Required("urls"): vol.All([str], vol.Length(min=1, max=_MAX_BULK)),
    }
)
@websocket_api.async_response
@_edits_async
async def ws_import_urls(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Import several URLs and save each success; failures are reported per URL."""
    session = page_session(hass)
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
@_edits
def ws_bulk_update(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    count = _store(hass).bulk_update(msg["recipe_ids"], msg["add"], msg["remove"])
    connection.send_result(msg["id"], {"updated": count})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/bulk_delete", vol.Required("recipe_ids"): _IDS}
)
@callback
@_edits
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
@_edits
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
@_edits
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
@_edits
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


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/timer_snooze",
        vol.Optional("timer_id"): str,
        vol.Optional("seconds", default=120): vol.All(int, vol.Range(min=10, max=3600)),
    }
)
@callback
def ws_timer_snooze(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    count = _timers(hass).snooze(msg["seconds"], msg.get("timer_id"))
    connection.send_result(msg["id"], {"snoozed": count})


def _plan(hass: HomeAssistant):
    return hass.data[f"{DOMAIN}_plan"]


def _plan_error(connection: websocket_api.ActiveConnection, msg_id: int, err: Exception) -> None:
    connection.send_error(msg_id, "invalid_format", str(err))


_DAY = vol.All(str, vol.Length(min=10, max=10))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/plan_list", vol.Required("start"): _DAY, vol.Required("end"): _DAY}
)
@callback
def ws_plan_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        connection.send_result(
            msg["id"], {"entries": _plan(hass).list(msg["start"], msg["end"]), "meals": _plan(hass).meals()}
        )
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)


_MEAL = vol.Schema(
    {
        vol.Optional("id"): vol.All(str, vol.Length(max=40)),
        vol.Optional("name", default=""): vol.All(str, vol.Length(max=40)),
        vol.Optional("color", default="blue"): str,
        vol.Required("time"): str,
        vol.Optional("minutes", default=60): vol.All(vol.Coerce(int), vol.Range(min=5, max=720)),
        vol.Optional("words", default=[]): [vol.All(str, vol.Length(max=30))],
    }
)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plan_meals_set", vol.Required("meals"): [_MEAL]})
@callback
@_edits
def ws_plan_meals_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replace the meals of the day (name, colour, time, category words), in the order given."""
    try:
        meals = _plan(hass).set_meals(msg["meals"])
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"meals": meals})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_add",
        vol.Required("date"): _DAY,
        vol.Required("slot"): str,
        vol.Optional("recipe_id"): vol.Any(None, str),
        vol.Optional("title"): vol.All(str, vol.Length(max=200)),
        vol.Optional("scale"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000))),
        vol.Optional("note"): vol.All(str, vol.Length(max=500)),
    }
)
@callback
@_edits
def ws_plan_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        entry = _plan(hass).add(
            msg["date"],
            msg["slot"],
            recipe_id=msg.get("recipe_id"),
            title=msg.get("title"),
            scale=msg.get("scale"),
            note=msg.get("note", ""),
        )
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], entry)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_update",
        vol.Required("entry_id"): str,
        vol.Optional("date"): _DAY,
        vol.Optional("slot"): str,
        vol.Optional("recipe_id"): vol.Any(None, str),
        vol.Optional("title"): vol.All(str, vol.Length(max=200)),
        vol.Optional("scale"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000))),
        vol.Optional("note"): vol.All(str, vol.Length(max=500)),
    }
)
@callback
@_edits
def ws_plan_update(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    fields = {k: v for k, v in msg.items() if k not in ("id", "type", "entry_id")}
    try:
        entry = _plan(hass).update(msg["entry_id"], **fields)
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)
        return
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Meal not found")
        return
    connection.send_result(msg["id"], entry)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/plan_delete", vol.Required("entry_id"): str}
)
@callback
@_edits
def ws_plan_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not _plan(hass).delete(msg["entry_id"]):
        connection.send_error(msg["id"], "not_found", "Meal not found")
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_clear",
        vol.Required("start"): _DAY,
        vol.Optional("end"): _DAY,
        vol.Optional("slot"): str,
    }
)
@callback
@_edits
def ws_plan_clear(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        removed = _plan(hass).clear(msg["start"], msg.get("end"), msg.get("slot"))
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"removed": removed})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_copy",
        vol.Required("source"): _DAY,
        vol.Required("target"): _DAY,
        vol.Optional("days", default=7): vol.All(int, vol.Range(min=1, max=62)),
        vol.Optional("replace", default=False): bool,
    }
)
@_edits
@callback
def ws_plan_copy(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Copy a run of days to another start date (e.g. last week onto this week)."""
    try:
        result = _plan(hass).copy(msg["source"], msg["target"], msg["days"], replace=msg["replace"])
    except MealPlanError as err:
        _plan_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/plan_cook", vol.Required("entry_id"): str}
)
@callback
def ws_plan_cook(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Make a planned recipe the one being cooked (at the planned scale)."""
    entry = _plan(hass).get(msg["entry_id"])
    store = _store(hass)
    if entry is None or not entry.get("recipe_exists"):
        connection.send_error(msg["id"], "not_found", "That meal has no recipe to cook")
        return
    store.set_cooking(entry["recipe_id"], scale=entry.get("scale"))
    connection.send_result(msg["id"], store.cooking_state())


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


# ---- nutrition: calories and macros from Frida and custom ingredients ----

def _nutrition(hass: HomeAssistant) -> Nutrition:
    return hass.data[f"{DOMAIN}_nutrition"]


_PER_100G = vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=1000)))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/nutrition", vol.Required("recipe_id"): str}
)
@callback
def ws_nutrition(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    result = _nutrition(hass).for_recipe(msg["recipe_id"])
    if result is None:
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/nutrition_search",
        vol.Required("query"): vol.All(str, vol.Length(max=120)),
        vol.Optional("limit", default=15): vol.All(int, vol.Range(min=1, max=50)),
    }
)
@callback
def ws_nutrition_search(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _nutrition(hass).search(msg["query"], msg["limit"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/nutrition_link",
        vol.Required("food"): vol.All(str, vol.Length(min=1, max=200)),
        # None forgets the link, so the ingredient is matched automatically again
        vol.Required("source"): vol.Any(None, SOURCE_FRIDA, SOURCE_USDA, SOURCE_CUSTOM, SOURCE_IGNORE),
        vol.Optional("food_id"): vol.Any(None, int, str),
    }
)
@callback
@_edits
def ws_nutrition_link(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    nutrition = _nutrition(hass)
    keep = (nutrition.links().get(_key(msg["food"])) or {}).get("unit_grams")
    try:
        link = nutrition.set_link(msg["food"], msg["source"], msg.get("food_id"), keep)
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], link)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/nutrition_unit_grams",
        vol.Required("food"): vol.All(str, vol.Length(min=1, max=200)),
        vol.Required("unit"): vol.All(str, vol.Length(min=1, max=40)),
        vol.Required("grams"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000))),
    }
)
@callback
@_edits
def ws_nutrition_unit_grams(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    try:
        _nutrition(hass).set_unit_grams(msg["food"], msg["unit"], msg["grams"])
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/nutrition_custom_list"})
@callback
def ws_nutrition_custom_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], _nutrition(hass).custom_foods())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/nutrition_custom_save",
        vol.Optional("food_id"): str,
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=120)),
        **{vol.Optional(key): _PER_100G for key in NUTRIENTS},
        # link these ingredient names to the new food straight away ("hjemmelavet pesto")
        vol.Optional("link_food"): vol.All(str, vol.Length(min=1, max=200)),
    }
)
@callback
@_edits
def ws_nutrition_custom_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    nutrition = _nutrition(hass)
    try:
        food = nutrition.save_custom(
            {k: msg[k] for k in ("name", *NUTRIENTS) if k in msg}, msg.get("food_id")
        )
        if msg.get("link_food"):
            keep = (nutrition.links().get(_key(msg["link_food"])) or {}).get("unit_grams")
            nutrition.set_link(msg["link_food"], SOURCE_CUSTOM, food["id"], keep)
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], food)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/nutrition_custom_delete", vol.Required("food_id"): str}
)
@callback
@_edits
def ws_nutrition_custom_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if not _nutrition(hass).delete_custom(msg["food_id"]):
        connection.send_error(msg["id"], "not_found", "Custom ingredient not found")
        return
    connection.send_result(msg["id"])


# ---- foods: the user's own list of what an ingredient line can be ----

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/foods"})
@callback
def ws_foods(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Every food, and the ingredient names in recipes that are not a food yet."""
    connection.send_result(msg["id"], _nutrition(hass).foods_overview())


_FOOD_FIELDS = {
    vol.Optional("name"): vol.All(str, vol.Length(min=1, max=120)),
    vol.Optional("aliases"): [vol.All(str, vol.Length(max=120))],
    vol.Optional("source"): vol.Any(SOURCE_FRIDA, SOURCE_USDA, SOURCE_CUSTOM, "none"),
    vol.Optional("frida_id"): vol.Any(None, int),
    vol.Optional("usda_id"): vol.Any(None, int),
    vol.Optional("values"): {vol.Optional(key): _PER_100G for key in NUTRIENTS},
    vol.Optional("unit_grams"): {vol.All(str, vol.Length(min=1, max=40)): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000))},
    vol.Optional("section"): vol.All(str, vol.Length(max=60)),
}


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/foods_save", vol.Optional("food_id"): str, **_FOOD_FIELDS}
)
@callback
@_edits
def ws_foods_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Create a food, or change one: only the fields given change."""
    data = {k: v for k, v in msg.items() if k not in ("id", "type", "food_id")}
    try:
        food = _nutrition(hass).save_food(data, msg.get("food_id"))
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], food)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/foods_delete", vol.Required("food_id"): str})
@callback
@_edits
def ws_foods_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not _nutrition(hass).delete_food(msg["food_id"]):
        connection.send_error(msg["id"], "not_found", "Food not found")
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/foods_merge",
        vol.Required("target"): str,
        vol.Required("sources"): vol.All([str], vol.Length(min=1, max=50)),
    }
)
@callback
@_edits
def ws_foods_merge(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Fold foods into another one: their names become names of the target."""
    try:
        food = _nutrition(hass).merge_foods(msg["target"], msg["sources"])
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], food)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/foods_names"})
@callback
def ws_foods_names(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Every name of the foods, with all the names of the same food (so a step can call an ingredient by any of them)."""
    connection.send_result(msg["id"], _nutrition(hass).name_groups())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/foods_assign",
        vol.Required("groups"): vol.All(
            [
                {
                    vol.Required("keys"): vol.All([vol.All(str, vol.Length(min=1, max=200))], vol.Length(min=1, max=50)),
                    vol.Optional("food_id"): str,
                    vol.Optional("name"): vol.All(str, vol.Length(max=200)),
                    vol.Optional("source"): vol.In(["frida", "usda", "none"]),
                    vol.Optional("source_id"): vol.Any(int, None),
                }
            ],
            vol.Length(min=1, max=100),
        ),
    }
)
@callback
@_edits
def ws_foods_assign(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Assign groups of ingredient names to foods (the suggested groups on the review list)."""
    connection.send_result(msg["id"], {"assigned": _nutrition(hass).assign_groups(msg["groups"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/foods_link",
        vol.Optional("key"): vol.All(str, vol.Length(min=1, max=200)),
        vol.Optional("keys"): vol.All([vol.All(str, vol.Length(min=1, max=200))], vol.Length(min=1, max=200)),
        vol.Required("food_id"): str,
    }
)
@callback
@_edits
def ws_foods_link(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Say that an ingredient name (or several at once) is one of the foods: they become other names of it."""
    keys = msg.get("keys") or ([msg["key"]] if msg.get("key") else [])
    if not keys:
        connection.send_error(msg["id"], "invalid", "Give the ingredient names to link")
        return
    try:
        food = _nutrition(hass).link_many(keys, msg["food_id"])
    except NutritionError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], food)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/foods_adopt", vol.Required("keys"): vol.All([vol.All(str, vol.Length(max=200))], vol.Length(max=500))}
)
@callback
@_edits
def ws_foods_adopt(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Make foods of ingredient names, accepting what the calculation already picks for them."""
    connection.send_result(msg["id"], {"added": _nutrition(hass).adopt(msg["keys"])})


# ---- the calorie tracker ----------------------------------------------------------
# Anyone may read everyone's log. A person's log is changed by that person (the Home Assistant user it is
# made for), by an administrator, or by anyone when it is a name added by hand.

def _tracker(hass: HomeAssistant) -> Tracker:
    return hass.data[f"{DOMAIN}_tracker"]


def _may_change(connection: websocket_api.ActiveConnection, person: dict[str, Any]) -> bool:
    user = connection.user
    if person.get("user_id") is None:
        return True
    return bool(user is not None and (user.is_admin or user.id == person["user_id"]))


def _person_view(connection: websocket_api.ActiveConnection, person: dict[str, Any]) -> dict[str, Any]:
    return {**person, "editable": _may_change(connection, person)}


def _tracker_guard(func):
    """A tracker command that changes a person's log: the person is checked, TrackerError becomes an error reply."""

    @functools.wraps(func)
    async def wrapper(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        tracker = _tracker(hass)
        try:
            person_id = msg.get("person_id")
            if person_id is None and msg.get("entry_id"):
                person_id = tracker.entry(msg["entry_id"])["person_id"]
            person = tracker.person(person_id)
            if not _may_change(connection, person):
                connection.send_error(msg["id"], "unauthorized", f"Only {person['name']} or an administrator can change this log.")
                return
            await func(hass, connection, msg, tracker)
        except (TrackerError, MealPlanError) as err:
            connection.send_error(msg["id"], "invalid_format", str(err))

    return wrapper


async def _caller(hass: HomeAssistant, connection: websocket_api.ActiveConnection) -> str | None:
    """The person of the user who asks (made when there is none yet)."""
    tracker = _tracker(hass)
    await tracker.async_sync_users()
    user = connection.user
    if user is None:
        return None
    return tracker.ensure_user(user.id, user.name)["id"]


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_day", vol.Optional("person_id"): str, vol.Optional("date"): _DAY}
)
@websocket_api.async_response
async def ws_tracker_day(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """One person's day: entries, totals against the goal, planned meals not logged yet, recent and favourite items."""
    from homeassistant.util import dt as dt_util

    tracker = _tracker(hass)
    me = await _caller(hass, connection)
    person_id = msg.get("person_id") or me
    day = msg.get("date") or dt_util.now().date().isoformat()
    try:
        result = tracker.day(person_id, day)
    except (TrackerError, MealPlanError) as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    result["person"] = _person_view(connection, result["person"])
    result["persons"] = [_person_view(connection, p) for p in tracker.persons()]
    result["me"] = me
    result["meals"] = _plan(hass).meals()
    result["today"] = dt_util.now().date().isoformat()
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_range", vol.Required("person_id"): str, vol.Required("start"): _DAY, vol.Required("end"): _DAY}
)
@callback
def ws_tracker_range(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        connection.send_result(msg["id"], _tracker(hass).range(msg["person_id"], msg["start"], msg["end"]))
    except (TrackerError, MealPlanError) as err:
        connection.send_error(msg["id"], "invalid_format", str(err))


_NUM = vol.Any(None, vol.Coerce(float))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/tracker_add",
        vol.Required("person_id"): str,
        vol.Required("date"): _DAY,
        vol.Required("meal"): str,
        vol.Required("kind"): vol.In(["recipe", "food", "quick"]),
        vol.Optional("recipe_id"): str,
        vol.Optional("food_id"): str,
        vol.Optional("servings"): _NUM,
        vol.Optional("by"): vol.In(["servings", "yield", "grams"]),
        vol.Optional("amount"): _NUM,
        vol.Optional("unit"): vol.All(str, vol.Length(max=40)),
        vol.Optional("name"): vol.All(str, vol.Length(max=120)),
        vol.Optional("kcal"): _NUM,
        vol.Optional("protein"): _NUM,
        vol.Optional("carbs"): _NUM,
        vol.Optional("fat"): _NUM,
        vol.Optional("plan_id"): str,
    }
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_add(hass, connection, msg, tracker) -> None:
    fields = {k: v for k, v in msg.items() if k not in ("id", "type", "person_id", "date", "meal", "kind")}
    connection.send_result(msg["id"], tracker.add(msg["person_id"], msg["date"], msg["meal"], msg["kind"], **fields))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/tracker_update",
        vol.Required("entry_id"): str,
        vol.Optional("date"): _DAY,
        vol.Optional("meal"): str,
        vol.Optional("servings"): _NUM,
        vol.Optional("by"): vol.In(["servings", "yield", "grams"]),
        vol.Optional("amount"): _NUM,
        vol.Optional("unit"): vol.All(str, vol.Length(max=40)),
        vol.Optional("name"): vol.All(str, vol.Length(max=120)),
        vol.Optional("kcal"): _NUM,
        vol.Optional("protein"): _NUM,
        vol.Optional("carbs"): _NUM,
        vol.Optional("fat"): _NUM,
    }
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_update(hass, connection, msg, tracker) -> None:
    fields = {k: v for k, v in msg.items() if k not in ("id", "type", "entry_id")}
    connection.send_result(msg["id"], tracker.update(msg["entry_id"], **fields))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tracker_delete", vol.Required("entry_id"): str})
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_delete(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], {"deleted": tracker.delete(msg["entry_id"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/tracker_goals",
        vol.Required("person_id"): str,
        vol.Required("goals"): {vol.Optional(k): _NUM for k in ("kcal", "protein", "carbs", "fat")},
    }
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_goals(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], _person_view(connection, tracker.set_goals(msg["person_id"], msg["goals"])))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_person_add", vol.Required("name"): vol.All(str, vol.Length(min=1, max=60))}
)
@callback
def ws_tracker_person_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        connection.send_result(msg["id"], _person_view(connection, _tracker(hass).add_person(msg["name"])))
    except TrackerError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tracker_person_delete", vol.Required("person_id"): str})
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_person_delete(hass, connection, msg, tracker) -> None:
    person = tracker.person(msg["person_id"])
    if person.get("user_id") is not None and not (connection.user and connection.user.is_admin):
        connection.send_error(msg["id"], "unauthorized", "Only an administrator can remove a Home Assistant user's log.")
        return
    connection.send_result(msg["id"], {"deleted": tracker.delete_person(msg["person_id"])})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_favourite", vol.Required("person_id"): str, vol.Required("entry_id"): str}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_favourite(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], {"favourite": tracker.toggle_favourite(msg["person_id"], msg["entry_id"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/tracker_log_plan",
        vol.Required("person_id"): str,
        vol.Required("plan_id"): str,
        vol.Optional("servings", default=1): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000)),
    }
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_log_plan(hass, connection, msg, tracker) -> None:
    """Log a planned meal as eaten (on its day, in its meal)."""
    plan = _plan(hass).get(msg["plan_id"])
    if not plan or not plan.get("recipe_id"):
        raise TrackerError("That planned meal has no recipe")
    entry = tracker.add(msg["person_id"], plan["date"], plan["slot"], "recipe", recipe_id=plan["recipe_id"], servings=msg["servings"], plan_id=plan["id"])
    connection.send_result(msg["id"], entry)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tracker_recipe", vol.Required("recipe_id"): str})
@callback
def ws_tracker_recipe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What a recipe can be logged in (servings, what it makes, grams) and its nutrition for them."""
    basis = _nutrition(hass).recipe_basis(msg["recipe_id"])
    if basis is None:
        connection.send_error(msg["id"], "not_found", "Recipe not found")
        return
    connection.send_result(msg["id"], basis)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_copy", vol.Required("person_id"): str, vol.Required("source"): _DAY, vol.Required("date"): _DAY}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_copy(hass, connection, msg, tracker) -> None:
    """Log a day's entries again on another day (yesterday's breakfast on today)."""
    if msg["source"] == msg["date"]:
        raise TrackerError("Pick another day to copy from")
    connection.send_result(msg["id"], tracker.copy_day(msg["person_id"], msg["source"], msg["date"]))


_PROFILE = {
    vol.Optional("sex"): vol.In(["female", "male"]),
    vol.Optional("activity"): vol.In(["sedentary", "light", "moderate", "hard"]),
    vol.Optional("age"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("height_cm"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("weight_kg"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("target_kg"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("pace"): vol.Any(None, vol.Coerce(float)),
}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tracker_calc", vol.Required("profile"): _PROFILE})
@callback
def ws_tracker_calc(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Resting and maintenance energy and a daily target for each pace of weight loss (nothing is saved)."""
    from homeassistant.util import dt as dt_util

    try:
        connection.send_result(msg["id"], calculate(msg["profile"], dt_util.now().date()))
    except CalcError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_profile", vol.Required("person_id"): str, vol.Required("profile"): _PROFILE}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_profile(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], _person_view(connection, tracker.set_profile(msg["person_id"], msg["profile"])))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_weight", vol.Required("person_id"): str, vol.Required("date"): _DAY, vol.Required("kg"): vol.Coerce(float)}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_weight(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], _person_view(connection, tracker.log_weight(msg["person_id"], msg["date"], msg["kg"])))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_weight_delete", vol.Required("person_id"): str, vol.Required("date"): _DAY}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_weight_delete(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], {"deleted": tracker.delete_weight(msg["person_id"], msg["date"])})


# ---- searching the recipe sites ---------------------------------------------------
def _sites(hass: HomeAssistant) -> RecipeSites:
    return hass.data[f"{DOMAIN}_sites"]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/sites"})
@callback
def ws_sites(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The recipe sites that can be searched, and how many recipes of each have been read so far."""
    known = _sites(hass).status()
    connection.send_result(
        msg["id"], [{"id": s.id, "name": s.name, "base": s.base, "recipes": known.get(s.id, 0)} for s in SITES.values()]
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/sites_search",
        vol.Required("query"): vol.All(str, vol.Length(min=1, max=100)),
        vol.Optional("sites"): [vol.In(list(SITES))],
        vol.Optional("limit", default=MAX_RESULTS): vol.All(int, vol.Range(min=1, max=60)),
    }
)
@websocket_api.async_response
async def ws_sites_search(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Recipes on the sites whose name has every word of the query (open one with import_url to read it)."""
    ids = msg.get("sites") or list(SITES)
    connection.send_result(msg["id"], {"results": await _sites(hass).search(ids, msg["query"], msg["limit"])})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tracker_water", vol.Required("person_id"): str, vol.Required("date"): _DAY, vol.Required("ml"): vol.Coerce(float)}
)
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_water(hass, connection, msg, tracker) -> None:
    """Water drunk on a day: ml more, or negative to undo."""
    connection.send_result(msg["id"], tracker.add_water(msg["person_id"], msg["date"], msg["ml"]))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tracker_water_goal", vol.Required("person_id"): str, vol.Required("ml"): vol.Coerce(float)})
@websocket_api.async_response
@_tracker_guard
async def ws_tracker_water_goal(hass, connection, msg, tracker) -> None:
    connection.send_result(msg["id"], _person_view(connection, tracker.set_water_goal(msg["person_id"], msg["ml"])))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/barcode", vol.Required("code"): vol.All(str, vol.Length(max=40))})
@websocket_api.async_response
@_edits_async
async def ws_barcode(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A scanned barcode: the food made for it before, or one made now from Open Food Facts (one lookup per scan)."""
    nutrition = _nutrition(hass)
    try:
        code = clean_code(msg["code"])
        found = nutrition.food_for_barcode(code)
        if found is None:
            try:
                async with async_get_clientsession(hass).get(
                    API_URL.format(code=code), params={"fields": FIELDS}, headers={"User-Agent": USER_AGENT}, timeout=ClientTimeout(total=10)
                ) as resp:
                    body = await resp.json(content_type=None) if resp.status == 200 else {}
            except (ClientError, asyncio.TimeoutError, ValueError) as err:
                raise BarcodeError("Open Food Facts could not be reached. Try again, or type the food in") from err
            product = body.get("product") if isinstance(body, dict) and body.get("status") == 1 else None
            if not product:
                raise BarcodeError("Open Food Facts does not know this barcode")
            found = nutrition.save_food(food_from_product(product, code))
    except (BarcodeError, NutritionError) as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], found)
