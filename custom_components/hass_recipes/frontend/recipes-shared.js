/* Shared by the Recipes panel and the dashboard cards: ingredient parsing/scaling and the
 * small formatting helpers both need. Imported with the same ?v= as its importer so a
 * changed file is never mixed with a stale one. */


export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const minutes = (m) => {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
};

// ---- ingredient scaling -------------------------------------------------
const UNICODE_FRACTIONS = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

const FRAC_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

const NUM = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+\\s*[${FRAC_CHARS}]|[${FRAC_CHARS}]|\\d+(?:[.,]\\d+)?)`;

const LEADING_QTY = new RegExp(`^(${NUM})(?:(\\s*[-–]\\s*)(${NUM}))?(?![\\d/])`);

export const parseNumber = (str) => {
  str = str.trim();
  let m;
  if ((m = str.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = str.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if ((m = str.match(new RegExp(`^(\\d+)\\s*([${FRAC_CHARS}])$`)))) return +m[1] + UNICODE_FRACTIONS[m[2]];
  if (UNICODE_FRACTIONS[str] !== undefined) return UNICODE_FRACTIONS[str];
  return parseFloat(str.replace(",", "."));
};

const FRACTION_GLYPHS = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [0.875, "⅞"]];

export const formatNumber = (n) => {
  if (n >= 10) return String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  const whole = Math.floor(n + 0.02);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  for (const [value, glyph] of FRACTION_GLYPHS) {
    if (Math.abs(frac - value) < 0.03) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(n * 100) / 100);
};

/** Scale the amount at the start of `text` ("200 g", "1½-2 dl"); text without one is returned as it is. */
const scaleLeading = (text, k) => {
  const m = text.match(LEADING_QTY);
  if (!m) return text;
  const a = parseNumber(m[1]);
  if (!Number.isFinite(a)) return text;
  let out = formatNumber(a * k);
  if (m[3]) {
    const b = parseNumber(m[3]);
    if (!Number.isFinite(b)) return text;
    out += m[2] + formatNumber(b * k);
  }
  return out + text.slice(m[0].length);
};

const APPROX = /^\s*(?:ca\.?|circa|approx\.?|about|[~≈])\s*/i;

/** A parenthetical amount scales with the ingredient: "ca. 120 g" -> "ca. 240 g" at 2x. */
export const scaleParen = (text, k) => {
  if (k === 1) return text;
  const head = (text.match(APPROX) || [""])[0];
  return head + scaleLeading(text.slice(head.length), k);
};

export const scaleIngredient = (text, k) => {
  if (k === 1) return text;
  const out = scaleLeading(text, k);
  // "100 g sugar (100 ml)": the amount in the parentheses is scaled too
  return out.replace(/\(([^)]*)\)/g, (all, inner) => `(${scaleParen(inner, k)})`);
};

export const baseServings = (servings) => {
  const m = String(servings ?? "").match(/\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
};

// ---- steps & timers -----------------------------------------------------
/** A step's timers as [{seconds, label}]: the `timers` list, or the older single `timer`. */
export const stepTimers = (s) => {
  const list = Array.isArray(s.timers) ? s.timers : [];
  const out = list
    .map((t) => (typeof t === "number" ? { seconds: t, label: "" } : { seconds: Number(t.seconds) || 0, label: String(t.label || "") }))
    .filter((t) => t.seconds > 0);
  if (!out.length && s.timer > 0) out.push({ seconds: s.timer, label: "" });
  return out;
};

export const normStep = (s) => {
  if (typeof s === "string") return { text: s, ingredients: [], timer: null, timers: [], section: false };
  const timers = stepTimers(s);
  return {
    text: s.text || "",
    ingredients: s.ingredients || [],
    timer: timers.length ? timers[0].seconds : null,
    timers,
    section: !!s.section,
  };
};

/**
 * Key, label and length for each timer of a step. The first timer keeps the key
 * `<recipe>:<step>` that single timers always had; later ones add `:<n>`.
 */
/** The words timer labels are made of ("Roast · step 2 · timer 2"), in the user's language. */
const LABEL_WORDS = {
  en: { step: "step", timer: "timer" },
  da: { step: "trin", timer: "timer" },
  de: { step: "Schritt", timer: "Timer" },
  sv: { step: "steg", timer: "timer" },
  nb: { step: "trinn", timer: "timer" },
  nl: { step: "stap", timer: "timer" },
  fr: { step: "étape", timer: "minuteur" },
  es: { step: "paso", timer: "temporizador" },
  it: { step: "passo", timer: "timer" },
};
export const labelWords = (language) => {
  const code = String(language || "en").toLowerCase().split("-")[0];
  return LABEL_WORDS[{ no: "nb", nn: "nb" }[code] || code] || LABEL_WORDS.en;
};

export const timerSpecs = (recipe, stepIndex, stepNumber, timers, language) => {
  const w = labelWords(language);
  return timers.map((t, n) => ({
    key: `${recipe.id}:${stepIndex}${n ? `:${n}` : ""}`,
    label: `${recipe.name} · ${w.step} ${stepNumber}${t.label ? ` · ${t.label}` : timers.length > 1 ? ` · ${w.timer} ${n + 1}` : ""}`,
    seconds: t.seconds,
    name: t.label,
  }));
};

// Stored as plain strings: "## Dough" is a section heading, "200 g butter || 180 g oil"
// carries a substitute with its own amount.
export const isHeader = (t) => /^#{1,6}\s/.test(String(t));

export const headerText = (t) => String(t).replace(/^#{1,6}\s*/, "").trim();

/** "200 g butter || 180 g oil // room temperature" -> ["200 g butter || 180 g oil", "room temperature"]. */
export const splitComment = (t) => {
  const s = String(t);
  const i = s.indexOf(" // ");
  return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 4).trim()];
};

export const splitSub = (t) => {
  const s = splitComment(t)[0];
  const i = s.indexOf(" || ");
  return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 4).trim()];
};

export const joinSub = (text, sub) => (sub.trim() ? `${text.trim()} || ${sub.trim()}` : text.trim());

/** "200 g butter || 180 g oil || 3 dl cream" -> { main, alts: [...] } (any number of alternatives). */
export const splitSubs = (t) => {
  const [body, comment] = splitComment(t);
  const parts = body.split(" || ").map((x) => x.trim());
  return { main: parts[0], alts: parts.slice(1).filter(Boolean), comment };
};

export const joinSubs = (text, alts, comment = "") => {
  const line = [text.trim(), ...alts.map((a) => a.trim()).filter(Boolean)].join(" || ");
  return comment.trim() ? `${line} // ${comment.trim().replace(/\s+/g, " ")}` : line;
};

export const clock = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${pad(m)}:${pad(sec % 60)}`;
};

export const duration = (sec) => {
  if (sec < 60) return `${sec} sec`;
  const m = Math.round((sec / 60) * 100) / 100;
  return minutes(Math.floor(m)) + (m % 1 ? ` ${Math.round((m % 1) * 60)} sec` : "");
};

export const fmtGrams = (g) => {
  if (g >= 100) return String(Math.round(g));
  if (g >= 10) return String(Math.round(g * 2) / 2).replace(/\.0$/, "");
  return String(Math.round(g * 10) / 10).replace(/\.0$/, "");
};

// Whole items read better as counts than as estimated weights.
export const COUNT_AS_ITEMS = new Set(["clove", "slice", "piece", "sprig", "head", "bunch", "handful", "sheet"]);

/** Text for ingredient `i` of recipe `r`, scaled by `k`, in the chosen unit mode. */
export const ingredientText = (r, i, k, mode) => {
  const raw = r.ingredients[i] ?? "";
  if (isHeader(raw)) return headerText(raw);
  const text = splitSub(raw)[0];
  const p = (r.parsed_ingredients || [])[i];
  const countable = p && p.approximate && (p.unit === null || COUNT_AS_ITEMS.has(p.unit));
  if (mode === "grams" && p && p.quantity !== null && !countable) {
    const food = p.food + (p.note ? `, ${p.note}` : "");
    const tail = p.paren_basis ? "" : (p.parens || []).map((t) => ` (${scaleParen(t, k)})`).join("");
    const tilde = p.approximate ? "≈ " : "";
    if (p.grams !== null) {
      const hi = p.grams_max !== null ? `–${fmtGrams(p.grams_max * k)}` : "";
      return `${tilde}${fmtGrams(p.grams * k)}${hi} g ${food}${tail}`;
    }
    if (p.ml !== null) return `${fmtGrams(p.ml * k)} ml ${food}${tail}`;
  }
  return scaleIngredient(text, k);
};

/**
 * Pieces of one ingredient for display: a main amount, the food, a note and (when
 * grams were substituted) a faded "as written" amount, e.g. "10 g" + "sukker" + "1¾ cups".
 */
export const ingParts = (p, text, k, mode) => {
  if (!p || p.quantity === null || p.quantity === undefined) return { qty: "", food: text, note: "", sub: "", paren: "" };
  const range = (a, b) => formatNumber(a * k) + (b !== null && b !== undefined ? `–${formatNumber(b * k)}` : "");
  const orig = range(p.quantity, p.quantity_max) + (p.unit_text ? ` ${p.unit_text}` : "");
  // parenthetical amounts ("100 g sugar (100 ml)") follow the scale; not shown when the grams came from them
  const paren = mode === "grams" && p.paren_basis ? "" : (p.parens || []).map((t) => `(${scaleParen(t, k)})`).join(" ");
  const base = { food: p.food, note: p.note || "", paren };
  const countable = p.approximate && (p.unit === null || COUNT_AS_ITEMS.has(p.unit));
  if (mode === "grams" && !countable) {
    const tilde = p.approximate ? "≈ " : "";
    if (p.grams !== null) {
      const hi = p.grams_max !== null ? `–${fmtGrams(p.grams_max * k)}` : "";
      return { ...base, qty: `${tilde}${fmtGrams(p.grams * k)}${hi} g`, sub: p.unit === "g" ? "" : orig };
    }
    if (p.ml !== null) return { ...base, qty: `${fmtGrams(p.ml * k)} ml`, sub: p.unit === "ml" ? "" : orig };
  }
  return { ...base, qty: orig, sub: "" };
};

export const fmtYield = (n) => String(Math.round(n * 100) / 100);

export const SCALES = [[0.5, "½×"], [1, "1×"], [2, "2×"], [3, "3×"], [4, "4×"]];

/** What the amount box counts: what the recipe makes, else how many it serves, else a bare multiplier. */
export const scaleBasis = (r) => {
  if (r.yield_amount > 0) return { label: "Makes", base: r.yield_amount, unit: r.yield_unit || "" };
  const servings = baseServings(r.servings);
  if (servings > 0) return { label: "Serves", base: servings, unit: "" };
  return { label: "Scale", base: 1, unit: "×" };
};


export const roundAmount = (n) => String(Math.round(n * 100) / 100);

/** "5 min", "1 h 20 min", "45 sec" for a number of seconds. */
export const lengthText = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : "", s ? `${s} sec` : ""].filter(Boolean).join(" ") || "0 sec";
};

// ---- ingredient mentions in step text ----
// An ingredient a step uses is usually named in the step ("Smelt smør ..."). These helpers find
// where, so the text can show the ingredient as a chip. Nothing is stored: the text stays plain.
// words that describe an amount rather than the food
const UNITS = new Set(
  `gram g gr kg kilo kilogram kilogrammer mg milligram ml milliliter cl centiliter dl deciliter l liter
   tsk tsp teske teskeer tesked teskefuld spsk tbsp spiseske spiseskeer spiseskefuld spiseskefulde dessertske dessertskeer
   stk stykke stykker fed knivspids knsp nip dåse dåser ds pose poser pakke pakker pk bundt bdt håndfuld
   skive skiver stang stænger stilk stilke kvist kviste blad blade dryp drys klat glas
   kop kopper cup cups oz ounce ounces lb lbs pound pounds gallon quart pint pinch pinches clove cloves can cans
   slice slices piece pieces dash knob scoop sprig sprigs bunch handful stick sticks head heads`
    .split(/\s+/)
);
const NUMERIC = /^[\d¼-¾⅐-⅞¹²³⁰-⁹₀-₉⁄/.,\-–\s]+/u;

// words that end the food part of a line: "280 gram sukker jeg brugte halv brun farin"
const STOP = new Set("jeg til svarer eller or men som der kan også at for med uden evt ca".split(" "));
const JOIN = new Set(["og", "and", "&"]);

/**
 * The food words of an ingredient line, best first: units, amounts and trailing remarks are left
 * out, and the last word of "røde løg" comes first because that is the noun. A line that names
 * two foods ("salt og peber") comes back with the whole phrase first and `compound` set.
 */
export const foodWords = (text) => {
  const body = String(text).replace(NUMERIC, "").split(/[;(]/)[0].split(",")[0];
  const words = [];
  const seq = [];
  for (const raw of body.split(/\s+/)) {
    const w = raw.replace(/[.:]+$/, "");
    if (!w) continue;
    if (STOP.has(w.toLowerCase())) break;
    if (JOIN.has(w.toLowerCase())) {
      if (seq.length) seq.push(w);
      continue;
    }
    // a capital after the food ("vand Kogende") starts a remark
    if (words.length && /^\p{Lu}/u.test(w)) break;
    if (/^\p{L}[\p{L}'’-]+$/u.test(w) && !UNITS.has(w.toLowerCase())) {
      words.push(w);
      seq.push(w);
    }
  }
  while (seq.length && JOIN.has(seq[seq.length - 1].toLowerCase())) seq.pop();
  // "tørrede", "hakkede": describing words that follow the noun
  const heads = words.filter((w) => !/ede$/i.test(w));
  const out = (heads.length ? heads : words)
    .slice()
    .reverse()
    // "kidney-bønner" is also found as "bønner"
    .flatMap((w) => (w.includes("-") ? [w, ...w.split("-").filter((p) => p.length >= 3)] : [w]))
    .slice(0, 4);
  const compound = seq.some((w) => JOIN.has(w.toLowerCase()));
  if (compound) {
    out.unshift(seq.join(" "));
    out.compound = true;
  }
  return out;
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where each ingredient in `items` ([{ key, text }]) is named in `text`: [{ key, start, len }].
 * Every mention of the first food word that is found counts, and inflected forms
 * (smør / smørret, æg / æggene); "salt og peber" is that phrase or each food on its own.
 */
export const detectChips = (text, items) => {
  const chips = [];
  const taken = (a, b) => chips.some((c) => a < c.start + c.len && b > c.start);
  for (const { key, text: line } of items) {
    const words = foodWords(line);
    const find = (word) => {
      const re = new RegExp(`(?<![\\p{L}])${escRe(word).replace(/ /g, "\\s+")}\\p{L}{0,4}(?![\\p{L}])`, "giu");
      const found = [];
      let m;
      while ((m = re.exec(text))) {
        if (!taken(m.index, m.index + m[0].length)) found.push({ key, start: m.index, len: m[0].length });
      }
      return found;
    };
    if (words.compound) {
      const whole = find(words[0]);
      if (whole.length) {
        chips.push(...whole);
        continue;
      }
      for (const word of words.slice(1)) chips.push(...find(word));
      continue;
    }
    for (const word of words) {
      const found = find(word);
      if (found.length) {
        chips.push(...found);
        break;
      }
    }
  }
  return chips.sort((x, y) => x.start - y.start);
};

/** Step text as HTML with a chip in place of every mention: { html, placed: Set of keys }. */
export const stepTextHtml = (text, items, chipHtml) => {
  const chips = detectChips(String(text), items);
  let html = "";
  let at = 0;
  for (const c of chips) {
    if (c.start < at) continue;
    html += esc(text.slice(at, c.start));
    html += chipHtml(c.key, text.slice(c.start, c.start + c.len));
    at = c.start + c.len;
  }
  return { html: html + esc(text.slice(at)), placed: new Set(chips.map((c) => c.key)) };
};
