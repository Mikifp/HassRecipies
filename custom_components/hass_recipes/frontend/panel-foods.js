/* Recipes panel: the Foods page. Mixed into the panel class by recipes-panel.js.
 *
 * A food is one thing an ingredient line can be ("smør", "hakkede tomater"): a name, other names,
 * what a unit of it weighs, where it is in the shop and its nutrition. The page lists the foods
 * (Home Assistant's own data table), shows one in a pane (a page of its own on a phone), and lists
 * the ingredient names in recipes that are not a food yet, with a suggestion to accept.
 * The server (nutrition_store.py) keeps the foods and does the matching.
 */
export default function (h) {
  const { esc, T, state, fl } = h;
  const RECENT_KEY = "hass_recipes_recent_foods";
  const FORM = [
    ["kcal", "Energy (kcal)"],
    ["fat", "Fat"],
    ["sat_fat", "of which saturated fat"],
    ["carbs", "Carbohydrates"],
    ["sugars", "of which sugars"],
    ["fibre", "Dietary fibre"],
    ["protein", "Protein"],
    ["salt", "Salt"],
  ];
  const num = (v, digits = 0) =>
    v == null || Number.isNaN(v) ? "–" : new Intl.NumberFormat(state.language || "en", { maximumFractionDigits: digits }).format(v);
  const title = (key) => key.charAt(0).toUpperCase() + key.slice(1);
  const weightsText = (grams) =>
    Object.entries(grams || {})
      .map(([unit, g]) => `1 ${unit} = ${num(g, 1)} g`)
      .join(", ");
  const blank = () => ({ id: "", name: "", aliases: [], source: "none", frida_id: null, frida_name: "", usda_id: null, usda_name: "", values: {}, unit_rows: [], section: "", barcode: "", used_in: 0, recipes: [] });

  return {
    // ---- data ----
    _fdState() {
      return (this._fd = this._fd || { data: null, loading: false, q: "", filter: "all", draft: null, draftFor: null });
    },

    async _fdLoad() {
      const st = this._fdState();
      if (st.loading) return;
      st.loading = true;
      try {
        st.data = await this._ws({ type: "hass_recipes/foods" });
        st.error = "";
        // with no foods yet, what is there to do is to go through the names in recipes
        if (!st.touched && st.data.counts.foods === 0 && st.data.counts.review > 0) st.filter = "review";
      } catch (err) {
        st.error = err.message || String(err);
      }
      st.loading = false;
      if (this._view.name === "foods") this._render();
    },

    async _fdCall(msg) {
      try {
        const res = await this._ws(msg);
        this._error = "";
        return { ok: true, res };
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
        return { ok: false };
      }
    },

    _fdFood(id) {
      const st = this._fdState();
      return st.data && st.data.foods.find((f) => f.id === id);
    },

    _fdReview(id) {
      const st = this._fdState();
      const key = decodeURIComponent(String(id).slice(2));
      return st.data && st.data.review.find((r) => r.key === key);
    },

    /** The food being edited: a copy that follows the form until it is saved. */
    _fdDraft() {
      const st = this._fdState();
      const id = this._view.id;
      if (!id || id.startsWith("r~")) return null;
      if (st.draftFor !== id || !st.draft) {
        const food = id === "new" ? null : this._fdFood(id);
        if (id !== "new" && !food) return null;
        st.draft = food
          ? { ...food, aliases: [...food.aliases], values: { ...food.values }, unit_rows: Object.entries(food.unit_grams).map(([u, g]) => [u, g]) }
          : blank();
        st.draftFor = id;
      }
      return st.draft;
    },

    // ---- what a step can call an ingredient: every name of its food ----
    /** { name key: [all names of that food] }, loaded once and again after the foods change. */
    _foodNamesMap() {
      if (!this._fnames && !this._fnamesLoading) {
        this._fnamesLoading = true;
        this._ws({ type: "hass_recipes/foods_names" })
          .then((m) => (this._fnames = m))
          .catch(() => (this._fnames = {}))
          .then(() => {
            this._fnamesLoading = false;
            // a recipe that is being read shows its chips again; an editor is left as it is
            if (["detail", "cook"].includes(this._view.name) && Object.keys(this._fnames).length) this._render();
          });
      }
      return this._fnames || {};
    },

    _foodNamesForText(text) {
      return fl.namesForLine(this._foodNamesMap(), [...h.foodWords(text), text]);
    },

    /** The other names of the food that line `i` of recipe `r` is. */
    _foodNamesFor(r, i) {
      const p = (r.parsed_ingredients || [])[i];
      const own = p && p.food ? [p.food] : [];
      return fl.namesForLine(this._foodNamesMap(), [...own, ...h.foodWords(h.ingredientParts(r, i).main)]);
    },

    // ---- the list ----
    _fdRows() {
      const st = this._fdState();
      const d = st.data;
      if (!d) return [];
      const q = st.q.trim().toLowerCase();
      if (st.filter === "review") {
        return d.review
          .filter((r) => !q || r.key.includes(q) || (r.suggestion && r.suggestion.name.toLowerCase().includes(q)))
          .map((r) => ({
            id: `r~${encodeURIComponent(r.key)}`,
            name: r.name,
            sub: r.suggestion ? `${T(r.suggestion.confidence === "standard" ? "Suggested" : "Best guess")}: ${r.suggestion.name}` : T("No suggestion"),
            used: r.used_in,
            kcal: r.suggestion ? r.suggestion.kcal : null,
            weights: "",
          }));
      }
      return d.foods
        .filter((f) => (st.filter === "mine" ? f.source === "custom" : st.filter === "frida" ? f.source === "frida" : st.filter === "usda" ? f.source === "usda" : true))
        .filter((f) => !q || [f.name, ...f.aliases, f.frida_name, f.usda_name].some((x) => String(x).toLowerCase().includes(q)))
        .map((f) => ({
          id: f.id,
          name: f.name,
          sub: f.aliases.join(", "),
          used: f.used_in,
          kcal: f.values.kcal,
          weights: weightsText(f.unit_grams),
        }));
    },

    _fdMountTable(host) {
      const t = document.createElement("ha-data-table");
      t.hass = this._hass;
      t.autoHeight = true;
      t.clickable = true;
      t.selectable = this._canEdit !== false; // tick several rows to link them to one food, or to merge foods
      t.narrow = this._brCompact();
      t.id = "id";
      const st = this._fdState();
      // what was ticked stays ticked through a search and a refresh, for the rows that are still there
      const valid = st.data ? (st.filter === "review" ? st.data.review.map((r) => fl.reviewId(r.key)) : st.data.foods.map((f) => f.id)) : [];
      st.sel = fl.keepSelection(st.sel || new Set(), valid);
      t.noDataText = st.data ? T(st.filter === "review" ? "Every ingredient name is a food." : "No foods match.") : T("Loading…");
      t.columns = {
        name: {
          title: T("Food"),
          main: true,
          sortable: true,
          flex: 3,
          template: (row) => {
            const el = document.createElement("div");
            el.innerHTML = `<div>${esc(row.name)}</div>${row.sub ? `<div style="font-size:12px;color:var(--secondary-text-color)">${esc(row.sub)}</div>` : ""}`;
            return el;
          },
        },
        used: { title: T("Used in"), sortable: true, flex: 1, type: "numeric", template: (row) => (row.used ? `${row.used}` : "") },
        kcal: { title: "kcal / 100 g", sortable: true, flex: 1, type: "numeric", showNarrow: true, template: (row) => (row.kcal == null ? "" : num(row.kcal)) },
        weights: { title: T("Weights"), flex: 2, hidden: this._brCompact(), template: (row) => row.weights },
      };
      t.data = this._fdRows();
      t.sortColumn = "name";
      t.sortDirection = "asc";
      t.addEventListener("row-click", (e) => this._go({ name: "foods", id: String(e.detail.id) }, false, this._brCompact() ? undefined : "replace"));
      t.addEventListener("selection-changed", (e) => {
        // the table only knows the rows it shows: ticks on rows a search hides stay
        const visible = new Set(this._fdRows().map((r) => r.id));
        st.sel = new Set([...st.sel].filter((id) => !visible.has(id)).concat((e.detail.value || []).map(String)));
        this._fdPaintSel();
      });
      this._fdTable = t;
      host.appendChild(t);
      this._fdSyncTable();
      this._fdPaintSel();
      if (t.narrow)
        t.updateComplete.then(() => {
          const row = t.shadowRoot && t.shadowRoot.querySelector(".mdc-data-table__header-row");
          if (row) row.style.display = "none";
        });
    },

    /** Tick, in the table, the ticked rows that it shows. */
    _fdSyncTable() {
      const st = this._fdState();
      const t = this._fdTable;
      if (!t) return;
      t.updateComplete.then(() => {
        const visible = new Set(this._fdRows().map((r) => r.id));
        const ids = [...st.sel].filter((id) => visible.has(id));
        if (!ids.length) return;
        if (t.select) t.select(ids, true);
        else if (Array.isArray(t._checkedRows)) {
          // older Home Assistant versions have no select(): set what the table keeps itself
          t._checkedRows = ids;
          t.requestUpdate();
        }
      });
    },

    // ---- a new food from a barcode: Open Food Facts fills it in; a code it does not know starts an empty food with the code on it ----
    _fdScan() {
      if (this._barcodeCamera()) {
        this._barcodeScanner({ code: (raw) => this._fdBarcode(raw), close: () => {}, type: () => this._fdTypeCode(), fail: () => this._fdTypeCode() });
      } else this._fdTypeCode();
    },

    _fdTypeCode() {
      this._planDialog(T("Scan barcode"), `<ha-form id="fd-code"></ha-form><div class="muted">${esc(T("Products come from Open Food Facts (ODbL)."))}</div>`, (dlg, close) => {
        this._planFooter(dlg, { primary: { id: "fd-lookup", label: T("Look up"), icon: "magnify" }, secondary: [{ id: "fd-ccancel", label: T("Cancel") }] });
        let code = { code: "" };
        const form = dlg.querySelector("#fd-code");
        form.hass = this._hass;
        form.schema = [{ name: "code", selector: { text: {} } }];
        form.data = code;
        form.computeLabel = () => T("Barcode number");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          code = e.detail.value || code;
        });
        dlg.querySelector("#fd-ccancel").addEventListener("click", close);
        dlg.querySelector("#fd-lookup").addEventListener("click", () => {
          close();
          this._fdBarcode(String(code.code || ""));
        });
      });
    },

    async _fdBarcode(code) {
      const st = this._fdState();
      try {
        const food = await this._ws({ type: "hass_recipes/barcode", code: String(code) });
        this._error = "";
        await this._fdRefresh(food.id);
      } catch (err) {
        st.draft = { ...blank(), barcode: String(code).replace(/\D/g, ""), manual: true };
        st.draftFor = "new";
        this._error = (err && err.message) || String(err);
        this._go({ name: "foods", id: "new" }, false, this._brCompact() ? undefined : "replace");
      }
    },

    // ---- a new food starts with a search: Frida and USDA in one list, a barcode, or "from scratch" ----
    _fdFinderHtml(close, compact) {
      return `<div class="fd-detail">
          ${compact ? "" : `<div class="fd-dhead"><h2>${esc(T("New food"))}</h2>${close}</div>`}
          <div class="fd-fsearch">
            <ha-input-search id="fn-q" appearance="outlined" placeholder="${esc(T("Search foods"))}"></ha-input-search>
            <ha-icon-button data-fscan label="${esc(T("Scan barcode"))}"><ha-icon icon="mdi:barcode-scan"></ha-icon></ha-icon-button>
          </div>
          <div id="fn-res"></div>
        </div>`;
    },

    _fdBindFinder(root) {
      const q = root.getElementById("fn-q");
      const res = root.getElementById("fn-res");
      if (!q || !res) return;
      const st = this._fdState();
      const d = this._fdDraft();
      let ticket = 0;
      const draw = () => {
        const text = (st.fnQ || "").trim();
        const hits = st.fnHits || [];
        const rows = hits
          .map((f, n) => `<ha-list-item-button data-n="${n}" headline="${esc(f.name)}" supporting-text="${esc([f.source === "frida" ? "Frida" : "USDA", f.group, f.kcal != null ? `${num(f.kcal)} kcal / 100 g` : ""].filter(Boolean).join(" · "))}"></ha-list-item-button>`)
          .join("");
        const scratch = `<ha-list-item-button data-scratch headline="${esc(text ? `${T("Create")} “${text}” ${T("from scratch")}` : T("Enter the details myself"))}"><ha-icon slot="start" icon="mdi:plus"></ha-icon></ha-list-item-button>`;
        res.innerHTML = `${text ? (hits.length || st.fnBusy ? "" : `<p class="muted">${esc(T("No foods found. Try another word."))}</p>`) : `<p class="muted">${esc(T("Search Frida and USDA, or scan a barcode with the icon."))}</p>`}${hits.length ? `<p class="muted">${esc(T("Saved under the name you typed; the match only gives the numbers."))}</p>` : ""}<ha-list-base>${rows}${scratch}</ha-list-base>`;
      };
      const search = async (text) => {
        const mine = ++ticket;
        if (!text.trim()) {
          st.fnHits = [];
          st.fnBusy = false;
          return draw();
        }
        st.fnBusy = true;
        const hits = await this._ws({ type: "hass_recipes/nutrition_search", query: text, limit: 30 }).catch(() => []);
        if (mine !== ticket) return;
        st.fnBusy = false;
        st.fnHits = hits.filter((x) => x.source === "frida" || x.source === "usda").slice(0, 25);
        draw();
      };
      res.addEventListener("click", async (e) => {
        if (e.target.closest("[data-scratch]")) {
          d.manual = true;
          d.name = (st.fnQ || "").trim();
          d.source = "custom";
          st.fnQ = "";
          st.fnHits = [];
          this._render();
          return;
        }
        const item = e.target.closest("[data-n]");
        if (!item) return;
        const f = st.fnHits[+item.dataset.n];
        // the food is called what you typed; the Frida or USDA food only supplies the numbers
        const typed = (st.fnQ || "").trim();
        const name = typed ? typed.charAt(0).toLocaleUpperCase() + typed.slice(1) : f.name;
        const body = { type: "hass_recipes/foods_save", name, aliases: [], source: f.source, section: "", barcode: "", unit_grams: {} };
        body[`${f.source}_id`] = f.id;
        const { ok, res: saved } = await this._fdCall(body);
        if (ok) {
          st.fnQ = "";
          st.fnHits = [];
          await this._fdRefresh(saved.id);
        }
      });
      let timer = null;
      q.addEventListener("input", () => {
        st.fnQ = q.value || "";
        clearTimeout(timer);
        timer = setTimeout(() => search(st.fnQ), 200);
      });
      q.value = st.fnQ || "";
      draw();
      if (!st.fnQ) setTimeout(() => q.focus && q.focus(), 300);
    },

    // ---- the page ----
    _foodsHtml() {
      const st = this._fdState();
      if (!st.data && !st.loading) this._fdLoad();
      const compact = this._brCompact();
      const sel = this._view.id;
      const canEdit = this._canEdit !== false;
      if (st.error && !st.data) return `<ha-alert alert-type="error">${esc(st.error)}</ha-alert>`;
      if (compact && sel) return `<div class="fd-detail-page">${this._fdDetailHtml()}</div>`;
      if (canEdit) this._fab = `<ha-button class="fab ${compact ? "above-tabs" : ""}" size="l" data-act="food-new"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("New food"))}</ha-button>`;
      const c = (st.data && st.data.counts) || { foods: 0, mine: 0, frida: 0, usda: 0, review: 0 };
      const chip = (key, label, n) =>
        `<ha-assist-chip data-ffilter="${key}" label="${esc(T(label))}${n != null ? ` ${n}` : ""}" ${st.filter === key ? "active" : ""}><ha-icon slot="icon" icon="mdi:${
          key === "review" ? "link-off" : key === "mine" ? "account-outline" : key === "usda" ? "flag-variant-outline" : "database-outline"
        }"></ha-icon></ha-assist-chip>`;
      const standard = st.data ? st.data.review.filter((r) => r.suggestion && r.suggestion.confidence === "standard").length : 0;
      return `<div class="fd-page">
          <div class="fd-main">
            <div class="fd-tool">
              ${compact ? "" : `<ha-input-search id="fsearch" appearance="outlined" placeholder="${esc(T("Search foods"))}" value="${esc(st.q)}"></ha-input-search>`}
              ${chip("review", "Needs review", c.review)}${chip("mine", "Mine", c.mine)}${chip("frida", "From Frida", c.frida)}${c.usda ? chip("usda", "From USDA", c.usda) : ""}
              ${st.filter === "review" && standard && canEdit ? `<ha-button size="s" appearance="filled" data-fd="adopt-all"><ha-icon slot="start" icon="mdi:check-all"></ha-icon>${esc(`${T("Accept")} ${standard} ${T("standard choices")}`)}</ha-button>` : ""}
            </div>
            ${st.filter === "review" ? this._fdGroupsHtml() : ""}
            <div id="fd-selbar" class="fd-selbar" hidden></div>
            <div id="fd-table"></div>
          </div>
          ${!compact && sel ? `<aside class="fd-pane">${this._fdDetailHtml()}</aside>` : ""}
        </div>`;
    },

    // ---- suggested groups: names that look like the same food ----
    _fdGroups() {
      const st = this._fdState();
      const hidden = st.hiddenGroups || (st.hiddenGroups = new Set());
      return ((st.data && st.data.groups) || []).filter((g) => !hidden.has(g.id));
    },

    _fdGroupHtml(g) {
      const t = g.target;
      const where =
        g.reason === "food"
          ? `${esc(T("Assign to"))} <b>${esc(t.name)}</b> (${esc(T("a food you have"))})`
          : g.reason === "guess"
            ? `${esc(T("New food"))} <b>${esc(t.name)}</b> ${esc(T("from"))} ${t.source === "usda" ? "USDA" : "Frida"}: ${esc(g.why)}`
            : `${esc(T("New food"))} <b>${esc(t.name)}</b> ${esc(T("without nutrition values: you add them after"))}`;
      const why = g.reason === "words" ? `${esc(T("Names that share"))} “${esc(g.why)}”` : "";
      return `<div class="fd-group">
          <div class="fd-group-main">
            <div class="fd-group-names">${g.keys.map((k) => `<ha-assist-chip label="${esc(k)}"></ha-assist-chip>`).join("")}</div>
            <div class="fd-group-to">${where}</div>
            ${why ? `<div class="fd-group-why">${why}</div>` : ""}
          </div>
          <div class="fd-group-btns">
            <ha-button size="s" appearance="${g.match ? "filled" : "plain"}" data-fgrp="assign" data-g="${esc(g.id)}">${esc(T("Assign"))}</ha-button>
            <ha-icon-button data-fgrp="edit" data-g="${esc(g.id)}" label="${esc(T("Edit group"))}"><ha-icon icon="mdi:pencil-outline"></ha-icon></ha-icon-button>
            <ha-icon-button data-fgrp="dismiss" data-g="${esc(g.id)}" label="${esc(T("Dismiss group"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>
          </div>
        </div>`;
    },

    _fdGroupsHtml() {
      const st = this._fdState();
      const canEdit = this._canEdit !== false;
      const groups = this._fdGroups();
      if (!st.data || !groups.length || !canEdit) return "";
      const names = groups.reduce((n, g) => n + g.keys.length, 0);
      const matched = groups.filter((g) => g.match);
      return `<ha-card class="fd-groups">
          <div class="fd-groups-head">
            <ha-icon icon="mdi:creation-outline"></ha-icon>
            <div class="fd-groups-title"><b>${groups.length} ${esc(T(groups.length === 1 ? "group looks like the same food" : "groups look like the same food"))}</b>
              <div class="fd-group-why">${names} ${esc(T("of the"))} ${st.data.review.length} ${esc(T("names. Check each group, or assign the ones with a match."))}</div></div>
            ${matched.length > 1 ? `<ha-button size="s" appearance="filled" data-fgrp="all">${esc(`${T("Assign")} ${matched.length} ${T("with a match")}`)}</ha-button>` : ""}
          </div>
          ${groups.map((g) => this._fdGroupHtml(g)).join("")}
        </ha-card>`;
    },

    /** What to send to assign a group (its names, and the food they go to). */
    _fdGroupPayload(g, keys) {
      const t = g.target;
      return t.kind === "food" ? { keys, food_id: t.food_id } : { keys, name: t.name, source: t.source, source_id: t.source_id };
    },

    async _fdAssignGroups(groups) {
      const payload = groups.map((g) => this._fdGroupPayload(g, g.keys));
      const { ok, res } = await this._fdCall({ type: "hass_recipes/foods_assign", groups: payload });
      if (ok) {
        await this._fdRefresh();
        this._flash(`${res.assigned} ${T("names assigned.")}`);
      }
    },

    _fdGroupAct(act, id) {
      const st = this._fdState();
      const g = this._fdGroups().find((x) => x.id === id);
      if (act === "all") return this._fdAssignGroups(this._fdGroups().filter((x) => x.match));
      if (!g) return;
      if (act === "assign") return this._fdAssignGroups([g]);
      if (act === "dismiss") {
        st.hiddenGroups.add(g.id);
        return this._render();
      }
      if (act === "edit") return this._fdEditGroup(g);
    },

    /** Take names out of a group, or choose another food for the rest. */
    _fdEditGroup(g) {
      const html = `<p class="muted">${esc(T("Untick the names that do not belong. They stay in the list."))}</p>
        <div class="fd-group-edit">${g.keys.map((k) => `<ha-formfield label="${esc(k)}"><ha-checkbox checked data-k="${esc(k)}"></ha-checkbox></ha-formfield>`).join("")}</div>`;
      this._planDialog(T("Edit group"), html, (dlg, close) => {
        this._planFooter(dlg, { primary: { label: T("Assign"), icon: "check", attrs: 'data-ge="assign"' }, secondary: [{ label: T("Choose another food"), attrs: 'data-ge="other"' }] });
        const keys = () => [...dlg.querySelectorAll("ha-checkbox")].filter((c) => c.checked).map((c) => c.dataset.k);
        dlg.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-ge]");
          if (!b) return;
          const picked = keys();
          if (!picked.length) return;
          close();
          if (b.dataset.ge === "other") return this._fdAssignNames(picked);
          const { ok, res } = await this._fdCall({ type: "hass_recipes/foods_assign", groups: [this._fdGroupPayload(g, picked)] });
          if (ok) {
            await this._fdRefresh();
            this._flash(`${res.assigned} ${T("names assigned.")}`);
          }
        });
      });
    },

    // ---- several rows at once ----
    /** What is ticked: ingredient names (in Needs review) or foods. */
    _fdSelection() {
      const st = this._fdState();
      const ids = [...(st.sel || [])];
      if (st.filter === "review") {
        const keys = ids.filter((id) => id.startsWith("r~")).map((id) => decodeURIComponent(id.slice(2)));
        return { kind: "names", keys, rows: st.data ? st.data.review.filter((r) => keys.includes(r.key)) : [] };
      }
      return { kind: "foods", ids, foods: st.data ? st.data.foods.filter((f) => ids.includes(f.id)) : [] };
    },

    _fdPaintSel() {
      const bar = this.shadowRoot && this.shadowRoot.getElementById("fd-selbar");
      if (!bar) return;
      const sel = this._fdSelection();
      const n = sel.kind === "names" ? sel.rows.length : sel.foods.length;
      bar.hidden = !n;
      if (!n) return;
      const btn = (act, icon, label) => `<ha-button size="s" appearance="plain" data-fdsel="${act}"><ha-icon slot="start" icon="mdi:${icon}"></ha-icon>${esc(T(label))}</ha-button>`;
      bar.innerHTML = `<ha-icon-button data-fdsel="clear" label="${esc(T("Clear selection"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>
        <span class="fd-seln">${n} ${esc(T("selected"))}</span>
        ${
          sel.kind === "names"
            ? `${btn("link", "link-variant", "Assign to a food")}${btn("accept", "check", "Accept suggestions")}${btn("ignore", "cancel", "Don't count")}`
            : `${n > 1 ? btn("merge", "call-merge", "Merge into one food") : ""}${btn("delete", "delete-outline", "Delete")}`
        }`;
      bar.querySelectorAll("[data-fdsel]").forEach((el) => el.addEventListener("click", () => this._fdSelAct(el.dataset.fdsel)));
    },

    _fdClearSel() {
      const st = this._fdState();
      st.sel = new Set();
      if (this._fdTable && this._fdTable.clearSelection) this._fdTable.clearSelection();
      this._fdPaintSel();
    },

    async _fdSelAct(act) {
      const st = this._fdState();
      const sel = this._fdSelection();
      sel.ids = sel.kind === "foods" ? sel.foods.map((f) => f.id) : [];
      if (act === "clear") return this._fdClearSel();
      if (sel.kind === "names") {
        const keys = sel.keys;
        if (act === "link") return this._fdAssignNames(keys);
        if (act === "accept") {
          const { ok, res } = await this._fdCall({ type: "hass_recipes/foods_adopt", keys });
          if (ok) {
            await this._fdRefresh();
            this._flash(`${res.added} ${T("foods added from the suggestions.")}`);
          }
          return;
        }
        if (act === "ignore") {
          for (const key of keys) if (!(await this._fdCall({ type: "hass_recipes/nutrition_link", food: key, source: "ignore" })).ok) return;
          await this._fdRefresh();
          this._flash(`${keys.length} ${T("names are not counted.")}`);
        }
        return;
      }
      if (act === "merge") return this._fdPickKeeper(sel.foods);
      if (act === "delete") {
        if (!confirm(T(`Delete ${sel.ids.length} foods? Their names are matched by their words again.`))) return;
        for (const id of sel.ids) if (!(await this._fdCall({ type: "hass_recipes/foods_delete", food_id: id })).ok) return;
        await this._fdRefresh();
        this._go({ name: "foods" }, false, "replace");
      }
    },

    /** Start a new food from ingredient names: the first is its name, the others other names for it. */
    _fdStartNew(keys) {
      const st = this._fdState();
      const rows = keys.map((k) => (st.data && st.data.review.find((r) => r.key === k)) || { key: k, suggestion: null });
      const first = rows.find((r) => r.suggestion) || rows[0];
      const ext = first.suggestion && (first.suggestion.source === "frida" || first.suggestion.source === "usda") ? first.suggestion : null;
      const kind = ext ? ext.source : "frida";
      st.draft = { ...blank(), name: title(first.key), aliases: rows.filter((r) => r !== first).map((r) => r.key), source: ext ? ext.source : "none", [`${kind}_id`]: ext ? ext.id : null, [`${kind}_name`]: ext ? ext.name : "", values: ext ? { kcal: ext.kcal, fat: ext.fat, carbs: ext.carbs, protein: ext.protein } : {} };
      st.draftFor = "new";
      this._fdKeep = true;
      this._go({ name: "foods", id: "new" }, false, this._brCompact() && this._view.name === "foods" ? undefined : this._view.name === "foods" ? "replace" : undefined);
    },

    /** Merging foods: choose the one that stays; the others become other names of it. */
    _fdPickKeeper(foods) {
      const html = `<p class="muted">${esc(T("Choose the food to keep. The others become other names of it, with their weights."))}</p>
        <ha-list-base>${foods.map((f, n) => `<ha-list-item-button data-n="${n}" headline="${esc(f.name)}" supporting-text="${esc(f.aliases.join(", "))}"></ha-list-item-button>`).join("")}</ha-list-base>`;
      this._planDialog(T("Merge into one food"), html, (dlg, close) => {
        dlg.addEventListener("click", (e) => {
          const item = e.target.closest("[data-n]");
          if (!item) return;
          const target = foods[+item.dataset.n];
          close();
          this._fdMergeDialog(target, foods.filter((f) => f.id !== target.id));
        });
      });
    },

    /** What a merge would change, before it is done. */
    _fdMergeDialog(target, sources) {
      const p = fl.mergePreview(target, sources);
      const li = (icon, text) => `<li><ha-icon icon="mdi:${icon}"></ha-icon><span>${text}</span></li>`;
      const list = [
        li("tag-multiple-outline", p.names.length ? `${esc(T("Other names added to"))} <b>${esc(target.name)}</b>: ${esc(p.names.join(", "))}` : esc(T("No new names."))),
        p.weights.length ? li("scale", `${esc(T("Weights carried over"))}: ${esc(p.weights.map(([u, g]) => `1 ${u} = ${num(g, 1)} g`).join(", "))}`) : "",
        p.nutrition ? li("nutrition", `${esc(T("Takes the nutrition of"))} <b>${esc(p.nutrition.name)}</b>`) : "",
        p.dropped.length ? li("alert-circle-outline", `<b>${esc(target.name)}</b> ${esc(T("keeps its own nutrition. Not kept"))}: ${esc(p.dropped.join(", "))}`) : "",
        li("book-open-variant-outline", `${p.recipes} ${esc(T("recipes use these foods. They count the same after."))}`),
      ].join("");
      const html = `<p>${esc(T("Merge"))} <b>${esc(sources.map((s) => s.name).join(", "))}</b> ${esc(T("into"))} <b>${esc(target.name)}</b>?</p>
        <ul class="fd-preview">${list}</ul>`;
      this._planDialog(T("Merge foods"), html, (dlg, close) => {
        this._planFooter(dlg, { primary: { label: T("Merge"), icon: "call-merge", attrs: 'data-mg="ok"' }, secondary: [{ label: T("Cancel"), attrs: 'data-mg="cancel"' }] });
        dlg.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-mg]");
          if (!b) return;
          close();
          if (b.dataset.mg !== "ok") return;
          const { ok } = await this._fdCall({ type: "hass_recipes/foods_merge", target: target.id, sources: sources.map((s) => s.id) });
          if (ok) {
            this._fdRemember(target.id);
            await this._fdRefresh();
            this._flash(`${sources.length + 1} ${T("foods merged into")} ${target.name}.`);
            this._go({ name: "foods", id: target.id }, false, "replace");
          }
        });
      });
    },

    // ---- one food ----
    _fdDetailHtml() {
      const compact = this._brCompact();
      const id = this._view.id;
      const canEdit = this._canEdit !== false;
      const close = compact ? "" : `<ha-icon-button data-fd="close" label="${esc(T("Close"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>`;
      if (id.startsWith("r~")) return this._fdReviewHtml(close, canEdit);
      const d = this._fdDraft();
      if (!d) return `<div class="fd-detail"><p class="muted">${esc(T(this._fdState().data ? "This food no longer exists." : "Loading…"))}</p></div>`;
      // a new food starts with a search; the long form is for typing it out
      if (id === "new" && !d.manual && canEdit) return this._fdFinderHtml(close, compact);
      const src = (key, label) => `<ha-assist-chip data-fsrc="${key}" label="${esc(T(label))}" ${d.source === key ? "active" : ""}></ha-assist-chip>`;
      let nutrition = "";
      if (d.source === "frida" || d.source === "usda") {
        const id = d[`${d.source}_id`];
        const name = d.source === "frida" ? d.frida_name : d.usda_name;
        nutrition = `<div class="fd-frida">${
          id
            ? `<b>${esc(name || (d.source === "frida" ? "Frida" : "USDA"))}</b><div class="muted">${esc(
                [d.values.kcal != null ? `${num(d.values.kcal)} kcal` : "", d.values.fat != null ? `${T("Fat")} ${num(d.values.fat, 1)} g` : "", d.values.carbs != null ? `${T("Carbohydrates")} ${num(d.values.carbs, 1)} g` : "", d.values.protein != null ? `${T("Protein")} ${num(d.values.protein, 1)} g` : ""]
                  .filter(Boolean)
                  .join(" · ")
              )}</div>`
            : `<span class="muted">${esc(T(d.source === "frida" ? "No Frida food chosen yet." : "No USDA food chosen yet."))}</span>`
        }${canEdit ? `<ha-button size="s" appearance="plain" data-fd="pick-${d.source}">${esc(T(id ? "Change" : d.source === "frida" ? "Choose a Frida food" : "Choose a USDA food"))}</ha-button>` : ""}</div>`;
      } else if (d.source === "custom") nutrition = `<p class="muted">${esc(T("Values per 100 g, as on the nutrition label. Only the energy is required."))}</p><ha-form id="fd-values"></ha-form>`;
      else nutrition = `<p class="muted">${esc(T("No values yet, so this food is left out of the nutrition."))}</p>`;
      const rows = d.unit_rows
        .map(
          ([unit, grams], i) => `<div class="fd-urow">
            <ha-input appearance="outlined" data-fu="unit" data-i="${i}" label="${esc(T("Unit"))}" placeholder="dl, dåse, stk" value="${esc(unit)}"></ha-input>
            <ha-input appearance="outlined" data-fu="grams" data-i="${i}" type="number" label="${esc(T("Grams"))}" value="${esc(grams)}"></ha-input>
            <ha-icon-button data-fd="unit-del" data-i="${i}" label="${esc(T("Delete"))}"><ha-icon icon="mdi:delete-outline"></ha-icon></ha-icon-button></div>`
        )
        .join("");
      const recipes = (d.recipes || [])
        .map((rid) => this._recipe(rid))
        .filter(Boolean)
        .map((r) => `<ha-list-item-button data-open="${esc(r.id)}" headline="${esc(r.name)}"><ha-icon slot="end" icon="mdi:chevron-right"></ha-icon></ha-list-item-button>`)
        .join("");
      return `<div class="fd-detail">
          ${compact ? "" : `<div class="fd-dhead"><h2>${esc(d.name || T("New food"))}</h2>${close}</div>`}
          ${canEdit && id === "new" ? `<ha-button size="s" appearance="plain" data-fscan><ha-icon slot="start" icon="mdi:barcode-scan"></ha-icon>${esc(T("Scan barcode"))}</ha-button>` : ""}
          <ha-form id="fd-form"></ha-form>
          <h3>${esc(T("Nutrition per 100 g"))}</h3>
          <div class="fd-srcs">${src("frida", "Frida")}${src("usda", "USDA")}${src("custom", "My values")}${src("none", "None")}</div>
          ${nutrition}
          <h3>${esc(T("Weights"))}</h3>
          ${rows}
          ${canEdit ? `<ha-button size="s" appearance="plain" data-fd="unit-add"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Add a weight"))}</ha-button>` : ""}
          <p class="muted">${esc(T("A weight written on an ingredient line, like “1 dåse (240 g)”, wins over these."))}</p>
          ${d.id ? `<h3>${esc(T("Used in"))} ${d.used_in} ${esc(T("recipes"))}</h3>${recipes ? `<ha-list-base>${recipes}</ha-list-base>` : ""}` : ""}
          ${
            canEdit
              ? `<div class="fd-actions">
                  <ha-button appearance="filled" data-fd="save">${esc(T("Save"))}</ha-button>
                  ${d.id ? `<ha-button appearance="plain" data-fd="merge"><ha-icon slot="start" icon="mdi:call-merge"></ha-icon>${esc(T("Merge into another food"))}</ha-button>
                  <ha-button appearance="plain" variant="danger" data-fd="delete"><ha-icon slot="start" icon="mdi:delete-outline"></ha-icon>${esc(T("Delete"))}</ha-button>` : ""}
                </div>`
              : ""
          }
        </div>`;
    },

    /** An ingredient name that is not a food yet. */
    _fdReviewHtml(close, canEdit) {
      const compact = this._brCompact();
      const r = this._fdReview(this._view.id);
      if (!r) return `<div class="fd-detail"><p class="muted">${esc(T(this._fdState().data ? "This name is a food now." : "Loading…"))}</p></div>`;
      const s = r.suggestion;
      const recipes = r.recipes
        .map((rid) => this._recipe(rid))
        .filter(Boolean)
        .map((x) => `<ha-list-item-button data-open="${esc(x.id)}" headline="${esc(x.name)}"><ha-icon slot="end" icon="mdi:chevron-right"></ha-icon></ha-list-item-button>`)
        .join("");
      return `<div class="fd-detail">
          ${compact ? "" : `<div class="fd-dhead"><h2>${esc(r.name)}</h2>${close}</div>`}
          <p class="muted">${esc(`${T("Used in")} ${r.used_in} ${T("recipes")}`)}. ${esc(T("It is not a food yet, so it is matched by its words each time."))}</p>
          ${
            s
              ? `<ha-alert alert-type="info"><b>${esc(s.name)}</b> · ${esc(num(s.kcal))} kcal / 100 g<br>${esc(T(s.confidence === "standard" ? "A standard choice for this word." : "The best match found by its words: check it."))}</ha-alert>`
              : `<ha-alert alert-type="warning">${esc(T("No food was found for this name."))}</ha-alert>`
          }
          ${
            canEdit
              ? `<div class="fd-actions">
                  ${s ? `<ha-button appearance="filled" data-fd="accept"><ha-icon slot="start" icon="mdi:check"></ha-icon>${esc(T("Accept suggestion"))}</ha-button>` : ""}
                  <ha-button appearance="${s ? "plain" : "filled"}" data-fd="link"><ha-icon slot="start" icon="mdi:link-variant"></ha-icon>${esc(T("Assign to a food"))}</ha-button>
                  <ha-button appearance="plain" data-fd="ignore">${esc(T("Don't count"))}</ha-button>
                </div>`
              : ""
          }
          ${recipes ? `<h3>${esc(T("Used in"))}</h3><ha-list-base>${recipes}</ha-list-base>` : ""}
        </div>`;
    },

    // ---- actions ----
    async _fdRefresh(select) {
      this._fnames = null;
      const st = this._fdState();
      st.draft = null;
      st.draftFor = null;
      st.data = await this._ws({ type: "hass_recipes/foods" }).catch(() => st.data);
      if (this._nuCache) this._nuCache = {}; // the nutrition of recipes may have changed
      if (select !== undefined) this._go({ name: "foods", id: select }, false, "replace");
      else this._render();
    },

    _fdSaveBody(d) {
      const body = { name: d.name.trim(), aliases: d.aliases.map((a) => String(a).trim()).filter(Boolean), source: d.source, section: d.section || "", barcode: String(d.barcode || "") };
      if (d.source === "frida") body.frida_id = d.frida_id;
      if (d.source === "usda") body.usda_id = d.usda_id;
      if (d.source === "custom") body.values = Object.fromEntries(FORM.filter(([k]) => d.values[k] != null).map(([k]) => [k, d.values[k]]));
      body.unit_grams = Object.fromEntries(d.unit_rows.filter(([u, g]) => String(u).trim() && g > 0).map(([u, g]) => [String(u).trim(), Number(g)]));
      return body;
    },

    async _fdAct(act, el) {
      const st = this._fdState();
      const d = this._fdDraft();
      switch (act) {
        case "close":
          this._go({ name: "foods" }, false, "replace");
          break;
        case "unit-add":
          d.unit_rows.push(["", ""]);
          this._render();
          break;
        case "unit-del":
          d.unit_rows.splice(+el.dataset.i, 1);
          this._render();
          break;
        case "save": {
          if (!d.name.trim()) {
            this._error = T("A food needs a name");
            this._render();
            return;
          }
          const msg = { type: "hass_recipes/foods_save", ...this._fdSaveBody(d) };
          if (d.id) msg.food_id = d.id;
          const { ok, res } = await this._fdCall(msg);
          if (ok) await this._fdRefresh(res.id);
          break;
        }
        case "delete": {
          if (!confirm(T(`Delete the food “${d.name}”? Its names are matched by their words again.`))) return;
          const { ok } = await this._fdCall({ type: "hass_recipes/foods_delete", food_id: d.id });
          if (ok) {
            await this._fdRefresh();
            this._go({ name: "foods" }, false, "replace");
          }
          break;
        }
        case "pick-frida":
          this._fdPickSource(d, "frida");
          break;
        case "pick-usda":
          this._fdPickSource(d, "usda");
          break;
        case "merge":
          this._fdPickFood(d);
          break;
        case "adopt-all": {
          const keys = st.data.review.filter((r) => r.suggestion && r.suggestion.confidence === "standard").map((r) => r.key);
          const { ok, res } = await this._fdCall({ type: "hass_recipes/foods_adopt", keys });
          if (ok) {
            await this._fdRefresh();
            this._flash(`${res.added} ${T("foods added from standard choices.")}`);
          }
          break;
        }
        case "accept": {
          const r = this._fdReview(this._view.id);
          const { ok } = await this._fdCall({ type: "hass_recipes/foods_adopt", keys: [r.key] });
          if (ok) {
            await this._fdRefresh();
            const food = st.data.foods.find((f) => f.aliases.some((a) => a.toLowerCase() === r.key) || f.name.toLowerCase() === r.key);
            this._go({ name: "foods", id: food ? food.id : undefined }, false, "replace");
          }
          break;
        }
        case "link":
          this._fdAssignNames([this._fdReview(this._view.id).key]);
          break;
        case "ignore": {
          const r = this._fdReview(this._view.id);
          const { ok } = await this._fdCall({ type: "hass_recipes/nutrition_link", food: r.key, source: "ignore" });
          if (ok) {
            await this._fdRefresh();
            this._go({ name: "foods" }, false, "replace");
          }
          break;
        }
      }
    },

    /** Pick a Frida or USDA food for the food being edited. */
    _fdPickSource(d, source) {
      const html = `<ha-input-search id="fp-q" appearance="outlined" placeholder="${esc(T("Search foods"))}" value="${esc(d.name)}"></ha-input-search><div id="fp-res"></div>`;
      this._planDialog(T(source === "frida" ? "Choose a Frida food" : "Choose a USDA food"), html, (dlg, close) => {
        const res = dlg.querySelector("#fp-res");
        let ticket = 0;
        let found = [];
        const search = async (q) => {
          const mine = ++ticket;
          if (!q.trim()) {
            res.innerHTML = "";
            return;
          }
          const hits = await this._ws({ type: "hass_recipes/nutrition_search", query: q, limit: 50 }).catch(() => []);
          if (mine !== ticket) return;
          found = hits.filter((x) => x.source === source).slice(0, 30);
          res.innerHTML = found.length
            ? `<ha-list-base>${found
                .map((f, n) => `<ha-list-item-button data-n="${n}" headline="${esc(f.name)}" supporting-text="${esc([f.group, f.kcal != null ? `${num(f.kcal)} kcal / 100 g` : ""].filter(Boolean).join(" · "))}"></ha-list-item-button>`)
                .join("")}</ha-list-base>`
            : `<p class="muted">${esc(T("No foods found. Try another word."))}</p>`;
        };
        res.addEventListener("click", (e) => {
          const item = e.target.closest("[data-n]");
          if (!item) return;
          const f = found[+item.dataset.n];
          d.source = source;
          d[`${source}_id`] = f.id;
          d[`${source}_name`] = f.name;
          d.values = Object.fromEntries(FORM.map(([k]) => [k, f[k]]));
          close();
          this._render();
        });
        const q = dlg.querySelector("#fp-q");
        let timer = null;
        q.addEventListener("input", () => {
          clearTimeout(timer);
          timer = setTimeout(() => search(q.value), 200);
        });
        search(d.name);
        setTimeout(() => q.focus && q.focus(), 300);
      });
    },

    _fdRecent() {
      try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      } catch (err) {
        return [];
      }
    },

    _fdRemember(id) {
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(fl.remember(this._fdRecent(), id)));
      } catch (err) {
        /* no storage: the list is just not remembered */
      }
    },

    /** A list of foods to choose from: the alike ones and the recent ones first, a search, and "show more". */
    _fdFoodDialog({ title, foods, names, createRow, onPick, onCreate }) {
      const html = `<ha-input-search id="fm-q" appearance="outlined" placeholder="${esc(T("Search foods"))}"></ha-input-search><div id="fm-res" class="fm-res"></div>`;
      this._planDialog(title, html, (dlg, close) => {
        const res = dlg.querySelector("#fm-res");
        const recent = this._fdRecent();
        const step = 40;
        let limit = step;
        let q = "";
        let shown = [];
        const item = (f) => {
          shown.push(f);
          return `<ha-list-item-button data-n="${shown.length - 1}" headline="${esc(f.name)}" supporting-text="${esc(f.aliases.join(", "))}"></ha-list-item-button>`;
        };
        const heading = (text) => `<div class="fm-head">${esc(T(text))}</div>`;
        const draw = () => {
          shown = [];
          const ranked = fl.rankFoods(foods, names, q, recent);
          let body = "";
          if (!q.trim()) {
            const alike = ranked.filter((f) => names.length && fl.similarity(f, names) > 0).slice(0, 5);
            const used = recent.map((id) => ranked.find((f) => f.id === id)).filter((f) => f && !alike.includes(f)).slice(0, 3);
            if (alike.length) body += heading("Looks alike") + alike.map(item).join("");
            if (used.length) body += heading("Recently used") + used.map(item).join("");
            const rest = ranked.filter((f) => !alike.includes(f) && !used.includes(f));
            if (alike.length || used.length) body += heading("All foods");
            body += rest.slice(0, limit).map(item).join("");
            var more = rest.length - limit;
          } else {
            body += ranked.slice(0, limit).map(item).join("");
            var more = ranked.length - limit;
          }
          res.innerHTML = `<ha-list-base>${createRow ? createRow : ""}${body}</ha-list-base>${
            body ? "" : `<p class="muted">${esc(T("No foods match."))}</p>`
          }${more > 0 ? `<ha-button appearance="plain" size="s" data-more>${esc(`${T("Show")} ${Math.min(step, more)} ${T("more")} (${more})`)}</ha-button>` : ""}`;
        };
        draw();
        dlg.querySelector("#fm-q").addEventListener("input", (e) => {
          q = e.target.value;
          limit = step;
          draw();
        });
        res.addEventListener("click", (e) => {
          if (e.target.closest("[data-more]")) {
            limit += step;
            return draw();
          }
          if (e.target.closest("[data-new]")) {
            close();
            return onCreate();
          }
          const row = e.target.closest("[data-n]");
          if (!row) return;
          close();
          onPick(shown[+row.dataset.n]);
        });
      }, { fill: true });
    },

    /** Assign ingredient names to a food: one that is there, or a new one made from them. `after` runs when it is done. */
    async _fdAssignNames(names, after) {
      const st = this._fdState();
      if (!st.data) await this._fdLoad();
      if (!st.data) return;
      const createRow = `<ha-list-item-button data-new headline="${esc(T("Create a new food"))}" supporting-text="${esc(names.length > 1 ? names.join(", ") : title(names[0]))}"><ha-icon slot="start" icon="mdi:plus"></ha-icon></ha-list-item-button>`;
      this._fdFoodDialog({
        title: T("Assign to a food"),
        foods: st.data.foods,
        names,
        createRow,
        onCreate: () => this._fdStartNew(names),
        onPick: async (target) => {
          const { ok } = await this._fdCall({ type: "hass_recipes/foods_link", keys: names, food_id: target.id });
          if (!ok) return;
          this._fdRemember(target.id);
          if (names.length > 1) this._flash(`${names.length} ${T("names linked to")} ${target.name}.`);
          if (after) return after(target);
          await this._fdRefresh();
          this._go({ name: "foods", id: target.id }, false, "replace");
        },
      });
    },

    /** Merge the food being edited into another one (after a preview). */
    _fdPickFood(from) {
      const st = this._fdState();
      this._fdFoodDialog({
        title: T("Merge into another food"),
        foods: st.data.foods.filter((f) => f.id !== from.id),
        names: [from.name, ...from.aliases],
        onPick: (target) => this._fdMergeDialog(target, [from]),
      });
    },

    // ---- binding ----
    _bindFoods(root, on) {
      const st = this._fdState();
      const host = root.getElementById("fd-table");
      if (host) this._fdMountTable(host);
      const search = root.getElementById("fsearch") || root.getElementById("fdsearch");
      if (search) {
        search.value = st.q;
        search.addEventListener("input", () => {
          st.q = search.value;
          const t = host && host.querySelector("ha-data-table");
          if (t) {
            t.data = this._fdRows();
            this._fdSyncTable();
          }
        });
      }
      this._fdBindFinder(root);
      on("[data-fscan]", "click", () => this._fdScan());
      on("[data-ffilter]", "click", (e) => {
        const key = e.currentTarget.dataset.ffilter;
        st.touched = true;
        st.filter = st.filter === key ? "all" : key;
        this._go({ name: "foods" }, false, "replace");
      });
      on("[data-fd]", "click", (e) => this._fdAct(e.currentTarget.dataset.fd, e.currentTarget));
      on("[data-fgrp]", "click", (e) => this._fdGroupAct(e.currentTarget.dataset.fgrp, e.currentTarget.dataset.g));
      on("[data-fsrc]", "click", (e) => {
        const d = this._fdDraft();
        d.source = e.currentTarget.dataset.fsrc;
        this._render();
      });
      on("[data-fu]", "input", (e) => {
        const d = this._fdDraft();
        const row = d.unit_rows[+e.currentTarget.dataset.i];
        if (!row) return;
        if (e.currentTarget.dataset.fu === "unit") row[0] = e.currentTarget.value;
        else row[1] = parseFloat(String(e.currentTarget.value).replace(",", "."));
      });
      // the form: name, other names and shop section (and the values of a food of your own) are Home Assistant's ha-form
      const d = root.getElementById("fd-form") ? this._fdDraft() : null;
      const form = root.getElementById("fd-form");
      if (form && d) {
        form.hass = this._hass;
        form.schema = [
          { name: "name", required: true, selector: { text: {} } },
          { name: "aliases", selector: { text: { multiple: true } } },
          { name: "section", selector: { text: {} } },
          { name: "barcode", selector: { text: {} } },
        ];
        form.computeLabel = (sc) => T({ name: "Name", aliases: "Other name", section: "Shop section", barcode: "Barcode number" }[sc.name]);
        form.computeHelper = (sc) => (sc.name === "aliases" ? T("Other names for it in recipes, like “butter”.") : "");
        form.data = { name: d.name, aliases: d.aliases, section: d.section, barcode: d.barcode || "" };
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          const v = e.detail.value || {};
          form.data = v;
          d.name = String(v.name || "");
          d.aliases = v.aliases || [];
          d.section = String(v.section || "");
          d.barcode = String(v.barcode || "").replace(/\D/g, "");
        });
      }
      const values = root.getElementById("fd-values");
      if (values && d) {
        values.hass = this._hass;
        values.schema = [{ type: "grid", name: "", schema: FORM.map(([key]) => ({ name: key, required: key === "kcal", selector: { number: { min: 0, step: "any", mode: "box" } } })) }];
        values.computeLabel = (sc) => T((FORM.find(([k]) => k === sc.name) || [])[1] || sc.name);
        values.data = Object.fromEntries(FORM.filter(([k]) => d.values[k] != null).map(([k]) => [k, d.values[k]]));
        values.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          const v = e.detail.value || {};
          values.data = v;
          for (const [k] of FORM) d.values[k] = v[k] == null || Number.isNaN(v[k]) ? null : v[k];
        });
      }
    },
  };
}
