/* Recipes panel: recipe methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, minutes, formatNumber, baseServings, normStep, isHeader, headerText, timerSpecs, duration, ingredientText, fmtYield, SCALES, scaleBasis, T, state, TODO_KEY, ingredientHtml, ingredientChipHtml, ingredientPlain } = h;
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

    _stepsHtml(r, k) {
      let num = 0;
      return r.instructions
        .map(normStep)
        .map((s, n) => {
          if (s.section) return `<div class="step-section">${esc(s.text)}</div>`;
          num += 1;
          const done = this._doneSteps.has(n);
          const links = s.ingredients
            .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
            .map((i) => ingredientChipHtml(r, i, k, this._units))
            .join("");
          return `<div class="step-item ${done ? "done" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0" title="${done ? "Mark as not done" : "Tap to mark as done"}">
            <span class="step-num">${done ? "✓" : num}</span>
            <div class="step-body"><div class="step-text">${esc(s.text)}</div>
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
      const links = st.ingredients
        .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
        .map((i) => ingredientChipHtml(r, i, k, this._units))
        .join("");
      const running = this._timerRunning(`${r.id}:${st.i}`);
      const last = n === steps.length - 1;
      const done = this._doneSteps.has(st.i);
      return `
        <div class="cook">
          <div class="muted">${esc(r.name)}${k !== 1 ? ` · ×${esc(formatNumber(k))}` : ""} · Step ${n + 1} of ${steps.length}</div>
          <div class="cook-progress"><div style="width:${((n + 1) / steps.length) * 100}%"></div></div>
          ${section ? `<div class="cook-section">${esc(section)}</div>` : ""}
          <div class="cook-text" data-step-toggle="${st.i}" style="${done ? "opacity:.55;text-decoration:line-through" : ""}" title="Tap to mark as done">${esc(st.text)}</div>
          ${links ? `<div class="step-ings">${links}</div>` : ""}
          ${this._timerButtonsHtml(r, st, st.i, n + 1)}
          <label class="cook-done"><input type="checkbox" data-step-done="${st.i}" ${done ? "checked" : ""}> Mark this step as done</label>
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
          if (st.section) return `<h3 class="csection">${esc(st.text)}</h3>`;
          num += 1;
          const done = this._doneSteps.has(n);
          const links = st.ingredients
            .filter((i) => r.ingredients[i] !== undefined && !isHeader(r.ingredients[i]))
            .map((i) => ingredientChipHtml(r, i, k, this._units))
            .join("");
          const running = this._timerRunning(`${r.id}:${n}`);
          return `<div class="cstep ${done ? "done" : ""} ${n === firstOpen ? "current" : ""}" data-step-toggle="${n}" role="checkbox" aria-checked="${done}" tabindex="0">
            <div class="cstep-head"><span>Step ${num}</span><span class="tick">${done ? "✓" : ""}</span></div>
            <div class="cstep-text">${esc(st.text)}</div>
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

    _printRecipe(r) {
      const k = this._scale;
      const mode = this._units;
      const w = window.open("", "_blank");
      if (!w) {
        this._error = T("The browser blocked the print window. Allow pop-ups for this site and try again.");
        this._render();
        return;
      }
      const meta = [
        r.prep_time && `${T("Prep")} ${T(minutes(r.prep_time))}`,
        r.cook_time && `${T("Cook")} ${T(minutes(r.cook_time))}`,
        r.total_time && `${T("Total")} ${T(minutes(r.total_time))}`,
        r.yield_amount && `${T("Makes")} ${fmtYield(r.yield_amount * k)} ${esc(r.yield_unit || "")}`.trim(),
        T(this._servingsLabel(r)),
      ].filter(Boolean);
      let num = 0;
      const steps = r.instructions
        .map(normStep)
        .map((st) => {
          if (st.section) return `<h3>${esc(st.text)}</h3>`;
          num += 1;
          return `<p class="step"><span class="n">${num}.</span> ${esc(st.text)}${st.timers.length ? ` <span class="timer">(${esc(st.timers.map((t) => T(duration(t.seconds)) + (t.label ? ` ${t.label}` : "")).join(", "))})</span>` : ""}</p>`;
        })
        .join("");
      const ings = r.ingredients
        .map((raw, i) => (isHeader(raw) ? `</ul><h3>${esc(headerText(raw))}</h3><ul>` : `<li>${esc(ingredientPlain(r, i, k, mode))}</li>`))
        .join("");
      w.document.write(`<!doctype html><html lang="${esc(state.language)}"><head><meta charset="utf-8"><title>${esc(r.name)}</title>
        <style>
          body { font: 16px/1.5 Georgia, serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #000; }
          h1 { margin: 0 0 4px; } .meta { color: #555; margin-bottom: 16px; }
          h2 { border-bottom: 1px solid #999; padding-bottom: 2px; margin-top: 24px; }
          h3 { margin: 16px 0 4px; font-size: 1rem; }
          ul { padding-left: 20px; margin: 0; } li { margin-bottom: 6px; }
          .step { margin: 0 0 10px; } .n { font-weight: bold; }
          .timer { color: #555; font-size: 14px; } img { max-width: 100%; max-height: 260px; }
          @media print { a { color: inherit; text-decoration: none; } }
        </style></head><body>
        <h1>${esc(r.name)}</h1>
        <div class="meta">${meta.join(" · ")}</div>
        ${r.description ? `<p>${esc(r.description)}</p>` : ""}
        <h2>${T("Ingredients")}</h2>
        <ul>${ings}</ul>
        <h2>${T("Instructions")}</h2>
        ${steps}
        ${r.notes ? `<h2>${T("Notes")}</h2><p>${esc(r.notes)}</p>` : ""}
        ${r.source_url ? `<p class="meta">${T("Source:")} ${esc(r.source_url)}</p>` : ""}
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    },

    _detailHtml(r) {
      const k = this._scale;
      const base = baseServings(r.servings);
      const stat = (label, value, note = "") =>
        value ? `<div class="stat"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ""}</div>` : "";
      const servings = !r.servings
        ? ""
        : base !== null && k !== 1
          ? stat("Serves", esc(formatNumber(base * k)), `originally ${esc(r.servings)}`)
          : stat("Serves", esc(r.servings));
      const unit = esc(r.yield_unit || "");
      const makes = r.yield_amount
        ? stat(
            "Makes",
            `${fmtYield(r.yield_amount * k)}${unit ? ` ${unit}` : ""}`,
            k !== 1 ? `as written: ${fmtYield(r.yield_amount)}` : ""
          )
        : "";
      const stats = [
        stat("Prep", r.prep_time ? minutes(r.prep_time) : ""),
        stat("Cook", r.cook_time ? minutes(r.cook_time) : ""),
        stat("Total", r.total_time ? minutes(r.total_time) : ""),
        makes,
        servings,
      ].join("");
      const anyChecks = this._checked.size || this._doneSteps.size;
      const tab = this._tab || "ingredients";
      const tags = [
        ...(r.categories || []).map((t) => `<span class="chip">${esc(t)}</span>`),
        ...(r.tools || []).map((t) => `<span class="chip">🔧 ${esc(t)}</span>`),
        ...r.tags.map((t) => `<span class="chip">#${esc(t)}</span>`),
      ].join("");
      const tabBtn = (id, label) => `<button class="${tab === id ? "active" : ""}" data-tab-btn="${id}">${label}</button>`;
      const icon = (n) => `<ha-icon icon="mdi:${n}"></ha-icon>`;
      // The same actions twice: inline above the columns on a wide screen, and
      // pinned to the bottom on a narrow one (CSS shows whichever fits).
      const barHtml = (cls) => `
        <div class="bar ${cls}">
          <button class="p" data-act="cook" data-id="${esc(r.id)}">${icon("chef-hat")}Cook</button>
          <button data-act="shop" data-id="${esc(r.id)}">${icon("cart-outline")}Shop</button>
          <button data-act="print" data-id="${esc(r.id)}">${icon("printer-outline")}Print</button>
          <button data-act="dashboard-recipe" data-id="${esc(r.id)}" class="${this._cookingId === r.id ? "on" : ""}" aria-pressed="${this._cookingId === r.id}" title="${
            this._cookingId === r.id
              ? "Shown on the dashboard cook card. Press to remove."
              : "Show this recipe on the dashboard cook card"
          }">${icon(this._cookingId === r.id ? "view-dashboard" : "view-dashboard-outline")}Dashboard</button>
          <button data-act="edit" data-id="${esc(r.id)}">${icon("pencil-outline")}Edit</button>
        </div>`;
      return `
        <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
        <div class="detail">
          ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="">` : ""}
          <div class="content">
            <h2>${esc(r.name)}</h2>
            ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ""}
            ${tags ? `<div class="chips">${tags}</div>` : ""}
            ${stats ? `<div class="stats">${stats}</div>` : ""}
            <div class="tabs">${tabBtn("ingredients", "Ingredients")}${tabBtn("steps", "Instructions")}${r.notes ? tabBtn("notes", "Notes") : ""}</div>
            ${barHtml("bar-top")}
            <div class="cols">
              <section class="pane ingredients-pane tab-pane ${tab === "ingredients" ? "active" : ""}">
                <h3>Ingredients</h3>
                ${this._scaleControlHtml(r, k)}
                ${this._ingredientsListHtml(r, k)}
              </section>
              <section class="pane tab-pane ${tab === "steps" ? "active" : ""}">
                <h3>Instructions</h3>${this._stepsHtml(r, k)}
              </section>
            </div>
            ${r.notes ? `<section class="pane notes-pane tab-pane ${tab === "notes" ? "active" : ""}"><h3>Notes</h3><p style="margin:0;white-space:pre-wrap">${esc(r.notes)}</p></section>` : ""}
            ${r.source_url ? `<p class="muted">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_url)}</a></p>` : ""}
          </div>
        </div>
        ${barHtml("bar-bottom")}
        <div class="more-actions">
          <button data-act="plan-this" data-id="${esc(r.id)}">Add to meal plan</button>
          ${anyChecks ? `<button data-act="progress-reset">↺ Clear checks</button>` : ""}
          <button class="danger" data-act="delete" data-id="${esc(r.id)}">Delete recipe</button>
        </div>`;
    },

    _servingsLabel(r) {
      if (!r.servings) return "";
      const base = baseServings(r.servings);
      if (base === null || this._scale === 1) return `Serves ${esc(r.servings)}`;
      return `Serves ${formatNumber(base * this._scale)} (originally ${esc(r.servings)})`;
    },
  };
}
