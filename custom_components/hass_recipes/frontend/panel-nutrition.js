/* Recipes panel: calories and macros, and the foods behind them. Mixed into the panel class by recipes-panel.js.
 *
 * The server does the sums (nutrition.py); this module shows them on the recipe page and offers a page
 * (#/recipe/<id>/nutrition) with every ingredient line and the food it is linked to: accept a suggestion,
 * choose another food (one of yours, or a Frida food that becomes one of yours), create a food, give the
 * weight of a unit the parser cannot weigh ("1 dåse"), or count a line as nothing. The foods themselves
 * are managed on the Foods page (panel-foods.js).
 */
export default function (h) {
  const { esc, state } = h;

  const MAIN = [
    ["kcal", "Energy", "kcal"],
    ["protein", "Protein", "g"],
    ["fat", "Fat", "g"],
    ["carbs", "Carbohydrates", "g"],
    ["fibre", "Dietary fibre", "g"],
  ];
  const MORE = [
    ["sugars", "of which sugars", "g"],
    ["sat_fat", "of which saturated fat", "g"],
    ["salt", "Salt", "g"],
  ];
  // the full table follows the order of a nutrition label, the "of which" rows under their parent
  const ALL = ["kcal", "fat", "sat_fat", "carbs", "sugars", "fibre", "protein", "salt"].map((key) =>
    [...MAIN, ...MORE].find(([k]) => k === key)
  );
  const num = (v, digits = 1) =>
    v == null || Number.isNaN(v) ? "–" : new Intl.NumberFormat(state.language || "en", { maximumFractionDigits: digits }).format(v);
  const amount = (v, unit) => (v == null ? "–" : `${num(v, unit === "kcal" ? 0 : 1)} ${unit}`);

  return {
    // ---- data ----
    /** The calculation for a recipe, fetched once per version of the recipe. */
    _nuData(r) {
      this._nuCache = this._nuCache || {};
      const hit = this._nuCache[r.id];
      const version = `${r.updated || ""}|${(r.ingredients || []).length}|${r.servings || ""}`;
      if (hit && hit.version === version) return hit;
      // keep showing the last result while the new one is on its way, so the page does not flash
      const entry = (this._nuCache[r.id] = { version, loading: true, data: hit && hit.data });
      this._ws({ type: "hass_recipes/nutrition", recipe_id: r.id })
        .then((data) => Object.assign(entry, { loading: false, data, error: "" }))
        .catch((err) => Object.assign(entry, { loading: false, error: err.message || String(err) }))
        .then(() => {
          // only repaint when this result is still the one wanted, on a page that shows it
          if (this._nuCache[r.id] !== entry) return;
          if (this._view && this._view.id === r.id && (this._view.name === "detail" || this._view.name === "nutrition")) this._render();
        });
      return entry;
    },

    /** Links and custom ingredients are shared by every recipe: forget all results and fetch again. */
    async _nuRefresh() {
      this._fnames = null;
      for (const entry of Object.values(this._nuCache || {})) entry.version = "stale";
      const r = this._recipe(this._view.id);
      if (r) this._nuData(r);
      this._render();
    },

    async _nuCall(msg) {
      try {
        const res = await this._ws(msg);
        this._error = "";
        return res;
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
        return undefined;
      }
    },

    // ---- the table on the recipe page and at the top of the nutrition page ----
    /** Where the nutrition table goes: Home Assistant's data table, put in by `_nuMountTables` once the page is drawn. */
    _nuTableHtml(d, k, full) {
      return `<div class="nu-tablehost" data-full="${full ? 1 : 0}"></div>
        ${d.per_100g ? `<div class="muted nu-basis">${esc(h.T("Per 100 g is based on the"))} ${num(d.weight, 0)} g ${esc(h.T("of ingredients that were counted"))}.</div>` : ""}`;
    },

    /** The nutrition tables of the page: per 100 g, per serving, per unit the recipe makes, and the whole recipe. */
    _nuMountTables(root) {
      const r = this._recipe(this._view.id);
      const st = r && this._nuData(r);
      const d = st && st.data;
      if (!d) return;
      const k = this._scale || 1;
      const compact = this._brCompact();
      // the unit is in the row's name, so that the numbers are short enough for a phone
      const plain = (v, unit) => (v == null ? "–" : num(v, unit === "kcal" ? 0 : 1));
      root.querySelectorAll(".nu-tablehost").forEach((host) => {
        const full = host.dataset.full === "1";
        const rows = (full ? ALL : MAIN).map(([key, label, unit]) => ({
          id: key,
          name: label,
          unitText: unit,
          sub: key === "sugars" || key === "sat_fat",
          p100: plain(d.per_100g && d.per_100g[key], unit),
          serving: plain(d.per_serving && d.per_serving[key], unit),
          unit: plain(d.per_unit && d.per_unit[key], unit),
          whole: plain(d.total[key] == null ? null : d.total[key] * k, unit),
        }));
        const col = (title, field, show, extra = {}) =>
          show ? { [field]: { title, type: "numeric", flex: 1, minWidth: "64px", showNarrow: true, template: (row) => row[field], ...extra } } : {};
        const t = document.createElement("ha-data-table");
        t.hass = this._hass;
        t.autoHeight = true;
        t.narrow = false; // the columns are the point: three small numbers fit on a phone
        t.id = "id";
        t.columns = {
          name: {
            title: "",
            main: true,
            flex: 2,
            template: (row) => {
              const el = document.createElement("div");
              el.textContent = `${h.T(row.name)} (${row.unitText})`;
              if (row.sub) el.style.cssText = "padding-inline-start:12px;color:var(--secondary-text-color);font-size:.9em";
              return el;
            },
          },
          ...col(compact ? h.T("100 g") : h.T("Per 100 g"), "p100", !!d.per_100g),
          ...col(compact ? h.T("Serving") : h.T("Per serving"), "serving", !!d.per_serving),
          ...col(compact ? d.yield_unit || h.T("piece") : `${h.T("Per")} ${d.yield_unit || h.T("piece")}`, "unit", !!d.per_unit),
          ...col(k === 1 ? h.T("Whole recipe") : `${h.T("Whole recipe")} ×${num(k, 2)}`, "whole", true, { hidden: this._brCompact() && (d.per_100g || d.per_serving || d.per_unit) }),
        };
        t.data = rows;
        host.replaceChildren(t);
      });
    },

    _nuStatusText(d) {
      const total = d.items.filter((i) => i.status !== "ignored").length;
      const parts = [`Estimate · ${d.counted} of ${total} ingredients counted`];
      if (d.unconfirmed) parts.push(`${d.unconfirmed} matched automatically`);
      return parts.join(" · ");
    },

    _nuSourceHtml(d) {
      const sources = d.sources && d.sources.length ? d.sources : [d.source || {}];
      const line = (s) => `<div class="nu-src">${esc(h.T("Nutrition data"))}: <a href="${esc(s.url || "https://frida.fooddata.dk")}" target="_blank" rel="noopener noreferrer">${esc(
        s.attribution || "The Danish Food Composition Database"
      )}</a>, <a href="${esc(s.license_url || "https://creativecommons.org/licenses/by/4.0/")}" target="_blank" rel="noopener noreferrer">${esc(s.license || "CC BY 4.0")}</a></div>`;
      return sources.map(line).join("");
    },

    /** The Nutrition card on the recipe page. */
    _nutritionCardHtml(r, k) {
      const real = (r.ingredients || []).some((i) => !h.isHeader(i));
      if (!real) return "";
      const st = this._nuData(r);
      let body;
      if (!st.data && st.loading) body = `<div class="card-content muted">Calculating…</div>`;
      else if (!st.data) body = `<div class="card-content muted">${esc(st.error)}</div>`;
      else {
        const d = st.data;
        const attention = d.missing + d.unconfirmed;
        body = d.counted
          ? `<div class="card-content">${this._nuTableHtml(d, k, false)}
              <div class="muted nu-status">${esc(this._nuStatusText(d))}</div>
              ${d.missing ? `<div class="nu-warn"><ha-icon icon="mdi:alert-circle-outline"></ha-icon><span>${esc(`${d.missing} ingredient(s) not counted`)}</span></div>` : ""}
              ${!d.per_serving && !d.per_unit ? `<div class="muted">${esc(h.T("Add the number of servings, or what the recipe makes, to see values per serving or per piece."))}</div>` : ""}
            </div>`
          : `<div class="card-content muted">None of the ingredients could be counted yet.</div>`;
        body += `<div class="card-actions"><ha-button appearance="plain" size="s" data-act="nutrition" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:${
          attention ? "playlist-check" : "format-list-bulleted"
        }"></ha-icon>${attention ? "Check ingredients" : "Show ingredients"}</ha-button></div>${this._nuSourceHtml(d)}`;
      }
      return `<ha-card class="rd-nut" header="Nutrition">${body}</ha-card>`;
    },

    // ---- the page: every ingredient line and its food ----
    /** What to say about how a line got its food: [text, tone]. */
    _nuTag(item) {
      const m = item.match;
      if (item.status === "ignored") return ["Not counted", "muted"];
      if (item.own_food) return [item.own_food.auto ? "Linked automatically" : "Confirmed", "ok"];
      if (!m) return ["", ""];
      if (m.default) return ["Standard choice, not saved yet", "auto"];
      if (m.auto) return ["Best guess", "auto"];
      return ["", ""];
    },

    _nuChip(tag, tone) {
      return `<ha-assist-chip class="nu-tag ${tone}" label="${esc(h.T(tag))}"></ha-assist-chip>`;
    },

    _nuWarn(text) {
      return `<ha-alert class="nu-warn" alert-type="warning">${esc(text)}</ha-alert>`;
    },

    _nuItemHtml(item, edit) {
      const [tag, tone] = this._nuTag(item);
      const m = item.match;
      const food = item.own_food;
      const open = this._nu.open === item.index;
      const kcal = item.values && item.values.kcal != null ? `${num(item.values.kcal, 0)} kcal` : "";
      let detail = "";
      if (item.status === "no_match") detail = this._nuWarn(h.T("Not linked to a food, so it is not counted."));
      else if (item.status === "no_grams") {
        const unit = item.unit_text || item.unit || "";
        detail = this._nuWarn(h.T(item.quantity == null ? "No amount, so it is not counted." : "The weight is unknown, so it is not counted."));
        if (edit && item.quantity != null && m && m.source !== "ignore")
          detail += `<div class="nu-unit"><ha-input id="nu-ug-${item.index}" type="text" appearance="outlined" label="${esc(`1 ${unit || h.T("piece")} = … g`)}"></ha-input>
            <ha-button size="s" appearance="filled" data-nu="unit" data-i="${item.index}" data-unit="${esc(item.unit || "piece")}">${esc(h.T("Save weight"))}</ha-button></div>`;
      }
      const ug = m && m.unit_grams ? Object.entries(m.unit_grams) : [];
      const linked = !!food;
      const acts = edit
        ? `<div class="nu-acts">
            ${!linked && m && m.source !== "ignore" ? `<ha-button appearance="filled" size="s" data-nu="accept" data-i="${item.index}"><ha-icon slot="start" icon="mdi:check"></ha-icon>${esc(h.T("Accept"))}</ha-button>` : ""}
            <ha-button appearance="plain" size="s" data-nu="change" data-i="${item.index}">${esc(h.T(open ? "Close" : linked ? "Change" : "Link to a food"))}</ha-button>
            ${!linked && (!m || m.source === "ignore") ? "" : ""}
            ${!linked && item.status !== "ignored" && !m ? `<ha-button appearance="plain" size="s" data-nu="create" data-i="${item.index}">${esc(h.T("Create food"))}</ha-button>` : ""}
            ${linked ? `<ha-button appearance="plain" size="s" data-nu="food" data-i="${item.index}">${esc(h.T("Edit food"))}</ha-button>` : ""}
            ${item.status !== "ignored" ? `<ha-button appearance="plain" size="s" data-nu="ignore" data-i="${item.index}">${esc(h.T("Don't count"))}</ha-button>` : ""}
            ${m && m.linked && item.status === "ignored" ? `<ha-button appearance="plain" size="s" data-nu="reset" data-i="${item.index}">${esc(h.T("Reset"))}</ha-button>` : ""}
          </div>`
        : "";
      const via =
        m && m.source !== "ignore"
          ? `${esc(m.name)}${item.grams != null ? ` · ${num(item.grams)} g` : ""}${ug.length ? ` · ${ug.map(([u, g]) => `1 ${esc(u === item.unit && item.unit_text ? item.unit_text : u)} = ${num(g)} g`).join(", ")}` : ""}`
          : "";
      const matchLine = food
        ? `<div class="nu-match"><ha-icon icon="mdi:link-variant"></ha-icon><span><b>${esc(food.name)}</b>${via ? ` <span class="nu-via">· ${via}</span>` : ""}</span>${tag ? this._nuChip(tag, tone) : ""}</div>`
        : m && m.source !== "ignore"
        ? `<div class="nu-match"><ha-icon icon="mdi:arrow-right-bottom"></ha-icon><span><b>${esc(m.name)}</b>${item.grams != null ? ` · ${num(item.grams)} g` : ""}</span>${tag ? this._nuChip(tag, tone) : ""}</div>`
        : tag
        ? `<div class="nu-match">${this._nuChip(tag, tone)}</div>`
        : "";
      return `<li class="nu-item s-${item.status}">
          <div class="nu-line">${edit && item.key ? `<ha-checkbox data-nu-sel="${item.index}" ${this._nu.sel && this._nu.sel.has(item.index) ? "checked" : ""}></ha-checkbox>` : ""}<span class="nu-text">${esc(item.text)}</span><span class="nu-kcal">${esc(kcal)}</span></div>
          ${matchLine}${detail}${acts}
          ${open ? this._nuPickerHtml(item) : ""}
        </li>`;
    },

    /** Choose the food for a line: one of yours, or a Frida food that becomes one of yours. */
    _nuPickerHtml(item) {
      return `<div class="nu-picker">
          <ha-input-search id="nu-q" appearance="outlined" placeholder="${esc(h.T("Search foods"))}" value="${esc(this._nu.query)}"></ha-input-search>
          <div id="nu-results">${this._nuResultsHtml()}</div>
          <ha-button appearance="plain" size="s" data-nu="create" data-i="${item.index}"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(h.T("Create food"))}</ha-button>
        </div>`;
    },

    /** Your foods that match the search first, then Frida foods. */
    _nuMineMatches() {
      const q = (this._nu.query || "").trim().toLowerCase();
      const foods = (this._nu.foods && this._nu.foods.foods) || [];
      return foods.filter((f) => !q || [f.name, ...f.aliases].some((x) => x.toLowerCase().includes(q))).slice(0, 8);
    },

    _nuResultsHtml() {
      const mine = this._nuMineMatches();
      const res = this._nu.results;
      if (this._nu.searching && !res.length && !mine.length) return `<div class="muted">${esc(h.T("Searching…"))}</div>`;
      if (!res.length && !mine.length) return this._nu.query ? `<div class="muted">${esc(h.T("No foods found. Try another word."))}</div>` : "";
      const group = (label, body) => (body ? `<div class="nu-group">${esc(h.T(label))}</div><ha-list-base class="nu-results">${body}</ha-list-base>` : "");
      return (
        group(
          "Your foods",
          mine
            .map((f) => `<ha-list-item-button data-nu-own="${esc(f.id)}" headline="${esc(f.name)}" supporting-text="${esc([f.aliases.join(", "), f.values.kcal != null ? `${num(f.values.kcal, 0)} kcal / 100 g` : ""].filter(Boolean).join(" · "))}"></ha-list-item-button>`)
            .join("")
        ) +
        ["frida", "usda"]
          .map((source) =>
            group(
              source === "frida" ? "Frida" : "USDA",
              res
                .map((f, n) => [f, n])
                .filter(([f]) => f.source === source)
                .map(([f, n]) => `<ha-list-item-button data-nu-pick="${n}" headline="${esc(f.name)}" supporting-text="${esc([f.group, f.kcal != null ? `${num(f.kcal, 0)} kcal / 100 g` : ""].filter(Boolean).join(" · "))}"></ha-list-item-button>`)
                .join("")
            )
          )
          .join("")
      );
    },

    _nutritionHtml(r) {
      this._nu = this._nu || { open: null, query: "", results: [], foods: null };
      const edit = this._canEdit !== false;
      const st = this._nuData(r);
      const k = this._scale || 1;
      if (!st.data && st.loading) return `<ha-card class="nu"><div class="card-content muted">${esc(h.T("Calculating…"))}</div></ha-card>`;
      if (!st.data) return `<ha-card class="nu"><div class="card-content muted">${esc(st.error)}</div></ha-card>`;
      const d = st.data;
      const banner = d.unlinked
        ? `<ha-alert class="nu-banner" alert-type="warning">${esc(`${d.unlinked} ${h.T("ingredients are not linked to a food yet, so they are matched by their words each time.")}`)}
            ${edit && d.standard.length ? `<ha-button slot="action" size="s" appearance="filled" data-nu="adopt-all">${esc(`${h.T("Accept")} ${d.standard.length} ${h.T("standard choices")}`)}</ha-button>` : ""}</ha-alert>`
        : "";
      return `<ha-card class="nu"><div class="card-content">
          <h2>${esc(r.name)}</h2>
          <p class="muted">${esc(h.T("Every ingredient line is linked to a food. The food knows its other names, what a unit of it weighs and its nutrition, so the calories and macros follow from it."))}</p>
          ${d.counted ? this._nuTableHtml(d, k, true) : ""}
          <div class="muted nu-status">${esc(this._nuStatusText(d))}</div>
          <h3>${esc(h.T("Ingredients and foods"))}</h3>
          ${banner}
          ${edit ? `<div id="nu-selbar" class="nu-selbar" hidden></div>${d.unlinked ? `<ha-button appearance="plain" size="s" data-nu="select-unlinked"><ha-icon slot="start" icon="mdi:checkbox-multiple-marked-outline"></ha-icon>${esc(h.T("Select the ones without a food"))}</ha-button>` : ""}` : ""}
          <ul class="nu-items">${d.items.map((i) => this._nuItemHtml(i, edit)).join("")}</ul>
          <ha-button appearance="plain" data-act="foods"><ha-icon slot="start" icon="mdi:food-apple-outline"></ha-icon>${esc(h.T("Manage foods"))}</ha-button>
          ${this._nuSourceHtml(d)}
        </div></ha-card>`;
    },

    _nuItem(index) {
      const r = this._recipe(this._view.id);
      const st = r && this._nuData(r);
      return st && st.data ? st.data.items.find((i) => i.index === index) : null;
    },

    async _nuSearch(query) {
      this._nu.query = query;
      const ticket = (this._nu.ticket = (this._nu.ticket || 0) + 1);
      if (!query.trim()) {
        this._nu.results = [];
        this._nuPaintResults();
        return;
      }
      this._nu.searching = true;
      const res = await this._nuCall({ type: "hass_recipes/nutrition_search", query, limit: 20 });
      if (ticket !== this._nu.ticket) return; // a newer search is on its way
      this._nu.searching = false;
      this._nu.results = (res || []).filter((f) => f.source === "frida" || f.source === "usda"); // your own foods are listed from the Foods data
      this._nuPaintResults();
    },

    /** Replace only the result list, so the search box keeps its focus and caret. */
    _nuPaintResults() {
      const box = this.shadowRoot.getElementById("nu-results");
      if (!box) return;
      box.innerHTML = this._nuResultsHtml();
      box.querySelectorAll("[data-nu-pick]").forEach((el) => el.addEventListener("click", () => this._nuPick(+el.dataset.nuPick)));
      box.querySelectorAll("[data-nu-own]").forEach((el) => el.addEventListener("click", () => this._nuPickOwn(el.dataset.nuOwn)));
    },

    /** A Frida or USDA food: it becomes one of your foods, with this ingredient name as another name. */
    async _nuPick(n) {
      const food = this._nu.results[n];
      const item = this._nuItem(this._nu.open);
      if (!food || !item) return;
      const ok = await this._nuCall({ type: "hass_recipes/nutrition_link", food: item.food, source: food.source, food_id: food.id });
      if (ok === undefined) return;
      await this._nuClosePicker();
    },

    /** One of your own foods: the ingredient name becomes another name of it. */
    async _nuPickOwn(id) {
      const item = this._nuItem(this._nu.open);
      if (!item) return;
      const ok = await this._nuCall({ type: "hass_recipes/foods_link", key: item.key, food_id: id });
      if (ok === undefined) return;
      await this._nuClosePicker();
    },

    async _nuClosePicker() {
      this._nu.open = null;
      this._nu.results = [];
      this._nu.query = "";
      this._nu.foods = null;
      await this._nuRefresh();
    },

    // ---- several lines at once ----
    _nuSelItems() {
      const sel = (this._nu && this._nu.sel) || new Set();
      return [...sel].map((i) => this._nuItem(i)).filter((i) => i && i.key);
    },

    _nuPaintSel() {
      const bar = this.shadowRoot && this.shadowRoot.getElementById("nu-selbar");
      if (!bar) return;
      const items = this._nuSelItems();
      bar.hidden = !items.length;
      if (!items.length) return;
      const btn = (act, icon, label) => `<ha-button size="s" appearance="plain" data-nusel="${act}"><ha-icon slot="start" icon="mdi:${icon}"></ha-icon>${esc(h.T(label))}</ha-button>`;
      const hasGuess = items.some((i) => !i.own_food && i.match && i.match.source !== "ignore");
      bar.innerHTML = `<ha-icon-button data-nusel="clear" label="${esc(h.T("Clear selection"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>
        <span class="nu-seln">${items.length} ${esc(h.T("selected"))}</span>
        ${btn("assign", "link-variant", "Assign to a food")}${hasGuess ? btn("accept", "check", "Accept suggestions") : ""}${btn("ignore", "cancel", "Don't count")}`;
      bar.querySelectorAll("[data-nusel]").forEach((el) => el.addEventListener("click", () => this._nuSelAct(el.dataset.nusel)));
    },

    async _nuSelAct(act) {
      const items = this._nuSelItems();
      const keys = [...new Set(items.map((i) => i.key))];
      const done = async () => {
        this._nu.sel = new Set();
        this._fdState().data = null; // the Foods page looks again
        await this._nuRefresh();
      };
      if (act === "clear") {
        this._nu.sel = new Set();
        this.shadowRoot.querySelectorAll("[data-nu-sel]").forEach((c) => (c.checked = false));
        return this._nuPaintSel();
      }
      if (!keys.length) return;
      if (act === "assign") return this._fdAssignNames(keys, done);
      if (act === "accept") {
        const res = await this._nuCall({ type: "hass_recipes/foods_adopt", keys });
        if (res !== undefined) {
          await done();
          this._flash(`${res.added} ${h.T("foods added from the suggestions.")}`);
        }
        return;
      }
      if (act === "ignore") {
        for (const key of keys) if ((await this._nuCall({ type: "hass_recipes/nutrition_link", food: key, source: "ignore" })) === undefined) return;
        await done();
      }
    },

    async _nuAct(act, el) {
      const index = el.dataset.i !== undefined ? +el.dataset.i : null;
      const item = index !== null ? this._nuItem(index) : null;
      switch (act) {
        case "select-unlinked": {
          const r = this._recipe(this._view.id);
          const st = r && this._nuData(r);
          this._nu.sel = new Set(((st && st.data && st.data.items) || []).filter((i) => i.key && !i.own_food && i.status !== "ignored").map((i) => i.index));
          this.shadowRoot.querySelectorAll("[data-nu-sel]").forEach((c) => (c.checked = this._nu.sel.has(+c.dataset.nuSel)));
          this._nuPaintSel();
          break;
        }
        case "change": {
          const opening = this._nu.open !== index;
          this._nu.open = opening ? index : null;
          this._nu.query = opening && item ? item.food : "";
          this._nu.results = [];
          this._render();
          if (opening) {
            if (!this._nu.foods) this._nu.foods = await this._nuCall({ type: "hass_recipes/foods" });
            this._render();
            const q = this.shadowRoot.getElementById("nu-q");
            if (q) {
              q.focus();
              if (q.select) q.select();
            }
            this._nuSearch(this._nu.query);
          }
          break;
        }
        case "ignore":
          if (item && (await this._nuCall({ type: "hass_recipes/nutrition_link", food: item.food, source: "ignore" })) !== undefined) await this._nuRefresh();
          break;
        case "reset":
          if (item && (await this._nuCall({ type: "hass_recipes/nutrition_link", food: item.food, source: null })) !== undefined) await this._nuRefresh();
          break;
        case "unit": {
          const input = this.shadowRoot.getElementById(`nu-ug-${index}`);
          const grams = input ? parseFloat(String(input.value).replace(",", ".")) : NaN;
          if (!item || !(grams > 0)) {
            if (input) input.focus();
            return;
          }
          if ((await this._nuCall({ type: "hass_recipes/nutrition_unit_grams", food: item.food, unit: el.dataset.unit, grams })) !== undefined)
            await this._nuRefresh();
          break;
        }
        case "accept":
          if (item && (await this._nuCall({ type: "hass_recipes/foods_adopt", keys: [item.key] })) !== undefined) await this._nuRefresh();
          break;
        case "adopt-all": {
          const r = this._recipe(this._view.id);
          const st = r && this._nuData(r);
          const keys = st && st.data ? st.data.standard : [];
          const res = await this._nuCall({ type: "hass_recipes/foods_adopt", keys });
          if (res !== undefined) {
            await this._nuRefresh();
            this._flash(`${res.added} ${h.T("foods added from standard choices.")}`);
          }
          break;
        }
        case "food":
          if (item && item.own_food) this._go({ name: "foods", id: item.own_food.id });
          break;
        case "create": {
          // the Foods page, with a new food started from this name (and the suggestion, if there is one)
          if (!item) return;
          const m = item.match && (item.match.source === "frida" || item.match.source === "usda") ? item.match : null;
          const fd = this._fdState();
          fd.draft = {
            id: "", name: item.key.charAt(0).toUpperCase() + item.key.slice(1), aliases: [], section: "", unit_rows: [], used_in: 0, recipes: [],
            source: m ? m.source : "none", frida_id: m && m.source === "frida" ? m.id : null, frida_name: m && m.source === "frida" ? m.name : "",
            usda_id: m && m.source === "usda" ? m.id : null, usda_name: m && m.source === "usda" ? m.name : "",
            values: m ? { kcal: m.kcal, fat: m.fat, carbs: m.carbs, protein: m.protein } : {},
          };
          fd.draftFor = "new";
          this._fdKeep = true;
          this._go({ name: "foods", id: "new" });
          break;
        }
      }
    },

    _bindNutrition(root, on) {
      this._nuMountTables(root);
      this._nu = this._nu || { open: null, query: "", results: [], foods: null };
      if (this._nu.selFor !== this._view.id) this._nu.sel = new Set();
      this._nu.selFor = this._view.id;
      on("[data-nu-sel]", "change", (e) => {
        const i = +e.currentTarget.dataset.nuSel;
        if (e.currentTarget.checked) this._nu.sel.add(i);
        else this._nu.sel.delete(i);
        this._nuPaintSel();
      });
      this._nuPaintSel();
      on("[data-nu]", "click", (e) => this._nuAct(e.currentTarget.dataset.nu, e.currentTarget));
      on("[data-nu-pick]", "click", (e) => this._nuPick(+e.currentTarget.dataset.nuPick));
      on("[data-nu-own]", "click", (e) => this._nuPickOwn(e.currentTarget.dataset.nuOwn));
      const q = root.getElementById("nu-q");
      if (q) {
        let timer = null;
        q.addEventListener("input", () => {
          clearTimeout(timer);
          timer = setTimeout(() => this._nuSearch(q.value), 200);
          this._nu.query = q.value;
          this._nuPaintResults();
        });
        q.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && this._nu.results.length) {
            e.preventDefault();
            this._nuPick(0);
          }
          if (e.key === "Escape") this._nuAct("change", { dataset: { i: String(this._nu.open) } });
        });
      }
      on(".nu-unit ha-input", "keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const btn = e.currentTarget.parentElement.querySelector("[data-nu='unit']");
        if (btn) btn.click();
      });
    },
  };
}
