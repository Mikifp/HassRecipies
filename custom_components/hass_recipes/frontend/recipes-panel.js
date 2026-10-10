/* Recipes panel: dependency-free web component rendered in the HA sidebar. */

// Shared helpers (also used by the dashboard cards), versioned like this file.
const __v = new URL(import.meta.url).searchParams.get("v");
const {
  esc,
  minutes,
  parseNumber,
  formatNumber,
  scaleIngredient,
  baseServings,
  normStep,
  isHeader,
  headerText,
  splitSub,
  joinSub,
  clock,
  duration,
  fmtGrams,
  COUNT_AS_ITEMS,
  ingredientText,
  ingParts,
  fmtYield,
  SCALES,
  scaleBasis,
  roundAmount, lengthText
} = await import(`./recipes-shared.js${__v ? `?v=${__v}` : ""}`);

// ---- dates for the meal plan (local time, ISO yyyy-mm-dd) ----
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
  return x;
};
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

const toInt = (v) => (v === "" || v == null ? null : Math.max(0, parseInt(v, 10) || 0));

const TODO_KEY = "hass_recipes_todo";

/** HTML for ingredient `i`: amount + bold food, faded original amount, optional substitute. */
const ingredientHtml = (r, i, k, mode) => {
  const [main, altText] = splitSub(r.ingredients[i] ?? "");
  const p = (r.parsed_ingredients || [])[i];
  const a = ingParts(p, main, k, mode);
  let html = `<span class="ing-main">${a.qty ? `<span class="ing-qty">${esc(a.qty)}</span> ` : ""}<strong>${esc(a.food)}</strong>${a.note ? `<span class="ing-note">, ${esc(a.note)}</span>` : ""}</span>`;
  if (a.sub) html += `<small class="ing-sub">${esc(a.sub)}</small>`;
  if (altText) {
    const b = ingParts(p && p.substitute, altText, k, mode);
    html += `<small class="ing-alt">or ${b.qty ? `${esc(b.qty)} ` : ""}<strong>${esc(b.food)}</strong>${b.note ? `, ${esc(b.note)}` : ""}${b.sub ? ` <span class="ing-sub">(${esc(b.sub)})</span>` : ""}</small>`;
  }
  return html;
};

/** Compact "amount food" pill for the ingredients a step uses. */
const ingredientChipHtml = (r, i, k, mode) => {
  const [main] = splitSub(r.ingredients[i] ?? "");
  const a = ingParts((r.parsed_ingredients || [])[i], main, k, mode);
  return `<span class="ing-chip">${a.qty ? `<span class="q">${esc(a.qty)}</span>` : ""}<b>${esc(a.food)}</b></span>`;
};

/** Plain-text line including the substitute (used for printing). */
const ingredientPlain = (r, i, k, mode) => {
  const [, altText] = splitSub(r.ingredients[i] ?? "");
  let text = ingredientText(r, i, k, mode);
  if (altText) {
    const b = ingParts(((r.parsed_ingredients || [])[i] || {}).substitute, altText, k, mode);
    text += ` — or ${b.qty ? `${b.qty} ` : ""}${b.food}`;
  }
  return text;
};

const PROGRESS_KEY = "hass_recipes_progress";

const HANDLED_KEY = "hass_recipes_timers_handled";

const STYLE = `
  :host { display: block; height: 100%; overflow: auto; container-type: inline-size; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  * { box-sizing: border-box; }
  .sticky { position: sticky; top: 0; z-index: 2; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .timers:empty { display: none; }
  .timers { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; background: var(--secondary-background-color); border-bottom: 1px solid var(--divider-color); }
  .timer { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 16px; background: var(--card-background-color); border: 1px solid var(--divider-color); font-size: 14px; }
  .timer .t-time { font-variant-numeric: tabular-nums; font-weight: 600; }
  .timer.done { background: var(--error-color, #db4437); color: #fff; border-color: transparent; animation: pulse 1s infinite; }
  .timer button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; }
  .timer button.stop { background: #fff; color: var(--error-color, #db4437); border-radius: 12px; padding: 2px 12px; font-weight: 600; }
  @keyframes pulse { 50% { opacity: .6; } }
  header h1 { font-size: 20px; font-weight: 400; margin: 0; flex: 1; }
  header .menu { background: none; border: 0; color: inherit; cursor: pointer; padding: 4px; }
  main { max-width: 1200px; margin: 0 auto; padding: 16px; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  input, textarea, select { font: inherit; color: inherit; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px 10px; width: 100%; }
  .toolbar input { flex: 1; min-width: 180px; width: auto; }
  button.btn { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 8px 14px; background: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.btn.secondary { background: transparent; color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  button.btn.danger { background: var(--error-color, #db4437); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { padding: 3px 10px; border-radius: 12px; font-size: 13px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); cursor: pointer; }
  .chip.active { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  /* ---- recipe browser: filter rail + card grid (wide) / compact list (narrow) ---- */
  .browse { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 20px; align-items: start; }
  .rail { position: sticky; top: 72px; font-size: 14px; }
  .rail h4 { margin: 18px 0 6px; font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); }
  .rail h4:first-child { margin-top: 0; }
  .rail-item { padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  .rail-item:hover { background: var(--secondary-background-color); }
  .rail-item.active { background: color-mix(in srgb, var(--primary-color) 16%, transparent); color: var(--primary-color); font-weight: 500; }
  .rail label { display: flex; align-items: center; gap: 8px; padding: 4px 4px; cursor: pointer; }
  .rail input[type=checkbox] { width: auto; margin: 0; }
  .mfilters { display: none; }
  .mfilters details { margin-bottom: 12px; }
  .mfilters summary { cursor: pointer; font-size: 13px; color: var(--secondary-text-color); margin-bottom: 8px; }
  .only-mob { display: none; }
  .recipes { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; }
  .item { position: relative; background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px); box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; }
  .item .thumb { height: 130px; background: var(--secondary-background-color) center/cover no-repeat; display: flex; align-items: center; justify-content: center; font-size: 34px; }
  .item .body { padding: 10px 12px 12px; min-width: 0; }
  .item h3 { margin: 0 0 4px; font-size: 15px; font-weight: 500; line-height: 1.3; }
  .item .cat { display: inline-block; margin-top: 6px; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color); }
  .item .chev { display: none; color: var(--secondary-text-color); font-size: 22px; padding-right: 4px; }
  @container (max-width: 680px) {
    main { padding: 12px; }
    .browse { grid-template-columns: 1fr; gap: 0; }
    .rail { display: none; }
    .mfilters { display: block; }
    .only-desk { display: none; }
    .only-mob { display: block; }
    .recipes { grid-template-columns: 1fr; gap: 8px; }
    .item { flex-direction: row; align-items: center; gap: 12px; padding: 8px 10px 8px 8px; }
    .item .thumb { width: 56px; height: 56px; flex: none; border-radius: 8px; font-size: 22px; }
    .item .body { padding: 0; flex: 1; }
    .item h3 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .item .chev { display: block; }
    .item .cat { margin-top: 4px; }
    .toolbar { flex-wrap: nowrap; }
    .toolbar input { min-width: 0; }
  }
  .muted { color: var(--secondary-text-color); font-size: 13px; }
  .empty { text-align: center; padding: 48px 16px; color: var(--secondary-text-color); }
  .detail { background: var(--card-background-color); border-radius: 12px; overflow: hidden; box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); }
  .detail .hero { width: 100%; height: 240px; object-fit: cover; display: block; }
  .detail .content { padding: 16px 20px 24px; }
  .detail h2 { margin: 0 0 6px; font-weight: 500; font-size: 26px; line-height: 1.25; }
  .detail .lead { margin: 0 0 10px; color: var(--secondary-text-color); }
  .detail .chips { margin: 10px 0 18px; gap: 8px; }
  .detail .lead + .chips, .detail h2 + .chips { margin-top: 12px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 14px 0 18px; }
  .stat { border: 1px solid var(--divider-color); border-radius: 10px; padding: 8px 12px; text-align: center; background: var(--secondary-background-color); }
  .stat span { display: block; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color); }
  .stat b { display: block; font-size: 17px; font-weight: 500; margin-top: 2px; }
  .stat small { display: block; font-size: 11px; color: var(--secondary-text-color); }
  .tabs { display: none; }
  .cols { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 20px; align-items: start; }
  .pane { border: 1px solid var(--divider-color); border-radius: 12px; padding: 14px 16px; }
  .pane > h3 { margin: 0 0 10px; font-size: 12px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); }
  .pane.ingredients-pane { position: sticky; top: 72px; }
  .notes-pane { margin-top: 20px; }
  .bar { position: sticky; bottom: 10px; z-index: 1; display: flex; gap: 6px; max-width: 560px; margin: 16px auto 0; padding: 6px; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 14px; box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.25)); }
  .bar button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 0; border-radius: 10px; background: none; color: var(--primary-text-color); font: inherit; font-size: 12px; cursor: pointer; }
  .bar button.p { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .bar button.on { color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 16%, transparent); }
  .bar ha-icon { --mdc-icon-size: 22px; }
  .bar.bar-top { position: static; max-width: none; margin: 0 0 16px; box-shadow: none; }
  .bar.bar-bottom { display: none; }
  .more-actions { display: flex; gap: 14px; justify-content: center; margin: 14px 0 4px; font-size: 13px; }
  .more-actions button { background: none; border: 0; padding: 4px; cursor: pointer; font: inherit; color: var(--secondary-text-color); }
  .more-actions button.danger { color: var(--error-color, #db4437); }
  @container (max-width: 680px) {
    .detail .hero { height: 170px; }
    .detail .content { padding: 14px 14px 18px; }
    .detail h2 { font-size: 22px; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tabs { display: flex; margin: 4px 0 12px; border: 1px solid var(--divider-color); border-radius: 10px; overflow: hidden; }
    .tabs button { flex: 1; padding: 9px 4px; border: 0; background: none; font: inherit; font-size: 14px; color: var(--primary-text-color); cursor: pointer; }
    .tabs button + button { border-left: 1px solid var(--divider-color); }
    .tabs button.active { background: color-mix(in srgb, var(--primary-color) 16%, transparent); color: var(--primary-color); font-weight: 500; }
    .cols { grid-template-columns: 1fr; gap: 0; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    .pane.ingredients-pane { position: static; }
    .notes-pane { margin-top: 0; }
    .bar { max-width: none; }
    .bar.bar-top { display: none; }
    .bar.bar-bottom { display: flex; }
  }
  ul.ingredients { list-style: none; padding: 0; margin: 0; }
  ul.ingredients li { padding: 6px 0; border-bottom: 1px solid var(--divider-color); }
  ul.ingredients label { cursor: pointer; display: flex; gap: 8px; align-items: flex-start; }
  ul.ingredients input { width: auto; margin-top: 3px; }
  ul.ingredients input:checked + span { text-decoration: line-through; opacity: .6; }
  ol.steps { padding-left: 20px; margin: 0; }
  ol.steps li { margin-bottom: 12px; line-height: 1.5; }
  .step-ings { display: flex; flex-wrap: wrap; gap: 6px 8px; margin: 10px 0 2px; }
  .ing-chip { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; padding: 3px 10px; border-radius: 8px; font-size: 13px; line-height: 1.4; background: color-mix(in srgb, var(--primary-color) 9%, transparent); border: 1px solid color-mix(in srgb, var(--primary-color) 28%, transparent); }
  .ing-chip .q { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ing-chip b { font-weight: 500; }
  .timer-btn { margin-top: 10px; }
  .step { border: 1px solid var(--divider-color); border-radius: 8px; padding: 10px; margin-bottom: 12px; }
  .step-head { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .step-head .spacer { flex: 1; }
  .step-head button { background: none; border: 1px solid var(--divider-color); border-radius: 6px; color: inherit; cursor: pointer; padding: 2px 8px; font: inherit; }
  .step .timer-field { width: 160px; margin: 8px 0; }
  .step .chips { margin-bottom: 0; }
  .facet-label { font-size: 12px; color: var(--secondary-text-color); align-self: center; text-transform: uppercase; letter-spacing: .04em; }
  .units { margin-left: auto; }
  .ing-text { display: flex; flex-direction: column; }
  .ing-qty { font-variant-numeric: tabular-nums; }
  .ing-note { color: var(--secondary-text-color); }
  .ing-sub { color: var(--secondary-text-color); font-size: 12px; }
  .ing-alt { color: var(--secondary-text-color); font-size: 13px; font-style: italic; margin-top: 2px; }
  ul.ingredients li.section { font-weight: 600; font-size: 15px; padding: 14px 0 6px; border-bottom: 2px solid var(--divider-color); letter-spacing: .01em; }
  ul.ingredients li.section:first-child { padding-top: 2px; }
  .step-section { font-weight: 600; font-size: 1.05rem; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--divider-color); }
  .step-section:first-child { margin-top: 0; }
  .step-item { display: flex; gap: 12px; padding: 8px 6px; margin: 0 -6px 4px; border-radius: 10px; line-height: 1.5; cursor: pointer; }
  .step-item:hover { background: var(--secondary-background-color); }
  .step-item:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .step-num { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); background: var(--secondary-background-color); border: 1px solid var(--divider-color); margin-top: 1px; }
  .step-body { flex: 1; min-width: 0; }
  .step-item.done .step-num { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047); color: #fff; }
  .step-item.done .step-text { text-decoration: line-through; opacity: .55; }
  .cook-text[data-step-toggle] { cursor: pointer; }
  .cook-section { text-transform: uppercase; letter-spacing: .06em; font-size: .85rem; color: var(--primary-color); margin-top: 6px; }
  .cook-done { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; cursor: pointer; }
  .cook-done input { width: auto; }
  .ing-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
  .ing-row .ing-inputs { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .ing-row.is-header input[data-f=itext] { font-weight: 600; border-left: 4px solid var(--primary-color); }
  .ing-row input[data-f=isub] { font-size: 14px; font-style: italic; }
  .row-btns { display: flex; gap: 4px; }
  .row-btns button, .mini { background: none; border: 1px solid var(--divider-color); border-radius: 6px; color: inherit; cursor: pointer; padding: 4px 8px; font: inherit; }
  .mini.link { border: 0; text-align: left; padding: 0; color: var(--primary-color); font-size: 13px; }
  .step.is-section { border-left: 4px solid var(--primary-color); }
  .yield-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .yield-row input { width: auto; }
  .scale { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 0 16px; }
  .scale { flex-wrap: wrap; gap: 6px 4px; }
  .scale .chip { padding: 3px 9px; white-space: nowrap; }
  .scale input { width: 64px; flex: 0 0 auto; padding: 3px 6px; font-size: 14px; text-align: center; }
  .scale .step { width: 30px; height: 30px; padding: 0; border: 1px solid var(--divider-color); border-radius: 8px; background: none; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
  .scale .hint { flex-basis: 100%; font-size: 12px; color: var(--secondary-text-color); }
  .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  form .field { margin-bottom: 14px; }
  .multi-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .multi-chips:empty { display: none; }
  .multi-chip { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
  .multi-x { border: 0; background: none; color: inherit; cursor: pointer; padding: 0 0 0 2px; font-size: 11px; opacity: .8; }
  .multi-add select, .multi-new input { width: 100%; }
  .multi-new { display: flex; gap: 6px; }
  .multi-new[hidden], .multi-add select[hidden] { display: none; }
  form label.lbl { display: block; font-size: 13px; color: var(--secondary-text-color); margin-bottom: 4px; }
  form .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
  .img-field { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .img-preview { width: 140px; height: 105px; object-fit: cover; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--secondary-background-color); }
  .img-controls { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .img-controls .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  label.btn { display: inline-block; }
  .item.picked { outline: 3px solid var(--primary-color); }
  .item .pick { position: absolute; top: 8px; left: 8px; z-index: 1; width: 22px; height: 22px; border-radius: 50%; background: var(--card-background-color); border: 2px solid var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .item.picked .pick { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .bulkbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; margin-bottom: 12px; border-radius: 8px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); }
  .bulkbar input, .bulkbar select { width: auto; flex: 0 1 160px; }
  .cookbook-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: -6px 0 14px; }
  /* cook mode, Mealie style: ingredients beside the steps, steps as cards */
  .cookp .cook-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .cookp .cook-top h2 { margin: 0; font-size: 22px; font-weight: 500; flex: 1; min-width: 180px; }
  .cookp .cook-top .scale { margin: 0; }
  .cook-cols { display: grid; grid-template-columns: minmax(250px, 4fr) minmax(0, 8fr); gap: 20px; align-items: start; }
  .cook-ings { position: sticky; top: 72px; max-height: calc(100vh - 110px); overflow: auto; }
  .cook-steps h3.csection { margin: 22px 0 10px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--primary-color); font-weight: 500; }
  .cook-steps h3.csection:first-child { margin-top: 0; }
  .cstep { background: var(--card-background-color); border: 1px solid var(--divider-color); border-left: 4px solid var(--divider-color); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; cursor: pointer; }
  .cstep.current { border-left-color: var(--primary-color); box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.18)); }
  .cstep-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); margin-bottom: 6px; }
  .cstep .tick { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--divider-color); display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .cstep-text { font-size: 1.25rem; line-height: 1.55; }
  .cstep.done { border-left-color: var(--success-color, #43a047); }
  .cstep.done .cstep-text { text-decoration: line-through; opacity: .5; }
  .cstep.done .tick { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047); color: #fff; }
  .cstep .ing-chip { font-size: 14px; }
  @container (max-width: 680px) {
    .cook-cols { grid-template-columns: 1fr; gap: 14px; }
    .cook-ings { position: static; max-height: none; }
    .cstep-text { font-size: 1.15rem; }
  }
  .cook { max-width: 820px; margin: 0 auto; }
  .cook-progress { height: 6px; border-radius: 3px; background: var(--divider-color); margin: 8px 0 20px; overflow: hidden; }
  .cook-progress > div { height: 100%; background: var(--primary-color); }
  .cook-text { font-size: 1.7rem; line-height: 1.5; margin: 12px 0 20px; }
  .cook .step-ings { gap: 10px; margin: 4px 0 18px; }
  .cook .ing-chip { font-size: 1.05rem; padding: 6px 14px; border-radius: 10px; }
  .cook-nav { display: flex; gap: 12px; margin-top: 24px; }
  .cook-nav .btn { flex: 1; font-size: 1.2rem; padding: 18px; }
  .cook details { margin-top: 28px; }
  .cook summary { cursor: pointer; font-size: 1.1rem; }
  .error { color: var(--error-color, #db4437); margin: 8px 0; }
  .notice { margin: 0 0 12px; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); border: 1px solid var(--success-color, #43a047); }
  .panel { background: var(--card-background-color); border-radius: 12px; padding: 16px 20px; box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); }
`;

class HassRecipesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._recipes = [];
    this._tags = [];
    this._view = { name: "list" };
    this._search = "";
    // Multi-select facets: OR within a facet, AND across facets (same as cookbooks).
    this._sel = { categories: new Set(), tools: new Set(), tags: new Set() };
    this._cookbooks = [];
    this._cookbookId = null;
    this._select = false; // bulk-select mode
    this._picked = new Set();
    this._bulkField = "categories";
    this._bulkValue = "";
    this._cookIngredients = false;
    this._units = "grams"; // main amount in grams; the original is shown faded underneath
    this._bulk = null;
    this._error = "";
    this._loaded = false;
    this._narrow = false;
    this._scale = 1;
    this._checked = new Set();
    this._form = null;
    this._timers = [];
    this._skew = 0; // server clock minus browser clock, ms
    this._timerSig = "";
    this._shopSel = new Set();
    this._shopResult = null;
    this._dataMsg = null; // {kind: "ok"|"error"|"busy", text}
    this._imgBusy = false;
    // Browser-history integration: this._stack mirrors history.state.hrIdx so the
    // mouse "back" button / Alt+Left walk through panel views, not out of the app.
    this._stack = [];
    this._idx = 0;
    this._booted = false;
    this._doneSteps = new Set();
    this._tab = "ingredients"; // narrow layout: which pane of the recipe is showing
    this._notice = "";
    this._cookFocus = false; // false: whole recipe at once (Mealie style); true: one step at a time
    try {
      this._cookFocus = localStorage.getItem("hass_recipes_cookfocus") === "1";
    } catch (_) { /* ignore */ }
    this._formDirty = false;
    this._ignorePop = false;
    this._uid = 0;
    this._focusUid = null;
    // This module awaits its shared helpers before defining the element, so Home Assistant
    // may already have set hass/narrow/route/panel on the not-yet-upgraded element. Those
    // sit as plain own properties and would hide the setters: re-apply them through the class.
    for (const prop of ["panel", "route", "narrow", "hass"]) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete this[prop];
        this[prop] = value;
      }
    }
  }

  connectedCallback() {
    this._interval = setInterval(() => this._tick(), 1000);
    this._onKey = (e) => {
      if (this._view.name !== "cook" || !this._cookFocus || /INPUT|TEXTAREA|SELECT/.test(e.composedPath()[0]?.tagName || "")) return;
      if (e.key === "ArrowRight") this._cookStep(1);
      else if (e.key === "ArrowLeft") this._cookStep(-1);
    };
    this._onVisible = () => {
      if (document.visibilityState === "visible") this._syncWake();
    };
    this._onPop = () => this._popstate();
    this._onUnload = (e) => {
      if (this._view.name === "edit" && this._formDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", this._onUnload);
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("popstate", this._onPop);
    document.addEventListener("visibilitychange", this._onVisible);
  }
  disconnectedCallback() {
    clearInterval(this._interval);
    window.removeEventListener("keydown", this._onKey);
    window.removeEventListener("popstate", this._onPop);
    window.removeEventListener("beforeunload", this._onUnload);
    document.removeEventListener("visibilitychange", this._onVisible);
    this._releaseWake();
    if (this._unsubTimers) {
      this._unsubTimers();
      this._unsubTimers = null;
    }
  }

  // ---- keep the screen on while cooking ----
  async _syncWake() {
    const cooking = this._view.name === "cook";
    if (!cooking) return this._releaseWake();
    if (this._wake || !("wakeLock" in navigator)) return;
    try {
      this._wake = await navigator.wakeLock.request("screen");
      this._wake.addEventListener("release", () => (this._wake = null));
    } catch (_) { /* needs a secure context / user gesture; cooking still works */ }
  }
  _releaseWake() {
    if (this._wake) {
      this._wake.release().catch(() => {});
      this._wake = null;
    }
  }

  // ---- timers (kept on the server: shared across devices, fire HA events) ----
  _timerRunning(key) {
    return this._timers.some((t) => t.key === key && !t.done);
  }
  async _startTimer(key, label, seconds, recipeId, step) {
    if (this._timerRunning(key)) return;
    try {
      this._audio = this._audio || new AudioContext(); // created on a user gesture so the alarm can play
      this._audio.resume();
    } catch (_) { /* no audio */ }
    try {
      await this._ws({ type: "hass_recipes/timer_start", key, label, seconds, recipe_id: recipeId, step });
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }
  async _dismissTimer(id) {
    try {
      await this._ws({ type: "hass_recipes/timer_dismiss", timer_id: id });
    } catch (_) { /* the subscription will resync */ }
  }
  _onTimers(snapshot) {
    const wasDone = new Set(this._timers.filter((t) => t.done).map((t) => t.id));
    this._skew = snapshot.now_ms - Date.now();
    this._timers = snapshot.timers;
    if (this._timers.some((t) => t.done && !wasDone.has(t.id))) {
      this._lastBeep = Date.now();
      this._beep();
    }
    this._handleFinishedTimers(this._timers);
    if (!this._loaded) return;
    // Never rebuild a form the user may be typing in; just refresh the timer bar.
    if (["edit", "import"].includes(this._view.name)) this._renderTimers();
    else this._render();
  }
  _beep() {
    try {
      const ctx = this._audio;
      if (!ctx) return;
      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.2;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.35);
        osc.stop(ctx.currentTime + i * 0.35 + 0.2);
      }
    } catch (_) { /* ignore */ }
  }
  _tick() {
    this._renderTimers();
    const now = Date.now() + this._skew;
    const ringing = this._timers.some((t) => t.done && now - t.ends_at_ms < 5 * 60e3);
    if (ringing && Date.now() - (this._lastBeep || 0) > 7000) {
      this._lastBeep = Date.now();
      this._beep();
    }
  }
  _renderTimers() {
    const box = this.shadowRoot.getElementById("timers");
    if (!box) return;
    const sig = this._timers.map((t) => t.id + t.done).join("|");
    if (sig !== this._timerSig) {
      this._timerSig = sig;
      box.innerHTML = this._timers
        .map(
          (t) => `<div class="timer ${t.done ? "done" : ""}">
            <span>⏱ ${esc(t.label)}</span><span class="t-time" data-end="${t.ends_at_ms}"></span>
            <button data-dismiss="${esc(t.id)}" class="${t.done ? "stop" : ""}" title="${t.done ? "Stop the alarm" : "Cancel timer"}">${t.done ? "Stop" : "✕"}</button></div>`
        )
        .join("");
      box.querySelectorAll("[data-dismiss]").forEach((b) =>
        b.addEventListener("click", () => this._dismissTimer(b.dataset.dismiss))
      );
    }
    const now = Date.now() + this._skew;
    box.querySelectorAll(".t-time").forEach((el) => {
      const left = (+el.dataset.end - now) / 1000;
      el.textContent = left > 0 ? clock(left) : "Done!";
    });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._load();
      this._subscribeTimers();
    }
  }
  async _subscribeTimers() {
    try {
      this._unsubTimers = await this._hass.connection.subscribeMessage(
        (snapshot) => this._onTimers(snapshot),
        { type: "hass_recipes/subscribe_timers" }
      );
    } catch (err) {
      this._error = `Timers unavailable: ${err.message || err}`;
    }
  }
  set narrow(v) {
    if (this._narrow !== v) {
      this._narrow = v;
      if (this._loaded) this._render();
    }
  }

  async _ws(msg) {
    return this._hass.callWS(msg);
  }

  async _load() {
    try {
      const res = await this._ws({ type: "hass_recipes/list" });
      this._recipes = res.recipes;
      this._tags = res.tags;
      this._cookbooks = res.cookbooks || [];
      this._cookingId = res.cooking_recipe_id || null;
      if (this._cookbookId && !this._cookbooks.some((c) => c.id === this._cookbookId)) this._cookbookId = null;
      this._error = "";
    } catch (err) {
      this._error = err.message || String(err);
    }
    this._loaded = true;
    if (!this._booted) {
      this._booted = true;
      // Open straight to a deep link such as #/recipe/<id>, and make it history entry 0.
      const start = this._viewFromHash();
      const known = !start.id || this._recipe(start.id);
      this._stack = [known ? start : { name: "list" }];
      this._idx = 0;
      this._view = this._stack[0];
      if (this._view.name === "edit") this._initForm(this._view.id);
      this._loadProgress(this._view.id);
      const landed = this._view.id ? this._recipe(this._view.id) : null;
      if (landed && landed.default_scale) this._scale = landed.default_scale;
      try {
        history.replaceState({ ...(history.state || {}), hrIdx: 0 }, "", this._urlFor(this._view));
      } catch (_) { /* history unavailable */ }
    }
    this._render();
  }

  // ---- checked ingredients / done steps survive reloads (per recipe, 2 days) ----
  _readProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }
  _loadProgress(id) {
    let entry = id ? this._readProgress()[id] : null;
    // Checks older than two days are stale: ignore them even before they are pruned.
    if (entry && Date.now() - (entry.t || 0) > 2 * 864e5) entry = null;
    this._checked = new Set((entry && entry.ing) || []);
    this._doneSteps = new Set((entry && entry.steps) || []);
    // A recipe whose steps were all completed (e.g. by timers) starts fresh next time.
    const r = id ? this._recipe(id) : null;
    if (r && this._allDone(r)) {
      this._checked = new Set();
      this._doneSteps = new Set();
      this._saveProgress();
    }
  }

  _stepIndexes(r) {
    return r.instructions
      .map(normStep)
      .map((st, i) => (st.section ? -1 : i))
      .filter((i) => i >= 0);
  }
  _allDone(r) {
    const idx = this._stepIndexes(r);
    return idx.length > 0 && idx.every((i) => this._doneSteps.has(i));
  }

  /** Called after any step is checked: when every step is done, start over. */
  _checkAllDone() {
    clearTimeout(this._resetTimer);
    const r = this._recipe(this._view.id);
    if (!r || !this._allDone(r)) return;
    // a short pause so the finished state is visible before it resets
    this._resetTimer = setTimeout(() => {
      const cur = this._recipe(this._view.id);
      if (!cur || cur.id !== r.id || !this._allDone(cur)) return; // user un-ticked something
      this._checked = new Set();
      this._doneSteps = new Set();
      this._saveProgress();
      this._flash("All steps done. Checks cleared for next time.");
    }, 1500);
  }

  _setStepDone(n, done) {
    if (done) this._doneSteps.add(n);
    else this._doneSteps.delete(n);
    this._saveProgress();
    this._checkAllDone();
    this._scrollToCurrent = this._view.name === "cook" && !this._cookFocus;
    this._render();
  }

  _flash(text) {
    this._notice = text;
    clearTimeout(this._noticeTimer);
    if (!["edit", "import"].includes(this._view.name)) this._render();
    this._noticeTimer = setTimeout(() => {
      this._notice = "";
      if (!["edit", "import"].includes(this._view.name)) this._render();
    }, 3500);
  }

  /** A finished timer completes the step it belongs to, on this or another recipe. */
  _markStepDoneFor(recipeId, step) {
    if (this._view.id === recipeId) {
      this._doneSteps.add(step);
      this._saveProgress();
      this._checkAllDone();
      return;
    }
    const all = this._readProgress();
    const entry = all[recipeId] || { ing: [], steps: [], t: 0 };
    if (!entry.steps.includes(step)) entry.steps.push(step);
    entry.t = Date.now();
    all[recipeId] = entry;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch (_) { /* ignore */ }
  }

  _handleFinishedTimers(timers) {
    let handled = [];
    try {
      handled = JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]");
    } catch (_) { /* ignore */ }
    const seen = new Set(handled);
    for (const t of timers) {
      if (t.done && !seen.has(t.id) && t.recipe_id && Number.isInteger(t.step)) {
        this._markStepDoneFor(t.recipe_id, t.step);
      }
    }
    // remember only timers that still exist, so the list cannot grow without bound
    const keep = timers.filter((t) => t.done).map((t) => t.id);
    try {
      localStorage.setItem(HANDLED_KEY, JSON.stringify(keep));
    } catch (_) { /* ignore */ }
  }
  _saveProgress() {
    const id = this._view.id;
    if (!id) return;
    const all = this._readProgress();
    const now = Date.now();
    for (const key of Object.keys(all)) if (now - (all[key].t || 0) > 2 * 864e5) delete all[key];
    if (this._checked.size || this._doneSteps.size) {
      all[id] = { ing: [...this._checked], steps: [...this._doneSteps], t: now };
    } else {
      delete all[id];
    }
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch (_) { /* ignore */ }
  }

  // ---- unsaved-changes guard ----
  _confirmDiscard() {
    return confirm("Discard your unsaved changes?");
  }

  // ---- history ----
  _hashFor(view) {
    switch (view.name) {
      case "detail":
        return `#/recipe/${view.id}`;
      case "cook":
        return `#/recipe/${view.id}/cook`;
      case "shop":
        return `#/recipe/${view.id}/shop`;
      case "edit":
        return view.id ? `#/recipe/${view.id}/edit` : "#/new";
      case "import":
        return "#/import";
      case "data":
        return "#/data";
      case "plan":
        return view.week ? `#/plan/${view.week}` : "#/plan";
      default:
        return "";
    }
  }
  _urlFor(view) {
    return `${location.pathname}${location.search}${this._hashFor(view)}`;
  }
  _viewFromHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "recipe" && parts[1]) {
      const id = parts[1];
      if (parts[2] === "cook") return { name: "cook", id, step: 0 };
      if (parts[2] === "shop") return { name: "shop", id };
      if (parts[2] === "edit") return { name: "edit", id };
      return { name: "detail", id };
    }
    if (parts[0] === "new") return { name: "edit" };
    if (parts[0] === "import") return { name: "import" };
    if (parts[0] === "data") return { name: "data" };
    if (parts[0] === "plan") return { name: "plan", week: /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ? parts[1] : "" };
    return { name: "list" };
  }

  /** Browser back/forward: show the view that belongs to the entry we landed on. */
  _popstate() {
    if (!this._booted) return;
    const st = history.state || {};
    const idx = typeof st.hrIdx === "number" ? st.hrIdx : null;
    if (this._ignorePop) {
      // We just undid a navigation the user declined; stay on the form.
      this._ignorePop = false;
      if (idx !== null) this._idx = idx;
      return;
    }
    if (this._view.name === "edit" && this._formDirty) {
      if (!this._confirmDiscard()) {
        this._ignorePop = true;
        history.go(this._idx - (idx !== null ? idx : this._idx - 1));
        return;
      }
      this._formDirty = false;
    }
    let view = idx !== null ? this._stack[idx] : null;
    if (!view) view = this._viewFromHash();
    if (idx !== null) this._idx = idx;
    if (view.id && !this._recipe(view.id)) view = { name: "list" };
    const keep = !!view.id && view.id === this._view.id;
    this._go(view, keep, "none");
  }

  /**
   * Show `view`. mode: "push" adds a history entry, "replace" swaps the current
   * one, "none" is used when the browser already moved (back/forward).
   */
  _go(view, keepScale = false, mode = "push") {
    const prev = this._view;
    if (mode !== "none" && prev.name === "edit" && view.name !== "edit" && this._formDirty) {
      if (!this._confirmDiscard()) return;
      this._formDirty = false;
    }
    this._view = view;
    this._error = "";
    if (!keepScale) {
      const opening = view.id ? this._recipe(view.id) : null;
      this._scale = (opening && opening.default_scale) || 1;
      this._tab = "ingredients";
      this._loadProgress(view.id);
    }
    if (view.name !== "import") this._bulk = null;
    if (view.name === "edit") this._initForm(view.id);
    if (mode !== "none") {
      const same = prev && prev.name === view.name && prev.id === view.id;
      try {
        if (mode === "replace" || same) {
          this._stack[this._idx] = view;
          history.replaceState({ ...(history.state || {}), hrIdx: this._idx }, "", this._urlFor(view));
        } else {
          this._idx += 1;
          this._stack = this._stack.slice(0, this._idx);
          this._stack.push(view);
          history.pushState({ hrIdx: this._idx }, "", this._urlFor(view));
        }
      } catch (_) { /* history unavailable: navigation still works without it */ }
    }
    this._render();
    this.scrollTo(0, 0);
  }

  /** In-app "back": same as the browser's back button when there is history. */
  _back() {
    if (this._idx > 0) history.back();
    else this._go({ name: "list" }, false, "replace");
  }

  /** Leave a sub-view (edit/cook/shop) for `view`, reusing the entry we came from. */
  _returnTo(view) {
    const before = this._stack[this._idx - 1];
    if (this._idx > 0 && before && before.name === view.name && before.id === view.id) {
      history.back();
    } else {
      this._go(view, view.name === "detail", "replace");
    }
  }

  _recipe(id) {
    return this._recipes.find((r) => r.id === id);
  }

  _render() {
    const v = this._view;
    let body;
    if (!this._loaded) body = `<div class="empty">Loading…</div>`;
    else if (v.name === "detail" && this._recipe(v.id)) body = this._detailHtml(this._recipe(v.id));
    else if (v.name === "data") body = this._dataHtml();
    else if (v.name === "plan") {
      this._ensurePlan();
      body = this._planHtml();
    }
    else if (v.name === "shop" && this._recipe(v.id)) body = this._shopHtml(this._recipe(v.id));
    else if (v.name === "cook" && this._recipe(v.id)) {
      const r = this._recipe(v.id);
      body = this._cookFocus ? this._cookHtml(r) : this._cookAllHtml(r);
    }
    else if (v.name === "edit" && this._form) body = this._formHtml();
    else if (v.name === "import") body = this._importHtml();
    else body = this._listHtml();

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="sticky">
        <header>
          ${this._narrow ? `<button class="menu" data-act="menu" title="Menu">☰</button>` : ""}
          <h1>Recipes</h1>
        </header>
        <div id="timers" class="timers"></div>
      </div>
      <main>${this._notice ? `<div class="notice">✓ ${esc(this._notice)}</div>` : ""}${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}${body}</main>`;
    this._timerSig = "";
    this._bind();
    this._renderTimers();
    this._syncWake();
    if (this._scrollToCurrent) {
      this._scrollToCurrent = false;
      const cur = this.shadowRoot.querySelector(".cstep.current");
      if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (this._focusUid) {
      const [uid, part] = this._focusUid.split(":");
      const el = this.shadowRoot.querySelector(`.ing-row[data-uid="${uid}"] [data-f=${part === "sub" ? "isub" : "itext"}]`);
      if (el) el.focus();
      this._focusUid = null;
    }
  }

  /** Does recipe `r` satisfy the facet selection `sel` and text query `q`? */
  _matches(r, sel, q) {
    for (const kind of ["categories", "tools", "tags"]) {
      const want = sel[kind];
      if (want.size && !(r[kind] || []).some((v) => want.has(v))) return false;
    }
    if (!q) return true;
    return [r.name, r.description, ...r.tags, ...(r.categories || []), ...(r.tools || []), ...r.ingredients]
      .join("\n")
      .toLowerCase()
      .includes(q);
  }

  _listHtml() {
    const q = this._search.trim().toLowerCase();
    const shown = this._recipes.filter((r) => this._matches(r, this._sel, q));
    const values = (kind) =>
      [...new Set(this._recipes.flatMap((r) => r[kind] || []))].sort((x, y) =>
        x.localeCompare(y, undefined, { sensitivity: "base" })
      );
    const FACETS = [["categories", "Categories"], ["tools", "Tools"], ["tags", "Tags"]];

    // Wide: left rail with cookbooks and checkbox filters.
    const rail = `<aside class="rail">
      <h4>Cookbooks</h4>
      <div class="rail-item ${this._cookbookId ? "" : "active"}" data-cookbook="">All recipes</div>
      ${this._cookbooks
        .map((c) => `<div class="rail-item ${c.id === this._cookbookId ? "active" : ""}" data-cookbook="${esc(c.id)}">${esc(c.name)}</div>`)
        .join("")}
      ${FACETS.map(([kind, label]) => {
        const vals = values(kind);
        if (!vals.length) return "";
        return `<h4>${label}</h4>${vals
          .map(
            (v) =>
              `<label><input type="checkbox" data-fcb="${kind}" data-value="${esc(v)}" ${this._sel[kind].has(v) ? "checked" : ""}> ${esc(v)}</label>`
          )
          .join("")}`;
      }).join("")}
    </aside>`;

    // Narrow: chips on top; the less common filters sit behind "More filters".
    const chipRow = (kind, label) => {
      const vals = values(kind);
      if (!vals.length) return "";
      return `<div class="chips"><span class="facet-label">${label}</span>${vals
        .map((v) => `<span class="chip ${this._sel[kind].has(v) ? "active" : ""}" data-facet="${kind}" data-value="${esc(v)}">${esc(v)}</span>`)
        .join("")}</div>`;
    };
    const activeExtra = this._sel.tools.size + this._sel.tags.size;
    const mfilters = `<div class="mfilters">
      <div class="chips"><span class="chip ${this._cookbookId ? "" : "active"}" data-cookbook="">All</span>
        ${this._cookbooks.map((c) => `<span class="chip ${c.id === this._cookbookId ? "active" : ""}" data-cookbook="${esc(c.id)}">${esc(c.name)}</span>`).join("")}</div>
      ${chipRow("categories", "Category")}
      ${chipRow("tools", "Tools") || chipRow("tags", "Tags") ? `<details ${activeExtra ? "open" : ""}><summary>More filters${activeExtra ? ` (${activeExtra})` : ""}</summary>${chipRow("tools", "Tools")}${chipRow("tags", "Tags")}</details>` : ""}
    </div>`;

    const filtersOn = q || Object.values(this._sel).some((set) => set.size);
    const cookbookActions = this._cookbookId
      ? `<div class="cookbook-actions">
          <button class="btn secondary" data-act="cookbook-update">Save filters to this cookbook</button>
          <button class="btn secondary" data-act="cookbook-delete">Delete cookbook</button></div>`
      : filtersOn
        ? `<div class="cookbook-actions"><button class="btn secondary" data-act="cookbook-save">📖 Save current filters as cookbook</button></div>`
        : "";

    const items = shown
      .map((r) => {
        const time = minutes(r.total_time || (r.prep_time || 0) + (r.cook_time || 0));
        const img = r.image ? `style="background-image:url('${esc(r.image)}')"` : "";
        const picked = this._picked.has(r.id);
        const attr = this._select ? `data-pick="${esc(r.id)}"` : `data-open="${esc(r.id)}"`;
        const cat = (r.categories || [])[0];
        return `<div class="item ${picked ? "picked" : ""}" ${attr}>
          ${this._select ? `<div class="pick">${picked ? "✓" : ""}</div>` : ""}
          <div class="thumb" ${img}>${r.image ? "" : "🍽️"}</div>
          <div class="body"><h3>${esc(r.name)}</h3>
            <div class="muted">${[time, r.servings && `Serves ${esc(r.servings)}`].filter(Boolean).join(" · ")}</div>
            ${cat ? `<span class="cat">${esc(cat)}</span>` : ""}</div>
          <span class="chev">›</span>
        </div>`;
      })
      .join("");

    const bulkbar = this._select
      ? `<div class="bulkbar">
          <strong>${this._picked.size} selected</strong>
          <button class="btn secondary" data-bulk="all">Select all ${shown.length} shown</button>
          <button class="btn secondary" data-bulk="none">Clear</button>
          <select id="bulk-field">
            ${[["categories", "Category"], ["tags", "Tag"], ["tools", "Tool"]]
              .map(([v, l]) => `<option value="${v}" ${this._bulkField === v ? "selected" : ""}>${l}</option>`)
              .join("")}
          </select>
          <input id="bulk-value" list="bulk-values" placeholder="value" value="${esc(this._bulkValue)}" autocomplete="off">
          <datalist id="bulk-values">${this._usedValues(this._bulkField).map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>
          <button class="btn" data-bulk="add">Add</button>
          <button class="btn secondary" data-bulk="remove">Remove</button>
          <button class="btn danger" data-bulk="delete">Delete</button>
        </div>`
      : "";

    return `
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search recipes, tags, ingredients…" value="${esc(this._search)}">
        <button class="btn" data-act="new" title="New recipe">+<span class="only-desk"> New</span></button>
        <button class="btn secondary only-desk" data-act="plan">Meal plan</button>
        <button class="btn secondary only-desk" data-act="import">Import URL</button>
        <button class="btn secondary only-desk ${this._select ? "active" : ""}" data-act="select">${this._select ? "Done selecting" : "Select"}</button>
        <button class="btn secondary only-desk" data-act="data" title="Export, import files, migrate from Mealie">⇅ Backup &amp; migrate</button>
      </div>
      <div class="only-mob" style="margin:-4px 0 10px">
        <details><summary class="muted" style="cursor:pointer">More actions</summary>
          <div class="actions" style="margin-top:8px">
            <button class="btn secondary" data-act="plan">Meal plan</button>
            <button class="btn secondary" data-act="import">Import URL</button>
            <button class="btn secondary" data-act="select">${this._select ? "Done selecting" : "Select"}</button>
            <button class="btn secondary" data-act="data">⇅ Backup &amp; migrate</button>
          </div></details>
      </div>
      ${bulkbar}
      <div class="browse">
        ${rail}
        <div style="min-width:0">
          ${mfilters}
          ${cookbookActions}
          ${shown.length ? `<div class="recipes">${items}</div>` : `<div class="empty">${this._recipes.length ? "No recipes match." : "No recipes yet. Create one or import from a URL."}</div>`}
        </div>
      </div>`;
  }

  // ---- categories / tools / tags: pick from what is in use, or create a new one ----
  _usedValues(kind) {
    const seen = new Map();
    for (const r of this._recipes) for (const v of r[kind] || []) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  _multiValues(text) {
    return String(text || "").split(",").map((t) => t.trim()).filter(Boolean);
  }
  _multiInner(kind, singular, chosen) {
    const have = new Set(chosen.map((v) => v.toLowerCase()));
    const options = this._usedValues(kind).filter((v) => !have.has(v.toLowerCase()));
    const chips = chosen
      .map((v) => `<span class="chip active multi-chip">${esc(v)}<button type="button" class="multi-x" data-multi-remove="${esc(v)}" aria-label="Remove ${esc(v)}">✕</button></span>`)
      .join("");
    return `<div class="multi-chips">${chips}</div>
      <div class="multi-add">
        <select data-multi-pick aria-label="Add ${esc(singular)}">
          <option value="">Add ${esc(singular)}…</option>
          ${options.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
          <option value="__new__">＋ New ${esc(singular)}…</option>
        </select>
        <span class="multi-new" hidden>
          <input type="text" data-multi-new placeholder="New ${esc(singular)}" maxlength="60">
          <button type="button" class="btn" data-multi-create>Add</button>
        </span>
      </div>`;
  }
  _multiHtml(kind, label, singular, value) {
    return `<div class="multi" data-multi="${kind}" data-singular="${esc(singular)}">
      <label class="lbl">${label}</label>
      <input type="hidden" name="${kind}" value="${esc(value)}">
      <div class="multi-body">${this._multiInner(kind, singular, this._multiValues(value))}</div>
    </div>`;
  }
  _bindMulti(root) {
    root.querySelectorAll(".multi").forEach((box) => {
      const kind = box.dataset.multi;
      const singular = box.dataset.singular;
      const hidden = box.querySelector("input[type=hidden]");
      const set = (values) => {
        hidden.value = values.join(", ");
        this._formDirty = true;
        box.querySelector(".multi-body").innerHTML = this._multiInner(kind, singular, values);
        wire();
      };
      const add = (raw) => {
        const name = String(raw || "").replace(/,/g, " ").trim();
        if (!name) return;
        const values = this._multiValues(hidden.value);
        if (values.some((v) => v.toLowerCase() === name.toLowerCase())) return set(values);
        // reuse the spelling already in use elsewhere, so "dessert" does not become a second category
        const existing = this._usedValues(kind).find((v) => v.toLowerCase() === name.toLowerCase());
        set([...values, existing || name]);
      };
      const wire = () => {
        const pick = box.querySelector("[data-multi-pick]");
        const fresh = box.querySelector(".multi-new");
        const input = box.querySelector("[data-multi-new]");
        pick.addEventListener("change", () => {
          if (pick.value === "__new__") {
            fresh.hidden = false;
            pick.hidden = true;
            input.focus();
          } else if (pick.value) {
            add(pick.value);
          }
        });
        box.querySelector("[data-multi-create]").addEventListener("click", () => add(input.value));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            add(input.value);
          } else if (e.key === "Escape") {
            fresh.hidden = true;
            pick.hidden = false;
            pick.value = "";
          }
        });
        box.querySelectorAll("[data-multi-remove]").forEach((b) =>
          b.addEventListener("click", () => set(this._multiValues(hidden.value).filter((v) => v !== b.dataset.multiRemove)))
        );
      };
      wire();
    });
  }

  // ---- meal plan ----
  _planMonday() {
    const w = this._view.name === "plan" && this._view.week ? new Date(`${this._view.week}T12:00:00`) : new Date();
    return mondayOf(w);
  }
  /** Fetch the visible week when it changes, and repaint when it arrives. */
  _ensurePlan() {
    const start = isoDate(this._planMonday());
    if (this._planLoaded === start || this._planLoading === start) return;
    this._planLoading = start;
    this._ws({ type: "hass_recipes/plan_list", start, end: isoDate(addDays(this._planMonday(), 6)) })
      .then((res) => {
        this._planEntries = res.entries;
        this._planLoaded = start;
      })
      .catch((err) => {
        this._error = err.message || String(err);
      })
      .finally(() => {
        this._planLoading = null;
        if (this._view.name === "plan") this._render();
      });
    this._subscribePlan();
  }
  _subscribePlan() {
    if (this._planSub || !this._hass) return;
    this._planSub = true;
    this._hass.connection
      .subscribeEvents(() => {
        this._planLoaded = null;
        if (this._view.name === "plan") this._render();
      }, "hass_recipes_meal_plan_changed")
      .catch(() => (this._planSub = false));
  }
  async _planChange(msg) {
    try {
      await this._ws(msg);
    } catch (err) {
      this._error = err.message || String(err);
    }
    this._planLoaded = null; // the change event also reloads; this covers a missed event
    this._render();
  }
  async _planToShopping() {
    const start = isoDate(this._planMonday());
    const entity_id = this._shopEntity || "todo.shopping_list";
    try {
      const res = await this._hass.callWS({
        type: "call_service",
        domain: "hass_recipes",
        service: "add_plan_to_shopping_list",
        service_data: { start, days: 7, entity_id },
        return_response: true,
      });
      const r = res.response || {};
      this._flash(`Added ${r.added?.length || 0} items from ${r.meals || 0} meals to ${entity_id}${r.skipped?.length ? ` (${r.skipped.length} already there)` : ""}.`);
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }
  _bindPlan(root, on) {
    on("[data-plan-add]", "click", async (e) => {
      const { date, slot } = e.currentTarget.dataset;
      if (this._planPending) {
        const recipe_id = this._planPending;
        this._planPending = null;
        await this._planChange({ type: "hass_recipes/plan_add", date, slot, recipe_id });
        this._flash("Added to the meal plan.");
        return;
      }
      this._planAdd = { date, slot };
      this._planQuery = "";
      this._render();
      setTimeout(() => root.getElementById("plan-search")?.focus(), 30);
    });
    on("[data-plan-recipe]", "click", async (e) => {
      const add = this._planAdd;
      this._planAdd = null;
      if (add) await this._planChange({ type: "hass_recipes/plan_add", ...add, recipe_id: e.currentTarget.dataset.planRecipe });
    });
    const text = root.getElementById("plan-text-add");
    if (text) {
      const submit = async () => {
        const title = root.getElementById("plan-text").value.trim();
        const add = this._planAdd;
        if (!title || !add) return;
        this._planAdd = null;
        await this._planChange({ type: "hass_recipes/plan_add", ...add, title });
      };
      text.addEventListener("click", submit);
      root.getElementById("plan-text").addEventListener("keydown", (e) => e.key === "Enter" && submit());
    }
    on("[data-plan-cancel]", "click", () => {
      this._planAdd = null;
      this._render();
    });
    on("[data-plan-del]", "click", (e) =>
      this._planChange({ type: "hass_recipes/plan_delete", entry_id: e.currentTarget.dataset.planDel })
    );
    on("[data-plan-cook]", "click", async (e) => {
      try {
        const state = await this._ws({ type: "hass_recipes/plan_cook", entry_id: e.currentTarget.dataset.planCook });
        this._go({ name: "cook", id: state.recipe_id, step: 0 });
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    });
    on("[data-plan-scale]", "change", (e) => {
      const scale = parseFloat(e.currentTarget.value);
      this._planChange({
        type: "hass_recipes/plan_update",
        entry_id: e.currentTarget.dataset.planScale,
        scale: scale > 0 ? scale : null,
      });
    });
    const search = root.getElementById("plan-search");
    if (search) {
      search.addEventListener("input", () => {
        this._planQuery = search.value;
        const box = root.getElementById("plan-results");
        if (box) {
          box.innerHTML = this._planResultsHtml();
          box.querySelectorAll("[data-plan-recipe]").forEach((b) =>
            b.addEventListener("click", async (ev) => {
              const add = this._planAdd;
              this._planAdd = null;
              if (add) await this._planChange({ type: "hass_recipes/plan_add", ...add, recipe_id: ev.currentTarget.dataset.planRecipe });
            })
          );
        }
      });
    }
  }
  _planResultsHtml() {
    const q = (this._planQuery || "").trim().toLowerCase();
    const found = this._recipes
      .filter((r) => !q || [r.name, ...(r.tags || []), ...(r.categories || [])].join(" ").toLowerCase().includes(q))
      .slice(0, 12);
    if (!found.length) return `<div class="muted">No recipes match. Use the text box to add a plain meal.</div>`;
    return found
      .map(
        (r) => `<button class="plan-recipe" data-plan-recipe="${esc(r.id)}">
          <span class="thumb" ${r.image ? `style="background-image:url('${esc(r.image)}')"` : ""}></span>
          <span>${esc(r.name)}<br><small class="muted">${esc(minutes(r.total_time) || "")}</small></span></button>`
      )
      .join("");
  }
  _planHtml() {
    const monday = this._planMonday();
    const days = [...Array(7)].map((_, i) => addDays(monday, i));
    const today = isoDate(new Date());
    const lang = (this._hass && this._hass.language) || undefined;
    const dayLabel = (d) => new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(d);
    const rangeLabel = `${new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;
    const entries = this._planLoaded === isoDate(monday) ? this._planEntries || [] : this._planEntries || [];
    const SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]];
    const pending = this._planPending ? this._recipe(this._planPending) : null;

    const dayHtml = (d) => {
      const iso = isoDate(d);
      const slots = SLOTS.map(([slot, label]) => {
        const here = entries.filter((e) => e.date === iso && e.slot === slot);
        const items = here
          .map((e) => {
            const title = e.recipe_exists
              ? `<a href="#" class="plan-title" data-open="${esc(e.recipe_id)}">${esc(e.title)}</a>`
              : `<span class="plan-title">${esc(e.title)}</span>`;
            const scaleBox = e.recipe_exists
              ? `<label class="plan-scale" title="Scale">×<input type="number" min="0.25" step="0.25" value="${e.scale ? esc(e.scale) : ""}" placeholder="1" data-plan-scale="${esc(e.id)}"></label>`
              : "";
            return `<div class="plan-entry">${title}
              <span class="plan-tools">${scaleBox}
                ${e.recipe_exists ? `<button class="mini" data-plan-cook="${esc(e.id)}" title="Cook this">🍳</button>` : ""}
                <button class="mini" data-plan-del="${esc(e.id)}" title="Remove">✕</button></span></div>`;
          })
          .join("");
        return `<div class="plan-slot"><div class="plan-slot-head"><span>${label}</span>
          <button class="mini" data-plan-add data-date="${iso}" data-slot="${slot}" title="Add to ${label.toLowerCase()}">+</button></div>${items}</div>`;
      }).join("");
      return `<section class="plan-day ${iso === today ? "today" : ""}"><h3>${esc(dayLabel(d))}</h3>${slots}</section>`;
    };

    const adding = this._planAdd
      ? `<div class="pane plan-picker">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <strong>Add to ${esc(this._planAdd.slot)} · ${esc(dayLabel(new Date(`${this._planAdd.date}T12:00:00`)))}</strong>
            <button class="btn secondary" data-plan-cancel>Cancel</button></div>
          <input id="plan-search" type="search" placeholder="Search recipes" value="${esc(this._planQuery || "")}">
          <div id="plan-results" class="plan-results">${this._planResultsHtml()}</div>
          <div class="plan-text"><input id="plan-text" placeholder="…or a plain meal, e.g. Leftovers"><button class="btn" id="plan-text-add">Add</button></div>
        </div>`
      : "";
    return `
      <style>
        .plan-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
        .plan-bar h2 { margin: 0 12px 0 0; font-size: 22px; font-weight: 500; }
        .plan-range { min-width: 150px; text-align: center; font-weight: 500; }
        .plan-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
        @container (max-width: 900px) { .plan-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @container (max-width: 520px) { .plan-grid { grid-template-columns: minmax(0, 1fr); } }
        .plan-day { border: 1px solid var(--divider-color); border-radius: 12px; padding: 8px 10px; background: var(--card-background-color); }
        .plan-day.today { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
        .plan-day h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; }
        .plan-slot { border-top: 1px solid var(--divider-color); padding: 4px 0; min-height: 34px; }
        .plan-slot-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .plan-entry { display: flex; flex-direction: column; gap: 2px; padding: 3px 0; font-size: 14px; }
        .plan-title { color: var(--primary-text-color); text-decoration: none; overflow-wrap: anywhere; }
        a.plan-title { color: var(--primary-color); }
        .plan-tools { display: flex; gap: 4px; align-items: center; }
        .plan-scale { font-size: 12px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 2px; }
        .plan-scale input { width: 52px; padding: 1px 4px; font-size: 12px; }
        .plan-picker { margin-bottom: 14px; display: grid; gap: 10px; }
        .plan-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; max-height: 260px; overflow: auto; }
        .plan-recipe { display: flex; gap: 8px; align-items: center; text-align: left; padding: 6px; border: 1px solid var(--divider-color); border-radius: 8px; background: none; color: inherit; font: inherit; cursor: pointer; }
        .plan-recipe .thumb { width: 36px; height: 36px; border-radius: 6px; flex: none; background: var(--secondary-background-color) center / cover; }
        .plan-text { display: flex; gap: 8px; }
        .plan-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--primary-color) 14%, transparent); display: flex; gap: 8px; align-items: center; justify-content: space-between; }
      </style>
      <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
      <div class="plan-bar">
        <h2>Meal plan</h2>
        <button class="btn secondary" data-act="plan-prev" title="Previous week">‹</button>
        <span class="plan-range">${esc(rangeLabel)}</span>
        <button class="btn secondary" data-act="plan-next" title="Next week">›</button>
        <button class="btn secondary" data-act="plan-today">Today</button>
        <button class="btn" data-act="plan-shop" title="Add the ingredients of this week's recipes to your shopping list">Add week to shopping list</button>
      </div>
      ${pending ? `<div class="plan-banner"><span>Pick a meal for <strong>${esc(pending.name)}</strong>: press + on a day.</span><button class="btn secondary" data-act="plan-cancel-pending">Cancel</button></div>` : ""}
      ${adding}
      <div class="plan-grid">${days.map(dayHtml).join("")}</div>`;
  }

  // ---- export / import / migrate ----
  _dataHtml() {
    const m = this._dataMsg;
    const msg = m
      ? `<div class="${m.kind === "error" ? "error" : "muted"}" style="margin:12px 0;font-size:15px">${m.kind === "ok" ? "✅ " : m.kind === "busy" ? "⏳ " : "❌ "}${esc(m.text)}</div>`
      : "";
    return `
      <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
      ${msg}
      <div class="panel" style="margin-bottom:16px">
        <h2>Export</h2>
        <p class="muted">Download every recipe and cookbook, with uploaded photos embedded, as one JSON file. Keep it as a backup, or import it into another Home Assistant.</p>
        <button class="btn" data-act="export">Download all recipes (JSON)</button>
      </div>
      <div class="panel" style="margin-bottom:16px">
        <h2>Import a file</h2>
        <p class="muted">Accepts a Recipes export, <strong>Mealie</strong> recipe JSON or export zip, a <strong>Paprika</strong> <code>.paprikarecipes</code> file, or schema.org recipe JSON. Recipes you already have (same name and source) are skipped.</p>
        <input id="import-file" type="file" accept=".json,.zip,.paprikarecipes,.gz,application/json,application/zip">
      </div>
      <div class="panel">
        <h2>Migrate from a running Mealie</h2>
        <p class="muted">Pulls every recipe through Mealie's API. Create a token in Mealie under <em>your profile → API tokens</em>. The token is used once and not stored. Requires a Home Assistant administrator.</p>
        <form id="mealie">
          <div class="field"><label class="lbl">Mealie URL</label><input name="url" type="url" required placeholder="http://mealie.local:9925"></div>
          <div class="field"><label class="lbl">API token</label><input name="token" type="password" required autocomplete="off"></div>
          <button class="btn" type="submit" id="mealie-btn">Migrate recipes</button>
        </form>
      </div>`;
  }

  async _export() {
    this._dataMsg = { kind: "busy", text: "Preparing export…" };
    this._render();
    try {
      const resp = await this._hass.fetchWithAuth("/api/hass_recipes/export");
      if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
      const text = await resp.text();
      const doc = JSON.parse(text);
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hass-recipes-${new Date().toISOString().slice(0, 10)}.json`;
      this.shadowRoot.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this._dataMsg = {
        kind: "ok",
        text: `Exported ${doc.recipes.length} recipe(s) and ${doc.cookbooks.length} cookbook(s), including uploaded photos.`,
      };
    } catch (err) {
      this._dataMsg = { kind: "error", text: err.message || String(err) };
    }
    this._render();
  }

  async _uploadFile(file) {
    this._dataMsg = { kind: "busy", text: `Importing ${file.name}…` };
    this._render();
    try {
      const resp = await this._hass.fetchWithAuth("/api/hass_recipes/import", { method: "POST", body: file });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.message || `Upload failed (${resp.status})`);
      this._dataMsg = {
        kind: "ok",
        text: `Imported ${body.added} recipe(s), skipped ${body.skipped} already present${body.cookbooks ? `, added ${body.cookbooks} cookbook(s)` : ""}.`,
      };
      await this._load();
    } catch (err) {
      this._dataMsg = { kind: "error", text: err.message || String(err) };
    }
    this._render();
  }

  async _migrateMealie(e, form) {
    e.preventDefault();
    const fd = new FormData(form);
    this._dataMsg = { kind: "busy", text: "Reading recipes from Mealie — this can take a minute for large libraries…" };
    this._render();
    try {
      const res = await this._ws({
        type: "hass_recipes/migrate_mealie",
        url: fd.get("url").trim(),
        token: fd.get("token").trim(),
      });
      const failed = res.failed.length ? `, ${res.failed.length} failed (${res.failed.slice(0, 3).map((f) => f.slug).join(", ")}${res.failed.length > 3 ? ", …" : ""})` : "";
      this._dataMsg = {
        kind: res.failed.length ? "error" : "ok",
        text: `Mealie had ${res.found} recipe(s): imported ${res.added}, skipped ${res.skipped} already present${failed}.`,
      };
      await this._load();
    } catch (err) {
      this._dataMsg = { kind: "error", text: err.message || String(err) };
    }
    this._render();
  }

  // ---- shopping list (HA to-do entities) ----
  _todoEntities() {
    const states = (this._hass && this._hass.states) || {};
    return Object.keys(states)
      .filter((id) => id.startsWith("todo."))
      .map((id) => ({ id, name: (states[id].attributes && states[id].attributes.friendly_name) || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _shopHtml(r) {
    const lists = this._todoEntities();
    let chosen = this._shopEntity;
    if (!lists.some((l) => l.id === chosen)) {
      let saved = null;
      try {
        saved = localStorage.getItem(TODO_KEY);
      } catch (_) { /* ignore */ }
      chosen = lists.some((l) => l.id === saved) ? saved : (lists.find((l) => l.id === "todo.shopping_list") || lists[0] || {}).id;
      this._shopEntity = chosen;
    }
    const k = this._scale;
    const result = this._shopResult;
    if (result) {
      return `<div class="panel"><h2>Shopping list updated</h2>
        <p>Added <strong>${result.added.length}</strong> item(s) to <em>${esc(result.entity_id)}</em>${result.skipped.length ? `, skipped ${result.skipped.length} already on the list` : ""}.</p>
        ${result.added.length ? `<ul>${result.added.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        <div class="actions"><button class="btn" data-act="shop-done" data-id="${esc(r.id)}">Back to recipe</button></div></div>`;
    }
    if (!lists.length) {
      return `<div class="panel"><h2>Add to shopping list</h2>
        <p>No to-do lists were found in Home Assistant. Add the <strong>Shopping list</strong> integration (or any to-do integration) first.</p>
        <div class="actions"><button class="btn secondary" data-act="shop-done" data-id="${esc(r.id)}">Back</button></div></div>`;
    }
    return `
      <div class="panel">
        <h2>Add to shopping list</h2>
        <p class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · ${this._units === "grams" ? "grams" : "as written"}. Untick things you already have.</p>
        <div class="field"><label class="lbl">List</label>
          <select id="shop-entity">${lists
            .map((l) => `<option value="${esc(l.id)}" ${l.id === chosen ? "selected" : ""}>${esc(l.name)}</option>`)
            .join("")}</select></div>
        <ul class="ingredients">${r.ingredients
          .map((raw, i) =>
            isHeader(raw)
              ? `<li class="section">${esc(headerText(raw))}</li>`
              : `<li><label><input type="checkbox" data-shop="${i}" ${this._shopSel.has(i) ? "checked" : ""}><span>${esc(ingredientText(r, i, k, this._units))}</span></label></li>`
          )
          .join("")}</ul>
        <div class="actions">
          <button class="btn" data-act="shop-add" data-id="${esc(r.id)}" ${this._shopSel.size ? "" : "disabled"}>Add ${this._shopSel.size} item(s)</button>
          <button class="btn secondary" data-act="shop-done" data-id="${esc(r.id)}">Cancel</button>
        </div>
      </div>`;
  }

  async _shopAdd(id) {
    try {
      const res = await this._ws({
        type: "call_service",
        domain: "hass_recipes",
        service: "add_to_shopping_list",
        service_data: {
          recipe: id,
          entity_id: this._shopEntity,
          scale: this._scale,
          units: this._units,
          ingredients: [...this._shopSel].sort((a, b) => a - b),
        },
        return_response: true,
      });
      try {
        localStorage.setItem(TODO_KEY, this._shopEntity);
      } catch (_) { /* ignore */ }
      this._shopResult = res.response;
    } catch (err) {
      this._error = err.message || String(err);
    }
    this._render();
  }

  // ---- shared list renderers ----
  _ingredientsListHtml(r, k, attr = "data-i") {
    return `<ul class="ingredients">${r.ingredients
      .map((raw, n) =>
        isHeader(raw)
          ? `<li class="section">${esc(headerText(raw))}</li>`
          : `<li><label><input type="checkbox" ${attr}="${n}" ${this._checked.has(n) ? "checked" : ""}><span class="ing-text">${ingredientHtml(r, n, k, this._units)}</span></label></li>`
      )
      .join("")}</ul>`;
  }

  _stepsHtml(r, k) {
    let num = 0;
    return r.instructions
      .map(normStep)
      .map((s, n) => {
        if (s.section) return `<div class="step-section">${esc(s.text)}</div>`;
        num += 1;
        const done = this._doneSteps.has(n);
        const links = s.ingredients
          .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
          .map((i) => ingredientChipHtml(r, i, k, this._units))
          .join("");
        const running = this._timerRunning(`${r.id}:${n}`);
        return `<div class="step-item ${done ? "done" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0" title="${done ? "Mark as not done" : "Tap to mark as done"}">
          <span class="step-num">${done ? "✓" : num}</span>
          <div class="step-body"><div class="step-text">${esc(s.text)}</div>
            ${links ? `<div class="step-ings">${links}</div>` : ""}
            ${s.timer ? `<button class="btn secondary timer-btn" data-timer="${n}" data-sec="${s.timer}" ${running ? "disabled" : ""}>⏱ ${running ? "Timer running" : `Start ${duration(s.timer)} timer`}</button>` : ""}
          </div></div>`;
      })
      .join("");
  }

  // ---- cook mode: one big step at a time ----
  _cookSteps(r) {
    return r.instructions
      .map(normStep)
      .map((st, i) => ({ ...st, i }))
      .filter((st) => !st.section);
  }

  _cookHtml(r) {
    const steps = this._cookSteps(r);
    const n = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
    const st = steps[n];
    const k = this._scale;
    if (!st) {
      return `<div class="cook"><p>This recipe has no steps yet.</p>
        <div class="cook-nav"><button class="btn secondary" data-act="cook-exit">Exit</button></div></div>`;
    }
    // The heading this step sits under, if any.
    let section = "";
    for (const x of r.instructions.map(normStep).slice(0, st.i)) if (x.section) section = x.text;
    const links = st.ingredients
      .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
      .map((i) => ingredientChipHtml(r, i, k, this._units))
      .join("");
    const running = this._timerRunning(`${r.id}:${st.i}`);
    const last = n === steps.length - 1;
    const done = this._doneSteps.has(st.i);
    return `
      <div class="cook">
        <div class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · Step ${n + 1} of ${steps.length}</div>
        <div class="cook-progress"><div style="width:${((n + 1) / steps.length) * 100}%"></div></div>
        ${section ? `<div class="cook-section">${esc(section)}</div>` : ""}
        <div class="cook-text" data-step-toggle="${st.i}" style="${done ? "opacity:.55;text-decoration:line-through" : ""}" title="Tap to mark as done">${esc(st.text)}</div>
        ${links ? `<div class="step-ings">${links}</div>` : ""}
        ${st.timer ? `<button class="btn timer-btn" data-timer="${st.i}" data-sec="${st.timer}" ${running ? "disabled" : ""}>⏱ ${running ? "Timer running" : `Start ${duration(st.timer)} timer`}</button>` : ""}
        <label class="cook-done"><input type="checkbox" data-step-done="${st.i}" ${done ? "checked" : ""}> Mark this step as done</label>
        <div class="cook-nav">
          <button class="btn secondary" data-act="cook-prev" ${n === 0 ? "disabled" : ""}>← Previous</button>
          <button class="btn" data-act="${last ? "cook-finish" : "cook-next"}">${last ? "Finish ✓" : "Next →"}</button>
        </div>
        <details ${this._cookIngredients ? "open" : ""} id="cook-ings">
          <summary>All ingredients</summary>
          ${this._ingredientsListHtml(r, k)}
        </details>
        <div class="actions">
          <button class="btn secondary" data-act="cook-focus">Show all steps</button>
          <button class="btn secondary" data-act="cook-exit">Exit cook mode</button>
        </div>
      </div>`;
  }

  /** One control for scaling: type an amount, nudge it, or pick a multiplier. */
  _scaleControlHtml(r, k) {
    const b = scaleBasis(r);
    const presets = SCALES.map(
      ([v, label]) => `<button class="chip ${v === k ? "active" : ""}" data-scale="${v}">${label}</button>`
    ).join("");
    const amount = fmtYield(b.base * k);
    const hint =
      k === 1
        ? "As written"
        : `${formatNumber(k)}× the recipe${b.unit === "×" ? "" : ` (written for ${fmtYield(b.base)}${b.unit ? ` ${esc(b.unit)}` : ""})`}`;
    return `<div class="scale">
        <span class="muted">${b.label}</span>
        <button class="step" data-step="-1" aria-label="Less">−</button>
        <input id="amount" type="number" min="0" step="any" value="${amount}" title="Type how much you want">
        <button class="step" data-step="1" aria-label="More">+</button>
        ${b.unit && b.unit !== "×" ? `<span>${esc(b.unit)}</span>` : b.unit === "×" ? "<span>×</span>" : ""}
        <span style="width:6px"></span>${presets}
        <span class="hint">${hint}</span>
      </div>`;
  }

  /** Mealie-style cook mode: the whole recipe at once, ingredients beside the steps. */
  _cookAllHtml(r) {
    const k = this._scale;
    const all = r.instructions.map(normStep);
    const firstOpen = all.findIndex((st, i) => !st.section && !this._doneSteps.has(i));
    let num = 0;
    const steps = all
      .map((st, n) => {
        if (st.section) return `<h3 class="csection">${esc(st.text)}</h3>`;
        num += 1;
        const done = this._doneSteps.has(n);
        const links = st.ingredients
          .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
          .map((i) => ingredientChipHtml(r, i, k, this._units))
          .join("");
        const running = this._timerRunning(`${r.id}:${n}`);
        return `<div class="cstep ${done ? "done" : ""} ${n === firstOpen ? "current" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0">
          <div class="cstep-head"><span>Step ${num}</span><span class="tick">${done ? "✓" : ""}</span></div>
          <div class="cstep-text">${esc(st.text)}</div>
          ${links ? `<div class="step-ings">${links}</div>` : ""}
          ${st.timer ? `<button class="btn timer-btn" data-timer="${n}" data-sec="${st.timer}" ${running ? "disabled" : ""}>⏱ ${running ? "Timer running" : `Start ${duration(st.timer)} timer`}</button>` : ""}
        </div>`;
      })
      .join("");
    const makes = r.yield_amount ? ` · Makes ${fmtYield(r.yield_amount * k)} ${esc(r.yield_unit || "")}` : "";
    return `
      <div class="cookp">
        <div class="cook-top">
          <h2>${esc(r.name)}<span class="muted" style="font-weight:400">${makes}</span></h2>
          ${this._scaleControlHtml(r, k)}
          <button class="btn secondary" data-act="cook-focus" title="Show one step at a time">One step at a time</button>
          <button class="btn secondary" data-act="cook-exit">Exit</button>
        </div>
        <div class="cook-cols">
          <aside class="pane cook-ings"><h3>Ingredients</h3>${this._ingredientsListHtml(r, k)}</aside>
          <section class="cook-steps">${steps || `<p class="muted">This recipe has no steps yet.</p>`}</section>
        </div>
      </div>`;
  }

  _cookStep(delta) {
    const r = this._recipe(this._view.id);
    if (!r) return;
    const steps = this._cookSteps(r);
    const cur = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
    if (delta > 0 && steps[cur]) {
      // Moving on counts as having finished this step.
      this._doneSteps.add(steps[cur].i);
      this._saveProgress();
      this._checkAllDone();
    }
    this._view = { ...this._view, step: Math.min(Math.max(cur + delta, 0), Math.max(steps.length - 1, 0)) };
    this._render();
    this.scrollTo(0, 0);
  }

  _printRecipe(r) {
    const k = this._scale;
    const mode = this._units;
    const w = window.open("", "_blank");
    if (!w) {
      this._error = "The browser blocked the print window. Allow pop-ups for this site and try again.";
      this._render();
      return;
    }
    const meta = [
      r.prep_time && `Prep ${minutes(r.prep_time)}`,
      r.cook_time && `Cook ${minutes(r.cook_time)}`,
      r.total_time && `Total ${minutes(r.total_time)}`,
      r.yield_amount && `Makes ${fmtYield(r.yield_amount * k)} ${esc(r.yield_unit || "")}`.trim(),
      this._servingsLabel(r),
    ].filter(Boolean);
    let num = 0;
    const steps = r.instructions
      .map(normStep)
      .map((st) => {
        if (st.section) return `<h3>${esc(st.text)}</h3>`;
        num += 1;
        return `<p class="step"><span class="n">${num}.</span> ${esc(st.text)}${st.timer ? ` <span class="timer">(${esc(duration(st.timer))})</span>` : ""}</p>`;
      })
      .join("");
    const ings = r.ingredients
      .map((raw, i) => (isHeader(raw) ? `</ul><h3>${esc(headerText(raw))}</h3><ul>` : `<li>${esc(ingredientPlain(r, i, k, mode))}</li>`))
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.name)}</title>
      <style>
        body { font: 16px/1.5 Georgia, serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #000; }
        h1 { margin: 0 0 4px; } .meta { color: #555; margin-bottom: 16px; }
        h2 { border-bottom: 1px solid #999; padding-bottom: 2px; margin-top: 24px; }
        h3 { margin: 16px 0 4px; font-size: 1rem; }
        ul { padding-left: 20px; margin: 0; } li { margin-bottom: 6px; }
        .step { margin: 0 0 10px; } .n { font-weight: bold; }
        .timer { color: #555; font-size: 14px; } img { max-width: 100%; max-height: 260px; }
        @media print { a { color: inherit; text-decoration: none; } }
      </style></head><body>
      <h1>${esc(r.name)}</h1>
      <div class="meta">${meta.join(" · ")}</div>
      ${r.description ? `<p>${esc(r.description)}</p>` : ""}
      <h2>Ingredients</h2>
      <ul>${ings}</ul>
      <h2>Instructions</h2>
      ${steps}
      ${r.notes ? `<h2>Notes</h2><p>${esc(r.notes)}</p>` : ""}
      ${r.source_url ? `<p class="meta">Source: ${esc(r.source_url)}</p>` : ""}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  _detailHtml(r) {
    const k = this._scale;
    const base = baseServings(r.servings);
    const stat = (label, value, note = "") =>
      value ? `<div class="stat"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ""}</div>` : "";
    const servings = !r.servings
      ? ""
      : base !== null && k !== 1
        ? stat("Serves", esc(formatNumber(base * k)), `originally ${esc(r.servings)}`)
        : stat("Serves", esc(r.servings));
    const unit = esc(r.yield_unit || "");
    const makes = r.yield_amount
      ? stat(
          "Makes",
          `${fmtYield(r.yield_amount * k)}${unit ? ` ${unit}` : ""}`,
          k !== 1 ? `as written: ${fmtYield(r.yield_amount)}` : ""
        )
      : "";
    const stats = [
      stat("Prep", r.prep_time ? minutes(r.prep_time) : ""),
      stat("Cook", r.cook_time ? minutes(r.cook_time) : ""),
      stat("Total", r.total_time ? minutes(r.total_time) : ""),
      makes,
      servings,
    ].join("");
    const anyChecks = this._checked.size || this._doneSteps.size;
    const tab = this._tab || "ingredients";
    const tags = [
      ...(r.categories || []).map((t) => `<span class="chip">${esc(t)}</span>`),
      ...(r.tools || []).map((t) => `<span class="chip">🔧 ${esc(t)}</span>`),
      ...r.tags.map((t) => `<span class="chip">#${esc(t)}</span>`),
    ].join("");
    const tabBtn = (id, label) => `<button class="${tab === id ? "active" : ""}" data-tab-btn="${id}">${label}</button>`;
    const icon = (n) => `<ha-icon icon="mdi:${n}"></ha-icon>`;
    // The same actions twice: inline above the columns on a wide screen, and
    // pinned to the bottom on a narrow one (CSS shows whichever fits).
    const barHtml = (cls) => `
      <div class="bar ${cls}">
        <button class="p" data-act="cook" data-id="${esc(r.id)}">${icon("chef-hat")}Cook</button>
        <button data-act="shop" data-id="${esc(r.id)}">${icon("cart-outline")}Shop</button>
        <button data-act="print" data-id="${esc(r.id)}">${icon("printer-outline")}Print</button>
        <button data-act="dashboard-recipe" data-id="${esc(r.id)}" class="${this._cookingId === r.id ? "on" : ""}" aria-pressed="${this._cookingId === r.id}" title="${
          this._cookingId === r.id
            ? "Shown on the dashboard cook card. Press to remove."
            : "Show this recipe on the dashboard cook card"
        }">${icon(this._cookingId === r.id ? "view-dashboard" : "view-dashboard-outline")}Dashboard</button>
        <button data-act="edit" data-id="${esc(r.id)}">${icon("pencil-outline")}Edit</button>
      </div>`;
    return `
      <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
      <div class="detail">
        ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="">` : ""}
        <div class="content">
          <h2>${esc(r.name)}</h2>
          ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ""}
          ${tags ? `<div class="chips">${tags}</div>` : ""}
          ${stats ? `<div class="stats">${stats}</div>` : ""}
          <div class="tabs">${tabBtn("ingredients", "Ingredients")}${tabBtn("steps", "Instructions")}${r.notes ? tabBtn("notes", "Notes") : ""}</div>
          ${barHtml("bar-top")}
          <div class="cols">
            <section class="pane ingredients-pane tab-pane ${tab === "ingredients" ? "active" : ""}">
              <h3>Ingredients</h3>
              ${this._scaleControlHtml(r, k)}
              ${this._ingredientsListHtml(r, k)}
            </section>
            <section class="pane tab-pane ${tab === "steps" ? "active" : ""}">
              <h3>Instructions</h3>${this._stepsHtml(r, k)}
            </section>
          </div>
          ${r.notes ? `<section class="pane notes-pane tab-pane ${tab === "notes" ? "active" : ""}"><h3>Notes</h3><p style="margin:0;white-space:pre-wrap">${esc(r.notes)}</p></section>` : ""}
          ${r.source_url ? `<p class="muted">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_url)}</a></p>` : ""}
        </div>
      </div>
      ${barHtml("bar-bottom")}
      <div class="more-actions">
        <button data-act="plan-this" data-id="${esc(r.id)}">Add to meal plan</button>
        ${anyChecks ? `<button data-act="progress-reset">↺ Clear checks</button>` : ""}
        <button class="danger" data-act="delete" data-id="${esc(r.id)}">Delete recipe</button>
      </div>`;
  }

  _servingsLabel(r) {
    if (!r.servings) return "";
    const base = baseServings(r.servings);
    if (base === null || this._scale === 1) return `Serves ${esc(r.servings)}`;
    return `Serves ${formatNumber(base * this._scale)} (originally ${esc(r.servings)})`;
  }

  /** Downscale big photos in the browser (max 1600 px, JPEG) before uploading. */
  async _prepareImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 1.5e6) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * k);
      canvas.height = Math.round(bmp.height * k);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.85));
    } catch (_) {
      return file; // not decodable here (e.g. HEIC): let the server decide
    }
  }

  async _uploadImage(file) {
    this._syncForm();
    this._imgBusy = true;
    this._error = "";
    this._render();
    try {
      const blob = await this._prepareImage(file);
      const resp = await this._hass.fetchWithAuth("/api/hass_recipes/upload_image", {
        method: "POST",
        body: blob,
        headers: { "Content-Type": blob.type || "application/octet-stream" },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.message || `Upload failed (${resp.status})`);
      this._form.image = body.image;
      this._formDirty = true;
    } catch (err) {
      this._error = err.message || String(err);
    }
    this._imgBusy = false;
    this._render();
  }

  _nextUid() {
    this._uid += 1;
    return `u${this._uid}`;
  }

  /** Stored ingredient strings -> editor rows (heading / text + substitute). */
  _rowFromString(str) {
    if (isHeader(str)) return { uid: this._nextUid(), header: true, text: headerText(str), sub: "", showSub: false };
    const [text, sub] = splitSub(str);
    return { uid: this._nextUid(), header: false, text, sub, showSub: !!sub };
  }

  _initForm(id) {
    const src = (id && this._recipe(id)) || this._draft || {};
    const rows = (src.ingredients || []).map((x) => this._rowFromString(x));
    this._form = {
      name: src.name || "",
      description: src.description || "",
      image: src.image || "",
      servings: src.servings || "",
      yield_amount: src.yield_amount ?? "",
      yield_unit: src.yield_unit || "",
      default_scale: src.default_scale ?? 1,
      prep_time: src.prep_time ?? "",
      cook_time: src.cook_time ?? "",
      total_time: src.total_time ?? "",
      tags: (src.tags || []).join(", "),
      categories: (src.categories || []).join(", "),
      tools: (src.tools || []).join(", "),
      rows,
      notes: src.notes || "",
      source_url: src.source_url || "",
      steps: (src.instructions || []).map(normStep).map((st) => ({
        text: st.text,
        section: st.section,
        // links are kept as stable row ids so reordering ingredients never breaks them
        ingredients: st.ingredients.map((i) => rows[i]).filter((row) => row && !row.header).map((row) => row.uid),
        timer: st.timer ? Math.round((st.timer / 60) * 100) / 100 : "",
      })),
    };
    // An imported draft has not been saved yet, so leaving it should ask first.
    this._formDirty = !id && !!this._draft;
  }

  /** Copy what is currently typed in the edit form into this._form. */
  _syncForm() {
    const form = this.shadowRoot.getElementById("form");
    if (!form || !this._form) return;
    for (const key of ["name", "description", "image", "servings", "yield_amount", "yield_unit", "default_scale", "prep_time", "cook_time", "total_time", "tags", "categories", "tools", "notes", "source_url"]) {
      const el = form.elements[key];
      if (el) this._form[key] = el.value;
    }
    this._form.rows = [...form.querySelectorAll(".ing-row")].map((el) => ({
      uid: el.dataset.uid,
      header: el.dataset.header === "1",
      text: el.querySelector("[data-f=itext]").value,
      sub: (el.querySelector("[data-f=isub]") || { value: "" }).value,
      showSub: !!el.querySelector("[data-f=isub]"),
    }));
    this._form.steps = [...form.querySelectorAll(".step")].map((el) => ({
      section: el.dataset.section === "1",
      text: el.querySelector("[data-f=text]").value,
      timer: (el.querySelector("[data-f=timer]") || { value: "" }).value,
      ingredients: [...el.querySelectorAll(".chip.active[data-uid]")].map((c) => c.dataset.uid),
    }));
  }

  _stepChips(step, rows) {
    const items = rows.filter((row) => !row.header && row.text.trim());
    if (!items.length) return `<span class="muted">Add ingredients above to link them to this step.</span>`;
    return items
      .map(
        (row) =>
          `<button type="button" class="chip ${step.ingredients.includes(row.uid) ? "active" : ""}" data-uid="${esc(row.uid)}">${esc(row.text)}</button>`
      )
      .join("");
  }

  _rowHtml(row) {
    const inputs = row.header
      ? `<input data-f="itext" placeholder="Section title, e.g. Dough" value="${esc(row.text)}">`
      : `<input data-f="itext" placeholder="e.g. 200 g butter" value="${esc(row.text)}">
         ${
           row.showSub || row.sub
             ? `<input data-f="isub" placeholder="Substitute with its own amount, e.g. 180 g coconut oil" value="${esc(row.sub)}">`
             : `<button type="button" class="mini link" data-row-act="sub" data-uid="${esc(row.uid)}">+ substitute</button>`
         }`;
    return `<div class="ing-row ${row.header ? "is-header" : ""}" data-uid="${esc(row.uid)}" data-header="${row.header ? 1 : 0}">
      <div class="ing-inputs">${inputs}</div>
      <span class="row-btns">
        <button type="button" data-row-act="up" data-uid="${esc(row.uid)}" title="Move up">↑</button>
        <button type="button" data-row-act="down" data-uid="${esc(row.uid)}" title="Move down">↓</button>
        <button type="button" data-row-act="remove" data-uid="${esc(row.uid)}" title="Remove">✕</button>
      </span></div>`;
  }

  _yieldPreview(d) {
    const scale = parseFloat(d.default_scale) || 1;
    const amount = parseFloat(d.yield_amount);
    if (amount > 0) return `= ${fmtYield(amount * scale)} ${String(d.yield_unit || "").trim()}`.trim();
    return scale !== 1 ? `= ${fmtYield(scale)}× the ingredients as written` : "";
  }

  _formHtml() {
    const d = this._form;
    const f = (k) => esc(d[k] ?? "");
    let num = 0;
    const steps = d.steps
      .map((st, n) => {
        const head = (label) => `<div class="step-head"><strong>${label}</strong><span class="spacer"></span>
            <button type="button" data-step-act="up" data-n="${n}" title="Move up">↑</button>
            <button type="button" data-step-act="down" data-n="${n}" title="Move down">↓</button>
            <button type="button" data-step-act="remove" data-n="${n}" title="Remove">✕</button></div>`;
        if (st.section) {
          return `<div class="step is-section" data-n="${n}" data-section="1">${head("Section")}
            <input data-f="text" placeholder="Section title, e.g. Assembly" value="${esc(st.text)}"></div>`;
        }
        num += 1;
        return `<div class="step" data-n="${n}" data-section="0">${head(`Step ${num}`)}
          <textarea data-f="text" rows="3" placeholder="What to do…">${esc(st.text)}</textarea>
          <div class="timer-field"><label class="lbl">Timer (minutes, optional)</label>
            <input data-f="timer" type="number" min="0" step="any" value="${esc(st.timer)}"></div>
          <label class="lbl">Ingredients used in this step</label>
          <div class="chips step-ings-edit">${this._stepChips(st, d.rows)}</div>
        </div>`;
      })
      .join("");
    return `
      <div class="panel">
        <h2>${this._view.id ? "Edit recipe" : "New recipe"}</h2>
        <form id="form" data-id="${esc(this._view.id || "")}">
          <div class="field"><label class="lbl">Name</label><input name="name" required value="${f("name")}"></div>
          <div class="field"><label class="lbl">Description</label><textarea name="description" rows="2">${f("description")}</textarea></div>
          <div class="field"><label class="lbl">Photo</label>
            <div class="img-field">
              ${d.image ? `<img class="img-preview" src="${f("image")}" alt="">` : ""}
              <div class="img-controls">
                <input name="image" placeholder="Image URL, or upload a photo" value="${f("image")}">
                <div class="btns">
                  <label class="btn secondary">${this._imgBusy ? "Uploading…" : "📷 Upload photo"}
                    <input type="file" id="image-file" accept="image/*" hidden ${this._imgBusy ? "disabled" : ""}></label>
                  ${d.image ? `<button type="button" class="btn secondary" data-act="image-clear">Remove</button>` : ""}
                </div>
              </div>
            </div>
          </div>
          <div class="field"><label class="lbl">Yield</label>
            <div class="yield-row"><span>The ingredients make</span>
              <input name="yield_amount" type="number" min="0" step="any" placeholder="8" value="${f("yield_amount")}" style="width:90px">
              <input name="yield_unit" placeholder="pancakes, cookies, buns…" value="${f("yield_unit")}" style="flex:1;min-width:150px"></div>
            <div class="yield-row"><span>Open the recipe at</span>
              <input name="default_scale" type="number" min="0.1" step="any" value="${f("default_scale")}" style="width:80px">
              <span>× the written amounts</span> <span class="muted" id="yield-preview">${esc(this._yieldPreview(d))}</span></div>
          </div>
          <div class="row field">
            <div><label class="lbl">Servings</label><input name="servings" value="${f("servings")}"></div>
            <div><label class="lbl">Prep (min)</label><input name="prep_time" type="number" min="0" value="${f("prep_time")}"></div>
            <div><label class="lbl">Cook (min)</label><input name="cook_time" type="number" min="0" value="${f("cook_time")}"></div>
            <div><label class="lbl">Total (min)</label><input name="total_time" type="number" min="0" value="${f("total_time")}"></div>
          </div>
          <div class="row field">
            ${this._multiHtml("categories", "Categories", "category", d.categories)}
            ${this._multiHtml("tools", "Tools", "tool", d.tools)}
            ${this._multiHtml("tags", "Tags", "tag", d.tags)}
          </div>
          <div class="field"><label class="lbl">Ingredients</label>
            <div id="rows">${d.rows.map((row) => this._rowHtml(row)).join("")}</div>
            <div class="actions" style="margin-top:8px">
              <button type="button" class="btn secondary" data-row-act="add">+ Add ingredient</button>
              <button type="button" class="btn secondary" data-row-act="add-section">+ Add section</button>
            </div>
            <p class="muted">Enter adds a row below. Pasting a list splits it into one ingredient per line.</p>
          </div>
          <div class="field"><label class="lbl">Instructions</label>
            <div id="steps">${steps}</div>
            <div class="actions">
              <button type="button" class="btn secondary" data-step-act="add">+ Add step</button>
              <button type="button" class="btn secondary" data-step-act="add-section">+ Add section</button>
            </div>
          </div>
          <div class="field"><label class="lbl">Notes</label><textarea name="notes" rows="3">${f("notes")}</textarea></div>
          <div class="field"><label class="lbl">Source URL</label><input name="source_url" value="${f("source_url")}"></div>
          <div class="actions">
            <button class="btn" type="submit">Save</button>
            <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
          </div>
        </form>
      </div>`;
  }

  /** Typing in an ingredient row: keep the step chips' labels in step. */
  _refreshChips() {
    this._syncForm();
    const form = this.shadowRoot.getElementById("form");
    form.querySelectorAll(".step").forEach((el, n) => {
      const box = el.querySelector(".step-ings-edit");
      if (box) box.innerHTML = this._stepChips(this._form.steps[n], this._form.rows);
    });
  }

  _rowAction(act, uid) {
    this._syncForm();
    const rows = this._form.rows;
    const at = rows.findIndex((r) => r.uid === uid);
    let focus = null;
    if (act === "add" || act === "add-section") {
      const row = { uid: this._nextUid(), header: act === "add-section", text: "", sub: "", showSub: false };
      rows.splice(at >= 0 ? at + 1 : rows.length, 0, row);
      focus = row.uid;
    } else if (act === "remove" && at >= 0) {
      rows.splice(at, 1);
      for (const st of this._form.steps) st.ingredients = st.ingredients.filter((u) => u !== uid);
    } else if (act === "up" && at > 0) {
      [rows[at - 1], rows[at]] = [rows[at], rows[at - 1]];
    } else if (act === "down" && at >= 0 && at < rows.length - 1) {
      [rows[at + 1], rows[at]] = [rows[at], rows[at + 1]];
    } else if (act === "sub" && at >= 0) {
      rows[at].showSub = true;
      focus = `${uid}:sub`;
    }
    this._formDirty = true;
    this._focusUid = focus;
    this._render();
  }

  /** Pasting several lines into a row creates a row per line. */
  _pasteRows(e, uid) {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/\r?\n/.test(text)) return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    this._syncForm();
    const rows = this._form.rows;
    const at = rows.findIndex((r) => r.uid === uid);
    const fresh = lines.map((l) => this._rowFromString(l));
    // an empty row is replaced by the pasted list, a filled one keeps its place
    const replace = at >= 0 && !rows[at].text.trim();
    rows.splice(replace ? at : at + 1, replace ? 1 : 0, ...fresh);
    this._formDirty = true;
    this._render();
  }

  _stepAction(act, n) {
    this._syncForm();
    const steps = this._form.steps;
    if (act === "add") steps.push({ text: "", ingredients: [], timer: "", section: false });
    else if (act === "add-section") steps.push({ text: "", ingredients: [], timer: "", section: true });
    else if (act === "remove") steps.splice(n, 1);
    else if (act === "up" && n > 0) [steps[n - 1], steps[n]] = [steps[n], steps[n - 1]];
    else if (act === "down" && n < steps.length - 1) [steps[n + 1], steps[n]] = [steps[n], steps[n + 1]];
    this._formDirty = true;
    this._render();
  }

  _importHtml() {
    if (this._bulk) {
      const rows = this._bulk
        .map((r) =>
          r.ok
            ? `<li>✅ <a href="#" data-open-new="${esc(r.id)}">${esc(r.name)}</a> <span class="muted">${esc(r.url)}</span></li>`
            : `<li>❌ <span class="muted">${esc(r.url)}</span><br><span class="error">${esc(r.error)}</span></li>`
        )
        .join("");
      const ok = this._bulk.filter((r) => r.ok).length;
      return `
        <div class="panel">
          <h2>Import finished</h2>
          <p>${ok} of ${this._bulk.length} recipes imported.</p>
          <ul>${rows}</ul>
          <div class="actions"><button class="btn" data-act="back">Done</button></div>
        </div>`;
    }
    return `
      <div class="panel">
        <h2>Import from URL</h2>
        <p class="muted">Paste one URL to review it before saving, or several (one per line, up to 25) to import them all at once.</p>
        <form id="import">
          <div class="field"><textarea name="urls" rows="4" required placeholder="https://…" autofocus></textarea></div>
          <div class="actions">
            <button class="btn" type="submit" id="import-btn">Import</button>
            <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
          </div>
        </form>
      </div>`;
  }

  _bind() {
    const root = this.shadowRoot;
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

    on("[data-open]", "click", (e) => this._go({ name: "detail", id: e.currentTarget.dataset.open }));
    this._bindPlan(root, on);
    on("[data-facet]", "click", (e) => {
      const { facet, value } = e.currentTarget.dataset;
      const set = this._sel[facet];
      if (!set.delete(value)) set.add(value);
      this._render();
    });
    on("[data-cookbook]", "click", (e) => this._applyCookbook(e.currentTarget.dataset.cookbook));
    on("input[data-fcb]", "change", (e) => {
      const { fcb, value } = e.currentTarget.dataset;
      if (e.currentTarget.checked) this._sel[fcb].add(value);
      else this._sel[fcb].delete(value);
      this._render();
    });
    on("[data-tab-btn]", "click", (e) => {
      this._tab = e.currentTarget.dataset.tabBtn;
      this._render();
      this.scrollTo(0, 0);
    });
    on("[data-pick]", "click", (e) => {
      const id = e.currentTarget.dataset.pick;
      if (!this._picked.delete(id)) this._picked.add(id);
      this._render();
    });
    on("[data-bulk]", "click", (e) => this._bulkAction(e.currentTarget.dataset.bulk));
    const bulkField = root.getElementById("bulk-field");
    if (bulkField)
      bulkField.addEventListener("change", () => {
        this._bulkField = bulkField.value;
        const list = root.getElementById("bulk-values");
        if (list) list.innerHTML = this._usedValues(this._bulkField).map((v) => `<option value="${esc(v)}"></option>`).join("");
      });
    const bulkValue = root.getElementById("bulk-value");
    if (bulkValue) bulkValue.addEventListener("input", () => (this._bulkValue = bulkValue.value));
    on("input[data-shop]", "change", (e) => {
      const i = +e.currentTarget.dataset.shop;
      if (e.currentTarget.checked) this._shopSel.add(i);
      else this._shopSel.delete(i);
      this._render();
    });
    const shopEntity = root.getElementById("shop-entity");
    if (shopEntity) shopEntity.addEventListener("change", () => (this._shopEntity = shopEntity.value));
    const imageFile = root.getElementById("image-file");
    if (imageFile) {
      imageFile.addEventListener("change", () => {
        if (imageFile.files.length) this._uploadImage(imageFile.files[0]);
      });
    }
    const fileInput = root.getElementById("import-file");
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files.length) this._uploadFile(fileInput.files[0]);
      });
    }
    const mealie = root.getElementById("mealie");
    if (mealie) mealie.addEventListener("submit", (e) => this._migrateMealie(e, mealie));
    const cookIngs = root.getElementById("cook-ings");
    if (cookIngs) cookIngs.addEventListener("toggle", () => (this._cookIngredients = cookIngs.open));
    on("[data-act]", "click", (e) => this._action(e.currentTarget.dataset.act, e.currentTarget.dataset.id));

    on("[data-scale]", "click", (e) => {
      this._scale = parseFloat(e.currentTarget.dataset.scale);
      this._render();
    });
    // the amount box and its +/- buttons: whatever the recipe counts, they set the one multiplier
    const setAmount = (want) => {
      const r = this._recipe(this._view.id);
      if (!r || !(want > 0)) return;
      this._scale = Math.round((want / scaleBasis(r).base) * 10000) / 10000;
      this._render();
    };
    const amount = root.getElementById("amount");
    if (amount) amount.addEventListener("change", () => setAmount(parseFloat(amount.value)));
    on("[data-step]", "click", (e) => {
      const r = this._recipe(this._view.id);
      if (!r) return;
      const b = scaleBasis(r);
      const step = b.unit === "×" ? 0.5 : b.base >= 20 ? Math.round(b.base / 8) : 1;
      const next = b.base * this._scale + step * parseInt(e.currentTarget.dataset.step, 10);
      setAmount(Math.max(step, Math.round(next * 100) / 100));
    });
    on("input[data-i]", "change", (e) => {
      const n = +e.currentTarget.dataset.i;
      if (e.currentTarget.checked) this._checked.add(n);
      else this._checked.delete(n);
      this._saveProgress();
    });

    const search = root.getElementById("search");
    if (search) {
      search.addEventListener("input", () => {
        this._search = search.value;
        const pos = search.selectionStart;
        this._render();
        const again = this.shadowRoot.getElementById("search");
        again.focus();
        again.setSelectionRange(pos, pos);
      });
    }

    on("[data-timer]", "click", (e) => {
      const r = this._recipe(this._view.id);
      const n = +e.currentTarget.dataset.timer;
      this._startTimer(`${r.id}:${n}`, `${r.name} · step ${n + 1}`, +e.currentTarget.dataset.sec, r.id, n);
    });

    const toggleStep = (n) => this._setStepDone(n, !this._doneSteps.has(n));
    on("[data-step-toggle]", "click", (e) => {
      // links and the timer button inside a step keep their own behaviour
      if (e.target.closest("button, a, input")) return;
      const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : document.getSelection();
      if (sel && String(sel).trim()) return; // the user is selecting text, not tapping
      toggleStep(+e.currentTarget.dataset.stepToggle);
    });
    on("[data-step-toggle]", "keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        toggleStep(+e.currentTarget.dataset.stepToggle);
      }
    });
    on("input[data-step-done]", "change", (e) =>
      this._setStepDone(+e.currentTarget.dataset.stepDone, e.currentTarget.checked)
    );

    const form = root.getElementById("form");
    if (form) {
      this._bindMulti(root);
      form.addEventListener("submit", (e) => this._save(e, form));
      form.addEventListener("input", (e) => {
        this._formDirty = true;
        if (e.target.matches && e.target.matches("[name=yield_amount],[name=yield_unit],[name=default_scale]")) {
          const el = this.shadowRoot.getElementById("yield-preview");
          if (el) {
            const f = form.elements;
            el.textContent = this._yieldPreview({
              yield_amount: f.yield_amount.value,
              yield_unit: f.yield_unit.value,
              default_scale: f.default_scale.value,
            });
          }
        }
        if (e.target.matches && e.target.matches("[data-f=itext]")) this._refreshChips();
      });
      form.addEventListener("change", () => (this._formDirty = true));
      form.addEventListener("paste", (e) => {
        const row = e.target.closest && e.target.closest(".ing-row");
        if (row && e.target.matches("[data-f=itext]")) this._pasteRows(e, row.dataset.uid);
      });
      form.addEventListener("keydown", (e) => {
        // Enter in an ingredient row adds the next one instead of submitting.
        if (e.key === "Enter" && e.target.matches && e.target.matches(".ing-row [data-f=itext]")) {
          e.preventDefault();
          this._rowAction("add", e.target.closest(".ing-row").dataset.uid);
        }
      });
      form.addEventListener("click", (e) => {
        const chip = e.target.closest(".step .chip[data-uid]");
        if (chip) {
          chip.classList.toggle("active");
          this._formDirty = true;
          return;
        }
        const rowBtn = e.target.closest("[data-row-act]");
        if (rowBtn) return this._rowAction(rowBtn.dataset.rowAct, rowBtn.dataset.uid);
        const btn = e.target.closest("[data-step-act]");
        if (btn) this._stepAction(btn.dataset.stepAct, +btn.dataset.n);
      });
    }
    on("[data-open-new]", "click", async (e) => {
      e.preventDefault();
      this._bulk = null;
      await this._load();
      this._go({ name: "detail", id: e.currentTarget.dataset.openNew });
    });
    const imp = root.getElementById("import");
    if (imp) imp.addEventListener("submit", (e) => this._import(e, imp));
  }

  async _action(act, id) {
    switch (act) {
      case "menu":
        this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
        break;
      case "new":
        this._draft = null;
        this._go({ name: "edit" });
        break;
      case "import":
        this._go({ name: "import" });
        break;
      case "plan":
        this._planPending = null;
        this._go({ name: "plan", week: "" });
        break;
      case "plan-this":
        this._planPending = id;
        this._go({ name: "plan", week: "" });
        break;
      case "plan-prev":
      case "plan-next":
      case "plan-today": {
        const monday = this._planMonday();
        const next = act === "plan-today" ? new Date() : addDays(monday, act === "plan-prev" ? -7 : 7);
        this._planAdd = null;
        this._go({ name: "plan", week: act === "plan-today" ? "" : isoDate(mondayOf(next)) }, false, "replace");
        break;
      }
      case "plan-shop":
        await this._planToShopping();
        break;
      case "plan-cancel-pending":
        this._planPending = null;
        this._render();
        break;
      case "back":
      case "cancel":
        this._draft = null;
        this._back();
        break;
      case "edit":
        this._go({ name: "edit", id });
        break;
      case "cook":
        this._go({ name: "cook", id, step: 0 }, true);
        break;
      case "image-clear":
        this._syncForm();
        this._form.image = "";
        this._formDirty = true;
        this._render();
        break;
      case "progress-reset":
        this._checked = new Set();
        this._doneSteps = new Set();
        this._saveProgress();
        this._render();
        break;
      case "data":
        this._dataMsg = null;
        this._go({ name: "data" });
        break;
      case "export":
        await this._export();
        break;
      case "shop": {
        const r = this._recipe(id);
        this._shopSel = new Set(r.ingredients.map((_, i) => i).filter((i) => !isHeader(r.ingredients[i])));
        this._shopResult = null;
        this._go({ name: "shop", id }, true);
        break;
      }
      case "shop-add":
        await this._shopAdd(id);
        break;
      case "shop-done":
        this._shopResult = null;
        this._returnTo({ name: "detail", id });
        break;
      case "cook-next":
        this._cookStep(1);
        break;
      case "cook-prev":
        this._cookStep(-1);
        break;
      case "cook-focus":
        this._cookFocus = !this._cookFocus;
        try {
          localStorage.setItem("hass_recipes_cookfocus", this._cookFocus ? "1" : "0");
        } catch (_) { /* ignore */ }
        this._view = { ...this._view, step: 0 };
        this._render();
        this.scrollTo(0, 0);
        break;
      case "cook-finish": {
        const r = this._recipe(this._view.id);
        const steps = r ? this._cookSteps(r) : [];
        const cur = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
        if (steps[cur]) {
          this._doneSteps.add(steps[cur].i);
          this._saveProgress();
          this._checkAllDone();
        }
        this._returnTo({ name: "detail", id: this._view.id });
        break;
      }
      case "cook-exit":
        this._returnTo({ name: "detail", id: this._view.id });
        break;
      case "print":
        this._printRecipe(this._recipe(id));
        break;
      case "dashboard-recipe":
        try {
          await this._ws({
            type: "hass_recipes/set_cooking_recipe",
            recipe_id: this._cookingId === id ? null : id,
          });
          await this._load();
          this._flash(this._cookingId === id ? "Dashboard cook card now shows this recipe." : "Dashboard cook card cleared.");
        } catch (err) {
          this._error = err.message;
        }
        this._render();
        break;
      case "select":
        this._select = !this._select;
        this._picked = new Set();
        this._render();
        break;
      case "cookbook-save":
      case "cookbook-update":
      case "cookbook-delete":
        await this._cookbookAction(act);
        break;
      case "delete": {
        if (!confirm("Delete this recipe?")) return;
        try {
          await this._ws({ type: "hass_recipes/delete", recipe_id: id });
          await this._load();
          this._returnTo({ name: "list" });
        } catch (err) {
          this._error = err.message;
          this._render();
        }
        break;
      }
    }
  }

  _applyCookbook(id) {
    const cb = this._cookbooks.find((c) => c.id === id);
    this._cookbookId = cb ? cb.id : null;
    this._sel = {
      categories: new Set(cb ? cb.categories : []),
      tools: new Set(cb ? cb.tools : []),
      tags: new Set(cb ? cb.tags : []),
    };
    this._search = cb ? cb.query || "" : "";
    this._render();
  }

  _currentFilters() {
    return {
      categories: [...this._sel.categories],
      tools: [...this._sel.tools],
      tags: [...this._sel.tags],
      query: this._search.trim(),
    };
  }

  async _cookbookAction(act) {
    try {
      if (act === "cookbook-save") {
        const name = (prompt("Name for this cookbook:") || "").trim();
        if (!name) return;
        const cb = await this._ws({ type: "hass_recipes/cookbook_create", name, ...this._currentFilters() });
        this._cookbookId = cb.id;
      } else if (act === "cookbook-update") {
        await this._ws({ type: "hass_recipes/cookbook_update", cookbook_id: this._cookbookId, ...this._currentFilters() });
      } else if (act === "cookbook-delete") {
        if (!confirm("Delete this cookbook? The recipes are kept.")) return;
        await this._ws({ type: "hass_recipes/cookbook_delete", cookbook_id: this._cookbookId });
        this._cookbookId = null;
      }
      await this._load();
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }

  async _bulkAction(act) {
    const shown = this._recipes.filter((r) => this._matches(r, this._sel, this._search.trim().toLowerCase()));
    if (act === "all") this._picked = new Set(shown.map((r) => r.id));
    else if (act === "none") this._picked = new Set();
    else if (!this._picked.size) {
      this._error = "Select some recipes first.";
    } else {
      const ids = [...this._picked];
      try {
        if (act === "delete") {
          if (!confirm(`Delete ${ids.length} recipe(s)? This cannot be undone.`)) return;
          await this._ws({ type: "hass_recipes/bulk_delete", recipe_ids: ids });
          this._picked = new Set();
        } else {
          const value = this._bulkValue.trim();
          if (!value) {
            this._error = "Enter a value to add or remove.";
            return this._render();
          }
          await this._ws({
            type: "hass_recipes/bulk_update",
            recipe_ids: ids,
            [act]: { [this._bulkField]: [value] },
          });
        }
        this._error = "";
        await this._load();
        return;
      } catch (err) {
        this._error = err.message || String(err);
      }
    }
    this._render();
  }

  async _save(e, form) {
    e.preventDefault();
    this._syncForm();
    const d = this._form;
    // rows -> stored strings; remember each row's final index for step links
    const ingredients = [];
    const indexOf = new Map();
    for (const row of d.rows) {
      const text = row.text.trim();
      if (!text) continue;
      indexOf.set(row.uid, ingredients.length);
      ingredients.push(row.header ? `## ${text}` : joinSub(text, row.sub));
    }
    const payload = {
      name: d.name.trim(),
      description: d.description.trim(),
      image: d.image.trim(),
      servings: String(d.servings).trim(),
      yield_amount: parseFloat(d.yield_amount) > 0 ? parseFloat(d.yield_amount) : null,
      yield_unit: String(d.yield_unit || "").trim(),
      default_scale: parseFloat(d.default_scale) > 0 ? parseFloat(d.default_scale) : 1,
      prep_time: toInt(d.prep_time),
      cook_time: toInt(d.cook_time),
      total_time: toInt(d.total_time),
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
      categories: d.categories.split(",").map((t) => t.trim()).filter(Boolean),
      tools: d.tools.split(",").map((t) => t.trim()).filter(Boolean),
      ingredients,
      instructions: d.steps
        .filter((st) => st.text.trim())
        .map((st) => {
          if (st.section) return { text: st.text.trim(), ingredients: [], timer: null, section: true };
          const minutesValue = parseFloat(st.timer);
          return {
            text: st.text.trim(),
            ingredients: [...new Set(st.ingredients.map((u) => indexOf.get(u)).filter((i) => i !== undefined))].sort((x, y) => x - y),
            timer: minutesValue > 0 ? Math.max(1, Math.round(minutesValue * 60)) : null,
            section: false,
          };
        }),
      notes: d.notes.trim(),
      source_url: d.source_url.trim(),
    };
    const id = form.dataset.id;
    try {
      const saved = await this._ws(
        id ? { type: "hass_recipes/update", recipe_id: id, ...payload } : { type: "hass_recipes/create", ...payload }
      );
      this._draft = null;
      this._formDirty = false;
      await this._load();
      this._scale = saved.default_scale || 1; // show the recipe the way it was just defined
      this._returnTo({ name: "detail", id: saved.id });
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }

  async _import(e, form) {
    e.preventDefault();
    const urls = new FormData(form).get("urls").split(/\s+/).map((u) => u.trim()).filter(Boolean);
    const btn = this.shadowRoot.getElementById("import-btn");
    btn.disabled = true;
    btn.textContent = "Importing…";
    try {
      if (urls.length === 1) {
        // Preview first so the user can review/tweak before saving.
        this._draft = await this._ws({ type: "hass_recipes/import_url", url: urls[0] });
        this._go({ name: "edit" });
      } else {
        const res = await this._ws({ type: "hass_recipes/import_urls", urls });
        this._bulk = res.results;
        await this._load();
        this._render();
      }
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }
}

// Guard: a reload with a changed module URL can evaluate this file a second time.
if (!customElements.get("hass-recipes-panel")) {
  customElements.define("hass-recipes-panel", HassRecipesPanel);
}
