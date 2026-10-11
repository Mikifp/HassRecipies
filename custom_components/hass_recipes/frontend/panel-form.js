/* Recipes panel: form methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, normStep, isHeader, headerText, splitSubs, joinSubs, fmtYield, lines, toInt } = h;
  return {
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
    },

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
    },

    _nextUid() {
      this._uid += 1;
      return `u${this._uid}`;
    },

    /** Stored ingredient strings -> editor rows (heading / text + substitute). */
    _rowFromString(str) {
      if (isHeader(str)) return { uid: this._nextUid(), header: true, text: headerText(str), subs: [], comment: "" };
      const { main, alts, comment } = splitSubs(str);
      return { uid: this._nextUid(), header: false, text: main, subs: alts, comment };
    },

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
          timers: st.timers.map((t) => ({
            h: Math.floor(t.seconds / 3600) || "",
            m: Math.floor((t.seconds % 3600) / 60) || "",
            s: t.seconds % 60 || "",
            label: t.label || "",
          })),
        })),
      };
      // An imported draft has not been saved yet, so leaving it should ask first.
      this._formDirty = !id && !!this._draft;
    },

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
        subs: [...el.querySelectorAll("[data-f=isub]")].map((i) => i.value),
        comment: (el.querySelector("[data-f=icomment]") || { value: "" }).value,
      }));
      this._form.steps = [...form.querySelectorAll(".step")].map((el) => ({
        section: el.dataset.section === "1",
        text: el.querySelector("[data-f=text]").value,
        timers: [...el.querySelectorAll(".timer-row")].map((row) => ({
          h: row.querySelector("[data-f=th]").value,
          m: row.querySelector("[data-f=tm]").value,
          s: row.querySelector("[data-f=ts]").value,
          label: row.querySelector("[data-f=tl]").value,
        })),
        ingredients: [...el.querySelectorAll(".chip.active[data-uid]")].map((c) => c.dataset.uid),
      }));
    },

    _stepChips(step, rows) {
      let all = rows.filter((row) => !row.header && row.text.trim());
      if (!all.length) return `<span class="muted">Add ingredients above to link them to this step.</span>`;
      // Only the ingredients of the step's own section are offered: the ingredient section
      // with the same title as the step's section, or the loose ones above the first
      // ingredient section when the step has none. Without a match, everything is offered.
      const norm = (t) => String(t).trim().toLowerCase();
      const sectionOf = new Map();
      let current = "";
      let hasSections = false;
      for (const row of rows) {
        if (row.header) {
          current = norm(row.text);
          hasSections = true;
        } else sectionOf.set(row.uid, current);
      }
      if (hasSections) {
        let wanted = "";
        const list = (this._form && this._form.steps) || [];
        for (const other of list.slice(0, Math.max(list.indexOf(step), 0))) if (other.section) wanted = norm(other.text);
        const same = all.filter((row) => sectionOf.get(row.uid) === wanted || step.ingredients.includes(row.uid));
        if (same.length) all = same;
      }
      // An ingredient linked to another step is not offered again here, unless this step
      // already has it (older recipes may link one ingredient to several steps).
      const taken = new Set();
      for (const other of (this._form && this._form.steps) || []) {
        if (other !== step && !other.section) for (const uid of other.ingredients) taken.add(uid);
      }
      const items = all.filter((row) => !taken.has(row.uid) || step.ingredients.includes(row.uid));
      if (!items.length) return `<span class="muted">Every ingredient is already used in another step.</span>`;
      return items
        .map(
          (row) =>
            `<button type="button" class="chip ${step.ingredients.includes(row.uid) ? "active" : ""}" data-uid="${esc(row.uid)}">${esc(row.text)}</button>`
        )
        .join("");
    },

    _rowHtml(row) {
      const inputs = row.header
        ? `<input data-f="itext" placeholder="Section title, e.g. Dough" value="${esc(row.text)}">`
        : `<input data-f="itext" placeholder="e.g. 200 g butter" value="${esc(row.text)}">
           ${row.subs
             .map(
               (sub, n) => `<div class="sub-row"><input data-f="isub" placeholder="Substitute with its own amount, e.g. 180 g coconut oil" value="${esc(sub)}">
                 <button type="button" class="mini" data-row-act="sub-remove" data-uid="${esc(row.uid)}" data-i="${n}" title="Remove this substitute">✕</button></div>`
             )
             .join("")}
           <button type="button" class="mini link" data-row-act="sub" data-uid="${esc(row.uid)}">+ ${row.subs.length ? "another " : ""}substitute</button>
           <input data-f="icomment" class="ing-comment-input" placeholder="Note, e.g. room temperature" value="${esc(row.comment || "")}">`;
      return `<div class="ing-row ${row.header ? "is-header" : ""}" data-uid="${esc(row.uid)}" data-header="${row.header ? 1 : 0}">
        <button type="button" class="drag-handle" draggable="true" data-drag="row" title="Drag to reorder" aria-label="Drag to reorder">⠿</button>
        <div class="ing-inputs">${inputs}</div>
        <span class="row-btns">
          <button type="button" data-row-act="up" data-uid="${esc(row.uid)}" title="Move up">↑</button>
          <button type="button" data-row-act="down" data-uid="${esc(row.uid)}" title="Move down">↓</button>
          <button type="button" data-row-act="remove" data-uid="${esc(row.uid)}" title="Remove">✕</button>
        </span></div>`;
    },

    _yieldPreview(d) {
      const scale = parseFloat(d.default_scale) || 1;
      const amount = parseFloat(d.yield_amount);
      if (amount > 0) return `= ${fmtYield(amount * scale)} ${String(d.yield_unit || "").trim()}`.trim();
      return scale !== 1 ? `= ${fmtYield(scale)}× the ingredients as written` : "";
    },

    _formHtml() {
      const d = this._form;
      const f = (k) => esc(d[k] ?? "");
      let num = 0;
      const steps = d.steps
        .map((st, n) => {
          const head = (label) => `<div class="step-head"><button type="button" class="drag-handle" draggable="true" data-drag="step" title="Drag to reorder" aria-label="Drag to reorder">⠿</button><strong>${label}</strong><span class="spacer"></span>
              <button type="button" data-step-act="up" data-n="${n}" title="Move up">↑</button>
              <button type="button" data-step-act="down" data-n="${n}" title="Move down">↓</button>
              <button type="button" data-step-act="remove" data-n="${n}" title="Remove">✕</button></div>`;
          const bar = `<div class="insert-bar"><button type="button" class="mini link" data-step-act="insert" data-n="${n}">+ Step here</button><button type="button" class="mini link" data-step-act="insert-section" data-n="${n}">+ Section here</button></div>`;
          if (st.section) {
            return bar + `<div class="step is-section" data-n="${n}" data-section="1">${head("Section")}
              <input data-f="text" placeholder="Section title, e.g. Assembly" value="${esc(st.text)}"></div>`;
          }
          num += 1;
          return bar + `<div class="step" data-n="${n}" data-section="0">${head(`Step ${num}`)}
            <textarea data-f="text" data-autosize rows="2" placeholder="What to do…">${esc(st.text)}</textarea>
            <div class="timer-field"><label class="lbl">Timers (optional)</label>
              ${st.timers
                .map(
                  (t, ti) => `<div class="timer-row">
                    <input data-f="th" type="number" min="0" step="1" placeholder="0" value="${esc(t.h)}" aria-label="Hours"><span>h</span>
                    <input data-f="tm" type="number" min="0" step="1" placeholder="0" value="${esc(t.m)}" aria-label="Minutes"><span>min</span>
                    <input data-f="ts" type="number" min="0" step="1" placeholder="0" value="${esc(t.s)}" aria-label="Seconds"><span>sec</span>
                    <input data-f="tl" class="timer-label" placeholder="Label, e.g. simmer" value="${esc(t.label)}" maxlength="60">
                    <button type="button" class="mini" data-step-act="remove-timer" data-n="${n}" data-t="${ti}" title="Remove this timer">✕</button></div>`
                )
                .join("")}
              <button type="button" class="mini link" data-step-act="add-timer" data-n="${n}">+ ${st.timers.length ? "another " : ""}timer</button></div>
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
            <div class="field"><label class="lbl">Description</label><textarea name="description" data-autosize rows="2">${f("description")}</textarea></div>
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
            <div class="field"><label class="lbl">Notes</label><textarea name="notes" data-autosize rows="2">${f("notes")}</textarea></div>
            <div class="field"><label class="lbl">Source URL</label><input name="source_url" value="${f("source_url")}"></div>
            <div class="actions">
              <button class="btn" type="submit">Save</button>
              <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
            </div>
          </form>
        </div>`;
    },

    /** Make a text box exactly as tall as its text. */
    _autosize(el) {
      if (!el || !el.isConnected) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    },

    _autosizeAll() {
      const boxes = this.shadowRoot.querySelectorAll("textarea[data-autosize]");
      if (!boxes.length) return;
      boxes.forEach((t) => this._autosize(t));
      // fonts and the final width settle a moment after the render
      requestAnimationFrame(() => this.shadowRoot.querySelectorAll("textarea[data-autosize]").forEach((t) => this._autosize(t)));
    },

    /** Typing in an ingredient row: keep the step chips' labels in step. */
    _refreshChips() {
      this._syncForm();
      const form = this.shadowRoot.getElementById("form");
      form.querySelectorAll(".step").forEach((el, n) => {
        const box = el.querySelector(".step-ings-edit");
        if (box) box.innerHTML = this._stepChips(this._form.steps[n], this._form.rows);
      });
    },

    _rowAction(act, uid, idx) {
      this._syncForm();
      const rows = this._form.rows;
      const at = rows.findIndex((r) => r.uid === uid);
      let focus = null;
      if (act === "add" || act === "add-section") {
        const row = { uid: this._nextUid(), header: act === "add-section", text: "", subs: [] };
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
        rows[at].subs.push("");
        focus = `${uid}:sub`;
      } else if (act === "sub-remove" && at >= 0) {
        rows[at].subs.splice(Number(idx), 1);
      }
      this._formDirty = true;
      this._focusUid = focus;
      this._render();
    },

    /** Drag the ⠿ handle of an ingredient row or a step to put it somewhere else (mouse; on touch use ↑ ↓). */
    _bindFormDrag(form) {
      let drag = null;
      const unitOf = (kind) => (kind === "row" ? ".ing-row" : ".step");
      const clear = () => form.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((el) => el.classList.remove("drop-before", "drop-after", "dragging"));
      const target = (e) => {
        if (!drag) return null;
        const el = e.target.closest && e.target.closest(unitOf(drag.kind));
        if (!el || el === drag.el) return null;
        const box = el.getBoundingClientRect();
        return { el, after: e.clientY > box.top + box.height / 2 };
      };
      form.addEventListener("dragstart", (e) => {
        const h = e.target.closest && e.target.closest("[data-drag]");
        if (!h) return;
        const kind = h.dataset.drag;
        const el = h.closest(unitOf(kind));
        drag = { kind, el };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", kind);
        if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(el, 12, 12);
        el.classList.add("dragging");
      });
      form.addEventListener("dragover", (e) => {
        const t = target(e);
        if (!t) return;
        e.preventDefault();
        form.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
        t.el.classList.add(t.after ? "drop-after" : "drop-before");
      });
      form.addEventListener("drop", (e) => {
        const t = target(e);
        if (!t) return;
        e.preventDefault();
        const { kind, el } = drag;
        drag = null;
        clear();
        this._syncForm();
        const list = kind === "row" ? this._form.rows : this._form.steps;
        const index = (node) => (kind === "row" ? list.findIndex((r) => r.uid === node.dataset.uid) : Number(node.dataset.n));
        const from = index(el);
        let to = index(t.el) + (t.after ? 1 : 0);
        if (from < 0 || to < 0) return;
        if (from < to) to -= 1;
        if (from !== to) {
          list.splice(to, 0, list.splice(from, 1)[0]);
          this._formDirty = true;
          this._render();
        }
      });
      form.addEventListener("dragend", () => {
        drag = null;
        clear();
      });
    },

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
    },

    _stepAction(act, n, t) {
      this._syncForm();
      const steps = this._form.steps;
      if (act === "add") steps.push({ text: "", ingredients: [], timers: [], section: false });
      else if (act === "add-section") steps.push({ text: "", ingredients: [], timers: [], section: true });
      else if (act === "insert" || act === "insert-section") {
        steps.splice(n, 0, { text: "", ingredients: [], timers: [], section: act === "insert-section" });
        this._focusStep = n;
      }
      else if (act === "add-timer" && steps[n]) steps[n].timers.push({ h: "", m: "", s: "", label: "" });
      else if (act === "remove-timer" && steps[n]) steps[n].timers.splice(Number(t), 1);
      else if (act === "remove") steps.splice(n, 1);
      else if (act === "up" && n > 0) [steps[n - 1], steps[n]] = [steps[n], steps[n - 1]];
      else if (act === "down" && n < steps.length - 1) [steps[n + 1], steps[n]] = [steps[n], steps[n + 1]];
      this._formDirty = true;
      this._render();
    },

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
        ingredients.push(row.header ? `## ${text}` : joinSubs(text, row.subs, row.comment || ""));
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
            if (st.section) return { text: st.text.trim(), ingredients: [], timer: null, timers: [], section: true };
            const timers = (st.timers || [])
              .map((t) => ({
                seconds: Math.round((parseFloat(t.h) || 0) * 3600 + (parseFloat(t.m) || 0) * 60 + (parseFloat(t.s) || 0)),
                label: String(t.label || "").trim(),
              }))
              .filter((t) => t.seconds > 0);
            return {
              text: st.text.trim(),
              ingredients: [...new Set(st.ingredients.map((u) => indexOf.get(u)).filter((i) => i !== undefined))].sort((x, y) => x - y),
              timer: timers.length ? timers[0].seconds : null,
              timers,
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
    },
  };
}
