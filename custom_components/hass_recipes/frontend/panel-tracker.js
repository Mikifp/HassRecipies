/* Recipes panel: the Tracker page (calories and macros, by person and day). Mixed into the panel class by recipes-panel.js.
 *
 * A day has meals (the meal plan's own), each with entries that came from a recipe, a food or a quick note.
 * The page shows kcal first (Home Assistant's own gauge) and the macros beside it, a week or month as a chart,
 * and logs a planned meal as eaten in one tap. The server (tracker.py) keeps everything; an entry keeps the
 * nutrition it had when it was logged.
 */
export default function (h) {
  const { esc, T, state, isoDate, addDays, mondayOf, fl } = h;
  const MACROS = [
    ["protein", "Protein"],
    ["carbs", "Carbs"],
    ["fat", "Fat"],
  ];
  const num = (v, digits = 0) =>
    v == null || Number.isNaN(Number(v)) ? "–" : new Intl.NumberFormat(state.language || "en", { maximumFractionDigits: digits }).format(v);
  const parseDay = (iso) => new Date(`${iso}T12:00:00`);
  const dayLabel = (iso, today) => {
    if (iso === today) return T("Today");
    if (iso === isoDate(addDays(parseDay(today), -1))) return T("Yesterday");
    if (iso === isoDate(addDays(parseDay(today), 1))) return T("Tomorrow");
    return new Intl.DateTimeFormat(state.language || undefined, { weekday: "short", day: "numeric", month: "short" }).format(parseDay(iso));
  };
  const monthFirst = (iso) => `${iso.slice(0, 8)}01`;
  const monthLast = (iso) => {
    const d = parseDay(iso);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  };

  return {
    // ---- data ----
    _tkState() {
      return (this._tk = this._tk || { data: null, range: null, loading: false, personId: "", date: "", mode: "day", error: "", foods: null });
    },

    /** The range the week or month view shows around the day on screen. */
    _tkSpan() {
      const st = this._tkState();
      const day = st.date || isoDate(new Date());
      if (st.mode === "month") return [monthFirst(day), monthLast(day)];
      const monday = mondayOf(parseDay(day));
      return [isoDate(monday), isoDate(addDays(monday, 6))];
    },

    async _tkLoad() {
      const st = this._tkState();
      if (st.loading) return;
      st.loading = true;
      try {
        const msg = { type: "hass_recipes/tracker_day" };
        if (st.personId) msg.person_id = st.personId;
        if (st.date) msg.date = st.date;
        st.data = await this._ws(msg);
        st.personId = st.data.person.id;
        st.date = st.data.date;
        st.error = "";
        this._planMealList = st.data.meals;
        if (st.mode !== "day") {
          const [start, end] = this._tkSpan();
          st.range = await this._ws({ type: "hass_recipes/tracker_range", person_id: st.personId, start, end });
        }
      } catch (err) {
        st.error = err.message || String(err);
      }
      st.loading = false;
      if (this._view.name === "tracker") this._render();
    },

    _tkSubscribe() {
      if (this._tkSub || !this._hass) return;
      this._tkSub = true;
      this._hass.connection
        .subscribeEvents(() => {
          if (this._view.name === "tracker" && !this._tkSelfChange) this._tkLoad();
        }, "hass_recipes_tracker_changed")
        .catch(() => (this._tkSub = false));
    },

    async _tkCall(msg) {
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

    async _tkChanged() {
      await this._tkLoad();
    },

    // ---- the page ----
    _trackerHtml() {
      const st = this._tkState();
      this._tkSubscribe();
      if (!st.data && !st.loading) this._tkLoad();
      if (st.error && !st.data) return `<ha-alert alert-type="error">${esc(st.error)}</ha-alert>`;
      if (!st.data) return `<div class="muted tk-loading">${esc(T("Loading…"))}</div>`;
      const d = st.data;
      const p = d.person;
      const compact = this._brCompact();
      if (p.editable) this._fab = `<ha-button class="fab ${compact ? "above-tabs" : ""}" size="l" data-act="tk-add"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Add food"))}</ha-button>`;
      const people = d.persons
        .map((x) => `<ha-assist-chip data-tkp="${esc(x.id)}" label="${esc(x.name)}" ${x.id === p.id ? "active" : ""}><ha-icon slot="icon" icon="mdi:${x.user_id ? "account" : "account-outline"}"></ha-icon></ha-assist-chip>`)
        .join("");
      const mode = (key, label) => `<ha-assist-chip data-tkm="${key}" label="${esc(T(label))}" ${st.mode === key ? "active" : ""}></ha-assist-chip>`;
      const step = st.mode === "day" ? 1 : st.mode === "week" ? 7 : 30;
      const title =
        st.mode === "day"
          ? dayLabel(d.date, d.today)
          : (() => {
              const [a, b] = this._tkSpan();
              const f = new Intl.DateTimeFormat(state.language || undefined, st.mode === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "short" });
              return st.mode === "month" ? f.format(parseDay(a)) : `${f.format(parseDay(a))} – ${f.format(parseDay(b))}`;
            })();
      return `<div class="tk-page">
          <div class="tk-tool">
            <div class="tk-people">${people}<ha-assist-chip data-tkact="person-add" label="${esc(T("Add person"))}"><ha-icon slot="icon" icon="mdi:plus"></ha-icon></ha-assist-chip></div>
            <ha-dropdown id="tk-menu"><ha-icon-button slot="trigger" label="${esc(T("More"))}"><ha-icon icon="mdi:dots-vertical"></ha-icon></ha-icon-button>
              ${p.editable ? `<ha-dropdown-item value="goals"><ha-icon slot="icon" icon="mdi:target"></ha-icon>${esc(T("Edit goals"))}</ha-dropdown-item>` : ""}
              ${p.editable && (!p.user_id || this._tkAdmin()) ? `<ha-dropdown-item value="person-delete" variant="danger"><ha-icon slot="icon" icon="mdi:account-remove-outline"></ha-icon>${esc(`${T("Remove")} ${p.name}`)}</ha-dropdown-item>` : ""}
            </ha-dropdown>
          </div>
          <div class="tk-tool">
            <div class="tk-nav">
              <ha-icon-button data-tknav="-${step}" label="${esc(T("Previous"))}"><ha-icon icon="mdi:chevron-left"></ha-icon></ha-icon-button>
              <b class="tk-title">${esc(title)}</b>
              <ha-icon-button data-tknav="${step}" label="${esc(T("Next"))}"><ha-icon icon="mdi:chevron-right"></ha-icon></ha-icon-button>
              <ha-assist-chip data-tknav="today" label="${esc(T("Today"))}"></ha-assist-chip>
            </div>
            <div class="tk-modes">${mode("day", "Day")}${mode("week", "Week")}${mode("month", "Month")}</div>
          </div>
          ${p.editable ? "" : `<ha-alert alert-type="info">${esc(`${T("This is")} ${p.name}${T("'s log. You can look at it, but only they or an administrator can change it.")}`)}</ha-alert>`}
          ${st.mode === "day" ? this._tkDayHtml(d) : this._tkRangeHtml(st)}
        </div>`;
    },

    _tkAdmin() {
      return !!(this._hass && this._hass.user && this._hass.user.is_admin);
    },

    /** The goal card: kcal in Home Assistant's gauge, the macros in smaller ones. */
    _tkSummaryHtml(totals, goals, editable) {
      const left = goals.kcal != null ? goals.kcal - totals.kcal : null;
      const macros = MACROS.map(
        ([k, label]) => `<div class="tk-macro"><ha-gauge id="tk-g-${k}"></ha-gauge><div class="tk-mlabel">${esc(T(label))}<br><b>${num(totals[k])}</b>${goals[k] ? ` / ${num(goals[k])} g` : " g"}</div></div>`
      ).join("");
      return `<ha-card class="tk-summary"><div class="card-content">
          <div class="tk-kcal">
            <ha-gauge id="tk-g-kcal"></ha-gauge>
            <div class="tk-ktext">
              <div class="tk-big">${num(totals.kcal)} <span>kcal</span></div>
              ${
                goals.kcal != null
                  ? `<div class="${left < 0 ? "tk-over" : "muted"}">${left >= 0 ? `${num(left)} ${esc(T("kcal left"))}` : `${num(-left)} ${esc(T("kcal over"))}`} · ${esc(T("Goal"))} ${num(goals.kcal)}</div>`
                  : editable
                    ? `<ha-button size="s" appearance="plain" data-tkact="goals"><ha-icon slot="start" icon="mdi:target"></ha-icon>${esc(T("Set a goal"))}</ha-button>`
                    : `<div class="muted">${esc(T("No goal set"))}</div>`
              }
            </div>
          </div>
          <div class="tk-macros">${macros}</div>
        </div></ha-card>`;
    },

    _tkDayHtml(d) {
      const p = d.person;
      const edit = p.editable;
      const meals = d.meals || this._planMeals();
      const planned = d.planned
        .map(
          (x) => `<ha-card class="tk-planned"><div class="card-content tk-prow">
              <div><b>${esc(this._planLabel(x.meal))}</b> · ${esc(x.name)}<div class="muted">${x.kcal != null ? `≈ ${num(x.kcal)} kcal · ${esc(T("1 serving"))}` : esc(T("No nutrition for this recipe yet"))}</div></div>
              ${edit && x.kcal != null ? `<ha-button size="s" appearance="plain" data-tkplan="${esc(x.plan_id)}"><ha-icon slot="start" icon="mdi:check"></ha-icon>${esc(T("Log as eaten"))}</ha-button>` : ""}
            </div></ha-card>`
        )
        .join("");
      const cards = meals
        .map((m) => {
          const rows = d.entries.filter((e) => e.meal === m.id);
          const kcal = rows.reduce((n, e) => n + (e.kcal || 0), 0);
          const list = rows
            .map((e) => {
              const how = e.kind === "recipe" ? `${num(e.servings, 2)} ${T(e.servings === 1 ? "serving" : "servings")}` : e.kind === "food" ? `${num(e.amount, 1)} ${e.unit}` : T("Quick entry");
              const macro = MACROS.map(([k, l]) => (e[k] != null ? `${num(e[k])} g ${T(l).toLowerCase()}` : "")).filter(Boolean).join(" · ");
              return `<ha-list-item-button data-tkentry="${esc(e.id)}" headline="${esc(e.name)}" supporting-text="${esc([how, macro].filter(Boolean).join(" · "))}"><span slot="end" class="tk-ekcal">${num(e.kcal)} kcal</span></ha-list-item-button>`;
            })
            .join("");
          return `<ha-card class="tk-meal"><div class="card-content tk-mhead"><b>${esc(this._planLabel(m.id))}</b><span class="muted">${rows.length ? `${num(kcal)} kcal` : ""}</span></div>
              ${list ? `<ha-list-base>${list}</ha-list-base>` : ""}
              ${edit ? `<div class="card-actions"><ha-button size="s" appearance="plain" data-tkadd="${esc(m.id)}"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(`${T("Add to")} ${this._planLabel(m.id).toLowerCase()}`)}</ha-button></div>` : ""}
            </ha-card>`;
        })
        .join("");
      return `${this._tkSummaryHtml(d.totals, p.goals, edit)}${planned}${cards}`;
    },

    _tkRangeHtml(st) {
      const r = st.range;
      if (!r) return `<div class="muted tk-loading">${esc(T("Loading…"))}</div>`;
      const goals = st.data.person.goals;
      const avg = r.average;
      return `<ha-card class="tk-summary"><div class="card-content">
          <div class="tk-ktext"><div class="tk-big">${avg.kcal == null ? "–" : num(avg.kcal)} <span>${esc(T("kcal a day on average"))}</span></div>
            <div class="muted">${r.logged_days} ${esc(T(r.logged_days === 1 ? "day logged" : "days logged"))}${goals.kcal ? ` · ${esc(T("Goal"))} ${num(goals.kcal)}` : ""}</div></div>
          <div class="tk-avg">${MACROS.map(([k, label]) => `<div><div class="muted">${esc(T(label))}</div><b>${avg[k] == null ? "–" : num(avg[k])} g</b></div>`).join("")}</div>
          <div id="tk-chart" class="tk-chart"></div>
        </div></ha-card>`;
    },

    /** Home Assistant defines some of its elements only when a card needs them: ask for a card, then wait for the element. */
    async _tkElement(name, card) {
      if (!customElements.get(name) && window.loadCardHelpers) {
        try {
          const helpers = await window.loadCardHelpers();
          await helpers.createCardElement(card);
        } catch (_) {
          /* the wait below reports it */
        }
      }
      try {
        await Promise.race([customElements.whenDefined(name), new Promise((_, no) => setTimeout(no, 10000))]);
        return true;
      } catch (_) {
        return false;
      }
    },

    // ---- after the page is drawn: the gauges and the chart ----
    async _tkMount(root) {
      const st = this._tkState();
      if (!st.data) return;
      const menu = root.getElementById("tk-menu");
      if (menu) menu.addEventListener("wa-select", (e) => this._tkMenu(e.detail.item.value));
      if (st.mode === "day") {
        const ready = await this._tkElement("ha-gauge", { type: "gauge", entity: "sun.sun" });
        if (!ready && !customElements.get("ha-gauge")) await new Promise((r) => setTimeout(r, 3000));
        if (!root.getElementById("tk-g-kcal")) return;
        const { totals } = st.data;
        const goals = st.data.person.goals;
        const set = (id, value, goal, label, size) => {
          const g = root.getElementById(id);
          if (!g) return;
          const max = Math.max(goal || 0, value, 1);
          g.min = 0;
          g.max = max;
          g.value = value;
          g.label = label;
          g.valueText = num(value);
          g.levels = goal ? [{ level: 0, stroke: "var(--primary-color)" }, { level: goal + 0.01, stroke: "var(--error-color)" }] : [{ level: 0, stroke: "var(--primary-color)" }];
          g.locale = state.language || undefined;
          if (size) g.style.width = size;
        };
        set("tk-g-kcal", totals.kcal, goals.kcal, "kcal", "190px");
        MACROS.forEach(([k]) => set(`tk-g-${k}`, totals[k], goals[k], "g", "96px"));
      } else this._tkMountChart(root);
    },

    async _tkMountChart(root) {
      const host = root.getElementById("tk-chart");
      const st = this._tkState();
      const r = st.range;
      if (!host || !r) return;
      if (!(await this._tkElement("ha-chart-base", { type: "statistics-graph", entities: ["sun.sun"], stat_types: ["mean"] }))) {
        host.innerHTML = this._tkDaysList(r);
        return;
      }
      if (!host.isConnected) return;
      const goal = st.data.person.goals.kcal;
      const days = r.days;
      const wk = new Intl.DateTimeFormat(state.language || undefined, st.mode === "month" ? { day: "numeric" } : { weekday: "short" });
      const chart = document.createElement("ha-chart-base");
      chart.hass = this._hass;
      chart.height = "240px";
      const cs = getComputedStyle(this);
      const primary = cs.getPropertyValue("--primary-color").trim() || "#03a9f4";
      const error = cs.getPropertyValue("--error-color").trim() || "#db4437";
      const text = cs.getPropertyValue("--secondary-text-color").trim() || "#727272";
      // Home Assistant's chart is Apache ECharts: a series per kind, an axis that names the days
      chart.data = [
        {
          type: "bar",
          name: "kcal",
          data: days.map((x) => (x.logged ? { value: x.kcal, itemStyle: { color: goal && x.kcal > goal ? error : primary, borderRadius: [4, 4, 0, 0] } } : null)),
          barMaxWidth: 36,
        },
        ...(goal
          ? [{ type: "line", name: T("Goal"), data: days.map(() => goal), symbol: "none", lineStyle: { type: "dashed", width: 1, color: text }, itemStyle: { color: text }, silent: true }]
          : []),
      ];
      chart.options = {
        xAxis: { type: "category", data: days.map((x) => wk.format(parseDay(x.date))), axisLabel: { interval: 0 } },
        yAxis: { type: "value", min: 0, name: "kcal" },
        legend: { show: false },
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: { trigger: "axis" },
        dataZoom: [],
      };
      host.replaceChildren(chart);
    },

    _tkDaysList(r) {
      return `<ha-list-base>${r.days
        .filter((x) => x.logged)
        .map((x) => `<ha-list-item-button headline="${esc(dayLabel(x.date, this._tk.data.today))}"><span slot="end">${num(x.kcal)} kcal</span></ha-list-item-button>`)
        .join("")}</ha-list-base>`;
    },

    // ---- actions ----
    async _tkGo(date) {
      const st = this._tkState();
      st.date = date;
      st.range = null;
      await this._tkLoad();
    },

    _tkMenu(value) {
      if (value === "goals") this._tkGoalsDialog();
      else if (value === "person-delete") this._tkRemovePerson();
    },

    async _tkRemovePerson() {
      const st = this._tkState();
      const p = st.data.person;
      if (!confirm(`${T("Remove")} ${p.name}? ${T("Their log is deleted too.")}`)) return;
      const { ok } = await this._tkCall({ type: "hass_recipes/tracker_person_delete", person_id: p.id });
      if (ok) {
        st.personId = "";
        await this._tkLoad();
      }
    },

    _tkDefaultMeal() {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const meals = this._planMeals();
      let best = meals[0];
      for (const m of meals) if (m.time && Number(m.time.slice(0, 2)) * 60 + Number(m.time.slice(3, 5)) <= minutes + 60) best = m;
      return (best || { id: "snack" }).id;
    },

    async _tkAct(act, el) {
      const st = this._tkState();
      const d = st.data;
      switch (act) {
        case "tk-add":
          return this._tkAddDialog(this._tkDefaultMeal());
        case "add":
          return this._tkAddDialog(el.dataset.tkadd);
        case "goals":
          return this._tkGoalsDialog();
        case "person-add":
          return this._tkPersonDialog();
        case "plan": {
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_log_plan", person_id: d.person.id, plan_id: el.dataset.tkplan });
          if (ok) {
            await this._tkLoad();
            this._flash(T("Logged."));
          }
          return;
        }
        case "entry": {
          const entry = d.entries.find((e) => e.id === el.dataset.tkentry);
          if (entry) this._tkEntryDialog(entry);
        }
      }
    },

    // ---- dialogs ----
    _tkPersonDialog() {
      const html = `<ha-form id="tk-pf"></ha-form><div class="pd-actions"><ha-button appearance="filled" id="tk-pok">${esc(T("Add person"))}</ha-button></div>`;
      this._planDialog(T("Add person"), html, (dlg, close) => {
        const form = dlg.querySelector("#tk-pf");
        let data = { name: "" };
        form.hass = this._hass;
        form.schema = [{ name: "name", required: true, selector: { text: {} } }];
        form.data = data;
        form.computeLabel = () => T("Name");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          data = e.detail.value || data;
          form.data = data;
        });
        dlg.querySelector("#tk-pok").addEventListener("click", async () => {
          if (!String(data.name || "").trim()) return;
          close();
          const { ok, res } = await this._tkCall({ type: "hass_recipes/tracker_person_add", name: data.name });
          if (ok) {
            this._tkState().personId = res.id;
            await this._tkLoad();
          }
        });
      });
    },

    _tkGoalsDialog() {
      const st = this._tkState();
      const p = st.data.person;
      const html = `<ha-form id="tk-gf"></ha-form><div class="pd-actions"><ha-button appearance="filled" id="tk-gok">${esc(T("Save"))}</ha-button></div>`;
      this._planDialog(`${p.name}: ${T("Goals")}`, html, (dlg, close) => {
        const form = dlg.querySelector("#tk-gf");
        let data = { kcal: p.goals.kcal ?? null, protein: p.goals.protein ?? null, carbs: p.goals.carbs ?? null, fat: p.goals.fat ?? null };
        const labels = { kcal: "Energy per day (kcal)", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)" };
        form.hass = this._hass;
        form.schema = Object.keys(labels).map((name) => ({ name, selector: { number: { min: 0, max: 20000, step: 1, mode: "box" } } }));
        form.data = data;
        form.computeLabel = (sc) => T(labels[sc.name]);
        form.computeHelper = (sc) => (sc.name === "kcal" ? T("Leave a goal empty to not track it") : "");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          data = e.detail.value || data;
          form.data = data;
        });
        dlg.querySelector("#tk-gok").addEventListener("click", async () => {
          close();
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_goals", person_id: p.id, goals: data });
          if (ok) await this._tkLoad();
        });
      });
    },

    async _tkFoods() {
      const st = this._tkState();
      if (!st.foods) {
        try {
          st.foods = (await this._ws({ type: "hass_recipes/foods" })).foods;
        } catch (err) {
          st.foods = [];
        }
      }
      return st.foods;
    },

    /** What an entry in this form comes to: from the recipe's nutrition, the food's, or what was typed. */
    _tkCalc(draft, ctx) {
      const n = (v) => (v == null || v === "" ? null : Number(v));
      if (draft.kind === "quick") return { kcal: n(draft.kcal), protein: n(draft.protein), carbs: n(draft.carbs), fat: n(draft.fat) };
      if (draft.kind === "recipe") {
        const per = ctx.perServing;
        if (!per) return null;
        const s = Number(draft.servings) || 0;
        return { kcal: per.kcal == null ? null : per.kcal * s, protein: per.protein == null ? null : per.protein * s, carbs: per.carbs == null ? null : per.carbs * s, fat: per.fat == null ? null : per.fat * s };
      }
      const food = ctx.food;
      if (!food) return null;
      const grams = draft.unit && draft.unit !== "g" ? (food.unit_grams[draft.unit] || 0) * (Number(draft.amount) || 0) : Number(draft.amount) || 0;
      const v = (k) => (food.values[k] == null ? null : (food.values[k] * grams) / 100);
      return { kcal: v("kcal"), protein: v("protein"), carbs: v("carbs"), fat: v("fat") };
    },

    /** The form for one entry (adding or changing): amounts, meal, and what it comes to. */
    async _tkForm(dlg, draft, { onSave, onDelete, onStar, starred, onBack, saveLabel }) {
      const body = dlg.querySelector("#tk-body");
      const meals = this._planMeals();
      const ctx = {};
      if (draft.kind === "food") ctx.food = (await this._tkFoods()).find((f) => f.id === draft.food_id);
      if (draft.kind === "recipe") {
        try {
          const r = await this._ws({ type: "hass_recipes/nutrition", recipe_id: draft.recipe_id });
          ctx.perServing = r && (r.per_serving || r.total);
        } catch (err) {
          ctx.perServing = null;
        }
      }
      const num0 = (min, step) => ({ number: { min, max: 100000, step, mode: "box" } });
      const schema = [];
      if (draft.kind === "recipe") schema.push({ name: "servings", required: true, selector: num0(0.25, 0.25) });
      if (draft.kind === "food") {
        schema.push({ name: "amount", required: true, selector: num0(0, 1) });
        const units = ["g", ...Object.keys((ctx.food && ctx.food.unit_grams) || {})];
        schema.push({ name: "unit", selector: { select: { mode: "dropdown", options: units.map((u) => ({ value: u, label: u })) } } });
      }
      if (draft.kind === "quick") {
        schema.push({ name: "name", required: true, selector: { text: {} } }, { name: "kcal", required: true, selector: num0(0, 1) });
        for (const [k] of MACROS) schema.push({ name: k, selector: num0(0, 0.1) });
      }
      schema.push({ name: "meal", required: true, selector: { select: { mode: "dropdown", options: meals.map((m) => ({ value: m.id, label: this._planLabel(m.id) })) } } });
      const labels = { servings: "Servings", amount: "Amount", unit: "Unit", name: "Name", kcal: "Energy (kcal)", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)", meal: "Meal" };
      body.innerHTML = `<div class="tk-fhead"><b>${esc(draft.name || "")}</b></div>
        <ha-form id="tk-f"></ha-form>
        <div class="tk-preview muted" id="tk-pv"></div>
        <div class="pd-actions">
          <ha-button appearance="filled" id="tk-save">${esc(saveLabel)}</ha-button>
          ${onBack ? `<ha-button appearance="plain" id="tk-back">${esc(T("Back"))}</ha-button>` : ""}
          ${onStar ? `<ha-button appearance="plain" id="tk-star"><ha-icon slot="start" icon="mdi:${starred ? "star" : "star-outline"}"></ha-icon>${esc(T(starred ? "Favourite" : "Make favourite"))}</ha-button>` : ""}
          ${onDelete ? `<ha-button appearance="plain" variant="danger" id="tk-del"><ha-icon slot="start" icon="mdi:delete-outline"></ha-icon>${esc(T("Delete"))}</ha-button>` : ""}
        </div>`;
      const form = body.querySelector("#tk-f");
      const preview = () => {
        const c = this._tkCalc(draft, ctx);
        body.querySelector("#tk-pv").textContent = c && c.kcal != null ? `≈ ${num(c.kcal)} kcal${MACROS.map(([k, l]) => (c[k] != null ? ` · ${num(c[k])} g ${T(l).toLowerCase()}` : "")).join("")}` : draft.kind === "recipe" ? T("This recipe has no nutrition yet: link its ingredients to foods first.") : "";
      };
      form.hass = this._hass;
      form.schema = schema;
      form.data = draft;
      form.computeLabel = (sc) => T(labels[sc.name] || sc.name);
      form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        Object.assign(draft, e.detail.value || {});
        form.data = draft;
        preview();
      });
      preview();
      body.querySelector("#tk-save").addEventListener("click", () => onSave(draft));
      if (onBack) body.querySelector("#tk-back").addEventListener("click", onBack);
      if (onStar) body.querySelector("#tk-star").addEventListener("click", onStar);
      if (onDelete) body.querySelector("#tk-del").addEventListener("click", onDelete);
    },

    /** The ws message that logs `draft` on a day in a meal. */
    _tkPayload(draft) {
      const base = { kind: draft.kind, meal: draft.meal };
      if (draft.kind === "recipe") return { ...base, recipe_id: draft.recipe_id, servings: Number(draft.servings) };
      if (draft.kind === "food") return { ...base, food_id: draft.food_id, amount: Number(draft.amount), unit: draft.unit || "g" };
      const q = { ...base, name: draft.name, kcal: Number(draft.kcal) };
      for (const [k] of MACROS) if (draft[k] !== "" && draft[k] != null) q[k] = Number(draft[k]);
      return q;
    },

    /** Add food: search recipes and foods, or pick a favourite or a recent item, or write a quick entry. */
    async _tkAddDialog(meal) {
      const st = this._tkState();
      const d = st.data;
      const foods = await this._tkFoods();
      const html = `<div id="tk-body"></div>`;
      this._planDialog(`${T("Add to")} ${this._planLabel(meal).toLowerCase()}`, html, (dlg, close) => {
        const body = dlg.querySelector("#tk-body");
        const startWith = (item) => {
          const draft = { meal, ...item };
          if (draft.kind === "food") {
            draft.amount = draft.amount ?? 100;
            draft.unit = draft.unit || "g";
          }
          if (draft.kind === "recipe") draft.servings = draft.servings ?? 1;
          this._tkForm(dlg, draft, {
            saveLabel: T("Add"),
            onBack: pick,
            onSave: async (x) => {
              close();
              const { ok } = await this._tkCall({ type: "hass_recipes/tracker_add", person_id: d.person.id, date: d.date, ...this._tkPayload(x) });
              if (ok) {
                await this._tkLoad();
              }
            },
          });
        };
        const label = (item) => (item.kind === "recipe" ? "mdi:chef-hat" : item.kind === "food" ? "mdi:food-apple-outline" : "mdi:pencil-outline");
        const how = (t) => (t.kind === "recipe" ? `${num(t.servings, 2)} ${T("servings")}` : t.kind === "food" ? `${num(t.amount, 1)} ${t.unit}` : `${num(t.kcal)} kcal`);
        const pick = () => {
          body.innerHTML = `<ha-input-search id="tk-q" appearance="outlined" placeholder="${esc(T("Search recipes and foods"))}"></ha-input-search><div id="tk-res" class="tk-res"></div>`;
          const res = body.querySelector("#tk-res");
          let shown = [];
          const row = (item, sub) => {
            shown.push(item);
            return `<ha-list-item-button data-n="${shown.length - 1}" headline="${esc(item.name)}" supporting-text="${esc(sub)}"><ha-icon slot="start" icon="${label(item)}"></ha-icon></ha-list-item-button>`;
          };
          const head = (text) => `<div class="fm-head">${esc(T(text))}</div>`;
          const draw = (q) => {
            shown = [];
            const needle = q.trim().toLowerCase();
            let out = "";
            if (!needle) {
              const fav = d.favourites || [];
              const rec = (d.recent || []).filter((t) => !fav.some((f) => JSON.stringify(f) === JSON.stringify(t)));
              if (fav.length) out += head("Favourites") + fav.map((t) => row(t, how(t))).join("");
              if (rec.length) out += head("Recent") + rec.map((t) => row(t, how(t))).join("");
            }
            const recipes = this._recipes.filter((r) => !needle || r.name.toLowerCase().includes(needle)).slice(0, needle ? 15 : 5);
            const found = fl.rankFoods(foods, [], needle, []).slice(0, needle ? 20 : 8);
            if (recipes.length) out += head("Recipes") + recipes.map((r) => row({ kind: "recipe", recipe_id: r.id, name: r.name }, r.servings ? `${r.servings} ${T("servings")}` : "")).join("");
            if (found.length) out += head("Foods") + found.map((f) => row({ kind: "food", food_id: f.id, name: f.name }, f.values.kcal != null ? `${num(f.values.kcal)} kcal / 100 g` : T("No nutrition yet"))).join("");
            out += `<ha-list-item-button data-quick headline="${esc(T("Quick entry"))}" supporting-text="${esc(needle ? q.trim() : T("A name and kcal"))}"><ha-icon slot="start" icon="mdi:pencil-outline"></ha-icon></ha-list-item-button>`;
            res.innerHTML = `<ha-list-base>${out}</ha-list-base>`;
          };
          draw("");
          body.querySelector("#tk-q").addEventListener("input", (e) => draw(e.target.value));
          res.addEventListener("click", (e) => {
            if (e.target.closest("[data-quick]")) {
              const typed = body.querySelector("#tk-q").value.trim();
              return startWith({ kind: "quick", name: typed, kcal: "" });
            }
            const item = e.target.closest("[data-n]");
            if (item) startWith({ ...shown[+item.dataset.n] });
          });
        };
        pick();
      });
    },

    /** Change or delete what was logged. */
    _tkEntryDialog(entry) {
      const st = this._tkState();
      const d = st.data;
      const starred = (d.favourites || []).some((f) => ["kind", "recipe_id", "food_id", "servings", "amount", "unit", "name"].every((k) => f[k] === entry[k]));
      this._planDialog(entry.name, `<div id="tk-body"></div>`, (dlg, close) => {
        const draft = { ...entry };
        this._tkForm(dlg, draft, {
          saveLabel: T("Save"),
          starred,
          onSave: async (x) => {
            close();
            const p = this._tkPayload(x);
            delete p.kind;
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_update", entry_id: entry.id, ...p });
            if (ok) await this._tkLoad();
          },
          onStar: async () => {
            close();
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_favourite", person_id: d.person.id, entry_id: entry.id });
            if (ok) await this._tkLoad();
          },
          onDelete: async () => {
            close();
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_delete", entry_id: entry.id });
            if (ok) {
              await this._tkLoad();
              this._flash(`${T("Removed")} ${entry.name}.`);
            }
          },
        });
      });
    },

    // ---- binding ----
    _bindTracker(root, on) {
      const st = this._tkState();
      this._tkMount(root);
      on("[data-tkp]", "click", async (e) => {
        st.personId = e.currentTarget.dataset.tkp;
        st.range = null;
        await this._tkLoad();
      });
      on("[data-tkm]", "click", async (e) => {
        st.mode = e.currentTarget.dataset.tkm;
        st.range = null;
        await this._tkLoad();
      });
      on("[data-tknav]", "click", (e) => {
        const v = e.currentTarget.dataset.tknav;
        const base = parseDay(st.date);
        if (v === "today") return this._tkGo(st.data.today);
        const n = Number(v);
        if (st.mode === "month") {
          const d = parseDay(monthFirst(st.date));
          return this._tkGo(isoDate(new Date(d.getFullYear(), d.getMonth() + Math.sign(n), 1, 12)));
        }
        this._tkGo(isoDate(addDays(base, n)));
      });
      on("[data-tkact]", "click", (e) => this._tkAct(e.currentTarget.dataset.tkact, e.currentTarget));
      on("[data-tkadd]", "click", (e) => this._tkAct("add", e.currentTarget));
      on("[data-tkplan]", "click", (e) => this._tkAct("plan", e.currentTarget));
      on("[data-tkentry]", "click", (e) => this._tkAct("entry", e.currentTarget));
    },
  };
}
