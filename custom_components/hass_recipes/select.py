"""The recipe being cooked, as a select entity (shared by every cook card and voice command)."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    EVENT_COOKING_RECIPE_CHANGED,
)
from .entity import DEVICE_INFO
from .store import RecipeStore

_STORE_EVENTS = (
    f"{DOMAIN}_recipe_added",
    f"{DOMAIN}_recipe_updated",
    f"{DOMAIN}_recipe_deleted",
    EVENT_COOKING_RECIPE_CHANGED,
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([CookingRecipeSelect(hass.data[DOMAIN])])


class CookingRecipeSelect(SelectEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_translation_key = "cooking_recipe"
    _attr_icon = "mdi:chef-hat"
    _attr_unique_id = f"{DOMAIN}_cooking_recipe"
    _attr_device_info = DEVICE_INFO

    def __init__(self, store: RecipeStore) -> None:
        self._store = store

    def _labels(self) -> dict[str, str]:
        """recipe id -> option label; duplicate names get a short suffix so options stay unique."""
        recipes = self._store.list()
        names = [r["name"] for r in recipes]
        return {
            r["id"]: r["name"] if names.count(r["name"]) == 1 else f"{r['name']} ({r['id'][:4]})"
            for r in recipes
        }

    @property
    def options(self) -> list[str]:
        return list(self._labels().values())

    @property
    def current_option(self) -> str | None:
        chosen = self._store.cooking_recipe_id
        return self._labels().get(chosen) if chosen else None

    async def async_select_option(self, option: str) -> None:
        for recipe_id, label in self._labels().items():
            if label == option:
                self._store.set_cooking(recipe_id)
                return

    async def async_added_to_hass(self) -> None:
        @callback
        def _changed(_event) -> None:
            self.async_write_ha_state()

        for event in _STORE_EVENTS:
            self.async_on_remove(self.hass.bus.async_listen(event, _changed))
