/* Recipes panel: browse methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, minutes, T } = h;
  return {
    /** Does recipe `r` satisfy the facet selection `sel` and text query `q`? */
    _matches(r, sel, q) {
      for (const kind of ["categories", "tools", "tags"]) {
        const want = sel[kind];
        if (want.size && !(r[kind] || []).some((v) => want.has(v))) return false;
      }
      if (!q) return true;
      return [r.name, r.description, ...r.tags, ...(r.categories || []), ...(r.tools || []), ...r.ingredients]
        .join("\n")
        .toLowerCase()
        .includes(q);
    },

    _listHtml() {
      const q = this._search.trim().toLowerCase();
      const shown = this._recipes.filter((r) => this._matches(r, this._sel, q));
      const values = (kind) =>
        [...new Set(this._recipes.flatMap((r) => r[kind] || []))].sort((x, y) =>
          x.localeCompare(y, undefined, { sensitivity: "base" })
        );
      const FACETS = [["categories", "Categories"], ["tools", "Tools"], ["tags", "Tags"]];

      // Wide: left rail with cookbooks and checkbox filters.
      const rail = `<aside class="rail">
        <h4>Cookbooks</h4>
        <div class="rail-item ${this._cookbookId ? "" : "active"}" data-cookbook="">All recipes</div>
        ${this._cookbooks
          .map((c) => `<div class="rail-item ${c.id === this._cookbookId ? "active" : ""}" data-cookbook="${esc(c.id)}">${esc(c.name)}</div>`)
          .join("")}
        ${FACETS.map(([kind, label]) => {
          const vals = values(kind);
          if (!vals.length) return "";
          return `<h4>${label}</h4>${vals
            .map(
              (v) =>
                `<label><input type="checkbox" data-fcb="${kind}" data-value="${esc(v)}" ${this._sel[kind].has(v) ? "checked" : ""}> ${esc(v)}</label>`
            )
            .join("")}`;
        }).join("")}
      </aside>`;

      // Narrow: chips on top; the less common filters sit behind "More filters".
      const chipRow = (kind, label) => {
        const vals = values(kind);
        if (!vals.length) return "";
        return `<div class="chips"><span class="facet-label">${label}</span>${vals
          .map((v) => `<span class="chip ${this._sel[kind].has(v) ? "active" : ""}" data-facet="${kind}" data-value="${esc(v)}">${esc(v)}</span>`)
          .join("")}</div>`;
      };
      const activeExtra = this._sel.tools.size + this._sel.tags.size;
      const mfilters = `<div class="mfilters">
        <div class="chips"><span class="chip ${this._cookbookId ? "" : "active"}" data-cookbook="">All</span>
          ${this._cookbooks.map((c) => `<span class="chip ${c.id === this._cookbookId ? "active" : ""}" data-cookbook="${esc(c.id)}">${esc(c.name)}</span>`).join("")}</div>
        ${chipRow("categories", "Category")}
        ${chipRow("tools", "Tools") || chipRow("tags", "Tags") ? `<details ${activeExtra ? "open" : ""}><summary>More filters${activeExtra ? ` (${activeExtra})` : ""}</summary>${chipRow("tools", "Tools")}${chipRow("tags", "Tags")}</details>` : ""}
      </div>`;

      const filtersOn = q || Object.values(this._sel).some((set) => set.size);
      const cookbookActions = this._cookbookId
        ? `<div class="cookbook-actions">
            <button class="btn secondary" data-act="cookbook-update">Save filters to this cookbook</button>
            <button class="btn secondary" data-act="cookbook-delete">Delete cookbook</button></div>`
        : filtersOn
          ? `<div class="cookbook-actions"><button class="btn secondary" data-act="cookbook-save">📖 Save current filters as cookbook</button></div>`
          : "";

      const items = shown
        .map((r) => {
          const time = minutes(r.total_time || (r.prep_time || 0) + (r.cook_time || 0));
          const img = r.image ? `style="background-image:url('${esc(r.image)}')"` : "";
          const picked = this._picked.has(r.id);
          const attr = this._select ? `data-pick="${esc(r.id)}"` : `data-open="${esc(r.id)}"`;
          const cat = (r.categories || [])[0];
          return `<div class="item ${picked ? "picked" : ""}" ${attr}>
            ${this._select ? `<div class="pick">${picked ? "✓" : ""}</div>` : ""}
            <div class="thumb" ${img}>${r.image ? "" : "🍽️"}</div>
            <div class="body"><h3>${esc(r.name)}</h3>
              <div class="muted">${[time, r.servings && `Serves ${esc(r.servings)}`].filter(Boolean).join(" · ")}</div>
              ${cat ? `<span class="cat">${esc(cat)}</span>` : ""}</div>
            <span class="chev">›</span>
          </div>`;
        })
        .join("");

      const bulkbar = this._select
        ? `<div class="bulkbar">
            <strong>${this._picked.size} selected</strong>
            <button class="btn secondary" data-bulk="all">Select all ${shown.length} shown</button>
            <button class="btn secondary" data-bulk="none">Clear</button>
            <select id="bulk-field">
              ${[["categories", "Category"], ["tags", "Tag"], ["tools", "Tool"]]
                .map(([v, l]) => `<option value="${v}" ${this._bulkField === v ? "selected" : ""}>${l}</option>`)
                .join("")}
            </select>
            <input id="bulk-value" list="bulk-values" placeholder="value" value="${esc(this._bulkValue)}" autocomplete="off">
            <datalist id="bulk-values">${this._usedValues(this._bulkField).map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>
            <button class="btn" data-bulk="add">Add</button>
            <button class="btn secondary" data-bulk="remove">Remove</button>
            <button class="btn danger" data-bulk="delete">Delete</button>
          </div>`
        : "";

      return `
        <div class="toolbar">
          <input id="search" type="search" placeholder="Search recipes, tags, ingredients…" value="${esc(this._search)}">
          <button class="btn" data-act="new" title="New recipe">+<span class="only-desk"> New</span></button>
          <button class="btn secondary only-desk" data-act="plan">Meal plan</button>
          <button class="btn secondary only-desk" data-act="import">Import URL</button>
          <button class="btn secondary only-desk ${this._select ? "active" : ""}" data-act="select">${this._select ? "Done selecting" : "Select"}</button>
          <button class="btn secondary only-desk" data-act="data" title="Export, import files, migrate from Mealie">⇅ Backup &amp; migrate</button>
        </div>
        <div class="only-mob" style="margin:-4px 0 10px">
          <details><summary class="muted" style="cursor:pointer">More actions</summary>
            <div class="actions" style="margin-top:8px">
              <button class="btn secondary" data-act="plan">Meal plan</button>
              <button class="btn secondary" data-act="import">Import URL</button>
              <button class="btn secondary" data-act="select">${this._select ? "Done selecting" : "Select"}</button>
              <button class="btn secondary" data-act="data">⇅ Backup &amp; migrate</button>
            </div></details>
        </div>
        ${bulkbar}
        <div class="browse">
          ${rail}
          <div style="min-width:0">
            ${mfilters}
            ${cookbookActions}
            ${shown.length ? `<div class="recipes">${items}</div>` : `<div class="empty">${this._recipes.length ? "No recipes match." : "No recipes yet. Create one or import from a URL."}</div>`}
          </div>
        </div>`;
    },

    // ---- categories / tools / tags: a checklist of what is in use, with "create" (like Mealie) ----
    _usedValues(kind) {
      const seen = new Map();
      for (const r of this._recipes) for (const v of r[kind] || []) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
      return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },

    _multiValues(text) {
      return String(text || "").split(",").map((t) => t.trim()).filter(Boolean);
    },

    _multiHtml(kind, label, singular, value) {
      return `<div class="multi" data-multi="${kind}" data-singular="${esc(singular)}">
        <label class="lbl">${label}</label>
        <input type="hidden" name="${kind}" value="${esc(value)}">
        <div class="multi-body"></div>
      </div>`;
    },

    _bindMulti(root) {
      root.querySelectorAll(".multi").forEach((box) => {
        const kind = box.dataset.multi;
        const singular = box.dataset.singular;
        const hidden = box.querySelector("input[type=hidden]");
        const body = box.querySelector(".multi-body");
        let filter = "";
        let open = false;
        const chosen = () => this._multiValues(hidden.value);
        const same = (a, b) => a.toLowerCase() === b.toLowerCase();
        const commit = (values) => {
          hidden.value = values.join(", ");
          this._formDirty = true;
          draw(true);
        };
        const toggle = (name) => {
          const values = chosen();
          const at = values.findIndex((v) => same(v, name));
          if (at >= 0) values.splice(at, 1);
          else values.push(name);
          commit(values);
        };
        const create = (raw) => {
          const name = String(raw || "").replace(/,/g, " ").trim();
          if (!name) return;
          const values = chosen();
          if (!values.some((v) => same(v, name))) {
            // reuse the spelling already in use, so "dessert" does not become a second category
            values.push(this._usedValues(kind).find((v) => same(v, name)) || name);
          }
          filter = "";
          commit(values);
        };
        const draw = (refocus) => {
          const values = chosen();
          const all = [...new Map([...this._usedValues(kind), ...values].map((v) => [v.toLowerCase(), v])).values()].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
          );
          const needle = filter.trim().toLowerCase();
          const shown = needle ? all.filter((v) => v.toLowerCase().includes(needle)) : all;
          const exact = all.some((v) => v.toLowerCase() === needle);
          const chips = values
            .map((v) => `<span class="chip active multi-chip">${esc(v)}<button type="button" class="multi-x" data-multi-remove="${esc(v)}" aria-label="Remove ${esc(v)}">✕</button></span>`)
            .join("");
          const rows = shown
            .map((v) => {
              const on = values.some((c) => same(c, v));
              return `<label class="multi-opt"><input type="checkbox" data-multi-opt="${esc(v)}" ${on ? "checked" : ""}><span>${esc(v)}</span></label>`;
            })
            .join("");
          body.innerHTML = `<div class="multi-field">${chips}<input type="text" class="multi-filter" data-multi-filter
              placeholder="${values.length ? "" : `Select or create a ${esc(singular)}…`}" value="${esc(filter)}" maxlength="60" autocomplete="off"></div>
            <div class="multi-menu" ${open ? "" : "hidden"}>
              ${rows || (needle ? "" : `<div class="muted multi-empty">No ${esc(kind)} yet. Type a name to create one.</div>`)}
              ${needle && !exact ? `<button type="button" class="multi-create" data-multi-create>＋ Create “${esc(filter.trim())}”</button>` : ""}
            </div>`;
          const input = body.querySelector("[data-multi-filter]");
          if (refocus) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
          const openMenu = () => {
            if (!open) {
              open = true;
              body.querySelector(".multi-menu").hidden = false;
            }
          };
          input.addEventListener("focus", openMenu);
          // anywhere in the field (not on a chip's x) opens the list and focuses the box
          body.querySelector(".multi-field").addEventListener("click", (e) => {
            if (e.target.closest("[data-multi-remove]")) return;
            openMenu();
            input.focus();
          });
          input.addEventListener("input", () => {
            filter = input.value;
            open = true;
            draw(true);
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              const text = filter.trim();
              if (!text) return;
              const matches = shown;
              // one match: tick it; otherwise create what was typed
              if (matches.length === 1 && matches[0].toLowerCase() === text.toLowerCase()) {
                const values = chosen();
                if (!values.some((v) => same(v, matches[0]))) {
                  filter = "";
                  commit([...values, matches[0]]);
                }
              } else create(text);
            } else if (e.key === "Escape") {
              open = false;
              draw(false);
              input.blur();
            } else if (e.key === "Backspace" && !input.value) {
              const values = chosen();
              if (values.length) {
                values.pop();
                commit(values);
              }
            }
          });
          body.querySelectorAll("[data-multi-opt]").forEach((cb) =>
            cb.addEventListener("change", () => {
              open = true;
              toggle(cb.dataset.multiOpt);
            })
          );
          body.querySelectorAll("[data-multi-remove]").forEach((b) =>
            b.addEventListener("click", () => {
              open = false;
              commit(chosen().filter((v) => v !== b.dataset.multiRemove));
            })
          );
          const make = body.querySelector("[data-multi-create]");
          if (make) make.addEventListener("click", () => create(filter));
        };
        draw(false);
        // clicking anywhere else closes the list
        const away = (e) => {
          if (!box.isConnected) return document.removeEventListener("pointerdown", away, true);
          if (open && !e.composedPath().includes(box)) {
            open = false;
            filter = "";
            draw(false);
          }
        };
        document.addEventListener("pointerdown", away, true);
      });
    },

    _applyCookbook(id) {
      const cb = this._cookbooks.find((c) => c.id === id);
      this._cookbookId = cb ? cb.id : null;
      this._sel = {
        categories: new Set(cb ? cb.categories : []),
        tools: new Set(cb ? cb.tools : []),
        tags: new Set(cb ? cb.tags : []),
      };
      this._search = cb ? cb.query || "" : "";
      this._render();
    },

    _currentFilters() {
      return {
        categories: [...this._sel.categories],
        tools: [...this._sel.tools],
        tags: [...this._sel.tags],
        query: this._search.trim(),
      };
    },

    async _cookbookAction(act) {
      try {
        if (act === "cookbook-save") {
          const name = (prompt(T("Name for this cookbook:")) || "").trim();
          if (!name) return;
          const cb = await this._ws({ type: "hass_recipes/cookbook_create", name, ...this._currentFilters() });
          this._cookbookId = cb.id;
        } else if (act === "cookbook-update") {
          await this._ws({ type: "hass_recipes/cookbook_update", cookbook_id: this._cookbookId, ...this._currentFilters() });
        } else if (act === "cookbook-delete") {
          if (!confirm(T("Delete this cookbook? The recipes are kept."))) return;
          await this._ws({ type: "hass_recipes/cookbook_delete", cookbook_id: this._cookbookId });
          this._cookbookId = null;
        }
        await this._load();
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    async _bulkAction(act) {
      const shown = this._recipes.filter((r) => this._matches(r, this._sel, this._search.trim().toLowerCase()));
      if (act === "all") this._picked = new Set(shown.map((r) => r.id));
      else if (act === "none") this._picked = new Set();
      else if (!this._picked.size) {
        this._error = "Select some recipes first.";
      } else {
        const ids = [...this._picked];
        try {
          if (act === "delete") {
            if (!confirm(T(`Delete ${ids.length} recipe(s)? This cannot be undone.`))) return;
            await this._ws({ type: "hass_recipes/bulk_delete", recipe_ids: ids });
            this._picked = new Set();
          } else {
            const value = this._bulkValue.trim();
            if (!value) {
              this._error = "Enter a value to add or remove.";
              return this._render();
            }
            await this._ws({
              type: "hass_recipes/bulk_update",
              recipe_ids: ids,
              [act]: { [this._bulkField]: [value] },
            });
          }
          this._error = "";
          await this._load();
          return;
        } catch (err) {
          this._error = err.message || String(err);
        }
      }
      this._render();
    },
  };
}
