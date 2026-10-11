/* Recipes panel: plan methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, minutes, state, isoDate, addDays, mondayOf } = h;
  return {
    // ---- meal plan ----
    _planMonday() {
      const w = this._view.name === "plan" && this._view.week ? new Date(`${this._view.week}T12:00:00`) : new Date();
      return mondayOf(w);
    },

    /** Fetch the visible week when it changes, and repaint when it arrives. */
    _ensurePlan() {
      const start = isoDate(this._planMonday());
      if (this._planLoaded === start || this._planLoading === start) return;
      this._planLoading = start;
      this._ws({ type: "hass_recipes/plan_list", start, end: isoDate(addDays(this._planMonday(), 6)) })
        .then((res) => {
          this._planEntries = res.entries;
          this._planLoaded = start;
        })
        .catch((err) => {
          this._error = err.message || String(err);
        })
        .finally(() => {
          this._planLoading = null;
          if (this._view.name === "plan") this._render();
        });
      this._subscribePlan();
    },

    _subscribePlan() {
      if (this._planSub || !this._hass) return;
      this._planSub = true;
      this._hass.connection
        .subscribeEvents(() => {
          this._planLoaded = null;
          if (this._view.name === "plan") this._render();
        }, "hass_recipes_meal_plan_changed")
        .catch(() => (this._planSub = false));
    },

    async _planChange(msg) {
      try {
        await this._ws(msg);
      } catch (err) {
        this._error = err.message || String(err);
      }
      this._planLoaded = null; // the change event also reloads; this covers a missed event
      this._render();
    },

    async _planToShopping() {
      const start = isoDate(this._planMonday());
      const entity_id = this._shopEntity || "todo.shopping_list";
      try {
        const res = await this._hass.callWS({
          type: "call_service",
          domain: "hass_recipes",
          service: "add_plan_to_shopping_list",
          service_data: { start, days: 7, entity_id },
          return_response: true,
        });
        const r = res.response || {};
        this._flash(`Added ${r.added?.length || 0} items from ${r.meals || 0} meals to ${entity_id}${r.skipped?.length ? ` (${r.skipped.length} already there)` : ""}.`);
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    _bindPlan(root, on) {
      on("[data-plan-add]", "click", async (e) => {
        const { date, slot } = e.currentTarget.dataset;
        if (this._planPending) {
          const recipe_id = this._planPending;
          this._planPending = null;
          await this._planChange({ type: "hass_recipes/plan_add", date, slot, recipe_id });
          this._flash("Added to the meal plan.");
          return;
        }
        this._planAdd = { date, slot };
        this._planQuery = "";
        this._render();
        setTimeout(() => root.getElementById("plan-search")?.focus(), 30);
      });
      on("[data-plan-recipe]", "click", async (e) => {
        const add = this._planAdd;
        this._planAdd = null;
        if (add) await this._planChange({ type: "hass_recipes/plan_add", ...add, recipe_id: e.currentTarget.dataset.planRecipe });
      });
      const text = root.getElementById("plan-text-add");
      if (text) {
        const submit = async () => {
          const title = root.getElementById("plan-text").value.trim();
          const add = this._planAdd;
          if (!title || !add) return;
          this._planAdd = null;
          await this._planChange({ type: "hass_recipes/plan_add", ...add, title });
        };
        text.addEventListener("click", submit);
        root.getElementById("plan-text").addEventListener("keydown", (e) => e.key === "Enter" && submit());
      }
      on("[data-plan-cancel]", "click", () => {
        this._planAdd = null;
        this._render();
      });
      on("[data-plan-del]", "click", (e) =>
        this._planChange({ type: "hass_recipes/plan_delete", entry_id: e.currentTarget.dataset.planDel })
      );
      on("[data-plan-cook]", "click", async (e) => {
        try {
          const state = await this._ws({ type: "hass_recipes/plan_cook", entry_id: e.currentTarget.dataset.planCook });
          this._go({ name: "cook", id: state.recipe_id, step: 0 });
        } catch (err) {
          this._error = err.message || String(err);
          this._render();
        }
      });
      on("[data-plan-scale]", "change", (e) => {
        const scale = parseFloat(e.currentTarget.value);
        this._planChange({
          type: "hass_recipes/plan_update",
          entry_id: e.currentTarget.dataset.planScale,
          scale: scale > 0 ? scale : null,
        });
      });
      const search = root.getElementById("plan-search");
      if (search) {
        search.addEventListener("input", () => {
          this._planQuery = search.value;
          const box = root.getElementById("plan-results");
          if (box) {
            box.innerHTML = this._planResultsHtml();
            box.querySelectorAll("[data-plan-recipe]").forEach((b) =>
              b.addEventListener("click", async (ev) => {
                const add = this._planAdd;
                this._planAdd = null;
                if (add) await this._planChange({ type: "hass_recipes/plan_add", ...add, recipe_id: ev.currentTarget.dataset.planRecipe });
              })
            );
          }
        });
      }
    },

    _planResultsHtml() {
      const q = (this._planQuery || "").trim().toLowerCase();
      const found = this._recipes
        .filter((r) => !q || [r.name, ...(r.tags || []), ...(r.categories || [])].join(" ").toLowerCase().includes(q))
        .slice(0, 12);
      if (!found.length) return `<div class="muted">No recipes match. Use the text box to add a plain meal.</div>`;
      return found
        .map(
          (r) => `<button class="plan-recipe" data-plan-recipe="${esc(r.id)}">
            <span class="thumb" ${r.image ? `style="background-image:url('${esc(r.image)}')"` : ""}></span>
            <span>${esc(r.name)}<br><small class="muted">${esc(minutes(r.total_time) || "")}</small></span></button>`
        )
        .join("");
    },

    _planHtml() {
      const monday = this._planMonday();
      const days = [...Array(7)].map((_, i) => addDays(monday, i));
      const today = isoDate(new Date());
      const lang = (this._hass && this._hass.language) || undefined;
      const dayLabel = (d) => new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(d);
      const rangeLabel = `${new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;
      const entries = this._planLoaded === isoDate(monday) ? this._planEntries || [] : this._planEntries || [];
      const SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]];
      const pending = this._planPending ? this._recipe(this._planPending) : null;

      const dayHtml = (d) => {
        const iso = isoDate(d);
        const slots = SLOTS.map(([slot, label]) => {
          const here = entries.filter((e) => e.date === iso && e.slot === slot);
          const items = here
            .map((e) => {
              const title = e.recipe_exists
                ? `<a href="#" class="plan-title" data-open="${esc(e.recipe_id)}">${esc(e.title)}</a>`
                : `<span class="plan-title">${esc(e.title)}</span>`;
              const scaleBox = e.recipe_exists
                ? `<label class="plan-scale" title="Scale">×<input type="number" min="0.25" step="0.25" value="${e.scale ? esc(e.scale) : ""}" placeholder="1" data-plan-scale="${esc(e.id)}"></label>`
                : "";
              return `<div class="plan-entry">${title}
                <span class="plan-tools">${scaleBox}
                  ${e.recipe_exists ? `<button class="mini" data-plan-cook="${esc(e.id)}" title="Cook this">🍳</button>` : ""}
                  <button class="mini" data-plan-del="${esc(e.id)}" title="Remove">✕</button></span></div>`;
            })
            .join("");
          return `<div class="plan-slot"><div class="plan-slot-head"><span>${label}</span>
            <button class="mini" data-plan-add data-date="${iso}" data-slot="${slot}" title="Add to ${label.toLowerCase()}">+</button></div>${items}</div>`;
        }).join("");
        return `<section class="plan-day ${iso === today ? "today" : ""}"><h3>${esc(dayLabel(d))}</h3>${slots}</section>`;
      };

      const adding = this._planAdd
        ? `<div class="pane plan-picker">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <strong>Add to ${esc(this._planAdd.slot)} · ${esc(dayLabel(new Date(`${this._planAdd.date}T12:00:00`)))}</strong>
              <button class="btn secondary" data-plan-cancel>Cancel</button></div>
            <input id="plan-search" type="search" placeholder="Search recipes" value="${esc(this._planQuery || "")}">
            <div id="plan-results" class="plan-results">${this._planResultsHtml()}</div>
            <div class="plan-text"><input id="plan-text" placeholder="…or a plain meal, e.g. Leftovers"><button class="btn" id="plan-text-add">Add</button></div>
          </div>`
        : "";
      return `
        <style>
          .plan-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
          .plan-bar h2 { margin: 0 12px 0 0; font-size: 22px; font-weight: 500; }
          .plan-range { min-width: 150px; text-align: center; font-weight: 500; }
          .plan-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
          @container (max-width: 900px) { .plan-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @container (max-width: 520px) { .plan-grid { grid-template-columns: minmax(0, 1fr); } }
          .plan-day { border: 1px solid var(--divider-color); border-radius: 12px; padding: 8px 10px; background: var(--card-background-color); }
          .plan-day.today { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
          .plan-day h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; }
          .plan-slot { border-top: 1px solid var(--divider-color); padding: 4px 0; min-height: 34px; }
          .plan-slot-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
          .plan-entry { display: flex; flex-direction: column; gap: 2px; padding: 3px 0; font-size: 14px; }
          .plan-title { color: var(--primary-text-color); text-decoration: none; overflow-wrap: anywhere; }
          a.plan-title { color: var(--primary-color); }
          .plan-tools { display: flex; gap: 4px; align-items: center; }
          .plan-scale { font-size: 12px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 2px; }
          .plan-scale input { width: 52px; padding: 1px 4px; font-size: 12px; }
          .plan-picker { margin-bottom: 14px; display: grid; gap: 10px; }
          .plan-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; max-height: 260px; overflow: auto; }
          .plan-recipe { display: flex; gap: 8px; align-items: center; text-align: left; padding: 6px; border: 1px solid var(--divider-color); border-radius: 8px; background: none; color: inherit; font: inherit; cursor: pointer; }
          .plan-recipe .thumb { width: 36px; height: 36px; border-radius: 6px; flex: none; background: var(--secondary-background-color) center / cover; }
          .plan-text { display: flex; gap: 8px; }
          .plan-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--primary-color) 14%, transparent); display: flex; gap: 8px; align-items: center; justify-content: space-between; }
        </style>
        <div class="toolbar"><button class="btn secondary" data-act="back">← Back</button></div>
        <div class="plan-bar">
          <h2>Meal plan</h2>
          <button class="btn secondary" data-act="plan-prev" title="Previous week">‹</button>
          <span class="plan-range">${esc(rangeLabel)}</span>
          <button class="btn secondary" data-act="plan-next" title="Next week">›</button>
          <button class="btn secondary" data-act="plan-today">Today</button>
          <button class="btn" data-act="plan-shop" title="Add the ingredients of this week's recipes to your shopping list">Add week to shopping list</button>
        </div>
        ${pending ? `<div class="plan-banner"><span>Pick a meal for <strong>${esc(pending.name)}</strong>: press + on a day.</span><button class="btn secondary" data-act="plan-cancel-pending">Cancel</button></div>` : ""}
        ${adding}
        <div class="plan-grid">${days.map(dayHtml).join("")}</div>`;
    },
  };
}
