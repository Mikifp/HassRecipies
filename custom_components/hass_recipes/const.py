"""Constants for the Recipes integration."""

DOMAIN = "hass_recipes"

STORAGE_KEY = f"{DOMAIN}.recipes"
STORAGE_VERSION = 1

PANEL_URL_PATH = "recipes"
PANEL_ELEMENT = "hass-recipes-panel"
CARDS_JS = "recipes-cards.js"
FRONTEND_URL = f"/{DOMAIN}_static"

SERVICE_IMPORT_RECIPE = "import_recipe"

SERVICE_ADD_TO_SHOPPING_LIST = "add_to_shopping_list"

# Events fired on the HA bus, usable as automation triggers.
EVENT_RECIPE_ADDED = f"{DOMAIN}_recipe_added"
EVENT_RECIPE_UPDATED = f"{DOMAIN}_recipe_updated"
EVENT_RECIPE_DELETED = f"{DOMAIN}_recipe_deleted"
EVENT_TIMER_FINISHED = f"{DOMAIN}_timer_finished"
EVENT_COOKING_RECIPE_CHANGED = f"{DOMAIN}_cooking_recipe_changed"

SIGNAL_TIMERS = f"{DOMAIN}_timers_updated"
TIMERS_STORAGE_KEY = f"{DOMAIN}.timers"
CONF_NOTIFY_SERVICE = "notify_service"

CONF_SPEAKERS = "speakers"
CONF_SPEAKER_SOUND = "speaker_sound"
CONF_TTS_ENTITY = "tts_entity"
SOUND_CHIME = "chime"
SOUND_SPEECH = "speech"
SOUND_BOTH = "both"
ALARM_PATH = "/api/hass_recipes/alarm.wav"
SERVICE_TEST_TIMER_SOUND = "test_timer_sound"
CONF_ALARM_REPEAT = "alarm_repeat"
CONF_ALARM_MINUTES = "alarm_minutes"
SERVICE_STOP_TIMER_ALARM = "stop_timer_alarm"

PLATFORMS = ["sensor", "binary_sensor", "button", "select"]
TIMER_UNIQUE_PREFIX = "timer_"
SERVICE_SNOOZE_TIMER = "snooze_timer"
DEFAULT_SNOOZE_SECONDS = 120
