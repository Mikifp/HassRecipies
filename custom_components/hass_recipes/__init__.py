"""Recipes: a Mealie-style recipe manager built into Home Assistant."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_interval
import voluptuous as vol

from .const import (
    CARDS_JS,
    CONF_SPEAKERS,
    DEFAULT_SNOOZE_SECONDS,
    DOMAIN,
    FRONTEND_URL,
    ISSUE_CARDS_RESOURCE,
    PANEL_ELEMENT,
    PANEL_URL_PATH,
    PLATFORMS,
    SERVICE_ADD_TO_SHOPPING_LIST,
    SERVICE_CLEAR_MEAL_PLAN,
    SERVICE_PLAN_MEAL,
    SERVICE_PLAN_TO_SHOPPING_LIST,
    SERVICE_IMPORT_RECIPE,
    SERVICE_SNOOZE_TIMER,
    SERVICE_STOP_TIMER_ALARM,
    SERVICE_TEST_TIMER_SOUND,
)
from .http_api import (
    RecipesAlarmView,
    RecipesLongAlarmView,
    RecipesExportView,
    RecipesImageView,
    RecipesImportView,
    RecipesUploadImageView,
)
from .images import ImageStore, id_from_url
from .localize import words
from .lovelace_resource import async_ensure_resource, async_remove_resource, resource_mode
from .intents import async_install_sentences, async_remove_intents, async_setup_intents
from .scraper import RecipeImportError, async_import_url
from .mealplan import MealPlan, MealPlanError
from .nutrition import FoodDatabase
from .nutrition_store import Nutrition
from .shopping import (
    _base_servings,
    async_add_plan_to_shopping_list,
    async_add_to_shopping_list,
    find_recipe,
)
from .store import RecipeStore
from .timers import TimerManager
from .websocket_api import async_register_websocket_api

type RecipesConfigEntry = ConfigEntry[RecipeStore]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

ASSETS_VERSION_KEY = f"{DOMAIN}_assets_version"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Publish the frontend files as early as possible.

    The dashboard cards are an extra module in Home Assistant's index page, which is
    rendered per request. Registering here, in the integration's own setup rather than
    after its config entry has loaded, shortens the start-up window in which a freshly
    opened page lacks them. The files are served with long cache headers: every URL
    carries a version that changes whenever any of them does.
    """
    frontend_dir = Path(__file__).parent / "frontend"
    # one version for every front-end file: whichever changed last
    version = await hass.async_add_executor_job(
        lambda: max(int(p.stat().st_mtime) for p in frontend_dir.glob("*.js"))
    )
    hass.data[ASSETS_VERSION_KEY] = version
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL, str(frontend_dir), cache_headers=True)]
    )
    add_extra_js_url(hass, f"{FRONTEND_URL}/{CARDS_JS}?v={version}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: RecipesConfigEntry) -> bool:
    """Set up Recipes from a config entry."""
    store = RecipeStore(hass)
    await store.async_load()
    entry.runtime_data = store
    hass.data[DOMAIN] = store
    hass.data[f"{DOMAIN}_entry"] = entry  # who may edit is an option, read when a command arrives

    plan = MealPlan(hass, store)
    await plan.async_load()
    hass.data[f"{DOMAIN}_plan"] = plan

    food_db = await hass.async_add_executor_job(FoodDatabase.load)
    nutrition = Nutrition(hass, store, food_db)
    await nutrition.async_load()
    hass.data[f"{DOMAIN}_nutrition"] = nutrition

    @callback
    def _recipe_deleted(event: Event) -> None:
        plan.detach_recipe(event.data.get("recipe_id", ""))

    entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_recipe_deleted", _recipe_deleted))

    timers = TimerManager(hass, lambda: entry.options)
    await timers.async_load()
    hass.data[f"{DOMAIN}_timers"] = timers
    entry.async_on_unload(timers.async_unload)

    async_register_websocket_api(hass)
    if not hass.data.get(f"{DOMAIN}_view"):
        for view in (
            RecipesImportView(),
            RecipesExportView(),
            RecipesUploadImageView(),
            RecipesImageView(),
            RecipesAlarmView(),
            RecipesLongAlarmView(),
        ):
            hass.http.register_view(view)
        hass.data[f"{DOMAIN}_view"] = True

    images = ImageStore(Path(hass.config.path(DOMAIN, "images")))
    hass.data[f"{DOMAIN}_images"] = images

    async def sweep_images(_now: datetime | None = None) -> None:
        """Remove uploaded photos no recipe uses any more (never anything < 1 h old)."""
        used = {i for r in store.list() if (i := id_from_url(r.get("image", "")))}
        await hass.async_add_executor_job(images.sweep, used)

    entry.async_on_unload(async_track_time_interval(hass, sweep_images, timedelta(hours=1)))
    hass.async_create_task(sweep_images())

    version = hass.data[ASSETS_VERSION_KEY]

    # Register the cards as a dashboard resource, which Home Assistant loads before it
    # builds a dashboard. At start-up Lovelace may not be ready yet, so retry when it is.
    cards_path = f"{FRONTEND_URL}/{CARDS_JS}"

    def _report_cards(registered: bool) -> None:
        """Tell the user, in Repairs, when the cards could not be added as a resource."""
        if registered:
            ir.async_delete_issue(hass, DOMAIN, ISSUE_CARDS_RESOURCE)
            return
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_CARDS_RESOURCE,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_CARDS_RESOURCE,
            translation_placeholders={"url": f"{cards_path}?v={version}", "mode": resource_mode(hass)},
        )

    async def _register_cards(_event: Event | None = None) -> None:
        _report_cards(await async_ensure_resource(hass, cards_path, version))

    if await async_ensure_resource(hass, cards_path, version):
        _report_cards(True)
    else:
        # Lovelace may simply not be ready yet: look again once Home Assistant has started
        entry.async_on_unload(hass.bus.async_listen_once("homeassistant_started", _register_cards))
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{FRONTEND_URL}/recipes-panel.js?v={version}",
        sidebar_title="Recipes",
        sidebar_icon="mdi:chef-hat",
        require_admin=False,
        embed_iframe=False,
    )

    async def import_recipe(call: ServiceCall) -> ServiceResponse:
        try:
            data = await async_import_url(async_get_clientsession(hass), call.data["url"])
        except RecipeImportError as err:
            raise HomeAssistantError(str(err)) from err
        recipe = store.create(data)
        return {"recipe": recipe}

    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT_RECIPE,
        import_recipe,
        schema=vol.Schema({vol.Required("url"): str}),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def add_to_shopping_list(call: ServiceCall) -> ServiceResponse:
        return await async_add_to_shopping_list(hass, store, dict(call.data))

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_TO_SHOPPING_LIST,
        add_to_shopping_list,
        schema=vol.Schema(
            {
                vol.Required("recipe"): str,
                vol.Optional("entity_id", default="todo.shopping_list"): cv.entity_id,
                vol.Optional("scale"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000)),
                vol.Optional("servings"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000)),
                vol.Optional("makes"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=100000)),
                vol.Optional("units", default="grams"): vol.In(["grams", "original"]),
                vol.Optional("ingredients"): [vol.All(int, vol.Range(min=0))],
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def test_timer_sound(call: ServiceCall) -> None:
        if not entry.options.get(CONF_SPEAKERS):
            raise ServiceValidationError(
                "No speakers are configured. Choose them in Settings > Devices & services "
                "> Recipes > Configure."
            )
        await timers.async_play_alarm(words(hass.config.language)["test_timer"], raise_errors=True)

    hass.services.async_register(DOMAIN, SERVICE_TEST_TIMER_SOUND, test_timer_sound)

    async def stop_timer_alarm(call: ServiceCall) -> None:
        timers.stop_alarms()

    hass.services.async_register(DOMAIN, SERVICE_STOP_TIMER_ALARM, stop_timer_alarm)

    async def plan_meal(call: ServiceCall) -> ServiceResponse:
        recipe = find_recipe(store, call.data["recipe"])
        scale = call.data.get("scale")
        if scale is None and (servings := call.data.get("servings")) is not None:
            base = _base_servings(recipe.get("servings"))
            if not base:
                raise ServiceValidationError(f"{recipe['name']} has no numeric servings to scale from")
            scale = servings / base
        try:
            meal = plan.add(
                call.data.get("date") or date.today(),
                call.data["slot"],
                recipe_id=recipe["id"],
                scale=scale,
                note=call.data.get("note", ""),
            )
        except MealPlanError as err:
            raise ServiceValidationError(str(err)) from err
        return {"meal": meal}

    hass.services.async_register(
        DOMAIN,
        SERVICE_PLAN_MEAL,
        plan_meal,
        schema=vol.Schema(
            {
                vol.Required("recipe"): str,
                vol.Optional("date"): cv.date,
                vol.Optional("slot", default="dinner"): str,
                vol.Optional("scale"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1000)),
                vol.Optional("servings"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000)),
                vol.Optional("note"): vol.All(str, vol.Length(max=500)),
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def clear_meal_plan(call: ServiceCall) -> ServiceResponse:
        start = call.data.get("start") or date.today()
        try:
            removed = plan.clear(start, call.data.get("end"), call.data.get("slot"))
        except MealPlanError as err:
            raise ServiceValidationError(str(err)) from err
        return {"removed": removed}

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAR_MEAL_PLAN,
        clear_meal_plan,
        schema=vol.Schema(
            {
                vol.Optional("start"): cv.date,
                vol.Optional("end"): cv.date,
                vol.Optional("slot"): str,
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def plan_to_shopping_list(call: ServiceCall) -> ServiceResponse:
        start = call.data.get("start") or date.today()
        end = start + timedelta(days=int(call.data["days"]) - 1)
        return await async_add_plan_to_shopping_list(
            hass, store, plan.list(start, end), call.data["entity_id"], call.data["units"]
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_PLAN_TO_SHOPPING_LIST,
        plan_to_shopping_list,
        schema=vol.Schema(
            {
                vol.Optional("start"): cv.date,
                vol.Optional("days", default=7): vol.All(int, vol.Range(min=1, max=60)),
                vol.Optional("entity_id", default="todo.shopping_list"): cv.entity_id,
                vol.Optional("units", default="grams"): vol.In(["grams", "original"]),
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def snooze_timer(call: ServiceCall) -> None:
        timers.snooze(int(call.data.get("seconds", DEFAULT_SNOOZE_SECONDS)), call.data.get("timer_id"))

    hass.services.async_register(
        DOMAIN,
        SERVICE_SNOOZE_TIMER,
        snooze_timer,
        schema=vol.Schema(
            {
                vol.Optional("seconds", default=DEFAULT_SNOOZE_SECONDS): vol.All(int, vol.Range(min=10, max=3600)),
                vol.Optional("timer_id"): str,
            }
        ),
    )

    async_setup_intents(hass)
    hass.async_create_task(async_install_sentences(hass))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: RecipesConfigEntry) -> bool:
    """Unload a config entry."""
    from homeassistant.components import frontend

    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    async_remove_intents(hass)
    hass.services.async_remove(DOMAIN, SERVICE_IMPORT_RECIPE)
    hass.services.async_remove(DOMAIN, SERVICE_ADD_TO_SHOPPING_LIST)
    hass.services.async_remove(DOMAIN, SERVICE_TEST_TIMER_SOUND)
    hass.services.async_remove(DOMAIN, SERVICE_STOP_TIMER_ALARM)
    hass.services.async_remove(DOMAIN, SERVICE_SNOOZE_TIMER)
    for service in (SERVICE_PLAN_MEAL, SERVICE_CLEAR_MEAL_PLAN, SERVICE_PLAN_TO_SHOPPING_LIST):
        hass.services.async_remove(DOMAIN, service)
    hass.data.pop(DOMAIN, None)
    hass.data.pop(f"{DOMAIN}_timers", None)
    hass.data.pop(f"{DOMAIN}_plan", None)
    hass.data.pop(f"{DOMAIN}_nutrition", None)
    hass.data.pop(f"{DOMAIN}_entry", None)
    hass.data.pop(f"{DOMAIN}_images", None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: RecipesConfigEntry) -> None:
    """The integration was deleted: take its dashboard resource with it."""
    await async_remove_resource(hass, f"{FRONTEND_URL}/{CARDS_JS}")
    ir.async_delete_issue(hass, DOMAIN, ISSUE_CARDS_RESOURCE)
