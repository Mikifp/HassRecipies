/* Recipes panel: helpers shared by the panel modules (loaded once, versioned like the panel). */

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
  splitSubs,
  joinSub,
  joinSubs,
  timerSpecs,
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
// Panel translations (Danish): the templates stay English and are translated where they land.
const { observeTranslations, translate: translateText } = await import(`./recipes-i18n.js${__v ? `?v=${__v}` : ""}`);
const state = { language: "en" };
/** A message built in code (confirm, prompt) in the user's language. */
const T = (text) => translateText(state.language, text);

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
  const { main, alts } = splitSubs(r.ingredients[i] ?? "");
  const p = (r.parsed_ingredients || [])[i];
  const subs = (p && (p.substitutes || (p.substitute ? [p.substitute] : []))) || [];
  const a = ingParts(p, main, k, mode);
  let html = `<span class="ing-main">${a.qty ? `<span class="ing-qty">${esc(a.qty)}</span> ` : ""}<strong>${esc(a.food)}</strong>${a.note ? `<span class="ing-note">, ${esc(a.note)}</span>` : ""}</span>`;
  if (a.sub) html += `<small class="ing-sub">${esc(a.sub)}</small>`;
  alts.forEach((altText, n) => {
    const b = ingParts(subs[n], altText, k, mode);
    html += `<small class="ing-alt">or ${b.qty ? `${esc(b.qty)} ` : ""}<strong>${esc(b.food)}</strong>${b.note ? `, ${esc(b.note)}` : ""}${b.sub ? ` <span class="ing-sub">(${esc(b.sub)})</span>` : ""}</small>`;
  });
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
  const { alts } = splitSubs(r.ingredients[i] ?? "");
  let text = ingredientText(r, i, k, mode);
  const p = (r.parsed_ingredients || [])[i] || {};
  const subs = p.substitutes || (p.substitute ? [p.substitute] : []);
  alts.forEach((altText, n) => {
    const b = ingParts(subs[n], altText, k, mode);
    text += ` — or ${b.qty ? `${b.qty} ` : ""}${b.food}`;
  });
  return text;
};

const PROGRESS_KEY = "hass_recipes_progress";

const HANDLED_KEY = "hass_recipes_timers_handled";

export default {
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
  splitSubs,
  joinSub,
  joinSubs,
  timerSpecs,
  clock,
  duration,
  fmtGrams,
  COUNT_AS_ITEMS,
  ingredientText,
  ingParts,
  fmtYield,
  SCALES,
  scaleBasis,
  roundAmount,
  lengthText,
  observeTranslations,
  translateText,
  T,
  state,
  isoDate,
  addDays,
  mondayOf,
  lines,
  toInt,
  TODO_KEY,
  ingredientHtml,
  ingredientChipHtml,
  ingredientPlain,
  PROGRESS_KEY,
  HANDLED_KEY,
};
