"""Recipes: a Mealie-style recipe manager built into Home Assistant."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_interval
import voluptuous as vol

from .const import (
    CONF_SPEAKERS,
    DOMAIN,
    FRONTEND_URL,
    PANEL_ELEMENT,
    PANEL_URL_PATH,
    SERVICE_ADD_TO_SHOPPING_LIST,
    SERVICE_IMPORT_RECIPE,
    SERVICE_STOP_TIMER_ALARM,
    SERVICE_TEST_TIMER_SOUND,
)
from .http_api import (
    RecipesAlarmView,
    RecipesExportView,
    RecipesImageView,
    RecipesImportView,
    RecipesUploadImageView,
)
from .images import ImageStore, id_from_url
from .scraper import RecipeImportError, async_import_url
from .shopping import async_add_to_shopping_list
from .store import RecipeStore
from .timers import TimerManager
from .websocket_api import async_register_websocket_api

type RecipesConfigEntry = ConfigEntry[RecipeStore]


async def async_setup_entry(hass: HomeAssistant, entry: RecipesConfigEntry) -> bool:
    """Set up Recipes from a config entry."""
    store = RecipeStore(hass)
    await store.async_load()
    entry.runtime_data = store
    hass.data[DOMAIN] = store

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

    frontend_dir = Path(__file__).parent / "frontend"
    # Cache-bust the panel module: static files are served without cache headers,
    # so browsers may otherwise keep an old copy after an update.
    mtime = await hass.async_add_executor_job(
        lambda: int((frontend_dir / "recipes-panel.js").stat().st_mtime)
    )
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL, str(frontend_dir), cache_headers=False)]
    )
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{FRONTEND_URL}/recipes-panel.js?v={mtime}",
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
        await timers.async_play_alarm("Test timer", raise_errors=True)

    hass.services.async_register(DOMAIN, SERVICE_TEST_TIMER_SOUND, test_timer_sound)

    async def stop_timer_alarm(call: ServiceCall) -> None:
        timers.stop_alarms()

    hass.services.async_register(DOMAIN, SERVICE_STOP_TIMER_ALARM, stop_timer_alarm)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: RecipesConfigEntry) -> bool:
    """Unload a config entry."""
    from homeassistant.components import frontend

    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.services.async_remove(DOMAIN, SERVICE_IMPORT_RECIPE)
    hass.services.async_remove(DOMAIN, SERVICE_ADD_TO_SHOPPING_LIST)
    hass.services.async_remove(DOMAIN, SERVICE_TEST_TIMER_SOUND)
    hass.services.async_remove(DOMAIN, SERVICE_STOP_TIMER_ALARM)
    hass.data.pop(DOMAIN, None)
    hass.data.pop(f"{DOMAIN}_timers", None)
    hass.data.pop(f"{DOMAIN}_images", None)
    return True
