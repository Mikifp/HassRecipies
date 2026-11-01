/* Recipes panel: recipe methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, minutes, formatNumber, baseServings, normStep, isHeader, headerText, timerSpecs, duration, ingredientText, fmtYield, SCALES, scaleBasis, T, state, TODO_KEY, ingredientHtml, ingredientChipHtml, splitSubs, ingredientParts, stepTextHtml } = h;
  return {
    // ---- shopping list (HA to-do entities) ----
    _todoEntities() {
      const states = (this._hass && this._hass.states) || {};
      return Object.keys(states)
        .filter((id) => id.startsWith("todo."))
        .map((id) => ({ id, name: (states[id].attributes && states[id].attributes.friendly_name) || id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    _shopHtml(r) {
      const lists = this._todoEntities();
      let chosen = this._shopEntity;
      if (!lists.some((l) => l.id === chosen)) {
        let saved = null;
        try {
          saved = localStorage.getItem(TODO_KEY);
        } catch (_) { /* ignore */ }
        chosen = lists.some((l) => l.id === saved) ? saved : (lists.find((l) => l.id === "todo.shopping_list") || lists[0] || {}).id;
        this._shopEntity = chosen;
      }
      const k = this._scale;
      const result = this._shopResult;
      const back = (label, appearance = "filled") => `<ha-button appearance="${appearance}" data-act="shop-done" data-id="${esc(r.id)}">${esc(T(label))}</ha-button>`;
      if (result) {
        return `<ha-card class="shop" header="${esc(T("Shopping list updated"))}"><div class="card-content">
          <p>${esc(T("Added"))} <strong>${result.added.length}</strong> ${esc(T("item(s) to"))} <em>${esc(result.entity_id)}</em>${result.skipped.length ? `, ${esc(T("skipped"))} ${result.skipped.length} ${esc(T("already on the list"))}` : ""}.</p>
          ${result.added.length ? `<ha-list-base>${result.added.map((i) => `<ha-list-item-base headline="${esc(i)}"></ha-list-item-base>`).join("")}</ha-list-base>` : ""}</div>
          <div class="card-actions">${back("Back to recipe")}</div></ha-card>`;
      }
      if (!lists.length) {
        return `<ha-card class="shop" header="${esc(T("Add to shopping list"))}"><div class="card-content">
          <ha-alert alert-type="warning">${esc(T("No to-do lists were found in Home Assistant. Add the Shopping list integration (or any to-do integration) first."))}</ha-alert></div>
          <div class="card-actions">${back("Back", "plain")}</div></ha-card>`;
      }
      const items = r.ingredients
        .map((raw, i) =>
          isHeader(raw)
            ? `<div class="rd-sh shop-sec">${esc(headerText(raw))}</div>`
            : `<ha-check-list-item left data-shop="${i}" ${this._shopSel.has(i) ? "selected" : ""}>${esc(ingredientText(r, i, k, this._units))}</ha-check-list-item>`
        )
        .join("");
      return `<ha-card class="shop" header="${esc(T("Add to shopping list"))}">
          <div class="card-content">
            <p class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · ${esc(T(this._units === "grams" ? "grams" : "as written"))}. ${esc(T("Untick things you already have."))}</p>
            <ha-form id="shop-form"></ha-form>
          </div>
          <ha-list multi>${items}</ha-list>
          <div class="card-actions">
            <ha-button appearance="filled" data-act="shop-add" data-id="${esc(r.id)}" ${this._shopSel.size ? "" : "disabled"}><ha-icon slot="start" icon="mdi:cart-plus"></ha-icon>${esc(`${T("Add")} ${this._shopSel.size} ${T("item(s)")}`)}</ha-button>
            ${back("Cancel", "plain")}
          </div>
        </ha-card>`;
    },

    /** The list to send to: Home Assistant's own form field. */
    _bindShop(root) {
      const form = root.getElementById("shop-form");
      if (form) {
        const lists = this._todoEntities();
        form.hass = this._hass;
        form.schema = [{ name: "list", selector: { select: { mode: "dropdown", options: lists.map((l) => ({ value: l.id, label: l.name })) } } }];
        form.data = { list: this._shopEntity };
        form.computeLabel = () => T("List");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          if (e.detail.value && e.detail.value.list) this._shopEntity = e.detail.value.list;
        });
      }
      root.querySelectorAll("ha-check-list-item[data-shop]").forEach((el) =>
        el.addEventListener("request-selected", (e) => {
          if (!e.detail || e.detail.source !== "interaction") return;
          const i = +el.dataset.shop;
          if (e.detail.selected) this._shopSel.add(i);
          else this._shopSel.delete(i);
          this._render();
        })
      );
    },

    async _shopAdd(id) {
      try {
        const res = await this._ws({
          type: "call_service",
          domain: "hass_recipes",
          service: "add_to_shopping_list",
          service_data: {
            recipe: id,
            entity_id: this._shopEntity,
            scale: this._scale,
            units: this._units,
            ingredients: [...this._shopSel].sort((a, b) => a - b),
          },
          return_response: true,
        });
        try {
          localStorage.setItem(TODO_KEY, this._shopEntity);
        } catch (_) { /* ignore */ }
        this._shopResult = res.response;
      } catch (err) {
        this._error = err.message || String(err);
      }
      this._render();
    },

    // ---- shared list renderers ----
    _ingredientsListHtml(r, k) {
      return this._rdIngredientGroups(r)
        .map((g) => {
          const items = g.items
            .map((n) => `<ha-check-list-item left data-ing="${n}" ${this._checked.has(n) ? "selected" : ""}><span class="ing-text">${ingredientHtml(r, n, k, this._units)}</span></ha-check-list-item>`)
            .join("");
          return `${g.title ? `<div class="rd-sh cook-sec">${esc(g.title)}</div>` : ""}<ha-list multi>${items}</ha-list>`;
        })
        .join("");
    },

    /** A step's text with the ingredients it names as chips, and chips for the ones it does not name. */
    _stepTextParts(r, s, k, n) {
      const idx = this._stepChipIngredients(r, s);
      const items = idx.map((i) => ({ key: i, text: ingredientParts(r, i).main, names: this._foodNamesFor(r, i) }));
      const chip = (i) => ingredientChipHtml(r, i, k, this._units, { key: `${n}:${i}`, done: this._doneChips.has(`${n}:${i}`) }, this._chipAlt);
      const { html, placed } = stepTextHtml(s.text, items, chip);
      const links = idx
        .filter((i) => !placed.has(i))
        .map(chip)
        .join("");
      return { html, links };
    },

    /** The ingredients a step names, which can be ticked off one by one. */
    _stepChipIngredients(r, s) {
      return s.ingredients.filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]));
    },

    /** Tick (or untick) one ingredient chip of a step; a step whose chips are all ticked is done. */
    _toggleChip(n, i) {
      const r = this._recipe(this._view.id);
      if (!r) return;
      const s = normStep(r.instructions[n]);
      const key = `${n}:${i}`;
      if (this._doneChips.has(key)) this._doneChips.delete(key);
      else this._doneChips.add(key);
      const chips = this._stepChipIngredients(r, s);
      const all = chips.length > 0 && chips.every((c) => this._doneChips.has(`${n}:${c}`));
      if (all) this._doneSteps.add(n);
      else this._doneSteps.delete(n);
      this._saveProgress();
      this._checkAllDone();
      this._render();
    },


    /** One start button per timer of a step. `n` is the step's index, `num` its number among the steps. */
    _timerButtonsHtml(r, st, n, num, extra = "") {
      return timerSpecs(r, n, num, st.timers || [], state.language)
        .map((sp) => {
          const running = this._timerRunning(sp.key);
          const what = sp.name ? ` (${esc(sp.name)})` : "";
          return `<ha-button class="timer-btn" appearance="${extra === "secondary" ? "outlined" : "filled"}" data-timer-key="${esc(sp.key)}" data-timer-label="${esc(sp.label)}" data-timer-step="${n}" data-sec="${sp.seconds}" ${running ? "disabled" : ""}><ha-icon slot="start" icon="mdi:timer-outline"></ha-icon>${
            running ? "Timer running" : `Start ${duration(sp.seconds)} timer${what}`
          }</ha-button>`;
        })
        .join("");
    },

    // ---- cook mode: one big step at a time ----
    _cookSteps(r) {
      return r.instructions
        .map(normStep)
        .map((st, i) => ({ ...st, i }))
        .filter((st) => !st.section);
    },

    /** Where each section starts among the cook steps: [{ n, title }] (empty unless there are 2 or more). */
    _cookSections(r) {
      const starts = [];
      let n = 0;
      let title = null;
      let first = true;
      for (const st of r.instructions.map(normStep)) {
        if (st.section) {
          title = st.text;
          first = false;
          starts.push({ n, title });
          continue;
        }
        if (first && n === 0) starts.push({ n: 0, title: "" });
        first = false;
        n += 1;
      }
      // a heading with no steps after it, or two in a row, is not a place to go to
      const cookCount = n;
      const real = starts.filter((s, i) => s.n < cookCount && (i === starts.length - 1 || starts[i + 1].n > s.n));
      return real.length >= 2 ? real : [];
    },

    _cookSection(delta) {
      const r = this._recipe(this._view.id);
      if (!r) return;
      const starts = this._cookSections(r);
      const steps = this._cookSteps(r);
      const cur = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
      let at = 0;
      starts.forEach((s, i) => {
        if (s.n <= cur) at = i;
      });
      let target = null;
      if (delta > 0) target = starts[at + 1];
      else target = starts[at].n < cur ? starts[at] : starts[at - 1];
      if (!target) return;
      this._view = { ...this._view, step: target.n };
      this._render();
      this.scrollTo(0, 0);
    },

    _cookSectionNavHtml(r, cur) {
      const starts = this._cookSections(r);
      if (!starts.length) return "";
      let at = 0;
      starts.forEach((s, i) => {
        if (s.n <= cur) at = i;
      });
      const prev = starts[at].n < cur ? starts[at] : starts[at - 1];
      const next = starts[at + 1];
      const btn = (act, target, label, first) =>
        `<ha-button appearance="outlined" class="cook-secbtn" data-act="${act}" ${target ? "" : "disabled"}><ha-icon slot="${first ? "start" : "end"}" icon="mdi:${first ? "skip-previous" : "skip-next"}"></ha-icon>${esc(T(label))}${
          target && target.title ? `<small>${esc(target.title)}</small>` : ""
        }</ha-button>`;
      return `<div class="cook-sections">${btn("cook-sec-prev", prev, "Previous section", true)}${btn("cook-sec-next", next, "Next section", false)}</div>`;
    },

    _cookHtml(r) {
      const steps = this._cookSteps(r);
      const n = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
      const st = steps[n];
      const k = this._scale;
      if (!st) {
        return `<div class="cook"><p>${esc(T("This recipe has no steps yet."))}</p>
          <div class="cook-nav"><ha-button appearance="outlined" data-act="cook-exit">${esc(T("Exit"))}</ha-button></div></div>`;
      }
      // The heading this step sits under, if any.
      let section = "";
      for (const x of r.instructions.map(normStep).slice(0, st.i)) if (x.section) section = x.text;
      const { html: textHtml, links } = this._stepTextParts(r, st, k, st.i);
      const last = n === steps.length - 1;
      const done = this._doneSteps.has(st.i);
      return `
        <div class="cook">
          <div class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · ${esc(T("Step"))} ${n + 1} ${esc(T("of"))} ${steps.length}</div>
          <ha-control-slider id="cook-bar" class="cook-bar" data-n="${n + 1}" data-of="${steps.length}"></ha-control-slider>
          ${section ? `<div class="cook-section">${esc(section)}</div>` : ""}
          <div class="cook-text" data-step-toggle="${st.i}" style="${done ? "opacity:.55;text-decoration:line-through" : ""}" title="${esc(T("Tap to mark as done"))}">${textHtml}</div>
          ${links ? `<div class="step-ings">${links}</div>` : ""}
          ${this._chipAltHtml()}
          ${this._timerButtonsHtml(r, st, st.i, n + 1)}
          <ha-formfield class="cook-done" label="${esc(T("Mark this step as done"))}"><ha-checkbox data-step-done="${st.i}" ${done ? "checked" : ""}></ha-checkbox></ha-formfield>
          ${this._cookSectionNavHtml(r, n)}
          <div class="cook-nav">
            <ha-button appearance="outlined" size="l" data-act="cook-prev" ${n === 0 ? "disabled" : ""}><ha-icon slot="start" icon="mdi:arrow-left"></ha-icon>${esc(T("Previous"))}</ha-button>
            <ha-button appearance="filled" size="l" data-act="${last ? "cook-finish" : "cook-next"}">${esc(T(last ? "Finish" : "Next"))}<ha-icon slot="end" icon="mdi:${last ? "check" : "arrow-right"}"></ha-icon></ha-button>
          </div>
          <ha-expansion-panel id="cook-ings" left-chevron ${this._cookIngredients ? "expanded" : ""}>
            <div slot="header">${esc(T("All ingredients"))}</div>
            ${this._ingredientsListHtml(r, k)}
          </ha-expansion-panel>
          <div class="cook-actions">
            <ha-button appearance="plain" data-act="cook-focus">${esc(T("Show all steps"))}</ha-button>
            <ha-button appearance="plain" data-act="cook-exit">${esc(T("Exit cook mode"))}</ha-button>
          </div>
        </div>`;
    },

    /** Mealie-style cook mode: the whole recipe at once, ingredients beside the steps. */
    _cookAllHtml(r) {
      const k = this._scale;
      const all = r.instructions.map(normStep);
      const firstOpen = all.findIndex((st, i) => !st.section && !this._doneSteps.has(i));
      let num = 0;
      const steps = all
        .map((st, n) => {
          if (st.section) return `<h3 class="csection" data-sec="${n}">${esc(st.text)}</h3>`;
          num += 1;
          const done = this._doneSteps.has(n);
          const { html: textHtml, links } = this._stepTextParts(r, st, k, n);
          const running = this._timerRunning(`${r.id}:${n}`);
          return `<ha-card class="cstep ${done ? "done" : ""} ${n === firstOpen ? "current" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0">
            <div class="card-content">
              <div class="cstep-head"><span>${esc(T("Step"))} ${num}</span>${done ? `<ha-icon icon="mdi:check-circle" class="cstep-tick"></ha-icon>` : `<ha-icon icon="mdi:circle-outline" class="cstep-tick off"></ha-icon>`}</div>
              <div class="cstep-text">${textHtml}</div>
              ${links ? `<div class="step-ings">${links}</div>` : ""}
              ${this._timerButtonsHtml(r, st, n, num)}
            </div>
          </ha-card>`;
        })
        .join("");
      const makes = r.yield_amount ? ` · Makes ${fmtYield(r.yield_amount * k)} ${esc(r.yield_unit || "")}` : "";
      return `
        <div class="cookp">
          <div class="cook-top">
            <h2>${esc(r.name)}<span class="muted" style="font-weight:400">${makes}</span></h2>
            ${this._rdScaleHtml(r, k)}
            ${(() => {
              const jumps = all.map((x, n) => ({ x, n })).filter((o) => o.x.section);
              return this._cookSections(r).length
                ? `<span class="cook-jumps">${jumps
                    .map((o) => `<ha-assist-chip data-act="cook-jump" data-id="${o.n}" label="${esc(o.x.text)}"></ha-assist-chip>`)
                    .join("")}</span>`
                : "";
            })()}
            <ha-button appearance="outlined" data-act="cook-focus">${esc(T("One step at a time"))}</ha-button>
            <ha-button appearance="plain" data-act="cook-exit">${esc(T("Exit"))}</ha-button>
          </div>
          <div class="cook-cols">
            ${
              this._brCompact()
                ? `<ha-expansion-panel class="cook-ings-panel" left-chevron outlined><div slot="header">${esc(T("Ingredients"))}</div>${this._ingredientsListHtml(r, k)}</ha-expansion-panel>`
                : `<ha-card class="cook-ings" header="${esc(T("Ingredients"))}">${this._ingredientsListHtml(r, k)}</ha-card>`
            }
            <section class="cook-steps">${steps || `<p class="muted">${esc(T("This recipe has no steps yet."))}</p>`}</section>
          </div>
        </div>`;
    },

    _cookStep(delta) {
      const r = this._recipe(this._view.id);
      if (!r) return;
      const steps = this._cookSteps(r);
      const cur = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
      if (delta > 0 && steps[cur]) {
        // Moving on counts as having finished this step.
        this._doneSteps.add(steps[cur].i);
        this._saveProgress();
        this._checkAllDone();
      }
      this._view = { ...this._view, step: Math.min(Math.max(cur + delta, 0), Math.max(steps.length - 1, 0)) };
      this._render();
      this.scrollTo(0, 0);
    },

    /** Ingredients as sections: [{ title, items: [index] }]; the loose ones (before any heading) come first. */
    _rdIngredientGroups(r) {
      const groups = [{ title: "", items: [] }];
      r.ingredients.forEach((raw, n) => {
        if (isHeader(raw)) groups.push({ title: headerText(raw), items: [] });
        else groups[groups.length - 1].items.push(n);
      });
      return groups.filter((g) => g.items.length || g.title);
    },

    /** Steps as sections: [{ title, steps: [{ s, n, num }] }]. */
    _rdStepGroups(r) {
      const groups = [{ title: "", steps: [] }];
      let num = 0;
      r.instructions.map(normStep).forEach((s, n) => {
        if (s.section) groups.push({ title: s.text, steps: [] });
        else groups[groups.length - 1].steps.push({ s, n, num: ++num });
      });
      return groups.filter((g) => g.steps.length || g.title);
    },

    /** The amount box and the multiplier buttons (the recipe page and cook mode share them). */
    _bindScale(root) {
      const r = this._recipe(this._view.id);
      if (!r) return;
      const amount = root.getElementById("amount");
      if (amount) amount.value = fmtYield(scaleBasis(r).base * this._scale);
      const tg = root.getElementById("rd-scale");
      if (tg) {
        tg.buttons = SCALES.map(([v, label]) => ({ label, value: String(v) }));
        const hit = SCALES.find(([v]) => v === this._scale);
        tg.active = hit ? String(hit[0]) : "";
        tg.addEventListener("value-changed", (e) => {
          const v = e.detail && parseFloat(e.detail.value);
          if (!(v > 0) || v === this._scale) return;
          this._scale = v;
          this._render();
        });
      }
    },

    /** Ticking an ingredient off: remembered for the recipe. */
    _bindIngChecks(on) {
      on("ha-check-list-item[data-ing]", "request-selected", (e) => {
        if (!e.detail || e.detail.source !== "interaction") return;
        const n = +e.currentTarget.dataset.ing;
        if (e.detail.selected) this._checked.add(n);
        else this._checked.delete(n);
        this._saveProgress();
      });
    },

    /** The bar that shows how far through the steps cook mode is (a read-only Home Assistant slider). */
    async _bindCookBar(root) {
      const bar = root.getElementById("cook-bar");
      if (!bar) return;
      await this._tkElement("ha-control-slider", { type: "tile", entity: "light.x", features: [{ type: "light-brightness" }] });
      bar.min = 0;
      bar.max = Number(bar.dataset.of);
      bar.value = Number(bar.dataset.n);
      bar.step = 1;
      bar.mode = "start";
      bar.showHandle = false;
      bar.setAttribute("aria-readonly", "true");
    },

    /** The switch that adds the other unit to the ingredient chips in the steps. */
    _chipAltHtml() {
      return `<ha-formfield class="chip-alt" label="${esc(T("Show the other unit in the chips"))}"><ha-switch data-chipalt ${this._chipAlt ? "checked" : ""}></ha-switch></ha-formfield>`;
    },

    _rdScaleHtml(r, k) {
      const b = scaleBasis(r);
      const hint = k === 1 ? "As written" : `${formatNumber(k)}× the recipe${b.unit === "×" ? "" : ` (written for ${fmtYield(b.base)}${b.unit ? ` ${esc(b.unit)}` : ""})`}`;
      this._brEnsureToggle();
      const presets =
        this._brToggle === "ready"
          ? `<ha-button-toggle-group id="rd-scale" size="s" no-wrap></ha-button-toggle-group>`
          : `<span class="rd-presets">${SCALES.map(
              ([v, label]) => `<ha-button size="s" appearance="${v === k ? "accent" : "filled"}" data-scale="${v}">${label}</ha-button>`
            ).join("")}</span>`;
      return `<div class="rd-scale">
          <div class="rd-amount"><span class="muted">${esc(b.label)}</span>
            <ha-icon-button data-step="-1" label="Less"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>
            <ha-input id="amount" type="number" appearance="outlined" min="0" step="any"></ha-input>
            <ha-icon-button data-step="1" label="More"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
            ${b.unit && b.unit !== "×" ? `<span>${esc(b.unit)}</span>` : b.unit === "×" ? "<span>×</span>" : ""}</div>
          ${presets}
          <div class="muted">${hint}</div>
          ${this._chipAltHtml()}
        </div>`;
    },

    _rdStepHtml(r, k, { s, n, num }, current = false) {
      const done = this._doneSteps.has(n);
      const { html: textHtml, links } = this._stepTextParts(r, s, k, n);
      const timers = timerSpecs(r, n, num, s.timers || [], state.language)
        .map((sp) => {
          const running = this._timerRunning(sp.key);
          const what = sp.name ? ` (${esc(sp.name)})` : "";
          return `<ha-button size="s" appearance="filled" data-timer-key="${esc(sp.key)}" data-timer-label="${esc(sp.label)}" data-timer-step="${n}" data-sec="${sp.seconds}" ${running ? "disabled" : ""}><ha-icon slot="start" icon="mdi:timer-outline"></ha-icon>${
            running ? "Timer running" : `Start ${duration(sp.seconds)} timer${what}`
          }</ha-button>`;
        })
        .join("");
      return `<ha-list-item-base interactive class="rd-step ${done ? "done" : ""} ${current ? "current" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}">
          <span slot="start" class="rd-num">${done ? `<ha-icon icon="mdi:check"></ha-icon>` : num}</span>
          <span slot="headline" class="rd-text">${textHtml}</span>
          ${links || timers ? `<span slot="supporting-text" class="rd-extra">${links}${timers}</span>` : ""}
        </ha-list-item-base>`;
    },

    _detailHtml(r) {
      const k = this._scale;
      const base = baseServings(r.servings);
      const canEdit = this._canEdit !== false;
      const chip = (icon, label, attrs = "") => `<ha-assist-chip ${attrs} label="${esc(label)}"><ha-icon slot="icon" icon="mdi:${icon}"></ha-icon></ha-assist-chip>`;
      const row = (icon, headline, value) =>
        value ? `<ha-list-item-base headline="${esc(headline)}" supporting-text="${esc(value)}"><ha-icon slot="start" icon="mdi:${icon}"></ha-icon></ha-list-item-base>` : "";
      const unit = r.yield_unit || "";
      // the cookbooks this recipe belongs to
      const cookbooks = (this._cookbooks || [])
        .filter((c) => this._matches(r, { categories: new Set(c.categories), tools: new Set(c.tools), tags: new Set(c.tags) }, (c.query || "").toLowerCase()))
        .map((c) => c.name)
        .join(", ");
      const chips = [
        ...(r.categories || []).map((t) => chip("folder-outline", t, `data-chip="categories" data-value="${esc(t)}"`)),
        ...(r.tools || []).map((t) => chip("tools", t, `data-chip="tools" data-value="${esc(t)}"`)),
        ...r.tags.map((t) => chip("tag-outline", t, `data-chip="tags" data-value="${esc(t)}"`)),
      ].join("");
      const subtitle = [...(r.categories || []).slice(0, 2), cookbooks].filter(Boolean).join(" · ");
      this._rdSubtitle = subtitle;
      // the cover: the dish across the top of the page, with its name and the numbers that matter over it
      const pill = (icon, text) => (text ? `<span class="rd-pill"><ha-icon icon="mdi:${icon}"></ha-icon>${esc(text)}</span>` : "");
      const pills = [
        pill("timer-sand", r.prep_time ? `${T("Prep")} ${T(minutes(r.prep_time))}` : ""),
        pill("pot-steam-outline", r.cook_time ? `${T("Cook")} ${T(minutes(r.cook_time))}` : ""),
        pill("clock-outline", !r.prep_time && !r.cook_time && r.total_time ? `${T("Total")} ${T(minutes(r.total_time))}` : ""),
        pill("account-multiple-outline", r.servings ? `${T("Serves")} ${base !== null && k !== 1 ? formatNumber(base * k) : r.servings}` : ""),
        pill("cupcake", r.yield_amount ? `${T("Makes")} ${fmtYield(r.yield_amount * k)}${unit ? ` ${unit}` : ""}` : ""),
      ].join("");
      const cover = `<div class="rd-cover ${r.image ? "" : "rd-nocover"}">
          ${r.image ? `<img src="${esc(r.image)}" alt="">` : `<ha-icon class="rd-coverbg" icon="mdi:silverware-fork-knife"></ha-icon>`}
          <div class="rd-covertext">
            ${subtitle ? `<div class="rd-kicker">${esc(subtitle)}</div>` : ""}
            <h1>${esc(r.name)}</h1>
            <div class="rd-pills">${pills}</div>
            <ha-button class="rd-go" size="l" appearance="filled" data-act="cook" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:chef-hat"></ha-icon>${esc(T("Start cooking"))}</ha-button>
          </div>
        </div>`;
      const info = `<ha-card class="rd-info">
          <div class="card-content">${r.description ? `<p class="rd-desc">${esc(r.description)}</p>` : ""}${chips ? `<div class="rd-chips">${chips}</div>` : ""}</div>
          <ha-list-base>${row("book-open-page-variant-outline", T("Cookbooks"), cookbooks)}${
            r.source_url
              ? `<a class="rd-src" href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer"><ha-list-item-base interactive headline="${esc(T("Source"))}" supporting-text="${esc(r.source_url)}"><ha-icon slot="start" icon="mdi:link-variant"></ha-icon><ha-icon slot="end" icon="mdi:open-in-new"></ha-icon></ha-list-item-base></a>`
              : ""
          }</ha-list-base>
          ${canEdit ? `<div class="card-actions"><ha-button appearance="plain" size="s" data-act="plan-this" data-id="${esc(r.id)}">Add to meal plan</ha-button><ha-button appearance="plain" size="s" data-act="edit" data-id="${esc(r.id)}">Edit</ha-button></div>` : ""}
        </ha-card>`;
      const ingredients = `<ha-card class="rd-ings" header="${esc(T("Ingredients"))}">
          <div class="card-content">${this._rdScaleHtml(r, k)}</div>
          ${this._rdIngredientGroups(r)
            .map((g) => {
              const items = g.items
                .map(
                  (n) =>
                    `<ha-check-list-item left data-ing="${n}" ${this._checked.has(n) ? "selected" : ""}><span class="ing-text">${ingredientHtml(r, n, k, this._units)}</span></ha-check-list-item>`
                )
                .join("");
              return g.title
                ? `<ha-expansion-panel left-chevron expanded class="rd-sec"><div slot="header" class="rd-sh">${esc(g.title)}<span class="muted">${g.items.length}</span></div><ha-list multi>${items}</ha-list></ha-expansion-panel>`
                : `<ha-list multi>${items}</ha-list>`;
            })
            .join("")}
          <div class="card-actions"><ha-button appearance="plain" size="s" data-act="shop" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:cart-outline"></ha-icon>Add to shopping list</ha-button></div>
        </ha-card>`;
      // the page doubles as a live guide: the first step not yet done is the current one, with progress above
      const stepGroups = this._rdStepGroups(r);
      const allSteps = stepGroups.flatMap((g) => g.steps);
      const doneCount = allSteps.filter((x) => this._doneSteps.has(x.n)).length;
      const currentStep = (allSteps.find((x) => !this._doneSteps.has(x.n)) || {}).n;
      const progress = allSteps.length
        ? `<div class="rd-progress ${doneCount === allSteps.length ? "finished" : ""}">
            <div class="rd-ptext">${
              doneCount === allSteps.length
                ? `<ha-icon icon="mdi:party-popper"></ha-icon>${esc(T("All done, enjoy!"))}`
                : doneCount
                  ? `${esc(T("Step"))} ${doneCount + 1} ${esc(T("of"))} ${allSteps.length}`
                  : `${allSteps.length} ${esc(T("steps"))}`
            }</div>
            <div class="rd-pbar"><div style="width:${Math.round((doneCount / allSteps.length) * 100)}%"></div></div>
          </div>`
        : "";
      const steps = `<ha-card class="rd-steps" header="${esc(T("Instructions"))}">
          ${progress}
          ${
            stepGroups
              .map((g) => {
                const list = `<ha-list-base>${g.steps.map((x) => this._rdStepHtml(r, k, x, x.n === currentStep)).join("")}</ha-list-base>`;
                return g.title
                  ? `<ha-expansion-panel left-chevron expanded class="rd-sec"><div slot="header" class="rd-sh">${esc(g.title)}<span class="muted">${g.steps.length}</span></div>${list}</ha-expansion-panel>`
                  : list;
              })
              .join("") || `<div class="card-content muted">This recipe has no steps yet.</div>`
          }
        </ha-card>`;
      const nutrition = this._nutritionCardHtml(r, k);
      const narrow = this.clientWidth < 760; // one column: the nutrition goes last
      const notes = r.notes
        ? `<ha-card class="rd-notes" header="${esc(T("Notes"))}"><div class="card-content" style="white-space:pre-wrap">${esc(r.notes)}</div></ha-card>`
        : "";
      this._fab = `<ha-button class="fab" size="l" data-act="cook" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:chef-hat"></ha-icon>Cook</ha-button>`;
      if (narrow) {
        // a phone: ingredients and steps are one tap apart instead of a screen and a half
        if (this._rdTabFor !== r.id) {
          this._rdTabFor = r.id;
          this._rdTab = "ings";
        }
        const tab = (act, icon, name, on) =>
          `<div class="tabwrap" data-act="${act}"><ha-tab name="${esc(name)}" ${on ? "active" : ""}><ha-icon slot="icon" icon="mdi:${icon}"></ha-icon></ha-tab></div>`;
        const tabs = `<div class="rd-tabs">${tab("rd-tab-ings", "format-list-checks", T("Ingredients"), this._rdTab === "ings")}${tab("rd-tab-steps", "chef-hat", T("Steps"), this._rdTab === "steps")}</div>`;
        return `<div class="rd">${cover}${info}${tabs}${this._rdTab === "steps" ? steps : ingredients + notes}<div class="rd-bottom">${nutrition}</div></div>`;
      }
      return `<div class="rd">${cover}<div class="rd-left">${info}${ingredients}${narrow ? "" : nutrition}${notes}</div><div class="rd-right">${steps}</div>${narrow ? `<div class="rd-bottom">${nutrition}</div>` : ""}</div>`;
    },

    /** Wire up the HA elements of the recipe page. */
    _bindDetail(root, on) {
      const r = this._recipe(this._view.id);
      if (!r) return;
      this._nuMountTables(root);
      on("#rd-nutpanel", "expanded-changed", (e) => {
        if (e.target.id === "rd-nutpanel") this._nuOpen = e.detail.expanded;
      });
      this._bindScale(root);
      this._bindIngChecks(on);
      on("[data-chip][data-value]", "click", (e) => {
        const { chip, value } = e.currentTarget.dataset;
        this._sel = { categories: new Set(), tools: new Set(), tags: new Set() };
        this._sel[chip].add(value);
        this._search = "";
        this._cookbookId = null;
        this._go({ name: "list" });
      });
      const menu = root.getElementById("rd-menu");
      if (menu) menu.addEventListener("wa-select", (e) => this._action(e.detail.item.value, r.id));
    },

    _servingsLabel(r) {
      if (!r.servings) return "";
      const base = baseServings(r.servings);
      if (base === null || this._scale === 1) return `Serves ${esc(r.servings)}`;
      return `Serves ${formatNumber(base * this._scale)} (originally ${esc(r.servings)})`;
    },
  };
}
