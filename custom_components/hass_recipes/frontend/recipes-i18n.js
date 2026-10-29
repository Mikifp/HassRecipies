/* Translation of the Recipes panel.
 *
 * The panel's templates are written in English. Instead of threading a translation call
 * through every template, the strings people read are translated where they land:
 * `observeTranslations` rewrites the text nodes and the title / placeholder / aria-label
 * attributes of the panel as they are rendered, and `translate` is used for the few
 * messages built in code (confirmations, notices). A table maps an exact English string
 * to the other language; patterns cover strings that carry a number or a name.
 * A language without a table, and any string without an entry, stays English.
 *
 * To add a language: add a table under TABLES with the same shape as `da`.
 */

const da = {
  exact: {
    "Cook mode": "Madlavningstilstand",
    "Create new recipe": "Opret ny opskrift",
    "Start with an empty recipe from scratch": "Start med en tom opskrift",
    "Import from a URL": "Importér fra en URL",
    "Fetch a recipe from a web page": "Hent en opskrift fra en hjemmeside",
    "Filters": "Filtre",
    "Cards": "Kort",
    "Rows": "Rækker",
    "Sort direction": "Sorteringsretning",
    "No grouping": "Ingen gruppering",
    "Group by category": "Gruppér efter kategori",
    "Group by cookbook": "Gruppér efter kogebog",
    "Group by tag": "Gruppér efter tag",
    "Group by tool": "Gruppér efter redskab",
    "Sort by name": "Sortér efter navn",
    "Sort by last changed": "Sortér efter senest ændret",
    "Sort by time": "Sortér efter tid",
    "Sort by servings": "Sortér efter portioner",
    "No category": "Ingen kategori",
    "No tools": "Ingen redskaber",
    "No tags": "Ingen tags",
    "No cookbook": "Ingen kogebog",
    "Time": "Tid",
    "Save current filters as cookbook": "Gem nuværende filtre som kogebog",
    "Backup & migrate": "Backup og migrering",
    "Group by": "Gruppér efter",
    "Sort by": "Sortér efter",
    // browsing
    Recipes: "Opskrifter",
    Categories: "Kategorier",
    Category: "Kategori",
    Tags: "Tags",
    Tag: "Tag",
    Tools: "Redskaber",
    Tool: "Redskab",
    Cookbooks: "Kogebøger",
    All: "Alle",
    "All recipes": "Alle opskrifter",
    New: "Ny",
    "New recipe": "Ny opskrift",
    "Search recipes": "Søg i opskrifter",
    "Search recipes, tags, ingredients…": "Søg i opskrifter, tags, ingredienser…",
    "Import URL": "Importér fra URL",
    Select: "Vælg",
    "Done selecting": "Færdig med at vælge",
    "Export, import files, migrate from Mealie": "Eksportér, importér filer, flyt fra Mealie",
    "⇅ Backup & migrate": "⇅ Backup og flytning",
    "More actions": "Flere handlinger",
    "More filters": "Flere filtre",
    "📖 Save current filters as cookbook": "📖 Gem de nuværende filtre som kogebog",
    "Save filters to this cookbook": "Gem filtre i denne kogebog",
    "Delete cookbook": "Slet kogebog",
    "No recipes match.": "Ingen opskrifter matcher.",
    "No recipes yet. Create one or import from a URL.": "Ingen opskrifter endnu. Opret en eller importér fra en URL.",
    "Loading…": "Henter…",
    Menu: "Menu",
    value: "værdi",
    Clear: "Ryd",
    Delete: "Slet",
    Add: "Tilføj",
    Remove: "Fjern",
    Save: "Gem",
    Cancel: "Annullér",
    Back: "Tilbage",
    "← Back": "← Tilbage",
    Done: "Færdig",
    // recipe page
    Cook: "Lav mad",
    Shop: "Køb ind",
    Dashboard: "Dashboard",
    "Add to the step you are writing": "Føj til det trin du skriver",
    "Link the ingredients this step names": "Knyt de ingredienser trinnet nævner",
    "Link the ingredients the steps name": "Knyt de ingredienser trinnene nævner",
    "Previous section": "Forrige sektion",
    "Next section": "Næste sektion",
    "New editor (beta)": "Ny editor (beta)",
    "Classic editor": "Klassisk editor",
    "Details: photo, times, servings, tags": "Detaljer: foto, tider, portioner, tags",
    "Section title (optional)": "Sektionens titel (valgfri)",
    "New section": "Ny sektion",
    "Add ingredient": "Tilføj ingrediens",
    "Add step": "Tilføj trin",
    "Add section": "Tilføj sektion",
    Steps: "Trin",
    "Ingredient, e.g. 200 g butter": "Ingrediens, fx 200 g smør",
    Note: "Note",
    "Describe what to do. Type @ to add an ingredient. Shift+Enter for a new line.": "Beskriv hvad der skal ske. Skriv @ for at tilføje en ingrediens. Shift+Enter for ny linje.",
    "Add substitute": "Tilføj erstatning",
    "Delete ingredient": "Slet ingrediens",
    "Delete step": "Slet trin",
    "Delete section": "Slet sektion",
    "Add timer": "Tilføj timer",
    "Insert step above": "Indsæt trin over",
    "Insert step below": "Indsæt trin under",
    Link: "Knyt",
    "New ingredient": "Ny ingrediens",
    "Delete this section and everything in it?": "Slet denne sektion og alt i den?",
    "Drag to reorder": "Træk for at ændre rækkefølge",
    "+ Step here": "+ Trin her",
    "+ Section here": "+ Sektion her",
    "Note, e.g. room temperature": "Note, fx stuetemperatur",
    Edit: "Redigér",
    "Delete recipe": "Slet opskrift",
    "Add to meal plan": "Føj til madplanen",
    "↺ Clear checks": "↺ Ryd markeringer",
    "Show this recipe on the dashboard cook card": "Vis denne opskrift på dashboardets madlavningskort",
    "Shown on the dashboard cook card. Press to remove.": "Vises på dashboardets madlavningskort. Tryk for at fjerne.",
    "Source:": "Kilde:",
    Prep: "Forberedelse",
    Total: "I alt",
    Makes: "Giver",
    Serves: "Portioner",
    Scale: "Skala",
    Yield: "Udbytte",
    Ingredients: "Ingredienser",
    Instructions: "Fremgangsmåde",
    Notes: "Noter",
    "As written": "Som skrevet",
    Less: "Mindre",
    More: "Mere",
    "Type how much you want": "Skriv hvor meget du vil have",
    "Back to recipe": "Tilbage til opskriften",
    "Tap to mark as done": "Tryk for at markere som færdig",
    "Mark as not done": "Markér som ikke færdig",
    "Section": "Sektion",
    // cooking
    Exit: "Afslut",
    "Exit cook mode": "Afslut madlavning",
    "One step at a time": "Ét trin ad gangen",
    "Show one step at a time": "Vis ét trin ad gangen",
    "Show all steps": "Vis alle trin",
    "All ingredients": "Alle ingredienser",
    "Mark this step as done": "Markér dette trin som færdigt",
    "Next →": "Næste →",
    "← Previous": "← Forrige",
    "Finish ✓": "Færdig ✓",
    "Timer running": "Timer kører",
    "This recipe has no steps yet.": "Denne opskrift har ingen trin endnu.",
    "Cook this": "Lav denne",
    // shopping
    "Shopping list": "Indkøbsliste",
    List: "Liste",
    "Add to shopping list": "Føj til indkøbslisten",
    "Shopping list updated": "Indkøbslisten er opdateret",
    Added: "Tilføjet",
    "No to-do lists were found in Home Assistant. Add the": "Der blev ikke fundet nogen opgavelister i Home Assistant. Tilføj",
    "integration (or any to-do integration) first.": "-integrationen (eller en anden opgaveintegration) først.",
    // edit form
    "Edit recipe": "Redigér opskrift",
    Name: "Navn",
    Description: "Beskrivelse",
    Photo: "Foto",
    "Image URL, or upload a photo": "Billed-URL, eller upload et foto",
    "📷 Upload photo": "📷 Upload foto",
    "Upload photo": "Upload foto",
    "Uploading…": "Uploader…",
    "Name is required.": "Navn skal udfyldes.",
    "Unit, e.g. pancakes, cookies, buns": "Enhed, fx pandekager, kager, boller",
    "Open the recipe at (× the written amounts)": "Åbn opskriften ved (× de skrevne mængder)",
    "Expand or collapse": "Fold ud eller sammen",
    "The ingredients make": "Ingredienserne giver",
    "pancakes, cookies, buns…": "pandekager, småkager, boller…",
    "Open the recipe at": "Åbn opskriften med",
    "× the written amounts": "× de angivne mængder",
    Servings: "Portioner",
    "Prep (min)": "Forberedelse (min)",
    "Cook (min)": "Tilberedning (min)",
    "Total (min)": "I alt (min)",
    "Source URL": "Kilde-URL",
    "+ Add ingredient": "+ Tilføj ingrediens",
    "+ Add section": "+ Tilføj sektion",
    "+ Add step": "+ Tilføj trin",
    "Enter adds a row below. Pasting a list splits it into one ingredient per line.":
      "Enter tilføjer en række nedenfor. Indsætter du en liste, bliver den delt i én ingrediens pr. linje.",
    "+ substitute": "+ erstatning",
    "+ another substitute": "+ endnu en erstatning",
    "+ timer": "+ timer",
    "+ another timer": "+ endnu en timer",
    "Timers (optional)": "Timere (valgfrit)",
    "Ingredients used in this step": "Ingredienser brugt i dette trin",
    "Add ingredients above to link them to this step.": "Tilføj ingredienser ovenfor for at knytte dem til dette trin.",
    "What to do…": "Hvad skal der gøres…",
    "e.g. 200 g butter": "fx 200 g smør",
    "Section title, e.g. Dough": "Sektionstitel, fx Dej",
    "Section title, e.g. Assembly": "Sektionstitel, fx Samling",
    "Substitute with its own amount, e.g. 180 g coconut oil": "Erstatning med egen mængde, fx 180 g kokosolie",
    "Label, e.g. simmer": "Navn, fx simre",
    "Move up": "Flyt op",
    "Move down": "Flyt ned",
    "Remove this timer": "Fjern denne timer",
    "Remove this substitute": "Fjern denne erstatning",
    Hours: "Timer",
    Minutes: "Minutter",
    Seconds: "Sekunder",
    h: "t",
    sec: "sek",
    // import / export
    Import: "Importér",
    "Import from URL": "Importér fra URL",
    "Import from text": "Importér fra tekst",
    "Foods": "Fødevarer",
    "Food": "Fødevare",
    "New food": "Ny fødevare",
    "Needs review": "Skal gennemses",
    "Mine": "Mine",
    "From Frida": "Fra Frida",
    "Used in": "Bruges i",
    "kcal / 100 g": "kcal / 100 g",
    "Weights": "Vægte",
    "Accept": "Acceptér",
    "standard choices": "standardvalg",
    "Suggested": "Foreslået",
    "Best guess": "Bedste bud",
    "No suggestion": "Intet forslag",
    "Every ingredient name is a food.": "Alle ingrediensnavne er en fødevare.",
    "No foods match.": "Ingen fødevarer matcher.",
    "This food no longer exists.": "Denne fødevare findes ikke længere.",
    "Nutrition per 100 g": "Ernæring pr. 100 g",
    "Frida": "Frida",
    "My values": "Mine værdier",
    "None": "Ingen",
    "No Frida food chosen yet.": "Ingen Frida-fødevare valgt endnu.",
    "Choose a Frida food": "Vælg en Frida-fødevare",
    "Change": "Skift",
    "No values yet, so this food is left out of the nutrition.": "Ingen værdier endnu, så denne fødevare tæller ikke med i ernæringen.",
    "Unit": "Enhed",
    "Grams": "Gram",
    "Add a weight": "Tilføj en vægt",
    "recipes": "opskrifter",
    "A weight written on an ingredient line, like “1 dåse (240 g)”, wins over these.": "En vægt skrevet på ingredienslinjen, fx “1 dåse (240 g)”, vinder over disse.",
    "Merge into another food": "Slå sammen med en anden fødevare",
    "This name is a food now.": "Dette navn er en fødevare nu.",
    "It is not a food yet, so it is matched by its words each time.": "Det er ikke en fødevare endnu, så det matches på sine ord hver gang.",
    "A standard choice for this word.": "Et standardvalg for dette ord.",
    "The best match found by its words: check it.": "Det bedste match efter ordene: tjek det.",
    "No food was found for this name.": "Der blev ikke fundet nogen fødevare til dette navn.",
    "Accept suggestion": "Acceptér forslag",
    "Create food": "Opret fødevare",
    "Link to a food": "Kobl til en fødevare",
    "A food needs a name": "En fødevare skal have et navn",
    "foods added from standard choices.": "fødevarer tilføjet fra standardvalg.",
    "No foods found. Try another word.": "Ingen fødevarer fundet. Prøv et andet ord.",
    "Other name": "Andet navn",
    "Also called": "Kaldes også",
    "Shop section": "Afdeling i butikken",
    "Other names for it in recipes, like “butter”.": "Andre navne for den i opskrifter, fx “butter”.",
    "Ingredients and foods": "Ingredienser og fødevarer",
    "Manage foods": "Administrér fødevarer",
    "Edit food": "Redigér fødevare",
    "Your foods": "Dine fødevarer",
    "Linked automatically": "Koblet automatisk",
    "Confirmed": "Bekræftet",
    "Standard choice, not saved yet": "Standardvalg, ikke gemt endnu",
    "Not linked to a food, so it is not counted.": "Ikke koblet til en fødevare, så den tæller ikke med.",
    "ingredients are not linked to a food yet, so they are matched by their words each time.": "ingredienser er ikke koblet til en fødevare endnu, så de matches på deres ord hver gang.",
    "Every ingredient line is linked to a food. The food knows its other names, what a unit of it weighs and its nutrition, so the calories and macros follow from it.": "Hver ingrediens er koblet til en fødevare. Fødevaren kender sine andre navne, hvad en enhed vejer og dens ernæring, så kalorier og makroer følger af den.",
    "From USDA": "Fra USDA",
    "USDA": "USDA",
    "Choose a USDA food": "Vælg en USDA-fødevare",
    "No USDA food chosen yet.": "Ingen USDA-fødevare valgt endnu.",
    "Nutrition data": "Ernæringsdata",
    "selected": "valgt",
    "Clear selection": "Ryd valg",
    "Accept suggestions": "Acceptér forslag",
    "Merge into one food": "Slå sammen til én fødevare",
    "foods added from the suggestions.": "fødevarer tilføjet fra forslagene.",
    "names are not counted.": "navne tæller ikke med.",
    "foods merged into": "fødevarer slået sammen til",
    "names linked to": "navne koblet til",
    "Choose the food to keep. The others become other names of it, with their weights.": "Vælg den fødevare, der skal beholdes. De andre bliver andre navne for den, med deres vægte.",
    "Assign to a food": "Tildel til en fødevare",
    "Create a new food": "Opret en ny fødevare",
    Day: "Dag",
    "Meals of the day": "Dagens måltider",
    "Edit the meals of the day": "Redigér dagens måltider",
    "Add a meal of the day": "Tilføj et måltid",
    "New meal": "Nyt måltid",
    "Time in the calendar": "Tidspunkt i kalenderen",
    Colour: "Farve",
    "Categories that choose this meal": "Kategorier der vælger dette måltid",
    "Leave empty to use the standard name": "Lad stå tomt for at bruge standardnavnet",
    "A recipe in one of these categories goes to this meal": "En opskrift i en af disse kategorier kommer i dette måltid",
    "Drag a recipe onto a day in the calendar.": "Træk en opskrift hen på en dag i kalenderen.",
    Uncategorized: "Uden kategori",
    "Add a meal": "Tilføj et måltid",
    "Add to the meal plan": "Føj til madplanen",
    "Open recipe": "Åbn opskrift",
    "Add meal": "Tilføj måltid",
    "Pick a day for": "Vælg en dag til",
    "click a day in the calendar.": "klik på en dag i kalenderen.",
    "Add this period to the shopping list": "Føj denne periode til indkøbslisten",
    "Switch to the week view to copy last week.": "Skift til ugevisning for at kopiere sidste uge.",
    "Home Assistant's calendar could not be loaded.": "Home Assistants kalender kunne ikke indlæses.",
    "Show the other unit in the chips": "Vis den anden enhed i chips",
    "Tidy with AI": "Ryd op med AI",
    "Reading with AI…": "Læser med AI…",
    "Uses the AI set up in Home Assistant (AI Task) to read the text. If it fails, the basic reading is used.": "Bruger den AI, der er sat op i Home Assistant (AI Task), til at læse teksten. Hvis det fejler, bruges den simple læsning.",
    "Set up an AI such as Google Gemini in Home Assistant to tidy imported text with AI.": "Sæt en AI op i Home Assistant, fx Google Gemini, for at rydde op i importeret tekst med AI.",
    "The AI could not tidy this, so the basic reading is shown.": "AI'en kunne ikke rydde op i dette, så den simple læsning vises.",
    "A typed recipe, a video transcript, Recipe JSON or page source": "En nedskrevet opskrift, en videotransskription, Recipe-JSON eller sidens kildekode",
    "Paste text, a transcript, Recipe JSON or page source": "Indsæt tekst, en transskription, Recipe-JSON eller sidens kildekode",
    'Paste a typed-up recipe, a video transcript (for example copied from YouTube), schema.org Recipe JSON, or a page\'s source (Ctrl+U in your browser, for sites that refuse automated requests with error 403). Recipes with Ingredients and Instructions headings are split at them; other text becomes steps, with amounts like "200 g butter" picked out as ingredients. Review the draft before saving.':
      'Indsæt en nedskrevet opskrift, en videotransskription (fx kopieret fra YouTube), schema.org Recipe-JSON eller en sides kildekode (Ctrl+U i din browser, til sider der afviser automatiske forespørgsler med fejl 403). Opskrifter med overskrifterne Ingredienser og Fremgangsmåde deles ved dem; anden tekst bliver til trin, hvor mængder som "200 g smør" udpeges som ingredienser. Gennemse udkastet, før du gemmer.',
    "Recipe URL (optional, kept as the source)": "Opskriftens URL (valgfri, gemmes som kilde)",
    "Import a file": "Importér en fil",
    "Import finished": "Import færdig",
    "Paste one URL to review it before saving, or several (one per line, up to 25) to import them all at once.":
      "Indsæt én URL for at se den igennem, før den gemmes, eller flere (én pr. linje, op til 25) for at importere dem alle på én gang.",
    Export: "Eksport",
    "Download all recipes (JSON)": "Download alle opskrifter (JSON)",
    "Download every recipe and cookbook, with uploaded photos embedded, as one JSON file. Keep it as a backup, or import it into another Home Assistant.":
      "Download alle opskrifter og kogebøger, med uploadede fotos indlejret, som én JSON-fil. Gem den som backup, eller importér den i en anden Home Assistant.",
    "Accepts a Recipes export,": "Accepterer en eksport fra Opskrifter,",
    "recipe JSON or export zip, a": "opskrifts-JSON eller eksport-zip, en",
    "file, or schema.org recipe JSON. Recipes you already have (same name and source) are skipped.":
      "-fil eller schema.org-opskrifts-JSON. Opskrifter, du allerede har (samme navn og kilde), springes over.",
    "Migrate from a running Mealie": "Flyt fra en kørende Mealie",
    "Pulls every recipe through Mealie's API. Create a token in Mealie under":
      "Henter alle opskrifter via Mealies API. Opret et token i Mealie under",
    "your profile → API tokens": "din profil → API-tokens",
    ". The token is used once and not stored. Requires a Home Assistant administrator.":
      ". Tokenet bruges én gang og gemmes ikke. Kræver en Home Assistant-administrator.",
    "API token": "API-token",
    "Migrate recipes": "Flyt opskrifter",
    "Preparing export…": "Forbereder eksport…",
    "Reading recipes from Mealie — this can take a minute for large libraries…":
      "Læser opskrifter fra Mealie — det kan tage et minut for store samlinger…",
    // meal plan
    "Meal plan": "Madplan",
    "Previous week": "Forrige uge",
    "Next week": "Næste uge",
    Today: "I dag",
    "Add week to shopping list": "Føj ugen til indkøbslisten",
    "Add the ingredients of this week's recipes to your shopping list":
      "Føj ingredienserne fra ugens opskrifter til din indkøbsliste",
    Breakfast: "Morgenmad",
    Lunch: "Frokost",
    Dinner: "Aftensmad",
    Snack: "Mellemmåltid",
    "Pick a meal for": "Vælg et måltid til",
    ": press + on a day.": ": tryk + på en dag.",
    "…or a plain meal, e.g. Leftovers": "…eller et almindeligt måltid, fx Rester",
    "No recipes match. Use the text box to add a plain meal.":
      "Ingen opskrifter matcher. Brug tekstfeltet til at tilføje et almindeligt måltid.",
    // timers bar
    "Done!": "Færdig!",
    Stop: "Stop",
    "Stop the alarm": "Stop alarmen",
    "Cancel timer": "Annullér timer",
    "Recently deleted": "Senest slettet",
    "Deleted recipes stay here for 30 days.": "Slettede opskrifter bliver her i 30 dage.",
    Restore: "Gendan",
    "Empty trash": "Tøm papirkurven",
    Undo: "Fortryd",
    "Recipe restored.": "Opskriften er gendannet.",
    "Empty the trash? These recipes cannot be restored afterwards.": "Tøm papirkurven? Opskrifterne kan ikke gendannes bagefter.",
    "Copy last week": "Kopiér sidste uge",
    "Copy last week's meals onto this week": "Kopiér sidste uges måltider over på denne uge",
    "Nothing new to copy from last week.": "Intet nyt at kopiere fra sidste uge.",
    "Drag to another day or meal": "Træk til en anden dag eller et andet måltid",
    // nutrition
    Nutrition: "Næringsindhold",
    Energy: "Energi",
    Protein: "Protein",
    Fat: "Fedt",
    Carbohydrates: "Kulhydrat",
    "Dietary fibre": "Kostfibre",
    "of which sugars": "heraf sukkerarter",
    "of which saturated fat": "heraf mættede fedtsyrer",
    Salt: "Salt",
    "Energy (kcal)": "Energi (kcal)",
    "Per serving": "Pr. portion",
    "Whole recipe": "Hele opskriften",
    "Calculating…": "Beregner…",
    "Check ingredients": "Tjek ingredienser",
    "Show ingredients": "Vis ingredienser",
    "Add the number of servings to the recipe to see values per serving.": "Angiv antal portioner i opskriften for at se værdier pr. portion.",
    "None of the ingredients could be counted yet.": "Ingen af ingredienserne kan regnes med endnu.",
    "Nutrition data:": "Næringsdata:",
    "Not counted": "Regnes ikke med",
    "Custom ingredient": "Egen ingrediens",
    "Custom": "Egen",
    "Matched automatically": "Fundet automatisk",
    "Standard choice": "Standardvalg",
    "Your choice": "Dit valg",
    "Not matched to a food, so it is not counted.": "Ikke koblet til en fødevare, så den regnes ikke med.",
    "No amount, so it is not counted.": "Ingen mængde, så den regnes ikke med.",
    "The weight is unknown, so it is not counted.": "Vægten er ukendt, så den regnes ikke med.",
    "Save weight": "Gem vægt",
    "Change food": "Skift fødevare",
    "Choose food": "Vælg fødevare",
    Close: "Luk",
    "Don't count": "Regn ikke med",
    "Water, salt to taste and the like": "Vand, salt efter smag og lignende",
    Reset: "Nulstil",
    "Match this ingredient automatically again": "Find fødevaren automatisk igen",
    "Search foods": "Søg i fødevarer",
    "Searching…": "Søger…",
    "No foods found. Try another word, or make a custom ingredient.": "Ingen fødevarer fundet. Prøv et andet ord, eller lav en egen ingrediens.",
    "New custom ingredient…": "Ny egen ingrediens…",
    "New custom ingredient": "Ny egen ingrediens",
    "Edit custom ingredient": "Redigér egen ingrediens",
    Name: "Navn",
    "Values per 100 g, as on the nutrition label. Only the energy is required.": "Værdier pr. 100 g som på varedeklarationen. Kun energi er påkrævet.",
    "Custom ingredients": "Egne ingredienser",
    "For homemade things and products Frida does not have: give the values per 100 g once and use them in any recipe.":
      "Til hjemmelavede ting og varer, Frida ikke har: angiv værdierne pr. 100 g én gang, og brug dem i alle opskrifter.",
    "Calories and macros are estimated from what each ingredient weighs and the food it is matched to. Check the matches below; your choices are remembered for every recipe that uses the same ingredient.":
      "Kalorier og makronæringsstoffer er et skøn ud fra, hvad hver ingrediens vejer, og hvilken fødevare den er koblet til. Tjek koblingerne herunder; dine valg huskes i alle opskrifter med samme ingrediens.",
    "Give the ingredient a name and its energy in kcal per 100 g.": "Giv ingrediensen et navn og dens energi i kcal pr. 100 g.",
    // messages built in code
    "All steps done. Checks cleared for next time.": "Alle trin er færdige. Markeringerne er ryddet til næste gang.",
    "Discard your unsaved changes?": "Vil du kassere dine ændringer, som ikke er gemt?",
    "Delete this recipe?": "Slet denne opskrift?",
    "Delete this cookbook? The recipes are kept.": "Slet denne kogebog? Opskrifterne beholdes.",
    "Name for this cookbook:": "Navn på denne kogebog:",
    "Select some recipes first.": "Vælg nogle opskrifter først.",
    "Enter a value to add or remove.": "Skriv en værdi, der skal tilføjes eller fjernes.",
    "Added to the meal plan.": "Føjet til madplanen.",
    "Dashboard cook card now shows this recipe.": "Dashboardets madlavningskort viser nu denne opskrift.",
    "Dashboard cook card cleared.": "Dashboardets madlavningskort er ryddet.",
  },
  patterns: [
    [/\bStep (\d+) of (\d+)\b/g, "Trin $1 af $2"],
    [/^Step (\d+)$/, "Trin $1"],
    [/^Search (\d+) recipes$/, "Søg i $1 opskrifter"],
    [/^Show (\d+) recipes$/, "Vis $1 opskrifter"],
    [/^(\d+) ingredients$/, "$1 ingredienser"],
    [/^(\d+) ingredients · (\d+) steps$/, "$1 ingredienser · $2 trin"],
    [/^(\d+) selected$/, "$1 valgt"],
    [/^Select all (\d+) shown$/, "Vælg alle $1 viste"],
    [/^Add (\d+) item\(s\)$/, "Tilføj $1 vare(r)"],
    [/^More filters \((\d+)\)$/, "Flere filtre ($1)"],
    [/^Serves (.+)$/, "Portioner $1"],
    [/ · Serves (.+)$/, " · Portioner $1"],
    [/^Serves (.+) \(originally (.+)\)$/, "Portioner $1 (oprindeligt $2)"],
    [/^originally (.+)$/, "oprindeligt $1"],
    [/^as written: (.+)$/, "som skrevet: $1"],
    [/^Remove (.+)$/, "Fjern $1"],
    [/^Select or create a (.+)…$/, "Vælg eller opret $1…"],
    [/^Add to (breakfast|lunch|dinner|snack)\b/, (_m, slot) => "Føj til " + { breakfast: "morgenmad", lunch: "frokost", dinner: "aftensmad", snack: "mellemmåltid" }[slot]],
    [/^Start (.+) timer(?: \((.+)\))?$/, (_m, d, label) => `Start ${d}-timer${label ? ` (${label})` : ""}`],
    [/^(.+) · (as written|grams)\. Untick things you already have\.$/, (_m, name, mode) => `${name} · ${mode === "grams" ? "gram" : "som skrevet"}. Fjern markeringen ved det, du allerede har.`],
    [/^Added (\d+) items from (\d+) meals to (\S+?)(?: \((\d+) already there\))?\.$/, (_m, n, meals, list, skipped) => `Tilføjede ${n} varer fra ${meals} måltider til ${list}${skipped ? ` (${skipped} var der allerede)` : ""}.`],
    [/^Delete (\d+) recipe\(s\)\? This cannot be undone\.$/, "Slet $1 opskrift(er)? Det kan ikke fortrydes."],
    [/^Deleted “(.*)”\.$/, "Slettede “$1”."],
    [/^Deleted (\d+) recipe\(s\)\.$/, "Slettede $1 opskrift(er)."],
    [/^Restored (\d+) recipes\.$/, "Gendannede $1 opskrifter."],
    [/^Copied (\d+) meals from last week\.$/, "Kopierede $1 måltider fra sidste uge."],
    [/^Add to (.+) · (.+)$/, "Føj til $1 · $2"],
    [/^Estimate · (\d+) of (\d+) ingredients counted(?: · (\d+) matched automatically)?$/, (_m, a, b, c) => `Skøn · ${a} af ${b} ingredienser regnet med${c ? ` · ${c} fundet automatisk` : ""}`],
    [/^(\d+) ingredient\(s\) not counted$/, "$1 ingrediens(er) regnes ikke med"],
    [/^Whole recipe ×(.+)$/, "Hele opskriften ×$1"],
    [/^It will be used for “(.*)”\.$/, "Den bruges til “$1”."],
    [/^Delete the custom ingredient “(.*)”\? Recipes that use it are matched again\.$/, "Slet den egne ingrediens “$1”? Opskrifter, der bruger den, kobles igen."],
    [/^(.+) \/ 100 g$/, (_m, x) => `${x.replace(/\bEnergy\b/, "Energi").replace(/\bProtein\b/, "Protein").replace(/\bFat\b/, "Fedt").replace(/\bCarbohydrates\b/, "Kulhydrat").replace(/\bsaturated fat\b/, "mættede fedtsyrer").replace(/\bsugars\b/, "sukkerarter").replace(/\bDietary fibre\b/, "Kostfibre")} / 100 g`],
    [/\b(\d+) sec\b/g, "$1 sek"],
    [/\b(\d+) h\b/g, "$1 t"],
  ],
};

const TABLES = { da };

/** The table for a language ("da-DK" -> da), or undefined for English and unknown languages. */
const tableFor = (language) => TABLES[String(language || "en").toLowerCase().split("-")[0]];

export const translate = (language, text) => {
  const table = tableFor(language);
  if (!table || typeof text !== "string") return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  let core = text.trim();
  if (!core) return text;
  if (Object.prototype.hasOwnProperty.call(table.exact, core)) return lead + table.exact[core] + trail;
  for (const [pattern, replacement] of table.patterns) {
    const next = core.replace(pattern, replacement);
    if (next !== core) core = next;
  }
  // a pattern may have produced a string that is itself in the table ("Add to breakfast")
  if (Object.prototype.hasOwnProperty.call(table.exact, core)) core = table.exact[core];
  return lead + core + trail;
};

const ATTRIBUTES = ["title", "placeholder", "aria-label", "label", "header", "header-title", "headline", "supporting-text"];
const SKIP = new Set(["STYLE", "SCRIPT", "TEXTAREA", "INPUT"]);

/** Translate every text node and label attribute under `root` (a node or shadow root). */
const translateTree = (root, language) => {
  if (!tableFor(language)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && (SKIP.has(node.parentElement.tagName) || node.parentElement.closest("[contenteditable=true]"))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    const out = translate(language, node.nodeValue);
    if (out !== node.nodeValue) node.nodeValue = out;
  }
  const scope = root.querySelectorAll ? root.querySelectorAll("*") : [];
  for (const el of scope) {
    for (const attr of ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const out = translate(language, value);
      if (out !== value) el.setAttribute(attr, out);
    }
  }
};

/**
 * Keep `root` translated as it changes. `getLanguage` is read on every pass, so the
 * panel follows a language change. Returns a function that stops observing.
 */
export const observeTranslations = (root, getLanguage) => {
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      observer.disconnect(); // our own edits must not trigger another pass
      try {
        translateTree(root, getLanguage());
      } finally {
        observer.observe(root, { subtree: true, childList: true, characterData: true });
      }
    });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  translateTree(root, getLanguage());
  return () => observer.disconnect();
};

export const hasTranslation = (language) => !!tableFor(language);
