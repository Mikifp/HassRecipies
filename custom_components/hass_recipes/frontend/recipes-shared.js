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

export const scaleIngredient = (text, k) => {
  if (k === 1) return text;
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
    const tilde = p.approximate ? "≈ " : "";
    if (p.grams !== null) {
      const hi = p.grams_max !== null ? `–${fmtGrams(p.grams_max * k)}` : "";
      return `${tilde}${fmtGrams(p.grams * k)}${hi} g ${food}`;
    }
    if (p.ml !== null) return `${fmtGrams(p.ml * k)} ml ${food}`;
  }
  return scaleIngredient(text, k);
};

/**
 * Pieces of one ingredient for display: a main amount, the food, a note and (when
 * grams were substituted) a faded "as written" amount, e.g. "10 g" + "sukker" + "1¾ cups".
 */
export const ingParts = (p, text, k, mode) => {
  if (!p || p.quantity === null || p.quantity === undefined) return { qty: "", food: text, note: "", sub: "" };
  const range = (a, b) => formatNumber(a * k) + (b !== null && b !== undefined ? `–${formatNumber(b * k)}` : "");
  const orig = range(p.quantity, p.quantity_max) + (p.unit_text ? ` ${p.unit_text}` : "");
  const base = { food: p.food, note: p.note || "" };
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

