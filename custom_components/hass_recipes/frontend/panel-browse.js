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

    // ---- browser preferences (view, grouping, sorting, the filter pane) ----
    _brPrefs() {
      if (!this._br) {
        let saved = {};
        try {
          saved = JSON.parse(localStorage.getItem("hass_recipes_browser") || "{}");
        } catch (_) {
          saved = {};
        }
        this._br = {
          view: ["cards", "rows", "list"].includes(saved.view) ? saved.view : "cards",
          group: ["none", "category", "cookbook", "tag", "tool"].includes(saved.group) ? saved.group : "none",
          sort: ["name", "updated", "time", "servings"].includes(saved.sort) ? saved.sort : "name",
          dir: saved.dir === "desc" ? "desc" : "asc",
          // whether the filter pane is open, remembered separately for wide and narrow screens (null: open on wide only)
          pane: { wide: typeof saved.paneWide === "boolean" ? saved.paneWide : null, narrow: typeof saved.paneNarrow === "boolean" ? saved.paneNarrow : null },
          secs: new Set(Array.isArray(saved.secs) ? saved.secs : ["cookbooks", "categories"]),
          collapsed: new Set(Array.isArray(saved.collapsed) ? saved.collapsed : []),
        };
      }
      return this._br;
    },

    _brSave() {
      const b = this._brPrefs();
      try {
        localStorage.setItem(
          "hass_recipes_browser",
          JSON.stringify({ view: b.view, group: b.group, sort: b.sort, dir: b.dir, paneWide: b.pane.wide, paneNarrow: b.pane.narrow, secs: [...b.secs], collapsed: [...b.collapsed] })
        );
      } catch (_) {
        /* the choice just is not remembered */
      }
    },

    _brPaneOpen() {
      const b = this._brPrefs();
      const mine = this._narrow ? b.pane.narrow : b.pane.wide;
      return mine === null ? !this._narrow : mine;
    },

    _recipeTime(r) {
      return r.total_time || (r.prep_time || 0) + (r.cook_time || 0) || 0;
    },

    _brSorted(list) {
      const { sort, dir } = this._brPrefs();
      const sign = dir === "desc" ? -1 : 1;
      const by = {
        name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        updated: (a, b) => String(a.updated_at || a.created_at || "").localeCompare(String(b.updated_at || b.created_at || "")),
        time: (a, b) => (this._recipeTime(a) || 1e9) - (this._recipeTime(b) || 1e9),
        servings: (a, b) => (parseFloat(a.servings) || 1e9) - (parseFloat(b.servings) || 1e9),
      }[sort];
      return [...list].sort((a, b) => sign * by(a, b) || a.name.localeCompare(b.name));
    },

    /** The shown recipes as groups: [{ key, title, icon, items }]. A recipe is listed in every group it belongs to. */
    _brGroups(list) {
      const { group } = this._brPrefs();
      if (group === "none") return [{ key: "", title: "", icon: "", items: list }];
      const facet = { category: "categories", tool: "tools", tag: "tags" }[group];
      const none = { category: "No category", tool: "No tools", tag: "No tags", cookbook: "No cookbook" }[group];
      const icon = { category: "folder-outline", tool: "tools", tag: "tag-outline", cookbook: "book-open-page-variant-outline" }[group];
      const map = new Map();
      const add = (key, title, r) => {
        if (!map.has(key)) map.set(key, { key, title, icon, items: [] });
        map.get(key).items.push(r);
      };
      const unfiled = [];
      if (group === "cookbook") {
        for (const cb of this._cookbooks) {
          const sel = { categories: new Set(cb.categories), tools: new Set(cb.tools), tags: new Set(cb.tags) };
          map.set(cb.id, { key: cb.id, title: cb.name, icon, items: [] });
          for (const r of list) if (this._matches(r, sel, (cb.query || "").toLowerCase())) map.get(cb.id).items.push(r);
        }
        const inAny = new Set([...map.values()].flatMap((g) => g.items.map((r) => r.id)));
        for (const r of list) if (!inAny.has(r.id)) unfiled.push(r);
      } else {
        for (const r of list) {
          const values = r[facet] || [];
          if (!values.length) unfiled.push(r);
          for (const v of values) add(v.toLowerCase(), v, r);
        }
      }
      const groups = [...map.values()].filter((g) => g.items.length).sort((x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: "base" }));
      if (unfiled.length) groups.push({ key: "~none", title: none, icon: "help-circle-outline", items: unfiled });
      return groups;
    },

    _brImg(r) {
      return r.image ? `style="background-image:url('${esc(r.image)}')"` : "";
    },

    _brMeta(r) {
      const time = minutes(this._recipeTime(r));
      return [time, r.servings && `Serves ${esc(String(r.servings).replace(/\.0+$/, ""))}`].filter(Boolean).join(" · ");
    },

    _brCard(r) {
      const picked = this._picked.has(r.id);
      return `<div class="rcard${picked ? " picked" : ""}" ${this._select ? `data-pick="${esc(r.id)}"` : `data-open="${esc(r.id)}"`}>
          ${this._select ? `<div class="pick">${picked ? "✓" : ""}</div>` : ""}
          <div class="rpic" ${this._brImg(r)}>${r.image ? "" : `<ha-icon icon="mdi:silverware-fork-knife"></ha-icon>`}</div>
          <div class="rtx"><div class="rtitle"><b>${esc(r.name)}</b>${
            this._canEdit !== false && !this._select
              ? `<button type="button" class="rpen" data-edit="${esc(r.id)}" title="Edit" aria-label="Edit"><ha-icon icon="mdi:pencil"></ha-icon></button>`
              : ""
          }</div><span>${this._brMeta(r)}</span></div></div>`;
    },

    _brRow(r) {
      const picked = this._picked.has(r.id);
      const cat = (r.categories || [])[0];
      const n = (r.ingredients || []).filter((i) => !/^#{1,6}\s/.test(i)).length;
      return `<div class="rrow${picked ? " picked" : ""}" ${this._select ? `data-pick="${esc(r.id)}"` : `data-open="${esc(r.id)}"`}>
          ${this._select ? `<div class="pick">${picked ? "✓" : ""}</div>` : ""}
          <div class="rpic" ${this._brImg(r)}>${r.image ? "" : `<ha-icon icon="mdi:silverware-fork-knife"></ha-icon>`}</div>
          <div class="rtx"><b>${esc(r.name)}</b>
            ${r.description ? `<p>${esc(r.description)}</p>` : ""}
            <div class="rmeta">${cat ? `<span class="badge">${esc(cat)}</span>` : ""}<span>${this._brMeta(r)}</span>${n ? `<span>${n} ingredients</span>` : ""}</div></div>
          ${this._canEdit !== false && !this._select ? `<button type="button" class="rpen" data-edit="${esc(r.id)}" title="Edit" aria-label="Edit"><ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}</div>`;
    },

    _brTable(groups) {
      const { sort, dir, collapsed } = this._brPrefs();
      const arrow = (k) => (sort === k ? `<ha-icon class="sarrow" icon="mdi:arrow-${dir === "asc" ? "up" : "down"}"></ha-icon>` : "");
      const head = `<tr><th class="c-pic"></th><th data-sort="name">${arrow("name")}Name</th><th class="c-hide">Category</th><th class="c-hide">Tools</th><th data-sort="time">${arrow("time")}Time</th><th data-sort="servings" class="c-hide">${arrow("servings")}Servings</th></tr>`;
      const rowFor = (r) => {
        const picked = this._picked.has(r.id);
        return `<tr class="${picked ? "picked" : ""}" ${this._select ? `data-pick="${esc(r.id)}"` : `data-open="${esc(r.id)}"`}>
            <td class="c-pic"><div class="rpic mini-pic" ${this._brImg(r)}>${this._select ? (picked ? "✓" : "") : r.image ? "" : `<ha-icon icon="mdi:silverware-fork-knife"></ha-icon>`}</div></td>
            <td class="c-name">${esc(r.name)}</td><td class="c-hide">${esc((r.categories || []).join(", "))}</td><td class="c-hide">${esc((r.tools || []).join(", "))}</td>
            <td>${minutes(this._recipeTime(r))}</td><td class="c-hide">${esc(r.servings || "")}</td></tr>`;
      };
      const body = groups
        .map((g) => {
          const closed = g.key && collapsed.has(g.key);
          const gh = g.key
            ? `<tr class="grow" data-group="${esc(g.key)}"><td colspan="6"><ha-icon icon="mdi:chevron-${closed ? "right" : "down"}"></ha-icon>${esc(g.title)}<em>${g.items.length}</em></td></tr>`
            : "";
          return gh + (closed ? "" : g.items.map(rowFor).join(""));
        })
        .join("");
      return `<table class="rtable"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    },

    /** The filter sections, shared by the side pane and the phone dialog. */
    _brSections(values, count) {
      const b = this._brPrefs();
      const sec = (id, title, inner) =>
        `<details class="fsec" data-sec="${id}" ${b.secs.has(id) ? "open" : ""}><summary>${title}</summary>${inner}</details>`;
      const facet = (kind, label) => {
        const vals = values(kind);
        if (!vals.length) return "";
        return sec(
          kind,
          label,
          vals
            .map(
              (v) =>
                `<label class="fit"><input type="checkbox" data-fcb="${kind}" data-value="${esc(v)}" ${this._sel[kind].has(v) ? "checked" : ""}><span>${esc(v)}</span><em>${count(kind, v)}</em></label>`
            )
            .join("")
        );
      };
      const filtersOn = this._search.trim() || Object.values(this._sel).some((set) => set.size);
      const cookbookActions =
        this._canEdit === false
          ? ""
          : this._cookbookId
            ? `<div class="fact"><button class="tbtn" data-act="cookbook-update">Save filters to this cookbook</button><button class="tbtn danger" data-act="cookbook-delete">Delete cookbook</button></div>`
            : filtersOn
              ? `<div class="fact"><button class="tbtn" data-act="cookbook-save">Save current filters as cookbook</button></div>`
              : "";
      return (
        sec(
          "cookbooks",
          "Cookbooks",
          `<div class="fit cbk ${this._cookbookId ? "" : "on"}" data-cookbook=""><span>All recipes</span><em>${this._recipes.length}</em></div>` +
            this._cookbooks
              .map((c) => `<div class="fit cbk ${c.id === this._cookbookId ? "on" : ""}" data-cookbook="${esc(c.id)}"><span>${esc(c.name)}</span></div>`)
              .join("") +
            cookbookActions
        ) +
        facet("categories", "Categories") +
        facet("tools", "Tools") +
        facet("tags", "Tags")
      );
    },

    _brActive() {
      return !!(this._cookbookId || this._search.trim() || Object.values(this._sel).some((set) => set.size));
    },

    /** A phone is narrow enough that the filters open as a dialog instead of a side pane. */
    _brCompact() {
      return (this.clientWidth || 1000) < 700;
    },

    _brPane(values, count) {
      return `<aside class="fpane"><div class="fpane-in">
          <div class="fhead"><button type="button" class="bbtn on" data-act="br-filters"><ha-icon icon="mdi:filter-variant"></ha-icon><span class="lbl">Filters</span></button>${
            this._brActive() ? `<button type="button" class="tbtn" data-act="br-clear">Clear</button>` : ""
          }</div>
          ${this._brSections(values, count)}
        </div></aside>`;
    },

    _brDialog(values, count, shown) {
      return `<dialog class="fdlg" id="fdlg">
          <div class="dh"><button type="button" class="dclose" data-act="br-filters-close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button><b>Filters</b>${
            this._brActive() ? `<button type="button" class="tbtn" data-act="br-clear">Clear</button>` : ""
          }</div>
          <div class="dlgbody">${this._brSections(values, count)}</div>
          <div class="dfoot"><button type="button" class="btn" data-act="br-filters-close">Show ${shown} recipes</button></div>
        </dialog>`;
    },

    _listHtml() {
      const b = this._brPrefs();
      const q = this._search.trim().toLowerCase();
      const matched = this._recipes.filter((r) => this._matches(r, this._sel, q));
      const shown = this._brSorted(matched);
      const values = (kind) =>
        [...new Set(this._recipes.flatMap((r) => r[kind] || []))].sort((x, y) =>
          x.localeCompare(y, undefined, { sensitivity: "base" })
        );
      const count = (kind, v) => this._recipes.filter((r) => (r[kind] || []).includes(v)).length;
      const nFilters = this._sel.categories.size + this._sel.tools.size + this._sel.tags.size + (this._cookbookId ? 1 : 0);
      const compact = this._brCompact();
      const paneOpen = !compact && this._brPaneOpen();
      const groups = this._brGroups(shown);

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

      const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
      const viewBtn = (v, icon, title) =>
        `<button type="button" class="vbtn ${b.view === v ? "on" : ""}" data-view="${v}" title="${title}" aria-label="${title}"><ha-icon icon="mdi:${icon}"></ha-icon></button>`;
      const toolbar = `<div class="btool">
          ${paneOpen ? "" : `<button type="button" class="bbtn ${this._filterDlg ? "on" : ""}" data-act="br-filters"><ha-icon icon="mdi:filter-variant"></ha-icon><span class="lbl">Filters</span>${nFilters ? `<span class="bcount">${nFilters}</span>` : ""}</button>`}
          ${this._canEdit === false ? "" : `<button type="button" class="bbtn ic ${this._select ? "on" : ""}" data-act="select" title="${this._select ? "Done selecting" : "Select"}" aria-label="Select"><ha-icon icon="mdi:format-list-checks"></ha-icon></button>`}
          <div class="bsearch"><ha-icon icon="mdi:magnify"></ha-icon><input id="search" type="search" placeholder="Search ${this._recipes.length} recipes" value="${esc(this._search)}"></div>
          <select id="br-group" class="bsel" title="Group by">${opt(
            [["none", "No grouping"], ["category", "Group by category"], ["cookbook", "Group by cookbook"], ["tag", "Group by tag"], ["tool", "Group by tool"]],
            b.group
          )}</select>
          <select id="br-sort" class="bsel" title="Sort by">${opt(
            [["name", "Sort by name"], ["updated", "Sort by last changed"], ["time", "Sort by time"], ["servings", "Sort by servings"]],
            b.sort
          )}</select>
          <button type="button" class="vbtn dir" data-act="br-dir" title="Sort direction" aria-label="Sort direction"><ha-icon icon="mdi:${b.dir === "asc" ? "sort-ascending" : "sort-descending"}"></ha-icon></button>
          <div class="vseg">${viewBtn("cards", "view-grid-outline", "Cards")}${viewBtn("rows", "view-agenda-outline", "Rows")}${viewBtn("list", "format-list-bulleted", "List")}</div>
          <details class="bmore"><summary aria-label="More"><ha-icon icon="mdi:dots-vertical"></ha-icon></summary>
            <div class="bmenu">
              ${this._canEdit === false ? "" : `<button type="button" data-act="import"><ha-icon icon="mdi:link-variant"></ha-icon>Import URL</button>`}
              <button type="button" data-act="data"><ha-icon icon="mdi:swap-vertical"></ha-icon>Backup &amp; migrate</button>
            </div></details>
        </div>`;

      const groupBlock = (g) => {
        const closed = g.key && b.collapsed.has(g.key);
        const heading = g.key
          ? `<div class="bgh" data-group="${esc(g.key)}"><ha-icon icon="mdi:${closed ? "chevron-right" : "chevron-down"}"></ha-icon><ha-icon class="gi" icon="mdi:${g.icon}"></ha-icon><span>${esc(g.title)}</span><em>${g.items.length}</em></div>`
          : "";
        if (closed) return heading;
        const body =
          b.view === "rows"
            ? `<div class="brows">${g.items.map((r) => this._brRow(r)).join("")}</div>`
            : `<div class="bgrid">${g.items.map((r) => this._brCard(r)).join("")}</div>`;
        return heading + body;
      };
      const content = !shown.length
        ? `<div class="empty">${this._recipes.length ? "No recipes match." : "No recipes yet. Create one or import from a URL."}</div>`
        : b.view === "list"
          ? this._brTable(groups)
          : groups.map(groupBlock).join("");

      return `
        <div class="bshell ${paneOpen ? "with-pane" : ""}">
          ${paneOpen ? this._brPane(values, count) : ""}
          <div class="bmain">
            ${toolbar}
            ${bulkbar}
            <div class="bcontent ${b.view}">${content}</div>
          </div>
        </div>
        ${this._canEdit === false ? "" : `<div class="fabwrap"><button type="button" class="fab" data-act="new"><ha-icon icon="mdi:plus"></ha-icon><span>New recipe</span></button></div>`}
        ${compact ? this._brDialog(values, count, shown.length) : ""}`;
    },

    _bindBrowser(root, on) {
      const b = this._brPrefs();
      on("[data-view]", "click", (e) => {
        b.view = e.currentTarget.dataset.view;
        this._brSave();
        this._render();
      });
      const group = root.getElementById("br-group");
      if (group)
        group.addEventListener("change", () => {
          b.group = group.value;
          this._brSave();
          this._render();
        });
      const sort = root.getElementById("br-sort");
      if (sort)
        sort.addEventListener("change", () => {
          b.sort = sort.value;
          this._brSave();
          this._render();
        });
      on("[data-sort]", "click", (e) => {
        const key = e.currentTarget.dataset.sort;
        if (b.sort === key) b.dir = b.dir === "asc" ? "desc" : "asc";
        else {
          b.sort = key;
          b.dir = "asc";
        }
        this._brSave();
        this._render();
      });
      on("[data-group]", "click", (e) => {
        const key = e.currentTarget.dataset.group;
        if (!b.collapsed.delete(key)) b.collapsed.add(key);
        this._brSave();
        this._render();
      });
      on("[data-edit]", "click", (e) => {
        e.stopPropagation();
        this._go({ name: "edit", id: e.currentTarget.dataset.edit });
      });
      on("details[data-sec]", "toggle", (e) => {
        const d = e.currentTarget;
        if (d.open) b.secs.add(d.dataset.sec);
        else b.secs.delete(d.dataset.sec);
        this._brSave();
      });
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
            this._pendingUndo = ids;
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
          if (this._pendingUndo) {
            const ids = this._pendingUndo;
            this._pendingUndo = null;
            this._flash(`Deleted ${ids.length} recipe(s).`, { label: "Undo", run: () => this._restoreFromTrash(ids) });
          }
          return;
        } catch (err) {
          this._error = err.message || String(err);
        }
      }
      this._render();
    },
  };
}
