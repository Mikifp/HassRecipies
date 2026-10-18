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

    // ---- the toolbar, filters and table are Home Assistant's own elements (ha-assist-chip, ha-dropdown,
    //      ha-input-search, ha-expansion-panel, ha-checkbox, ha-button and ha-data-table) ----
    _brModel() {
      const b = this._brPrefs();
      const q = this._search.trim().toLowerCase();
      const shown = this._brSorted(this._recipes.filter((r) => this._matches(r, this._sel, q)));
      const compact = this._brCompact();
      return {
        b,
        shown,
        groups: this._brGroups(shown),
        values: (kind) =>
          [...new Set(this._recipes.flatMap((r) => r[kind] || []))].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })),
        count: (kind, v) => this._recipes.filter((r) => (r[kind] || []).includes(v)).length,
        nFilters: this._sel.categories.size + this._sel.tools.size + this._sel.tags.size + (this._cookbookId ? 1 : 0),
        compact,
        paneOpen: !compact && this._brPaneOpen(),
      };
    },

    /**
     * ha-button-toggle-group (the calendar page's view buttons) is only loaded with the calendar. Creating a
     * calendar card through Home Assistant's card helpers loads it; until then the buttons are plain ha-buttons.
     */
    _brEnsureToggle() {
      if (this._brToggle) return;
      this._brToggle = "loading";
      (async () => {
        try {
          if (!customElements.get("ha-button-toggle-group") && window.loadCardHelpers) {
            const helpers = await window.loadCardHelpers();
            try {
              helpers.createCardElement({ type: "calendar", entities: [] });
            } catch (_) {
              /* the card refuses an empty config, but its module is loaded by then */
            }
          }
          await Promise.race([customElements.whenDefined("ha-button-toggle-group"), new Promise((_, no) => setTimeout(no, 6000))]);
          // the toggle takes SVG paths: read them from ha-icon, which resolves the mdi names
          const names = { cards: "view-module", rows: "view-agenda", list: "view-headline" };
          const holder = document.createElement("div");
          holder.hidden = true;
          this.shadowRoot.appendChild(holder);
          const icons = Object.entries(names).map(([view, name]) => {
            const el = document.createElement("ha-icon");
            el.setAttribute("icon", `mdi:${name}`);
            holder.appendChild(el);
            return [view, el];
          });
          const paths = {};
          for (let i = 0; i < 20 && Object.keys(paths).length < icons.length; i++) {
            await new Promise((r) => setTimeout(r, 150));
            for (const [view, el] of icons) if (el._path) paths[view] = el._path;
          }
          holder.remove();
          if (Object.keys(paths).length === icons.length) {
            this._brPaths = paths;
            this._brToggle = "ready";
            if (this._view && this._view.name === "list" && this._loaded) this._render();
          }
        } catch (_) {
          this._brToggle = "unavailable";
        }
      })();
    },

    _brActive() {
      return !!(this._cookbookId || this._search.trim() || Object.values(this._sel).some((set) => set.size));
    },

    /** A phone is narrow enough that the filters open as a dialog instead of a side pane. */
    _brCompact() {
      return (this.clientWidth || 1000) < 700;
    },

    _brChip(attrs, icon, label = "", trailing = "") {
      return `<ha-assist-chip ${attrs} ${label ? `label="${esc(label)}"` : ""}>${icon ? `<ha-icon slot="icon" icon="mdi:${icon}"></ha-icon>` : ""}${
        trailing ? `<ha-icon slot="trailing-icon" icon="mdi:${trailing}"></ha-icon>` : ""
      }</ha-assist-chip>`;
    },

    /** The filter sections, shared by the side pane and the phone dialog. */
    _brSections(values, count) {
      const b = this._brPrefs();
      this._fq = this._fq || {};
      const icons = { categories: "folder-outline", tools: "tools", tags: "tag-outline" };
      const sec = (id, title, inner) =>
        `<ha-expansion-panel class="fsec" data-sec="${id}" header="${esc(title)}" left-chevron ${b.secs.has(id) ? "expanded" : ""}>${inner}</ha-expansion-panel>`;
      const facet = (kind, label) => {
        const vals = values(kind);
        if (!vals.length) return "";
        const q = (this._fq[kind] || "").toLowerCase();
        const search = vals.length > 6 ? `<div class="fsearch"><ha-input-search appearance="outlined" data-fsearch="${kind}" placeholder="Search"></ha-input-search></div>` : "";
        return sec(
          kind,
          label,
          search +
            vals
              .map(
                (v) =>
                  `<div class="fit" data-fitem="${kind}" data-value="${esc(v)}" ${q && !v.toLowerCase().includes(q) ? "hidden" : ""}><ha-icon icon="mdi:${icons[kind]}"></ha-icon><span>${esc(v)}</span><em>${count(kind, v)}</em><ha-checkbox ${
                    this._sel[kind].has(v) ? "checked" : ""
                  }></ha-checkbox></div>`
              )
              .join("")
        );
      };
      const filtersOn = this._search.trim() || Object.values(this._sel).some((set) => set.size);
      const act = (name, label, extra = "") => `<ha-button appearance="plain" size="s" data-act="${name}" ${extra}>${label}</ha-button>`;
      const cookbookActions =
        this._canEdit === false
          ? ""
          : this._cookbookId
            ? `<div class="fact">${act("cookbook-update", "Save filters to this cookbook")}${act("cookbook-delete", "Delete cookbook", 'variant="danger"')}</div>`
            : filtersOn
              ? `<div class="fact">${act("cookbook-save", "Save current filters as cookbook")}</div>`
              : "";
      return (
        sec(
          "cookbooks",
          "Cookbooks",
          `<div class="fit cbk ${this._cookbookId ? "" : "on"}" data-cookbook=""><ha-icon icon="mdi:book-multiple-outline"></ha-icon><span>All recipes</span><em>${this._recipes.length}</em></div>` +
            this._cookbooks
              .map(
                (c) =>
                  `<div class="fit cbk ${c.id === this._cookbookId ? "on" : ""}" data-cookbook="${esc(c.id)}"><ha-icon icon="mdi:book-open-page-variant-outline"></ha-icon><span>${esc(c.name)}</span></div>`
              )
              .join("") +
            cookbookActions
        ) +
        facet("categories", "Categories") +
        facet("tools", "Tools") +
        facet("tags", "Tags")
      );
    },

    _brPane(m) {
      return `<aside class="fpane"><div class="fpane-in">
          <div class="fhead">${this._brChip('data-act="br-filters" active', "filter-variant", T("Filters"))}${
            this._brActive() ? `<ha-button appearance="plain" size="s" data-act="br-clear">Clear</ha-button>` : ""
          }</div>
          ${this._brSections(m.values, m.count)}
        </div></aside>`;
    },

    _brDialog(m) {
      return `<dialog class="fdlg" id="fdlg">
          <div class="dh"><button type="button" class="dclose" data-act="br-filters-close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button><b>Filters</b>${
            this._brActive() ? `<ha-button appearance="plain" size="s" data-act="br-clear">Clear</ha-button>` : ""
          }</div>
          <div class="dlgbody">${this._brSections(m.values, m.count)}</div>
          <div class="dfoot"><ha-button size="m" data-act="br-filters-close">Show ${m.shown.length} recipes</ha-button></div>
        </dialog>`;
    },

    _brToolbar(m) {
      const { b } = m;
      const item = (value, label, cur, extra = "") =>
        `<ha-dropdown-item value="${value}" ${cur === value ? "data-sel" : ""}>${extra}${esc(T(label))}</ha-dropdown-item>`;
      const groups = [["none", "No grouping"], ["category", "Category"], ["cookbook", "Cookbook"], ["tag", "Tag"], ["tool", "Tool"]];
      const sorts = [["name", "Name"], ["updated", "Last changed"], ["time", "Time"], ["servings", "Servings"]];
      const arrow = `<ha-icon slot="details" icon="mdi:arrow-${b.dir === "asc" ? "up" : "down"}"></ha-icon>`;
      const label = (list, cur) => (list.find(([v]) => v === cur) || list[0])[1];
      const view = (v, icon, title, first, last) =>
        `<ha-button size="s" appearance="${b.view === v ? "accent" : "filled"}" data-view="${v}" title="${title}" style="--ha-button-border-radius:${first ? "16px 0 0 16px" : last ? "0 16px 16px 0" : "0"}"><ha-icon slot="start" icon="mdi:${icon}"></ha-icon></ha-button>`;
      this._brEnsureToggle();
      const toggle =
        this._brToggle === "ready"
          ? `<ha-button-toggle-group id="br-view" size="s" no-wrap></ha-button-toggle-group>`
          : `<div class="vseg" role="group">${view("cards", "view-module", "Cards", true, false)}${view("rows", "view-agenda", "Rows", false, false)}${view("list", "view-headline", "List", false, true)}</div>`;
      return `<div class="btool">
          ${m.paneOpen ? "" : `<span class="chipwrap">${this._brChip(`data-act="br-filters" ${this._filterDlg ? "active" : ""}`, "filter-variant", T("Filters"))}${m.nFilters ? `<span class="bcount">${m.nFilters}</span>` : ""}</span>`}
          ${this._canEdit === false ? "" : this._brChip(`class="select-mode-chip" data-act="select" ${this._select ? "active" : ""}`, "format-list-checks")}
          ${m.compact ? "" : `<ha-input-search id="search" appearance="outlined" placeholder="Search ${this._recipes.length} recipes"></ha-input-search>`}
          <ha-dropdown id="br-group"><span slot="trigger">${this._brChip("", "", `${T("Group by")} ${T(label(groups, b.group))}`, "menu-down")}</span>${groups.map(([v, l]) => item(v, l, b.group)).join("")}</ha-dropdown>
          <ha-dropdown id="br-sort"><span slot="trigger">${this._brChip("", "", `${T("Sort by")} ${T(label(sorts, b.sort))}`, "menu-down")}</span>${sorts.map(([v, l]) => item(v, l, b.sort, v === b.sort ? arrow : "")).join("")}</ha-dropdown>
          ${toggle}
          <ha-dropdown id="br-more"><ha-icon-button slot="trigger" label="More"><ha-icon icon="mdi:dots-vertical"></ha-icon></ha-icon-button>
            ${this._canEdit === false ? "" : `<ha-dropdown-item value="import"><ha-icon slot="icon" icon="mdi:link-variant"></ha-icon>${esc(T("Import URL"))}</ha-dropdown-item>`}
            <ha-dropdown-item value="data"><ha-icon slot="icon" icon="mdi:swap-vertical"></ha-icon>${esc(T("Backup & migrate"))}</ha-dropdown-item></ha-dropdown>
        </div>`;
    },

    _brBulkBar(m) {
      if (!this._select) return "";
      return `<div class="bulkbar">
            <strong class="bcnt">${this._picked.size} selected</strong>
            <button class="btn secondary" data-bulk="all">Select all ${m.shown.length} shown</button>
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
          </div>`;
    },

    _brContentHtml(m) {
      const { b, shown, groups } = m;
      if (!shown.length) return `<div class="empty">${this._recipes.length ? "No recipes match." : "No recipes yet. Create one or import from a URL."}</div>`;
      if (b.view === "list") return `<div class="tblhost"></div>`;
      return groups
        .map((g) => {
          const closed = g.key && b.collapsed.has(g.key);
          const heading = g.key
            ? `<div class="bgh" data-group="${esc(g.key)}"><ha-icon icon="mdi:${closed ? "chevron-down" : "chevron-up"}"></ha-icon><ha-icon class="gi" icon="mdi:${g.icon}"></ha-icon><span>${esc(g.title)}</span><em>${g.items.length}</em></div>`
            : "";
          if (closed) return heading;
          return (
            heading +
            (b.view === "rows"
              ? `<div class="brows">${g.items.map((r) => this._brRow(r)).join("")}</div>`
              : `<div class="bgrid">${g.items.map((r) => this._brCard(r)).join("")}</div>`)
          );
        })
        .join("");
    },

    _listHtml() {
      const m = this._brModel();
      // ha-button size l: kept outside the page so it stays in the bottom corner
      this._fab = this._canEdit === false ? "" : `<ha-button class="fab ${this._brCompact() ? "above-tabs" : ""}" size="l" data-act="new-dialog"><ha-icon slot="start" icon="mdi:plus"></ha-icon>New recipe</ha-button>`;
      return `
        <div class="bshell ${m.paneOpen ? "with-pane" : ""}">
          ${m.paneOpen ? this._brPane(m) : ""}
          <div class="bmain">
            ${this._brToolbar(m)}
            ${this._brBulkBar(m)}
            <div class="bcontent ${m.b.view}">${this._brContentHtml(m)}</div>
          </div>
        </div>
        ${m.compact ? this._brDialog(m) : ""}
        ${this._newDlg ? this._brNewDialog() : ""}`;
    },

    /** "Create recipe": the same dialog Home Assistant shows for "Create automation". */
    _brNewDialog() {
      const item = (act, icon, headline, text) =>
        `<ha-list-item-base interactive data-act="${act}" headline="${esc(T(headline))}" supporting-text="${esc(T(text))}"><ha-icon slot="start" icon="mdi:${icon}"></ha-icon><ha-icon-next slot="end"></ha-icon-next></ha-list-item-base>`;
      return `<ha-adaptive-dialog id="newdlg" flexcontent header-title="${esc(T("New recipe"))}">
          <ha-list-base>
            ${item("new-manual", "pencil-outline", "Create new recipe", "Start with an empty recipe from scratch")}
            ${item("new-url", "link-variant", "Import from a URL", "Fetch a recipe from a web page")}
          </ha-list-base>
        </ha-adaptive-dialog>`;
    },

    /** Re-draw only the recipes (the search box keeps its focus). */
    _brRefresh() {
      const bc = this.shadowRoot.querySelector(".bcontent");
      if (!bc) return this._render();
      const m = this._brModel();
      bc.className = `bcontent ${m.b.view}`;
      bc.innerHTML = this._brContentHtml(m);
      this._brBindContent(bc, m, true);
    },

    _brThumb(row) {
      const d = document.createElement("div");
      d.style.cssText = "width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color)) center/cover no-repeat;color:var(--secondary-text-color)";
      if (row.image) d.style.backgroundImage = `url("${row.image.replace(/"/g, "%22")}")`;
      else d.innerHTML = '<ha-icon icon="mdi:silverware-fork-knife" style="--mdc-icon-size:20px"></ha-icon>';
      return d;
    },

    /** The list view is a real ha-data-table: the same header, rows and group headers as Home Assistant's own lists. */
    _brMountTable(host, m) {
      const { b, groups } = m;
      const t = document.createElement("ha-data-table");
      t.hass = this._hass;
      t.autoHeight = true;
      t.clickable = true;
      t.selectable = !!this._select;
      t.narrow = this._brCompact();
      t.id = "id";
      t.noDataText = T("No recipes match.");
      t.columns = {
        thumb: { title: "", type: "icon", showNarrow: true, template: (row) => this._brThumb(row) },
        name: { title: T("Name"), main: true, sortable: true, flex: 3 },
        category: { title: T("Category"), sortable: true, flex: 2 },
        tools: { title: T("Tools"), sortable: true, flex: 2 },
        time: { title: T("Time"), sortable: true, flex: 1, template: (row) => (row.time ? minutes(row.time) : "") },
        servings: { title: T("Servings"), sortable: true, flex: 1, template: (row) => (row.servings ? String(row.servings) : "") },
        updated: { title: "", hidden: true, sortable: true },
        grp: { title: "", hidden: true },
      };
      const data = [];
      groups.forEach((g, gi) => {
        for (const r of g.items) {
          data.push({
            id: `${r.id}~${gi}`,
            rid: r.id,
            name: r.name,
            image: r.image || "",
            category: (r.categories || []).join(", "),
            tools: (r.tools || []).join(", "),
            time: this._recipeTime(r),
            servings: parseFloat(r.servings) || 0,
            updated: String(r.updated_at || r.created_at || ""),
            grp: g.title,
          });
        }
      });
      t.data = data;
      t.sortColumn = b.sort;
      t.sortDirection = b.dir;
      if (b.group !== "none") {
        t.groupColumn = "grp";
        t.groupOrder = groups.map((g) => g.title);
        t.initialCollapsedGroups = groups.filter((g) => b.collapsed.has(g.key)).map((g) => g.title);
      }
      t.addEventListener("row-click", (e) => this._go({ name: "detail", id: String(e.detail.id).split("~")[0] }));
      t.addEventListener("sorting-changed", (e) => {
        const { column, direction } = e.detail;
        if (column === b.sort && direction === b.dir) return;
        b.sort = column;
        b.dir = direction;
        this._brSave();
        this._render();
      });
      t.addEventListener("collapsed-changed", (e) => {
        const titles = new Set(e.detail.value || []);
        for (const g of groups) {
          if (titles.has(g.title)) b.collapsed.add(g.key);
          else b.collapsed.delete(g.key);
        }
        this._brSave();
      });
      t.addEventListener("selection-changed", (e) => {
        this._picked = new Set((e.detail.value || []).map((id) => String(id).split("~")[0]));
        const n = this.shadowRoot.querySelector(".bcnt");
        if (n) n.textContent = `${this._picked.size} selected`;
      });
      host.appendChild(t);
      this._brTable = t;
      // Home Assistant's phone lists show no column header row (sorting is in the toolbar)
      if (t.narrow) {
        t.updateComplete.then(() => {
          const row = t.shadowRoot && t.shadowRoot.querySelector(".mdc-data-table__header-row");
          if (row) row.style.display = "none";
        });
      }
      if (this._select && this._picked.size) {
        try {
          t._checkedRows = data.filter((d) => this._picked.has(d.rid)).map((d) => d.id);
          t.requestUpdate();
        } catch (_) {
          /* the selection just starts empty */
        }
      }
    },

    _brBindContent(scope, m, rebind = false) {
      const on = (sel, ev, fn) => scope.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
      const b = this._brPrefs();
      // a full render binds [data-open] for the whole panel; only a partial refresh needs it here
      if (rebind) on("[data-open]", "click", (e) => this._go({ name: "detail", id: e.currentTarget.dataset.open }));
      on("[data-pick]", "click", (e) => {
        const id = e.currentTarget.dataset.pick;
        if (!this._picked.delete(id)) this._picked.add(id);
        this._render();
      });
      on("[data-edit]", "click", (e) => {
        e.stopPropagation();
        this._go({ name: "edit", id: e.currentTarget.dataset.edit });
      });
      on("[data-group]", "click", (e) => {
        const key = e.currentTarget.dataset.group;
        if (!b.collapsed.delete(key)) b.collapsed.add(key);
        this._brSave();
        this._render();
      });
      const host = scope.querySelector(".tblhost");
      if (host && m) this._brMountTable(host, m);
    },

    _bindBrowser(root, on) {
      const b = this._brPrefs();
      const m = this._brModel();
      const newDlg = root.getElementById("newdlg");
      if (newDlg) {
        newDlg.open = true;
        newDlg.addEventListener("closed", () => {
          if (this._newDlg) {
            this._newDlg = false;
            this._render();
          }
        });
      }
      const bc = root.querySelector(".bcontent");
      if (bc) this._brBindContent(bc, m);
      // the toolbar
      const search = root.getElementById("search");
      if (search) {
        search.value = this._search;
        search.addEventListener("input", () => {
          this._search = search.value || "";
          this._brRefresh();
        });
      }
      const menu = (id, fn) => {
        const dd = root.getElementById(id);
        if (!dd) return;
        dd.querySelectorAll("ha-dropdown-item[data-sel]").forEach((it) => (it.selected = true));
        dd.addEventListener("wa-select", (e) => fn(e.detail.item.value));
      };
      menu("br-group", (v) => {
        b.group = v;
        this._brSave();
        this._render();
      });
      menu("br-sort", (v) => {
        if (b.sort === v) b.dir = b.dir === "asc" ? "desc" : "asc";
        else {
          b.sort = v;
          b.dir = v === "updated" ? "desc" : "asc";
        }
        this._brSave();
        this._render();
      });
      menu("br-more", (v) => this._action(v));
      const tg = root.getElementById("br-view");
      if (tg) {
        const label = { cards: T("Cards"), rows: T("Rows"), list: T("List") };
        tg.buttons = ["cards", "rows", "list"].map((v) => ({ label: label[v], value: v, iconPath: this._brPaths[v] }));
        tg.active = b.view;
        tg.addEventListener("value-changed", (e) => {
          const v = e.detail && e.detail.value;
          if (!v || v === b.view) return;
          b.view = v;
          this._brSave();
          this._render();
        });
      }
      on("[data-view]", "click", (e) => {
        b.view = e.currentTarget.dataset.view;
        this._brSave();
        this._render();
      });
      // the filters
      // the checkbox reports its own change (a click on it also reaches the row, so the row ignores it)
      on("[data-fitem]", "click", (e) => {
        if (e.target.closest("ha-checkbox")) return;
        const { fitem, value } = e.currentTarget.dataset;
        const set = this._sel[fitem];
        if (!set.delete(value)) set.add(value);
        this._render();
      });
      on("[data-fitem] ha-checkbox", "change", (e) => {
        const { fitem, value } = e.currentTarget.closest("[data-fitem]").dataset;
        if (e.currentTarget.checked) this._sel[fitem].add(value);
        else this._sel[fitem].delete(value);
        this._render();
      });
      this._fq = this._fq || {};
      on("ha-input-search[data-fsearch]", "input", (e) => {
        const kind = e.currentTarget.dataset.fsearch;
        const text = e.currentTarget.value || "";
        const q = text.trim().toLowerCase();
        this._fq[kind] = text;
        e.currentTarget.closest("ha-expansion-panel").querySelectorAll(".fit").forEach((it) => {
          it.hidden = !!q && !it.textContent.toLowerCase().includes(q);
        });
      });
      root.querySelectorAll("ha-input-search[data-fsearch]").forEach((el) => (el.value = this._fq[el.dataset.fsearch] || ""));
      on("ha-expansion-panel[data-sec]", "expanded-changed", (e) => {
        const id = e.currentTarget.dataset.sec;
        if (e.detail && e.detail.expanded) b.secs.add(id);
        else b.secs.delete(id);
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
      if (act === "all") {
        this._picked = new Set(shown.map((r) => r.id));
        if (this._brTable && this._brTable.isConnected) return this._brTable.selectAll();
      } else if (act === "none") {
        this._picked = new Set();
        if (this._brTable && this._brTable.isConnected) return this._brTable.clearSelection();
      }
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
