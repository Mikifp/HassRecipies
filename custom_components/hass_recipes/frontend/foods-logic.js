/* The Foods page without the page: ranking foods for a name, what a merge moves, what stays ticked.
 * Plain functions (no DOM), so they are tested on their own (tests/js/foods-logic.test.mjs).
 */

const key = (text) => String(text || "").trim().toLowerCase();
const words = (text) => key(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** How alike a food is to some ingredient names (0 = not at all): shared words count most, a shared start of a word a little. */
export function similarity(food, names) {
  const own = [food.name, ...(food.aliases || [])].flatMap(words);
  if (!own.length) return 0;
  let score = 0;
  for (const name of names) {
    for (const w of words(name)) {
      for (const o of own) {
        if (o === w) score += 3;
        else if (w.length >= 5 && o.length >= 5 && (o.startsWith(w.slice(0, 5)) || w.startsWith(o.slice(0, 5)))) score += 1;
      }
    }
  }
  return score;
}

/** The foods to offer for these names: matches of the search first, else the alike ones, the recently used ones, then A–Z. */
export function rankFoods(foods, names = [], query = "", recent = []) {
  const q = key(query);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (q) {
    const rank = (f) => {
      const all = [f.name, ...(f.aliases || [])].map(key);
      if (all.some((n) => n === q)) return 0;
      if (all.some((n) => n.startsWith(q))) return 1;
      if (all.some((n) => n.split(/\s+/).some((w) => w.startsWith(q)))) return 2;
      return all.some((n) => n.includes(q)) ? 3 : 9;
    };
    return foods.filter((f) => rank(f) < 9).sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  const used = (f) => recent.indexOf(f.id);
  return [...foods].sort((a, b) => {
    const s = similarity(b, names) - similarity(a, names);
    if (s) return s;
    const ra = used(a) < 0 ? 99 : used(a);
    const rb = used(b) < 0 ? 99 : used(b);
    return ra - rb || byName(a, b);
  });
}

/** Foods used lately, newest first, without repeats (kept short). */
export function remember(recent, id, max = 5) {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

/** What merging foods into `target` changes, the way the server does it: names, weights, nutrition and recipes. */
export function mergePreview(target, sources) {
  const have = new Set([target.name, ...(target.aliases || [])].map(key));
  const names = [];
  const weights = [];
  const unit = new Set(Object.keys(target.unit_grams || {}));
  let nutrition = null;
  const recipes = new Set(target.recipes || []);
  let used = target.used_in || 0;
  for (const s of sources) {
    for (const n of [s.name, ...(s.aliases || [])]) {
      if (!have.has(key(n))) {
        have.add(key(n));
        names.push(n);
      }
    }
    for (const [u, g] of Object.entries(s.unit_grams || {})) {
      if (!unit.has(u)) {
        unit.add(u);
        weights.push([u, g]);
      }
    }
    if (!nutrition && target.source === "none" && s.source !== "none") nutrition = s;
    for (const r of s.recipes || []) recipes.add(r);
    used += s.used_in || 0;
  }
  // the recipes are listed up to 30: when that cuts them, the sum is the better estimate
  const count = Math.max(recipes.size, Math.min(used, Math.max(...[target, ...sources].map((f) => f.used_in || 0))));
  return { names, weights, nutrition, recipes: count, dropped: sources.filter((s) => s.source !== "none" && target.source !== "none").map((s) => s.name) };
}

/** What stays ticked after the rows change (a search, a refresh): only the ones that are still rows. */
export function keepSelection(selected, rowIds) {
  const rows = new Set(rowIds);
  return new Set([...selected].filter((id) => rows.has(id)));
}

/** Ingredient-name rows are "r~" + the name; foods are their id. */
export const reviewId = (name) => `r~${encodeURIComponent(name)}`;
export const reviewKeys = (ids) => [...ids].filter((id) => String(id).startsWith("r~")).map((id) => decodeURIComponent(id.slice(2)));

/** A name the way the server keys it: lower case letters, single spaces. */
export const nameKey = (text) => (String(text || "").toLowerCase().match(/\p{L}+/gu) || []).join(" ");

/** The other names of the food an ingredient line is: tries each candidate (the food of the line, or its food words) in `groups` ({ key: [names] }). */
export function namesForLine(groups, candidates) {
  for (const c of candidates) {
    const names = groups && groups[nameKey(c)];
    if (names) return names.filter((n) => String(n).trim().length >= 3);
  }
  return [];
}

// ---- macro goals: a split for a kcal goal, and what the grams add up to ----
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

/** Ready-made splits of the energy (percent of kcal): a starting point, not a prescription. */
export const MACRO_PRESETS = [
  { id: "balanced", label: "Balanced", split: { protein: 20, carbs: 50, fat: 30 } },
  { id: "high_protein", label: "High protein", split: { protein: 30, carbs: 40, fat: 30 } },
  { id: "low_carb", label: "Low carb", split: { protein: 30, carbs: 25, fat: 45 } },
];

/** Grams of each macro for a kcal goal split by percent. */
export function gramsFromSplit(kcal, split) {
  return {
    protein: Math.round(((kcal * split.protein) / 100) / KCAL_PER_G.protein),
    carbs: Math.round(((kcal * split.carbs) / 100) / KCAL_PER_G.carbs),
    fat: Math.round(((kcal * split.fat) / 100) / KCAL_PER_G.fat),
  };
}

/** A split from body weight: protein 1.6 g a kg, fat a quarter of the energy, carbs the rest (the calculator's own). */
export function suggestFromWeight(kcal, weightKg) {
  const protein = 1.6 * weightKg;
  const fat = (0.25 * kcal) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

/** What the macro goals come to in energy, and each one's share of it. */
export function macroEnergy(goals) {
  const part = (k) => (Number(goals[k]) > 0 ? Number(goals[k]) * KCAL_PER_G[k] : 0);
  const total = part("protein") + part("carbs") + part("fat");
  const share = (k) => (total ? Math.round((part(k) / total) * 100) : 0);
  return { kcal: Math.round(total), share: { protein: share("protein"), carbs: share("carbs"), fat: share("fat") } };
}

/** The carbs that make the macros add up to the kcal goal (what is left after protein and fat; never below 0). */
export function carbsToFit(goals) {
  const rest = Number(goals.kcal) - (Number(goals.protein) || 0) * 4 - (Number(goals.fat) || 0) * 9;
  return Math.max(0, Math.round(rest / 4));
}

/** What changing a logged entry sends: only what the server accepts for that kind (not the recipe or food it is, which cannot change). */
export function entryUpdate(draft) {
  const n = (v) => (v === "" || v == null ? undefined : Number(v));
  const out = { meal: draft.meal };
  if (draft.kind === "recipe") Object.assign(out, { by: draft.by || "servings", amount: n(draft.amount) });
  else if (draft.kind === "food") Object.assign(out, { amount: n(draft.amount), unit: draft.unit || "g" });
  else Object.assign(out, { name: draft.name, kcal: n(draft.kcal), protein: n(draft.protein), carbs: n(draft.carbs), fat: n(draft.fat) });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
