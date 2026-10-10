"""Config flow for Recipes."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
import voluptuous as vol

from .const import CONF_NOTIFY_SERVICE, DOMAIN


class RecipesConfigFlow(ConfigFlow, domain=DOMAIN):
    """One-click setup; there is nothing to configure."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return RecipesOptionsFlow()

    async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Recipes", data={})
        return self.async_show_form(step_id="user")


class RecipesOptionsFlow(OptionsFlow):
    """Pick a notify service to call when a timer finishes."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        registry = self.hass.services
        notify_services = (
            registry.async_services_for_domain("notify")
            if hasattr(registry, "async_services_for_domain")
            else registry.async_services().get("notify", {})
        )
        services = sorted(notify_services)
        current = self.config_entry.options.get(CONF_NOTIFY_SERVICE)
        if current and current not in services:
            services.append(current)
        options = [SelectOptionDict(value=name, label=f"notify.{name}") for name in services]
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_NOTIFY_SERVICE, description={"suggested_value": current}
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=options, mode=SelectSelectorMode.DROPDOWN, custom_value=True
                    )
                )
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
