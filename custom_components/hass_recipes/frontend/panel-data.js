/* Recipes panel: data methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc } = h;
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
      return `<div class="panel" style="margin-bottom:16px">
          <h2>Recently deleted</h2>
          <p class="muted">Deleted recipes stay here for 30 days.</p>
          ${items
            .map(
              (t) => `<div class="trash-row" style="display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--divider-color)">
                <span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(t.name || "")} <span class="muted">· ${esc(when(t.deleted_at))}</span></span>
                <button class="btn secondary" data-act="trash-restore" data-id="${esc(t.id)}">Restore</button></div>`
            )
            .join("")}
          <div class="actions"><button class="btn secondary danger" data-act="trash-empty">Empty trash</button></div>
        </div>`;
    },
    _dataHtml() {
      const m = this._dataMsg;
      const msg = m
        ? `<div class="${m.kind === "error" ? "error" : "muted"}" style="margin:12px 0;font-size:15px">${m.kind === "ok" ? "✅ " : m.kind === "busy" ? "⏳ " : "❌ "}${esc(m.text)}</div>`
        : "";
      return `
        <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
        ${msg}
        ${this._trashHtml()}
        <div class="panel" style="margin-bottom:16px">
          <h2>Export</h2>
          <p class="muted">Download every recipe and cookbook, with uploaded photos embedded, as one JSON file. Keep it as a backup, or import it into another Home Assistant.</p>
          <button class="btn" data-act="export">Download all recipes (JSON)</button>
        </div>
        <div class="panel" style="margin-bottom:16px">
          <h2>Import a file</h2>
          <p class="muted">Accepts a Recipes export, <strong>Mealie</strong> recipe JSON or export zip, a <strong>Paprika</strong> <code>.paprikarecipes</code> file, or schema.org recipe JSON. Recipes you already have (same name and source) are skipped.</p>
          <input id="import-file" type="file" accept=".json,.zip,.paprikarecipes,.gz,application/json,application/zip">
        </div>
        <div class="panel">
          <h2>Migrate from a running Mealie</h2>
          <p class="muted">Pulls every recipe through Mealie's API. Create a token in Mealie under <em>your profile → API tokens</em>. The token is used once and not stored. Requires a Home Assistant administrator.</p>
          <form id="mealie">
            <div class="field"><label class="lbl">Mealie URL</label><input name="url" type="url" required placeholder="http://mealie.local:9925"></div>
            <div class="field"><label class="lbl">API token</label><input name="token" type="password" required autocomplete="off"></div>
            <button class="btn" type="submit" id="mealie-btn">Migrate recipes</button>
          </form>
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

    async _migrateMealie(e, form) {
      e.preventDefault();
      const fd = new FormData(form);
      this._dataMsg = { kind: "busy", text: "Reading recipes from Mealie — this can take a minute for large libraries…" };
      this._render();
      try {
        const res = await this._ws({
          type: "hass_recipes/migrate_mealie",
          url: fd.get("url").trim(),
          token: fd.get("token").trim(),
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
        <div class="panel">
          <h2>Import from URL</h2>
          <p class="muted">Paste one URL to review it before saving, or several (one per line, up to 25) to import them all at once.</p>
          <form id="import">
            <div class="field"><textarea name="urls" data-autosize rows="3" required placeholder="https://…" autofocus></textarea></div>
            <div class="actions">
              <button class="btn" type="submit" id="import-btn">Import</button>
              <button class="btn secondary" type="button" data-act="cancel">Cancel</button>
            </div>
          </form>
        </div>`;
    },

    async _import(e, form) {
      e.preventDefault();
      const urls = new FormData(form).get("urls").split(/\s+/).map((u) => u.trim()).filter(Boolean);
      const btn = this.shadowRoot.getElementById("import-btn");
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        if (urls.length === 1) {
          // Preview first so the user can review/tweak before saving.
          this._draft = await this._ws({ type: "hass_recipes/import_url", url: urls[0] });
          this._go({ name: "edit" });
        } else {
          const res = await this._ws({ type: "hass_recipes/import_urls", urls });
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
