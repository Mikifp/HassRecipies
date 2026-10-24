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
    "Import from page source": "Importér fra sidens kildekode",
    "Some sites refuse automated requests (error 403). Open the recipe in your browser, view the page source (Ctrl+U), select all, copy, and paste it here.": "Nogle sider afviser automatiske forespørgsler (fejl 403). Åbn opskriften i din browser, vis sidens kildekode (Ctrl+U), markér alt, kopiér og indsæt den her.",
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
