/* Recipes panel: calories and macros. Mixed into the panel class by recipes-panel.js.
 *
 * The server does the sums (nutrition.py); this module shows them on the recipe page and
 * offers a page (#/recipe/<id>/nutrition) to check which food each ingredient was matched
 * to, choose another one, give a weight for units the parser cannot weigh ("1 dåse"), and
 * keep your own custom ingredients.
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
  // custom-ingredient form fields, in the order of a nutrition label
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
    _nuTableHtml(d, k, full) {
      const rows = (full ? ALL : MAIN)
        .map(([key, label, unit]) => {
          const whole = d.total[key] == null ? null : d.total[key] * k;
          const sub = key === "sugars" || key === "sat_fat";
          return `<tr class="${sub ? "nu-sub" : ""}"><th scope="row">${esc(label)}</th>${
            d.per_serving ? `<td>${esc(amount(d.per_serving[key], unit))}</td>` : ""
          }<td>${esc(amount(whole, unit))}</td></tr>`;
        })
        .join("");
      const wholeHead = k === 1 ? "Whole recipe" : `Whole recipe ×${num(k, 2)}`;
      return `<table class="nu-table"><thead><tr><td></td>${d.per_serving ? `<th scope="col">Per serving</th>` : ""}<th scope="col">${esc(wholeHead)}</th></tr></thead><tbody>${rows}</tbody></table>`;
    },

    _nuStatusText(d) {
      const total = d.items.filter((i) => i.status !== "ignored").length;
      const parts = [`Estimate · ${d.counted} of ${total} ingredients counted`];
      if (d.unconfirmed) parts.push(`${d.unconfirmed} matched automatically`);
      return parts.join(" · ");
    },

    _nuSourceHtml(d) {
      const s = d.source || {};
      return `<div class="nu-src">Nutrition data: <a href="${esc(s.url || "https://frida.fooddata.dk")}" target="_blank" rel="noopener noreferrer">${esc(
        s.attribution || "The Danish Food Composition Database"
      )}</a>, <a href="${esc(s.license_url || "https://creativecommons.org/licenses/by/4.0/")}" target="_blank" rel="noopener noreferrer">${esc(s.license || "CC BY 4.0")}</a></div>`;
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
              ${!d.per_serving ? `<div class="muted">Add the number of servings to the recipe to see values per serving.</div>` : ""}
            </div>`
          : `<div class="card-content muted">None of the ingredients could be counted yet.</div>`;
        body += `<div class="card-actions"><ha-button appearance="plain" size="s" data-act="nutrition" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:${
          attention ? "playlist-check" : "format-list-bulleted"
        }"></ha-icon>${attention ? "Check ingredients" : "Show ingredients"}</ha-button></div>${this._nuSourceHtml(d)}`;
      }
      return `<ha-card class="rd-nut" header="Nutrition">${body}</ha-card>`;
    },

    // ---- the nutrition page ----
    _nuTag(item) {
      const m = item.match;
      if (item.status === "ignored") return ["Not counted", "muted"];
      if (!m) return ["", ""];
      if (m.source === "custom") return ["Custom ingredient", "ok"];
      if (m.auto) return ["Matched automatically", "auto"];
      if (m.default) return ["Standard choice", "ok"];
      return ["Your choice", "ok"];
    },

    _nuChip(tag, tone) {
      return `<ha-assist-chip class="nu-tag ${tone}" label="${esc(tag)}"></ha-assist-chip>`;
    },

    _nuWarn(text) {
      return `<ha-alert class="nu-warn" alert-type="warning">${esc(text)}</ha-alert>`;
    },

    _nuItemHtml(item, edit) {
      const [tag, tone] = this._nuTag(item);
      const m = item.match;
      const open = this._nu.open === item.index;
      const kcal = item.values && item.values.kcal != null ? `${num(item.values.kcal, 0)} kcal` : "";
      let detail = "";
      if (item.status === "no_match") detail = this._nuWarn(h.T("Not matched to a food, so it is not counted."));
      else if (item.status === "no_grams") {
        const unit = item.unit_text || item.unit || "";
        detail = this._nuWarn(h.T(item.quantity == null ? "No amount, so it is not counted." : "The weight is unknown, so it is not counted."));
        if (edit && item.quantity != null && m && m.source !== "ignore")
          detail += `<div class="nu-unit"><ha-input id="nu-ug-${item.index}" type="text" appearance="outlined" label="${esc(`1 ${unit || h.T("piece")} = … g`)}"></ha-input>
            <ha-button size="s" appearance="filled" data-nu="unit" data-i="${item.index}" data-unit="${esc(item.unit || "piece")}">${esc(h.T("Save weight"))}</ha-button></div>`;
      }
      const ug = m && m.unit_grams ? Object.entries(m.unit_grams) : [];
      const acts = edit
        ? `<div class="nu-acts">
            <ha-button appearance="plain" size="s" data-nu="change" data-i="${item.index}">${esc(h.T(open ? "Close" : m ? "Change food" : "Choose food"))}</ha-button>
            ${item.status !== "ignored" ? `<ha-button appearance="plain" size="s" data-nu="ignore" data-i="${item.index}">${esc(h.T("Don't count"))}</ha-button>` : ""}
            ${m && m.linked ? `<ha-button appearance="plain" size="s" data-nu="reset" data-i="${item.index}">${esc(h.T("Reset"))}</ha-button>` : ""}
          </div>`
        : "";
      const matchLine =
        m && m.source !== "ignore"
          ? `<div class="nu-match"><ha-icon icon="mdi:arrow-right-bottom"></ha-icon><span><b>${esc(m.name)}</b>${
              item.grams != null ? ` · ${num(item.grams)} g` : ""
            }${ug.length ? ` · ${ug.map(([u, g]) => `1 ${esc(u === item.unit && item.unit_text ? item.unit_text : u)} = ${num(g)} g`).join(", ")}` : ""}</span>${tag ? this._nuChip(tag, tone) : ""}</div>`
          : tag
          ? `<div class="nu-match">${this._nuChip(tag, tone)}</div>`
          : "";
      return `<li class="nu-item s-${item.status}">
          <div class="nu-line"><span class="nu-text">${esc(item.text)}</span><span class="nu-kcal">${esc(kcal)}</span></div>
          ${matchLine}${detail}${acts}
          ${open ? this._nuPickerHtml(item) : ""}
        </li>`;
    },

    _nuPickerHtml(item) {
      return `<div class="nu-picker">
          <ha-input-search id="nu-q" appearance="outlined" placeholder="${esc(h.T("Search foods"))}" value="${esc(this._nu.query)}"></ha-input-search>
          <div id="nu-results">${this._nuResultsHtml()}</div>
          <ha-button appearance="plain" size="s" data-nu="custom-new" data-i="${item.index}">${esc(h.T("New custom ingredient…"))}</ha-button>
        </div>`;
    },

    _nuResultsHtml() {
      const res = this._nu.results;
      if (this._nu.searching && !res.length) return `<div class="muted">${esc(h.T("Searching…"))}</div>`;
      if (!res.length) return this._nu.query ? `<div class="muted">${esc(h.T("No foods found. Try another word, or make a custom ingredient."))}</div>` : "";
      return `<ha-list-base class="nu-results">${res
        .map(
          (f, n) => `<ha-list-item-button data-nu-pick="${n}" headline="${esc(f.name)}" supporting-text="${esc(
            [f.group, f.kcal != null ? `${num(f.kcal, 0)} kcal / 100 g` : ""].filter(Boolean).join(" · ")
          )}">${f.source === "custom" ? `<ha-assist-chip slot="end" label="${esc(h.T("Custom"))}"></ha-assist-chip>` : ""}</ha-list-item-button>`
        )
        .join("")}</ha-list-base>`;
    },

    /** The custom ingredient form is Home Assistant's own ha-form; it is given its schema and data after the render. */
    _nuFormHtml() {
      const f = this._nu.form;
      if (!f) return "";
      return `<div class="nu-form" id="nu-form">
          <h3>${esc(h.T(f.id ? "Edit custom ingredient" : "New custom ingredient"))}</h3>
          ${f.link_food ? `<p class="muted">${esc(`It will be used for “${f.link_food}”.`)}</p>` : ""}
          <p class="muted">${esc(h.T("Values per 100 g, as on the nutrition label. Only the energy is required."))}</p>
          <ha-form id="nu-form-ha"></ha-form>
          <div class="nu-acts">
            <ha-button appearance="filled" data-nu="custom-save">${esc(h.T("Save"))}</ha-button>
            <ha-button appearance="plain" data-nu="custom-cancel">${esc(h.T("Cancel"))}</ha-button>
          </div>
        </div>`;
    },

    _nutritionHtml(r) {
      this._nu = this._nu || { open: null, query: "", results: [], form: null, custom: null };
      if (this._nu.custom === null) this._nuLoadCustom();
      const edit = this._canEdit !== false;
      const st = this._nuData(r);
      const k = this._scale || 1;
      if (!st.data && st.loading) return `<ha-card class="nu"><div class="card-content muted">${esc(h.T("Calculating…"))}</div></ha-card>`;
      if (!st.data) return `<ha-card class="nu"><div class="card-content muted">${esc(st.error)}</div></ha-card>`;
      const d = st.data;
      const custom = this._nu.custom || [];
      return `<ha-card class="nu"><div class="card-content">
          <h2>${esc(r.name)}</h2>
          <p class="muted">Calories and macros are estimated from what each ingredient weighs and the food it is matched to. Check the matches below; your choices are remembered for every recipe that uses the same ingredient.</p>
          ${d.counted ? this._nuTableHtml(d, k, true) : ""}
          <div class="muted nu-status">${esc(this._nuStatusText(d))}</div>
          <h3>Ingredients</h3>
          <ul class="nu-items">${d.items.map((i) => this._nuItemHtml(i, edit)).join("")}</ul>
          ${this._nuFormHtml()}
          <h3>Custom ingredients</h3>
          ${
            custom.length
              ? `<ha-list-base class="nu-custom">${custom
                  .map(
                    (c) => `<ha-list-item-base headline="${esc(c.name)}" supporting-text="${esc(
                      ALL.filter(([key]) => c[key] != null).map(([key, label, unit]) => `${label.replace(/^of which /, "")} ${amount(c[key], unit)}`).slice(0, 4).join(" · ")
                    )} / 100 g">${
                      edit
                        ? `<span slot="end" class="nu-cacts"><ha-icon-button data-nu="custom-edit" data-id="${esc(c.id)}" label="${esc(h.T("Edit"))}"><ha-icon icon="mdi:pencil-outline"></ha-icon></ha-icon-button><ha-icon-button data-nu="custom-delete" data-id="${esc(c.id)}" label="${esc(h.T("Delete"))}"><ha-icon icon="mdi:delete-outline"></ha-icon></ha-icon-button></span>`
                        : ""
                    }</ha-list-item-base>`
                  )
                  .join("")}</ha-list-base>`
              : `<p class="muted">${esc(h.T("For homemade things and products Frida does not have: give the values per 100 g once and use them in any recipe."))}</p>`
          }
          ${edit && !this._nu.form ? `<ha-button appearance="plain" data-nu="custom-new"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(h.T("New custom ingredient…"))}</ha-button>` : ""}
          ${this._nuSourceHtml(d)}
        </div></ha-card>`;
    },

    async _nuLoadCustom() {
      this._nu.custom = [];
      const custom = await this._nuCall({ type: "hass_recipes/nutrition_custom_list" });
      this._nu.custom = custom || [];
      if (this._view.name === "nutrition") this._render();
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
      this._nu.results = res || [];
      this._nuPaintResults();
    },

    /** Replace only the result list, so the search box keeps its focus and caret. */
    _nuPaintResults() {
      const box = this.shadowRoot.getElementById("nu-results");
      if (!box) return;
      box.innerHTML = this._nuResultsHtml();
      box.querySelectorAll("[data-nu-pick]").forEach((el) => el.addEventListener("click", () => this._nuPick(+el.dataset.nuPick)));
    },

    async _nuPick(n) {
      const food = this._nu.results[n];
      const item = this._nuItem(this._nu.open);
      if (!food || !item) return;
      const ok = await this._nuCall({ type: "hass_recipes/nutrition_link", food: item.food, source: food.source, food_id: food.id });
      if (ok === undefined) return;
      this._nu.open = null;
      this._nu.results = [];
      this._nu.query = "";
      await this._nuRefresh();
    },

    _nuReadForm() {
      return { ...this._nu.form };
    },

    async _nuAct(act, el) {
      const index = el.dataset.i !== undefined ? +el.dataset.i : null;
      const item = index !== null ? this._nuItem(index) : null;
      switch (act) {
        case "change": {
          const opening = this._nu.open !== index;
          this._nu.open = opening ? index : null;
          this._nu.query = opening && item ? item.food : "";
          this._nu.results = [];
          this._render();
          if (opening) {
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
        case "custom-new":
          this._nu.form = item ? { name: item.food, link_food: item.food } : { name: "" };
          this._nu.open = null;
          this._render();
          this._nuFocusForm();
          break;
        case "custom-edit": {
          const c = (this._nu.custom || []).find((x) => x.id === el.dataset.id);
          if (c) {
            this._nu.form = { ...c };
            this._render();
            this._nuFocusForm();
          }
          break;
        }
        case "custom-cancel":
          this._nu.form = null;
          this._render();
          break;
        case "custom-save": {
          const f = this._nuReadForm();
          this._nu.form = f;
          if (!f.name || !(f.kcal >= 0)) {
            this._error = h.T("Give the ingredient a name and its energy in kcal per 100 g.");
            this._render();
            this._nuFocusForm();
            return;
          }
          const msg = { type: "hass_recipes/nutrition_custom_save", name: f.name };
          for (const [key] of FORM) if (f[key] != null && !Number.isNaN(f[key])) msg[key] = f[key];
          if (f.id) msg.food_id = f.id;
          if (f.link_food) msg.link_food = f.link_food;
          if ((await this._nuCall(msg)) === undefined) return;
          this._nu.form = null;
          this._nu.custom = null; // reload the list
          await this._nuRefresh();
          break;
        }
        case "custom-delete": {
          const c = (this._nu.custom || []).find((x) => x.id === el.dataset.id);
          if (!c || !confirm(h.T(`Delete the custom ingredient “${c.name}”? Recipes that use it are matched again.`))) return;
          if ((await this._nuCall({ type: "hass_recipes/nutrition_custom_delete", food_id: c.id })) === undefined) return;
          this._nu.custom = null;
          await this._nuRefresh();
          break;
        }
      }
    },

    _nuFocusForm() {
      const form = this.shadowRoot.getElementById("nu-form");
      if (!form) return;
      form.scrollIntoView({ block: "center", behavior: "smooth" });
      const ha = form.querySelector("ha-form");
      const name = ha && ha.shadowRoot && ha.shadowRoot.querySelector("ha-selector-text, ha-input");
      if (name && name.focus) name.focus();
    },

    _bindNutrition(root, on) {
      on("[data-nu]", "click", (e) => this._nuAct(e.currentTarget.dataset.nu, e.currentTarget));
      on("[data-nu-pick]", "click", (e) => this._nuPick(+e.currentTarget.dataset.nuPick));
      const q = root.getElementById("nu-q");
      if (q) {
        let timer = null;
        q.addEventListener("input", () => {
          clearTimeout(timer);
          timer = setTimeout(() => this._nuSearch(q.value), 200);
        });
        q.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && this._nu.results.length) {
            e.preventDefault();
            this._nuPick(0);
          }
          if (e.key === "Escape") this._nuAct("change", { dataset: { i: String(this._nu.open) } });
        });
      }
      // the custom ingredient form: Home Assistant's ha-form, kept in this._nu.form as it changes
      const ff = root.getElementById("nu-form-ha");
      if (ff) {
        const f = this._nu.form;
        ff.hass = this._hass;
        ff.schema = [
          { name: "name", required: true, selector: { text: {} } },
          { type: "grid", name: "", schema: FORM.map(([key]) => ({ name: key, required: key === "kcal", selector: { number: { min: 0, step: "any", mode: "box" } } })) },
        ];
        ff.computeLabel = (sc) => (sc.name === "name" ? h.T("Name") : h.T((FORM.find(([k]) => k === sc.name) || [])[1] || sc.name));
        ff.data = { name: f.name || "", ...Object.fromEntries(FORM.filter(([k]) => f[k] != null).map(([k]) => [k, f[k]])) };
        ff.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          const v = e.detail.value || {};
          ff.data = v;
          this._nu.form.name = String(v.name || "").trim();
          for (const [key] of FORM) this._nu.form[key] = v[key] == null || Number.isNaN(v[key]) ? null : v[key];
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
