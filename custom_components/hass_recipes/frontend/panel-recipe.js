/* Recipes panel: recipe methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, minutes, formatNumber, baseServings, normStep, isHeader, headerText, timerSpecs, duration, ingredientText, fmtYield, SCALES, scaleBasis, T, state, TODO_KEY, ingredientHtml, ingredientChipHtml, splitSubs, stepTextHtml } = h;
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
      if (result) {
        return `<div class="panel"><h2>Shopping list updated</h2>
          <p>Added <strong>${result.added.length}</strong> item(s) to <em>${esc(result.entity_id)}</em>${result.skipped.length ? `, skipped ${result.skipped.length} already on the list` : ""}.</p>
          ${result.added.length ? `<ul>${result.added.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
          <div class="actions"><button class="btn" data-act="shop-done" data-id="${esc(r.id)}">Back to recipe</button></div></div>`;
      }
      if (!lists.length) {
        return `<div class="panel"><h2>Add to shopping list</h2>
          <p>No to-do lists were found in Home Assistant. Add the <strong>Shopping list</strong> integration (or any to-do integration) first.</p>
          <div class="actions"><button class="btn secondary" data-act="shop-done" data-id="${esc(r.id)}">Back</button></div></div>`;
      }
      return `
        <div class="panel">
          <h2>Add to shopping list</h2>
          <p class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · ${this._units === "grams" ? "grams" : "as written"}. Untick things you already have.</p>
          <div class="field"><label class="lbl">List</label>
            <select id="shop-entity">${lists
              .map((l) => `<option value="${esc(l.id)}" ${l.id === chosen ? "selected" : ""}>${esc(l.name)}</option>`)
              .join("")}</select></div>
          <ul class="ingredients">${r.ingredients
            .map((raw, i) =>
              isHeader(raw)
                ? `<li class="section">${esc(headerText(raw))}</li>`
                : `<li><label><input type="checkbox" data-shop="${i}" ${this._shopSel.has(i) ? "checked" : ""}><span>${esc(ingredientText(r, i, k, this._units))}</span></label></li>`
            )
            .join("")}</ul>
          <div class="actions">
            <button class="btn" data-act="shop-add" data-id="${esc(r.id)}" ${this._shopSel.size ? "" : "disabled"}>Add ${this._shopSel.size} item(s)</button>
            <button class="btn secondary" data-act="shop-done" data-id="${esc(r.id)}">Cancel</button>
          </div>
        </div>`;
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
    _ingredientsListHtml(r, k, attr = "data-i") {
      return `<ul class="ingredients">${r.ingredients
        .map((raw, n) =>
          isHeader(raw)
            ? `<li class="section">${esc(headerText(raw))}</li>`
            : `<li><label><input type="checkbox" ${attr}="${n}" ${this._checked.has(n) ? "checked" : ""}><span class="ing-text">${ingredientHtml(r, n, k, this._units)}</span></label></li>`
        )
        .join("")}</ul>`;
    },

    /** A step's text with the ingredients it names as chips, and chips for the ones it does not name. */
    _stepTextParts(r, s, k, n) {
      const idx = this._stepChipIngredients(r, s);
      const items = idx.map((i) => ({ key: i, text: splitSubs(r.ingredients[i]).main }));
      const chip = (i) => ingredientChipHtml(r, i, k, this._units, { key: `${n}:${i}`, done: this._doneChips.has(`${n}:${i}`) });
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

    _stepsHtml(r, k) {
      let num = 0;
      return r.instructions
        .map(normStep)
        .map((s, n) => {
          if (s.section) return `<div class="step-section">${esc(s.text)}</div>`;
          num += 1;
          const done = this._doneSteps.has(n);
          const { html: textHtml, links } = this._stepTextParts(r, s, k, n);
          return `<div class="step-item ${done ? "done" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0" title="${done ? "Mark as not done" : "Tap to mark as done"}">
            <span class="step-num">${done ? "✓" : num}</span>
            <div class="step-body"><div class="step-text">${textHtml}</div>
              ${links ? `<div class="step-ings">${links}</div>` : ""}
              ${this._timerButtonsHtml(r, s, n, num, "secondary")}
            </div></div>`;
        })
        .join("");
    },

    /** One start button per timer of a step. `n` is the step's index, `num` its number among the steps. */
    _timerButtonsHtml(r, st, n, num, extra = "") {
      return timerSpecs(r, n, num, st.timers || [], state.language)
        .map((sp) => {
          const running = this._timerRunning(sp.key);
          const what = sp.name ? ` (${esc(sp.name)})` : "";
          return `<button class="btn ${extra} timer-btn" data-timer-key="${esc(sp.key)}" data-timer-label="${esc(sp.label)}" data-timer-step="${n}" data-sec="${sp.seconds}" ${running ? "disabled" : ""}>⏱ ${
            running ? "Timer running" : `Start ${duration(sp.seconds)} timer${what}`
          }</button>`;
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
      const btn = (act, target, label, arrowFirst) =>
        `<button class="btn secondary" data-act="${act}" ${target ? "" : "disabled"}>${arrowFirst ? "⇤ " : ""}${label}${arrowFirst ? "" : " ⇥"}${
          target && target.title ? `<small>${esc(target.title)}</small>` : ""
        }</button>`;
      return `<div class="cook-sections">${btn("cook-sec-prev", prev, "Previous section", true)}${btn("cook-sec-next", next, "Next section", false)}</div>`;
    },

    _cookHtml(r) {
      const steps = this._cookSteps(r);
      const n = Math.min(Math.max(this._view.step || 0, 0), Math.max(steps.length - 1, 0));
      const st = steps[n];
      const k = this._scale;
      if (!st) {
        return `<div class="cook"><p>This recipe has no steps yet.</p>
          <div class="cook-nav"><button class="btn secondary" data-act="cook-exit">Exit</button></div></div>`;
      }
      // The heading this step sits under, if any.
      let section = "";
      for (const x of r.instructions.map(normStep).slice(0, st.i)) if (x.section) section = x.text;
      const { html: textHtml, links } = this._stepTextParts(r, st, k, st.i);
      const running = this._timerRunning(`${r.id}:${st.i}`);
      const last = n === steps.length - 1;
      const done = this._doneSteps.has(st.i);
      return `
        <div class="cook">
          <div class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · Step ${n + 1} of ${steps.length}</div>
          <div class="cook-progress"><div style="width:${((n + 1) / steps.length) * 100}%"></div></div>
          ${section ? `<div class="cook-section">${esc(section)}</div>` : ""}
          <div class="cook-text" data-step-toggle="${st.i}" style="${done ? "opacity:.55;text-decoration:line-through" : ""}" title="Tap to mark as done">${textHtml}</div>
          ${links ? `<div class="step-ings">${links}</div>` : ""}
          ${this._timerButtonsHtml(r, st, st.i, n + 1)}
          <label class="cook-done"><input type="checkbox" data-step-done="${st.i}" ${done ? "checked" : ""}> Mark this step as done</label>
          ${this._cookSectionNavHtml(r, n)}
          <div class="cook-nav">
            <button class="btn secondary" data-act="cook-prev" ${n === 0 ? "disabled" : ""}>← Previous</button>
            <button class="btn" data-act="${last ? "cook-finish" : "cook-next"}">${last ? "Finish ✓" : "Next →"}</button>
          </div>
          <details ${this._cookIngredients ? "open" : ""} id="cook-ings">
            <summary>All ingredients</summary>
            ${this._ingredientsListHtml(r, k)}
          </details>
          <div class="actions">
            <button class="btn secondary" data-act="cook-focus">Show all steps</button>
            <button class="btn secondary" data-act="cook-exit">Exit cook mode</button>
          </div>
        </div>`;
    },

    /** One control for scaling: type an amount, nudge it, or pick a multiplier. */
    _scaleControlHtml(r, k) {
      const b = scaleBasis(r);
      const presets = SCALES.map(
        ([v, label]) => `<button class="chip ${v === k ? "active" : ""}" data-scale="${v}">${label}</button>`
      ).join("");
      const amount = fmtYield(b.base * k);
      const hint =
        k === 1
          ? "As written"
          : `${formatNumber(k)}× the recipe${b.unit === "×" ? "" : ` (written for ${fmtYield(b.base)}${b.unit ? ` ${esc(b.unit)}` : ""})`}`;
      return `<div class="scale">
          <span class="muted">${b.label}</span>
          <button class="step" data-step="-1" aria-label="Less">−</button>
          <input id="amount" type="number" min="0" step="any" value="${amount}" title="Type how much you want">
          <button class="step" data-step="1" aria-label="More">+</button>
          ${b.unit && b.unit !== "×" ? `<span>${esc(b.unit)}</span>` : b.unit === "×" ? "<span>×</span>" : ""}
          <span style="width:6px"></span>${presets}
          <span class="hint">${hint}</span>
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
          return `<div class="cstep ${done ? "done" : ""} ${n === firstOpen ? "current" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0">
            <div class="cstep-head"><span>Step ${num}</span><span class="tick">${done ? "✓" : ""}</span></div>
            <div class="cstep-text">${textHtml}</div>
            ${links ? `<div class="step-ings">${links}</div>` : ""}
            ${this._timerButtonsHtml(r, st, n, num)}
          </div>`;
        })
        .join("");
      const makes = r.yield_amount ? ` · Makes ${fmtYield(r.yield_amount * k)} ${esc(r.yield_unit || "")}` : "";
      return `
        <div class="cookp">
          <div class="cook-top">
            <h2>${esc(r.name)}<span class="muted" style="font-weight:400">${makes}</span></h2>
            ${this._scaleControlHtml(r, k)}
            ${(() => {
              const jumps = all.map((x, n) => ({ x, n })).filter((o) => o.x.section);
              return this._cookSections(r).length
                ? `<span class="cook-jumps">${jumps
                    .map((o) => `<button class="btn secondary" data-act="cook-jump" data-id="${o.n}">${esc(o.x.text)}</button>`)
                    .join("")}</span>`
                : "";
            })()}
            <button class="btn secondary" data-act="cook-focus" title="Show one step at a time">One step at a time</button>
            <button class="btn secondary" data-act="cook-exit">Exit</button>
          </div>
          <div class="cook-cols">
            <aside class="pane cook-ings"><h3>Ingredients</h3>${this._ingredientsListHtml(r, k)}</aside>
            <section class="cook-steps">${steps || `<p class="muted">This recipe has no steps yet.</p>`}</section>
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
        </div>`;
    },

    _rdStepHtml(r, k, { s, n, num }) {
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
      return `<ha-list-item-base interactive class="rd-step ${done ? "done" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}">
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
      const fact = (icon, label, value) => (value ? chip(icon, `${label} ${value}`, "") : "");
      const facts = [
        fact("timer-sand", T("Prep"), r.prep_time ? T(minutes(r.prep_time)) : ""),
        fact("pot-steam-outline", T("Cook"), r.cook_time ? T(minutes(r.cook_time)) : ""),
        fact("clock-outline", T("Total"), r.total_time ? T(minutes(r.total_time)) : ""),
        r.yield_amount ? fact("cupcake", T("Makes"), `${fmtYield(r.yield_amount * k)}${unit ? ` ${unit}` : ""}`) : "",
        r.servings ? fact("account-multiple-outline", T("Serves"), base !== null && k !== 1 ? formatNumber(base * k) : String(r.servings)) : "",
      ].join("");
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
      const hero = r.image
        ? `<img class="rd-hero" src="${esc(r.image)}" alt="">`
        : `<div class="rd-hero rd-nohero"><ha-icon icon="mdi:silverware-fork-knife"></ha-icon></div>`;
      const info = `<ha-card class="rd-info">
          ${hero}
          <div class="card-content">${r.description ? `<p class="rd-desc">${esc(r.description)}</p>` : ""}${facts ? `<div class="rd-chips rd-facts">${facts}</div>` : ""}${chips ? `<div class="rd-chips">${chips}</div>` : ""}</div>
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
      const steps = `<ha-card class="rd-steps" header="${esc(T("Instructions"))}">
          ${
            this._rdStepGroups(r)
              .map((g) => {
                const list = `<ha-list-base>${g.steps.map((x) => this._rdStepHtml(r, k, x)).join("")}</ha-list-base>`;
                return g.title
                  ? `<ha-expansion-panel left-chevron expanded class="rd-sec"><div slot="header" class="rd-sh">${esc(g.title)}<span class="muted">${g.steps.length}</span></div>${list}</ha-expansion-panel>`
                  : list;
              })
              .join("") || `<div class="card-content muted">This recipe has no steps yet.</div>`
          }
        </ha-card>`;
      const notes = r.notes
        ? `<ha-card class="rd-notes" header="${esc(T("Notes"))}"><div class="card-content" style="white-space:pre-wrap">${esc(r.notes)}</div></ha-card>`
        : "";
      this._fab = `<ha-button class="fab" size="l" data-act="cook" data-id="${esc(r.id)}"><ha-icon slot="start" icon="mdi:chef-hat"></ha-icon>Cook</ha-button>`;
      return `<div class="rd"><div class="rd-left">${info}${ingredients}${notes}</div><div class="rd-right">${steps}</div></div>`;
    },

    /** Wire up the HA elements of the recipe page. */
    _bindDetail(root, on) {
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
      on("ha-check-list-item[data-ing]", "request-selected", (e) => {
        if (!e.detail || e.detail.source !== "interaction") return;
        const n = +e.currentTarget.dataset.ing;
        if (e.detail.selected) this._checked.add(n);
        else this._checked.delete(n);
        this._saveProgress();
      });
      on("[data-chip]", "click", (e) => {
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
