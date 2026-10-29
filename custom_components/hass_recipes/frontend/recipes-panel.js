/* Recipes panel: dependency-free web component rendered in the HA sidebar.
 *
 * This file holds the element itself (state, routing, rendering, the click dispatcher).
 * The rest is split by concern into panel-*.js modules whose methods are mixed into
 * the class below: panel-timers, -progress, -browse, -plan, -data, -recipe and -form.
 * Helpers shared by all of them are in panel-helpers.js.
 */

// Every file is imported with this file's own ?v=, so a changed one is never mixed with a stale one.
const __v = new URL(import.meta.url).searchParams.get("v");
const load = (name) => import(`./${name}.js${__v ? `?v=${__v}` : ""}`);
const helpers = (await load("panel-helpers")).default;
const { esc, isHeader, clock, scaleBasis, observeTranslations, T, state, isoDate, addDays, mondayOf } = helpers;
const parts = await Promise.all(["panel-timers", "panel-progress", "panel-browse", "panel-plan", "panel-data", "panel-recipe", "panel-nutrition", "panel-foods", "panel-tracker", "panel-form", "panel-editor"].map(load));

const STYLE = `
  :host { --hq-loud: var(--ha-color-fill-primary-loud-resting, var(--primary-color)); --hq-on-loud: var(--ha-color-on-primary-loud, #fff); --hq-normal: var(--ha-color-fill-primary-normal-resting, color-mix(in srgb, var(--primary-color) 14%, #fff)); --hq-on-normal: var(--ha-color-on-primary-normal, var(--primary-color)); --hq-outline: var(--outline-color, var(--divider-color)); display: block; height: 100%; overflow: auto; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  * { box-sizing: border-box; }
  :host(.compact) { overflow: visible; height: auto; }
  .cq { container-type: inline-size; min-height: 100%; }
  .sticky { position: sticky; top: 0; z-index: 2; }
  header { display: flex; align-items: center; box-sizing: border-box; height: 56px; padding: 8px 12px; background: var(--sidebar-background-color, var(--app-header-background-color, var(--card-background-color))); border-bottom: 1px solid var(--divider-color); font-size: var(--ha-font-size-xl, 20px); font-weight: 400; color: var(--sidebar-text-color, var(--primary-text-color)); }
  .timers:empty { display: none; }
  .timers { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; background: var(--secondary-background-color); border-bottom: 1px solid var(--divider-color); }
  .timer { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 16px; background: var(--card-background-color); border: 1px solid var(--divider-color); font-size: 14px; }
  .timer .t-time { font-variant-numeric: tabular-nums; font-weight: 600; }
  .timer.done { background: var(--error-color, #db4437); color: #fff; border-color: transparent; animation: pulse 1s infinite; }
  .timer button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; }
  .timer button.stop { background: #fff; color: var(--error-color, #db4437); border-radius: 12px; padding: 2px 12px; font-weight: 600; }
  @keyframes pulse { 50% { opacity: .6; } }
  header h1 { font-size: inherit; font-weight: inherit; margin: 0; margin-inline-start: var(--ha-space-6, 24px); flex: 1; min-width: 0; line-height: 1.5; }
  main { max-width: 1200px; margin: 0 auto; padding: 16px; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  input, textarea, select { font: inherit; color: inherit; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px 10px; width: 100%; }
  textarea { resize: none; max-width: 100%; }
  /* text boxes grow with what is typed (see _autosize), so there is nothing to drag */
  textarea[data-autosize] { overflow: hidden; min-height: 2.6em; }
  .toolbar input { flex: 1; min-width: 180px; width: auto; }
  button.btn { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 8px 14px; background: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.btn.secondary { background: transparent; color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  button.btn.danger { background: var(--error-color, #db4437); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { padding: 3px 10px; border-radius: 12px; font-size: 13px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); cursor: pointer; }
  .chip.active { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  /* ---- recipe browser: toolbar, filter pane, groups and three views ---- */
  header .tabs { flex: 1; display: flex; justify-content: center; font-size: var(--ha-font-size-m, 14px); overflow: hidden; }
  header ha-icon-button { color: var(--sidebar-icon-color, var(--secondary-text-color)); flex-shrink: 0; }
  header .hsp { display: none; }
  header ha-input-search { flex: 1; min-width: 0; margin-inline-start: var(--ha-space-2, 8px); }
  .tabwrap { cursor: pointer; display: flex; max-width: 45%; overflow: hidden; }
  .tabwrap ha-tab { flex: 1; min-width: 0; }
  .bottomtabs { position: fixed; left: 0; right: 0; bottom: 0; height: 56px; box-sizing: border-box; padding: 0 16px; z-index: 2; display: flex; justify-content: space-around; font-size: var(--ha-font-size-s, 12px); background: var(--sidebar-background-color, var(--card-background-color)); border-top: 1px solid var(--divider-color); }
  .bottomtabs .tabwrap { width: 25%; max-width: none; }
  .cq.with-bar { padding-bottom: 56px; }
  ha-button.fab.above-tabs { bottom: 84px; }
  main.wide { max-width: none; padding: 0; }
  main.wide > .notice, main.wide > .error { margin: 12px 16px; }
  .bshell.with-pane { display: grid; grid-template-columns: 250px minmax(0, 1fr); align-items: stretch; }
  .bmain { min-width: 0; }
  .btool { display: flex; justify-content: space-between; align-items: center; gap: var(--ha-space-4, 16px); box-sizing: border-box; width: 100%; height: 56px; padding: 0 16px; background: var(--primary-background-color); border-bottom: 1px solid var(--divider-color); }
  .bcontent { min-width: 0; }
  .selection-bar { background: rgba(var(--rgb-primary-color), .1); box-sizing: border-box; width: 100%; height: 56px; font-size: var(--ha-font-size-m, 14px); --ha-assist-chip-container-color: var(--card-background-color); justify-content: space-between; align-items: center; padding: 8px 12px; display: flex; gap: 16px; overflow-x: auto; scrollbar-width: none; }
  .selection-bar > * { flex: none; }
  .selection-controls { align-items: center; gap: var(--ha-space-2, 8px); display: flex; }
  .selection-controls p { margin: 0; margin-inline-start: 8px; }
  .center-vertical { align-items: center; gap: var(--ha-space-2, 8px); display: flex; }
  ha-input.bulk-value { width: 160px; --ha-input-height: 32px; }
  .bcontent.cards, .bcontent.rows { padding: 16px 16px 88px; }
  .bcontent .empty { padding: 48px 16px; }
  .fpane { background: var(--primary-background-color); border-right: 1px solid var(--divider-color); font-size: 14px; }
  .fpane-in { position: sticky; top: 56px; max-height: calc(100vh - 60px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb-color) transparent; }
  .fpane-in::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
  .fpane-in::-webkit-scrollbar-thumb { border-radius: var(--ha-border-radius-sm, 4px); background: var(--scrollbar-thumb-color); }
  .fhead { display: flex; justify-content: space-between; align-items: center; height: 56px; box-sizing: border-box; padding: 0 16px; border-bottom: 1px solid var(--divider-color); }
  .bcount { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 16px; box-sizing: border-box; border-radius: 50%; font-size: var(--ha-font-size-xs, 10px); font-weight: 400; line-height: 1.5; text-align: center; padding: 0 2px; background: var(--primary-color); color: var(--text-primary-color, #fff); pointer-events: none; }
  .fit { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px 0 16px; cursor: pointer; }
  .fit[hidden] { display: none; }
  .fit:hover { background: var(--secondary-background-color); }
  .fit span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .fit em { font-style: normal; color: var(--secondary-text-color); font-size: 12px; }
  .fit.cbk.on { background: color-mix(in srgb, var(--primary-color) 14%, transparent); color: var(--primary-color); font-weight: 500; }
  .fact { display: flex; flex-direction: column; align-items: flex-start; padding: 0 8px 8px 44px; }
  .bgh { display: flex; align-items: center; gap: 8px; min-height: 52px; padding-inline-start: 12px; font-size: .875rem; font-weight: 500; cursor: pointer; user-select: none; }
  .bgh:first-child { margin-top: 0; }
  .bgh ha-icon { --mdc-icon-size: 24px; color: var(--primary-text-color); flex: none; }
  .bgh .gi { color: var(--secondary-text-color); }
  .bgh em { font-style: normal; font-weight: 400; font-size: .75rem; color: var(--secondary-text-color); }
  .bgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .rcard { position: relative; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; }
  .rcard:hover, .rrow:hover { --ha-card-border-color: var(--primary-color); }
  .rpic { background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color)) center/cover no-repeat; color: var(--secondary-text-color); display: flex; align-items: center; justify-content: center; flex: none; }
  .rpic ha-icon { --mdc-icon-size: 34px; }
  .rcard .rpic { height: 120px; }
  .rtx { padding: 10px 12px 12px; min-width: 0; flex: 1; }
  .rtitle { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .rtitle b { font-weight: 500; font-size: var(--ha-font-size-m, 14px); line-height: 1.3; }
  .rtx span { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .rpen { background: none; border: 0; color: var(--secondary-text-color); cursor: pointer; padding: 4px; border-radius: 50%; flex: none; display: inline-flex; }
  .rpen:hover { background: var(--secondary-background-color); color: var(--primary-text-color); }
  .rpen ha-icon { --mdc-icon-size: 18px; }
  .brows { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .rrow { position: relative; display: flex; gap: 14px; padding: 12px; cursor: pointer; align-items: flex-start; }
  .rrow .rpic { width: 84px; height: 84px; border-radius: 10px; }
  .rrow .rtx { padding: 0; }
  .rrow b { font-weight: 500; font-size: var(--ha-font-size-m, 14px); display: block; }
  .rrow p { margin: 2px 0 8px; font-size: var(--ha-font-size-m, 14px); color: var(--secondary-text-color); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .rmeta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .badge { background: color-mix(in srgb, var(--primary-color) 14%, transparent); color: var(--primary-color); border-radius: 10px; padding: 1px 9px; }
  .bcontent { padding-bottom: 88px; }
  /* the browser uses Home Assistant's own elements; these only place them */
  ha-assist-chip, ha-filter-pane-chip { --ha-assist-chip-container-shape: 10px; --ha-assist-chip-container-color: var(--card-background-color); cursor: pointer; }
  .select-mode-chip { --md-assist-chip-icon-label-space: 0; --md-assist-chip-trailing-space: 8px; }
  ha-dropdown ha-assist-chip { --md-assist-chip-trailing-space: 8px; }
  ha-dropdown-item[data-sel] { border: 1px solid var(--primary-color); font-weight: var(--ha-font-weight-medium, 500); color: var(--primary-color); background-color: var(--ha-color-fill-primary-quiet-resting); --icon-primary-color: var(--primary-color); }
  .chipwrap { position: relative; display: inline-block; }
  .bcount { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 16px; box-sizing: border-box; border-radius: 50%; font-size: var(--ha-font-size-xs, 10px); font-weight: 400; line-height: 1.5; text-align: center; padding: 0 2px; background: var(--primary-color); color: var(--text-primary-color, #fff); pointer-events: none; }
  .btool ha-input-search { flex: 1 1 0%; min-width: 0; }
  @media (min-width: 871px) { .btool ha-input-search { --ha-input-search-height: 32px; --ha-input-search-border-radius: 10px; } }
  .btool ha-dropdown { flex: none; }
  .vseg { display: inline-flex; gap: 1px; flex: none; }
  ha-expansion-panel.fsec { display: block; border-bottom: 1px solid var(--divider-color); --expansion-panel-summary-padding: 0 8px; --expansion-panel-content-padding: 0; }
  .fhdr { display: flex; align-items: center; flex: 1; min-width: 0; }
  .fhdr .badge { background: var(--primary-color); color: var(--text-primary-color, #fff); border-radius: 50%; min-width: 20px; height: 20px; line-height: 20px; text-align: center; font-size: 12px; margin-inline-start: 8px; padding: 0 4px; box-sizing: border-box; }
  .fhdr .fclear { margin-inline-start: auto; --mdc-icon-button-size: 40px; }
  ha-input-search.fsearch { display: block; padding: 4px 8px 0; }
  ha-check-list-item { --mdc-theme-text-primary-on-background: var(--primary-text-color); height: 48px; }
  ha-adaptive-dialog { --dialog-content-padding: 0; --ha-bottom-sheet-height: calc(100dvh - var(--ha-space-12, 48px)); }
  .dlgbody { display: flex; flex-direction: column; flex: 1 1 0%; min-height: 0; overflow-y: auto; }
  .fit > ha-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); flex: none; }
  .fact { display: flex; flex-direction: column; align-items: flex-start; padding: 0 8px 8px 40px; }
  ha-button.fab { position: fixed; right: 24px; bottom: 24px; z-index: 1; --ha-button-box-shadow: var(--ha-box-shadow-l, 0 4px 12px rgba(0,0,0,.25)); }
  .tblhost { overflow-x: hidden; }
  ha-data-table { --data-table-border-width: 0; --data-table-background-color: var(--card-background-color); }
  /* ---- recipe page: Home Assistant's own cards, lists, expansion panels and buttons ---- */
  main.rdmain { max-width: none; padding: 0; }
  .rd { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; align-items: start; padding: 16px 16px 96px; }
  .rd-left, .rd-right { display: grid; gap: 16px; min-width: 0; }
  .rd ha-card { display: block; overflow: hidden; }
  .rd-hero { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  .rd-nohero { display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color)); color: var(--secondary-text-color); --mdc-icon-size: 48px; }
  .rd-desc { margin: 0 0 12px; color: var(--secondary-text-color); line-height: 1.5; }
  .rd-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .rd-facts { margin-bottom: 12px; }
  .rd ha-assist-chip { --ha-assist-chip-container-shape: 10px; --ha-assist-chip-container-color: var(--card-background-color); }
  .card-content { padding: 16px; }
  ha-card > .card-content:first-child, .rd-hero + .card-content { padding-top: 16px; }
  .card-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px; border-top: 1px solid var(--divider-color); }
  .rd a.rd-src { text-decoration: none; color: inherit; display: block; }
  .rd-scale { display: flex; flex-direction: column; gap: 12px; }
  .rd-amount { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .rd-amount ha-input { width: 96px; --ha-input-height: 40px; }
  .rd-presets { display: inline-flex; gap: 1px; }
  .rd-sec { display: block; border-top: 1px solid var(--divider-color); --expansion-panel-summary-padding: 0 8px; --expansion-panel-content-padding: 0; }
  .rd-sh { display: flex; align-items: center; gap: 8px; font-weight: 500; }
  .rd-sh .muted { font-weight: 400; }
  .rd-ings .ing-text { display: block; line-height: 1.4; }
  .rd-step { --ha-list-item-headline-line-clamp: none; }
  .rd-num { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--secondary-background-color); color: var(--secondary-text-color); border: 1px solid var(--divider-color); font-size: 12px; box-sizing: border-box; --mdc-icon-size: 16px; }
  .rd-step.done .rd-num { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047); color: #fff; }
  .rd-text { display: block; line-height: 1.9; white-space: pre-line; }
  .rd-step.done .rd-text { opacity: .55; text-decoration: line-through; }
  .rd-extra { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-top: 4px; }
  header .main-title { flex: 1; min-width: 0; margin-inline-start: var(--ha-space-6, 24px); line-height: 1.2; }
  header .main-title b { display: block; font-weight: 400; font-size: var(--ha-font-size-xl, 20px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header .main-title span { display: block; font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  @container (max-width: 760px) { .rd { grid-template-columns: minmax(0, 1fr); } header .main-title { margin-inline-start: var(--ha-space-2, 8px); } }
  .rcard.picked, .rrow.picked { outline: 3px solid var(--primary-color); }
  @container (max-width: 680px) {
    main { padding: 12px; }
    main.wide { padding: 0; }
    .btool { justify-content: flex-start; padding: 0 0 0 16px; overflow-x: scroll; scrollbar-width: none; }
    ha-button.fab { right: 16px; bottom: 16px; }
    ha-expansion-panel.fsec { --expansion-panel-summary-padding: 0 16px; }
    header { padding: 4px; }
    header h1 { margin-inline-start: var(--ha-space-2, 8px); }
    .btool::-webkit-scrollbar { display: none; }
    .btool > * { flex: none; }
    .bcontent.cards, .bcontent.rows { padding: 12px 12px 88px; }
    .bgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .rcard .rpic { height: 84px; }
    .brows { grid-template-columns: 1fr; gap: 8px; }
    .rrow .rpic { width: 64px; height: 64px; }
    header .tabs button { padding: 8px 8px; }
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
  .ing-chip .alt { color: var(--secondary-text-color); font-size: .9em; }
  .ing-chip.tick { cursor: pointer; user-select: none; }
  .ing-chip.tick:hover { filter: brightness(.95); }
  .ing-chip.done { opacity: .55; text-decoration: line-through; }
  .ing-chip ha-icon { --mdc-icon-size: 14px; align-self: center; margin-inline-end: -2px; text-decoration: none; }
  .ing-chip .q { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ing-chip b { font-weight: 500; }
  .cook-sections { display: flex; gap: 8px; margin-top: 14px; }
  .cook-sections .btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .cook-sections .btn small { font-size: 12px; opacity: .8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cook-jumps { display: inline-flex; gap: 6px; flex-wrap: wrap; }
  .step-text .ing-chip, .cook .cook-text .ing-chip, .cstep .cstep-text .ing-chip { display: inline-flex; padding: 0 8px; margin: 0 1px; font-size: .9em; vertical-align: baseline; }
  .timer-btn { margin-top: 10px; }
  .ne-page { max-width: 900px; margin: 0 auto; padding: var(--ha-space-4, 16px); padding-bottom: 96px; display: flex; flex-direction: column; gap: var(--ha-space-4, 16px); }
  .ne-meta-in { padding: var(--ha-space-4, 16px); display: flex; flex-direction: column; gap: var(--ha-space-2, 8px); }
  .ne-meta-card ha-expansion-panel { --expansion-panel-content-padding: 0; --expansion-panel-summary-padding: 0; }
  .ne-photo { display: flex; align-items: center; gap: var(--ha-space-3, 12px); flex-wrap: wrap; padding: var(--ha-space-2, 8px) 0; }
  .ne-photo .btns { display: flex; gap: var(--ha-space-2, 8px); flex-wrap: wrap; }
  .ne-card { display: block; }
  .ne-head { display: flex; align-items: center; gap: var(--ha-space-1, 4px); padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-1, 4px); }
  .ne-title { flex: 1; min-width: 0; --ha-input-height: 40px; }
  .ne-count { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); white-space: nowrap; margin-inline: var(--ha-space-2, 8px); }
  .ne-body { border-top: 1px solid var(--divider-color); padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-4, 16px); }
  .ne-sub { font-size: var(--ha-font-size-s, 12px); font-weight: 500; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); margin: var(--ha-space-3, 12px) 0 var(--ha-space-2, 8px); }
  .ne-handle { cursor: grab; color: var(--secondary-text-color); flex: none; }
  .ne-row { display: flex; gap: var(--ha-space-1, 4px); align-items: center; flex-wrap: wrap; margin-bottom: var(--ha-space-2, 8px); }
  .ne-row .ne-qty { flex: 2 1 160px; min-width: 0; }
  .ne-row .ne-note { flex: 1 1 110px; min-width: 0; }
  .ne-sub-row { display: flex; gap: var(--ha-space-1, 4px); align-items: center; flex: 1 0 100%; padding-inline-start: 48px; }
  .ne-sub-row ha-input { flex: 1; min-width: 0; }
  .ne-step { display: flex; gap: var(--ha-space-1, 4px); align-items: flex-start; border: 1px solid var(--divider-color); border-radius: var(--ha-border-radius-lg, 12px); padding: var(--ha-space-2, 8px) var(--ha-space-1, 4px); margin-bottom: var(--ha-space-2, 8px); background: var(--card-background-color); }
  .ne-step:focus-within { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
  .ne-n { width: 24px; height: 24px; margin-top: 12px; border-radius: 50%; flex: none; background: var(--secondary-background-color); font-size: var(--ha-font-size-s, 12px); display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
  .ne-main { flex: 1; min-width: 0; position: relative; }
  .ne-text { outline: none; line-height: 1.9; min-height: 1.9em; padding: var(--ha-space-2, 8px) 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--ha-font-size-m, 14px); }
  .ne-text:empty::before { content: attr(data-ph); color: var(--secondary-text-color); }
  .ne-chip { display: inline-block; background: var(--ha-color-fill-primary-quiet-resting, color-mix(in srgb, var(--primary-color) 16%, transparent)); color: var(--ha-color-on-primary-quiet, var(--primary-color)); border-radius: var(--ha-border-radius-md, 8px); padding: 0 var(--ha-space-2, 8px); line-height: 1.6; margin: 0 1px; white-space: normal; }
  .ne-ins { visibility: hidden; }
  .ne-typing .ne-ins { visibility: visible; color: var(--primary-color); }
  .ne-quick { display: none; flex-wrap: wrap; align-items: center; gap: var(--ha-space-1, 4px); margin-top: var(--ha-space-1, 4px); }
  .ne-step:focus-within .ne-quick { display: flex; }
  .ne-quick-label { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); margin-inline-end: 2px; }
  .ne-quick-chip { cursor: pointer; --ha-assist-chip-container-shape: 10px; }
  .ne-quick-chip.used { opacity: .5; }
  .ne-extra { user-select: none; display: inline-flex; align-items: center; gap: 2px; margin: 2px 4px 2px 0; }
  .ne-extra button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; display: inline-flex; --mdc-icon-size: 14px; }
  .ne-extras { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ha-space-1, 4px); margin-top: var(--ha-space-1, 4px); }
  .ne-timer { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--ha-space-1, 4px); font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .ne-timer ha-input.nt { width: 84px; --ha-input-height: 40px; }
  .ne-timer ha-input.ne-tl { width: 150px; --ha-input-height: 40px; }
  .ne-pick { position: absolute; left: 0; right: 0; z-index: 5; margin-top: 2px; background: var(--card-background-color); border-radius: var(--ha-border-radius-lg, 12px); box-shadow: var(--ha-box-shadow-l, 0 4px 12px rgba(0,0,0,.25)); max-height: 260px; overflow: auto; }
  .ne-pick[hidden] { display: none; }
  .ne-pick ha-list-item-button.on { background: var(--ha-color-fill-primary-quiet-resting, color-mix(in srgb, var(--primary-color) 14%, transparent)); }
  .ne-body ha-button[data-ne-act] { margin-top: var(--ha-space-1, 4px); }
  ha-button.ne-add-section { align-self: stretch; }
  .ne-dragging { opacity: .4; }
  .ne-drop { outline: 2px dashed var(--primary-color); border-radius: 8px; }
  .drop-before { box-shadow: 0 -3px 0 var(--primary-color); }
  .drop-after { box-shadow: 0 3px 0 var(--primary-color); }
  @media (pointer: coarse) { .ne-handle { display: none; } }
  @container (max-width: 560px) {
    .ne-page { padding: var(--ha-space-2, 8px); padding-bottom: 96px; gap: var(--ha-space-2, 8px); }
    .ne-count { display: none; }
    .ne-body { padding-inline: var(--ha-space-2, 8px); }
    .ne-row .ne-qty { flex: 1 1 0; min-width: 120px; }
    .ne-row .ne-note { flex: 1 0 100%; order: 5; }
    .ne-sub-row { padding-inline-start: 0; }
  }
  .facet-label { font-size: 12px; color: var(--secondary-text-color); align-self: center; text-transform: uppercase; letter-spacing: .04em; }
  .units { margin-left: auto; }
  .ing-text { display: flex; flex-direction: column; }
  .ing-qty { font-variant-numeric: tabular-nums; }
  .ing-note { color: var(--secondary-text-color); }
  .ing-paren { color: var(--secondary-text-color); }
  main.plan { max-width: none; padding: 0; }
  .plan-page { display: flex; height: calc(100vh - 56px); }
  :host(.compact) .plan-page { height: calc(100vh - 112px); }
  .plan-pane { width: 280px; flex: none; box-sizing: border-box; border-right: 1px solid var(--divider-color); overflow-y: auto; background: var(--primary-background-color); display: flex; flex-direction: column; }
  .plan-search { padding: var(--ha-space-3, 12px) var(--ha-space-3, 12px) 0; }
  .plan-search ha-input-search { display: block; }
  .plan-hint { margin: var(--ha-space-2, 8px) var(--ha-space-4, 16px); font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .plan-recs { flex: 1; }
  .plan-recs ha-expansion-panel { --expansion-panel-summary-padding: 0 var(--ha-space-4, 16px); --expansion-panel-content-padding: 0; border-bottom: 1px solid var(--divider-color); display: block; }
  .plan-cat { font-weight: 500; font-size: var(--ha-font-size-m, 14px); }
  .plan-count { color: var(--secondary-text-color); font-weight: 400; margin-inline-start: 6px; }
  .plan-rec { cursor: grab; }
  .plan-rec .pd-thumb { width: 32px; height: 32px; }
  .plan-legend { display: flex; flex-wrap: wrap; gap: var(--ha-space-3, 12px); padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px); border-top: 1px solid var(--divider-color); font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .plan-legend .plan-key { font-size: var(--ha-font-size-s, 12px); gap: 6px; }
  .plan-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .fd-page { display: flex; min-height: calc(100vh - 56px); }
  .fd-main { flex: 1; min-width: 0; }
  .fd-tool { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px); }
  .fd-tool ha-input-search { width: 260px; }
  .fd-tool ha-assist-chip { cursor: pointer; }
  .fd-pane { width: 400px; flex: none; box-sizing: border-box; border-left: 1px solid var(--divider-color); background: var(--primary-background-color); padding: var(--ha-space-4, 16px); overflow-y: auto; max-height: calc(100vh - 56px); position: sticky; top: 56px; }
  .fd-detail-page { padding: var(--ha-space-4, 16px); max-width: 640px; margin: 0 auto; padding-bottom: 96px; }
  .fd-dhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .fd-dhead h2 { margin: 0; font-size: var(--ha-font-size-xl, 20px); font-weight: 400; }
  .fd-detail h3 { margin: 20px 0 8px; font-size: var(--ha-font-size-m, 14px); font-weight: 500; }
  .fd-srcs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .fd-srcs ha-assist-chip { cursor: pointer; }
  .fd-frida { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
  .fd-urow { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .fd-urow ha-input { flex: 1; min-width: 0; }
  .fd-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
  .fm-res { max-height: 45vh; overflow-y: auto; }
  .fm-head { padding: 8px 16px 2px; font-size: 0.8em; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); }
  .fd-preview { list-style: none; margin: 0 0 12px; padding: 0; }
  .fd-preview li { display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; }
  .fd-preview ha-icon { color: var(--secondary-text-color); flex: none; --mdc-icon-size: 20px; }
  .fd-selbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 0 var(--ha-space-4, 16px); min-height: 48px; background: var(--ha-color-fill-primary-quiet-resting, color-mix(in srgb, var(--primary-color) 14%, transparent)); }
  .fd-selbar[hidden] { display: none; }
  main.tracker { max-width: 860px; margin-inline: auto; }
  .tk-page { display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px) 96px; }
  .tk-tool { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .tk-people, .tk-modes, .tk-nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tk-people ha-assist-chip, .tk-modes ha-assist-chip, .tk-nav ha-assist-chip { cursor: pointer; }
  .tk-title { min-width: 120px; text-align: center; }
  .tk-kcal { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .tk-big { font-size: 2rem; font-weight: 500; line-height: 1.1; }
  .tk-big span { font-size: 1rem; font-weight: 400; color: var(--secondary-text-color); }
  .tk-over { color: var(--error-color); }
  .tk-macros { display: flex; gap: 8px; justify-content: space-around; flex-wrap: wrap; margin-top: 12px; }
  .tk-macro { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .tk-mlabel { font-size: 0.85em; color: var(--secondary-text-color); }
  .tk-mlabel b { color: var(--primary-text-color); font-weight: 500; }
  .tk-planned { border: 1px dashed var(--divider-color); box-shadow: none; }
  .tk-prow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .tk-mhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }
  .tk-ekcal { white-space: nowrap; color: var(--secondary-text-color); }
  .tk-avg { display: flex; gap: 24px; margin: 12px 0; }
  .tk-chart { min-height: 220px; }
  .tk-res { max-height: 45vh; overflow-y: auto; }
  .tk-fhead { margin-bottom: 4px; }
  .tk-preview { min-height: 1.4em; }
  .tk-loading { padding: 24px; }
  .tk-pin { position: sticky; top: 56px; z-index: 1; margin: 0 calc(-1 * var(--ha-space-4, 16px)); padding: 8px var(--ha-space-4, 16px); background: var(--card-background-color); border-bottom: 1px solid var(--divider-color); font-size: 0.95em; }
  .tk-pin[hidden] { display: none; }
  .tk-pin b { font-size: 1.2em; font-weight: 500; }
  .tk-quick { display: flex; flex-wrap: wrap; gap: 8px; }
  .tk-quick ha-assist-chip, .tk-chips ha-assist-chip { cursor: pointer; }
  .tk-copy { margin-top: 12px; }
  .tk-copy ha-assist-chip { cursor: pointer; }
  .tk-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .tk-stepper { display: flex; align-items: center; justify-content: center; gap: 12px; }
  .tk-stepper ha-icon-button { --mdc-icon-button-size: 56px; --mdc-icon-size: 28px; border: 1px solid var(--divider-color); border-radius: 50%; }
  .tk-stepper ha-input { width: 120px; --ha-font-size-m: 1.6rem; text-align: center; }
  .tk-preview { text-align: center; }
  .tk-deficit { margin: 8px 0 4px; }
  .tk-weight { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 12px 0; padding-top: 12px; border-top: 1px solid var(--divider-color); }
  .tk-wchart { flex-basis: 100%; min-height: 160px; }
  .tk-cres { display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); }
  .tk-cgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
  .tk-cc .tk-big { font-size: 1.6rem; }
  .tk-pace { cursor: pointer; border: 2px solid transparent; box-shadow: none; outline: 1px solid var(--divider-color); }
  .tk-pace.on { border-color: var(--primary-color); outline: none; background: var(--ha-color-fill-primary-quiet-resting, color-mix(in srgb, var(--primary-color) 10%, transparent)); }
  .tk-note { margin-top: 8px; font-size: 0.85em; }
  #tk-body { display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); }
  .tk-fhead { font-size: 1.1em; }
  .nu-selbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; position: sticky; top: 0; z-index: 2; min-height: 48px; padding: 0 8px; margin: 4px 0; border-radius: 8px; background: var(--ha-color-fill-primary-quiet-resting, color-mix(in srgb, var(--primary-color) 14%, var(--card-background-color))); }
  .nu-selbar[hidden] { display: none; }
  .nu-seln { font-weight: 500; margin-inline: 4px 12px; }
  .nu-line ha-checkbox { margin-inline: -8px 0; flex: none; }
  .fd-groups { margin: 0 var(--ha-space-4, 16px) var(--ha-space-3, 12px); }
  .fd-groups-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .fd-groups-head > ha-icon { color: var(--primary-color); flex: none; }
  .fd-groups-title { flex: 1; min-width: 0; }
  .fd-group { display: flex; align-items: flex-start; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--divider-color); }
  .fd-group-main { flex: 1; min-width: 0; }
  .fd-group-names { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .fd-group-to { font-size: 0.9em; }
  .fd-group-why { font-size: 0.85em; color: var(--secondary-text-color); }
  .fd-group-btns { display: flex; align-items: center; flex: none; }
  .fd-group-edit { display: flex; flex-direction: column; margin-bottom: 12px; }
  .fd-seln { font-weight: 500; margin-inline: 4px 12px; }
  .plan-cal { flex: 1; min-height: 0; display: flex; }
  .plan-cal ha-full-calendar { flex: 1; min-width: 0; height: 100%; }
  .plan-key { display: inline-flex; align-items: center; gap: 12px; font-size: var(--ha-font-size-m, 14px); }
  .plan-dot { width: 10px; height: 10px; border-radius: 50%; }
  .plan-main ha-alert { display: block; margin: var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0; }
  .pdlg { display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); min-width: min(380px, 80vw); }
  .pd-slots { display: flex; gap: var(--ha-space-2, 8px); flex-wrap: wrap; }
  .pd-slots ha-assist-chip { cursor: pointer; }
  .pd-results { max-height: 40vh; overflow-y: auto; }
  .pd-thumb { width: 40px; height: 40px; border-radius: 8px; background: var(--secondary-background-color) center / cover; display: block; }
  .pd-plain { display: flex; gap: var(--ha-space-2, 8px); align-items: center; }
  .pd-plain ha-input { flex: 1; }
  .pm-list { display: flex; flex-direction: column; max-height: 55vh; overflow-y: auto; }
  .pm-list ha-expansion-panel { display: block; border-bottom: 1px solid var(--divider-color); --expansion-panel-content-padding: 0 var(--ha-space-4, 16px); }
  .pm-head { display: flex; align-items: center; gap: 12px; font-weight: 500; }
  .pm-tools { justify-content: flex-end; }
  .pd-actions { display: flex; gap: var(--ha-space-2, 8px); flex-wrap: wrap; }
  .ing-sub { color: var(--secondary-text-color); font-size: 12px; }
  .ing-comment { display: block; color: var(--secondary-text-color); font-size: 13px; font-style: italic; margin-top: 2px; }
  .ing-comment-input { margin-top: 4px; width: 100%; }
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
  .step-text, .cook-text { white-space: pre-line; }
  .step-item.done .step-text { text-decoration: line-through; opacity: .55; }
  .cook-text[data-step-toggle] { cursor: pointer; }
  .cook-section { text-transform: uppercase; letter-spacing: .06em; font-size: .85rem; color: var(--primary-color); margin-top: 6px; }
  .cook-done { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; cursor: pointer; }
  .cook-done input { width: auto; }
  .mini { background: none; border: 1px solid var(--divider-color); border-radius: 6px; color: inherit; cursor: pointer; padding: 4px 8px; font: inherit; }
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
  .multi { position: relative; }
  .multi-field { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 40px; padding: 4px 8px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); }
  .multi-field:focus-within { border-color: var(--primary-color); }
  .multi-chip { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
  .multi-x { border: 0; background: none; color: inherit; cursor: pointer; padding: 0 0 0 2px; font-size: 11px; opacity: .8; }
  .multi-field input.multi-filter { flex: 1 1 90px; width: auto; min-width: 80px; border: 0; background: none; padding: 4px; outline: none; }
  .multi-menu { position: absolute; z-index: 5; left: 0; right: 0; top: 100%; margin-top: 2px; max-height: 260px; overflow: auto; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: var(--ha-card-box-shadow, 0 4px 12px rgba(0,0,0,.25)); padding: 4px 0; }
  .multi-menu[hidden] { display: none; }
  .multi-opt { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; font-size: 14px; }
  .multi-opt:hover { background: var(--secondary-background-color); }
  .multi-opt input { width: 18px; height: 18px; flex: none; accent-color: var(--primary-color); }
  .multi-create { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-top: 1px solid var(--divider-color); background: none; color: var(--primary-color); font: inherit; cursor: pointer; }
  .multi-create:hover { background: var(--secondary-background-color); }
  .multi-empty { padding: 10px 12px; }
  form label.lbl { display: block; font-size: 13px; color: var(--secondary-text-color); margin-bottom: 4px; }
  form .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
  .img-field { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .img-preview { width: 140px; height: 105px; object-fit: cover; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--secondary-background-color); }
  .img-controls { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .img-controls .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  label.btn { display: inline-block; }
  .rcard .pick, .rrow .pick { position: absolute; top: 8px; left: 8px; z-index: 1; width: 22px; height: 22px; border-radius: 50%; background: var(--card-background-color); border: 2px solid var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .picked .pick { background: var(--primary-color); color: var(--text-primary-color, #fff); }
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
  .cstep .tick:not(.ing-chip) { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--divider-color); display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .cstep-text { font-size: 1.25rem; line-height: 1.55; white-space: pre-line; }
  .cstep.done { border-left-color: var(--success-color, #43a047); }
  .cstep.done .cstep-text { text-decoration: line-through; opacity: .5; }
  .cstep.done .tick:not(.ing-chip) { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047); color: #fff; }
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
  main > ha-alert { display: block; margin: var(--ha-space-2, 8px) var(--ha-space-4, 16px); }
  main.ro [data-act="new"], main.ro [data-act="edit"], main.ro [data-act="delete"], main.ro [data-act="import"],
  main.ro [data-act="data"], main.ro [data-act="select"], main.ro [data-act="plan-this"], main.ro [data-act="plan-copy"],
  main.ro [data-act="cookbook-save"], main.ro [data-act="cookbook-update"], main.ro [data-act="cookbook-delete"],
  main.ro [data-plan-add], main.ro [data-plan-del], main.ro [data-plan-scale], main.ro .plan-scale { display: none !important; }
  .notice-btn { margin-left: 10px; background: none; border: 1px solid currentColor; border-radius: 6px; color: inherit; cursor: pointer; padding: 1px 10px; font: inherit; }
  .notice { margin: 0 0 12px; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); border: 1px solid var(--success-color, #43a047); }
  /* ---- nutrition ---- */
  .nu-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .nu-table th, .nu-table td { padding: 5px 0; text-align: end; font-weight: 400; border-bottom: 1px solid var(--divider-color); }
  .nu-table thead th { font-size: 13px; color: var(--secondary-text-color); }
  .nu-table tbody th { text-align: start; }
  .nu-table tbody tr:first-child th, .nu-table tbody tr:first-child td { font-weight: 600; }
  .nu-table td + td, .nu-table th + td { padding-inline-start: 12px; }
  .nu-table tr.nu-sub th { padding-inline-start: 14px; color: var(--secondary-text-color); font-size: 13px; }
  .nu .nu-table { max-width: 560px; }
  .nu-status { margin-top: 10px; }
  .nu-warn { display: block; margin-top: 6px; }
  .nu-src { padding: 0 16px 12px; font-size: 11px; color: var(--secondary-text-color); }
  .nu .nu-src { padding: 16px 0 0; }
  .nu-src a { color: inherit; }
  .nu h3 { margin: 24px 0 8px; }
  .nu-items, .nu-custom, .nu-results { list-style: none; margin: 0; padding: 0; }
  .nu-item { padding: 12px 0; border-bottom: 1px solid var(--divider-color); }
  .nu-item.s-no_match .nu-text, .nu-item.s-no_grams .nu-text { color: var(--warning-color, #b26a00); }
  .nu-item.s-ignored { opacity: .65; }
  .nu-line { display: flex; justify-content: space-between; gap: 12px; }
  .nu-kcal { color: var(--secondary-text-color); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .nu-match { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px; font-size: 14px; --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .nu-match b { color: var(--primary-text-color); font-weight: 500; }
  .nu-tag { --ha-assist-chip-container-shape: 10px; --md-assist-chip-container-height: 24px; --md-assist-chip-label-text-size: 11px; }
  .nu-tag.ok { --ha-assist-chip-container-color: color-mix(in srgb, var(--success-color, #43a047) 16%, transparent); }
  .nu-tag.auto { --ha-assist-chip-container-color: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent); }
  .nu-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .nu-unit { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .nu-unit ha-input { width: 220px; }
  .nu-picker { margin-top: 10px; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; }
  .nu-results { margin-top: 6px; max-height: 320px; overflow-y: auto; }
  .nu-picker ha-input-search { display: block; }
  .nu-group { margin: 12px 0 4px; font-size: var(--ha-font-size-s, 12px); text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); }
  .nu-banner { display: block; margin: 0 0 8px; }
  .nu-via { color: var(--secondary-text-color); font-weight: 400; }
  .nu-custom { margin: 0 calc(-1 * var(--ha-space-4, 16px)); }
  .nu-cacts { display: flex; gap: 2px; }
  .nu-form { margin-top: 16px; }
  .nu-form h3 { margin-top: 0; }
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
    this._doneChips = new Set(); // "step:ingredient" chips ticked off while cooking
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
    this._chipAlt = false; // chips in the steps also show the amount in the other unit
    try {
      this._chipAlt = localStorage.getItem("hass_recipes_chipalt") === "1";
    } catch (_) { /* ignore */ }
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
    // translate whatever is rendered into the panel, and keep doing so as it re-renders
    this._stopI18n = observeTranslations(this.shadowRoot, () => state.language);
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
    this._onResize = () => {
      this._autosizeAll();
      // the filters are a side pane on wide screens and a dialog on a phone
      const compact = this._brCompact();
      if (compact !== this._lastCompact) {
        this._lastCompact = compact;
        if (this._view.name === "list" && this._loaded) this._render();
      }
    };
    window.addEventListener("resize", this._onResize);
    window.addEventListener("beforeunload", this._onUnload);
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("popstate", this._onPop);
    document.addEventListener("visibilitychange", this._onVisible);
  }

  disconnectedCallback() {
    if (this._stopI18n) {
      this._stopI18n();
      this._stopI18n = null;
    }
    clearInterval(this._interval);
    window.removeEventListener("keydown", this._onKey);
    window.removeEventListener("popstate", this._onPop);
    window.removeEventListener("beforeunload", this._onUnload);
    window.removeEventListener("resize", this._onResize);
    document.removeEventListener("visibilitychange", this._onVisible);
    this._releaseWake();
    if (this._unsubTimers) {
      this._unsubTimers();
      this._unsubTimers = null;
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    state.language = (hass && (hass.language || (hass.locale && hass.locale.language))) || "en";
    if (first) {
      this._load();
      this._subscribeTimers();
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
      this._canEdit = res.can_edit !== false;
      this._cookbooks = res.cookbooks || [];
      this._aiAvail = !!res.ai_available;
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

  // ---- unsaved-changes guard ----
  _confirmDiscard() {
    return confirm(T("Discard your unsaved changes?"));
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
      case "nutrition":
        return `#/recipe/${view.id}/nutrition`;
      case "edit":
        return view.id ? `#/recipe/${view.id}/edit` : "#/new";
      case "import":
        return "#/import";
      case "data":
        return "#/data";
      case "plan":
        return view.week ? `#/plan/${view.week}` : "#/plan";
      case "foods":
        return view.id ? `#/foods/${view.id}` : "#/foods";
      case "tracker":
        return "#/tracker";
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
      if (parts[2] === "nutrition") return { name: "nutrition", id };
      if (parts[2] === "edit") return { name: "edit", id };
      return { name: "detail", id };
    }
    if (parts[0] === "new") return { name: "edit" };
    if (parts[0] === "import") return { name: "import" };
    if (parts[0] === "data") return { name: "data" };
    if (parts[0] === "foods") return { name: "foods", id: parts[1] || "" };
    if (parts[0] === "tracker") return { name: "tracker" };
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
    if (view.name === "data" && prev.name !== "data") this._loadTrash();
    if (view.name === "nutrition" && prev.name !== "nutrition") this._nu = null;
    if (view.name === "foods" && prev.name !== "foods") {
      // coming from a recipe's ingredients with a new food already started: keep it
      if (this._fdKeep) this._fdKeep = false;
      else this._fd = null;
    }
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

  /** The top bar and (on a phone) the bottom tabs, built from Home Assistant's own ha-icon-button, ha-input-search and ha-tab. */
  _chrome(v) {
    const foodDetail = v.name === "foods" && v.id && this._brCompact();
    const tabsView = v.name === "list" || v.name === "plan" || v.name === "tracker" || (v.name === "foods" && !foodDetail);
    const iconBtn = (act, icon, label) => `<ha-icon-button data-act="${act}" label="${label}"><ha-icon icon="mdi:${icon}"></ha-icon></ha-icon-button>`;
    if (v.name === "cook" && this._recipe(v.id)) {
      // cook mode: the back arrow leaves it (the menu button would only open the sidebar)
      return {
        header: `${iconBtn("cook-exit", "arrow-left", "Back")}<div class="main-title"><b>${esc(this._recipe(v.id).name)}</b><span>${esc(T("Cook mode"))}</span></div>`,
        bottom: "",
      };
    }
    if (v.name === "detail" && this._recipe(v.id)) {
      const r = this._recipe(v.id);
      const canEdit = this._canEdit !== false;
      const item = (value, icon, label, extra = "") => `<ha-dropdown-item value="${value}" ${extra}><ha-icon slot="icon" icon="mdi:${icon}"></ha-icon>${esc(T(label))}</ha-dropdown-item>`;
      const cooking = this._cookingId === r.id;
      return {
        header: `${iconBtn("back", "arrow-left", "Back")}<div class="main-title"><b>${esc(r.name)}</b>${this._rdSubtitle ? `<span>${esc(this._rdSubtitle)}</span>` : ""}</div>
          <ha-dropdown id="rd-menu"><ha-icon-button slot="trigger" label="More"><ha-icon icon="mdi:dots-vertical"></ha-icon></ha-icon-button>
            ${canEdit ? item("plan-this", "calendar-plus", "Add to meal plan") : ""}${item("shop", "cart-outline", "Add to shopping list")}
            ${item("dashboard-recipe", cooking ? "view-dashboard" : "view-dashboard-outline", cooking ? "Remove from the dashboard cook card" : "Show on the dashboard cook card")}
            ${canEdit ? item("edit", "pencil-outline", "Edit") : ""}${this._checked.size || this._doneSteps.size || this._doneChips.size ? item("progress-reset", "restore", "Clear checks") : ""}
            ${canEdit ? item("delete", "delete-outline", "Delete recipe", 'variant="danger"') : ""}</ha-dropdown>`,
        bottom: "",
      };
    }
    if (v.name === "nutrition" && this._recipe(v.id)) {
      return {
        header: `${iconBtn("back", "arrow-left", "Back")}<div class="main-title"><b>${esc(T("Ingredients and foods"))}</b><span>${esc(this._recipe(v.id).name)}</span></div>`,
        bottom: "",
      };
    }
    if (foodDetail) {
      const d = this._fdDraft();
      const name = v.id === "new" ? T("New food") : v.id.startsWith("r~") ? decodeURIComponent(v.id.slice(2)) : (d && d.name) || T("Food");
      return { header: `${iconBtn("back", "arrow-left", "Back")}<div class="main-title"><b>${esc(name)}</b></div>`, bottom: "" };
    }
    if (v.name === "edit") {
      return { header: `${iconBtn("cancel", "arrow-left", "Back")}<div class="main-title"><b>${esc(T(v.id ? "Edit recipe" : "New recipe"))}</b></div>`, bottom: "" };
    }
    if (!tabsView) return { header: `${this._narrow ? iconBtn("menu", "menu", "Menu") : ""}<h1>Recipes</h1>`, bottom: "" };
    const tab = (act, icon, name, active, narrow) =>
      `<div class="tabwrap" data-act="${act}"><ha-tab name="${esc(T(name))}" ${active ? "active" : ""} ${narrow ? "narrow" : ""}><ha-icon slot="icon" icon="mdi:${icon}"></ha-icon></ha-tab></div>`;
    const tabs = (narrow) =>
      tab("tab-list", "book-open-page-variant-outline", "Recipes", v.name === "list", narrow) +
      tab("plan", "calendar-month-outline", "Meal plan", v.name === "plan", narrow) +
      tab("foods", "food-apple-outline", "Foods", v.name === "foods", narrow) +
      tab("tracker", "fire", "Tracker", v.name === "tracker", narrow);
    const planMenu =
      v.name === "plan"
        ? `<ha-dropdown id="plan-menu"><ha-icon-button slot="trigger" label="More"><ha-icon icon="mdi:dots-vertical"></ha-icon></ha-icon-button>
            ${this._canEdit !== false ? `<ha-dropdown-item value="plan-copy"><ha-icon slot="icon" icon="mdi:content-copy"></ha-icon>${esc(T("Copy last week"))}</ha-dropdown-item>` : ""}
            <ha-dropdown-item value="plan-shop"><ha-icon slot="icon" icon="mdi:cart-outline"></ha-icon>${esc(T("Add this period to the shopping list"))}</ha-dropdown-item>
            ${this._canEdit !== false ? `<ha-dropdown-item value="plan-meals"><ha-icon slot="icon" icon="mdi:silverware-fork-knife"></ha-icon>${esc(T("Edit the meals of the day"))}</ha-dropdown-item>` : ""}</ha-dropdown>`
        : "";
    if (this._brCompact()) {
      return {
        header: `${iconBtn("leave", "arrow-left", "Back")}${
          v.name === "list"
            ? `<ha-input-search id="search" appearance="outlined" placeholder="Search ${this._recipes.length} recipes"></ha-input-search>`
            : v.name === "foods"
            ? `<ha-input-search id="fdsearch" appearance="outlined" placeholder="${esc(T("Search foods"))}"></ha-input-search>`
            : v.name === "tracker"
            ? `<h1>${esc(T("Tracker"))}</h1>`
            : `<h1>${esc(T("Meal plan"))}</h1>${planMenu}`
        }`,
        bottom: `<nav class="bottomtabs">${tabs(true)}</nav>`,
      };
    }
    return {
      header: `${this._narrow ? iconBtn("menu", "menu", "Menu") : iconBtn("leave", "arrow-left", "Back")}<span class="hsp"></span><nav class="tabs">${tabs(false)}</nav><span class="hsp"></span>${planMenu}`,
      bottom: "",
    };
  }

  _render() {
    const v = this._view;
    this._fab = "";
    // on a phone Home Assistant scrolls the page, not this panel: stay out of the way so the top bar can stick to it
    const compactNow = this._brCompact();
    this.classList.toggle("compact", compactNow);
    // on a cold load the page has no width yet: look again once it has one
    this._compactSeen = compactNow;
    if (!this._compactCheck) {
      this._compactCheck = requestAnimationFrame(() => {
        this._compactCheck = null;
        if (this._loaded && this._brCompact() !== this._compactSeen) this._render();
      });
    }
    let body;
    if (!this._loaded) body = `<div class="empty">Loading…</div>`;
    else if (v.name === "detail" && this._recipe(v.id)) body = this._detailHtml(this._recipe(v.id));
    else if (v.name === "data") body = this._dataHtml();
    else if (v.name === "plan") {
      body = this._planHtml();
    }
    else if (v.name === "shop" && this._recipe(v.id)) body = this._shopHtml(this._recipe(v.id));
    else if (v.name === "nutrition" && this._recipe(v.id)) body = this._nutritionHtml(this._recipe(v.id));
    else if (v.name === "foods") body = this._foodsHtml();
    else if (v.name === "tracker") body = this._trackerHtml();
    else if (v.name === "cook" && this._recipe(v.id)) {
      const r = this._recipe(v.id);
      body = this._cookFocus ? this._cookHtml(r) : this._cookAllHtml(r);
    }
    else if (v.name === "edit" && this._form) body = this._formHtml();
    else if (v.name === "import") body = this._importHtml();
    else body = this._listHtml();

    const chrome = this._chrome(v);
    this._bottomBar = chrome.bottom;
    // rebuilding the page must not throw the reader back to the top: keep the scroll while the same page is shown
    const viewKey = `${v.name}/${v.id || ""}`;
    const keep = this._scrollKey === viewKey && !this._scrollToCurrent ? { top: this.scrollTop, page: window.scrollY } : null;
    this._scrollKey = viewKey;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="cq ${chrome.bottom ? "with-bar" : ""}"><div class="sticky">
        <header>${chrome.header}</header>
        <div id="timers" class="timers"></div>
      </div>
      <main class="${this._canEdit === false ? "ro" : ""}${v.name === "list" ? " wide" : ""}${v.name === "detail" && this._recipe(v.id) ? " rdmain" : ""}${v.name === "plan" ? " plan" : ""}${v.name === "foods" ? " wide" : ""}${v.name === "tracker" ? " tracker" : ""}">${this._notice ? `<div class="notice">✓ ${esc(this._notice)}${this._noticeAction ? ` <button type="button" class="notice-btn" data-act="notice-action">${esc(this._noticeAction.label)}</button>` : ""}</div>` : ""}${this._error ? `<ha-alert alert-type="error">${esc(this._error)}</ha-alert>` : ""}${body}</main></div>${chrome.bottom}${this._fab || ""}`;
    this._timerSig = "";
    if (keep) {
      // the new page is only as tall as it will be once its elements have rendered, so put the scroll back again over the next frames
      const restore = () => {
        if (this._scrollKey !== viewKey) return;
        if (this.scrollTop !== keep.top) this.scrollTop = keep.top;
        if (window.scrollY !== keep.page) window.scrollTo(0, keep.page);
      };
      restore();
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    }
    this._bind();
    this._autosizeAll();
    this._renderTimers();
    this._syncWake();
    if (this._scrollToCurrent) {
      this._scrollToCurrent = false;
      const cur = this.shadowRoot.querySelector(".cstep.current");
      if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (!this.shadowRoot.getElementById("fdlg")) this._filterDlg = false;
    if (this._neFocus) this._neApplyFocus();
  }

  _bind() {
    const root = this.shadowRoot;
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

    on("[data-open]", "click", (e) => this._go({ name: "detail", id: e.currentTarget.dataset.open }));
    this._bindPlan(root, on);
    this._bindBrowser(root, on);
    if (this._view.name === "detail") this._bindDetail(root, on);
    if (this._view.name === "nutrition") this._bindNutrition(root, on);
    if (this._view.name === "foods") this._bindFoods(root, on);
    if (this._view.name === "tracker") this._bindTracker(root, on);
    on("[data-cookbook]", "click", (e) => this._applyCookbook(e.currentTarget.dataset.cookbook));
    on("[data-tab-btn]", "click", (e) => {
      this._tab = e.currentTarget.dataset.tabBtn;
      this._render();
      this.scrollTo(0, 0);
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

    // an ingredient chip in a step is ticked off by itself; all of a step's chips ticked ticks the step
    const tickChip = (e) => {
      e.stopPropagation();
      const [n, i] = e.currentTarget.dataset.chip.split(":").map(Number);
      this._toggleChip(n, i);
    };
    // the switch for the other unit in the chips: its own change event, so that clicking the switch or its label does the same
    on("ha-switch[data-chipalt]", "change", (e) => {
      this._chipAlt = e.currentTarget.checked;
      try {
        localStorage.setItem("hass_recipes_chipalt", this._chipAlt ? "1" : "0");
      } catch (_) { /* ignore */ }
      this._render();
    });
    on("[data-chip]", "click", tickChip);
    on("[data-chip]", "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tickChip(e);
      }
    });

    on("[data-timer-key]", "click", (e) => {
      const r = this._recipe(this._view.id);
      const d = e.currentTarget.dataset;
      this._startTimer(d.timerKey, d.timerLabel, +d.sec, r.id, +d.timerStep);
    });

    const toggleStep = (n) => this._setStepDone(n, !this._doneSteps.has(n));
    on("[data-step-toggle]", "click", (e) => {
      // links and the timer button inside a step keep their own behaviour
      if (e.target.closest("button, a, input, ha-button, ha-icon-button, [data-chip]")) return;
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
      this._bindFormHa(root);
      form.addEventListener("submit", (e) => this._save(e, form));
      this._bindEditor(form);
      form.addEventListener("input", () => (this._formDirty = true));
      form.addEventListener("change", () => (this._formDirty = true));
    }
    on("[data-open-new]", "click", async (e) => {
      e.preventDefault();
      this._bulk = null;
      await this._load();
      this._go({ name: "detail", id: e.currentTarget.dataset.openNew });
    });
    const imp = root.getElementById("import");
    if (imp) imp.addEventListener("submit", (e) => this._import(e, imp));
    const impHtml = root.getElementById("import-html");
    if (impHtml) impHtml.addEventListener("submit", (e) => this._importHtml2(e, impHtml));
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
      case "br-filters": {
        if (this._brCompact()) {
          this._filterDlg = true;
        } else {
          const b = this._brPrefs();
          b.pane[this._narrow ? "narrow" : "wide"] = !this._brPaneOpen();
          this._brSave();
        }
        this._render();
        break;
      }
      case "new-dialog":
        this._newDlg = true;
        this._render();
        break;
      case "new-manual":
        this._newDlg = false;
        this._action("new");
        break;
      case "new-url":
        this._newDlg = false;
        this._action("import");
        break;
      case "br-filters-close":
        this._filterDlg = false;
        this._render();
        break;
      case "br-clear":
        this._sel = { categories: new Set(), tools: new Set(), tags: new Set() };
        this._search = "";
        this._cookbookId = null;
        this._render();
        break;
      case "br-dir": {
        const b = this._brPrefs();
        b.dir = b.dir === "asc" ? "desc" : "asc";
        this._brSave();
        this._render();
        break;
      }
      case "leave":
        // up to the Home Assistant overview, as the back arrow of its own pages leaves them
        history.pushState(null, "", "/");
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        break;
      case "tab-list":
        this._go({ name: "list" });
        break;
      case "plan":
        this._planPending = null;
        this._go({ name: "plan", week: "" });
        break;
      case "plan-this":
        this._planPending = id;
        this._go({ name: "plan", week: "" });
        break;
      case "foods":
        this._go({ name: "foods" });
        break;
      case "tracker":
        this._go({ name: "tracker" });
        break;
      case "tk-add":
        this._tkAct("tk-add");
        break;
      case "food-new":
        this._fdState().draft = null;
        this._fdState().draftFor = null;
        this._go({ name: "foods", id: "new" }, false, this._brCompact() ? undefined : "replace");
        break;
      case "plan-meals":
        this._planMealsDialog();
        break;
      case "plan-add-dialog":
        this._planAddDialog(isoDate(new Date()));
        break;
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
      case "save": {
        const f = this.shadowRoot.getElementById("form");
        if (f) f.requestSubmit();
        break;
      }
      case "image-pick": {
        const f = this.shadowRoot.getElementById("image-file");
        if (f) f.click();
        break;
      }
      case "image-clear":
        this._syncForm();
        this._form.image = "";
        this._formDirty = true;
        this._render();
        break;
      case "progress-reset":
        this._checked = new Set();
        this._doneSteps = new Set();
        this._doneChips = new Set();
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
      case "nutrition":
        this._go({ name: "nutrition", id }, true);
        break;
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
      case "cook-sec-prev":
        this._cookSection(-1);
        break;
      case "cook-sec-next":
        this._cookSection(1);
        break;
      case "cook-jump": {
        const head = this.shadowRoot.querySelector(`.csection[data-sec="${id}"]`);
        if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
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
      case "notice-action": {
        const action = this._noticeAction;
        this._noticeAction = null;
        this._notice = "";
        if (action) await action.run();
        break;
      }
      case "trash-restore":
        await this._restoreFromTrash([id]);
        break;
      case "trash-empty":
        if (!confirm(T("Empty the trash? These recipes cannot be restored afterwards."))) return;
        try {
          await this._ws({ type: "hass_recipes/purge" });
          await this._loadTrash();
        } catch (err) {
          this._error = err.message || String(err);
        }
        this._render();
        break;
      case "plan-copy":
        await this._planCopyLastWeek();
        break;
      case "delete": {
        if (!confirm(T("Delete this recipe?"))) return;
        try {
          const gone = this._recipe(id);
          await this._ws({ type: "hass_recipes/delete", recipe_id: id });
          await this._load();
          this._returnTo({ name: "list" });
          this._flash(`Deleted “${gone ? gone.name : ""}”.`, {
            label: "Undo",
            run: () => this._restoreFromTrash([id]),
          });
        } catch (err) {
          this._error = err.message;
          this._render();
        }
        break;
      }
    }
  }
}

// Mix the other modules' methods into the class.
for (const part of parts) Object.assign(HassRecipesPanel.prototype, part.default(helpers));

// Guard: a reload with a changed module URL can evaluate this file a second time.
if (!customElements.get("hass-recipes-panel")) {
  customElements.define("hass-recipes-panel", HassRecipesPanel);
}
