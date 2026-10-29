/* Recipes panel: the meal plan, shown in Home Assistant's own calendar (ha-full-calendar). Mixed into the panel class by recipes-panel.js.
 *
 * Every planned meal is a calendar event on its day (the meal sets its time of day, which is not shown).
 * The calendar's own header gives Today, previous / next and the month / week / day / list views;
 * the page adds the dialogs for adding and editing a meal, drag and drop between days, and the menu
 * actions (copy last week, add to the shopping list).
 */
export default function (h) {
  const { esc, minutes, T, isoDate, addDays } = h;
  // The meals of the day (the server keeps the user's own; these are what it starts with). A meal with no name
  // of its own is one of these and is named in the user's language.
  const BUILTIN = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", dessert: "Dessert", snack: "Snack" };
  const DEFAULT_MEALS = [
    { id: "breakfast", name: "", color: "amber", time: "07:30", minutes: 45, words: ["morgenmad", "breakfast", "brunch"] },
    { id: "lunch", name: "", color: "green", time: "12:00", minutes: 60, words: ["frokost", "lunch"] },
    { id: "dinner", name: "", color: "blue", time: "18:00", minutes: 60, words: ["aftensmad", "dinner", "hovedret", "middag"] },
    { id: "dessert", name: "", color: "pink", time: "19:30", minutes: 30, words: ["dessert", "desert", "efterret", "nachspeise"] },
    { id: "snack", name: "", color: "purple", time: "15:00", minutes: 30, words: ["snack", "mellemmåltid"] },
  ];
  // the colours of Home Assistant's own colour picker, with a fallback for themes that do not define them
  const COLOR_FALLBACK = {
    red: "#f44336", pink: "#e91e63", purple: "#926bc7", "deep-purple": "#6e41ab", indigo: "#3f51b5", blue: "#2196f3",
    "light-blue": "#03a9f4", cyan: "#00bcd4", teal: "#009688", green: "#4caf50", "light-green": "#8bc34a", lime: "#cddc39",
    yellow: "#ffeb3b", amber: "#ffc107", orange: "#ff9800", "deep-orange": "#ff6f22", brown: "#795548", "light-grey": "#bdbdbd",
    grey: "#9e9e9e", "dark-grey": "#606060", "blue-grey": "#607d8b", black: "#000000", white: "#ffffff",
  };
  const VIEWS = ["dayGridMonth", "dayGridWeek", "dayGridDay", "listWeek"];
  const VIEW_KEY = "hass_recipes_plan_view";
  const OPEN_KEY = "hass_recipes_plan_cats";

  return {
    // ---- the calendar ----
    /** The meals of the day, in order. */
    _planMeals() {
      return this._planMealList || DEFAULT_MEALS;
    },

    /** The name of a meal: its own, or the built-in one in the user's language. */
    _planLabel(slot) {
      const m = this._planMeals().find((x) => x.id === slot);
      return (m && m.name) || (BUILTIN[slot] ? T(BUILTIN[slot]) : slot);
    },

    _planColor(slot) {
      const m = this._planMeals().find((x) => x.id === slot);
      const name = (m && m.color) || "blue";
      return getComputedStyle(this).getPropertyValue(`--${name}-color`).trim() || COLOR_FALLBACK[name] || COLOR_FALLBACK.blue;
    },

    /** The planned meals as calendar events. */
    _planEvents() {
      const list = this._planCalView === "listWeek";
      return (this._planEntries || []).map((e) => {
        const meal = this._planMeals().find((m) => m.id === e.slot) || { time: "12:00", minutes: 60 };
        const time = meal.time;
        const [hh, mm] = time.split(":").map(Number);
        const endMin = Math.min(hh * 60 + mm + (meal.minutes || 60), 24 * 60 - 1);
        const color = this._planColor(e.slot);
        const name = e.title + (e.scale && e.scale !== 1 ? ` ×${e.scale}` : "");
        return {
          id: e.id,
          title: list ? `${this._planLabel(e.slot)}: ${name}` : name,
          start: `${e.date}T${time}:00`,
          end: `${e.date}T${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}:00`,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { slot: e.slot },
        };
      });
    },

    /** Put the meals in the calendar (it only takes events once it has been drawn). */
    _planPush() {
      const cal = this._planCal;
      if (cal && cal.isConnected && cal.calendar) cal.events = this._planEvents();
    },

    /** Fetch the meals the calendar shows, and show them. */
    async _planFetch() {
      const r = this._planRange;
      if (!r) return;
      try {
        const res = await this._ws({ type: "hass_recipes/plan_list", start: r.start, end: r.end });
        if (this._planRange !== r) return; // the calendar moved on while this was loading
        this._planEntries = res.entries;
        if (res.meals) this._planMealList = res.meals;
        this._planPush();
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    _subscribePlan() {
      if (this._planSub || !this._hass) return;
      this._planSub = true;
      this._hass.connection
        .subscribeEvents(() => this._planFetch(), "hass_recipes_meal_plan_changed")
        .catch(() => (this._planSub = false));
    },

    /** Create the calendar in the page and hook the meal plan into it. */
    async _planMount(root) {
      const host = root.getElementById("plan-cal");
      if (!host || !this._hass) return;
      this._subscribePlan();
      if (!customElements.get("ha-full-calendar") && window.loadCardHelpers) {
        try {
          const helpers = await window.loadCardHelpers();
          await helpers.createCardElement({ type: "calendar", entities: [] });
        } catch (_) { /* the wait below reports it */ }
      }
      try {
        await Promise.race([customElements.whenDefined("ha-full-calendar"), new Promise((_, no) => setTimeout(no, 5000))]);
      } catch (_) {
        host.innerHTML = `<ha-alert alert-type="warning">${esc(T("Home Assistant's calendar could not be loaded."))}</ha-alert>`;
        return;
      }
      if (!host.isConnected) return; // the page was rebuilt while waiting
      const compact = this._brCompact();
      // the chosen view is remembered separately for a phone and a wide screen
      const key = compact ? `${VIEW_KEY}_compact` : VIEW_KEY;
      let initial = "";
      try {
        initial = localStorage.getItem(key) || "";
      } catch (_) { /* ignore */ }
      const cal = document.createElement("ha-full-calendar");
      cal.hass = this._hass;
      cal.narrow = compact;
      cal.views = VIEWS;
      cal.initialView = VIEWS.includes(this._planCalView) ? this._planCalView : VIEWS.includes(initial) ? initial : compact ? "listWeek" : "dayGridWeek";
      this._planCalView = cal.initialView;
      cal.addEventListener("view-changed", (e) => {
        const { start, end, view } = e.detail;
        this._planCalView = view;
        try {
          localStorage.setItem(key, view);
        } catch (_) { /* ignore */ }
        this._planRange = { start: isoDate(start), end: isoDate(addDays(end, -1)), view };
        this._planCalDate = cal.calendar ? cal.calendar.getDate() : null;
        this._planFetch();
      });
      host.appendChild(cal);
      this._planCal = cal;
      // recipes dragged in from the pane: highlight the day under the pointer, and ask for the meal when dropped
      const dayAt = (e) => {
        const cell = e.composedPath().find((n) => n.getAttribute && n.getAttribute("data-date"));
        return cell ? { cell, date: cell.getAttribute("data-date").slice(0, 10) } : null;
      };
      let lit = null;
      const unlight = () => {
        if (lit) lit.style.outline = "";
        lit = null;
      };
      cal._unlight = unlight;
      cal.addEventListener("dragover", (e) => {
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes("application/x-hass-recipe")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        const day = dayAt(e);
        if (!day || day.cell === lit) return;
        unlight();
        lit = day.cell;
        lit.style.outline = "2px solid var(--primary-color)";
        lit.style.outlineOffset = "-2px";
      });
      cal.addEventListener("dragleave", (e) => {
        if (!cal.contains(e.relatedTarget) && e.relatedTarget !== null) unlight();
      });
      cal.addEventListener("drop", (e) => {
        const id = e.dataTransfer && e.dataTransfer.getData("application/x-hass-recipe");
        if (!id) return;
        e.preventDefault();
        const day = dayAt(e);
        unlight();
        const recipe = this._recipe(id);
        if (!day || !recipe) return;
        // a recipe whose category says which meal it is for goes straight in; otherwise ask
        const slot = this._planSlotFor(recipe);
        if (slot) this._planAddQuick(day.date, slot, recipe);
        else this._planDropDialog(day.date, recipe);
      });
      // wait for the calendar to be drawn, then take over its clicks and dragging
      for (let i = 0; i < 50 && !cal.calendar; i++) await new Promise((r) => setTimeout(r, 100));
      const fc = cal.calendar;
      if (!fc) return;
      const canEdit = this._canEdit !== false;
      fc.setOption("displayEventTime", false);
      fc.setOption("eventClick", (info) => this._planEntryDialog(info.event.id));
      fc.setOption("dateClick", (info) => {
        if (info.view.type === "dayGridMonth") return cal._handleDateClick(info); // like Home Assistant: open the day
        if (canEdit) this._planAddDialog(info.dateStr.slice(0, 10));
      });
      fc.setOption("editable", canEdit);
      fc.setOption("eventDurationEditable", false);
      fc.setOption("eventDrop", async (info) => {
        try {
          await this._ws({ type: "hass_recipes/plan_update", entry_id: info.event.id, date: info.event.startStr.slice(0, 10) });
        } catch (err) {
          info.revert();
          this._error = err.message || String(err);
          this._render();
        }
      });
      // the date the calendar was showing before the page was rebuilt
      if (this._planCalDate) fc.gotoDate(this._planCalDate);
      this._planPush();
    },

    // ---- dialogs (put on the page directly, so the calendar is not rebuilt) ----
    /** A dialog (a sheet from the bottom on a phone): a title, an optional line under it, the body, and `footer` buttons. */
    _planDialog(title, html, bind, opts = {}) {
      const dlg = document.createElement("ha-adaptive-dialog");
      dlg.setAttribute("open", "");
      dlg.setAttribute("flexcontent", "");
      dlg.setAttribute("header-title", title);
      if (opts.subtitle) dlg.setAttribute("header-subtitle", opts.subtitle);
      dlg.innerHTML = `<div class="pdlg">${html}</div>`;
      dlg.addEventListener("closed", (e) => {
        if (e.target === dlg) dlg.remove();
      });
      this.shadowRoot.appendChild(dlg);
      bind(dlg, () => (dlg.open = false));
    },

    /** The buttons at the foot of a dialog, in Home Assistant's own footer: one main action and any number of others. */
    _planFooter(dlg, { primary = null, secondary = [] } = {}) {
      dlg.querySelectorAll(':scope > [slot="footer"]').forEach((n) => n.remove());
      if (!primary && !secondary.length) return;
      const btn = (b, slot, appearance) =>
        `<ha-button slot="${slot}" appearance="${appearance}" ${b.variant ? `variant="${b.variant}"` : ""} ${b.id ? `id="${b.id}"` : ""} ${b.attrs || ""}>${b.icon ? `<ha-icon slot="start" icon="mdi:${b.icon}"></ha-icon>` : ""}${esc(b.label)}</ha-button>`;
      dlg.insertAdjacentHTML(
        "beforeend",
        `<ha-dialog-footer slot="footer">${secondary.map((b) => btn(b, "secondaryAction", "plain")).join("")}${primary ? btn(primary, "primaryAction", "filled") : ""}</ha-dialog-footer>`
      );
    },

    _planSlotChips(slot) {
      return `<div class="pd-slots">${this._planMeals()
        .map((m) => `<ha-assist-chip data-slot="${esc(m.id)}" label="${esc(this._planLabel(m.id))}" ${m.id === slot ? "active" : ""}></ha-assist-chip>`)
        .join("")}</div>`;
    },

    _planBindSlots(dlg, onPick) {
      dlg.querySelectorAll("[data-slot]").forEach((chip) =>
        chip.addEventListener("click", () => {
          dlg.querySelectorAll("[data-slot]").forEach((c) => c.toggleAttribute("active", c === chip));
          onPick(chip.dataset.slot);
        })
      );
    },

    _planResultsHtml(query) {
      const q = (query || "").trim().toLowerCase();
      const found = this._recipes
        .filter((r) => !q || [r.name, ...(r.tags || []), ...(r.categories || [])].join(" ").toLowerCase().includes(q))
        .slice(0, 30);
      if (!found.length) return `<p class="muted pd-empty">${esc(T("No recipes match. Use the text box to add a plain meal."))}</p>`;
      return found
        .map(
          (r) => `<ha-list-item-button data-rid="${esc(r.id)}" headline="${esc(r.name)}" supporting-text="${esc(minutes(r.total_time) || "")}">
            <span slot="start" class="pd-thumb" ${r.image ? `style="background-image:url('${esc(r.image)}')"` : ""}></span></ha-list-item-button>`
        )
        .join("");
    },

    /** "Add a meal" for a day: pick a recipe (or type a plain meal) and the meal of the day. */
    _planAddDialog(date, recipeId = null) {
      const pending = recipeId ? this._recipe(recipeId) : this._planPending ? this._recipe(this._planPending) : null;
      let slot = this._planSlotFor(pending) || "dinner";
      let touched = false; // once a meal of the day is picked by hand, a recipe's category no longer chooses it
      const html = `
        <ha-input id="pd-date" type="date" appearance="outlined" label="${esc(T("Day"))}" value="${esc(date)}"></ha-input>
        ${this._planSlotChips(slot)}
        ${
          pending
            ? `<p>${esc(T("Add"))} <strong>${esc(pending.name)}</strong></p><ha-button id="pd-confirm" size="m">${esc(T("Add to the meal plan"))}</ha-button>`
            : `<ha-input-search id="pd-search" appearance="outlined" placeholder="${esc(T("Search recipes"))}"></ha-input-search>
               <ha-list-base id="pd-results" class="pd-results">${this._planResultsHtml("")}</ha-list-base>
               <div class="pd-plain"><ha-input id="pd-text" appearance="outlined" placeholder="${esc(T("…or a plain meal, e.g. Leftovers"))}"></ha-input>
               <ha-button id="pd-text-add" appearance="filled">${esc(T("Add"))}</ha-button></div>`
        }`;
      this._planDialog(T("Add a meal"), html, (dlg, close) => {
        const day = () => dlg.querySelector("#pd-date").value || date;
        this._planBindSlots(dlg, (s) => {
          slot = s;
          touched = true;
        });
        const add = async (extra) => {
          close();
          try {
            await this._ws({ type: "hass_recipes/plan_add", date: day(), slot, ...extra });
            if (pending && !recipeId) {
              this._planPending = null;
              this._flash("Added to the meal plan.");
            }
          } catch (err) {
            this._error = err.message || String(err);
            this._render();
          }
        };
        if (pending) {
          dlg.querySelector("#pd-confirm").addEventListener("click", () => add({ recipe_id: pending.id }));
          return;
        }
        const results = dlg.querySelector("#pd-results");
        results.addEventListener("click", (e) => {
          const item = e.target.closest("[data-rid]");
          if (!item) return;
          if (!touched) slot = this._planSlotFor(this._recipe(item.dataset.rid)) || slot;
          add({ recipe_id: item.dataset.rid });
        });
        dlg.querySelector("#pd-search").addEventListener("input", (e) => (results.innerHTML = this._planResultsHtml(e.target.value)));
        const text = dlg.querySelector("#pd-text");
        const addText = () => text.value.trim() && add({ title: text.value.trim() });
        dlg.querySelector("#pd-text-add").addEventListener("click", addText);
        text.addEventListener("keydown", (e) => e.key === "Enter" && addText());
        setTimeout(() => dlg.querySelector("#pd-search")?.focus?.(), 300);
      });
    },

    /** A planned meal: move it to another day or meal, scale it, open or cook the recipe, or remove it. */
    _planEntryDialog(id) {
      const e = (this._planEntries || []).find((x) => x.id === id);
      if (!e) return;
      const canEdit = this._canEdit !== false;
      const html = `
        ${canEdit ? `<ha-input id="pe-date" type="date" appearance="outlined" label="${esc(T("Day"))}" value="${esc(e.date)}"></ha-input>${this._planSlotChips(e.slot)}` : `<p class="muted">${esc(e.date)} · ${esc(this._planLabel(e.slot))}</p>`}
        ${e.recipe_exists && canEdit ? `<ha-input id="pe-scale" type="number" min="0.25" step="0.25" appearance="outlined" label="${esc(T("Scale"))} ×" placeholder="1" value="${e.scale ? esc(e.scale) : ""}"></ha-input>` : ""}
        <div class="pd-actions">
          ${e.recipe_exists ? `<ha-button id="pe-open" appearance="filled"><ha-icon slot="start" icon="mdi:book-open-page-variant-outline"></ha-icon>${esc(T("Open recipe"))}</ha-button>
             <ha-button id="pe-cook" appearance="filled"><ha-icon slot="start" icon="mdi:chef-hat"></ha-icon>${esc(T("Cook this"))}</ha-button>` : ""}
          ${canEdit ? `<ha-button id="pe-del" appearance="plain" variant="danger"><ha-icon slot="start" icon="mdi:delete-outline"></ha-icon>${esc(T("Remove"))}</ha-button>` : ""}
        </div>`;
      this._planDialog(e.title, html, (dlg, close) => {
        const update = async (fields) => {
          try {
            await this._ws({ type: "hass_recipes/plan_update", entry_id: id, ...fields });
          } catch (err) {
            this._error = err.message || String(err);
            this._render();
          }
        };
        this._planBindSlots(dlg, (slot) => update({ slot }));
        dlg.querySelector("#pe-date")?.addEventListener("change", (ev) => ev.target.value && update({ date: ev.target.value }));
        dlg.querySelector("#pe-scale")?.addEventListener("change", (ev) => {
          const scale = parseFloat(ev.target.value);
          update({ scale: scale > 0 ? scale : null });
        });
        dlg.querySelector("#pe-open")?.addEventListener("click", () => {
          close();
          this._go({ name: "detail", id: e.recipe_id });
        });
        dlg.querySelector("#pe-cook")?.addEventListener("click", async () => {
          close();
          try {
            const state = await this._ws({ type: "hass_recipes/plan_cook", entry_id: id });
            this._go({ name: "cook", id: state.recipe_id, step: 0 });
          } catch (err) {
            this._error = err.message || String(err);
            this._render();
          }
        });
        dlg.querySelector("#pe-del")?.addEventListener("click", async () => {
          close();
          try {
            await this._ws({ type: "hass_recipes/plan_delete", entry_id: id });
          } catch (err) {
            this._error = err.message || String(err);
            this._render();
          }
        });
      });
    },

    // ---- the meals of the day: define them ----
    _planMealsDialog() {
      const model = this._planMeals().map((m) => ({ ...m, words: [...(m.words || [])] }));
      let open = -1; // the meal that is open for editing
      const html = `<div id="pm-list" class="pm-list"></div>
        <ha-alert id="pm-err" alert-type="error" hidden></ha-alert>
        <div class="pd-actions">
          <ha-button id="pm-add" appearance="plain"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Add a meal of the day"))}</ha-button>
          <span style="flex:1"></span>
          <ha-button id="pm-save" appearance="filled">${esc(T("Save"))}</ha-button>
        </div>`;
      this._planDialog(T("Meals of the day"), html, (dlg, close) => {
        const list = dlg.querySelector("#pm-list");
        const err = dlg.querySelector("#pm-err");
        const schema = [
          { name: "name", selector: { text: {} } },
          { name: "time", selector: { time: {} } },
          { name: "color", selector: { ui_color: { include_state: false, include_none: false } } },
          { name: "words", selector: { text: { multiple: true } } },
        ];
        const labels = {
          name: "Name",
          time: "Time in the calendar",
          color: "Colour",
          words: "Categories that choose this meal",
        };
        const title = (m) => `${m.name || (BUILTIN[m.id] ? T(BUILTIN[m.id]) : T("New meal"))} · ${m.time}`;
        const draw = () => {
          list.textContent = "";
          model.forEach((m, i) => {
            const panel = document.createElement("ha-expansion-panel");
            panel.setAttribute("left-chevron", "");
            if (i === open) panel.setAttribute("expanded", "");
            const head = document.createElement("div");
            head.slot = "header";
            head.className = "pm-head";
            head.innerHTML = `<span class="plan-dot"></span><span class="pm-title"></span>`;
            const dot = head.querySelector(".plan-dot");
            const setHead = () => {
              dot.style.background = getComputedStyle(this).getPropertyValue(`--${m.color}-color`).trim() || COLOR_FALLBACK[m.color] || COLOR_FALLBACK.blue;
              head.querySelector(".pm-title").textContent = title(m);
            };
            setHead();
            panel.appendChild(head);
            const form = document.createElement("ha-form");
            form.hass = this._hass;
            form.schema = schema;
            form.data = { name: m.name, time: `${m.time}:00`, color: m.color, words: m.words };
            form.computeLabel = (sc) => T(labels[sc.name] || sc.name);
            form.computeHelper = (sc) =>
              sc.name === "name" && BUILTIN[m.id] ? T("Leave empty to use the standard name") : sc.name === "words" ? T("A recipe in one of these categories goes to this meal") : "";
            form.addEventListener("value-changed", (e) => {
              e.stopPropagation();
              const v = e.detail.value || {};
              form.data = v;
              m.name = String(v.name || "").trim();
              m.time = String(v.time || m.time).slice(0, 5);
              m.color = v.color || m.color;
              m.words = (v.words || []).map((w) => String(w).trim()).filter(Boolean);
              setHead();
            });
            panel.appendChild(form);
            const tools = document.createElement("div");
            tools.className = "pd-actions pm-tools";
            const btn = (icon, label, fn, extra = "") => {
              const b = document.createElement("ha-icon-button");
              b.label = label;
              if (extra) b.setAttribute("disabled", "");
              b.innerHTML = `<ha-icon icon="mdi:${icon}"></ha-icon>`;
              b.addEventListener("click", fn);
              tools.appendChild(b);
            };
            btn("arrow-up", T("Move up"), () => {
              [model[i - 1], model[i]] = [model[i], model[i - 1]];
              open = i - 1;
              draw();
            }, i === 0 ? "x" : "");
            btn("arrow-down", T("Move down"), () => {
              [model[i + 1], model[i]] = [model[i], model[i + 1]];
              open = i + 1;
              draw();
            }, i === model.length - 1 ? "x" : "");
            btn("delete-outline", T("Delete"), () => {
              model.splice(i, 1);
              open = -1;
              draw();
            }, model.length === 1 ? "x" : "");
            panel.appendChild(tools);
            panel.addEventListener("expanded-changed", (e) => {
              if (e.target === panel) open = e.detail.expanded ? i : open === i ? -1 : open;
            });
            list.appendChild(panel);
          });
        };
        draw();
        dlg.querySelector("#pm-add").addEventListener("click", () => {
          model.push({ id: "", name: "", color: "teal", time: "12:00", minutes: 60, words: [] });
          open = model.length - 1;
          draw();
        });
        dlg.querySelector("#pm-save").addEventListener("click", async () => {
          err.hidden = true;
          try {
            const res = await this._ws({
              type: "hass_recipes/plan_meals_set",
              meals: model.map((m) => ({ ...(m.id ? { id: m.id } : {}), name: m.name, color: m.color, time: m.time, minutes: m.minutes || 60, words: m.words })),
            });
            this._planMealList = res.meals;
            close();
            this._planPush();
            this._render();
          } catch (e) {
            err.textContent = e.message || String(e);
            err.hidden = false;
          }
        });
      });
    },

    // ---- actions on what the calendar shows ----
    /** The days the calendar is on (not the padding of the month view): [first, last] as dates. */
    _planPeriod() {
      const fc = this._planCal && this._planCal.calendar;
      if (!fc) return null;
      return { first: fc.view.currentStart, last: addDays(fc.view.currentEnd, -1), type: fc.view.type };
    },

    /** Copy last week's meals onto the week on screen (meals already there are kept). */
    async _planCopyLastWeek() {
      const p = this._planPeriod();
      if (!p || !["dayGridWeek", "listWeek"].includes(p.type)) {
        this._flash("Switch to the week view to copy last week.");
        return;
      }
      try {
        const res = await this._ws({
          type: "hass_recipes/plan_copy",
          source: isoDate(addDays(p.first, -7)),
          target: isoDate(p.first),
          days: 7,
        });
        this._flash(res.added ? `Copied ${res.added} meals from last week.` : "Nothing new to copy from last week.");
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    async _planToShopping() {
      const p = this._planPeriod();
      if (!p) return;
      const days = Math.min(60, Math.round((p.last - p.first) / 864e5) + 1);
      const entity_id = this._shopEntity || "todo.shopping_list";
      try {
        const res = await this._hass.callWS({
          type: "call_service",
          domain: "hass_recipes",
          service: "add_plan_to_shopping_list",
          service_data: { start: isoDate(p.first), days, entity_id },
          return_response: true,
        });
        const r = res.response || {};
        this._flash(`Added ${r.added?.length || 0} items from ${r.meals || 0} meals to ${entity_id}${r.skipped?.length ? ` (${r.skipped.length} already there)` : ""}.`);
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    /** The meal of the day a recipe's categories point to ("Aftensmad" is dinner), or null. */
    _planSlotFor(recipe) {
      for (const c of (recipe && recipe.categories) || []) {
        const low = String(c).toLowerCase();
        for (const m of this._planMeals()) if ((m.words || []).some((w) => low.includes(w))) return m.id;
      }
      return null;
    },

    /** Add a recipe to a day and meal straight away, with an Undo. */
    async _planAddQuick(date, slot, recipe) {
      try {
        const entry = await this._ws({ type: "hass_recipes/plan_add", date, slot, recipe_id: recipe.id });
        const when = new Intl.DateTimeFormat((this._hass && this._hass.language) || undefined, { weekday: "short", day: "numeric", month: "short" }).format(
          new Date(`${date}T12:00:00`)
        );
        this._flash(`${recipe.name} · ${this._planLabel(slot)} · ${when}`, {
          label: "Undo",
          run: () => this._ws({ type: "hass_recipes/plan_delete", entry_id: entry.id }),
        });
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    // ---- the category pane: recipes to drag onto the calendar ----
    _planOpenCats() {
      if (!this._planOpen) {
        try {
          this._planOpen = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"));
        } catch (_) {
          this._planOpen = new Set();
        }
      }
      return this._planOpen;
    },

    /** The recipes by category (a recipe is listed under each of its categories), as expansion panels. */
    _planCatsHtml(query) {
      const q = (query || "").trim().toLowerCase();
      const none = T("Uncategorized");
      const groups = new Map();
      for (const r of this._recipes) {
        if (q && ![r.name, ...(r.tags || []), ...(r.categories || [])].join(" ").toLowerCase().includes(q)) continue;
        for (const c of r.categories && r.categories.length ? r.categories : [none]) {
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c).push(r);
        }
      }
      if (!groups.size) return `<p class="plan-hint">${esc(T("No recipes match."))}</p>`;
      const open = this._planOpenCats();
      const names = [...groups.keys()].sort((a, b) => (a === none) - (b === none) || a.localeCompare(b, undefined, { sensitivity: "base" }));
      return names
        .map((name) => {
          const list = groups.get(name).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
          return `<ha-expansion-panel left-chevron data-cat="${esc(name)}" ${q || open.has(name) ? "expanded" : ""}>
            <div slot="header" class="plan-cat">${esc(name)} <span class="plan-count">${list.length}</span></div>
            ${list
              .map(
                (r) => `<ha-list-item-button draggable="true" class="plan-rec" data-rid="${esc(r.id)}" headline="${esc(r.name)}" supporting-text="${esc(minutes(r.total_time) || "")}">
                  <span slot="start" class="pd-thumb" ${r.image ? `style="background-image:url('${esc(r.image)}')"` : ""}></span></ha-list-item-button>`
              )
              .join("")}
          </ha-expansion-panel>`;
        })
        .join("");
    },

    _planBindPane(root) {
      const box = root.getElementById("plan-recs");
      if (!box) return;
      const bindOpen = () =>
        box.querySelectorAll("ha-expansion-panel[data-cat]").forEach((panel) =>
          panel.addEventListener("expanded-changed", (e) => {
            if (e.target !== panel || (this._planQuery || "").trim()) return;
            const open = this._planOpenCats();
            if (e.detail.expanded) open.add(panel.dataset.cat);
            else open.delete(panel.dataset.cat);
            try {
              localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
            } catch (_) { /* ignore */ }
          })
        );
      bindOpen();
      // a drag that ends anywhere else leaves no highlighted day behind
      box.addEventListener("dragend", () => this._planCal && this._planCal._unlight && this._planCal._unlight());
      box.addEventListener("dragstart", (e) => {
        const item = e.target.closest && e.target.closest("[data-rid]");
        if (!item) return;
        e.dataTransfer.setData("application/x-hass-recipe", item.dataset.rid);
        e.dataTransfer.effectAllowed = "copy";
      });
      // a click on a recipe adds it too (the touch-friendly way): ask for the day
      box.addEventListener("click", (e) => {
        const item = e.target.closest && e.target.closest("[data-rid]");
        if (item && this._canEdit !== false) this._planAddDialog(isoDate(new Date()), item.dataset.rid);
      });
      const search = root.getElementById("plan-q");
      if (search)
        search.addEventListener("input", () => {
          this._planQuery = search.value;
          box.innerHTML = this._planCatsHtml(this._planQuery);
          bindOpen();
        });
    },

    /** Dropping a recipe on a day: one click picks the meal of the day. */
    _planDropDialog(date, recipe) {
      const when = new Intl.DateTimeFormat((this._hass && this._hass.language) || undefined, { weekday: "long", day: "numeric", month: "long" }).format(
        new Date(`${date}T12:00:00`)
      );
      const html = `<p class="plan-hint">${esc(recipe.name)} · ${esc(when)}</p>
        <ha-list-base>${this._planMeals()
          .map(
            (m) => `<ha-list-item-button data-slot="${esc(m.id)}" headline="${esc(this._planLabel(m.id))}"><span slot="start" class="plan-dot" style="background:${this._planColor(m.id)}"></span></ha-list-item-button>`
          )
          .join("")}</ha-list-base>`;
      this._planDialog(T("Add to the meal plan"), html, (dlg, close) => {
        dlg.querySelector("ha-list-base").addEventListener("click", async (e) => {
          const item = e.target.closest("[data-slot]");
          if (!item) return;
          close();
          try {
            await this._ws({ type: "hass_recipes/plan_add", date, slot: item.dataset.slot, recipe_id: recipe.id });
          } catch (err) {
            this._error = err.message || String(err);
            this._render();
          }
        });
      });
    },

    _bindPlan(root, on) {
      if (this._view.name !== "plan") return;
      this._planBindPane(root);
      const menu = root.getElementById("plan-menu");
      if (menu) menu.addEventListener("wa-select", (e) => this._action(e.detail.item.value));
      this._planMount(root);
    },

    _planHtml() {
      const pending = this._planPending ? this._recipe(this._planPending) : null;
      if (this._canEdit !== false) {
        this._fab = `<ha-button class="fab ${this._brCompact() ? "above-tabs" : ""}" size="l" data-act="plan-add-dialog"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Add meal"))}</ha-button>`;
      }
      const pane = this._brCompact()
        ? ""
        : `<aside class="plan-pane">
            <div class="plan-search"><ha-input-search id="plan-q" appearance="outlined" placeholder="${esc(T("Search recipes"))}" value="${esc(this._planQuery || "")}"></ha-input-search></div>
            <p class="plan-hint">${esc(T("Drag a recipe onto a day in the calendar."))}</p>
            <div id="plan-recs" class="plan-recs">${this._planCatsHtml(this._planQuery || "")}</div>
            <div class="plan-legend">${this._planMeals()
              .map((m) => `<span class="plan-key"><span class="plan-dot" style="background:${this._planColor(m.id)}"></span>${esc(this._planLabel(m.id))}</span>`)
              .join("")}</div>
          </aside>`;
      return `<div class="plan-page">${pane}
        <div class="plan-main">
          ${
            pending
              ? `<ha-alert alert-type="info">${esc(T("Pick a day for"))} <strong>${esc(pending.name)}</strong>: ${esc(T("click a day in the calendar."))}
                  <ha-button slot="action" size="s" appearance="plain" data-act="plan-cancel-pending">${esc(T("Cancel"))}</ha-button></ha-alert>`
              : ""
          }
          <div id="plan-cal" class="plan-cal"></div>
        </div></div>`;
    },
  };
}
