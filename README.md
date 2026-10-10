# Recipes for Home Assistant

A Mealie-style recipe manager that runs inside Home Assistant as a custom integration with its own sidebar panel.

## Install

**HACS (recommended)** – HACS → three-dot menu → *Custom repositories* → add
`https://github.com/Mikifp/HassRecipies` as an *Integration* → install **Recipes** → restart Home Assistant.

**Manual** – copy `custom_components/hass_recipes` into your Home Assistant `config/custom_components/` folder and restart.

Then go to **Settings → Devices & services → Add integration → Recipes**. The first start installs
`recipe-scrapers`, so Home Assistant needs internet access and may take a minute.

## Features (v0.1)
- Create, edit, delete recipes (ingredients, steps, tags, times, servings, notes, image URL)
- Photos: upload from the editor (resized in the browser, stored in `<config>/hass_recipes/images`, included in HA backups) or paste an image URL
- Layout adapts to the panel's width: on wide screens a filter rail with a card grid and a two-column recipe page; on phones a compact list and an Ingredients / Instructions / Notes tab view with a bottom action bar
- Browser-style navigation: every screen has its own address (`/recipes#/recipe/<id>`), so the mouse back button / Alt+← steps back through the app, reloading keeps your place, and recipes can be bookmarked
- Search by name, tag or ingredient; filter by tag
- Sections in both ingredients and instructions (`## Dough` in stored ingredients; imported from websites and Mealie where the source has them)
- Substitutes: any ingredient can carry an alternative with its own amount (stored as `200 g butter || 180 g coconut oil`), converted to grams like the main ingredient
- Cook mode shows the whole recipe at once (ingredients beside step cards, current step highlighted, screen kept awake); "One step at a time" switches to a focused view
- Check off steps (and ingredients) while cooking; checks are remembered per recipe for two days, a finished timer completes its step, and finishing every step resets the checks
- Unsaved-changes prompt when you leave the editor
- Yield: say what the ingredients make ("8 pancakes") and the multiplier the recipe opens at (2× = 16 pancakes); type the number you want and everything scales. `makes:` works in the shopping-list service too
- Scale a recipe (½×–4× or any multiplier); linked ingredients scale too
- Steps can link to ingredients and carry a countdown timer (alarm sounds when done; timers survive page reloads)
- Import from a URL using `recipe-scrapers` (hundreds of sites) with a built-in JSON-LD/HTML fallback; one URL gets a review step, several URLs (up to 25) import in bulk
- Ingredients are parsed into quantity/unit/food; a Grams view converts weights exactly and volumes by density (≈ = estimate)
- Categories, tools and tags, with multi-select filters on the list page
- Cookbooks: save any combination of category/tool/tag filters + search as a named view
- Bulk actions: select many recipes to add/remove a category, tag or tool, or delete
- Cook mode: one big step at a time, linked ingredients, step timers, screen kept awake (arrow keys to navigate)
- Print view (opens a clean printable page at the current scale and units)
- `hass_recipes.import_recipe` service for automations
- Data lives in HA storage (`.storage/hass_recipes.recipes`) so it is included in HA backups

## Try it
```bash
docker compose up        # then open http://localhost:8123 and finish onboarding
```
Add the integration: Settings → Devices & services → Add integration → **Recipes**. A "Recipes" entry appears in the sidebar.

To install in an existing HA, copy `custom_components/hass_recipes` into its `config/custom_components/` and restart.

## Backup, export and migration

Open **⇅ Backup & migrate** on the recipe list.

- **Export** downloads one JSON file with every recipe and cookbook.
- **Import a file** accepts a Recipes export, a **Mealie** recipe JSON or export zip, a **Paprika** `.paprikarecipes` archive, or schema.org recipe JSON. Existing recipes (same name and source URL) are skipped, so re-importing is safe.
- **Migrate from a running Mealie** reads every recipe through Mealie's API using an API token (Mealie → profile → API tokens). Needs a Home Assistant administrator. The token is not stored. Step-to-ingredient links are preserved, and photos are downloaded and stored locally, so Mealie can be shut down afterwards. File imports (Mealie zips, Paprika) bring their photos too, and exports embed uploaded photos.

## Home Assistant integration

**Shopping list** – the recipe page has a 🛒 button that adds the (scaled, unit-converted) ingredients to any HA to-do list, skipping items already on it. The same thing is available to automations and voice:

```yaml
action: hass_recipes.add_to_shopping_list
data:
  recipe: Pancakes          # name or id
  entity_id: todo.shopping_list
  servings: 8               # or: scale: 2
  units: grams              # or: original
```

**Timers** run on the server, so they are shared between devices, survive restarts and keep going with no browser open. When one finishes, `hass_recipes_timer_finished` fires (data: `label`, `recipe_id`, `recipe_name`, `step`, `timer_id`). To be alerted without writing an automation, open **Settings → Devices & services → Recipes → Configure**:

- **Notify service** – push to your phone.
- **Speakers** – one or more `media_player` entities. **Sound on speakers** is a chime, the timer's name spoken through a text-to-speech engine, or both. The chime is a small file served from Home Assistant, so the speakers must be able to reach your **internal URL** (Settings → System → Network); `localhost` will not work.
- **Repeat until stopped** keeps the alert going every few seconds until you press **Stop** on the timer in the panel (or call `hass_recipes.stop_timer_alarm`, e.g. from a button or voice command). **Stop automatically after** is a safety limit (default 5 minutes).
- Use the `hass_recipes.test_timer_sound` service (Developer tools → Actions) to check the setup.

**Events** for automations: `hass_recipes_recipe_added`, `hass_recipes_recipe_updated`, `hass_recipes_recipe_deleted` (data: `recipe_id`, `name`, `categories`, `tags`).

```yaml
triggers:
  - trigger: event
    event_type: hass_recipes_timer_finished
actions:
  - action: tts.speak
    target: { entity_id: tts.home_assistant_cloud }
    data: { media_player_entity_id: media_player.kitchen, message: "{{ trigger.event.data.label }} is done" }
```

## Layout
- `custom_components/hass_recipes/` – integration (store, websocket API, scraper, config flow)
- `custom_components/hass_recipes/frontend/recipes-panel.js` – dependency-free panel (no build step)
- `tests/` – scraper tests

## Roadmap ideas
Meal plan as a `calendar` entity, ingredients → HA todo/shopping list, image upload, servings scaling, ratings.

## License

MIT, see [LICENSE](LICENSE).
