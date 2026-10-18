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
      this._syncEditor();
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
      return `
        <div class="panel">
          <h2 class="form-title">${this._view.id ? "Edit recipe" : "New recipe"}</h2>
          <form id="form" data-id="${esc(this._view.id || "")}">
            <div class="field"><label class="lbl">Name</label><input name="name" required value="${f("name")}"></div>
            <details class="ne-meta" ${this._neMetaOpen || !this._view.id ? "open" : ""}><summary>Details: photo, times, servings, tags</summary>
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
            </details>
            ${this._newEditorHtml()}
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
