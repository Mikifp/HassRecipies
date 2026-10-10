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
    EntitySelector,
    EntitySelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
import voluptuous as vol

from .const import (
    CONF_NOTIFY_SERVICE,
    CONF_SPEAKER_SOUND,
    CONF_SPEAKERS,
    CONF_TTS_ENTITY,
    DOMAIN,
    SOUND_BOTH,
    SOUND_CHIME,
    SOUND_SPEECH,
)


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
    """Where to be told that a timer has finished."""

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
        schema = vol.Schema(
            {
                vol.Optional(CONF_NOTIFY_SERVICE): SelectSelector(
                    SelectSelectorConfig(
                        options=[SelectOptionDict(value=n, label=f"notify.{n}") for n in services],
                        mode=SelectSelectorMode.DROPDOWN,
                        custom_value=True,
                    )
                ),
                vol.Optional(CONF_SPEAKERS): EntitySelector(
                    EntitySelectorConfig(domain="media_player", multiple=True)
                ),
                vol.Optional(CONF_SPEAKER_SOUND, default=SOUND_CHIME): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(value=SOUND_CHIME, label="Chime"),
                            SelectOptionDict(value=SOUND_SPEECH, label="Spoken message"),
                            SelectOptionDict(value=SOUND_BOTH, label="Chime, then spoken message"),
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(CONF_TTS_ENTITY): EntitySelector(EntitySelectorConfig(domain="tts")),
            }
        )
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, dict(self.config_entry.options)),
        )
