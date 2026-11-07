/* Recipes panel: the recipe editor's ingredients and steps, built from Home Assistant's own ha-card, ha-input,
 * ha-textarea, ha-sortable, ha-dropdown, ha-button, ha-icon-button, ha-checkbox and ha-input-chip.
 * Mixed into the panel class by recipes-panel.js.
 *
 * It edits this._form: the ingredient rows and the steps, two lists that are saved as they are.
 *  - Ingredients are fields (amount, unit, food, note) or one line of text each; an alternative sits under its
 *    ingredient. Every ingredient has an id (the row's uid), which is what steps link to.
 *  - Steps are text with timers. Pick a step, then tick the ingredients it uses in the list beside it.
 *  - Both lists can have sections, and both are reordered by dragging.
 */
export default function (h) {
  const { esc, T, foodWords, detectChips, splitSubs, splitAmount, joinAmount, toMetric, fl } = h;
  const icon = (n, slot = "") => `<ha-icon ${slot ? `slot="${slot}" ` : ""}icon="mdi:${n}"></ha-icon>`;
  const move = (list, from, to) => {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  };
  const secs = (t) => (parseFloat(t.h) || 0) * 3600 + (parseFloat(t.m) || 0) * 60 + (parseFloat(t.s) || 0);
  const label = (row) => String(row.text).trim();
  /**
   * `ids` in the order of a list after item `from` was dragged to `to`. A section (a heading) takes the items under it
   * along, like a choose block in the automation editor: it lands before the heading it was dropped on, else after the
   * section it was dropped in. null ids (the "Add ingredient" buttons) follow their section.
   */
  const reorder = (ids, isHeader, from, to) => {
    const moved = [...ids];
    move(moved, from, to);
    const item = ids[from];
    if (!isHeader(item)) return moved.filter(Boolean);
    let end = from + 1;
    while (end < ids.length && (ids[end] === null || !isHeader(ids[end]))) end += 1;
    const block = ids.slice(from, end).filter(Boolean);
    const rest = ids.filter((x, i) => x !== null && (i < from || i >= end));
    const prev = moved[to - 1];
    let at;
    if (prev !== undefined && prev !== null && isHeader(prev) && prev !== item) at = rest.indexOf(prev);
    else {
      // after the section it was dropped in: before the next heading
      let k = to + 1;
      while (k < moved.length && (moved[k] === null || !(isHeader(moved[k]) && moved[k] !== item))) k += 1;
      const next = moved.slice(k).find((x) => x && x !== item);
      at = next === undefined ? rest.length : rest.indexOf(next);
    }
    // dropped before a heading that was the first thing in the list: it simply goes first
    rest.splice(at, 0, ...block);
    return rest;
  };

  return {
    // ---- the lists as text ----
    /** The ingredient rows as lines: ## for a section, || before an alternative, // before the note. */
    _neToText() {
      return this._form.rows
        .map((r) => (r.header ? `## ${r.text}` : [r.text, ...r.subs.filter(Boolean).map((a) => ` || ${a}`)].join("") + (r.comment ? ` // ${r.comment}` : "")))
        .join("\n");
    },

    /** Lines -> rows. A line that is the same as one that was there keeps its id (and the steps' links). */
    _neFromText(text) {
      const old = new Map(this._form.rows.map((r) => [this._neLine(r), r.uid]));
      return String(text)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const row = this._rowFromString(line);
          const same = old.get(this._neLine(row));
          if (same) {
            old.delete(this._neLine(row));
            row.uid = same;
          }
          return row;
        });
    },

    _neLine(r) {
      return r.header ? `## ${r.text}` : [r.text, ...r.subs.filter(Boolean)].join(" || ") + (r.comment ? ` // ${r.comment}` : "");
    },

    // ---- drawing ----
    _neMode() {
      return this._neModeValue || "fields";
    },

    _neSteps() {
      this._form.steps.forEach((s) => {
        if (!s.uid) s.uid = this._nextUid();
      });
      return this._form.steps;
    },

    /** The step that is being edited: the one picked, else the first that is not a section. */
    _neCurrent() {
      const steps = this._neSteps();
      return steps.find((s) => s.uid === this._neCur && !s.section) || steps.find((s) => !s.section) || null;
    },

    _neStatus(row) {
      if (!String(row.text).trim()) return ["", ""];
      const parts = splitAmount(row.text);
      if (!parts.amount) return ["warn", T("no amount")];
      const known = this._foodNamesMap()[fl.nameKey(parts.food)];
      return known ? ["ok", T("a food of yours")] : ["", ""];
    },

    /** A line in metric: { text, hint } for an amount in cups, spoons, ounces or pounds ("" when it is not), grams when the food's weight is known. */
    _neMetric(text) {
      const p = splitAmount(text);
      if (!p.amount || !p.unit) return null;
      const weights = this._foodWeightsMap();
      const found = [p.food, ...foodWords(text)].map((c) => weights[fl.nameKey(c)]).find(Boolean);
      const m = toMetric(p.amount, p.unit, found);
      if (!m) return null;
      const main = m.grams || m;
      return { text: joinAmount({ amount: main.amount, unit: main.unit, food: p.food }), hint: `${main.amount} ${main.unit}${m.grams ? ` (${m.amount} ${m.unit})` : ""}` };
    },

    /** The first line of an ingredient (or its alternatives) that is not metric yet, with what it would be. */
    _neConvHtml(row) {
      if (row.header) return "";
      const c = [row.text, ...row.subs].map((t) => this._neMetric(t)).find(Boolean);
      if (!c) return "";
      return `<ha-button class="ne-convbtn" appearance="plain" size="s" data-ne-act="convert" data-uid="${esc(row.uid)}" title="${esc(T("Write this in metric"))}">${icon("swap-horizontal", "start")}${esc(c.hint)}</ha-button>`;
    },

    _neConvertRow(row) {
      if (row.header) return;
      row.text = (this._neMetric(row.text) || { text: row.text }).text;
      row.subs = row.subs.map((t) => (this._neMetric(t) || { text: t }).text);
    },

    _neAmountFields(text, attrs, plain) {
      const p = splitAmount(text);
      // plain: the row of the wide layout, which reads like an automation row, so the fields are bare inputs
      const f = (name, value, ph, cls) =>
        plain
          ? `<input class="ne-f ne-pin ${cls}" data-f="${name}" ${attrs} value="${esc(value)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off">`
          : `<ha-input class="ne-f ${cls}" data-f="${name}" ${attrs} value="${esc(value)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"></ha-input>`;
      const alt = /data-alt=/.test(attrs);
      return f("amount", p.amount, T("Amount"), "ne-amount") + f("unit", p.unit, T("Unit"), "ne-unit") + f("food", p.food, alt ? T("Or this food") : T("Food"), "ne-food");
    },

    /** For a list with sections: which items sit under a section, which are folded away, and how many each section holds. */
    _neNest(items, isSect) {
      this._neFolded = this._neFolded || new Set();
      let sect = null;
      let last = null;
      const out = items.map((x) => {
        if (isSect(x)) {
          if (last) last.last = true;
          last = null;
          sect = { sect: true, folded: this._neFolded.has(x.uid), count: 0 };
          return sect;
        }
        if (sect) sect.count += 1;
        last = { in: !!sect, hidden: !!sect && sect.folded };
        return last;
      });
      if (last && last.in) last.last = true;
      return out;
    },

    /** The head of a section: fold button, icon, title (the field), how many it holds. */
    _neSectHead(uid, title, f, field, menu, kind) {
      // like the choose block of the automation editor: the name is text, renamed from the menu (or at once when it has none)
      const editing = this._neRenamingNow === uid || !String(title).trim();
      return `<ha-icon-button class="ne-chev" data-ne-act="fold" data-uid="${uid}" label="${esc(T(f.folded ? "Show the section" : "Hide the section"))}">${icon(f.folded ? "chevron-down" : "chevron-up")}</ha-icon-button>
        <span class="ne-diamond">${icon(kind === "ing" ? "format-list-bulleted" : "format-list-numbered")}</span>
        ${
          editing
            ? `<ha-input class="ne-f ne-title" data-f="${field}" data-uid="${uid}" value="${esc(title)}" placeholder="${esc(T("Section title"))}" aria-label="${esc(T("Section title"))}"></ha-input>`
            : `<span class="ne-sname" data-ne-act="rename" data-uid="${uid}" title="${esc(T("Rename"))}">${esc(title)}</span>`
        }
        <ha-assist-chip class="ne-sectcount" label="${f.count}"></ha-assist-chip>
        <ha-icon class="ne-handle" icon="mdi:drag-horizontal-variant"></ha-icon>${menu}`;
    },

    _neIngredientHtml(row, f = {}) {
      const uid = esc(row.uid);
      if (row.header) {
        const menu = `<ha-dropdown data-ne-menu="ing" data-uid="${uid}"><ha-icon-button slot="trigger" label="${esc(T("More"))}">${icon("dots-vertical")}</ha-icon-button>
              <ha-dropdown-item value="rename">${icon("pencil-outline", "icon")}${esc(T("Rename"))}</ha-dropdown-item>
              <ha-dropdown-item value="add-ing-in">${icon("plus", "icon")}${esc(T("Add an ingredient"))}</ha-dropdown-item>
              <ha-dropdown-item value="up-ing">${icon("arrow-up", "icon")}${esc(T("Move up"))}</ha-dropdown-item>
              <ha-dropdown-item value="down-ing">${icon("arrow-down", "icon")}${esc(T("Move down"))}</ha-dropdown-item>
              <ha-dropdown-item value="del-ing" variant="danger">${icon("delete-outline", "icon")}${esc(T("Delete"))}</ha-dropdown-item>
            </ha-dropdown>`;
        return `<ha-card class="ne-ing ne-isect" data-uid="${uid}"><div class="ne-sline">${this._neSectHead(uid, row.text, f, "title", menu, "ing")}</div></ha-card>`;
      }
      const [tone, status] = this._neStatus(row);
      const alts = row.subs
        .map(
          (a, n) => `<div class="ne-alt"><span class="ne-or">${esc(T("or"))}</span>${this._neAmountFields(a, `data-uid="${uid}" data-alt="${n}"`)}
            <ha-icon-button class="ne-del" data-ne-act="del-alt" data-uid="${uid}" data-alt="${n}" label="${esc(T("Delete"))}">${icon("close")}</ha-icon-button></div>`
        )
        .join("");
      const noted = !!(row.comment || row._note);
      if (!this._brCompact()) {
        // wide: the row is the amount, unit and food; the note, alternatives and the metric amount are in the pane
        const sum = [row.comment, ...row.subs.filter(Boolean).map((a) => `${T("or")} ${a}`)].filter(Boolean).join(" · ");
        return `<div class="ne-ing ne-wrow ${f.in ? "ne-in" : ""} ${f.hidden ? "ne-hide" : ""} ${this._neSelIng === row.uid ? "sel" : ""}" data-uid="${uid}"><div class="ne-card">
          <div class="ne-line"><ha-icon class="ne-lead" icon="mdi:circle-medium"></ha-icon>
            ${this._neAmountFields(row.text, `data-uid="${uid}"`, true)}
            <span class="ne-status ${tone}" id="ne-st-${uid}">${esc(status)}</span>
            <ha-icon class="ne-handle" icon="mdi:drag-horizontal-variant"></ha-icon>
            <ha-dropdown data-ne-menu="ing" data-uid="${uid}"><ha-icon-button slot="trigger" label="${esc(T("More"))}">${icon("dots-vertical")}</ha-icon-button>
              <ha-dropdown-item value="add-alt">${icon("plus", "icon")}${esc(T("Add an alternative"))}</ha-dropdown-item>
              <ha-dropdown-item value="add-note">${icon("note-plus-outline", "icon")}${esc(T("Add a note"))}</ha-dropdown-item>
              <ha-dropdown-item value="up-ing">${icon("arrow-up", "icon")}${esc(T("Move up"))}</ha-dropdown-item>
              <ha-dropdown-item value="down-ing">${icon("arrow-down", "icon")}${esc(T("Move down"))}</ha-dropdown-item>
              <ha-dropdown-item value="del-ing" variant="danger">${icon("delete-outline", "icon")}${esc(T("Delete"))}</ha-dropdown-item>
            </ha-dropdown>
          </div><div class="ne-rsum">${esc(sum)}</div></div></div>`;
      }
      return `<div class="ne-ing ${noted ? "has-note" : ""} ${f.in ? "ne-in" : ""} ${f.hidden ? "ne-hide" : ""}" data-uid="${uid}">
          <div class="ne-line"><ha-icon class="ne-handle" icon="mdi:drag"></ha-icon>
            ${this._neAmountFields(row.text, `data-uid="${uid}"`)}
            <ha-input class="ne-f ne-note" data-f="note" data-uid="${uid}" value="${esc(row.comment)}" placeholder="${esc(T("Note"))}" aria-label="${esc(T("Note"))}"></ha-input>
            <span class="ne-status ${tone}" id="ne-st-${uid}">${esc(status)}</span>
            <ha-dropdown data-ne-menu="ing" data-uid="${uid}"><ha-icon-button slot="trigger" label="${esc(T("More"))}">${icon("dots-vertical")}</ha-icon-button>
              <ha-dropdown-item value="add-alt">${icon("plus", "icon")}${esc(T("Add an alternative"))}</ha-dropdown-item>
              ${noted ? "" : `<ha-dropdown-item value="add-note">${icon("note-plus-outline", "icon")}${esc(T("Add a note"))}</ha-dropdown-item>`}
              <ha-dropdown-item value="up-ing">${icon("arrow-up", "icon")}${esc(T("Move up"))}</ha-dropdown-item>
              <ha-dropdown-item value="down-ing">${icon("arrow-down", "icon")}${esc(T("Move down"))}</ha-dropdown-item>
              <ha-dropdown-item value="del-ing" variant="danger">${icon("delete-outline", "icon")}${esc(T("Delete"))}</ha-dropdown-item>
            </ha-dropdown>
          </div><div class="ne-conv" id="ne-cv-${uid}">${this._neConvHtml(row)}</div>${alts}</div>`;
    },

    _neIngredientsHtml() {
      const mode = this._neMode();
      const rows = this._form.rows;
      const real = rows.filter((r) => !r.header && r.text.trim());
      const tab = (id, text) => `<ha-assist-chip class="ne-tab" data-ne-act="mode" data-mode="${id}" label="${esc(T(text))}" ${mode === id ? "active" : ""}></ha-assist-chip>`;
      let body;
      if (mode === "text") {
        body = `<div class="ne-hint">${esc(T("One ingredient per line. Use || for an alternative, // for a note and ## for a section."))}</div>
          <ha-textarea id="ne-text" class="ne-textarea" value="${esc(this._neToText())}" autogrow></ha-textarea>`;
      } else {
        body = `<ha-sortable id="ne-ings" handle-selector=".ne-handle">
            <div class="ne-list">${(() => {
              const nest = this._neNest(rows, (r) => r.header);
              const out = [];
              this._neIds = [];
              let open = null;
              const close = () => {
                if (!open) return;
                out.push(`<div class="ne-sfoot ne-in ${open.folded ? "ne-hide" : ""}"><ha-button appearance="filled" size="s" data-ne-act="add-ing-in" data-uid="${esc(open.uid)}">${icon("plus", "start")}${esc(T("Add ingredient"))}</ha-button></div>`);
                this._neIds.push(null);
                open = null;
              };
              rows.forEach((r, i) => {
                if (r.header) {
                  close();
                  open = { uid: r.uid, folded: nest[i].folded };
                }
                out.push(this._neIngredientHtml(r, { ...nest[i], last: false }));
                this._neIds.push(r.uid);
              });
              close();
              return out.join("");
            })()}</div>
          </ha-sortable>
          <div class="ne-adds">
            <ha-button appearance="filled" data-ne-act="add-ing">${icon("plus", "start")}${esc(T("Add ingredient"))}</ha-button>
            <ha-button appearance="plain" size="s" data-ne-act="add-ing-section">${icon("format-title", "start")}${esc(T("Add section"))}</ha-button>
            ${(() => {
              const n = real.filter((r) => this._neConvHtml(r)).length;
              return n ? `<ha-button appearance="outlined" size="s" data-ne-act="convert-all">${icon("swap-horizontal", "start")}${esc(T("Write all in metric"))} (${n})</ha-button>` : "";
            })()}
            <span class="ne-count">${real.length} ${esc(T("ingredients"))}</span>
          </div>`;
      }
      return `<section class="ne-sec"><div class="ne-sechead"><h2>${esc(T("Ingredients"))}</h2><div class="ne-tabs">${tab("fields", "Fields")}${tab("text", "Text")}</div></div>
          <p class="ne-desc">${esc(T("The ingredients of the recipe, one line each. Use Text to paste or type a whole list."))}</p>
          <div class="ne-body">${body}</div></section>`;
    },

    // ---- steps ----
    _neSuggestions(step) {
      const out = [];
      const rows = this._form.rows.filter((r) => !r.header && r.text.trim() && !step.ingredients.includes(r.uid));
      const items = rows.map((r) => ({ key: r.uid, text: r.text, names: this._foodNamesForText(r.text) }));
      const seen = new Set();
      for (const c of detectChips(step.text || "", items)) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        out.push({ kind: "link", uid: c.key, text: label(rows.find((r) => r.uid === c.key)) });
      }
      const m = String(step.text || "").match(/(\d+)\s*(?:minutter|minutes|minut|min)\b/i);
      if (m && !(step.timers || []).some((t) => secs(t) === Number(m[1]) * 60)) out.push({ kind: "timer", minutes: Number(m[1]) });
      return out;
    },

    _neChipsHtml(step) {
      const byUid = new Map(this._form.rows.map((r) => [r.uid, r]));
      const linked = step.ingredients
        .filter((u) => byUid.has(u) && !byUid.get(u).header)
        .map((u) => `<ha-input-chip class="ne-chip" data-unlink="1" data-uid="${esc(step.uid)}" data-ing="${esc(u)}" label="${esc(label(byUid.get(u)))}"></ha-input-chip>`)
        .join("");
      const suggested = this._neSuggestions(step)
        .map((g) =>
          g.kind === "link"
            ? `<ha-assist-chip class="ne-sug" data-ne-act="link" data-uid="${esc(step.uid)}" data-ing="${esc(g.uid)}" label="${esc(`${T("Link")} ${g.text}?`)}">${icon("link-plus", "icon")}</ha-assist-chip>`
            : `<ha-assist-chip class="ne-sug" data-ne-act="sug-timer" data-uid="${esc(step.uid)}" data-minutes="${g.minutes}" label="${esc(`${T("Add a timer for")} ${g.minutes} ${T("min")}?`)}">${icon("timer-plus-outline", "icon")}</ha-assist-chip>`
        )
        .join("");
      return linked + suggested;
    },

    _neTimersHtml(step) {
      return (step.timers || [])
        .map((t, n) => {
          const f = (name, v, ph, w) =>
            `<ha-input class="ne-f ne-tnum ${w}" type="${name === "label" ? "text" : "number"}" data-t="${name}" data-uid="${esc(step.uid)}" data-n="${n}" value="${esc(v)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"></ha-input>`;
          return `<div class="ne-timer">${icon("timer-outline")}${f("h", t.h, "0", "")}<span>${esc(T("h"))}</span>${f("m", t.m, "0", "")}<span>${esc(T("min"))}</span>${f("s", t.s, "0", "")}<span>${esc(T("sec"))}</span>${f("label", t.label, T("Label"), "ne-tlabel")}
            <ha-icon-button class="ne-del" data-ne-act="del-timer" data-uid="${esc(step.uid)}" data-n="${n}" label="${esc(T("Remove timer"))}">${icon("close")}</ha-icon-button></div>`;
        })
        .join("");
    },

    _neStepHtml(step, num, cur, f = {}) {
      const uid = esc(step.uid);
      const menu = `<ha-dropdown data-ne-menu="step" data-uid="${uid}"><ha-icon-button slot="trigger" label="${esc(T("More"))}">${icon("dots-vertical")}</ha-icon-button>
          ${step.section ? `<ha-dropdown-item value="rename">${icon("pencil-outline", "icon")}${esc(T("Rename"))}</ha-dropdown-item>` : `<ha-dropdown-item value="add-timer">${icon("timer-plus-outline", "icon")}${esc(T("Add a timer"))}</ha-dropdown-item>`}
          <ha-dropdown-item value="add-section-above">${icon("format-title", "icon")}${esc(T("Add a section above"))}</ha-dropdown-item>
          <ha-dropdown-item value="up-step">${icon("arrow-up", "icon")}${esc(T("Move up"))}</ha-dropdown-item>
          <ha-dropdown-item value="down-step">${icon("arrow-down", "icon")}${esc(T("Move down"))}</ha-dropdown-item>
          <ha-dropdown-item value="del-step" variant="danger">${icon("delete-outline", "icon")}${esc(T("Delete"))}</ha-dropdown-item>
        </ha-dropdown>`;
      if (step.section) {
        return `<ha-card class="ne-step ne-sect" data-uid="${uid}">${this._neSectHead(uid, step.text, f, "stext", menu, "step")}</ha-card>`;
      }
      return `<ha-card class="ne-step ${cur && cur.uid === step.uid ? "cur" : ""} ${f.in ? "ne-in" : ""} ${f.last ? "ne-last" : ""} ${f.hidden ? "ne-hide" : ""}" data-uid="${uid}" data-ne-act="pick">
          <div class="ne-stephead"><ha-icon class="ne-handle" icon="mdi:drag"></ha-icon><b>${esc(T("Step"))} ${num}</b><span class="ne-grow"></span>
            <ha-button appearance="plain" size="s" data-ne-act="add-timer" data-uid="${uid}">${icon("timer-plus-outline", "start")}${esc(T("Timer"))}</ha-button>${menu}</div>
          <ha-textarea class="ne-stext" data-f="stext" data-uid="${uid}" value="${esc(step.text)}" placeholder="${esc(T("What to do"))}" aria-label="${esc(T("Step text"))}" autogrow></ha-textarea>
          <div class="ne-chips" id="ne-ch-${uid}">${this._neChipsHtml(step)}</div>
          <div class="ne-timers" id="ne-tm-${uid}">${this._neTimersHtml(step)}</div>
        </ha-card>`;
    },

    /** The ingredient ticks of the picked step (and which steps use each), ready for a pane or a folded panel. */
    _neTicksHtml() {
      const steps = this._neSteps();
      const cur = this._neCurrent();
      const real = this._form.rows.filter((r) => !r.header && r.text.trim());
      const used = (r) => steps.filter((s) => !s.section && s.ingredients.includes(r.uid));
      const number = (s) => steps.filter((x) => !x.section).indexOf(s) + 1;
      const list = real
        .map((r) => {
          const u = used(r);
          const on = cur && cur.ingredients.includes(r.uid);
          return `<ha-check-list-item left class="ne-li ${u.length ? "used" : ""}" data-ne-act="tick" data-ing="${esc(r.uid)}" ${on ? "selected" : ""} aria-label="${esc(label(r))}">
            <span class="ne-grow">${esc(label(r))}</span> <small class="ne-where">${u.length ? `${esc(T("step"))} ${u.map(number).join(", ")}` : esc(T("not used"))}</small></ha-check-list-item>`;
        })
        .join("");
      const unused = real.filter((r) => !used(r).length).length;
      return `${list ? `<ha-list multi>${list}</ha-list>` : `<div class="ne-hint">${esc(T("Add ingredients above first."))}</div>`}${unused && real.length ? `<div class="ne-hint">${unused} ${esc(T("not used in any step"))}</div>` : ""}`;
    },

    /** The pane: the ingredient that is picked, else the picked step. */
    _nePaneHtml() {
      const row = this._neSelIng && this._neRowByUid(this._neSelIng);
      if (row && !row.header) return this._nePaneIngredient(row);
      const cur = this._neCurrent();
      return `<ha-card class="ne-pane"><div class="ne-panehead"><div class="ne-panetitle" id="ne-panetitle">${esc(this._nePaneTitle(cur))}</div>
          <div class="ne-panesub">${esc(T("Ingredients used in this step"))}</div></div>
        <div class="ne-panebody">${cur ? this._neTicksHtml() : `<div class="ne-hint">${esc(T("Add a step first."))}</div>`}</div></ha-card>`;
    },

    /** The extras of one ingredient: its note, alternatives, metric amount and the steps that use it. */
    _nePaneIngredient(row) {
      const uid = esc(row.uid);
      const steps = this._neSteps().filter((s) => !s.section);
      const where = steps.map((s, i) => (s.ingredients.includes(row.uid) ? i + 1 : 0)).filter(Boolean);
      const alts = row.subs
        .map(
          (a, n) => `<div class="ne-alt"><span class="ne-or">${esc(T("or"))}</span>${this._neAmountFields(a, `data-uid="${uid}" data-alt="${n}"`)}
            <ha-icon-button class="ne-del" data-ne-act="del-alt" data-uid="${uid}" data-alt="${n}" label="${esc(T("Delete"))}">${icon("close")}</ha-icon-button></div>`
        )
        .join("");
      return `<ha-card class="ne-pane"><div class="ne-panehead"><div class="ne-panetitle" id="ne-panetitle">${esc(label(row) || T("Ingredient"))}</div>
          <div class="ne-panesub">${esc(T("Ingredient"))}</div></div>
        <div class="ne-panebody">
          <div class="ne-sub">${esc(T("Note"))}</div>
          <ha-input class="ne-f ne-pnote" data-f="note" data-uid="${uid}" value="${esc(row.comment)}" placeholder="${esc(T("Note"))}" aria-label="${esc(T("Note"))}"></ha-input>
          <div class="ne-sub">${esc(T("Alternatives"))}</div>
          ${alts}
          <ha-button appearance="plain" size="s" data-ne-act="add-alt" data-uid="${uid}">${icon("plus", "start")}${esc(T("Add an alternative"))}</ha-button>
          <div class="ne-conv" id="ne-cv-${uid}">${this._neConvHtml(row)}</div>
          <div class="ne-sub">${esc(T("Used in"))}</div>
          <div class="ne-hint">${where.length ? `${esc(T("step"))} ${where.join(", ")}` : esc(T("not used"))}</div>
        </div></ha-card>`;
    },

    /** Another ingredient or step was picked: the pane shows it. */
    _neSelect(kind, uid) {
      const form = this.shadowRoot.getElementById("form");
      if (!form) return;
      if (kind === "ing") {
        if (this._neSelIng === uid) return;
        this._neSelIng = uid;
      } else {
        if (!this._neSelIng && this._neCur === uid) return;
        this._neSelIng = null;
        this._neCur = uid;
        form.querySelectorAll(".ne-step").forEach((s) => s.classList.toggle("cur", s.dataset.uid === uid));
      }
      form.querySelectorAll(".ne-ing:not(.ne-isect)").forEach((r) => r.classList.toggle("sel", r.dataset.uid === this._neSelIng));
      const pane = form.querySelector(".ne-pane");
      if (pane) pane.outerHTML = this._nePaneHtml();
    },

    _neStepsHtml() {
      const steps = this._neSteps();
      const cur = this._neCurrent();
      const real = this._form.rows.filter((r) => !r.header && r.text.trim());
      let num = 0;
      const nest = this._neNest(steps, (s) => s.section);
      const cards = steps.map((s, i) => this._neStepHtml(s, s.section ? 0 : ++num, cur, nest[i])).join("");
      const compact = this._brCompact();
      const ticks = this._neTicksHtml();
      const folded = compact && real.length
        ? `<ha-expansion-panel id="ne-ingpanel" left-chevron outlined ${this._neListOpen ? "expanded" : ""}><div slot="header">${esc(T("Ingredients"))} · ${cur ? cur.ingredients.length : 0} ${esc(T("of"))} ${real.length} ${esc(T("in this step"))}</div>${ticks}</ha-expansion-panel>`
        : "";
      const main = `<section class="ne-sec"><div class="ne-sechead"><h2>${esc(T("Steps"))}</h2></div>
          <p class="ne-desc">${esc(T("Pick a step, then tick the ingredients it uses."))}</p>
          ${folded}
          <div class="ne-body">
            <ha-sortable id="ne-stepsort" handle-selector=".ne-handle"><div class="ne-steplist">${cards}</div></ha-sortable>
            <div class="ne-adds"><ha-button appearance="filled" data-ne-act="add-step">${icon("plus", "start")}${esc(T("Add step"))}</ha-button>
              <ha-button appearance="plain" size="s" data-ne-act="add-step-section">${icon("format-title", "start")}${esc(T("Add section"))}</ha-button></div>
          </div></section>`;
      // wide: what the picked step uses goes in a pane beside the lists, like the options of a block in the automation editor
      const pane = compact ? "" : this._nePaneHtml();
      return { main, pane };
    },

    /** "Step 3" for the picked step. */
    _nePaneTitle(cur) {
      if (!cur) return T("Steps");
      return `${T("Step")} ${this._neSteps().filter((s) => !s.section).indexOf(cur) + 1}`;
    },

    _newEditorHtml() {
      this._neRenamingNow = this._neRenaming;
      this._neRenaming = null;
      const { main, pane } = this._neStepsHtml();
      const wide = !this._brCompact();
      return `<div class="ne ${wide ? "ne-wide" : ""}" id="ne"><div class="ne-main">${this._neIngredientsHtml()}${main}</div>${pane}</div>`;
    },

    // ---- reading the page back into this._form ----
    /** The text view is read when the form is saved or the view is switched: lines become rows. */
    _syncEditor() {
      const box = this.shadowRoot && this.shadowRoot.getElementById("ne-text");
      if (!box) return;
      const rows = this._neFromText(box.value);
      this._form.rows = rows;
      const known = new Set(rows.map((r) => r.uid));
      this._neSteps().forEach((s) => (s.ingredients = s.ingredients.filter((u) => known.has(u))));
    },

    _neChange(mutate, focus = null) {
      this._syncEditor();
      mutate();
      this._neFocus = focus;
      this._formDirty = true;
      this._render();
    },

    _neRowByUid(uid) {
      return this._form.rows.find((r) => r.uid === uid);
    },

    _neStepByUid(uid) {
      return this._neSteps().find((s) => s.uid === uid);
    },

    /** One ingredient field changed: the row's text is rebuilt from its three fields. */
    _neSetAmount(el, row) {
      const scope = el.closest(".ne-line, .ne-alt");
      const get = (n) => (scope.querySelector(`[data-f=${n}]`) || {}).value || "";
      const text = joinAmount({ amount: get("amount"), unit: get("unit"), food: get("food") });
      if (el.dataset.alt !== undefined) row.subs[Number(el.dataset.alt)] = text;
      else row.text = text;
    },

    /** The line under an ingredient row that sums up its note and alternatives (wide layout). */
    _neRefreshSum(row) {
      const el = this.shadowRoot.querySelector(`.ne-wrow[data-uid="${row.uid}"] .ne-rsum`);
      if (el) el.textContent = [row.comment, ...row.subs.filter(Boolean).map((a) => `${T("or")} ${a}`)].filter(Boolean).join(" · ");
    },

    _neRefreshStatus() {
      this._form.rows.forEach((r) => {
        const el = this.shadowRoot.getElementById(`ne-st-${r.uid}`);
        if (!el || r.header) return;
        const [tone, text] = this._neStatus(r);
        el.className = `ne-status ${tone}`;
        el.textContent = text;
        const cv = this.shadowRoot.getElementById(`ne-cv-${r.uid}`);
        if (cv) cv.innerHTML = this._neConvHtml(r);
      });
    },

    _neRefreshStep(step) {
      const ch = this.shadowRoot.getElementById(`ne-ch-${step.uid}`);
      if (ch) ch.innerHTML = this._neChipsHtml(step);
    },

    _neAction(act, d) {
      const rows = this._form.rows;
      const steps = this._neSteps();
      const idx = (list, uid) => list.findIndex((x) => x.uid === uid);
      switch (act) {
        case "mode":
          return this._neChange(() => (this._neModeValue = d.mode));
        case "add-ing": {
          const row = this._rowFromString("");
          return this._neChange(() => rows.push(row), { uid: row.uid, f: "amount" });
        }
        case "convert":
          return this._neChange(() => this._neConvertRow(this._neRowByUid(d.uid)));
        case "convert-all":
          return this._neChange(() => rows.forEach((r) => this._neConvertRow(r)));
        case "add-ing-section": {
          const row = { uid: this._nextUid(), header: true, text: "", subs: [], comment: "" };
          return this._neChange(() => rows.push(row), { uid: row.uid, f: "title" });
        }
        case "add-alt": {
          const row = this._neRowByUid(d.uid);
          return row && this._neChange(() => {
            row.subs.push("");
            this._neSelIng = d.uid;
          }, { uid: d.uid, f: "amount", alt: row.subs.length });
        }
        case "add-note": {
          const row = this._neRowByUid(d.uid);
          return row && this._neChange(() => {
            row._note = true;
            this._neSelIng = d.uid;
          }, { uid: d.uid, f: "note" });
        }
        case "del-alt":
          return this._neChange(() => this._neRowByUid(d.uid).subs.splice(Number(d.alt), 1));
        case "del-ing":
          return this._neChange(() => {
            this._form.rows = rows.filter((r) => r.uid !== d.uid);
            steps.forEach((s) => (s.ingredients = s.ingredients.filter((u) => u !== d.uid)));
          });
        case "up-ing":
          return this._neChange(() => move(rows, idx(rows, d.uid), idx(rows, d.uid) - 1));
        case "down-ing":
          return this._neChange(() => move(rows, idx(rows, d.uid), idx(rows, d.uid) + 1));
        case "pick":
          return this._neSelect("step", d.uid);
        case "tick": {
          const step = this._neCurrent();
          if (!step) return;
          return this._neChange(() => {
            step.ingredients = step.ingredients.includes(d.ing) ? step.ingredients.filter((u) => u !== d.ing) : [...step.ingredients, d.ing];
          });
        }
        case "link": {
          const step = this._neStepByUid(d.uid);
          return step && this._neChange(() => step.ingredients.push(d.ing));
        }
        case "unlink": {
          const step = this._neStepByUid(d.uid);
          return step && this._neChange(() => (step.ingredients = step.ingredients.filter((u) => u !== d.ing)));
        }
        case "add-step": {
          const step = { uid: this._nextUid(), text: "", section: false, ingredients: [], timers: [] };
          return this._neChange(() => {
            steps.push(step);
            this._neCur = step.uid;
          }, { uid: step.uid, f: "stext" });
        }
        case "rename": {
          this._syncEditor();
          this._neRenaming = d.uid;
          return this._neChange(() => {}, { uid: d.uid, f: this._neRowByUid(d.uid) ? "title" : "stext" });
        }
        case "add-ing-in": {
          const row = this._rowFromString("");
          const at = idx(rows, d.uid);
          let end = at + 1;
          while (end < rows.length && !rows[end].header) end += 1;
          return this._neChange(() => rows.splice(end, 0, row), { uid: row.uid, f: "amount" });
        }
        case "fold": {
          this._syncEditor();
          this._neFolded = this._neFolded || new Set();
          if (!this._neFolded.delete(d.uid)) this._neFolded.add(d.uid);
          return this._render();
        }
        case "add-step-section": {
          const step = { uid: this._nextUid(), text: "", section: true, ingredients: [], timers: [] };
          return this._neChange(() => steps.push(step), { uid: step.uid, f: "stext" });
        }
        case "add-section-above": {
          const step = { uid: this._nextUid(), text: "", section: true, ingredients: [], timers: [] };
          return this._neChange(() => steps.splice(Math.max(idx(steps, d.uid), 0), 0, step), { uid: step.uid, f: "stext" });
        }
        case "del-step":
          return this._neChange(() => (this._form.steps = steps.filter((s) => s.uid !== d.uid)));
        case "up-step":
          return this._neChange(() => move(steps, idx(steps, d.uid), idx(steps, d.uid) - 1));
        case "down-step":
          return this._neChange(() => move(steps, idx(steps, d.uid), idx(steps, d.uid) + 1));
        case "add-timer": {
          const step = this._neStepByUid(d.uid);
          return step && this._neChange(() => {
            (step.timers = step.timers || []).push({ h: "", m: "", s: "", label: "" });
            this._neCur = step.uid;
          }, { uid: d.uid, f: "tm", n: (step.timers || []).length });
        }
        case "sug-timer": {
          const step = this._neStepByUid(d.uid);
          return step && this._neChange(() => (step.timers = step.timers || []).push({ h: "", m: String(d.minutes), s: "", label: "" }));
        }
        case "del-timer": {
          const step = this._neStepByUid(d.uid);
          return step && this._neChange(() => step.timers.splice(Number(d.n), 1));
        }
      }
    },

    _neApplyFocus() {
      const f = this._neFocus;
      this._neFocus = null;
      if (!f) return;
      const root = this.shadowRoot;
      const q = {
        amount: f.alt !== undefined ? `.ne-alt [data-uid="${f.uid}"][data-alt="${f.alt}"][data-f=amount]` : `[data-uid="${f.uid}"][data-f=amount]:not([data-alt])`,
        title: `[data-uid="${f.uid}"][data-f=title]`,
        note: `[data-uid="${f.uid}"][data-f=note]`,
        stext: `[data-uid="${f.uid}"][data-f=stext]`,
        tm: `[data-t=m][data-uid="${f.uid}"][data-n="${f.n}"]`,
      }[f.f];
      const el = q && root.querySelector(q);
      if (!el) return;
      // Home Assistant's inputs finish rendering a moment after they are added
      Promise.resolve(el.updateComplete).then(() => {
        if (!el.isConnected) return;
        el.focus();
        if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      });
    },

    _bindEditor(form) {
      // Home Assistant opens the command palette on "c", Assist on "a" and so on, unless the key is typed into
      // a text box it recognises: keep what is typed in the form to the form.
      form.addEventListener("keydown", (e) => {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
      });
      form.addEventListener("click", (e) => {
        // a click on an input, a menu or a button inside a step card is not "pick this step"
        const act = e.target.closest("[data-ne-act]");
        if (!act) return;
        if (act.dataset.neAct === "pick" && e.target.closest("ha-input, ha-textarea, ha-button, ha-dropdown, ha-icon-button, ha-assist-chip, ha-input-chip, .ne-timer, .ne-handle")) return;
        e.preventDefault();
        this._neAction(act.dataset.neAct, { ...act.dataset });
      });
      // the remove button of a chip
      form.addEventListener("remove", (e) => {
        const chip = e.target.closest && e.target.closest("ha-input-chip[data-unlink]");
        if (chip) this._neAction("unlink", { ...chip.dataset });
      });
      form.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches && e.target.matches(".ne-title")) this._neChange(() => {});
      });
      form.addEventListener("wa-select", (e) => {
        const dd = e.target.closest && e.target.closest("ha-dropdown[data-ne-menu]");
        const value = e.detail && e.detail.item && e.detail.item.value;
        if (!dd || !value) return;
        e.stopPropagation();
        this._neAction(value, { uid: dd.dataset.uid });
      });
      // a step is picked by typing in it too
      form.addEventListener("focusin", (e) => {
        const step = e.target.closest && e.target.closest(".ne-step:not(.ne-sect)");
        if (step) this._neSelect("step", step.dataset.uid);
        const ing = e.target.closest && e.target.closest(".ne-ing:not(.ne-isect)");
        if (ing) this._neSelect("ing", ing.dataset.uid);
      });
      form.addEventListener("click", (e) => {
        const ing = e.target.closest && e.target.closest(".ne-ing:not(.ne-isect)");
        if (ing) this._neSelect("ing", ing.dataset.uid);
      });
      form.addEventListener("input", (e) => {
        const el = e.target;
        const f = el.dataset && el.dataset.f;
        if (el.dataset && el.dataset.t !== undefined) {
          const step = this._neStepByUid(el.dataset.uid);
          if (step) {
            step.timers[Number(el.dataset.n)][el.dataset.t] = el.value;
            this._neRefreshStep(step);
          }
          return;
        }
        if (!f) return;
        if (f === "stext") {
          const step = this._neStepByUid(el.dataset.uid);
          if (step) {
            step.text = el.value;
            this._neRefreshStep(step);
          }
          return;
        }
        const row = this._neRowByUid(el.dataset.uid);
        if (!row) return;
        if (f === "title") row.text = el.value;
        else if (f === "note") row.comment = el.value;
        else {
          this._neSetAmount(el, row);
          this._neRefreshStatus();
        }
        if (f === "note" || el.dataset.alt !== undefined) this._neRefreshSum(row);
      });
      // pasting a list into an ingredient makes one ingredient per line
      form.addEventListener("paste", (e) => {
        const t = e.target;
        if (!(t.matches && t.matches(".ne-ing .ne-line [data-f=amount], .ne-ing .ne-line [data-f=unit], .ne-ing .ne-line [data-f=food]"))) return;
        const lines = (e.clipboardData || window.clipboardData).getData("text").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return;
        e.preventDefault();
        const uid = t.dataset.uid;
        this._neChange(() => {
          const i = this._form.rows.findIndex((r) => r.uid === uid);
          const blank = !String(this._form.rows[i].text).trim();
          this._form.rows.splice(blank ? i : i + 1, blank ? 1 : 0, ...lines.map((l) => this._rowFromString(l)));
        });
      });
      const panel = form.querySelector("#ne-ingpanel");
      if (panel) panel.addEventListener("expanded-changed", (e) => (this._neListOpen = !!e.detail.expanded));
      // dragging: Home Assistant's sortable tells where an item went
      const ings = form.querySelector("#ne-ings");
      if (ings)
        ings.addEventListener("item-moved", (e) =>
          this._neChange(() => {
            // the list also holds the "Add ingredient" button of each section: put the rows in the order the items are in
            const byUid = new Map(this._form.rows.map((r) => [r.uid, r]));
            const ids = reorder(this._neIds || [], (u) => !!(byUid.get(u) || {}).header, e.detail.oldIndex, e.detail.newIndex);
            this._form.rows = ids.map((u) => byUid.get(u)).filter(Boolean);
          })
        );
      const steps = form.querySelector("#ne-stepsort");
      if (steps)
        steps.addEventListener("item-moved", (e) =>
          this._neChange(() => {
            const list = this._neSteps();
            const byUid = new Map(list.map((s) => [s.uid, s]));
            const ids = reorder(list.map((s) => s.uid), (u) => !!(byUid.get(u) || {}).section, e.detail.oldIndex, e.detail.newIndex);
            this._form.steps = ids.map((u) => byUid.get(u));
          })
        );
      // while a section is dragged its items fold away, so that it is dragged as one block
      form.addEventListener("pointerdown", (e) => {
        const grip = e.target.closest && e.target.closest(".ne-isect > .ne-sline > .ne-handle, .ne-sect > .ne-handle");
        if (!grip) return;
        const card = grip.closest(".ne-isect, .ne-sect");
        const hidden = [];
        for (let n = card.nextElementSibling; n && !n.matches(".ne-isect, .ne-sect"); n = n.nextElementSibling) {
          if (!n.classList.contains("ne-hide")) {
            n.classList.add("ne-hide");
            hidden.push(n);
          }
        }
        const restore = () => hidden.forEach((n) => n.isConnected && n.classList.remove("ne-hide"));
        document.addEventListener("pointerup", () => setTimeout(restore, 0), { once: true });
        document.addEventListener("dragend", () => setTimeout(restore, 0), { once: true });
      });
    },

    /** Another step was picked: show which ingredients it has ticked. */
    _neRefreshTicks() {
      const cur = this._neCurrent();
      const title = this.shadowRoot.getElementById("ne-panetitle");
      if (title && !this._neSelIng) title.textContent = this._nePaneTitle(cur);
      this.shadowRoot.querySelectorAll(".ne-li").forEach((li) => {
        li.selected = !!cur && cur.ingredients.includes(li.dataset.ing);
      });
    },
  };
}
