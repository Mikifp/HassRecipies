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
