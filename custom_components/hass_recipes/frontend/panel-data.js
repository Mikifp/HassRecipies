/* Recipes panel: data methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, T } = h;
  return {
    // ---- export / import / migrate ----
    /** Deleted recipes that can still be brought back. */
    async _loadTrash() {
      try {
        this._trash = (await this._ws({ type: "hass_recipes/trash" })).recipes;
      } catch (_) {
        this._trash = [];
      }
      if (this._view.name === "data") this._render();
    },
    async _restoreFromTrash(ids) {
      let restored = 0;
      for (const recipe_id of ids) {
        try {
          await this._ws({ type: "hass_recipes/restore", recipe_id });
          restored += 1;
        } catch (err) {
          this._error = err.message || String(err);
        }
      }
      await this._load();
      await this._loadTrash();
      if (restored) this._flash(restored === 1 ? "Recipe restored." : `Restored ${restored} recipes.`);
    },
    _trashHtml() {
      const items = this._trash || [];
      if (!items.length) return "";
      const when = (iso) => new Date(iso).toLocaleDateString(this._hass && this._hass.language, { day: "numeric", month: "short" });
      return `<ha-card class="data-card" header="${esc(T("Recently deleted"))}"><div class="card-content muted">${esc(T("Deleted recipes stay here for 30 days."))}</div>
          <ha-list-base>${items
            .map(
              (t) => `<ha-list-item-base headline="${esc(t.name || "")}" supporting-text="${esc(when(t.deleted_at))}">
                <ha-button slot="end" size="s" appearance="outlined" data-act="trash-restore" data-id="${esc(t.id)}">${esc(T("Restore"))}</ha-button></ha-list-item-base>`
            )
            .join("")}</ha-list-base>
          <div class="card-actions"><ha-button appearance="plain" variant="danger" data-act="trash-empty"><ha-icon slot="start" icon="mdi:delete-forever-outline"></ha-icon>${esc(T("Empty trash"))}</ha-button></div>
        </ha-card>`;
    },
    _dataHtml() {
      const m = this._dataMsg;
      const msg = m
        ? `<ha-alert alert-type="${m.kind === "error" ? "error" : m.kind === "ok" ? "success" : "info"}">${esc(m.text)}</ha-alert>`
        : "";
      return `
        <div class="data-page">
        <div><ha-button appearance="plain" data-act="back"><ha-icon slot="start" icon="mdi:arrow-left"></ha-icon>${esc(T("Back"))}</ha-button></div>
        ${msg}
        ${this._trashHtml()}
        <ha-card class="data-card" header="${esc(T("Export"))}">
          <div class="card-content muted">${esc(T("Download every recipe and cookbook, with uploaded photos embedded, as one JSON file. Keep it as a backup, or import it into another Home Assistant."))}</div>
          <div class="card-actions"><ha-button appearance="filled" data-act="export"><ha-icon slot="start" icon="mdi:download"></ha-icon>${esc(T("Download all recipes (JSON)"))}</ha-button></div>
        </ha-card>
        <ha-card class="data-card" header="${esc(T("Import a file"))}">
          <div class="card-content muted">${esc(T("Accepts a Recipes export, Mealie recipe JSON or export zip, a Paprika .paprikarecipes file, or schema.org recipe JSON. Recipes you already have (same name and source) are skipped."))}</div>
          <input id="import-file" type="file" accept=".json,.zip,.paprikarecipes,.gz,application/json,application/zip" hidden>
          <div class="card-actions"><ha-button appearance="filled" data-act="import-file-pick"><ha-icon slot="start" icon="mdi:upload"></ha-icon>${esc(T("Choose a file"))}</ha-button></div>
        </ha-card>
        <ha-card class="data-card" header="${esc(T("Migrate from a running Mealie"))}">
          <div class="card-content"><p class="muted">${esc(T("Pulls every recipe through Mealie's API. Create a token in Mealie under your profile → API tokens. The token is used once and not stored. Requires a Home Assistant administrator."))}</p>
            <ha-input id="mealie-url" appearance="outlined" type="url" label="${esc(T("Mealie URL"))}" placeholder="http://mealie.local:9925"></ha-input>
            <ha-input id="mealie-token" appearance="outlined" type="password" label="${esc(T("API token"))}" autocomplete="off"></ha-input></div>
          <div class="card-actions"><ha-button appearance="filled" id="mealie-btn" data-act="mealie-go">${esc(T("Migrate recipes"))}</ha-button></div>
        </ha-card>
        </div>`;
    },

    async _export() {
      this._dataMsg = { kind: "busy", text: "Preparing export…" };
      this._render();
      try {
        const resp = await this._hass.fetchWithAuth("/api/hass_recipes/export");
        if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
        const text = await resp.text();
        const doc = JSON.parse(text);
        const blob = new Blob([text], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `hass-recipes-${new Date().toISOString().slice(0, 10)}.json`;
        this.shadowRoot.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        this._dataMsg = {
          kind: "ok",
          text: `Exported ${doc.recipes.length} recipe(s) and ${doc.cookbooks.length} cookbook(s), including uploaded photos.`,
        };
      } catch (err) {
        this._dataMsg = { kind: "error", text: err.message || String(err) };
      }
      this._render();
    },

    async _uploadFile(file) {
      this._dataMsg = { kind: "busy", text: `Importing ${file.name}…` };
      this._render();
      try {
        const resp = await this._hass.fetchWithAuth("/api/hass_recipes/import", { method: "POST", body: file });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.message || `Upload failed (${resp.status})`);
        this._dataMsg = {
          kind: "ok",
          text: `Imported ${body.added} recipe(s), skipped ${body.skipped} already present${body.cookbooks ? `, added ${body.cookbooks} cookbook(s)` : ""}.`,
        };
        await this._load();
      } catch (err) {
        this._dataMsg = { kind: "error", text: err.message || String(err) };
      }
      this._render();
    },

    async _migrateMealie() {
      const root = this.shadowRoot;
      const url = String((root.getElementById("mealie-url") || {}).value || "").trim();
      const token = String((root.getElementById("mealie-token") || {}).value || "").trim();
      if (!url || !token) {
        this._dataMsg = { kind: "error", text: T("Enter the Mealie URL and an API token.") };
        return this._render();
      }
      this._dataMsg = { kind: "busy", text: "Reading recipes from Mealie — this can take a minute for large libraries…" };
      this._render();
      try {
        const res = await this._ws({
          type: "hass_recipes/migrate_mealie",
          url,
          token,
        });
        const failed = res.failed.length ? `, ${res.failed.length} failed (${res.failed.slice(0, 3).map((f) => f.slug).join(", ")}${res.failed.length > 3 ? ", …" : ""})` : "";
        this._dataMsg = {
          kind: res.failed.length ? "error" : "ok",
          text: `Mealie had ${res.found} recipe(s): imported ${res.added}, skipped ${res.skipped} already present${failed}.`,
        };
        await this._load();
      } catch (err) {
        this._dataMsg = { kind: "error", text: err.message || String(err) };
      }
      this._render();
    },

    _importHtml() {
      if (this._bulk) {
        const rows = this._bulk
          .map((r) =>
            r.ok
              ? `<li>✅ <a href="#" data-open-new="${esc(r.id)}">${esc(r.name)}</a> <span class="muted">${esc(r.url)}</span></li>`
              : `<li>❌ <span class="muted">${esc(r.url)}</span><br><span class="error">${esc(r.error)}</span></li>`
          )
          .join("");
        const ok = this._bulk.filter((r) => r.ok).length;
        return `
          <div class="panel">
            <h2>Import finished</h2>
            <p>${ok} of ${this._bulk.length} recipes imported.</p>
            <ul>${rows}</ul>
            <div class="actions"><button class="btn" data-act="back">Done</button></div>
          </div>`;
      }
      return `
        <ha-card class="data-card"><div class="card-content">
          <ha-formfield label="${esc(T("Include tags and categories"))}"><ha-switch id="import-tags" ${this._importTags ? "checked" : ""}></ha-switch></ha-formfield>
          <p class="muted">${esc(T("Off: imported recipes come without the tags and categories of the page."))}</p></div></ha-card>
        ${this._sitesHtml()}
        <ha-card class="data-card" header="${esc(T("Import from URL"))}">
          <div class="card-content"><p class="muted">${esc(T("Paste one URL to review it before saving, or several (one per line, up to 25) to import them all at once."))}</p>
            <ha-form id="import-urls-form"></ha-form></div>
          <div class="card-actions"><ha-button appearance="filled" id="import-btn" data-act="import-urls"><ha-icon slot="start" icon="mdi:download"></ha-icon>${esc(T("Import"))}</ha-button>
            <ha-button appearance="plain" data-act="cancel">${esc(T("Cancel"))}</ha-button></div>
        </ha-card>
        <ha-card class="data-card" header="${esc(T("Import from text"))}">
          <div class="card-content"><p class="muted">${esc(T("Paste a typed-up recipe, a video transcript (for example copied from YouTube), schema.org Recipe JSON, or a page's source (Ctrl+U in your browser, for sites that refuse automated requests with error 403). Recipes with Ingredients and Instructions headings are split at them; other text becomes steps, with amounts like \"200 g butter\" picked out as ingredients. Review the draft before saving."))}</p>
            <ha-form id="import-text-form"></ha-form>
            ${
              this._aiAvail
                ? `<ha-formfield label="${esc(T("Tidy with AI"))}"><ha-switch id="import-ai" ${this._importAi === false ? "" : "checked"}></ha-switch></ha-formfield>
                    <p class="muted">${esc(T("Uses the AI set up in Home Assistant (AI Task) to read the text. If it fails, the basic reading is used."))}</p>`
                : `<p class="muted">${esc(T("Set up an AI such as Google Gemini in Home Assistant to tidy imported text with AI."))}</p>`
            }</div>
          <div class="card-actions"><ha-button appearance="filled" id="import-html-btn" data-act="import-text"><ha-icon slot="start" icon="mdi:text-box-plus-outline"></ha-icon>${esc(T("Import"))}</ha-button></div>
        </ha-card>`;
    },

    /** The two import forms are Home Assistant's own form fields (the text boxes are the multi-line text selector). */
    _bindImport(root) {
      this._imp = this._imp || { urls: "", text: "", url: "" };
      const tagsSwitch = root.getElementById("import-tags");
      if (tagsSwitch) tagsSwitch.addEventListener("change", () => (this._importTags = !!tagsSwitch.checked));
      const make = (id, schema, labels) => {
        const form = root.getElementById(id);
        if (!form) return;
        form.hass = this._hass;
        form.schema = schema;
        form.data = this._imp;
        form.computeLabel = (sc) => T(labels[sc.name] || sc.name);
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          this._imp = { ...this._imp, ...(e.detail.value || {}) };
        });
      };
      make("import-urls-form", [{ name: "urls", selector: { text: { multiline: true } } }], { urls: "Recipe URLs" });
      make(
        "import-text-form",
        [
          { name: "text", selector: { text: { multiline: true } } },
          { name: "url", selector: { text: { type: "url" } } },
        ],
        { text: "Recipe text", url: "Recipe URL (optional, kept as the source)" }
      );
    },

    async _importHtml2() {
      const root = this.shadowRoot;
      const text = String((this._imp || {}).text || "");
      const textUrl = String((this._imp || {}).url || "").trim();
      if (!text.trim()) return;
      const btn = this.shadowRoot.getElementById("import-html-btn");
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        const sw = this.shadowRoot.getElementById("import-ai");
        const ai = !!(sw && sw.checked);
        if (sw) this._importAi = ai;
        if (ai) btn.textContent = T("Reading with AI…");
        this._draft = await this._ws({ type: "hass_recipes/import_text", text, url: textUrl, ai, include_tags: !!this._importTags });
        const aiError = this._draft.ai_error;
        this._go({ name: "edit" });
        if (aiError) {
          this._error = `${T("The AI could not tidy this, so the basic reading is shown.")} ${aiError}`;
          this._render();
        }
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    async _import() {
      const urls = String((this._imp || {}).urls || "").split(/\s+/).map((u) => u.trim()).filter(Boolean);
      if (!urls.length) return;
      const btn = this.shadowRoot.getElementById("import-btn");
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        if (urls.length === 1) {
          // Preview first so the user can review/tweak before saving.
          this._draft = await this._ws({ type: "hass_recipes/import_url", url: urls[0], include_tags: !!this._importTags });
          this._go({ name: "edit" });
        } else {
          const res = await this._ws({ type: "hass_recipes/import_urls", urls, include_tags: !!this._importTags });
          this._bulk = res.results;
          await this._load();
          this._render();
        }
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },
  };
}
