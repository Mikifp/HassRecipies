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
const parts = await Promise.all(["panel-timers", "panel-progress", "panel-browse", "panel-plan", "panel-data", "panel-recipe", "panel-form", "panel-editor"].map(load));

const STYLE = `
  :host { --hq-loud: var(--ha-color-fill-primary-loud-resting, var(--primary-color)); --hq-on-loud: var(--ha-color-on-primary-loud, #fff); --hq-normal: var(--ha-color-fill-primary-normal-resting, color-mix(in srgb, var(--primary-color) 14%, #fff)); --hq-on-normal: var(--ha-color-on-primary-normal, var(--primary-color)); --hq-outline: var(--outline-color, var(--divider-color)); display: block; height: 100%; overflow: auto; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  * { box-sizing: border-box; }
  .cq { container-type: inline-size; min-height: 100%; }
  .sticky { position: sticky; top: 0; z-index: 2; }
  header { display: flex; align-items: center; gap: 12px; padding: 0 12px 0 16px; min-height: 56px; border-bottom: 1px solid var(--divider-color); background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .timers:empty { display: none; }
  .timers { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; background: var(--secondary-background-color); border-bottom: 1px solid var(--divider-color); }
  .timer { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 16px; background: var(--card-background-color); border: 1px solid var(--divider-color); font-size: 14px; }
  .timer .t-time { font-variant-numeric: tabular-nums; font-weight: 600; }
  .timer.done { background: var(--error-color, #db4437); color: #fff; border-color: transparent; animation: pulse 1s infinite; }
  .timer button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; }
  .timer button.stop { background: #fff; color: var(--error-color, #db4437); border-radius: 12px; padding: 2px 12px; font-weight: 600; }
  @keyframes pulse { 50% { opacity: .6; } }
  header h1 { font-size: 20px; font-weight: 400; margin: 0; flex: 1; }
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
  header .tabs { display: flex; }
  header .hsp { flex: 1; }
  header ha-input-search { flex: 1; min-width: 0; }
  .tabwrap { cursor: pointer; display: flex; }
  .tabwrap ha-tab { flex: 1; min-width: 0; }
  .bottomtabs { position: fixed; left: 0; right: 0; bottom: 0; height: 56px; z-index: 3; display: flex; justify-content: center; font-size: var(--ha-font-size-s, 12px); background: var(--sidebar-background-color, var(--card-background-color)); border-top: 1px solid var(--divider-color); }
  .bottomtabs .tabwrap { width: 25%; }
  .cq.with-bar { padding-bottom: 56px; }
  ha-button.fab.above-tabs { bottom: 84px; }
  main.wide { max-width: none; padding: 0; }
  main.wide > .notice, main.wide > .error { margin: 12px 16px; }
  .bshell.with-pane { display: grid; grid-template-columns: 250px minmax(0, 1fr); align-items: stretch; }
  .bmain { min-width: 0; }
  .btool { display: flex; gap: 12px; align-items: center; min-height: 56px; padding: 0 16px; background: var(--primary-background-color); border-bottom: 1px solid var(--divider-color); }
  .bulkbar { margin: 12px 16px 0; }
  .bcontent { min-width: 0; }
  .bcontent.cards, .bcontent.rows { padding: 16px 16px 88px; }
  .bcontent .empty { padding: 48px 16px; }
  .fpane { background: var(--primary-background-color); border-right: 1px solid var(--divider-color); font-size: 14px; }
  .fpane-in { position: sticky; top: 56px; max-height: calc(100vh - 60px); overflow: auto; }
  .fhead { display: flex; justify-content: space-between; align-items: center; height: 56px; padding: 0 12px; border-bottom: 1px solid var(--divider-color); }
  .bcount { position: absolute; top: -4px; right: -4px; min-width: 16px; box-sizing: border-box; border-radius: 50%; font-size: 11px; line-height: 16px; text-align: center; padding: 0 2px; background: var(--primary-color); color: var(--text-primary-color, #fff); pointer-events: none; }
  .fit { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px 0 16px; cursor: pointer; }
  .fit[hidden] { display: none; }
  .fit:hover { background: var(--secondary-background-color); }
  .fit span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .fit em { font-style: normal; color: var(--secondary-text-color); font-size: 12px; }
  .fit.cbk.on { background: color-mix(in srgb, var(--primary-color) 14%, transparent); color: var(--primary-color); font-weight: 500; }
  .fact { display: flex; flex-direction: column; align-items: flex-start; padding: 0 8px 8px 44px; }
  .bgh { display: flex; align-items: center; gap: 8px; margin: 14px 0 10px; font-size: 16px; cursor: pointer; user-select: none; }
  .bgh:first-child { margin-top: 0; }
  .bgh ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .bgh .gi { color: var(--primary-text-color); }
  .bgh em { font-style: normal; font-size: 13px; color: var(--secondary-text-color); }
  .bgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .rcard { position: relative; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; }
  .rcard:hover, .rrow:hover { border-color: var(--primary-color); }
  .rpic { background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color)) center/cover no-repeat; color: var(--secondary-text-color); display: flex; align-items: center; justify-content: center; flex: none; }
  .rpic ha-icon { --mdc-icon-size: 34px; }
  .rcard .rpic { height: 120px; }
  .rtx { padding: 10px 12px 12px; min-width: 0; flex: 1; }
  .rtitle { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .rtitle b { font-weight: 500; font-size: 15px; line-height: 1.3; }
  .rtx span { font-size: 12px; color: var(--secondary-text-color); }
  .rpen { background: none; border: 0; color: var(--secondary-text-color); cursor: pointer; padding: 4px; border-radius: 50%; flex: none; display: inline-flex; }
  .rpen:hover { background: var(--secondary-background-color); color: var(--primary-text-color); }
  .rpen ha-icon { --mdc-icon-size: 18px; }
  .brows { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .rrow { position: relative; display: flex; gap: 14px; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); padding: 12px; cursor: pointer; align-items: flex-start; }
  .rrow .rpic { width: 84px; height: 84px; border-radius: 10px; }
  .rrow .rtx { padding: 0; }
  .rrow b { font-weight: 500; font-size: 15px; display: block; }
  .rrow p { margin: 2px 0 8px; font-size: 13px; color: var(--secondary-text-color); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .rmeta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 12px; color: var(--secondary-text-color); }
  .badge { background: color-mix(in srgb, var(--primary-color) 14%, transparent); color: var(--primary-color); border-radius: 10px; padding: 1px 9px; }
  .bcontent { padding-bottom: 88px; }
  /* the browser uses Home Assistant's own elements; these only place them */
  ha-assist-chip { --ha-assist-chip-container-shape: 10px; --ha-assist-chip-container-color: var(--card-background-color); cursor: pointer; }
  .select-mode-chip { --ha-assist-chip-icon-label-space: 0; --ha-assist-chip-trailing-space: 8px; }
  .chipwrap { position: relative; display: inline-block; }
  .bcount { position: absolute; top: -4px; right: -4px; min-width: 16px; box-sizing: border-box; border-radius: 50%; font-size: 11px; line-height: 16px; text-align: center; padding: 0 2px; background: var(--primary-color); color: var(--text-primary-color, #fff); pointer-events: none; }
  .btool ha-input-search { flex: 1 1 200px; min-width: 140px; --ha-input-search-height: 32px; --ha-input-search-border-radius: 10px; }
  .btool ha-dropdown { flex: none; }
  .vseg { display: inline-flex; gap: 1px; flex: none; }
  ha-expansion-panel.fsec { display: block; border-bottom: 1px solid var(--divider-color); --expansion-panel-summary-padding: 0 8px; --expansion-panel-content-padding: 0; }
  .fsearch { padding: 8px; }
  .fit > ha-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); flex: none; }
  .fit ha-checkbox { flex: none; }
  .fact { display: flex; flex-direction: column; align-items: flex-start; padding: 0 8px 8px 40px; }
  ha-button.fab { position: fixed; right: 16px; bottom: 16px; z-index: 5; box-shadow: 0 2px 8px rgba(0,0,0,.25); border-radius: 9999px; }
  .tblhost { overflow-x: hidden; }
  ha-data-table { --data-table-border-width: 0; --data-table-background-color: var(--card-background-color); }
  .rcard.picked, .rrow.picked { outline: 3px solid var(--primary-color); }
  .fdlg { padding: 0; border: 0; max-width: none; max-height: none; width: 100vw; height: 100vh; margin: 0; background: var(--card-background-color); color: var(--primary-text-color); font-family: inherit; }
  .fdlg[open] { display: flex; flex-direction: column; }
  .fdlg .dh { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--divider-color); font-size: 18px; flex: none; }
  .fdlg .dh b { flex: 1; font-weight: 500; }
  .fdlg .dclose { background: none; border: 0; color: inherit; cursor: pointer; padding: 10px; border-radius: 50%; display: inline-flex; }
  .fdlg .dlgbody { flex: 1; overflow: auto; }
  .fdlg .dfoot { flex: none; padding: 12px 16px; border-top: 1px solid var(--divider-color); display: flex; justify-content: center; }
  .fdlg .dfoot .btn { border-radius: 22px; padding: 10px 28px; }
  @container (max-width: 680px) {
    main { padding: 12px; }
    main.wide { padding: 0; }
    .btool { padding: 0 16px; min-height: 64px; gap: 8px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
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
  .ing-chip .q { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ing-chip b { font-weight: 500; }
  .cook-sections { display: flex; gap: 8px; margin-top: 14px; }
  .cook-sections .btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .cook-sections .btn small { font-size: 12px; opacity: .8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cook-jumps { display: inline-flex; gap: 6px; flex-wrap: wrap; }
  .step-text .ing-chip, .cook .cook-text .ing-chip, .cstep .cstep-text .ing-chip { display: inline-flex; padding: 0 8px; margin: 0 1px; font-size: .9em; vertical-align: baseline; }
  .timer-btn { margin-top: 10px; }
  .form-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .form-title .btn { font-size: 13px; padding: 4px 10px; font-weight: 400; }
  .ne-meta { margin-bottom: 16px; }
  .ne-meta summary { cursor: pointer; color: var(--secondary-text-color); padding: 6px 0; }
  .ne-card { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); margin: 0 0 14px; position: relative; }
  .ne-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
  .ne-title { flex: 1; min-width: 0; border: 0; background: transparent; font-size: 16px; font-weight: 500; padding: 6px 4px; }
  .ne-title:focus { outline: 2px solid var(--primary-color); border-radius: 6px; }
  .ne-count { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
  .ne-body { border-top: 1px solid var(--divider-color); padding: 6px 12px 12px; }
  .ne-sub { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); margin: 12px 0 6px; }
  .ne-icon, .ne-handle { background: none; border: 0; color: var(--secondary-text-color); cursor: pointer; padding: 4px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: none; font: inherit; }
  .ne-icon:hover { background: var(--secondary-background-color); }
  .ne-handle { cursor: grab; }
  .ne-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .ne-row .ne-qty { flex: 2 1 160px; width: auto; min-width: 0; }
  .ne-row .ne-note { flex: 1 1 110px; width: auto; min-width: 0; font-size: 14px; }
  .ne-sub-row { display: flex; gap: 6px; align-items: center; flex: 1 0 100%; padding-left: 34px; }
  .ne-sub-row input { font-size: 14px; font-style: italic; }
  .ne-step { display: flex; gap: 6px; align-items: flex-start; border: 1px solid var(--divider-color); border-radius: 10px; padding: 8px 6px 8px 4px; margin-bottom: 8px; background: var(--card-background-color); }
  .ne-step:focus-within { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
  .ne-n { width: 22px; height: 22px; border-radius: 50%; background: var(--secondary-background-color); font-size: 12px; display: inline-flex; align-items: center; justify-content: center; margin-top: 3px; flex: none; color: var(--secondary-text-color); }
  .ne-main { flex: 1; min-width: 0; position: relative; }
  .ne-text { outline: none; line-height: 1.9; min-height: 1.9em; white-space: pre-wrap; overflow-wrap: anywhere; }
  .ne-text:empty::before { content: attr(data-ph); color: var(--secondary-text-color); }
  .ne-chip { display: inline-block; background: color-mix(in srgb, var(--primary-color) 16%, transparent); color: var(--primary-color); border-radius: 6px; padding: 0 6px; line-height: 1.55; font-size: .92em; margin: 0 1px; user-select: all; }
  .ne-ins { visibility: hidden; }
  .ne-typing .ne-ins { visibility: visible; color: var(--primary-color); }
  .ne-quick { display: none; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
  .ne-step:focus-within .ne-quick { display: flex; }
  .ne-quick-label { font-size: 12px; color: var(--secondary-text-color); margin-right: 2px; }
  .ne-quick-chip { background: none; border: 1px dashed color-mix(in srgb, var(--primary-color) 50%, transparent); color: var(--primary-color); border-radius: 6px; padding: 0 8px; font: inherit; font-size: .92em; line-height: 1.55; cursor: pointer; text-align: left; }
  .ne-quick-chip:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .ne-quick-chip.used { opacity: .5; }
  .ne-extra { user-select: none; display: inline-flex; align-items: center; gap: 2px; margin: 2px 4px 2px 0; }
  .ne-extra button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; display: inline-flex; --mdc-icon-size: 14px; }
  .ne-extras { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
  .ne-timer { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--secondary-text-color); background: var(--secondary-background-color); border-radius: 8px; padding: 2px 6px; flex-wrap: wrap; }
  .ne-timer input { width: 52px; padding: 3px 6px; font-size: 13px; }
  .ne-timer input.ne-tl { width: 130px; }
  .ne-pick { position: absolute; left: 0; right: 0; z-index: 5; margin-top: 2px; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.2); max-height: 220px; overflow: auto; }
  .ne-pick button { display: block; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 8px 12px; cursor: pointer; }
  .ne-pick button.on, .ne-pick button:hover { background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
  .ne-add { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; background: none; border: 1px dashed var(--divider-color); border-radius: 10px; color: var(--primary-color); padding: 8px; cursor: pointer; font: inherit; margin-top: 2px; }
  .ne-add:hover { background: color-mix(in srgb, var(--primary-color) 8%, transparent); }
  .ne-add-section { margin-top: 0; }
  .ne-pop { position: absolute; z-index: 20; min-width: 190px; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.25); padding: 4px 0; }
  .ne-pop button { display: block; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 8px 14px; cursor: pointer; }
  .ne-pop button:hover { background: var(--secondary-background-color); }
  .ne-pop button.danger { color: var(--error-color, #db4437); }
  .ne-dragging { opacity: .4; }
  .ne-drop { outline: 2px dashed var(--primary-color); border-radius: 8px; }
  @media (pointer: coarse) { .ne-handle { display: none; } }
  .facet-label { font-size: 12px; color: var(--secondary-text-color); align-self: center; text-transform: uppercase; letter-spacing: .04em; }
  .units { margin-left: auto; }
  .ing-text { display: flex; flex-direction: column; }
  .ing-qty { font-variant-numeric: tabular-nums; }
  .ing-note { color: var(--secondary-text-color); }
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
  main.ro [data-act="new"], main.ro [data-act="edit"], main.ro [data-act="delete"], main.ro [data-act="import"],
  main.ro [data-act="data"], main.ro [data-act="select"], main.ro [data-act="plan-this"], main.ro [data-act="plan-copy"],
  main.ro [data-act="cookbook-save"], main.ro [data-act="cookbook-update"], main.ro [data-act="cookbook-delete"],
  main.ro [data-plan-add], main.ro [data-plan-del], main.ro [data-plan-scale], main.ro .plan-scale { display: none !important; }
  .notice-btn { margin-left: 10px; background: none; border: 1px solid currentColor; border-radius: 6px; color: inherit; cursor: pointer; padding: 1px 10px; font: inherit; }
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
    if (view.name === "data" && prev.name !== "data") this._loadTrash();
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
    const tabsView = v.name === "list" || v.name === "plan";
    const iconBtn = (act, icon, label) => `<ha-icon-button data-act="${act}" label="${label}"><ha-icon icon="mdi:${icon}"></ha-icon></ha-icon-button>`;
    if (!tabsView) return { header: `${this._narrow ? iconBtn("menu", "menu", "Menu") : ""}<h1>Recipes</h1>`, bottom: "" };
    const tab = (act, icon, name, active, narrow) =>
      `<div class="tabwrap" data-act="${act}"><ha-tab name="${esc(T(name))}" ${active ? "active" : ""} ${narrow ? "narrow" : ""}><ha-icon slot="icon" icon="mdi:${icon}"></ha-icon></ha-tab></div>`;
    const tabs = (narrow) =>
      tab("tab-list", "book-open-page-variant-outline", "Recipes", v.name === "list", narrow) + tab("plan", "calendar-month-outline", "Meal plan", v.name === "plan", narrow);
    if (this._brCompact()) {
      return {
        header: `${iconBtn("leave", "arrow-left", "Back")}${
          v.name === "list"
            ? `<ha-input-search id="search" appearance="outlined" placeholder="Search ${this._recipes.length} recipes"></ha-input-search>`
            : `<h1>${esc(T("Meal plan"))}</h1>`
        }`,
        bottom: `<nav class="bottomtabs">${tabs(true)}</nav>`,
      };
    }
    return {
      header: `${this._narrow ? iconBtn("menu", "menu", "Menu") : iconBtn("leave", "arrow-left", "Back")}<span class="hsp"></span><nav class="tabs">${tabs(false)}</nav><span class="hsp"></span>`,
      bottom: "",
    };
  }

  _render() {
    const v = this._view;
    this._fab = "";
    const dlgScroll = this.shadowRoot.querySelector(".dlgbody") ? this.shadowRoot.querySelector(".dlgbody").scrollTop : 0;
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

    const chrome = this._chrome(v);
    this._bottomBar = chrome.bottom;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="cq ${chrome.bottom ? "with-bar" : ""}"><div class="sticky">
        <header>${chrome.header}</header>
        <div id="timers" class="timers"></div>
      </div>
      <main class="${this._canEdit === false ? "ro" : ""}${v.name === "list" ? " wide" : ""}">${this._notice ? `<div class="notice">✓ ${esc(this._notice)}${this._noticeAction ? ` <button type="button" class="notice-btn" data-act="notice-action">${esc(this._noticeAction.label)}</button>` : ""}</div>` : ""}${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}${body}</main></div>${chrome.bottom}${this._fab || ""}`;
    this._timerSig = "";
    this._bind();
    this._autosizeAll();
    this._renderTimers();
    this._syncWake();
    if (this._scrollToCurrent) {
      this._scrollToCurrent = false;
      const cur = this.shadowRoot.querySelector(".cstep.current");
      if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const dlg = this.shadowRoot.getElementById("fdlg");
    if (dlg && this._filterDlg) {
      dlg.addEventListener("close", () => {
        if (this._filterDlg) {
          this._filterDlg = false;
          this._render();
        }
      });
      try {
        dlg.showModal();
      } catch (_) {
        /* not displayable: the filters stay reachable from the toolbar */
      }
      const body = dlg.querySelector(".dlgbody");
      if (body) body.scrollTop = dlgScroll;
    } else this._filterDlg = false;
    if (this._neFocus) this._neApplyFocus();
  }

  _bind() {
    const root = this.shadowRoot;
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

    on("[data-open]", "click", (e) => this._go({ name: "detail", id: e.currentTarget.dataset.open }));
    this._bindPlan(root, on);
    this._bindBrowser(root, on);
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

    on("[data-timer-key]", "click", (e) => {
      const r = this._recipe(this._view.id);
      const d = e.currentTarget.dataset;
      this._startTimer(d.timerKey, d.timerLabel, +d.sec, r.id, +d.timerStep);
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
      this._bindEditor(form);
      const meta = form.querySelector(".ne-meta");
      if (meta) meta.addEventListener("toggle", () => (this._neMetaOpen = meta.open));
      form.addEventListener("input", (e) => {
        this._formDirty = true;
        if (e.target.matches && e.target.matches("textarea[data-autosize]")) this._autosize(e.target);
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
      });
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
