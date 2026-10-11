/* Recipes panel: the section-card editor ("new editor"). Mixed into the panel class by recipes-panel.js.
 *
 * It edits the very same this._form as the classic form (flat ingredient rows and steps), so the
 * two editors can be switched between without losing anything. Here the flat lists are shown as
 * sections: a section holds its ingredients and its steps together. Ingredients a step uses are
 * chips inside the step text; the saved text keeps the plain word, the link is stored as before.
 */
export default function (h) {
  const { esc, T } = h;
  const icon = (n) => `<ha-icon icon="mdi:${n}"></ha-icon>`;
  const norm = (t) => String(t ?? "").trim().toLowerCase();

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
  const foodWords = (text) => {
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

  /** What gets typed into the step text when an ingredient is picked. */
  const pickWord = (row) => foodWords(row.text)[0] || String(row.text).trim();

  /** A chip shows the ingredient exactly as it is written in the ingredient list. */
  const chipLabel = (row) => String(row.text).trim();

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return {
    // ---- mode ----
    _neOn() {
      if (this._editorMode === undefined) {
        try {
          this._editorMode = localStorage.getItem("hass_recipes_editor") === "new" ? "new" : "classic";
        } catch (_) {
          this._editorMode = "classic";
        }
      }
      return this._editorMode === "new";
    },

    _neToggle() {
      this._syncForm();
      this._editorMode = this._neOn() ? "classic" : "new";
      try {
        localStorage.setItem("hass_recipes_editor", this._editorMode);
      } catch (_) {
        /* the choice just is not remembered */
      }
      this._render();
    },

    // ---- flat lists <-> sections ----
    /** The flat rows and steps as sections: [{ title, rowHeader, stepHeader, rows, steps }]. */
    _neGroups() {
      const { rows, steps } = this._form;
      steps.forEach((s) => {
        if (!s.uid) s.uid = this._nextUid();
      });
      const R = [{ rowHeader: null, rows: [] }];
      for (const r of rows) {
        if (r.header) R.push({ rowHeader: r, rows: [] });
        else R[R.length - 1].rows.push(r);
      }
      const S = [{ stepHeader: null, steps: [] }];
      for (const s of steps) {
        if (s.section) S.push({ stepHeader: s, steps: [] });
        else S[S.length - 1].steps.push(s);
      }
      const Rh = R.slice(1);
      const Sh = S.slice(1);
      const pair = new Map();
      const used = new Set();
      // the same title is the same section; what is left is paired in order when it lines up
      for (const r of Rh) {
        const s = Sh.find((x) => !used.has(x) && norm(x.stepHeader.text) === norm(r.rowHeader.text));
        if (s) {
          used.add(s);
          pair.set(r, s);
        }
      }
      const loneR = Rh.filter((r) => !pair.has(r));
      const loneS = Sh.filter((s) => !used.has(s));
      if (loneR.length && loneR.length === loneS.length) loneR.forEach((r, i) => pair.set(r, loneS[i]));
      const paired = new Set(pair.values());
      const groups = [{ title: "", rowHeader: null, stepHeader: null, rows: R[0].rows, steps: S[0].steps }];
      for (const r of Rh) {
        const s = pair.get(r);
        groups.push({ title: r.rowHeader.text, rowHeader: r.rowHeader, stepHeader: s ? s.stepHeader : null, rows: r.rows, steps: s ? s.steps : [] });
      }
      for (const s of Sh) {
        if (!paired.has(s)) groups.push({ title: s.stepHeader.text, rowHeader: null, stepHeader: s.stepHeader, rows: [], steps: s.steps });
      }
      // both lists carry the same title, which is what keeps them one section
      for (const g of groups) if (g.rowHeader && g.stepHeader) g.stepHeader.text = g.rowHeader.text;
      groups.forEach((g, i) => {
        g.key = g.rowHeader ? g.rowHeader.uid : i === 0 ? "loose" : `s${i}`;
      });
      return groups;
    },

    /** Write the sections back as flat lists. */
    _neApply(groups) {
      const rows = [];
      const steps = [];
      groups.forEach((g, i) => {
        let title = String(g.title || "").trim();
        if (i > 0 || title) {
          if (!title) title = T("New section");
          g.title = title;
          g.rowHeader = g.rowHeader || { uid: this._nextUid(), header: true, text: "", subs: [], comment: "" };
          g.rowHeader.text = title;
          g.stepHeader = g.stepHeader || { uid: this._nextUid(), section: true, text: "", ingredients: [], timers: [] };
          g.stepHeader.text = title;
          rows.push(g.rowHeader);
          steps.push(g.stepHeader);
        } else {
          g.rowHeader = null;
          g.stepHeader = null;
        }
        rows.push(...g.rows);
        steps.push(...g.steps);
      });
      this._form.rows = rows;
      this._form.steps = steps;
    },

    // ---- text with ingredient chips ----
    /** Where each linked ingredient is named in the step text, found by its food word. */
    _neDetectChips(step, rowsByUid) {
      const chips = [];
      const taken = (a, b) => chips.some((c) => a < c.start + c.len && b > c.start);
      for (const uid of step.ingredients || []) {
        const row = rowsByUid.get(uid);
        if (!row) continue;
        // the first food word that is in the text: every mention of it is the ingredient.
        // "salt og peber" is that phrase, or else each of the two foods wherever it is named.
        const words = foodWords(row.text);
        const find = (word) => {
          // inflected forms count too: smør / smørret, æg / æggene
          const re = new RegExp(`(?<![\\p{L}])${escRe(word).replace(/ /g, "\\s+")}\\p{L}{0,4}(?![\\p{L}])`, "giu");
          const found = [];
          let m;
          while ((m = re.exec(step.text))) {
            if (!taken(m.index, m.index + m[0].length)) found.push({ uid, start: m.index, len: m[0].length });
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
      return chips.sort((a, b) => a.start - b.start);
    },

    _neChipHtml(row, word) {
      return `<span class="ne-chip" contenteditable="false" data-uid="${esc(row.uid)}" data-word="${esc(word)}">${esc(chipLabel(row))}</span>`;
    },

    _neTextHtml(step, rowsByUid) {
      let chips = step._chips && step._chipsText === step.text ? step._chips : null;
      if (!chips) {
        chips = this._neDetectChips(step, rowsByUid);
        step._chips = chips;
        step._chipsText = step.text;
      }
      chips = chips.filter((c) => rowsByUid.has(c.uid) && step.ingredients.includes(c.uid));
      step._chips = chips;
      let html = "";
      let at = 0;
      for (const c of chips) {
        if (c.start < at) continue;
        html += esc(step.text.slice(at, c.start));
        html += this._neChipHtml(rowsByUid.get(c.uid), step.text.slice(c.start, c.start + c.len));
        at = c.start + c.len;
      }
      return html + esc(step.text.slice(at));
    },

    /** Text, chip positions and extra links out of an editable step text. */
    _neSerialize(el) {
      let text = "";
      const chips = [];
      const walk = (node) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) text += n.nodeValue;
          else if (n.nodeType === 1) {
            if (n.classList.contains("ne-chip")) {
              const word = n.dataset.word || "";
              chips.push({ uid: n.dataset.uid, start: text.length, len: word.length });
              text += word;
            } else if (n.tagName === "BR") text += "\n";
            else walk(n);
          }
        }
      };
      walk(el);
      return { text: text.replace(/ /g, " ").replace(/​/g, ""), chips };
    },

    // ---- rendering ----
    _neRowHtml(row) {
      return `<div class="ne-row" data-uid="${esc(row.uid)}">
          <button type="button" class="ne-handle" draggable="true" data-ne-drag="row" title="Drag to reorder" aria-label="Drag to reorder">${icon("drag-vertical")}</button>
          <input class="ne-qty" data-ne-f="text" placeholder="Ingredient, e.g. 200 g butter" value="${esc(row.text)}">
          <input class="ne-note" data-ne-f="comment" placeholder="Note" value="${esc(row.comment || "")}">
          <button type="button" class="ne-icon" data-ne-act="row-menu" data-uid="${esc(row.uid)}" title="More" aria-label="More">${icon("dots-vertical")}</button>
          ${(row.subs || [])
            .map(
              (sub, n) => `<div class="ne-sub-row"><input data-ne-f="sub" placeholder="Substitute with its own amount, e.g. 180 g coconut oil" value="${esc(sub)}">
                <button type="button" class="ne-icon" data-ne-act="sub-remove" data-uid="${esc(row.uid)}" data-i="${n}" title="Remove">${icon("close")}</button></div>`
            )
            .join("")}
        </div>`;
    },

    _neStepHtml(step, num, rowsByUid) {
      const textHtml = this._neTextHtml(step, rowsByUid);
      const extras = (step.ingredients || []).filter((uid) => {
        if (!rowsByUid.has(uid)) return false;
        const chips = step._chips && step._chipsText === step.text ? step._chips : [];
        return !chips.some((c) => c.uid === uid);
      });
      return `<div class="ne-step" data-uid="${esc(step.uid)}">
          <button type="button" class="ne-handle" draggable="true" data-ne-drag="step" title="Drag to reorder" aria-label="Drag to reorder">${icon("drag-vertical")}</button>
          <span class="ne-n">${num}</span>
          <div class="ne-main">
            <div class="ne-text" contenteditable="true" role="textbox" aria-multiline="true" data-ph="${esc(T("Describe what to do. Type @ to add an ingredient."))}">${textHtml}</div>
            ${
              extras.length || (step.timers || []).length
                ? `<div class="ne-extras">${extras
                    .map(
                      (uid) =>
                        `<span class="ne-chip ne-extra" data-uid="${esc(uid)}">${esc(chipLabel(rowsByUid.get(uid)))}<button type="button" data-ne-act="unlink" data-uid="${esc(uid)}" title="Remove" aria-label="Remove">${icon("close")}</button></span>`
                    )
                    .join("")}
                  ${(step.timers || [])
                    .map(
                      (t, ti) => `<span class="ne-timer">${icon("clock-outline")}
                      <input data-ne-f="th" type="number" min="0" step="1" placeholder="0" value="${esc(t.h)}" aria-label="Hours"><span>h</span>
                      <input data-ne-f="tm" type="number" min="0" step="1" placeholder="0" value="${esc(t.m)}" aria-label="Minutes"><span>min</span>
                      <input data-ne-f="ts" type="number" min="0" step="1" placeholder="0" value="${esc(t.s)}" aria-label="Seconds"><span>sec</span>
                      <input data-ne-f="tl" class="ne-tl" placeholder="Label, e.g. simmer" value="${esc(t.label)}" maxlength="60">
                      <button type="button" class="ne-icon" data-ne-act="timer-remove" data-uid="${esc(step.uid)}" data-i="${ti}" title="Remove this timer">${icon("close")}</button></span>`
                    )
                    .join("")}</div>`
                : ""
            }
            <div class="ne-pick" hidden></div>
          </div>
          <button type="button" class="ne-icon" data-ne-act="step-menu" data-uid="${esc(step.uid)}" title="More" aria-label="More">${icon("dots-vertical")}</button>
        </div>`;
    },

    _neCardHtml(g, gi, ctx) {
      const key = g.rowHeader ? g.rowHeader.uid : gi === 0 ? "loose" : `s${gi}`;
      g.key = key;
      const collapsed = this._neCollapsed && this._neCollapsed.has(key);
      const count = `${g.rows.filter((r) => r.text.trim()).length} ingredients · ${g.steps.length} steps`;
      let body = "";
      if (!collapsed) {
        body = `<div class="ne-body">
            <div class="ne-sub">Ingredients</div>
            <div class="ne-list" data-ne-list="row" data-gi="${gi}">${g.rows.map((r) => this._neRowHtml(r)).join("")}</div>
            <button type="button" class="ne-add" data-ne-act="row-add" data-gi="${gi}">${icon("plus")}Add ingredient</button>
            <div class="ne-sub">Steps</div>
            <div class="ne-list" data-ne-list="step" data-gi="${gi}">${g.steps.map((s) => this._neStepHtml(s, ++ctx.num, ctx.rowsByUid)).join("")}</div>
            <button type="button" class="ne-add" data-ne-act="step-add" data-gi="${gi}">${icon("plus")}Add step</button>
          </div>`;
      } else g.steps.forEach(() => ctx.num++);
      const movable = gi > 0 || g.title.trim();
      return `<div class="ne-card" data-gi="${gi}" data-key="${esc(key)}">
          <div class="ne-head">
            ${movable ? `<button type="button" class="ne-handle" draggable="true" data-ne-drag="group" title="Drag to reorder" aria-label="Drag to reorder">${icon("drag-vertical")}</button>` : ""}
            <button type="button" class="ne-icon" data-ne-act="group-toggle" data-gi="${gi}" aria-label="Expand or collapse">${icon(collapsed ? "chevron-right" : "chevron-down")}</button>
            <input class="ne-title" data-ne-f="title" placeholder="Section title (optional)" value="${esc(g.title)}">
            <span class="ne-count">${count}</span>
            <button type="button" class="ne-icon" data-ne-act="group-menu" data-gi="${gi}" title="More" aria-label="More">${icon("dots-vertical")}</button>
          </div>${body}</div>`;
    },

    _newEditorHtml() {
      const groups = this._neGroups();
      this._neApply(groups); // headers that were only implied become real
      const fresh = this._neGroups();
      this._neCache = fresh;
      const ctx = { num: 0, rowsByUid: new Map(this._form.rows.map((r) => [r.uid, r])) };
      const hideLoose = fresh.length > 1 && !fresh[0].rows.length && !fresh[0].steps.length;
      return `<div class="ne" id="ne">
          ${fresh.map((g, gi) => (hideLoose && gi === 0 ? "" : this._neCardHtml(g, gi, ctx))).join("")}
          <button type="button" class="ne-add ne-add-section" data-ne-act="section-add">${icon("plus")}Add section</button>
        </div>`;
    },

    // ---- reading the page back into this._form ----
    _syncEditor() {
      const form = this.shadowRoot.getElementById("form");
      if (!form || !this._neCache) return;
      form.querySelectorAll(".ne-card").forEach((card) => {
        const g = this._neCache[Number(card.dataset.gi)];
        const input = card.querySelector("[data-ne-f=title]");
        if (g && input) g.title = input.value;
      });
      const rowByUid = new Map(this._form.rows.map((r) => [r.uid, r]));
      form.querySelectorAll(".ne-row").forEach((el) => {
        const r = rowByUid.get(el.dataset.uid);
        if (!r) return;
        r.text = el.querySelector("[data-ne-f=text]").value;
        r.comment = el.querySelector("[data-ne-f=comment]").value;
        r.subs = [...el.querySelectorAll("[data-ne-f=sub]")].map((i) => i.value);
      });
      const stepByUid = new Map(this._form.steps.map((s) => [s.uid, s]));
      form.querySelectorAll(".ne-step").forEach((el) => {
        const s = stepByUid.get(el.dataset.uid);
        if (!s) return;
        const { text, chips } = this._neSerialize(el.querySelector(".ne-text"));
        const extras = [...el.querySelectorAll(".ne-extra")].map((x) => x.dataset.uid);
        s.text = text;
        s._chips = chips;
        s._chipsText = text;
        s.ingredients = [...new Set([...chips.map((c) => c.uid), ...extras])];
        s.timers = [...el.querySelectorAll(".ne-timer")].map((t) => ({
          h: t.querySelector("[data-ne-f=th]").value,
          m: t.querySelector("[data-ne-f=tm]").value,
          s: t.querySelector("[data-ne-f=ts]").value,
          label: t.querySelector("[data-ne-f=tl]").value,
        }));
      });
      this._neApply(this._neCache);
    },

    // ---- actions ----
    _neChange(mutate, focus = null) {
      this._syncEditor();
      const groups = this._neGroups();
      mutate(groups);
      this._neApply(groups);
      this._formDirty = true;
      this._neFocus = focus;
      this._render();
    },

    _neFind(groups, uid, kind) {
      for (const g of groups) {
        const list = kind === "row" ? g.rows : g.steps;
        const i = list.findIndex((x) => x.uid === uid);
        if (i >= 0) return { g, list, i };
      }
      return null;
    },

    _neRemoveRow(groups, uid) {
      const hit = this._neFind(groups, uid, "row");
      if (hit) hit.list.splice(hit.i, 1);
      for (const g of groups) for (const s of g.steps) s.ingredients = (s.ingredients || []).filter((u) => u !== uid);
    },

    _neAction(act, d, anchor) {
      const newRow = () => ({ uid: this._nextUid(), header: false, text: "", subs: [], comment: "" });
      const newStep = () => ({ uid: this._nextUid(), section: false, text: "", ingredients: [], timers: [] });
      const gi = Number(d.gi);
      switch (act) {
        case "row-menu":
          return this._neMenu(anchor, [
            { label: "Add substitute", act: "sub-add", data: { uid: d.uid } },
            { label: "Move up", act: "row-up", data: { uid: d.uid } },
            { label: "Move down", act: "row-down", data: { uid: d.uid } },
            { label: "Delete ingredient", act: "row-remove", data: { uid: d.uid }, danger: true },
          ]);
        case "step-menu": {
          const hit = this._neFind(this._neCache || [], d.uid, "step");
          const rows = hit ? hit.g.rows.filter((r) => r.text.trim()) : [];
          return this._neMenu(anchor, [
            ...rows.map((r) => ({ label: `${T("Link")}: ${r.text.trim().slice(0, 40)}`, act: "link", data: { uid: d.uid, row: r.uid } })),
            { label: "Add timer", act: "timer-add", data: { uid: d.uid } },
            { label: "Insert step above", act: "step-above", data: { uid: d.uid } },
            { label: "Insert step below", act: "step-below", data: { uid: d.uid } },
            { label: "Move up", act: "step-up", data: { uid: d.uid } },
            { label: "Move down", act: "step-down", data: { uid: d.uid } },
            { label: "Delete step", act: "step-remove", data: { uid: d.uid }, danger: true },
          ]);
        }
        case "group-menu":
          return this._neMenu(anchor, [
            { label: "Move up", act: "group-up", data: { gi } },
            { label: "Move down", act: "group-down", data: { gi } },
            { label: "Delete section", act: "group-remove", data: { gi }, danger: true },
          ]);
        case "group-toggle": {
          this._syncEditor();
          const g = this._neCache[gi];
          if (!g) return;
          this._neCollapsed = this._neCollapsed || new Set();
          if (this._neCollapsed.has(g.key)) this._neCollapsed.delete(g.key);
          else this._neCollapsed.add(g.key);
          return this._render();
        }
        case "section-add":
          return this._neChange(
            (groups) => groups.push({ title: T("New section"), rowHeader: null, stepHeader: null, rows: [newRow()], steps: [newStep()] }),
            { key: null, last: true }
          );
        case "row-add": {
          const r = newRow();
          return this._neChange((groups) => groups[gi].rows.push(r), { uid: r.uid, field: "text" });
        }
        case "row-after": {
          const r = newRow();
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "row");
            if (hit) hit.list.splice(hit.i + 1, 0, r);
          }, { uid: r.uid, field: "text" });
        }
        case "row-remove":
          return this._neChange((groups) => this._neRemoveRow(groups, d.uid));
        case "row-up":
        case "row-down":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "row");
            if (!hit) return;
            const j = hit.i + (act === "row-up" ? -1 : 1);
            if (j >= 0 && j < hit.list.length) [hit.list[hit.i], hit.list[j]] = [hit.list[j], hit.list[hit.i]];
          });
        case "sub-add":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "row");
            if (hit) hit.list[hit.i].subs = [...(hit.list[hit.i].subs || []), ""];
          });
        case "sub-remove":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "row");
            if (hit) hit.list[hit.i].subs.splice(Number(d.i), 1);
          });
        case "step-add": {
          const s = newStep();
          return this._neChange((groups) => groups[gi].steps.push(s), { uid: s.uid, field: "text" });
        }
        case "step-above":
        case "step-below": {
          const s = newStep();
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (hit) hit.list.splice(hit.i + (act === "step-below" ? 1 : 0), 0, s);
          }, { uid: s.uid, field: "text" });
        }
        case "step-remove":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (hit) hit.list.splice(hit.i, 1);
          });
        case "step-up":
        case "step-down":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (!hit) return;
            const j = hit.i + (act === "step-up" ? -1 : 1);
            if (j >= 0 && j < hit.list.length) [hit.list[hit.i], hit.list[j]] = [hit.list[j], hit.list[hit.i]];
          });
        case "timer-add":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (hit) hit.list[hit.i].timers = [...(hit.list[hit.i].timers || []), { h: "", m: "", s: "", label: "" }];
          });
        case "timer-remove":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (hit) hit.list[hit.i].timers.splice(Number(d.i), 1);
          });
        case "link":
          return this._neChange((groups) => {
            const hit = this._neFind(groups, d.uid, "step");
            if (hit && !hit.list[hit.i].ingredients.includes(d.row)) hit.list[hit.i].ingredients.push(d.row);
          });
        case "unlink":
          return this._neChange((groups) => {
            for (const g of groups) for (const s of g.steps) if (s.uid === d.stepUid) s.ingredients = s.ingredients.filter((u) => u !== d.uid);
          });
        case "group-remove": {
          const g = (this._neCache || [])[gi];
          if (g && (g.rows.length || g.steps.length) && !confirm(T("Delete this section and everything in it?"))) return;
          return this._neChange((groups) => {
            const t = groups[gi];
            if (!t) return;
            for (const r of [...t.rows]) this._neRemoveRow(groups, r.uid);
            groups.splice(gi, 1);
            if (!groups.length) groups.push({ title: "", rowHeader: null, stepHeader: null, rows: [], steps: [] });
          });
        }
        case "group-up":
        case "group-down":
          return this._neChange((groups) => {
            const j = gi + (act === "group-up" ? -1 : 1);
            if (j < 1 || j >= groups.length || gi < 1) return;
            [groups[gi], groups[j]] = [groups[j], groups[gi]];
          });
        default:
      }
    },

    _neMenu(anchor, items) {
      this._neCloseMenu();
      const pop = document.createElement("div");
      pop.className = "ne-pop";
      pop.innerHTML = items
        .map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(T(it.label))}</button>`)
        .join("");
      const box = anchor.getBoundingClientRect();
      const host = this.getBoundingClientRect();
      pop.style.top = `${box.bottom - host.top + this.scrollTop + 2}px`;
      pop.style.left = `${Math.max(8, box.right - host.left - 200)}px`;
      pop.addEventListener("mousedown", (e) => e.preventDefault());
      pop.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-i]");
        if (!b) return;
        const it = items[Number(b.dataset.i)];
        this._neCloseMenu();
        this._neAction(it.act, it.data || {}, anchor);
      });
      this.shadowRoot.appendChild(pop);
      this._nePop = pop;
    },

    _neCloseMenu() {
      if (this._nePop) this._nePop.remove();
      this._nePop = null;
    },

    _neApplyFocus() {
      const f = this._neFocus;
      this._neFocus = null;
      if (!f) return;
      const root = this.shadowRoot;
      let el = null;
      if (f.last) {
        const cards = root.querySelectorAll(".ne-card");
        el = cards.length ? cards[cards.length - 1].querySelector("[data-ne-f=title]") : null;
        if (el) el.select();
      } else if (f.uid) {
        el = root.querySelector(`.ne-row[data-uid="${f.uid}"] [data-ne-f=text]`) || root.querySelector(`.ne-step[data-uid="${f.uid}"] .ne-text`);
        if (el && el.classList.contains("ne-text")) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = root.getSelection ? root.getSelection() : document.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
      if (el) {
        el.focus();
        if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      }
    },

    // ---- the @ picker ----
    _neSelection() {
      return this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : document.getSelection();
    },

    _neUpdatePicker(textEl) {
      const box = textEl.parentElement.querySelector(".ne-pick");
      const close = () => {
        box.hidden = true;
        this._nePick = null;
      };
      const sel = this._neSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return close();
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3 || !textEl.contains(node)) return close();
      const before = node.nodeValue.slice(0, range.startOffset);
      const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
      if (!m) return close();
      const query = m[2];
      const card = textEl.closest(".ne-card");
      const g = this._neCache[Number(card.dataset.gi)];
      const step = textEl.closest(".ne-step");
      const linked = new Set([...step.querySelectorAll(".ne-chip")].map((c) => c.dataset.uid));
      // read what is typed so the list matches the rows as they are now
      const rowEls = new Map([...card.querySelectorAll(".ne-row")].map((el) => [el.dataset.uid, el.querySelector("[data-ne-f=text]").value]));
      const options = g.rows
        .map((r) => ({ row: r, text: rowEls.has(r.uid) ? rowEls.get(r.uid) : r.text }))
        .filter((o) => o.text.trim() && (!query || norm(o.text).includes(norm(query))))
        .sort((a, b) => Number(linked.has(a.row.uid)) - Number(linked.has(b.row.uid)));
      this._nePick = { textEl, node, start: range.startOffset - query.length - 1, end: range.startOffset, query, options, index: 0, gi: Number(card.dataset.gi) };
      this._neRenderPicker(box);
    },

    _neRenderPicker(box) {
      const p = this._nePick;
      const items = p.options.map(
        (o, i) => `<button type="button" data-i="${i}" class="${i === p.index ? "on" : ""}">${esc(o.text.trim())}</button>`
      );
      if (p.query) items.push(`<button type="button" data-new="1" class="${p.index === p.options.length ? "on" : ""}">${esc(T("New ingredient"))} “${esc(p.query)}”</button>`);
      if (!items.length) {
        box.hidden = true;
        return;
      }
      box.innerHTML = items.join("");
      box.hidden = false;
    },

    _nePickCurrent() {
      const p = this._nePick;
      if (!p) return false;
      if (p.index < p.options.length) this._neInsertChip(p.options[p.index].row, null);
      else if (p.query) this._neInsertChip(null, p.query);
      else return false;
      return true;
    },

    /** Replace the typed "@query" with a chip for an existing row, or for a new ingredient. */
    _neInsertChip(row, newText) {
      const p = this._nePick;
      if (!p) return;
      let target = row;
      if (!target) {
        target = { uid: this._nextUid(), header: false, text: newText, subs: [], comment: "" };
        this._neCache[p.gi].rows.push(target);
      }
      const word = row ? pickWord(row) : newText;
      const range = document.createRange();
      range.setStart(p.node, p.start);
      range.setEnd(p.node, p.end);
      range.deleteContents();
      const holder = document.createElement("span");
      holder.innerHTML = this._neChipHtml(target, word);
      const chip = holder.firstChild;
      const prev = p.node.nodeValue.slice(0, p.start);
      range.insertNode(chip);
      if (prev && !/\s$/.test(prev)) chip.before(document.createTextNode(" "));
      const space = document.createTextNode(" ");
      chip.after(space);
      const sel = this._neSelection();
      const caret = document.createRange();
      caret.setStart(space, 1);
      caret.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(caret);
      }
      const stepUid = p.textEl.closest(".ne-step").dataset.uid;
      this._nePick = null;
      this._formDirty = true;
      if (!row) {
        this._syncEditor();
        this._neFocus = { uid: target.uid, field: "text" };
        this._render();
      } else {
        p.textEl.parentElement.querySelector(".ne-pick").hidden = true;
        // the chip is part of the step now: keep the model in step with the page
        const s = this._form.steps.find((x) => x.uid === stepUid);
        if (s) {
          this._syncEditor();
        }
      }
    },

    // ---- events ----
    _bindEditor(form) {
      form.addEventListener("click", (e) => {
        const act = e.target.closest("[data-ne-act]");
        if (act) {
          e.preventDefault();
          const d = { ...act.dataset };
          if (act.dataset.neAct === "unlink") d.stepUid = act.closest(".ne-step").dataset.uid;
          this._neAction(act.dataset.neAct, d, act);
          return;
        }
        const pick = e.target.closest(".ne-pick button");
        if (pick && this._nePick) {
          if (pick.dataset.new) this._neInsertChip(null, this._nePick.query);
          else this._neInsertChip(this._nePick.options[Number(pick.dataset.i)].row, null);
          return;
        }
        this._neCloseMenu();
      });
      // keep the caret in the text when a picker option is pressed
      form.addEventListener("mousedown", (e) => {
        if (e.target.closest(".ne-pick")) e.preventDefault();
      });
      form.addEventListener("input", (e) => {
        if (e.target.classList && e.target.classList.contains("ne-text")) this._neUpdatePicker(e.target);
        // chips show the ingredient as it is written, so they follow edits to the ingredient
        if (e.target.matches && e.target.matches(".ne-row [data-ne-f=text]")) {
          const uid = e.target.closest(".ne-row").dataset.uid;
          form.querySelectorAll(`.ne-chip[data-uid="${uid}"]`).forEach((chip) => {
            const label = e.target.value.trim();
            if (chip.classList.contains("ne-extra")) chip.firstChild.nodeValue = label;
            else chip.textContent = label;
          });
        }
      });
      form.addEventListener("paste", (e) => {
        if (!(e.target.classList && e.target.classList.contains("ne-text"))) return;
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\s*\r?\n\s*/g, " ");
        document.execCommand("insertText", false, text);
      });
      form.addEventListener("keydown", (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains("ne-text")) {
          if (this._nePick && !t.parentElement.querySelector(".ne-pick").hidden) {
            const p = this._nePick;
            const total = p.options.length + (p.query ? 1 : 0);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              p.index = (p.index + (e.key === "ArrowDown" ? 1 : -1) + total) % total;
              this._neRenderPicker(t.parentElement.querySelector(".ne-pick"));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              if (this._nePickCurrent()) {
                e.preventDefault();
                return;
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              t.parentElement.querySelector(".ne-pick").hidden = true;
              this._nePick = null;
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            this._neAction("step-below", { uid: t.closest(".ne-step").dataset.uid });
          }
          return;
        }
        if (e.key === "Enter" && t.matches && t.matches(".ne-row [data-ne-f=text]")) {
          e.preventDefault();
          this._neAction("row-after", { uid: t.closest(".ne-row").dataset.uid });
        } else if (e.key === "Enter" && t.matches && t.matches("[data-ne-f=title]")) {
          e.preventDefault();
        }
      });
      form.addEventListener("focusout", (e) => {
        if (e.target.classList && e.target.classList.contains("ne-text")) {
          const box = e.target.parentElement.querySelector(".ne-pick");
          // a click on an option arrives after the blur, so let it through first
          setTimeout(() => {
            if (box && !box.matches(":hover")) box.hidden = true;
          }, 150);
        }
      });
      this._neBindDrag(form);
    },

    _neBindDrag(form) {
      let drag = null;
      const clear = () => form.querySelectorAll(".drop-before, .drop-after, .ne-dragging, .ne-drop").forEach((el) => el.classList.remove("drop-before", "drop-after", "ne-dragging", "ne-drop"));
      const unit = { row: ".ne-row", step: ".ne-step", group: ".ne-card" };
      const place = (e) => {
        if (!drag) return null;
        const el = e.target.closest && e.target.closest(unit[drag.kind]);
        if (el && el !== drag.el) {
          const box = el.getBoundingClientRect();
          return { el, uid: el.dataset.uid, gi: Number((el.closest(".ne-card") || el).dataset.gi), after: e.clientY > box.top + box.height / 2 };
        }
        if (drag.kind !== "group") {
          // an empty list (or the gap below the last item) of any section takes the item at its end
          const card = e.target.closest && e.target.closest(".ne-card");
          const list = card && card.querySelector(`[data-ne-list=${drag.kind}]`);
          if (list && !el) return { el: list, uid: null, gi: Number(card.dataset.gi), after: true, list: true };
        }
        return null;
      };
      form.addEventListener("dragstart", (e) => {
        const h2 = e.target.closest && e.target.closest("[data-ne-drag]");
        if (!h2) return;
        const kind = h2.dataset.neDrag;
        const el = h2.closest(unit[kind]);
        drag = { kind, el, uid: el.dataset.uid, gi: Number((el.closest(".ne-card") || el).dataset.gi) };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", kind);
        if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(el, 12, 12);
        el.classList.add("ne-dragging");
      });
      form.addEventListener("dragover", (e) => {
        const t = place(e);
        if (!t) return;
        e.preventDefault();
        form.querySelectorAll(".drop-before, .drop-after, .ne-drop").forEach((el) => el.classList.remove("drop-before", "drop-after", "ne-drop"));
        if (t.list) t.el.classList.add("ne-drop");
        else t.el.classList.add(t.after ? "drop-after" : "drop-before");
      });
      form.addEventListener("drop", (e) => {
        const t = place(e);
        if (!t) return;
        e.preventDefault();
        const d = drag;
        drag = null;
        clear();
        this._neChange((groups) => {
          if (d.kind === "group") {
            const from = groups.findIndex((g) => g.key === d.el.dataset.key);
            let to = t.gi + (t.after ? 1 : 0);
            if (from < 0) return;
            to = Math.max(to, 1);
            if (from < to) to -= 1;
            groups.splice(to, 0, groups.splice(from, 1)[0]);
            return;
          }
          const src = this._neFind(groups, d.uid, d.kind);
          if (!src) return;
          const [item] = src.list.splice(src.i, 1);
          const dest = groups[t.gi];
          if (!dest) return;
          const list = d.kind === "row" ? dest.rows : dest.steps;
          if (t.list || !t.uid) list.push(item);
          else {
            const at = list.findIndex((x) => x.uid === t.uid);
            list.splice(at < 0 ? list.length : at + (t.after ? 1 : 0), 0, item);
          }
        });
      });
      form.addEventListener("dragend", () => {
        drag = null;
        clear();
      });
    },
  };
}
