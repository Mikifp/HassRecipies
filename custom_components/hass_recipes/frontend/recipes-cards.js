/* Dashboard cards for the Recipes integration.
 *
 *   type: custom:hass-recipes-list-card     search and open recipes
 *   type: custom:hass-recipes-cooking-card  live kitchen timers with a stop button
 *   type: custom:hass-recipes-cook-card     one recipe, one step at a time
 *   type: custom:hass-recipes-kitchen-card  the list and the cook card as one mini app
 */

// Helpers shared with the panel, loaded with this file's own ?v= so they never go stale.
const __v = new URL(import.meta.url).searchParams.get("v");
const {
  esc,
  minutes,
  formatNumber,
  normStep,
  isHeader,
  headerText,
  splitSubs,
  timerSpecs,
  clock,
  ingParts,
  SCALES,
  scaleBasis,
  roundAmount,
  lengthText,
} = await import(`./recipes-shared.js${__v ? `?v=${__v}` : ""}`);

const PROGRESS_KEY = "hass_recipes_progress"; // same record the panel keeps: ticks survive reloads
const SNOOZE_SECONDS = 120;

/* ---- translations ------------------------------------------------------------ */
const I18N = {
  en: {
    recipes: "Recipes",
    now_cooking: "Now cooking",
    all_recipes: "All recipes",
    open_recipes: "Open Recipes",
    search: "Search recipes",
    loading: "Loading…",
    no_recipes: "No recipes found.",
    no_timers: "No timers running.",
    stop_alarm: "Stop alarm",
    dismiss: "Dismiss",
    cancel_timer: "Cancel timer",
    finished: "Finished",
    snooze: "+2 min",
    snooze_title: "Snooze for 2 minutes",
    back: "Back",
    next: "Next",
    start_over: "Start over",
    timer: "Timer {t}",
    ingredients: "Ingredients",
    step_of: "Step {n} of {total}",
    makes: "Makes",
    serves: "Serves",
    scale: "Scale",
    as_written: "As written",
    times_recipe: "{k}× the recipe",
    written_for: "written for {n}",
    less: "Less",
    more: "More",
    no_choice: "No recipe chosen yet. Open a recipe in the Recipes panel and press “Dashboard”.",
    not_found: "Recipe “{name}” was not found.",
    no_steps: "This recipe has no steps yet.",
    cook_this: "Cook this recipe",
    or: "or",
    open_in: "Open in Recipes",
    mark_done: "Mark as done",
    is_done: "Done",
    plan_title: "Meal plan",
    plan_today: "Today",
    plan_tomorrow: "Tomorrow",
    plan_nothing: "Nothing planned.",
    slot_breakfast: "Breakfast",
    slot_lunch: "Lunch",
    slot_dinner: "Dinner",
    slot_snack: "Snack",
    cook_planned: "Cook this",
    // editor
    ed_days: "Days to show",
    ed_slots: "Meals to show",
    ed_tap: "Tapping a meal",
    ed_show_empty: "Show days with nothing planned",
    opt_tap_cook: "Starts cooking it",
    opt_tap_open: "Opens the recipe",
    ed_title: "Title",
    ed_limit: "Recipes to show",
    ed_show_search: "Show the search box",
    ed_category: "Only this category",
    ed_tag: "Only this tag",
    ed_recipe: "Recipe",
    ed_units: "Ingredient amounts",
    ed_layout: "Layout",
    ed_show: "Show",
    ed_list_height: "List height (px, 0 for no scrolling)",
    ed_content_height: "Step height (px, 0 for no scrolling)",
    ed_keep_awake: "Keep the screen awake while cooking",
    ed_swipe: "Swipe left and right to change step",
    ed_text_size: "Text size",
    help_recipe: "Leave empty to follow the recipe chosen with the Dashboard button in the Recipes panel.",
    help_units: "Grams converts amounts where it can; as written keeps the recipe's own units.",
    help_list_height: "Ignored when the card is resized in a sections dashboard: it then fills its height.",
    opt_recipe_chosen: "The recipe chosen in the Recipes panel",
    opt_any_category: "Any category",
    opt_any_tag: "Any tag",
    opt_grams: "Grams",
    opt_original: "As written",
    opt_show_all: "Recipe and list (use the layout)",
    opt_show_list: "Only the recipe list",
    opt_show_steps: "Only the steps",
    opt_layout_app: "Mini app: list, then recipe",
    opt_layout_vertical: "Recipe above the list",
    opt_layout_horizontal: "List beside the recipe",
    opt_size_normal: "Normal",
    opt_size_large: "Large",
    opt_size_xlarge: "Extra large",
  },
  da: {
    recipes: "Opskrifter",
    now_cooking: "Laver mad nu",
    all_recipes: "Alle opskrifter",
    open_recipes: "Åbn opskrifter",
    search: "Søg i opskrifter",
    loading: "Henter…",
    no_recipes: "Ingen opskrifter fundet.",
    no_timers: "Ingen timere kører.",
    stop_alarm: "Stop alarm",
    dismiss: "Afvis",
    cancel_timer: "Annuller timer",
    finished: "Færdig",
    snooze: "+2 min",
    snooze_title: "Udsæt i 2 minutter",
    back: "Tilbage",
    next: "Næste",
    start_over: "Start forfra",
    timer: "Timer {t}",
    ingredients: "Ingredienser",
    step_of: "Trin {n} af {total}",
    makes: "Giver",
    serves: "Portioner",
    scale: "Skala",
    as_written: "Som skrevet",
    times_recipe: "{k}× opskriften",
    written_for: "skrevet til {n}",
    less: "Mindre",
    more: "Mere",
    no_choice: "Ingen opskrift valgt endnu. Åbn en opskrift i Opskrifter og tryk “Dashboard”.",
    not_found: "Opskriften “{name}” blev ikke fundet.",
    no_steps: "Denne opskrift har ingen trin endnu.",
    cook_this: "Lav denne opskrift",
    or: "eller",
    open_in: "Åbn i Opskrifter",
    mark_done: "Markér som færdig",
    is_done: "Færdig",
    plan_title: "Madplan",
    plan_today: "I dag",
    plan_tomorrow: "I morgen",
    plan_nothing: "Intet planlagt.",
    slot_breakfast: "Morgenmad",
    slot_lunch: "Frokost",
    slot_dinner: "Aftensmad",
    slot_snack: "Mellemmåltid",
    cook_planned: "Lav denne",
    ed_days: "Antal dage",
    ed_slots: "Måltider der vises",
    ed_tap: "Tryk på et måltid",
    ed_show_empty: "Vis dage uden planlagte måltider",
    opt_tap_cook: "Starter madlavning",
    opt_tap_open: "Åbner opskriften",
    ed_title: "Titel",
    ed_limit: "Antal opskrifter",
    ed_show_search: "Vis søgefeltet",
    ed_category: "Kun denne kategori",
    ed_tag: "Kun dette tag",
    ed_recipe: "Opskrift",
    ed_units: "Mængder",
    ed_layout: "Layout",
    ed_show: "Vis",
    ed_list_height: "Listehøjde (px, 0 for ingen rulning)",
    ed_content_height: "Trinhøjde (px, 0 for ingen rulning)",
    ed_keep_awake: "Hold skærmen tændt under madlavning",
    ed_swipe: "Stryg til siden for at skifte trin",
    ed_text_size: "Tekststørrelse",
    help_recipe: "Lad stå tom for at følge opskriften valgt med Dashboard-knappen i Opskrifter.",
    help_units: "Gram omregner mængder hvor det er muligt; som skrevet beholder opskriftens egne enheder.",
    help_list_height: "Ignoreres når kortet ændres i størrelse i et sektionsdashboard: så fylder det sin højde.",
    opt_recipe_chosen: "Opskriften valgt i Opskrifter",
    opt_any_category: "Alle kategorier",
    opt_any_tag: "Alle tags",
    opt_grams: "Gram",
    opt_original: "Som skrevet",
    opt_show_all: "Opskrift og liste (brug layoutet)",
    opt_show_list: "Kun opskriftslisten",
    opt_show_steps: "Kun trinene",
    opt_layout_app: "Mini-app: liste, så opskrift",
    opt_layout_vertical: "Opskriften over listen",
    opt_layout_horizontal: "Listen ved siden af opskriften",
    opt_size_normal: "Normal",
    opt_size_large: "Stor",
    opt_size_xlarge: "Ekstra stor",
  },
};
const translate = (hass, key, vars = {}) => {
  const lang = String(hass?.language || hass?.locale?.language || "en").toLowerCase().split("-")[0];
  const text = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
};

/* ---- cooking pages: the same rule the server uses for "next step" ------------- */
const pagesFor = (r) => {
  const all = (r.instructions || []).map(normStep).map((s, i) => ({ ...s, i }));
  const real = all.filter((s) => !s.section);
  const hasIngs = (r.ingredients || []).some((t) => !isHeader(t));
  const pages = hasIngs ? [{ page: "ingredients", i: -1, text: "", ingredients: [], timer: null }, ...real] : real;
  return { all, real, pages, hasIngs };
};

/* ---- ticks and done steps: the record the panel keeps, so both agree --------- */
const readProgress = () => {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch (_) {
    return {};
  }
};
const loadProgress = (id) => {
  let entry = readProgress()[id];
  if (entry && Date.now() - (entry.t || 0) > 2 * 864e5) entry = null; // stale after two days
  return { ing: new Set((entry && entry.ing) || []), steps: new Set((entry && entry.steps) || []) };
};
const saveProgress = (id, p) => {
  try {
    const all = readProgress();
    all[id] = { ing: [...p.ing], steps: [...p.steps], t: Date.now() };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch (_) { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent("hass-recipes-progress", { detail: { id } }));
};

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card { overflow: hidden; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
  .scroll { overflow-y: auto; min-height: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 6px; }
  .title { font-size: 16px; font-weight: 500; }
  .muted { color: var(--secondary-text-color); font-size: 13px; }
  .empty { padding: 20px 16px; text-align: center; color: var(--secondary-text-color); }
  button { font: inherit; cursor: pointer; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); font-size: calc(13px * var(--hr-fs, 1)); }
  .btn.p { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn:disabled { opacity: .5; cursor: default; }
  .thumb { width: 44px; height: 44px; flex: none; border-radius: 8px; background: var(--secondary-background-color) center / cover; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
  input[type=search] { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: var(--secondary-background-color); border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
`;

const TEXT_SIZES = { normal: 1, large: 1.25, xlarge: 1.5 };

class RecipesBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._unsubs = [];
    this._onVisible = () => this._syncWake();
    // properties set on the element before it was upgraded would hide the hass setter
    if (Object.prototype.hasOwnProperty.call(this, "hass")) {
      const value = this.hass;
      delete this.hass;
      this.hass = value;
    }
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this.isConnected) this._start();
  }
  get hass() {
    return this._hass;
  }
  connectedCallback() {
    if (this._hass) this._start();
  }
  disconnectedCallback() {
    this._started = false;
    for (const u of this._unsubs.splice(0)) {
      try {
        u();
      } catch (_) { /* connection already closed */ }
    }
    clearInterval(this._tick);
    document.removeEventListener("visibilitychange", this._onVisible);
    this._releaseWake();
  }
  getCardSize() {
    return 4;
  }
  /** Translate a key into the language Home Assistant is set to. */
  _t(key, vars) {
    return translate(this._hass, key, vars);
  }
  async _sub(fn) {
    const unsub = await fn();
    if (this._started) this._unsubs.push(unsub);
    else unsub();
  }
  _openPath(path) {
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
  _paint(body) {
    // repaints (timer ticks, selections) must not throw scrolled areas back to the top
    const tops = [...this.shadowRoot.querySelectorAll(".scroll")].map((s) => s.scrollTop);
    const fs = TEXT_SIZES[this._config?.text_size] || 1;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card style="--hr-fs:${fs}">${body}</ha-card>`;
    // restored once the repainted card has been laid out (before the next paint, so no flicker)
    if (tops.some((t) => t)) {
      requestAnimationFrame(() => {
        this.shadowRoot.querySelectorAll(".scroll").forEach((s, i) => {
          if (tops[i]) s.scrollTop = tops[i];
        });
      });
    }
  }
  /** True when the dashboard gave this card a fixed height (sections view `grid_options.rows`). */
  _fixedHeight() {
    return typeof this._config?.grid_options?.rows === "number";
  }
  /** Style for a scrolling region: fills a fixed-height card, otherwise capped at `px` (0 = never scroll). */
  _scrollRegion(px) {
    if (this._fixedHeight()) return "flex:1 1 auto;min-height:0;overflow-y:auto;";
    return px > 0 ? `max-height:${px}px;overflow-y:auto;` : "";
  }
  /** The recipe list's scroller, sized by `list_height`. */
  _scrollStyle(fallback) {
    return this._scrollRegion(Number(this._config.list_height ?? fallback));
  }
  /** Default footprint in a sections view; the user can still resize in the dashboard editor. */
  getGridOptions() {
    return { columns: 6, min_columns: 3, rows: "auto", min_rows: 2 };
  }
  _watchTimers() {
    this._timers = [];
    this._skew = 0;
    this._sub(() =>
      this._hass.connection.subscribeMessage(
        (snap) => {
          this._skew = snap.now_ms - Date.now();
          this._timers = snap.timers;
          this._render();
        },
        { type: "hass_recipes/subscribe_timers" }
      )
    );
    this._tick = setInterval(() => this._timers.some((t) => !t.done) && this._render(), 1000);
  }
  _left(t) {
    return (t.ends_at_ms - (Date.now() + this._skew)) / 1000;
  }
  async _timerCall(msg) {
    try {
      await this._hass.callWS(msg);
    } catch (_) { /* the subscription resyncs */ }
  }
  /** Keep the screen on while this card is showing (a tablet on the counter), if asked to. */
  _syncWake() {
    const want = this._config?.keep_awake && this.isConnected && document.visibilityState === "visible";
    if (!want) return this._releaseWake();
    if (this._wake || this._wakePending || !("wakeLock" in navigator)) return;
    this._wakePending = true;
    navigator.wakeLock
      .request("screen")
      .then((lock) => {
        this._wake = lock;
        lock.addEventListener("release", () => (this._wake = null));
      })
      .catch(() => { /* denied (battery saver, hidden tab): nothing to do */ })
      .finally(() => (this._wakePending = false));
  }
  _releaseWake() {
    if (this._wake) this._wake.release().catch(() => {});
    this._wake = null;
  }
  _watchWake() {
    document.addEventListener("visibilitychange", this._onVisible);
    this._syncWake();
  }
}

/* ---- B: recipe list ------------------------------------------------------ */
class HassRecipesListCard extends RecipesBase {
  getGridOptions() {
    return { columns: 6, min_columns: 3, rows: "auto", min_rows: 3 };
  }
  static getStubConfig() {
    return { limit: 20 };
  }
  setConfig(config) {
    this._config = { limit: 20, show_search: true, ...config };
    this._query = this._query || "";
    if (this._recipes) this._render();
  }
  getCardSize() {
    return 2 + Math.min(this._config?.limit || 20, 6);
  }
  async _start() {
    this._started = true;
    await this._load();
    for (const ev of ["recipe_added", "recipe_updated", "recipe_deleted"]) {
      this._sub(() => this._hass.connection.subscribeEvents(() => this._load(), `hass_recipes_${ev}`));
    }
  }
  async _load() {
    try {
      this._recipes = (await this._hass.callWS({ type: "hass_recipes/list" })).recipes;
      this._error = "";
    } catch (err) {
      this._error = err.message || "Could not load recipes";
    }
    this._render();
  }
  _matches() {
    const c = this._config;
    const q = this._query.trim().toLowerCase();
    let list = (this._recipes || []).filter((r) => {
      if (c.category && !(r.categories || []).includes(c.category)) return false;
      if (c.tag && !(r.tags || []).includes(c.tag)) return false;
      if (!q) return true;
      return [r.name, ...(r.tags || []), ...(r.categories || []), ...(r.ingredients || [])]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    if (!q) list = [...list].sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
    return list.slice(0, c.limit);
  }
  _render() {
    if (!this._config) return;
    const title = this._config.title ?? this._t("recipes");
    const search = this._config.show_search
      ? `<div style="padding:6px 16px 10px"><input type="search" placeholder="${esc(this._t("search"))}" value="${esc(this._query)}"></div>`
      : "";
    let rows;
    if (this._error) rows = `<div class="empty">${esc(this._error)}</div>`;
    else if (!this._recipes) rows = `<div class="empty">${esc(this._t("loading"))}</div>`;
    else {
      const list = this._matches();
      rows = list.length
        ? list
            .map((r) => {
              const meta = [r.total_time ? minutes(r.total_time) : "", (r.categories || [])[0] || ""].filter(Boolean).join(" · ");
              const img = r.image ? `style="background-image:url('${esc(r.image)}')"` : "";
              return `<div class="row" data-id="${esc(r.id)}" tabindex="0">
                <div class="thumb" ${img}>${r.image ? "" : "<ha-icon icon=\"mdi:silverware-fork-knife\"></ha-icon>"}</div>
                <div style="flex:1;min-width:0"><div class="name">${esc(r.name)}</div><div class="muted">${esc(meta)}</div></div>
                <ha-icon icon="mdi:chevron-right" style="color:var(--secondary-text-color)"></ha-icon></div>`;
            })
            .join("")
        : `<div class="empty">${esc(this._t("no_recipes"))}</div>`;
    }
    const keep = this.shadowRoot.querySelector("input")?.matches(":focus");
    this._paint(`
      <style>
        .row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--divider-color); cursor: pointer; }
        .row:hover, .row:focus-visible { background: var(--secondary-background-color); outline: 0; }
        .name { font-size: calc(14px * var(--hr-fs, 1)); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="head"><span class="title">${esc(title)}</span>
        <button class="btn" id="all">${esc(this._t("all_recipes"))}</button></div>
      ${search}<div class="scroll" style="${this._scrollStyle(360)}">${rows}</div>`);
    const root = this.shadowRoot;
    root.getElementById("all").onclick = () => this._openPath("/recipes");
    for (const row of root.querySelectorAll(".row")) {
      const go = () => this._openPath(`/recipes#/recipe/${row.dataset.id}`);
      row.onclick = go;
      row.onkeydown = (e) => (e.key === "Enter" ? go() : null);
    }
    const input = root.querySelector("input");
    if (input) {
      input.oninput = () => {
        this._query = input.value;
        const pos = input.selectionStart;
        this._render();
        // the repainted ha-card is not focusable until it has been laid out
        requestAnimationFrame(() => {
          const again = this.shadowRoot.querySelector("input");
          if (again) {
            again.focus();
            again.setSelectionRange(pos, pos);
          }
        });
      };
      if (keep) requestAnimationFrame(() => input.focus());
    }
  }
}

/* ---- C: now cooking (timers) -------------------------------------------- */
class HassRecipesCookingCard extends RecipesBase {
  static getStubConfig() {
    return {};
  }
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }
  getCardSize() {
    return 3;
  }
  _start() {
    this._started = true;
    this._watchTimers();
  }
  _render() {
    if (!this._config) return;
    const timers = this._timers || [];
    const done = timers.filter((t) => t.done);
    const recipes = [...new Set(timers.map((t) => t.label.split(" · ")[0]))];
    const sub = recipes.length ? recipes.join(", ") : "";
    const pills = timers
      .map((t) => {
        const label = t.label.includes(" · ") ? t.label.split(" · ").slice(1).join(" · ") : t.label;
        if (t.done) {
          return `<div class="pill done"><ha-icon icon="mdi:bell-ring"></ha-icon>
            <div style="flex:1"><div class="n">${esc(label)}</div><div class="muted" style="color:var(--error-color)">${esc(this._t("finished"))}</div></div>
            <button class="btn" data-snooze="${esc(t.id)}" title="${esc(this._t("snooze_title"))}">${esc(this._t("snooze"))}</button>
            <button class="btn" data-dismiss="${esc(t.id)}">${esc(this._t("dismiss"))}</button></div>`;
        }
        const total = Math.max(1, t.total_ms ? t.total_ms / 1000 : this._left(t));
        const left = this._left(t);
        const pct = Math.max(0, Math.min(100, 100 - (left / total) * 100));
        return `<div class="pill"><ha-icon icon="mdi:timer-sand" style="color:var(--primary-color)"></ha-icon>
          <div style="flex:1"><div style="display:flex;justify-content:space-between"><span class="n">${esc(label)}</span><span>${clock(left)}</span></div>
          ${t.total_ms ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}</div>
          <button class="btn" data-dismiss="${esc(t.id)}" title="${esc(this._t("cancel_timer"))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      })
      .join("");
    const title = this._config.title ?? this._t("now_cooking");
    this._paint(`
      <style>
        .pills { display: grid; gap: 8px; padding: 6px 16px 16px; align-content: start; }
        .pill { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--divider-color); border-radius: 10px; font-size: calc(14px * var(--hr-fs, 1)); }
        .pill.done { border-color: var(--error-color); background: color-mix(in srgb, var(--error-color) 12%, transparent); }
        .pill .n { font-weight: 500; }
        .bar { height: 4px; border-radius: 2px; background: var(--divider-color); margin-top: 6px; overflow: hidden; }
        .bar i { display: block; height: 100%; background: var(--primary-color); }
      </style>
      <div class="head"><div><div class="title">${esc(title)}</div>${sub ? `<div class="muted">${esc(sub)}</div>` : ""}</div>
        ${
          done.length
            ? `<span style="display:flex;gap:8px"><button class="btn" id="snooze-all" title="${esc(this._t("snooze_title"))}">${esc(this._t("snooze"))}</button>
               <button class="btn p" id="stop"><ha-icon icon="mdi:bell-off"></ha-icon>${esc(this._t("stop_alarm"))}</button></span>`
            : ""
        }</div>
      ${timers.length ? `<div class="pills scroll" style="${this._scrollStyle(400)}">${pills}</div>` : `<div class="empty">${esc(this._t("no_timers"))}</div>`}`);
    this._wireTimers();
  }
  _wireTimers() {
    const root = this.shadowRoot;
    const done = (this._timers || []).filter((t) => t.done);
    const stop = root.getElementById("stop");
    if (stop) stop.onclick = () => done.forEach((t) => this._timerCall({ type: "hass_recipes/timer_dismiss", timer_id: t.id }));
    const all = root.getElementById("snooze-all");
    if (all) all.onclick = () => this._timerCall({ type: "hass_recipes/timer_snooze", seconds: SNOOZE_SECONDS });
    for (const b of root.querySelectorAll("[data-dismiss]")) {
      b.onclick = () => this._timerCall({ type: "hass_recipes/timer_dismiss", timer_id: b.dataset.dismiss });
    }
    for (const b of root.querySelectorAll("[data-snooze]")) {
      b.onclick = () => this._timerCall({ type: "hass_recipes/timer_snooze", timer_id: b.dataset.snooze, seconds: SNOOZE_SECONDS });
    }
  }
}

/* ---- F: cook mode, one step at a time ----------------------------------- */
class HassRecipesCookCard extends RecipesBase {
  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto", min_rows: 4 };
  }
  static getStubConfig() {
    return {}; // follows the recipe chosen in the Recipes panel
  }
  setConfig(config) {
    this._config = { swipe: true, ...(config || {}) };
    this._localStep = 0;
    this._syncWake();
    this._render();
  }
  getCardSize() {
    return 5;
  }
  async _start() {
    this._started = true;
    this._watchTimers();
    this._watchWake();
    this._onProgress = (e) => {
      if (!e.detail || e.detail.id === this._recipe?.id) this._render();
    };
    window.addEventListener("hass-recipes-progress", this._onProgress);
    await this._load();
    for (const ev of ["recipe_updated", "recipe_deleted"]) {
      this._sub(() => this._hass.connection.subscribeEvents(() => this._load(), `hass_recipes_${ev}`));
    }
    // the shared cooking state: recipe, page and scale move together on every card and voice command
    this._sub(() =>
      this._hass.connection.subscribeEvents((ev) => {
        const d = ev.data || {};
        this._chosen = d.recipe_id;
        this._srvStep = d.step;
        this._srvScale = d.scale;
        if (d.recipe_changed) this._load();
        else this._render();
      }, "hass_recipes_cooking_recipe_changed")
    );
  }
  disconnectedCallback() {
    window.removeEventListener("hass-recipes-progress", this._onProgress);
    super.disconnectedCallback();
  }
  /** A card without `recipe:` follows the shared cooking state; one that names a recipe keeps its own. */
  _follows() {
    return !String(this._config.recipe || "").trim();
  }
  _step() {
    return this._follows() ? this._srvStep || 0 : this._localStep || 0;
  }
  _scale() {
    if (this._follows()) return this._srvScale > 0 ? this._srvScale : this._recipe?.default_scale || 1;
    return this._localScale > 0 ? this._localScale : this._recipe?.default_scale || 1;
  }
  async _load() {
    try {
      const res = await this._hass.callWS({ type: "hass_recipes/list" });
      const recipes = res.recipes;
      this._all = recipes;
      this._chosen = res.cooking_recipe_id;
      this._srvStep = res.cooking_step || 0;
      this._srvScale = res.cooking_scale || 1;
      const named = String(this._config.recipe || "").trim();
      const want = named.toLowerCase();
      this._recipe = named
        ? recipes.find((r) => r.id === named) || recipes.find((r) => r.name.trim().toLowerCase() === want) || null
        : recipes.find((r) => r.id === this._chosen) || null;
      this._error = this._recipe
        ? ""
        : named
          ? this._t("not_found", { name: named })
          : this._t("no_choice");
      if (this._recipe && !this._follows()) {
        try {
          this._localStep = Number(localStorage.getItem(`hass_recipes_card_${this._recipe.id}`)) || 0;
          this._localScale = parseFloat(localStorage.getItem(`hass_recipes_card_scale_${this._recipe.id}`)) || 0;
        } catch (_) { /* storage unavailable */ }
      }
    } catch (err) {
      this._error = err.message || "Could not load the recipe";
    }
    this._render();
  }
  /** Every running or finished timer, so the card works as a kitchen overview. */
  _timersHtml() {
    const timers = this._timers || [];
    if (!timers.length) return "";
    const rows = timers
      .map((t) => {
        const label = t.label.includes(" · ") ? t.label.split(" · ").slice(1).join(" · ") : t.label;
        const from = t.label.includes(" · ") ? t.label.split(" · ")[0] : "";
        const sub = from && from !== this._recipe?.name ? `<span class="muted"> · ${esc(from)}</span>` : "";
        const status = t.done
          ? `<span style="color:var(--error-color);font-weight:500">${esc(this._t("finished"))}</span>`
          : `<span style="font-variant-numeric:tabular-nums">${clock(this._left(t))}</span>`;
        const snooze = t.done
          ? `<button class="btn" data-snooze="${esc(t.id)}" title="${esc(this._t("snooze_title"))}">${esc(this._t("snooze"))}</button>`
          : "";
        return `<div class="trow${t.done ? " done" : ""}"><ha-icon icon="mdi:${t.done ? "bell-ring" : "timer-sand"}"></ha-icon>
          <span style="flex:1;min-width:0">${esc(label)}${sub}</span>${status}${snooze}
          <button class="btn" data-dismiss="${esc(t.id)}" title="${esc(t.done ? this._t("dismiss") : this._t("cancel_timer"))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      })
      .join("");
    return `<style>
        .tlist { border-top: 1px solid var(--divider-color); margin-top: 14px; padding: 8px 0 0; max-height: 160px; overflow-y: auto; flex: none; }
        .trow { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: calc(14px * var(--hr-fs, 1)); }
        .trow.done { color: var(--error-color); }
        .trow .btn { padding: 2px 8px; }
      </style><div class="tlist">${rows}</div>`;
  }
  _wireTimers() {
    for (const b of this.shadowRoot.querySelectorAll("[data-dismiss]")) {
      b.onclick = () => this._timerCall({ type: "hass_recipes/timer_dismiss", timer_id: b.dataset.dismiss });
    }
    for (const b of this.shadowRoot.querySelectorAll("[data-snooze]")) {
      b.onclick = () =>
        this._timerCall({ type: "hass_recipes/timer_snooze", timer_id: b.dataset.snooze, seconds: SNOOZE_SECONDS });
    }
  }
  /** Servings / amount control: type a number, nudge it, or pick a multiplier. */
  _scaleControlHtml(r, k) {
    const b = scaleBasis(r);
    const label = this._t({ Makes: "makes", Serves: "serves", Scale: "scale" }[b.label]);
    const chips = SCALES.map(
      ([v, text]) => `<button class="chip ${v === k ? "active" : ""}" data-scale="${v}">${text}</button>`
    ).join("");
    const hint =
      k === 1
        ? this._t("as_written")
        : `${this._t("times_recipe", { k: formatNumber(k) })}${
            b.unit === "×" ? "" : ` (${this._t("written_for", { n: `${roundAmount(b.base)}${b.unit ? ` ${b.unit}` : ""}` })})`
          }`;
    return `<div class="scale">
        <span class="muted">${esc(label)}</span>
        <button class="step" data-step="-1" aria-label="${esc(this._t("less"))}">−</button>
        <input id="amount" type="number" min="0" step="any" value="${roundAmount(b.base * k)}">
        <button class="step" data-step="1" aria-label="${esc(this._t("more"))}">+</button>
        ${b.unit ? `<span>${esc(b.unit)}</span>` : ""}
        <span style="width:4px"></span>${chips}
        <span class="hint">${esc(hint)}</span>
      </div>`;
  }
  _setScale(k) {
    if (!(k > 0) || !this._recipe) return;
    k = Math.round(k * 10000) / 10000;
    if (this._follows()) {
      this._srvScale = k;
      this._hass.callWS({ type: "hass_recipes/set_cooking", scale: k }).catch(() => {});
    } else {
      this._localScale = k;
      try {
        localStorage.setItem(`hass_recipes_card_scale_${this._recipe.id}`, String(k));
      } catch (_) { /* storage unavailable */ }
    }
    this._render();
  }
  _wireScale() {
    const root = this.shadowRoot;
    const r = this._recipe;
    if (!r) return;
    const b = scaleBasis(r);
    const amount = root.getElementById("amount");
    if (amount) amount.onchange = () => this._setScale(parseFloat(amount.value) / b.base);
    for (const chip of root.querySelectorAll("[data-scale]")) chip.onclick = () => this._setScale(parseFloat(chip.dataset.scale));
    for (const btn of root.querySelectorAll("[data-step]")) {
      btn.onclick = () => {
        const step = b.unit === "×" ? 0.5 : b.base >= 20 ? Math.round(b.base / 8) : 1;
        const next = b.base * this._scale() + step * parseInt(btn.dataset.step, 10);
        this._setScale(Math.max(step, Math.round(next * 100) / 100) / b.base);
      };
    }
  }
  /** Move to page `n` (0 = the ingredients page when there is one), on every card when following. */
  _goto(n, count) {
    n = Math.min(Math.max(n, 0), count - 1);
    if (this._follows()) {
      this._srvStep = n;
      this._hass.callWS({ type: "hass_recipes/set_cooking", step: n }).catch(() => {});
    } else {
      this._localStep = n;
      try {
        localStorage.setItem(`hass_recipes_card_${this._recipe.id}`, String(n));
      } catch (_) { /* storage unavailable */ }
    }
    this._render();
  }
  _toggle(set, value, id, which) {
    const p = loadProgress(id);
    const target = p[which];
    if (target.has(value)) target.delete(value);
    else target.add(value);
    saveProgress(id, p);
  }
  /** Hooks for cards built on this one (the kitchen card adds a recipe list). */
  _topHtml() {
    return "";
  }
  _afterHtml() {
    return "";
  }
  _compose(top, body, after) {
    return top + body + after;
  }
  _wireAfter() {}

  _render() {
    if (!this._config) return;
    const { html, wire } = this._cookBody();
    this._paint(this._compose(this._topHtml(), html, this._afterHtml()));
    this._wireTimers();
    this._wireScale();
    if (wire) wire();
    this._wireAfter();
  }

  _cookBody() {
    const r = this._recipe;
    if (!r) {
      return { html: `<div class="empty">${esc(this._error || this._t("loading"))}</div>${this._timersHtml()}` };
    }
    const { all, real, pages, hasIngs } = pagesFor(r);
    if (!pages.length) {
      return {
        html: `<div class="head"><span class="title">${esc(r.name)}</span></div><div class="empty">${esc(this._t("no_steps"))}</div>${this._timersHtml()}`,
      };
    }
    const n = Math.min(this._step(), pages.length - 1);
    const st = pages[n];
    const num = hasIngs ? n : n + 1; // step number among the real steps
    const k = this._scale();
    const mode = this._config.units === "original" ? "original" : "grams";
    const progress = loadProgress(r.id);
    const partsOf = (i) => ingParts((r.parsed_ingredients || [])[i], splitSubs(r.ingredients[i] ?? "").main, k, mode);
    // "or 180 g coconut oil" lines for every alternative of an ingredient
    const altsOf = (i) => {
      const p = (r.parsed_ingredients || [])[i] || {};
      const subs = p.substitutes || (p.substitute ? [p.substitute] : []);
      return splitSubs(r.ingredients[i] ?? "").alts.map((text, n) => {
        const b = ingParts(subs[n], text, k, mode);
        return `${b.qty ? `${b.qty} ` : ""}${b.food}`;
      });
    };
    let section = "";
    for (const x of all.slice(0, Math.max(st.i, 0))) if (x.section) section = x.text;
    const ings = st.ingredients
      .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
      .map((i) => {
        const a = partsOf(i);
        return `<span class="ing">${a.qty ? `${esc(a.qty)} ` : ""}${esc(a.food)}</span>`;
      })
      .join("");
    const ingredientsPage = st.page === "ingredients";
    const stepDone = !ingredientsPage && progress.steps.has(st.i);
    const body = ingredientsPage
      ? `${this._scaleControlHtml(r, k)}<div class="ilist">${r.ingredients
          .map((t, i) => {
            if (isHeader(t)) return `<div class="ihead">${esc(headerText(t))}</div>`;
            const a = partsOf(i);
            const on = progress.ing.has(i);
            return `<label class="irow${on ? " on" : ""}"><input type="checkbox" data-ing="${i}" ${on ? "checked" : ""}>
              <span class="itext">${a.qty ? `<span class="q">${esc(a.qty)}</span> ` : ""}<b>${esc(a.food)}</b>${
                a.note ? `<span class="muted">, ${esc(a.note)}</span>` : ""
              }${a.sub ? ` <span class="muted sub">${esc(a.sub)}</span>` : ""}${altsOf(i)
                .map((alt) => `<span class="muted alt">${esc(this._t("or"))} ${esc(alt)}</span>`)
                .join("")}</span></label>`;
          })
          .join("")}</div>`
      : `<div class="text${stepDone ? " done" : ""}" data-done-toggle="${st.i}">${esc(st.text)}</div>
         <button class="btn donebtn${stepDone ? " p" : ""}" data-done="${st.i}"><ha-icon icon="mdi:${stepDone ? "check-circle" : "check-circle-outline"}"></ha-icon>${esc(
           this._t(stepDone ? "is_done" : "mark_done")
         )}</button>`;
    const specs = timerSpecs(r, st.i, num, st.timers || [], this._hass && this._hass.language);
    const timerButtons = specs
      .map((sp) => {
        const running = (this._timers || []).find((t) => t.key === sp.key && !t.done);
        const what = sp.name ? ` (${esc(sp.name)})` : "";
        return `<button class="btn" data-timer-key="${esc(sp.key)}" ${running ? "disabled" : ""}><ha-icon icon="mdi:timer-outline"></ha-icon>${
          running ? clock(this._left(running)) : esc(this._t("timer", { t: lengthText(sp.seconds) })) + what
        }</button>`;
      })
      .join("");
    const last = n === pages.length - 1;
    const html = `
      <style>
        .body { padding: 4px 16px 16px; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; touch-action: pan-y; }
        .content { padding-right: 4px; }
        .progress { height: 4px; border-radius: 2px; background: var(--divider-color); margin: 8px 0 16px; overflow: hidden; }
        .progress i { display: block; height: 100%; background: var(--primary-color); }
        .section { text-transform: uppercase; letter-spacing: .06em; font-size: calc(12px * var(--hr-fs, 1)); color: var(--primary-color); margin-bottom: 6px; }
        .text { font-size: calc(18px * var(--hr-fs, 1)); line-height: 1.45; font-weight: 500; margin-bottom: 12px; }
        .text.done { opacity: .55; text-decoration: line-through; }
        .donebtn { margin-bottom: 12px; }
        .ings { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
        .ing { font-size: calc(13px * var(--hr-fs, 1)); padding: 3px 10px; border-radius: 8px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); border: 1px solid color-mix(in srgb, var(--primary-color) 28%, transparent); }
        .scale { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0 0 14px; }
        .scale .step { width: 30px; height: 30px; padding: 0; border: 1px solid var(--divider-color); border-radius: 8px; background: none; color: inherit; font-size: 18px; line-height: 1; }
        .scale input { width: 64px; text-align: center; font: inherit; color: inherit; background: var(--secondary-background-color); border: 1px solid var(--divider-color); border-radius: 8px; padding: 4px 6px; box-sizing: border-box; }
        .scale .chip { font-size: 12px; padding: 3px 9px; border-radius: 12px; border: 1px solid var(--divider-color); background: none; color: inherit; }
        .scale .chip.active { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .scale .hint { flex-basis: 100%; font-size: 12px; color: var(--secondary-text-color); }
        .ilist { margin-bottom: 14px; }
        .ihead { text-transform: uppercase; letter-spacing: .06em; font-size: calc(12px * var(--hr-fs, 1)); color: var(--primary-color); margin: 12px 0 4px; }
        .ihead:first-child { margin-top: 0; }
        .irow { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--divider-color); font-size: calc(15px * var(--hr-fs, 1)); cursor: pointer; }
        .irow input { margin-top: 3px; width: 18px; height: 18px; flex: none; accent-color: var(--primary-color); }
        .irow.on .itext { opacity: .55; text-decoration: line-through; }
        .irow .q { font-variant-numeric: tabular-nums; }
        .irow .sub { font-size: 12px; }
        .timer-btns { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
        .irow .alt { display: block; font-size: 12px; }
        .nav { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
        .nav .next { margin-left: auto; }
      </style>
      <div class="head"><span class="title">${esc(r.name)}</span><span class="muted">${
        ingredientsPage ? esc(this._t("ingredients")) : esc(this._t("step_of", { n: num, total: real.length }))
      }${stepDone ? " ✓" : ""}${!ingredientsPage && k !== 1 ? ` · ${formatNumber(k)}×` : ""}</span></div>
      <div class="body">
        <div class="progress"><i style="width:${((n + 1) / pages.length) * 100}%"></i></div>
        <div class="content scroll" style="${this._scrollRegion(Number(this._config.content_height ?? 480))}">
          ${section ? `<div class="section">${esc(section)}</div>` : ""}
          ${body}
          ${ings ? `<div class="ings">${ings}</div>` : ""}
        </div>
        ${timerButtons ? `<div class="timer-btns">${timerButtons}</div>` : ""}
        <div class="nav">
          <button class="btn" id="prev" ${n === 0 ? "disabled" : ""}><ha-icon icon="mdi:arrow-left"></ha-icon>${esc(this._t("back"))}</button>
          <button class="btn p next" id="next">${esc(this._t(last ? "start_over" : "next"))}<ha-icon icon="mdi:${last ? "restart" : "arrow-right"}"></ha-icon></button>
        </div>
        ${this._timersHtml()}
      </div>`;
    const wire = () => {
      const root = this.shadowRoot;
      const finish = () => {
        // starting over clears this recipe's ticks, as the panel does when every step is done
        saveProgress(r.id, { ing: new Set(), steps: new Set() });
        this._goto(0, pages.length);
      };
      root.getElementById("prev").onclick = () => this._goto(n - 1, pages.length);
      root.getElementById("next").onclick = () => (last ? finish() : this._goto(n + 1, pages.length));
      for (const btn of root.querySelectorAll("[data-timer-key]")) {
        btn.onclick = () => {
          const sp = specs.find((s) => s.key === btn.dataset.timerKey);
          if (sp)
            this._timerCall({
              type: "hass_recipes/timer_start",
              key: sp.key,
              label: sp.label,
              seconds: sp.seconds,
              recipe_id: r.id,
              step: st.i,
            });
        };
      }
      for (const box of root.querySelectorAll("[data-ing]")) {
        box.onchange = () => this._toggle(null, parseInt(box.dataset.ing, 10), r.id, "ing");
      }
      for (const el of root.querySelectorAll("[data-done], [data-done-toggle]")) {
        el.onclick = () => this._toggle(null, parseInt(el.dataset.done ?? el.dataset.doneToggle, 10), r.id, "steps");
      }
      // swipe left for the next page, right for the previous one
      const body = root.querySelector(".body");
      if (body && this._config.swipe !== false) {
        let start = null;
        body.addEventListener("touchstart", (e) => {
          const t = e.changedTouches[0];
          start = { x: t.clientX, y: t.clientY };
        }, { passive: true });
        body.addEventListener("touchend", (e) => {
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          start = null;
          if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
          if (dx < 0 && !last) this._goto(n + 1, pages.length);
          else if (dx > 0 && n > 0) this._goto(n - 1, pages.length);
        });
      }
    };
    return { html, wire };
  }
}

/* ---- kitchen: the list and the cook card as one mini app ----------------- */
class HassRecipesKitchenCard extends HassRecipesCookCard {
  getGridOptions() {
    const wide = this._config?.layout === "horizontal" && this._config?.show !== "list" && this._config?.show !== "steps";
    return { columns: wide ? 12 : 6, min_columns: wide ? 6 : 3, rows: "auto", min_rows: 4 };
  }
  static getStubConfig() {
    return { limit: 20 };
  }
  setConfig(config) {
    // always follows the shared cooking recipe (the one chosen here and in the Recipes panel)
    this._query = this._query || "";
    super.setConfig({ limit: 20, show_search: true, ...config, recipe: "" });
  }
  getCardSize() {
    return 7;
  }
  /** layout: "app" (default, a two-screen mini app), "vertical" or "horizontal" (both at once). */
  _layout() {
    const l = this._config.layout;
    return l === "vertical" || l === "horizontal" ? l : "app";
  }
  /** "both" shows recipe and list together; otherwise one screen at a time: "cook" or "list". */
  _screen() {
    // show: "list" or "steps" pins the card to one part; anything else follows `layout`
    if (this._config.show === "list") return "list";
    if (this._config.show === "steps") return "cook";
    if (this._layout() !== "app") return "both";
    if (!this._recipe) return "list"; // nothing chosen yet, or the chosen recipe was deleted
    return this._view || "cook";
  }
  _cookBody() {
    const s = this._screen();
    return s === "list" ? { html: "" } : super._cookBody();
  }
  _compose(top, body, after) {
    if (this._screen() !== "both") return top + body + after;
    if (this._layout() !== "horizontal") {
      return `<style>
          .vpart { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
          .vpart.cp { flex: 3 1 auto; }
          .vpart.lp { flex: 2 1 auto; }
        </style><div class="vpart cp">${top}${body}</div><div class="vpart lp">${after}</div>`;
    }
    return `<style>
        :host { container-type: inline-size; }
        .split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); flex: 1 1 auto; min-height: 0; }
        .split .side { border-right: 1px solid var(--divider-color); min-width: 0; min-height: 0; display: flex; flex-direction: column; }
        .split .main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
        @container (max-width: 560px) {
          .split { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 3fr) minmax(0, 2fr); }
          .split .side { border-right: 0; border-bottom: 1px solid var(--divider-color); order: 2; }
        }
      </style>
      <div class="split"><div class="side">${after}</div><div class="main">${body}</div></div>`;
  }
  _topHtml() {
    if (this._screen() !== "cook" || this._config.show === "steps") return ""; // nothing to go back to
    return `<div class="appbar"><button class="btn" id="back"><ha-icon icon="mdi:arrow-left"></ha-icon>${esc(this._t("recipes"))}</button></div>
      <style>.appbar { padding: 10px 16px 0; }</style>`;
  }
  _matches() {
    const c = this._config;
    const q = this._query.trim().toLowerCase();
    return (this._all || [])
      .filter((r) => {
        if (c.category && !(r.categories || []).includes(c.category)) return false;
        if (c.tag && !(r.tags || []).includes(c.tag)) return false;
        if (!q) return true;
        return [r.name, ...(r.tags || []), ...(r.categories || []), ...(r.ingredients || [])]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .slice(0, c.limit);
  }
  _afterHtml() {
    const screen = this._screen();
    if (screen === "cook") return "";
    const both = screen === "both";
    const resume = !both && this._recipe && this._config.show !== "list"
      ? `<button class="btn p" id="resume"><ha-icon icon="mdi:chef-hat"></ha-icon>${esc(this._recipe.name)}</button>`
      : "";
    const rows = this._matches()
      .map((r) => {
        const meta = [r.total_time ? minutes(r.total_time) : "", (r.categories || [])[0] || ""].filter(Boolean).join(" · ");
        const img = r.image ? `style="background-image:url('${esc(r.image)}')"` : "";
        const on = r.id === this._chosen;
        return `<div class="lrow${on ? " on" : ""}" data-pick="${esc(r.id)}" tabindex="0" title="${esc(this._t("cook_this"))}">
          <div class="thumb" ${img}>${r.image ? "" : '<ha-icon icon="mdi:silverware-fork-knife"></ha-icon>'}</div>
          <div style="flex:1;min-width:0"><div class="lname">${esc(r.name)}</div><div class="muted">${esc(meta)}</div></div>
          ${on ? '<ha-icon icon="mdi:chef-hat" style="color:var(--primary-color)"></ha-icon>' : ""}
          <button class="btn" data-open="${esc(r.id)}" title="${esc(this._t("open_in"))}"><ha-icon icon="mdi:open-in-new"></ha-icon></button></div>`;
      })
      .join("");
    const search = this._config.show_search
      ? `<div style="padding:6px 16px 10px"><input type="search" id="q" placeholder="${esc(this._t("search"))}" value="${esc(this._query)}"></div>`
      : "";
    return `<style>
        .lhead { border-top: 1px solid var(--divider-color); display: flex; justify-content: space-between; align-items: center; padding: 12px 16px 4px; }
        .lrow { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--divider-color); cursor: pointer; }
        .lrow:hover, .lrow:focus-visible { background: var(--secondary-background-color); outline: 0; }
        .lrow.on { background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
        .lname { font-size: calc(14px * var(--hr-fs, 1)); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="lhead" style="${both && this._layout() === "vertical" ? "" : "border-top:0"}"><span class="title">${esc(this._t("recipes"))}</span>
        <span style="display:flex;gap:8px">${resume}<button class="btn" id="all">${esc(this._t("open_recipes"))}</button></span></div>
      ${search}<div class="scroll" style="${this._scrollStyle(320)}">${rows || `<div class="empty">${esc(this._t("no_recipes"))}</div>`}</div>${
        both ? "" : this._timersHtml()
      }`;
  }
  _wireAfter() {
    const root = this.shadowRoot;
    const back = root.getElementById("back");
    if (back)
      back.onclick = () => {
        this._view = "list";
        this._render();
      };
    const resume = root.getElementById("resume");
    if (resume)
      resume.onclick = () => {
        this._view = "cook";
        this._render();
      };
    const all = root.getElementById("all");
    if (all) all.onclick = () => this._openPath("/recipes");
    const pick = async (id) => {
      this._chosen = id;
      this._view = "cook";
      const chosen = (this._all || []).find((r) => r.id === id);
      if (chosen) {
        this._recipe = chosen;
        this._srvStep = 0;
        this._srvScale = chosen.default_scale || 1;
      }
      this._render();
      try {
        await this._hass.callWS({ type: "hass_recipes/set_cooking", recipe_id: id });
      } catch (err) {
        this._error = err.message;
      }
    };
    for (const row of root.querySelectorAll("[data-pick]")) {
      row.onclick = () => pick(row.dataset.pick);
      row.onkeydown = (e) => (e.key === "Enter" ? pick(row.dataset.pick) : null);
    }
    for (const b of root.querySelectorAll("[data-open]")) {
      b.onclick = (e) => {
        e.stopPropagation();
        this._openPath(`/recipes#/recipe/${b.dataset.open}`);
      };
    }
    const input = root.getElementById("q");
    if (input)
      input.oninput = () => {
        this._query = input.value;
        this._render();
      };
  }
  _render() {
    // the 1 s timer tick repaints the card: keep the caret in the search box
    const active = this.shadowRoot.activeElement;
    const typing = active && active.id === "q" ? { at: active.selectionStart } : null;
    super._render();
    if (typing) {
      // the repainted ha-card is not focusable until it has been laid out
      requestAnimationFrame(() => {
        const input = this.shadowRoot.getElementById("q");
        if (input && !this.shadowRoot.activeElement) {
          input.focus();
          input.setSelectionRange(typing.at, typing.at);
        }
      });
    }
  }
}

/* ---- meal plan ------------------------------------------------------------ */
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PLAN_SLOTS = ["breakfast", "lunch", "dinner", "snack"];

class HassRecipesPlanCard extends RecipesBase {
  getGridOptions() {
    return { columns: 6, min_columns: 3, rows: "auto", min_rows: 3 };
  }
  static getStubConfig() {
    return { days: 3 };
  }
  setConfig(config) {
    this._config = { days: 3, tap: "cook", ...config };
    if (this._entries) this._render();
  }
  getCardSize() {
    return 2 + Math.min(Number(this._config?.days) || 3, 6);
  }
  async _start() {
    this._started = true;
    await this._load();
    this._sub(() => this._hass.connection.subscribeEvents(() => this._load(), "hass_recipes_meal_plan_changed"));
    this._sub(() => this._hass.connection.subscribeEvents(() => this._load(), "hass_recipes_recipe_updated"));
    // a card left open overnight moves on to the new day
    this._today = isoLocal(new Date());
    this._tick = setInterval(() => {
      if (isoLocal(new Date()) !== this._today) {
        this._today = isoLocal(new Date());
        this._load();
      }
    }, 60000);
  }
  _days() {
    const n = Math.min(Math.max(Number(this._config.days) || 3, 1), 14);
    const now = new Date();
    return [...Array(n)].map((_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12));
  }
  async _load() {
    try {
      const days = this._days();
      const res = await this._hass.callWS({
        type: "hass_recipes/plan_list",
        start: isoLocal(days[0]),
        end: isoLocal(days[days.length - 1]),
      });
      this._entries = res.entries;
      this._error = "";
    } catch (err) {
      this._error = err.message || "Could not load the meal plan";
    }
    this._render();
  }
  _dayLabel(d, i) {
    if (i === 0) return this._t("plan_today");
    if (i === 1) return this._t("plan_tomorrow");
    const lang = this._hass?.language || undefined;
    return new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "short" }).format(d);
  }
  _render() {
    if (!this._config) return;
    const title = this._config.title ?? this._t("plan_title");
    const slots = Array.isArray(this._config.slots) && this._config.slots.length ? this._config.slots : PLAN_SLOTS;
    let body;
    if (this._error) body = `<div class="empty">${esc(this._error)}</div>`;
    else if (!this._entries) body = `<div class="empty">${esc(this._t("loading"))}</div>`;
    else {
      const rows = this._days()
        .map((d, i) => {
          const iso = isoLocal(d);
          const here = this._entries.filter((e) => e.date === iso && slots.includes(e.slot));
          if (!here.length && i > 0 && !this._config.show_empty) return "";
          const meals = here.length
            ? here
                .map((e) => {
                  const img = e.image ? `style="background-image:url('${esc(e.image)}')"` : "";
                  const meta = [this._t(`slot_${e.slot}`), e.total_time ? minutes(e.total_time) : "", e.note].filter(Boolean).join(" · ");
                  const playable = e.recipe_exists;
                  return `<div class="meal${playable ? " go" : ""}" ${playable ? `data-meal="${esc(e.id)}" data-recipe="${esc(e.recipe_id)}" tabindex="0"` : ""}>
                    <div class="thumb" ${img}>${e.image ? "" : '<ha-icon icon="mdi:silverware-fork-knife"></ha-icon>'}</div>
                    <div style="flex:1;min-width:0"><div class="mname">${esc(e.title)}</div><div class="muted">${esc(meta)}</div></div>
                    ${playable ? `<ha-icon icon="mdi:${this._config.tap === "open" ? "open-in-new" : "chef-hat"}" style="color:var(--primary-color)"></ha-icon>` : ""}</div>`;
                })
                .join("")
            : `<div class="muted" style="padding:6px 16px 10px">${esc(this._t("plan_nothing"))}</div>`;
          return `<div class="pday"><div class="pdayhead">${esc(this._dayLabel(d, i))}</div>${meals}</div>`;
        })
        .join("");
      body = rows || `<div class="empty">${esc(this._t("plan_nothing"))}</div>`;
    }
    this._paint(`
      <style>
        .pday { border-top: 1px solid var(--divider-color); }
        .pdayhead { padding: 10px 16px 4px; font-size: calc(12px * var(--hr-fs, 1)); text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); }
        .meal { display: flex; align-items: center; gap: 12px; padding: 6px 16px; }
        .meal.go { cursor: pointer; }
        .meal.go:hover, .meal.go:focus-visible { background: var(--secondary-background-color); outline: 0; }
        .mname { font-size: calc(14px * var(--hr-fs, 1)); font-weight: 500; overflow-wrap: anywhere; }
      </style>
      <div class="head"><span class="title">${esc(title)}</span>
        <button class="btn" id="open">${esc(this._t("open_recipes"))}</button></div>
      <div class="scroll" style="${this._scrollStyle(480)}">${body}</div>`);
    const root = this.shadowRoot;
    root.getElementById("open").onclick = () => this._openPath("/recipes#/plan");
    const act = async (el) => {
      if (this._config.tap === "open") return this._openPath(`/recipes#/recipe/${el.dataset.recipe}`);
      try {
        await this._hass.callWS({ type: "hass_recipes/plan_cook", entry_id: el.dataset.meal });
      } catch (err) {
        this._error = err.message;
        this._render();
      }
    };
    for (const el of root.querySelectorAll("[data-meal]")) {
      el.onclick = () => act(el);
      el.onkeydown = (e) => (e.key === "Enter" ? act(el) : null);
    }
  }
}

/* ---- visual editor ------------------------------------------------------- */
/** HA only loads ha-form when one of its own card editors is opened; make sure it exists. */
const ensureHaForm = async () => {
  if (customElements.get("ha-form")) return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    await card.constructor.getConfigElement();
  } catch (_) { /* fall through to the timeout below */ }
  await Promise.race([customElements.whenDefined("ha-form"), new Promise((r) => setTimeout(r, 3000))]);
};

class HassRecipesCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._options = { recipes: [], categories: [], tags: [] };
  }
  setConfig(config) {
    this._config = config || {};
    this._paint();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (first) this._loadOptions();
  }
  _t(key) {
    return translate(this._hass, key);
  }
  async _loadOptions() {
    try {
      const { recipes } = await this._hass.callWS({ type: "hass_recipes/list" });
      const uniq = (key) => [...new Set(recipes.flatMap((r) => r[key] || []))].sort((a, b) => a.localeCompare(b));
      this._options = {
        recipes: recipes.map((r) => ({ value: r.id, label: r.name })),
        categories: uniq("categories"),
        tags: uniq("tags"),
      };
    } catch (_) { /* the form still works with free text */ }
    this._paint();
  }
  _schema() {
    const t = (k) => this._t(k);
    const select = (name, options, extra = {}) => ({ name, selector: { select: { mode: "dropdown", options, ...extra } } });
    const num = (name, max = 2000) => ({ name, selector: { number: { min: 0, max, step: name === "limit" ? 1 : 10, mode: "box" } } });
    const pick = (name, items, any) => select(name, [{ value: "", label: any }, ...items]);
    const list = [
      { name: "limit", selector: { number: { min: 1, max: 500, mode: "box" } } },
      num("list_height"),
      { name: "show_search", selector: { boolean: {} } },
      pick("category", this._options.categories.map((v) => ({ value: v, label: v })), t("opt_any_category")),
      pick("tag", this._options.tags.map((v) => ({ value: v, label: v })), t("opt_any_tag")),
    ];
    const units = select("units", [
      { value: "grams", label: t("opt_grams") },
      { value: "original", label: t("opt_original") },
    ]);
    const cooking = [
      num("content_height"),
      select("text_size", [
        { value: "normal", label: t("opt_size_normal") },
        { value: "large", label: t("opt_size_large") },
        { value: "xlarge", label: t("opt_size_xlarge") },
      ]),
      { name: "swipe", selector: { boolean: {} } },
      { name: "keep_awake", selector: { boolean: {} } },
      units,
    ];
    switch (this.kind) {
      case "plan":
        return [
          { name: "title", selector: { text: {} } },
          { name: "days", selector: { number: { min: 1, max: 14, mode: "box" } } },
          {
            name: "slots",
            selector: {
              select: {
                multiple: true,
                mode: "list",
                options: ["breakfast", "lunch", "dinner", "snack"].map((v) => ({ value: v, label: t(`slot_${v}`) })),
              },
            },
          },
          select("tap", [
            { value: "cook", label: t("opt_tap_cook") },
            { value: "open", label: t("opt_tap_open") },
          ]),
          { name: "show_empty", selector: { boolean: {} } },
          num("list_height"),
        ];
      case "list":
        return [{ name: "title", selector: { text: {} } }, ...list];
      case "cooking":
        return [{ name: "title", selector: { text: {} } }];
      case "cook":
        return [
          select(
            "recipe",
            [{ value: "", label: t("opt_recipe_chosen") }, ...this._options.recipes],
            { custom_value: true }
          ),
          ...cooking,
        ];
      default: // kitchen
        return [
          select("show", [
            { value: "all", label: t("opt_show_all") },
            { value: "list", label: t("opt_show_list") },
            { value: "steps", label: t("opt_show_steps") },
          ]),
          select("layout", [
            { value: "app", label: t("opt_layout_app") },
            { value: "vertical", label: t("opt_layout_vertical") },
            { value: "horizontal", label: t("opt_layout_horizontal") },
          ]),
          ...list,
          ...cooking,
        ];
    }
  }
  async _paint() {
    if (!this._config || !this._hass) return;
    await ensureHaForm();
    if (!this._form) {
      this.shadowRoot.innerHTML = "<style>:host{display:block}</style>";
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._t(`ed_${s.name}`);
      this._form.computeHelper = (s) => (["recipe", "units", "list_height"].includes(s.name) ? this._t(`help_${s.name}`) : "");
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...this._config, ...ev.detail.value };
        for (const key of Object.keys(config)) {
          const v = config[key];
          if (v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length)) delete config[key];
        }
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.shadowRoot.append(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    // empty values are stripped from the saved config, so show them as empty again
    const data = { ...this._config };
    for (const item of this._form.schema) {
      if (data[item.name] === undefined && item.selector.select) data[item.name] = item.selector.select.multiple ? [] : "";
    }
    if (this.kind === "plan" && !data.tap) data.tap = "cook";
    if (this.kind === "kitchen") {
      if (!data.layout) data.layout = "app";
      if (!data.show) data.show = "all";
    }
    if (this.kind === "kitchen" || this.kind === "cook") {
      if (!data.text_size) data.text_size = "normal";
      if (data.swipe === undefined) data.swipe = true;
    }
    this._form.data = data;
  }
}
if (!customElements.get("hass-recipes-card-editor")) customElements.define("hass-recipes-card-editor", HassRecipesCardEditor);

const editorFor = (kind) => () => {
  const el = document.createElement("hass-recipes-card-editor");
  el.kind = kind;
  return el;
};
HassRecipesListCard.getConfigElement = editorFor("list");
HassRecipesCookingCard.getConfigElement = editorFor("cooking");
HassRecipesCookCard.getConfigElement = editorFor("cook");
HassRecipesKitchenCard.getConfigElement = editorFor("kitchen");
HassRecipesPlanCard.getConfigElement = editorFor("plan");

for (const [tag, cls, name, description] of [
  ["hass-recipes-list-card", HassRecipesListCard, "Recipes list", "Search and open your recipes"],
  ["hass-recipes-cooking-card", HassRecipesCookingCard, "Recipe timers", "Live kitchen timers with a stop button"],
  ["hass-recipes-cook-card", HassRecipesCookCard, "Recipe cook mode", "Cook one recipe a step at a time"],
  ["hass-recipes-kitchen-card", HassRecipesKitchenCard, "Recipe kitchen", "Cook mode with the recipe list underneath"],
  ["hass-recipes-plan-card", HassRecipesPlanCard, "Meal plan", "What is planned for the coming days"],
]) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description });
}
