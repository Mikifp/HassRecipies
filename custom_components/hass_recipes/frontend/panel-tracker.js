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
  /** "2 servings", "2 boller", "150 g": what an entry or a recent item is an amount of. */
  const howText = (e) => {
    if (e.kind === "recipe") {
      const by = e.by || "servings";
      if (by === "yield") return `${num(e.amount, 2)} ${e.unit || ""}`.trim();
      if (by === "grams") return `${num(e.amount, 1)} g`;
      const n = e.amount ?? e.servings;
      return `${num(n, 2)} ${T(n === 1 ? "serving" : "servings")}`;
    }
    if (e.kind === "food") return `${num(e.amount, 1)} ${e.unit}`;
    return T("Quick entry");
  };
  const MACRO_KEY = "hass_recipes_tracker_macros";
  // how the macros are shown, if at all: kcal only is the start
  const MACRO_STYLES = [
    ["off", "Hide macros", "eye-off-outline"],
    ["bars", "Show macros as bars", "chart-bar"],
    ["gauges", "Show macros as gauges", "gauge"],
    ["chips", "Show macros as chips", "tag-outline"],
  ];
  /** "Deficit 520 kcal" or "Surplus 120 kcal": what was eaten against maintenance. */
  const deficitText = (deficit) => (deficit >= 0 ? `${T("Deficit")} ${num(deficit)} kcal` : `${T("Surplus")} ${num(-deficit)} kcal`);
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
              ${p.editable ? `<ha-dropdown-item value="calc"><ha-icon slot="icon" icon="mdi:calculator-variant-outline"></ha-icon>${esc(T("Calorie calculator"))}</ha-dropdown-item>` : ""}
              ${p.editable ? `<ha-dropdown-item value="weight"><ha-icon slot="icon" icon="mdi:scale-bathroom"></ha-icon>${esc(T("Log weight"))}</ha-dropdown-item>` : ""}
              ${MACRO_STYLES.map(([id, label, icon]) => `<ha-dropdown-item value="macros-${id}"><ha-icon slot="icon" icon="mdi:${this._tkMacroStyle() === id ? "check" : icon}"></ha-icon>${esc(T(label))}</ha-dropdown-item>`).join("")}
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
    /** A slim summary that stays at the top while the meals scroll (shown once the gauges have scrolled away). */
    _tkPinHtml(d) {
      const goals = d.person.goals;
      const t = d.totals;
      const left = goals.kcal != null ? goals.kcal - t.kcal : null;
      const macros = this._tkMacroStyle() === "off" ? "" : MACROS.map(([k, l]) => `${T(l).charAt(0)} ${num(t[k])}${goals[k] ? `/${num(goals[k])}` : ""}`).join(" · ");
      return `<div id="tk-pin" class="tk-pin" hidden><b class="${left != null && left < 0 ? "tk-over" : ""}">${left == null ? num(t.kcal) : num(Math.abs(left))}</b> ${esc(left == null ? "kcal" : T(left >= 0 ? "kcal left" : "kcal over"))}<span class="muted"> · ${num(t.kcal)}${goals.kcal ? ` / ${num(goals.kcal)}` : ""} kcal${macros ? ` · ${esc(macros)}` : ""}</span></div>`;
    },

    /** How the macros are shown (bars, gauges or chips): kept in this browser. */
    _tkMacroStyle() {
      try {
        const v = localStorage.getItem(MACRO_KEY);
        return MACRO_STYLES.some((x) => x[0] === v) ? v : "off";
      } catch (_) {
        return "off";
      }
    },

    /** The macros of the day, in the chosen style. Over a goal, only that macro turns red. */
    _tkMacrosHtml(totals, goals, style) {
      const row = ([k, label]) => {
        const goal = goals[k];
        const over = goal && totals[k] > goal;
        const amount = goal ? `${num(totals[k])} / ${num(goal)} g` : `${num(totals[k])} g`;
        if (style === "chips") {
          const pct = goal ? ` · ${Math.round((totals[k] / goal) * 100)}%` : "";
          return `<ha-assist-chip class="tk-mchip ${over ? "over" : ""}" label="${esc(`${T(label)} ${amount}${pct}`)}"></ha-assist-chip>`;
        }
        if (style === "gauges") return `<div class="tk-macro"><ha-gauge id="tk-g-${k}"></ha-gauge><div class="tk-mlabel">${esc(T(label))}<br><b class="${over ? "tk-over" : ""}">${amount}</b></div></div>`;
        return `<div class="tk-mrow"><span>${esc(T(label))}</span><ha-control-slider id="tk-s-${k}" class="${over ? "over" : ""}"></ha-control-slider><span class="${over ? "tk-over" : "muted"}">${amount}</span></div>`;
      };
      return `<div class="tk-macros tk-m-${style}">${MACROS.map(row).join("")}</div>`;
    },

    _tkSummaryHtml(totals, goals, editable, d) {
      const style = this._tkMacroStyle();
      const goal = goals.kcal;
      const copy =
        d && editable && d.previous && d.previous.count
          ? `<div class="tk-copy"><ha-assist-chip data-tkact="copy" label="${esc(T("Copy yesterday"))}"><ha-icon slot="icon" icon="mdi:content-copy"></ha-icon></ha-assist-chip></div>`
          : "";
      const deficit = d && d.maintenance && totals.kcal ? `<div class="muted">${esc(deficitText(d.maintenance - totals.kcal))} · ${esc(T("maintenance"))} ${num(d.maintenance)}</div>` : "";
      if (goal == null) {
        // no goal: nothing to measure against, so a short card with the way to set one
        return `<ha-card class="tk-summary"><div class="card-content">
            <div class="tk-top">
              <div><div class="tk-big">${num(totals.kcal)} <span>${esc(T("kcal today"))}</span></div>
                <div class="muted">${esc(T(editable ? "Set a daily goal to see what is left." : "No goal set"))}</div>${deficit}</div>
              ${editable ? `<div class="tk-cta"><ha-button size="m" appearance="filled" data-tkact="goals"><ha-icon slot="start" icon="mdi:target"></ha-icon>${esc(T("Set a goal"))}</ha-button>
                <ha-button size="s" appearance="plain" data-tkact="calc"><ha-icon slot="start" icon="mdi:calculator-variant-outline"></ha-icon>${esc(T("Use the calculator"))}</ha-button></div>` : ""}
            </div>
            ${totals.kcal ? `<div class="tk-macros tk-m-chips">${MACROS.map(([k, l]) => `<ha-assist-chip label="${esc(`${T(l)} ${num(totals[k])} g`)}"></ha-assist-chip>`).join("")}</div>` : ""}
            ${copy}
          </div></ha-card>`;
      }
      const left = goal - totals.kcal;
      // a large number you can read from across the kitchen, with a thin bar under it
      return `<ha-card class="tk-summary"><div class="card-content tk-c">
          <div class="tk-huge ${left < 0 ? "tk-over" : ""}">${num(Math.abs(left))}</div>
          <div class="muted">${esc(T(left >= 0 ? "kcal left today" : "kcal over today"))} · ${esc(T("goal"))} ${num(goal)}</div>${deficit}
          <ha-control-slider id="tk-s-kcal" class="tk-kbar ${left < 0 ? "over" : ""}"></ha-control-slider>
          ${style === "off" ? "" : this._tkMacrosHtml(totals, goals, style)}
          ${copy}
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
              const how = howText(e);
              const macro = MACROS.map(([k, l]) => (e[k] != null ? `${num(e[k])} g ${T(l).toLowerCase()}` : "")).filter(Boolean).join(" · ");
              return `<ha-list-item-button data-tkentry="${esc(e.id)}" headline="${esc(e.name)}" supporting-text="${esc([how, macro].filter(Boolean).join(" · "))}"><span slot="end" class="tk-ekcal">${num(e.kcal)} kcal</span></ha-list-item-button>`;
            })
            .join("");
          return `<ha-card class="tk-meal"><div class="card-content tk-mhead"><b>${esc(this._planLabel(m.id))}</b><span class="muted">${rows.length ? `${num(kcal)} kcal` : ""}</span></div>
              ${list ? `<ha-list-base>${list}</ha-list-base>` : ""}
              ${
                edit
                  ? `<div class="card-actions tk-quick">${((d.usual || {})[m.id] || [])
                      .map((t, i) => `<ha-assist-chip data-tkusual="${esc(m.id)}:${i}" label="+ ${esc(t.name)}"><ha-icon slot="icon" icon="mdi:${t.kind === "recipe" ? "chef-hat" : t.kind === "food" ? "food-apple-outline" : "pencil-outline"}"></ha-icon></ha-assist-chip>`)
                      .join("")}<ha-assist-chip data-tkadd="${esc(m.id)}" label="${esc(T("More"))}"><ha-icon slot="icon" icon="mdi:plus"></ha-icon></ha-assist-chip></div>`
                  : ""
              }
            </ha-card>`;
        })
        .join("");
      return `${this._tkPinHtml(d)}${this._tkSummaryHtml(d.totals, p.goals, edit, d)}${planned}${cards}`;
    },

    _tkWeightCardHtml(r, person) {
      const w = r.weights;
      const latest = Object.keys(person.weights || {}).sort().pop();
      if (!latest && !person.editable) return "";
      const first = w[0];
      const last = w[w.length - 1];
      return `<div class="tk-weight">
          <div><div class="muted">${esc(T("Weight"))}</div>
            <b>${latest ? `${num(person.weights[latest], 1)} kg` : "–"}</b>
            ${w.length > 1 ? `<span class="muted"> · ${last.kg - first.kg > 0 ? "+" : ""}${num(last.kg - first.kg, 1)} kg ${esc(T("in this period"))}</span>` : ""}</div>
          ${person.editable ? `<ha-button size="s" appearance="plain" data-tkact="weight"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Log weight"))}</ha-button>` : ""}
          ${w.length > 1 ? `<div id="tk-wchart" class="tk-wchart"></div>` : ""}
        </div>`;
    },

    _tkRangeHtml(st) {
      const r = st.range;
      if (!r) return `<div class="muted tk-loading">${esc(T("Loading…"))}</div>`;
      const goals = st.data.person.goals;
      const avg = r.average;
      return `<ha-card class="tk-summary"><div class="card-content">
          <div class="tk-ktext"><div class="tk-big">${avg.kcal == null ? "–" : num(avg.kcal)} <span>${esc(T("kcal a day on average"))}</span></div>
            <div class="muted">${r.logged_days} ${esc(T(r.logged_days === 1 ? "day logged" : "days logged"))}${goals.kcal ? ` · ${esc(T("Goal"))} ${num(goals.kcal)}` : ""}</div></div>
          ${
            r.deficit_total != null
              ? `<div class="tk-deficit"><b>${esc(deficitText(r.deficit_total))}</b> <span class="muted">${esc(T("against maintenance"))} · ${esc(T("on average"))} ${num(Math.abs(r.deficit_average))} kcal ${esc(T(r.deficit_average >= 0 ? "a day under" : "a day over"))}</span>
                  <div class="muted">${esc(`≈ ${num(Math.abs(r.kg), 2)} kg ${T(r.kg >= 0 ? "lost" : "gained")} ${T("if it keeps up")}`)}</div></div>`
              : st.data.person.editable && !(st.data.person.profile && st.data.person.profile.sex)
                ? `<div class="tk-deficit"><ha-button size="s" appearance="plain" data-tkact="calc"><ha-icon slot="start" icon="mdi:calculator-variant-outline"></ha-icon>${esc(T("Work out your maintenance calories"))}</ha-button></div>`
                : ""
          }
          ${this._tkWeightCardHtml(r, st.data.person)}
          ${this._tkMacroStyle() === "off" ? "" : `<div class="tk-avg">${MACROS.map(([k, label]) => `<div><div class="muted">${esc(T(label))}</div><b>${avg[k] == null ? "–" : num(avg[k])} g</b></div>`).join("")}</div>`}
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
        // the slim summary shows once the gauges have scrolled out of sight
        const pin = root.getElementById("tk-pin");
        const card = root.querySelector(".tk-summary");
        if (this._tkObs) this._tkObs.disconnect();
        if (pin && card && "IntersectionObserver" in window) {
          this._tkObs = new IntersectionObserver(([entry]) => (pin.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0), { threshold: 0 });
          this._tkObs.observe(card);
        }
        const goals = st.data.person.goals;
        const { totals } = st.data;
        const style = this._tkMacroStyle();
        if (goals.kcal == null) return;
        if (style === "gauges") {
          const ready = await this._tkElement("ha-gauge", { type: "gauge", entity: "sun.sun" });
          if (!ready && !customElements.get("ha-gauge")) await new Promise((r) => setTimeout(r, 3000));
          // a gauge with a needle: the arc is the goal (blue up to it, red after) and the needle is where you are
          MACROS.forEach(([k]) => {
            const g = root.getElementById(`tk-g-${k}`);
            if (!g) return;
            const goal = goals[k];
            g.min = 0;
            g.max = Math.round(goal ? Math.max(goal * 1.25, totals[k] * 1.05) : Math.max(totals[k] * 1.25, 1));
            g.value = totals[k];
            g.needle = true;
            g.label = "g";
            g.valueText = num(totals[k]);
            g.levels = goal ? [{ level: 0, stroke: "var(--primary-color)" }, { level: goal, stroke: "var(--error-color)" }] : [{ level: 0, stroke: "var(--primary-color)" }];
            g.locale = state.language || undefined;
            g.style.width = "104px";
          });
        }
        // read-only bars (Home Assistant's control slider): kcal, and the macros when they are shown as bars
        await this._tkElement("ha-control-slider", { type: "tile", entity: "light.x", features: [{ type: "light-brightness" }] });
        const bar = (id, value, goal, label) => {
          const sl = root.getElementById(id);
          if (!sl) return;
          sl.min = 0;
          sl.max = Math.max(goal || 0, value, 1);
          sl.value = value;
          sl.step = 0.1;
          sl.mode = "start";
          sl.showHandle = false;
          sl.setAttribute("aria-readonly", "true");
          sl.setAttribute("aria-label", `${label} ${num(value)}`);
        };
        bar("tk-s-kcal", totals.kcal, goals.kcal, "kcal");
        if (style === "bars") MACROS.forEach(([k, l]) => bar(`tk-s-${k}`, totals[k], goals[k], T(l)));
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
        ...(days.some((x) => x.maintenance)
          ? [{ type: "line", name: T("maintenance"), data: days.map((x) => x.maintenance), symbol: "none", lineStyle: { type: "dotted", width: 1, color: text }, itemStyle: { color: text }, silent: true }]
          : []),
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
      const wh = root.getElementById("tk-wchart");
      if (wh && r.weights.length > 1) {
        const wc = document.createElement("ha-chart-base");
        wc.hass = this._hass;
        wc.height = "160px";
        wc.data = [{ type: "line", name: T("Weight"), data: r.weights.map((x) => [x.date, x.kg]), symbolSize: 6, lineStyle: { color: primary }, itemStyle: { color: primary } }];
        wc.options = {
          xAxis: { type: "time", min: days[0].date, max: days[days.length - 1].date },
          yAxis: { type: "value", scale: true, name: "kg" },
          legend: { show: false },
          grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
          tooltip: { trigger: "axis" },
          dataZoom: [],
        };
        wh.replaceChildren(wc);
      }
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
      else if (value.startsWith("macros-")) {
        try {
          localStorage.setItem(MACRO_KEY, value.slice(7));
        } catch (_) {
          /* not remembered */
        }
        this._render();
      } else if (value === "calc") this._tkCalcDialog();
      else if (value === "weight") this._tkWeightDialog();
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
        case "calc":
          return this._tkCalcDialog();
        case "weight":
          return this._tkWeightDialog();
        case "usual": {
          const [meal, i] = el.dataset.tkusual.split(":");
          const t = (d.usual[meal] || [])[Number(i)];
          if (!t) return;
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_add", person_id: d.person.id, date: d.date, ...this._tkPayload({ ...t, meal }) });
          if (ok) {
            await this._tkLoad();
            this._flash(`${T("Added")} ${t.name}.`);
          }
          return;
        }
        case "copy": {
          const already = d.entries.length;
          if (already && !confirm(T("This day already has entries. Copy yesterday's on top of them?"))) return;
          const { ok, res } = await this._tkCall({ type: "hass_recipes/tracker_copy", person_id: d.person.id, source: d.previous.date, date: d.date });
          if (ok) {
            await this._tkLoad();
            this._flash(`${res.added} ${T("items copied.")}${res.skipped ? ` ${res.skipped} ${T("could not be copied.")}` : ""}`);
          }
          return;
        }
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
      const html = `<ha-form id="tk-pf"></ha-form>`;
      this._planDialog(T("Add person"), html, (dlg, close) => {
        this._planFooter(dlg, { primary: { id: "tk-pok", label: T("Add person"), icon: "account-plus-outline" }, secondary: [{ id: "tk-pcancel", label: T("Cancel") }] });
        dlg.querySelector("#tk-pcancel").addEventListener("click", close);
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

    /** Goals: the kcal goal, then help with the macros: a split to start from, what the grams come to, and a fit to the kcal goal. */
    _tkGoalsDialog() {
      const st = this._tkState();
      const p = st.data.person;
      const latest = Object.keys(p.weights || {}).sort().pop();
      const weight = latest ? p.weights[latest] : (p.profile && p.profile.weight_kg) || null;
      const html = `<ha-form id="tk-gk"></ha-form>
        <div class="tk-sub">${esc(T("Suggest a split of protein, carbs and fat"))}</div>
        <div class="tk-chips" id="tk-gpre"></div>
        <ha-form id="tk-gm"></ha-form>
        <div id="tk-gsum" class="tk-gsum"></div>`;
      this._planDialog(T("Goals"), html, (dlg, close) => {
        this._planFooter(dlg, { primary: { id: "tk-gok", label: T("Save") }, secondary: [{ id: "tk-gcancel", label: T("Cancel") }] });
        dlg.querySelector("#tk-gcancel").addEventListener("click", close);
        let data = { kcal: p.goals.kcal ?? null, protein: p.goals.protein ?? null, carbs: p.goals.carbs ?? null, fat: p.goals.fat ?? null };
        const labels = { kcal: "Energy per day (kcal)", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)" };
        const box = (name) => ({ name, selector: { number: { min: 0, max: 20000, step: 1, mode: "box" } } });
        const kform = dlg.querySelector("#tk-gk");
        const mform = dlg.querySelector("#tk-gm");
        for (const [form, names] of [[kform, ["kcal"]], [mform, ["protein", "carbs", "fat"]]]) {
          form.hass = this._hass;
          form.schema = names.map(box);
          form.computeLabel = (sc) => T(labels[sc.name]);
        }
        kform.computeHelper = () => T("Leave a goal empty to not track it");
        const sync = () => {
          kform.data = { kcal: data.kcal };
          mform.data = { protein: data.protein, carbs: data.carbs, fat: data.fat };
        };
        const kcal = () => Number(data.kcal) || 0;
        // the ready-made splits (and one from your weight, when it is known) as chips
        const chips = dlg.querySelector("#tk-gpre");
        const options = [
          ...(weight ? [{ id: "weight", label: T("For you") }] : []),
          ...fl.MACRO_PRESETS.map((x) => ({ id: x.id, label: `${T(x.label)} ${x.split.protein}/${x.split.carbs}/${x.split.fat}` })),
        ];
        chips.innerHTML = options.map((o) => `<ha-assist-chip data-gpre="${o.id}" label="${esc(o.label)}"></ha-assist-chip>`).join("");
        const summary = () => {
          const box = dlg.querySelector("#tk-gsum");
          const e = fl.macroEnergy(data);
          if (!e.kcal) {
            box.innerHTML = `<div class="muted">${esc(T(kcal() ? "Pick a split above, or type the grams." : "Enter a kcal goal first, then pick a split."))}</div>`;
            return;
          }
          const row = (k, label) => `<div class="tk-grow"><span>${esc(T(label))}</span><b>${num(data[k])} g</b><span class="muted">${fl.macroEnergy(data).share[k]}% · ${num((Number(data[k]) || 0) * (k === "fat" ? 9 : 4))} kcal</span></div>`;
          const diff = kcal() ? e.kcal - kcal() : 0;
          const off = kcal() && Math.abs(diff) > kcal() * 0.05;
          box.innerHTML = `${row("protein", "Protein")}${row("carbs", "Carbs")}${row("fat", "Fat")}
            <div class="tk-grow tk-gtotal"><span>${esc(T("Together"))}</span><b>${num(e.kcal)} kcal</b><span class="muted">${kcal() ? `${esc(T("goal"))} ${num(kcal())}` : ""}</span></div>
            ${off ? `<ha-alert alert-type="info">${esc(`${T("The macros come to")} ${num(e.kcal)} kcal, ${num(Math.abs(diff))} ${T(diff > 0 ? "more than" : "less than")} ${T("your kcal goal.")}`)}<ha-button slot="action" size="s" appearance="plain" data-gfit="1">${esc(T("Fit the carbs"))}</ha-button></ha-alert>` : ""}`;
          const fit = box.querySelector("[data-gfit]");
          if (fit) fit.addEventListener("click", () => {
            data = { ...data, carbs: fl.carbsToFit(data) };
            sync();
            summary();
          });
        };
        chips.querySelectorAll("[data-gpre]").forEach((chip) =>
          chip.addEventListener("click", () => {
            if (!kcal()) return summary();
            const id = chip.dataset.gpre;
            const g = id === "weight" ? fl.suggestFromWeight(kcal(), weight) : fl.gramsFromSplit(kcal(), fl.MACRO_PRESETS.find((x) => x.id === id).split);
            data = { ...data, ...g };
            chips.querySelectorAll("[data-gpre]").forEach((c) => c.toggleAttribute("active", c === chip));
            sync();
            summary();
          })
        );
        for (const form of [kform, mform]) {
          form.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            data = { ...data, ...(e.detail.value || {}) };
            chips.querySelectorAll("[data-gpre]").forEach((c) => c.removeAttribute("active"));
            summary();
          });
        }
        sync();
        summary();
        dlg.querySelector("#tk-gok").addEventListener("click", async () => {
          close();
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_goals", person_id: p.id, goals: data });
          if (ok) await this._tkLoad();
        });
      }, { subtitle: p.name });
    },

    _tkWeightDialog() {
      const st = this._tkState();
      const p = st.data.person;
      const recent = Object.keys(p.weights || {}).sort().reverse().slice(0, 6);
      const html = `<div id="tk-body"><ha-form id="tk-wf"></ha-form>
          ${recent.length ? `<div class="fm-head">${esc(T("Earlier"))}</div><ha-list-base>${recent.map((d) => `<ha-list-item-button data-wd="${esc(d)}" headline="${esc(`${num(p.weights[d], 1)} kg`)}" supporting-text="${esc(dayLabel(d, st.data.today))}"><ha-icon slot="end" icon="mdi:delete-outline"></ha-icon></ha-list-item-button>`).join("")}</ha-list-base>` : ""}</div>`;
      this._planDialog(T("Log weight"), html, (dlg, close) => {
        this._planFooter(dlg, { primary: { id: "tk-wok", label: T("Save") }, secondary: [{ id: "tk-wcancel", label: T("Cancel") }] });
        dlg.querySelector("#tk-wcancel").addEventListener("click", close);
        const last = recent[0] ? p.weights[recent[0]] : (p.profile && p.profile.weight_kg) || null;
        let data = { kg: last, date: st.data.today };
        const form = dlg.querySelector("#tk-wf");
        form.hass = this._hass;
        form.schema = [
          { name: "kg", required: true, selector: { number: { min: 30, max: 400, step: 0.1, mode: "box", unit_of_measurement: "kg" } } },
          { name: "date", required: true, selector: { date: {} } },
        ];
        form.data = data;
        form.computeLabel = (sc) => T(sc.name === "kg" ? "Weight (kg)" : "Date");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          data = e.detail.value || data;
          form.data = data;
        });
        dlg.querySelector("#tk-wok").addEventListener("click", async () => {
          if (!data.kg) return;
          close();
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_weight", person_id: p.id, date: data.date, kg: Number(data.kg) });
          if (ok) await this._tkLoad();
        });
        dlg.querySelectorAll("[data-wd]").forEach((row) =>
          row.addEventListener("click", async () => {
            close();
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_weight_delete", person_id: p.id, date: row.dataset.wd });
            if (ok) await this._tkLoad();
          })
        );
      }, { subtitle: p.name });
    },

    /** The calorie calculator: your numbers, maintenance, and a daily target for each pace of weight loss. */
    _tkCalcDialog() {
      const st = this._tkState();
      const p = st.data.person;
      const latest = Object.keys(p.weights || {}).sort().pop();
      const prof = p.profile || {};
      let data = {
        sex: prof.sex || "female",
        age: prof.age ?? null,
        height_cm: prof.height_cm ?? null,
        weight_kg: latest ? p.weights[latest] : prof.weight_kg ?? null,
        target_kg: prof.target_kg ?? null,
        activity: prof.activity || "light",
      };
      let pace = prof.pace || 0.5;
      let result = null;
      const html = `<div id="tk-body"><ha-form id="tk-cf"></ha-form><div id="tk-cres" class="tk-cres"></div>
          <div class="muted tk-note">${esc(T("These are estimates (Mifflin-St Jeor). Real needs vary from person to person."))}</div></div>`;
      this._planDialog(T("Calorie calculator"), html, (dlg, close) => {
        const form = dlg.querySelector("#tk-cf");
        const out = dlg.querySelector("#tk-cres");
        const labels = { sex: "Sex", age: "Age", height_cm: "Height (cm)", weight_kg: "Weight (kg)", target_kg: "Target weight (kg)", activity: "Activity" };
        const box = (min, max, step) => ({ number: { min, max, step, mode: "box" } });
        form.hass = this._hass;
        form.schema = [
          { name: "sex", required: true, selector: { select: { mode: "box", options: [{ value: "female", label: T("Female") }, { value: "male", label: T("Male") }] } } },
          { type: "grid", name: "", schema: [
            { name: "age", required: true, selector: box(14, 110, 1) },
            { name: "height_cm", required: true, selector: box(100, 250, 1) },
            { name: "weight_kg", required: true, selector: box(30, 400, 0.1) },
            { name: "target_kg", selector: box(30, 400, 0.1) },
          ] },
          { name: "activity", required: true, selector: { select: { mode: "list", options: [
            { value: "sedentary", label: T("Mostly sitting") },
            { value: "light", label: T("Light: exercise 1–3 days a week") },
            { value: "moderate", label: T("Moderate: 3–5 days a week") },
            { value: "hard", label: T("Hard: 6–7 days a week") },
          ] } } },
        ];
        form.data = data;
        form.computeLabel = (sc) => T(labels[sc.name] || sc.name);
        const draw = () => {
          if (!result) {
            this._planFooter(dlg);
            out.innerHTML = `<p class="muted">${esc(T("Fill in your age, height and weight."))}</p>`;
            return;
          }
          const card = (title, big, sub) => `<ha-card class="tk-cc"><div class="card-content"><div class="muted">${esc(title)}</div><div class="tk-big">${big}</div><div class="muted">${esc(sub)}</div></div></ha-card>`;
          const chosen = result.options.find((o) => o.pace === pace) || result.options[1];
          const names = { 0.25: "gentle", 0.5: "steady", 0.75: "fast" };
          const paces = result.options
            .map((o) => `<ha-card class="tk-pace ${o.pace === chosen.pace ? "on" : ""}" data-pace="${o.pace}" tabindex="0"><div class="card-content"><b>${num(o.pace, 2)} kg ${esc(T("a week"))}</b><div class="muted">${num(o.kcal)} kcal · ${esc(T(names[o.pace] || ""))}</div></div></ha-card>`)
            .join("");
          const when = chosen.weeks != null ? `${esc(T("You reach"))} ${num(data.target_kg)} kg ${esc(T("in about"))} ${chosen.weeks} ${esc(T("weeks"))} (${esc(new Intl.DateTimeFormat(state.language || undefined, { day: "numeric", month: "short" }).format(parseDay(chosen.reached)))}).` : data.target_kg ? esc(T("The target weight is not below your weight.")) : esc(T("Add a target weight to see when you get there."));
          out.innerHTML = `<div class="tk-cgrid">${card(T("Resting (BMR)"), num(result.bmr), `kcal ${T("a day")}`)}${card(T("Maintenance"), num(result.maintenance), `kcal ${T("a day to keep")} ${num(data.weight_kg, 1)} kg`)}</div>
            <div class="muted">${esc(T("Pace"))}</div><div class="tk-cgrid tk-paces">${paces}</div>
            ${chosen.below_minimum ? `<ha-alert alert-type="warning">${esc(`${num(chosen.kcal)} kcal ${T("is below")} ${num(result.minimum)} kcal ${T("a day. That is not advised without a doctor.")}`)}</ha-alert>` : ""}
            <ha-card><div class="card-content"><div>${when}</div><div class="muted">${esc(T("Suggested split"))}: ${esc(T("Protein"))} ${chosen.macros.protein} g · ${esc(T("Carbs"))} ${chosen.macros.carbs} g · ${esc(T("Fat"))} ${chosen.macros.fat} g</div></div></ha-card>
            `;
          this._planFooter(dlg, {
            primary: { id: "tk-goalall", label: T("Set as goal"), icon: "target" },
            secondary: [{ id: "tk-goalkcal", label: T("Set kcal only") }, { id: "tk-saveprof", label: T("Save profile") }],
          });
          out.querySelectorAll("[data-pace]").forEach((c) => c.addEventListener("click", () => {
            pace = Number(c.dataset.pace);
            draw();
          }));
          const profile = () => ({ ...data, age: Number(data.age), height_cm: Number(data.height_cm), weight_kg: Number(data.weight_kg), target_kg: data.target_kg ? Number(data.target_kg) : null, pace });
          const save = async (goals) => {
            close();
            let r = await this._tkCall({ type: "hass_recipes/tracker_profile", person_id: p.id, profile: profile() });
            if (r.ok && goals) r = await this._tkCall({ type: "hass_recipes/tracker_goals", person_id: p.id, goals });
            if (r.ok) {
              await this._tkLoad();
              this._flash(T(goals ? "Goal set." : "Profile saved."));
            }
          };
          dlg.querySelector("#tk-goalall").addEventListener("click", () => save({ kcal: chosen.kcal, ...chosen.macros }));
          dlg.querySelector("#tk-goalkcal").addEventListener("click", () => save({ kcal: chosen.kcal }));
          dlg.querySelector("#tk-saveprof").addEventListener("click", () => save(null));
        };
        let timer = null;
        const calc = () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const need = ["age", "height_cm", "weight_kg"].every((k) => Number(data[k]) > 0);
            if (!need) {
              result = null;
              return draw();
            }
            try {
              result = await this._ws({ type: "hass_recipes/tracker_calc", profile: { ...data, age: Number(data.age), height_cm: Number(data.height_cm), weight_kg: Number(data.weight_kg), target_kg: data.target_kg ? Number(data.target_kg) : null } });
            } catch (err) {
              result = null;
              out.innerHTML = `<ha-alert alert-type="warning">${esc(err.message || String(err))}</ha-alert>`;
              return;
            }
            draw();
          }, 250);
        };
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          data = e.detail.value || data;
          form.data = data;
          calc();
        });
        draw();
        calc();
      }, { subtitle: p.name });
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
        const b = ctx.basis;
        if (!b) return null;
        const amount = Number(draft.amount) || 0;
        let per = b.total;
        let factor = 0;
        if (draft.by === "yield") factor = b.yield_amount ? amount / b.yield_amount : 0;
        else if (draft.by === "grams") factor = b.grams ? amount / b.grams : 0;
        else {
          per = b.per_serving || b.total;
          factor = amount;
        }
        const f = (k) => (per[k] == null ? null : per[k] * factor);
        return { kcal: f("kcal"), protein: f("protein"), carbs: f("carbs"), fat: f("fat") };
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
      let ways = [];
      if (draft.kind === "recipe") {
        try {
          ctx.basis = await this._ws({ type: "hass_recipes/tracker_recipe", recipe_id: draft.recipe_id });
        } catch (err) {
          ctx.basis = null;
        }
        const b = ctx.basis;
        // a recipe can be measured in servings, by what it makes (2 boller) or by weight
        ways = [{ value: "servings", label: b && b.servings ? T("servings") : T("of the whole recipe") }];
        if (b && b.yield_amount) ways.push({ value: "yield", label: b.yield_unit || T("pieces") });
        if (b && b.grams) ways.push({ value: "grams", label: T("g (weight)") });
        // the amount to start from for each way of measuring
        ctx.start = (by) => (by === "grams" ? Math.max(1, Math.round(b.grams / (b.servings || 4))) : 1);
        if (!ways.some((w) => w.value === draft.by)) {
          draft.by = "servings";
          draft.amount = 1;
        }
        if (draft.amount == null) draft.amount = ctx.start(draft.by);
      }
      if (draft.kind !== "quick") {
        const units = draft.kind === "food" ? ["g", ...Object.keys((ctx.food && ctx.food.unit_grams) || {})] : [];
        return this._tkStepper(dlg, body, draft, ctx, draft.kind === "recipe" ? ways : units.map((u) => ({ value: u, label: u })), { onSave, onDelete, onStar, starred, onBack, saveLabel });
      }
      const num0 = (min, step) => ({ number: { min, max: 100000, step, mode: "box" } });
      const schema = [];
      if (draft.kind === "recipe") {
        schema.push({ name: "amount", required: true, selector: num0(0, 0.25) });
        schema.push({ name: "by", required: true, selector: { select: { mode: "dropdown", options: ways } } });
      }
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
      const labels = { by: "Measured in", amount: "Amount", unit: "Unit", name: "Name", kcal: "Energy (kcal)", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)", meal: "Meal" };
      body.innerHTML = `<div class="tk-fhead"><b>${esc(draft.name || "")}</b></div>
        <ha-form id="tk-f"></ha-form>
        <div class="tk-preview muted" id="tk-pv"></div>`;
      this._tkFooter(dlg, { onSave, onDelete, onStar, starred, onBack, saveLabel });
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
        const before = draft.by;
        Object.assign(draft, e.detail.value || {});
        // measuring in something else starts from a sensible amount (a serving, a piece, an average portion in grams)
        if (draft.kind === "recipe" && draft.by !== before && ctx.start) draft.amount = ctx.start(draft.by);
        form.data = { ...draft }; // a new object, so the form shows the amount that was set for the new unit
        preview();
      });
      preview();
      this._tkFooterBind(dlg, draft, { onSave, onDelete, onStar, onBack });
    },

    /** Save (the main button), and Back, Favourite and Delete beside it, in the dialog's footer. */
    _tkFooter(dlg, { onSave, onDelete, onStar, starred, onBack, saveLabel }) {
      this._planFooter(dlg, {
        primary: { id: "tk-save", label: saveLabel, icon: "check" },
        secondary: [
          ...(onDelete ? [{ id: "tk-del", label: T("Delete"), icon: "delete-outline", variant: "danger" }] : []),
          ...(onStar ? [{ id: "tk-star", label: T("Favourite"), icon: starred ? "star" : "star-outline" }] : []),
          ...(onBack ? [{ id: "tk-back", label: T("Back"), icon: "arrow-left" }] : []),
        ],
      });
    },

    _tkFooterBind(dlg, draft, { onSave, onDelete, onStar, onBack }) {
      dlg.querySelector("#tk-save").addEventListener("click", () => onSave(draft));
      if (onBack) dlg.querySelector("#tk-back").addEventListener("click", onBack);
      if (onStar) dlg.querySelector("#tk-star").addEventListener("click", onStar);
      if (onDelete) dlg.querySelector("#tk-del").addEventListener("click", onDelete);
    },

    /** Recipes and foods: the amount with big steppers, the unit and the meal as chips, what it comes to underneath. */
    _tkStepper(dlg, body, draft, ctx, ways, { onSave, onDelete, onStar, starred, onBack, saveLabel }) {
      const isRecipe = draft.kind === "recipe";
      const key = isRecipe ? "by" : "unit";
      if (!isRecipe && !draft.unit) draft.unit = "g";
      const step = () => {
        const w = draft[key];
        if (isRecipe) return w === "grams" ? 10 : w === "yield" ? 1 : 0.5;
        return w === "g" ? 10 : 0.5;
      };
      const chips = (list, current, attr) => list.map((x) => `<ha-assist-chip ${attr}="${esc(x.value)}" label="${esc(x.label)}" ${x.value === current ? "active" : ""}></ha-assist-chip>`).join("");
      const meals = this._planMeals();
      body.innerHTML = `<div class="tk-fhead"><b>${esc(draft.name || "")}</b></div>
        ${ways.length > 1 ? `<div class="tk-chips" id="tk-ways">${chips(ways, draft[key], "data-way")}</div>` : ""}
        <div class="tk-stepper">
          <ha-icon-button id="tk-minus" label="${esc(T("Less"))}"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>
          <ha-input id="tk-amt" type="number" appearance="outlined" inputmode="decimal" min="0"></ha-input>
          <ha-icon-button id="tk-plus" label="${esc(T("More"))}"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
        </div>
        <div class="tk-preview" id="tk-pv"></div>
        <div class="tk-sub">${esc(T("Meal"))}</div>
        <div class="tk-chips" id="tk-meals">${chips(meals.map((m) => ({ value: m.id, label: this._planLabel(m.id) })), draft.meal, "data-meal")}</div>`;
      this._tkFooter(dlg, { onSave, onDelete, onStar, starred, onBack, saveLabel });
      const input = body.querySelector("#tk-amt");
      const preview = () => {
        const c = this._tkCalc(draft, ctx);
        body.querySelector("#tk-pv").textContent = c && c.kcal != null ? `${num(c.kcal)} kcal${MACROS.map(([k, l]) => (c[k] != null ? ` · ${num(c[k])} g ${T(l).toLowerCase()}` : "")).join("")}` : isRecipe ? T("This recipe has no nutrition yet: link its ingredients to foods first.") : "";
      };
      const show = () => {
        input.value = String(Math.round((Number(draft.amount) || 0) * 100) / 100);
        preview();
      };
      const nudge = (dir) => {
        draft.amount = Math.max(0, Math.round(((Number(draft.amount) || 0) + dir * step()) * 100) / 100);
        show();
      };
      body.querySelector("#tk-minus").addEventListener("click", () => nudge(-1));
      body.querySelector("#tk-plus").addEventListener("click", () => nudge(1));
      input.addEventListener("input", () => {
        draft.amount = parseFloat(String(input.value).replace(",", ".")) || 0;
        preview();
      });
      body.querySelectorAll("[data-way]").forEach((chip) =>
        chip.addEventListener("click", () => {
          const before = draft[key];
          draft[key] = chip.dataset.way;
          // another unit starts from a sensible amount (a serving, a piece, an average portion, 100 g)
          if (draft[key] !== before) draft.amount = isRecipe ? ctx.start(draft.by) : draft.unit === "g" ? 100 : 1;
          body.querySelectorAll("[data-way]").forEach((c) => c.toggleAttribute("active", c === chip));
          show();
        })
      );
      body.querySelectorAll("[data-meal]").forEach((chip) =>
        chip.addEventListener("click", () => {
          draft.meal = chip.dataset.meal;
          body.querySelectorAll("[data-meal]").forEach((c) => c.toggleAttribute("active", c === chip));
        })
      );
      show();
      this._tkFooterBind(dlg, draft, { onSave, onDelete, onStar, onBack });
    },

    /** The ws message that logs `draft` on a day in a meal. */
    _tkPayload(draft) {
      const base = { kind: draft.kind, meal: draft.meal };
      if (draft.kind === "recipe") return { ...base, recipe_id: draft.recipe_id, by: draft.by || "servings", amount: Number(draft.amount) };
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
          if (draft.kind === "recipe") {
            // an older item has servings; a newer one says how it was measured
            if (draft.by == null) {
              draft.by = "servings";
              draft.amount = draft.amount ?? draft.servings ?? 1;
            }
            delete draft.servings;
          }
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
        const how = (t) => (t.kind === "quick" ? `${num(t.kcal)} kcal` : howText(t));
        const pick = () => {
          this._planFooter(dlg);
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
            if (recipes.length) out += head("Recipes") + recipes.map((r) => row({ kind: "recipe", recipe_id: r.id, name: r.name }, r.servings ? `${r.servings} ${T("servings")}` : r.yield_amount ? `${r.yield_amount} ${r.yield_unit || ""}`.trim() : "")).join("");
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
      }, { subtitle: `${dayLabel(d.date, d.today)} · ${d.person.name}` });
    },

    /** Change or delete what was logged. */
    _tkEntryDialog(entry) {
      const st = this._tkState();
      const d = st.data;
      const starred = (d.favourites || []).some((f) => ["kind", "recipe_id", "food_id", "by", "amount", "unit", "name"].every((k) => f[k] === entry[k]));
      this._planDialog(entry.name, `<div id="tk-body"></div>`, (dlg, close) => {
        const draft = { ...entry };
        this._tkForm(dlg, draft, {
          saveLabel: T("Save"),
          starred,
          onSave: async (x) => {
            close();
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_update", entry_id: entry.id, ...fl.entryUpdate(x) });
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
      }, { subtitle: `${this._planLabel(entry.meal)} · ${dayLabel(d.date, d.today)}` });
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
      on("[data-tkusual]", "click", (e) => this._tkAct("usual", e.currentTarget));
      on("[data-tkentry]", "click", (e) => this._tkAct("entry", e.currentTarget));
    },
  };
}
