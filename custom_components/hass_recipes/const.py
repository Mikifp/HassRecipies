"""Constants for the Recipes integration."""

DOMAIN = "hass_recipes"

STORAGE_KEY = f"{DOMAIN}.recipes"
STORAGE_VERSION = 1

PANEL_URL_PATH = "recipes"
PANEL_ELEMENT = "hass-recipes-panel"
FRONTEND_URL = f"/{DOMAIN}_static"

SERVICE_IMPORT_RECIPE = "import_recipe"

SERVICE_ADD_TO_SHOPPING_LIST = "add_to_shopping_list"

# Events fired on the HA bus, usable as automation triggers.
EVENT_RECIPE_ADDED = f"{DOMAIN}_recipe_added"
EVENT_RECIPE_UPDATED = f"{DOMAIN}_recipe_updated"
EVENT_RECIPE_DELETED = f"{DOMAIN}_recipe_deleted"
EVENT_TIMER_FINISHED = f"{DOMAIN}_timer_finished"

SIGNAL_TIMERS = f"{DOMAIN}_timers_updated"
TIMERS_STORAGE_KEY = f"{DOMAIN}.timers"
CONF_NOTIFY_SERVICE = "notify_service"
