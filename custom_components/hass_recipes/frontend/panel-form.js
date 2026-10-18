/* Recipes panel: form methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, T, normStep, isHeader, headerText, splitSubs, joinSubs, fmtYield, lines, toInt } = h;
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

    /** Copy what is currently typed in the editor into this._form (the detail fields live in ha-form and are kept up to date as they change). */
    _syncForm() {
      if (!this._form) return;
      this._syncEditor();
    },

    /** this._form as the data of the detail ha-forms. */
    _formData() {
      const d = this._form;
      const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
      return {
        name: d.name,
        description: d.description,
        image: d.image,
        yield_amount: num(d.yield_amount),
        yield_unit: d.yield_unit,
        default_scale: num(d.default_scale),
        servings: d.servings,
        prep_time: num(d.prep_time),
        cook_time: num(d.cook_time),
        total_time: num(d.total_time),
        categories: this._multiValues(d.categories),
        tools: this._multiValues(d.tools),
        tags: this._multiValues(d.tags),
        notes: d.notes,
        source_url: d.source_url,
      };
    },

    _formSchema(part) {
      const text = (name, extra = {}) => ({ name, selector: { text: extra } });
      const num = (name, extra = {}) => ({ name, selector: { number: { min: 0, step: "any", mode: "box", ...extra } } });
      const pick = (name) => ({
        name,
        selector: { select: { multiple: true, custom_value: true, mode: "dropdown", options: [...new Set([...this._usedValues(name), ...this._multiValues(this._form[name])])] } },
      });
      if (part === "top") return [{ ...text("name"), required: true }];
      if (part === "bottom") return [text("notes", { multiline: true }), text("source_url", { type: "url" })];
      return [
        text("description", { multiline: true }),
        text("image", { type: "url" }),
        { type: "grid", name: "", schema: [num("yield_amount"), text("yield_unit")] },
        num("default_scale", { min: 0.1 }),
        { type: "grid", name: "", schema: [text("servings"), num("prep_time", { unit_of_measurement: "min" }), num("cook_time", { unit_of_measurement: "min" }), num("total_time", { unit_of_measurement: "min" })] },
        pick("categories"),
        pick("tools"),
        pick("tags"),
      ];
    },

    _formLabel(s) {
      const labels = {
        name: "Name",
        description: "Description",
        image: "Image URL, or upload a photo",
        yield_amount: "The ingredients make",
        yield_unit: "Unit, e.g. pancakes, cookies, buns",
        default_scale: "Open the recipe at (× the written amounts)",
        servings: "Servings",
        prep_time: "Prep (min)",
        cook_time: "Cook (min)",
        total_time: "Total (min)",
        categories: "Categories",
        tools: "Tools",
        tags: "Tags",
        notes: "Notes",
        source_url: "Source URL",
      };
      return T(labels[s.name] || s.name);
    },

    /** Give the detail ha-forms their schema and data, and keep this._form in step with them. */
    _bindFormHa(root) {
      root.querySelectorAll("ha-form[data-fpart]").forEach((f) => {
        const part = f.dataset.fpart;
        f.hass = this._hass;
        f.schema = this._formSchema(part);
        f.computeLabel = (s) => this._formLabel(s);
        f.computeHelper = (s) => (s.name === "default_scale" ? this._yieldPreview(this._form) : "");
        // each form owns only its own fields, so one cannot overwrite what another holds
        const keys = new Set(f.schema.flatMap((s) => (s.type === "grid" ? s.schema.map((x) => x.name) : [s.name])));
        const own = (data) => Object.fromEntries(Object.entries(data).filter(([k]) => keys.has(k)));
        f.data = own(this._formData());
        f.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          const v = own(e.detail.value || {});
          f.data = v;
          const d = this._form;
          for (const [k, val] of Object.entries(v)) {
            d[k] = Array.isArray(val) ? val.join(", ") : val == null ? "" : typeof val === "number" ? val : String(val);
          }
          this._formDirty = true;
        });
      });
      const meta = root.getElementById("ne-meta");
      if (meta) meta.addEventListener("expanded-changed", (e) => (this._neMetaOpen = !!e.detail.expanded));
    },

    _yieldPreview(d) {
      const scale = parseFloat(d.default_scale) || 1;
      const amount = parseFloat(d.yield_amount);
      if (amount > 0) return `= ${fmtYield(amount * scale)} ${String(d.yield_unit || "").trim()}`.trim();
      return scale !== 1 ? `= ${fmtYield(scale)}× the ingredients as written` : "";
    },

    _formHtml() {
      const d = this._form;
      const img = esc(d.image || "");
      this._fab = `<ha-button class="fab" size="l" data-act="save"><ha-icon slot="start" icon="mdi:content-save"></ha-icon>Save</ha-button>`;
      return `
        <form id="form" class="ne-page" data-id="${esc(this._view.id || "")}">
          <ha-card class="ne-meta-card">
            <div class="ne-meta-in">
              <ha-form data-fpart="top"></ha-form>
              <ha-expansion-panel id="ne-meta" left-chevron ${this._neMetaOpen || !this._view.id ? "expanded" : ""}>
                <div slot="header">${esc(T("Details: photo, times, servings, tags"))}</div>
                <div class="ne-photo">
                  ${d.image ? `<img class="img-preview" src="${img}" alt="">` : ""}
                  <div class="btns">
                    <ha-button appearance="outlined" size="s" data-act="image-pick" ${this._imgBusy ? "disabled" : ""}><ha-icon slot="start" icon="mdi:camera-outline"></ha-icon>${this._imgBusy ? "Uploading…" : "Upload photo"}</ha-button>
                    ${d.image ? `<ha-button appearance="plain" size="s" variant="danger" data-act="image-clear">Remove</ha-button>` : ""}
                    <input type="file" id="image-file" accept="image/*" hidden ${this._imgBusy ? "disabled" : ""}>
                  </div>
                </div>
                <ha-form data-fpart="meta"></ha-form>
              </ha-expansion-panel>
            </div>
          </ha-card>
          ${this._newEditorHtml()}
          <ha-card class="ne-meta-card"><div class="ne-meta-in"><ha-form data-fpart="bottom"></ha-form></div></ha-card>
        </form>`;
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
      if (!String(d.name || "").trim()) {
        this._error = T("Name is required.");
        this._render();
        return;
      }
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
        name: String(d.name).trim(),
        description: String(d.description || "").trim(),
        image: String(d.image || "").trim(),
        servings: String(d.servings).trim(),
        yield_amount: parseFloat(d.yield_amount) > 0 ? parseFloat(d.yield_amount) : null,
        yield_unit: String(d.yield_unit || "").trim(),
        default_scale: parseFloat(d.default_scale) > 0 ? parseFloat(d.default_scale) : 1,
        prep_time: toInt(d.prep_time),
        cook_time: toInt(d.cook_time),
        total_time: toInt(d.total_time),
        tags: this._multiValues(d.tags),
        categories: this._multiValues(d.categories),
        tools: this._multiValues(d.tools),
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
        notes: String(d.notes || "").trim(),
        source_url: String(d.source_url || "").trim(),
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
