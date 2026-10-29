<p align="center"><img src="custom_components/hass_recipes/brand/icon@2x.png" width="96" alt="Recipes"></p>

# Recipes for Home Assistant

A Mealie-style recipe manager that runs inside Home Assistant as a custom integration with its own sidebar panel.

## Install

**HACS (recommended)** – HACS → three-dot menu → *Custom repositories* → add
`https://github.com/Mikifp/HassRecipies` as an *Integration* → install **Recipes** → restart Home Assistant.

**Manual** – copy `custom_components/hass_recipes` into your Home Assistant `config/custom_components/` folder and restart.

Then go to **Settings → Devices & services → Add integration → Recipes**. The first start installs
`recipe-scrapers`, so Home Assistant needs internet access and may take a minute.

## Features
- Create, edit, delete recipes (ingredients, steps, tags, times, servings, notes, image URL)
- Photos: upload from the editor (resized in the browser, stored in `<config>/hass_recipes/images`, included in HA backups) or paste an image URL
- Layout adapts to the panel's width: on wide screens a filter rail with a card grid and a two-column recipe page; on phones a compact list and an Ingredients / Instructions / Notes tab view with a bottom action bar
- Browser-style navigation: every screen has its own address (`/recipes#/recipe/<id>`), so the mouse back button / Alt+← steps back through the app, reloading keeps your place, and recipes can be bookmarked
- Search by name, tag or ingredient. The browser follows Home Assistant's own list pages: a **Filters** pane (cookbooks, categories, tools, tags with counts), **Group by** category, cookbook, tag or tool with collapsible group headings, sorting, and three views you can switch between: **cards**, **rows** (picture, description and details) and a sortable **list**. Your choices are remembered
- Sections in both ingredients and instructions (`## Dough` in stored ingredients; imported from websites and Mealie where the source has them)
- Notes on ingredients: each ingredient has a note field ("room temperature", "the organic kind") shown under it in the panel and the cards; it is stored as `200 g butter // room temperature` and never affects scaling or the shopping list
- Substitutes: any ingredient can carry any number of alternatives, each with its own amount (stored as `200 g butter || 180 g coconut oil || 2 dl cream`), converted to grams like the main ingredient
- Cook mode shows the whole recipe at once (ingredients beside step cards, current step highlighted, screen kept awake); "One step at a time" switches to a focused view
- Check off steps (and ingredients) while cooking; checks are remembered per recipe for two days, a finished timer completes its step, and finishing every step resets the checks
- In the editor, drag the ⠿ handle to reorder ingredients and steps (↑ ↓ buttons on touch screens), and use **+ Step here** between steps to insert a step or section anywhere
- **Section-card editor**: each section holds its ingredients and its steps together. Ingredients a step uses appear as chips inside the step text (type `@`, press the button on an ingredient while you write, or use the quick-add row under the step); drag ingredients and steps between sections; pasting a list into an ingredient makes one per line
- Steps show the ingredients they name as chips right in the text, with the amount scaled to what you are making, in the recipe page, cook mode and the dashboard cards; ingredients a step uses but does not name stay in the row below it
- Cook mode has **Previous section** / **Next section** buttons for recipes with sections (and jump buttons per section when the whole recipe is shown)
- The recipe page is built from Home Assistant's own cards, lists, expansion panels, check lists and buttons: ingredients on the left with check-off, scaling and an add-to-shopping-list button, the steps beside them with section panels, ingredient chips in the text and timer buttons, and a Cook button in the corner
- Unsaved-changes prompt when you leave the editor
- Yield: say what the ingredients make ("8 pancakes") and the multiplier the recipe opens at (2× = 16 pancakes); type the number you want and everything scales. `makes:` works in the shopping-list service too
- Scale a recipe (½×–4× or any multiplier); linked ingredients scale too
- Steps can link to ingredients and carry any number of countdown timers, each set in hours, minutes and seconds with an optional label ("roast", "rest"); the alarm sounds when each is done and timers survive page reloads. The step counts as done when its last timer finishes
- Import from a URL using `recipe-scrapers` (hundreds of sites) with a built-in JSON-LD/HTML fallback; one URL gets a review step, several URLs (up to 25) import in bulk
- Ingredients are parsed into quantity/unit/food; a Grams view converts weights exactly and volumes by density (≈ = estimate)
- **Nutrition**: calories, protein, fat, carbohydrates and fibre per serving and for the whole recipe, estimated from the Danish Food Composition Database (Frida) and your own custom ingredients (see [Nutrition](#nutrition))
- Units are understood in Danish, Swedish, Norwegian, German, Dutch, French, Spanish and Italian as well as English (for example `2 tsk`, `1 spsk`, `2 fed hvidløg`, `2 stk løg`, `3 dl`, `1 EL`, `1 Prise`, `2 cucharadas de azúcar`), including a link word such as *de* or *di*. Weights and volumes convert to grams for English and Danish food names; in other languages the amount is still scaled and converted to ml
- Categories, tools and tags, with multi-select filters on the list page
- Cookbooks: save any combination of category/tool/tag filters + search as a named view
- Bulk actions: select many recipes to add/remove a category, tag or tool, or delete
- Deleted recipes go to a trash for 30 days: press **Undo** in the notice that follows a delete, or open **⇅ Backup & migrate → Recently deleted** to restore one or empty the trash
- Choose who may edit: by default everyone who can open the panel can; in **Configure** set **Who can change recipes** to *Administrators only* and everyone else gets a read-only panel: they can browse, cook and use timers, but cannot edit recipes or the meal plan. The same rule is enforced on the server
- Cook mode: one big step at a time, linked ingredients, step timers, screen kept awake (arrow keys to navigate)
- `hass_recipes.import_recipe` service for automations
- Data lives in HA storage (`.storage/hass_recipes.recipes`) so it is included in HA backups

## Nutrition

The recipe page shows an estimate of energy, protein, fat, carbohydrates and dietary fibre per serving (from the first number in *Servings*) and for the whole recipe; the **Check ingredients** page adds sugars, saturated fat and salt.

- Each ingredient line is converted to grams by the ingredient parser, then matched to a food in the bundled **Frida** dataset (and, for foods Frida does not have, the English **USDA Foundation Foods**) (about 1,400 Danish foods with lab-analysed values per 100 g). Everyday words ("æg", "mælk", "hakkede tomater", "butter"…) have a standard choice; other names are matched by search, and a clear hit is used but marked *Matched automatically* so you can confirm it.
- On **Check ingredients** you can choose another food, mark a line as *Don't count* (water, salt to taste), or give the weight of a unit the parser cannot weigh ("1 dåse = 400 g"). Choices are remembered by ingredient name and apply to every recipe.
- **Custom ingredients**: add your own food with values per 100 g (from the label, or for something homemade). A custom ingredient named exactly like an ingredient line is used for it automatically. Custom ingredients and choices are included in the backup export.
- Lines without a match or a weight are listed instead of guessed, so the total only counts what is known. Treat the numbers as an estimate.

### Foods

The **Foods** tab is your own list of what an ingredient line can be ("smør", "hakkede tomater"). A food has a name, other names it goes by ("butter"), what one unit of it weighs ("1 dl = 95 g", "1 dåse = 400 g"), a shop section, and its nutrition: a Frida food, your own values, or none.

- **Needs review** lists the ingredient names in your recipes that are not a food yet, with a suggestion: a *standard choice* for everyday words or the *best guess* by its words. **Accept suggestion** makes a food of it (and **Accept N standard choices** does all the standard ones at once); **Create food** starts a food from the name; **Link to a food** makes the name another name of a food you have; **Don't count** leaves it out of the nutrition.
- Click a food to edit it: change its names, weights and nutrition, see the recipes that use it, **merge** it into another food (its names and weights come along), or delete it. A weight written on an ingredient line, like "1 dåse (240 g)", always wins over the food's weight.
- A recipe's **Ingredients and foods** page (from its Nutrition card) shows every ingredient line with the food it is linked to and how: *Linked automatically*, *Confirmed*, or a standard choice or best guess you can **Accept**. **Change** links the line to one of your foods or to a Frida food (which becomes one of your foods), **Create food** starts a new food from the name, **Edit food** opens it on the Foods page, and a banner counts the lines that are not linked yet.
- When a recipe is saved or imported, the names that have a *standard choice* (everyday words like "æg" and "smør") are made foods automatically. A best guess is left for you to review.
- Foods that were made by choosing a food on a recipe's **Check ingredients** page, and the choices and custom ingredients of the version before the Foods tab, appear here too. Foods and their names are part of the backup export.

Nutrition data: © The Danish Food Composition Database (https://frida.fooddata.dk), version 6.1, May 2026, DTU Food Institute, published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled file `data/frida.json` is a reduced extract (8 nutrients). To update it to a new Frida release, download the dataset from [DTU Data](https://doi.org/10.11583/DTU.32312844) and run `python dev/frida_convert.py FCDB_<version>_Dataset.xlsx <version> "<month year>"`.

The **USDA Foundation Foods** (about 370 generic foods, English names) are from FoodData Central: U.S. Department of Agriculture, Agricultural Research Service, https://fdc.nal.usda.gov, public domain ([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)). `data/usda.json` is a reduced extract built by `dev/usda_convert.py`; a Frida food wins where both have a clear match, so USDA fills the gaps ("hummus", "tortilla") and is there to search and choose.

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
- **Categories, tools and tags** open a checklist of the values already in use, as in Mealie: tick the ones that apply, type to filter, and press Enter or **＋ Create** to add a new one. Typing an existing value in another case reuses its spelling. The bulk-edit bar suggests the same values.
- **Migrate from a running Mealie** reads every recipe through Mealie's API using an API token (Mealie → profile → API tokens). Needs a Home Assistant administrator. The token is not stored. Step-to-ingredient links are preserved, and photos are downloaded and stored locally, so Mealie can be shut down afterwards. File imports (Mealie zips, Paprika) bring their photos too, and exports embed uploaded photos.

## Languages

The interface follows the language Home Assistant is set to. **English** and **Danish** are complete: the panel, the dashboard cards and their editors, entity and device names, services and settings, Assist sentences and answers, and the timer alert (spoken and notification). Timer labels ("Pancakes · trin 2"), the meal names in the calendar and the spoken alert are also available in German, Swedish, Norwegian, Dutch, French, Spanish and Italian, and ingredient units are understood in all of those languages. Anything without a translation stays English.

To add a language: the panel's strings are in `frontend/recipes-i18n.js` (one table per language), the cards' in `frontend/recipes-cards.js`, entity and service names in `translations/<language>.json`, voice sentences in `sentences/<language>.yaml` and the answers in `intents.py`, and the words the integration builds in `localize.py`.

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
- **Repeat until stopped** keeps the alert going every few seconds until you press **Stop** on the timer in the panel, tap the speaker or tell it to stop (see below), or call `hass_recipes.stop_timer_alarm`, e.g. from a button or voice command. **Stop automatically after** is a safety limit (default 5 minutes).
- **Stopping from the speaker**: on a Google Nest / Chromecast speaker, tapping it or saying "Hey Google, stop" while the alarm is sounding silences it and clears the finished timer. The chime alone is played as a 20 second alarm (the chime five times over), so there is nearly always something playing to stop; players that do not report their position are handled too. Saying stop in the short quiet moment between repeats has nothing to stop, so say it while the alarm is playing. With speech, the short chime and the spoken name are used, and a stop is noticed while the speaker reports its position.
- Use the `hass_recipes.test_timer_sound` service (Developer tools → Actions) to check the setup.

**Entities for dashboards.** Every timer that is running gets its own sensor (for example `sensor.pancakes_step_2`) whose state is the moment it ends, so cards show a live countdown. The sensor disappears when the timer is dismissed. Attributes: `label`, `finished`, `recipe_id`, `recipe_name`, `step`. Two fixed entities sit beside them: `binary_sensor.recipe_timers_timer_alarm` is on while a finished timer has not been dismissed, and `button.recipe_timers_stop_timer_alarm` stops the alarm. All belong to the **Recipe timers** device.

```yaml
type: entities
entities:
  - entity: sensor.pancakes_step_2
    format: relative        # shows "in 4 minutes"
  - button.recipe_timers_stop_timer_alarm
```

**Dashboard cards.** The custom cards are registered as a dashboard resource by the integration (Settings → Dashboards → ⋮ → Resources shows `/hass_recipes_static/recipes-cards.js?v=…`, kept up to date on every update), so they are available on every dashboard: add them from the card picker, or in YAML. If your dashboard resources are defined in YAML (`lovelace: resources:`) the integration cannot edit them; add `url: /hass_recipes_static/recipes-cards.js` with `type: module` there yourself. Removing the integration removes the resource.

```yaml
type: custom:hass-recipes-list-card      # search and open recipes
title: Recipes
limit: 20                                # optional: list_height, category / tag filter, show_search: false
---
type: custom:hass-recipes-cooking-card   # live timers, with a Stop alarm button
title: Now cooking
---
type: custom:hass-recipes-cook-card      # one recipe, one step at a time
recipe: Lasagne                          # optional: name or id
---
type: custom:hass-recipes-kitchen-card   # a mini app: pick a recipe, then cook it
limit: 20                                # optional: layout, show: all | list | steps, list_height, category / tag filter
```

The **kitchen** card is a small app made of the list and cook cards. It opens on the recipe list; tap a recipe and the list gives way to cook mode, with a **Recipes** button to go back (and a button in the list to resume the recipe you were cooking). Picking a recipe is the same choice as the panel's Dashboard button, so every card follows; the open icon on a row reads it in the Recipes panel. Running timers show on both screens.

**Cooking options** (cook and kitchen cards, also in the visual editor):
`text_size: normal | large | xlarge` for reading from across the counter, `swipe: true` (the default) to swipe left and right between steps, `section_buttons: true` to add **Previous section** / **Next section** buttons above Back and Next (they show the section's name and need a recipe with two or more sections), and `keep_awake: true` to stop the screen switching off while the card is showing. Ingredients and steps can be ticked off; the ticks are the same ones the Recipes panel keeps, so both agree on that device. The cards follow the language Home Assistant is set to (English and Danish).

**Sizing.** In a sections dashboard the cards follow `grid_options` (resize them in the dashboard editor, or set `columns` / `rows`): a card with a set height fills it, and the recipe list and the step text scroll inside it. Without a set height the list stops at `list_height` pixels and the step text at `content_height` (default 480, 0 for no limit) and scrolls beyond that.

Set `layout` to show the recipe and the list at the same time: `layout: vertical` puts the recipe above the list, `layout: horizontal` puts the list beside the recipe; on a phone-width card (under about 560 px) it becomes the mini app instead, with a **Recipes** button to go back to the browser. The default, `app`, is the mini app described above.

To use only part of the card, set `show: list` (just the recipe list, which still picks the recipe the other cards follow) or `show: steps` (just the ingredients and steps, no list and no back button). Long lists scroll inside the card: `list_height` sets the height in pixels (default 360 for the list card and 320 for the kitchen card, 0 for no scrolling), and `limit` how many recipes are loaded into it (default 20).

Without `recipe`, the cook card shows the recipe you chose in the Recipes panel (open a recipe and press **Show on dashboard cook card**), and changes as soon as you pick another one. On the ingredients page you can change how much it makes or serves; amounts scale everywhere in the card (option `units: original` keeps amounts as written instead of grams). It remembers its step and amount in the browser, starts the step's timer, and lists every running timer under the step; those timers also show in the cooking card and as timer entities.

**Cooking state, entities and voice.** The recipe being cooked, the page you are on and the scale are shared by every card, the panel and Assist, so tapping *Next* on a tablet moves a wall display too. They are exposed as:

- `select.recipe_timers_cooking_recipe`: choose the recipe from an automation or any dashboard
- `sensor.recipe_timers_cooking`: the recipe name, with `step_number`, `steps`, `step_text`, `step_timer_seconds`, `scale` and more as attributes
- `button.recipe_timers_next_step` and `button.recipe_timers_previous_step`
- `hass_recipes.snooze_timer` (and a **+2 min** button on finished timers in the cards) gives a finished timer more time

**Assist.** The integration installs sentences for English and Danish into `custom_sentences/` (and reloads Assist). Say things like "next step", "previous step", "repeat the step", "read the ingredients", "how much time is left" or "start the step timer" (Danish: "næste trin", "gentag trinnet", "læs ingredienserne op", "hvor lang tid er der tilbage"). Ingredients are read at the current scale.

**Meal plan.** Open **Meal plan** in the Recipes panel for a week view: press **+** on a day and meal (breakfast, lunch, dinner, dessert, snack, or your own: **Edit the meals of the day** in the ⋮ menu lets you rename them, add more, set their colour and time in the calendar, and choose which recipe categories belong to each, so a recipe in "Aftensmad" lands in dinner when you drop it on a day) to pick a recipe or type a plain meal such as "Leftovers", set a scale per meal, press the pan to start cooking it, and use **Add week to shopping list** to send that week's ingredients to your to-do list (items already on the list are skipped, and the same ingredient across several meals is added up, so 200 g flour in one meal and 500 g in two others becomes one line of 1.2 kg). On a recipe page, **Add to meal plan** lets you pick the day. **Copy last week** repeats last week's meals on this week (meals already there are not added twice), and on a computer you can drag a meal to another day or meal to move it. The plan is also available as:

- `calendar.recipe_timers_meal_plan`: meals show in the calendar dashboard at the time of their meal (by default 07:30 breakfast, 12:00 lunch, 15:00 snack, 18:00 dinner and 19:30 dessert), and work with calendar triggers in automations
- `hass_recipes.plan_meal` (`recipe`, `date`, `slot`, `scale` or `servings`, `note`), `hass_recipes.clear_meal_plan` and `hass_recipes.add_plan_to_shopping_list` (`start`, `days`, `entity_id`)
- the `custom:hass-recipes-plan-card` dashboard card (`days`, `slots`, `show_empty`, `tap: cook | open`, `list_height`), which starts cooking a planned recipe when you tap it, so the cook and kitchen cards follow
- Assist: "what's for dinner [tomorrow]", "cook dinner" (English) and "hvad skal vi have til aftensmad [i morgen]", "lav aftensmad" (Danish)

When a recipe is deleted its planned meals stay on the plan as plain text.

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

## Troubleshooting

- **The dashboard cards do not show up.** The integration registers the cards as a dashboard resource. If it could not (for example because your dashboards are configured in YAML), a **Repair** appears under Settings → System → Repairs with the line to add yourself.
- **Diagnostics.** Settings → Devices & services → Recipes → ⋮ → *Download diagnostics* gives a file with counts, the language, the card resource state and the options (speaker and notify names are redacted) to attach to an issue.

## Development

```bash
docker compose up                         # Home Assistant on http://localhost:8123 with the integration mounted
python -m pytest tests                    # back end
node --test tests/js/*.test.mjs                     # front-end helpers and translations
```

CI runs both test suites, a syntax check of the front-end, hassfest and the HACS validation on every pull request.

- `custom_components/hass_recipes/` – integration (store, websocket API, scraper, nutrition, config flow, diagnostics, repairs); `data/frida.json` and `data/usda.json` are the bundled food data, built by `dev/frida_convert.py` and `dev/usda_convert.py`
- `custom_components/hass_recipes/frontend/` – dependency-free front-end, no build step: `recipes-panel.js` is the panel shell, split into `panel-*.js` modules (browse, recipe, nutrition, form, editor, plan, progress, timers, data); `recipes-cards.js` the dashboard cards; `recipes-shared.js` and `recipes-i18n.js` are used by both
- `custom_components/hass_recipes/brand/` – icon and logo
- `tests/` – back-end tests, and `tests/js/` front-end tests

## License

MIT, see [LICENSE](LICENSE). The bundled nutrition data (`custom_components/hass_recipes/data/frida.json`) is from the Danish Food Composition Database, © DTU Food Institute, and is licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
