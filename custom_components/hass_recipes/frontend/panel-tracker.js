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
    return e.estimated ? T("Estimated") : T("Quick entry");
  };
  /** What one usual portion of a food is: a slice, a piece, else 100 g ({ unit, amount, grams, kcal }). */
  const usualOf = (f) => {
    const ug = f.unit_grams || {};
    const unit = Object.keys(ug).find((u) => !u.includes("(")) || Object.keys(ug)[0];
    const grams = unit ? ug[unit] : 100;
    const kcal = f.values && f.values.kcal != null ? (f.values.kcal * grams) / 100 : null;
    return { unit: unit || "g", amount: unit ? 1 : 100, grams, kcal };
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
        return MACRO_STYLES.some((x) => x[0] === v) ? v : "bars";
      } catch (_) {
        return "bars";
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
      // the ring is what is left of the goal, the macros are bars beside it
      return `<ha-card class="tk-summary"><div class="card-content">
          <div class="tk-ringrow">
            <div class="tk-ring">
              <ha-control-circular-slider id="tk-ring" class="${left < 0 ? "over" : ""}"></ha-control-circular-slider>
              <div class="tk-ringtext"><div class="tk-huge ${left < 0 ? "tk-over" : ""}">${num(Math.abs(left))}</div><div class="muted">${esc(T(left >= 0 ? "kcal left" : "kcal over"))}</div></div>
            </div>
            <div class="tk-ringside tk-side-${style}">
              <div><b>${num(totals.kcal)}</b> <span class="muted">${esc(T("eaten"))}</span></div>
              <div class="muted">${esc(T("goal"))} ${num(goal)}</div>
              ${style === "off" ? "" : this._tkMacrosHtml(totals, goals, style)}
            </div>
          </div>
          ${deficit}
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
          // a meal with nothing in it says what it could be: a share of the goal
          const share = { breakfast: 0.25, lunch: 0.3, dinner: 0.3, snack: 0.15 }[m.id];
          const goal = p.goals.kcal;
          const hint = rows.length ? `${num(kcal)} kcal` : goal && share ? `${T("Suggested")} ${num(Math.round((goal * share) / 10) * 10)}` : "";
          return `<ha-card class="tk-meal"><div class="card-content tk-mhead"><b>${esc(this._planLabel(m.id))}</b><span class="muted">${esc(hint)}</span>${edit ? `<ha-icon-button data-tkadd="${esc(m.id)}" label="${esc(T("Add food"))}"><ha-icon icon="mdi:plus-circle-outline"></ha-icon></ha-icon-button>` : ""}</div>
              ${list ? `<ha-list-base>${list}</ha-list-base>` : ""}
              ${
                edit && ((d.usual || {})[m.id] || []).length
                  ? `<div class="card-actions tk-quick">${((d.usual || {})[m.id] || [])
                      .map((t, i) => `<ha-assist-chip data-tkusual="${esc(m.id)}:${i}" label="+ ${esc(t.name)}"><ha-icon slot="icon" icon="mdi:${t.kind === "recipe" ? "chef-hat" : t.kind === "food" ? "food-apple-outline" : "pencil-outline"}"></ha-icon></ha-assist-chip>`)
                      .join("")}</div>`
                  : ""
              }
            </ha-card>`;
        })
        .join("");
      return `${this._tkPinHtml(d)}${this._tkWeekHtml(d)}${this._tkSummaryHtml(d.totals, p.goals, edit, d)}${planned}${cards}${this._tkWaterHtml(d)}`;
    },

    /** Water: a bar towards the goal, and glasses to add (or take away) with one tap. */
    _tkWaterHtml(d) {
      const w = d.water;
      if (!w) return "";
      const edit = d.person.editable;
      return `<ha-card class="tk-water"><div class="card-content">
          <div class="tk-whead"><ha-icon icon="mdi:cup-water"></ha-icon><b>${esc(T("Water"))}</b><span class="muted">${num(w.ml)} / ${num(w.goal)} ml</span>
            ${edit ? `<ha-icon-button data-tkact="water-goal" label="${esc(T("Water goal"))}"><ha-icon icon="mdi:cog-outline"></ha-icon></ha-icon-button>` : ""}</div>
          <ha-control-slider id="tk-s-water" class="tk-kbar ${w.ml >= w.goal ? "done" : ""}"></ha-control-slider>
          ${edit ? `<div class="tk-wbtns"><ha-button size="s" appearance="tonal" data-tkwater="250"><ha-icon slot="start" icon="mdi:cup-water"></ha-icon>+250 ml</ha-button>
            <ha-button size="s" appearance="tonal" data-tkwater="500"><ha-icon slot="start" icon="mdi:water"></ha-icon>+500 ml</ha-button>
            ${w.ml ? `<ha-button size="s" appearance="plain" data-tkwater="-250"><ha-icon slot="start" icon="mdi:undo"></ha-icon>${esc(T("Undo"))}</ha-button>` : ""}</div>` : ""}
        </div></ha-card>`;
    },

    /** The days in a row with something logged. */
    _tkStreakHtml(d) {
      const s = d.streak;
      if (!s || s.current < 1) return "";
      const label = `${s.current} ${T(s.current === 1 ? "day" : "days")} ${T("in a row")}${s.best > s.current ? ` · ${T("best")} ${s.best}` : ""}`;
      return `<div class="tk-streak"><ha-assist-chip label="${esc(label)}"><ha-icon slot="icon" icon="mdi:fire"></ha-icon></ha-assist-chip></div>`;
    },

    /** The seven days of the week on screen, to jump between them. */
    _tkWeekHtml(d) {
      const monday = mondayOf(parseDay(d.date));
      const fmt = new Intl.DateTimeFormat(state.language || undefined, { weekday: "narrow" });
      return `${this._tkStreakHtml(d)}<div class="tk-week">${Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        const iso = isoDate(day);
        return `<div class="tk-wd"><span class="muted">${esc(fmt.format(day))}</span><ha-button size="s" data-tkday="${iso}" appearance="${iso === d.date ? "filled" : "plain"}" variant="${iso === d.today || iso === d.date ? "brand" : "neutral"}">${day.getDate()}</ha-button></div>`;
      }).join("")}</div>`;
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
        const wbar = root.getElementById("tk-s-water");
        if (wbar) {
          await this._tkElement("ha-control-slider", { type: "tile", entity: "light.x", features: [{ type: "light-brightness" }] });
          const w = st.data.water;
          wbar.min = 0;
          wbar.max = Math.max(w.goal, w.ml, 1);
          wbar.value = w.ml;
          wbar.step = 1;
          wbar.mode = "start";
          wbar.showHandle = false;
          wbar.setAttribute("aria-readonly", "true");
          wbar.setAttribute("aria-label", `${T("Water")} ${num(w.ml)} ml`);
        }
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
        const ring = root.getElementById("tk-ring");
        if (ring) {
          await this._tkElement("ha-control-circular-slider", { type: "thermostat", entity: "climate.x" });
          ring.min = 0;
          ring.max = Math.max(goals.kcal, totals.kcal, 1);
          ring.value = Math.min(totals.kcal, ring.max);
          ring.step = 1;
          ring.mode = "start";
          ring.readonly = true;
          ring.setAttribute("aria-label", `kcal ${num(totals.kcal)}`);
        }
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
        case "water-goal":
          return this._tkWaterGoalDialog();
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

    _tkWaterGoalDialog() {
      const p = this._tkState().data.person;
      const goal = this._tkState().data.water.goal;
      this._planDialog(T("Water goal"), `<div id="tk-body"><ha-form id="tk-wg"></ha-form></div>`, (dlg, close) => {
        this._planFooter(dlg, { primary: { id: "tk-wgok", label: T("Save") }, secondary: [{ id: "tk-wgcancel", label: T("Cancel") }] });
        dlg.querySelector("#tk-wgcancel").addEventListener("click", close);
        let data = { ml: goal };
        const form = dlg.querySelector("#tk-wg");
        form.hass = this._hass;
        form.schema = [{ name: "ml", required: true, selector: { number: { min: 250, max: 10000, step: 50, mode: "box", unit_of_measurement: "ml" } } }];
        form.data = data;
        form.computeLabel = () => T("A day's water (ml)");
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          data = e.detail.value || data;
          form.data = data;
        });
        dlg.querySelector("#tk-wgok").addEventListener("click", async () => {
          if (!data.ml) return;
          close();
          const { ok } = await this._tkCall({ type: "hass_recipes/tracker_water_goal", person_id: p.id, ml: Number(data.ml) });
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
        const units = draft.kind === "food" ? ["g", ...new Set(Object.keys((ctx.food && ctx.food.unit_grams) || {}).map((u) => u.replace(/\s*\([^)]*\)\s*$/, "")))] : [];
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
      // a unit can come in sizes: "skive", "skive (tynd)", "skive (tyk)"; the chips name the unit, a second row the size
      const food = isRecipe ? null : ctx.food;
      const ug = (food && food.unit_grams) || {};
      const baseOf = (u) => String(u || "").replace(/\s*\([^)]*\)\s*$/, "");
      const sizesOf = (u) => Object.keys(ug).filter((k) => baseOf(k) === baseOf(u)).sort((a, b) => ug[a] - ug[b]);
      const sizeName = (k) => {
        const m = k.match(/\(([^)]*)\)\s*$/);
        return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : T("Normal");
      };
      const chips = (list, current, attr) => list.map((x) => `<ha-assist-chip ${attr}="${esc(x.value)}" label="${esc(x.label)}" ${x.value === current ? "active" : ""}></ha-assist-chip>`).join("");
      const meals = this._planMeals();
      body.innerHTML = `<div class="tk-fhead"><b>${esc(draft.name || "")}</b></div>
        ${ways.length > 1 ? `<div class="tk-chips" id="tk-ways">${chips(ways, isRecipe ? draft[key] : baseOf(draft[key]), "data-way")}</div>` : ""}
        <div class="tk-chips" id="tk-sizes"></div>
        <div class="tk-stepper">
          <ha-icon-button id="tk-minus" label="${esc(T("Less"))}"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>
          <ha-input id="tk-amt" type="number" appearance="outlined" inputmode="decimal" min="0"></ha-input>
          <ha-icon-button id="tk-plus" label="${esc(T("More"))}"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
        </div>
        <div class="tk-preview" id="tk-pv"></div>
        <div class="muted tk-weight" id="tk-wt"></div>
        <div class="tk-sub">${esc(T("Meal"))}</div>
        <div class="tk-chips" id="tk-meals">${chips(meals.map((m) => ({ value: m.id, label: this._planLabel(m.id) })), draft.meal, "data-meal")}</div>`;
      this._tkFooter(dlg, { onSave, onDelete, onStar, starred, onBack, saveLabel });
      const input = body.querySelector("#tk-amt");
      const preview = () => {
        const c = this._tkCalc(draft, ctx);
        // the main button says what it adds
        const save = dlg.querySelector("#tk-save");
        const label = save && [...save.childNodes].filter((n) => n.nodeType === 3).pop();
        if (label) label.textContent = c && c.kcal != null ? `${saveLabel} · ${num(c.kcal)} kcal` : saveLabel;
        body.querySelector("#tk-pv").textContent = c && c.kcal != null ? `${num(c.kcal)} kcal${MACROS.map(([k, l]) => (c[k] != null ? ` · ${num(c[k])} g ${T(l).toLowerCase()}` : "")).join("")}` : isRecipe ? T("This recipe has no nutrition yet: link its ingredients to foods first.") : "";
      };
      // the size chips of the chosen unit, and what one of it is assumed to weigh
      const paintSizes = () => {
        const box = body.querySelector("#tk-sizes");
        const sizes = isRecipe || draft.unit === "g" ? [] : sizesOf(draft.unit);
        box.innerHTML = sizes.length > 1 ? chips(sizes.map((k) => ({ value: k, label: `${sizeName(k)} · ${num(ug[k])} g` })), draft.unit, "data-size") : "";
        box.querySelectorAll("[data-size]").forEach((chip) =>
          chip.addEventListener("click", () => {
            draft.unit = chip.dataset.size;
            paintSizes();
            show();
          })
        );
        const per = ug[draft.unit];
        const amount = Number(draft.amount) || 0;
        body.querySelector("#tk-wt").textContent =
          isRecipe || draft.unit === "g" || !per
            ? ""
            : `${T("Assumed weight")}: 1 ${draft.unit} = ${num(per)} g${amount && amount !== 1 ? ` · ${num(amount)} = ${num(amount * per)} g` : ""}. ${T("Change it on the Foods page.")}`;
      };
      const show = () => {
        input.value = String(Math.round((Number(draft.amount) || 0) * 100) / 100);
        preview();
        paintSizes();
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
        paintSizes();
      });
      body.querySelectorAll("[data-way]").forEach((chip) =>
        chip.addEventListener("click", () => {
          const before = draft[key];
          // a unit with sizes starts at its normal size (or the smallest, when there is no plain one)
          draft[key] = isRecipe || chip.dataset.way === "g" ? chip.dataset.way : ug[chip.dataset.way] != null ? chip.dataset.way : sizesOf(chip.dataset.way)[0] || chip.dataset.way;
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
        const label = (item) => (item.kind === "recipe" ? "mdi:chef-hat" : item.kind === "food" ? "mdi:food-apple-outline" : item.kind === "dbfood" ? "mdi:database-search-outline" : "mdi:pencil-outline");
        const how = (t) => (t.kind === "quick" ? `${num(t.kcal)} kcal` : howText(t));
        // scan a barcode with the camera (where the browser can), or type the number: the product comes from Open Food Facts
        const canCamera = this._barcodeCamera();
        const scan = (manual = false) => (canCamera && !manual ? scanner() : manualScan());

        // a food of your own for a barcode Open Food Facts does not know (or that you would rather enter yourself)
        const createFood = (barcode = "", name = "") => {
          const back = { id: "tk-cback", label: T("Back"), icon: "arrow-left" };
          this._planFooter(dlg, { primary: { id: "tk-cok", label: T("Save"), icon: "content-save-outline" }, secondary: [back] });
          body.innerHTML = `<ha-form id="tk-cform"></ha-form><div class="muted tk-scanmsg">${esc(T("Values per 100 g, as on the package."))}</div><div class="muted tk-scanmsg" id="tk-cmsg"></div>`;
          const num = (n, label) => ({ name: n, selector: { number: { min: 0, max: 1000, step: 0.1, mode: "box", unit_of_measurement: n === "kcal" ? "kcal" : "g" } }, label });
          const labels = { name: T("Name"), barcode: T("Barcode number"), kcal: T("Energy"), protein: T("Protein"), fat: T("Fat"), carbs: T("Carbohydrates") };
          let data = { name, barcode, kcal: undefined, protein: undefined, fat: undefined, carbs: undefined };
          const form = body.querySelector("#tk-cform");
          form.hass = this._hass;
          form.schema = [{ name: "name", required: true, selector: { text: {} } }, { name: "barcode", selector: { text: {} } }, num("kcal"), num("protein"), num("fat"), num("carbs")];
          form.data = data;
          form.computeLabel = (sc) => labels[sc.name] || sc.name;
          form.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            data = e.detail.value || data;
          });
          dlg.querySelector("#tk-cback").addEventListener("click", () => manualScan(data.barcode || ""));
          dlg.querySelector("#tk-cok").addEventListener("click", async () => {
            const msg = body.querySelector("#tk-cmsg");
            if (!String(data.name || "").trim()) return void (msg.textContent = T("Give the food a name."));
            if (data.kcal == null || data.kcal === "") return void (msg.textContent = T("Give the energy (kcal per 100 g)."));
            const values = Object.fromEntries(["kcal", "protein", "fat", "carbs"].filter((k) => data[k] != null && data[k] !== "").map((k) => [k, Number(data[k])]));
            const { ok, res: made } = await this._tkCall({ type: "hass_recipes/foods_save", name: String(data.name).trim(), source: "custom", values, barcode: String(data.barcode || "") });
            if (!ok || !made) return;
            foods.push(made);
            startWith({ kind: "food", food_id: made.id, name: made.name });
          });
        };

        const manualScan = (typed = "") => {
          this._planFooter(dlg, { secondary: [{ id: "tk-sback", label: T("Back"), icon: "arrow-left" }] });
          body.innerHTML = `${canCamera ? `` : `<ha-alert alert-type="info">${esc(T("This browser cannot scan with the camera. Type the number under the barcode."))}</ha-alert>`}
            <ha-form id="tk-code"></ha-form>
            <div class="tk-lookup tk-lookbtns"><ha-button id="tk-lookup" appearance="filled"><ha-icon slot="start" icon="mdi:magnify"></ha-icon>${esc(T("Look up"))}</ha-button>
              ${canCamera ? `<ha-button id="tk-cam" appearance="plain"><ha-icon slot="start" icon="mdi:barcode-scan"></ha-icon>${esc(T("Scan with the camera"))}</ha-button>` : ""}
              <ha-button id="tk-new" appearance="plain"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Create a new food"))}</ha-button></div>
            <div class="muted tk-scanmsg" id="tk-scanmsg"></div>
            <div class="muted tk-scanmsg">${esc(T("Products come from Open Food Facts (ODbL)."))}</div>`;
          const msg = body.querySelector("#tk-scanmsg");
          let code = { code: typed };
          const form = body.querySelector("#tk-code");
          form.hass = this._hass;
          form.schema = [{ name: "code", selector: { text: {} } }];
          form.data = code;
          form.computeLabel = () => T("Barcode number");
          form.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            code = e.detail.value || code;
          });
          body.querySelector("#tk-lookup").addEventListener("click", () => lookup(code.code || "", msg));
          body.querySelector("#tk-new").addEventListener("click", () => createFood(String(code.code || "")));
          const cam = body.querySelector("#tk-cam");
          if (cam) cam.addEventListener("click", () => scanner());
          dlg.querySelector("#tk-sback").addEventListener("click", pick);
        };

        const lookup = async (raw, msg) => {
          msg.textContent = T("Looking up…");
          try {
            const food = await this._ws({ type: "hass_recipes/barcode", code: String(raw) });
            if (!foods.some((f) => f.id === food.id)) foods.push(food);
            startWith({ kind: "food", food_id: food.id, name: food.name });
          } catch (err) {
            msg.textContent = (err && err.message) || String(err);
            const row = document.createElement("div");
            row.className = "tk-lookup";
            row.innerHTML = `<ha-button appearance="filled"><ha-icon slot="start" icon="mdi:plus"></ha-icon>${esc(T("Create a food with this barcode"))}</ha-button>`;
            row.querySelector("ha-button").addEventListener("click", () => createFood(String(raw)));
            msg.after(row);
          }
        };

        const scanner = () =>
          this._barcodeScanner({
            code: (raw) => {
              manualScan(raw);
              lookup(raw, body.querySelector("#tk-scanmsg"));
            },
            close: pick,
            type: () => manualScan(),
            fail: () => {
              manualScan();
              body.querySelector("#tk-scanmsg").textContent = T("The camera could not be opened. Type the number instead.");
            },
          });

        // a dish without a recipe: the AI guesses what is in it, the numbers come from the food tables, and you can correct the weights
        const estimate = (prefill = "") => {
          const SCALES = { small: 0.75, normal: 1, large: 1.35 };
          const back = { id: "tk-eback", label: T("Back"), icon: "arrow-left" };
          this._planFooter(dlg, { secondary: [back] });
          dlg.querySelector("#tk-eback").addEventListener("click", pick);
          let desc = { text: prefill };
          let rows = [];
          let result = null;
          let dishName = "";
          let scale = "normal";
          body.innerHTML = `<ha-form id="tk-ed"></ha-form>
            <div class="tk-lookup"><ha-button id="tk-eg" appearance="filled"><ha-icon slot="start" icon="mdi:creation"></ha-icon>${esc(T("Estimate"))}</ha-button></div>
            <div class="muted tk-scanmsg" id="tk-emsg">${esc(T("Describe the dish and how much you had, for example: spaghetti bolognese, a large plate."))}</div>
            <div id="tk-eres"></div>`;
          const form = body.querySelector("#tk-ed");
          form.hass = this._hass;
          form.schema = [{ name: "text", selector: { text: {} } }];
          form.data = desc;
          form.computeLabel = () => T("Dish");
          form.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            desc = e.detail.value || desc;
          });
          const msg = body.querySelector("#tk-emsg");
          const res = body.querySelector("#tk-eres");
          const lines = () => rows.map((r) => `${r.grams} g ${r.food}`);
          const paintTotals = () => {
            const t = result.total;
            const box = res.querySelector("#tk-etotal");
            const range = result.low != null ? ` (${num(result.low)}–${num(result.high)})` : "";
            box.textContent = t.kcal != null ? `≈ ${num(t.kcal)} kcal${range}${MACROS.map(([k, l]) => (t[k] != null ? ` · ${num(t[k])} g ${T(l).toLowerCase()}` : "")).join("")}` : "";
            result.items.forEach((it, i) => {
              const k = res.querySelector(`[data-ekcal="${i}"]`);
              if (k) k.textContent = it.matched ? `${num(it.kcal)} kcal` : T("not found: counted as 0");
            });
            const save = dlg.querySelector("#tk-eadd");
            const label = save && [...save.childNodes].filter((n) => n.nodeType === 3).pop();
            if (label) label.textContent = t.kcal != null ? `${T("Add")} · ${num(t.kcal)} kcal` : T("Add");
          };
          let timer = null;
          const recalc = () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
              try {
                const picks = Object.fromEntries(rows.map((r, i) => [String(i), r.pick]).filter(([, p]) => p));
                result = await this._ws({ type: "hass_recipes/dish_calc", lines: lines(), picks });
                paintTotals();
              } catch (err) {
                msg.textContent = (err && err.message) || String(err);
              }
            }, 300);
          };
          // tap a line to choose the food it is: the search shows the foods of the tables and your own
          const pickFood = (i) => {
            res.innerHTML = `<div class="tk-sub" style="margin-top:16px"><b>${esc(rows[i].food)}</b></div>
              <ha-input-search id="tk-epq" appearance="outlined" placeholder="${esc(T("Search foods"))}"></ha-input-search>
              <div id="tk-epr"></div>
              <ha-button id="tk-epback" appearance="plain"><ha-icon slot="start" icon="mdi:arrow-left"></ha-icon>${esc(T("Back"))}</ha-button>`;
            const list = res.querySelector("#tk-epr");
            const search = async (q) => {
              if (q.trim().length < 2) {
                list.innerHTML = "";
                return;
              }
              let hits = [];
              try {
                hits = await this._ws({ type: "hass_recipes/nutrition_search", query: q.trim(), limit: 12 });
              } catch (err) {
                hits = [];
              }
              list.innerHTML = `<ha-list-base>${hits.map((h, n) => `<ha-list-item-button data-ephit="${n}" headline="${esc(h.name)}" supporting-text="${esc(h.kcal != null ? `${num(h.kcal)} kcal / 100 g` : "")}"><ha-icon slot="start" icon="mdi:food-apple-outline"></ha-icon></ha-list-item-button>`).join("")}</ha-list-base>`;
              list.querySelectorAll("[data-ephit]").forEach((el) =>
                el.addEventListener("click", () => {
                  const hit = hits[+el.dataset.ephit];
                  rows[i].food = hit.name;
                  rows[i].pick = { source: hit.source, id: hit.id };
                  paintRows();
                  recalc();
                })
              );
            };
            const input = res.querySelector("#tk-epq");
            let t = null;
            input.addEventListener("input", () => {
              clearTimeout(t);
              t = setTimeout(() => search(input.value || ""), 200);
            });
            res.querySelector("#tk-epback").addEventListener("click", paintRows);
            input.value = rows[i].food;
            search(rows[i].food);
          };
          const paintRows = () => {
            res.innerHTML = `<div class="tk-sub" style="margin-top:16px"><b>${esc(dishName)}</b></div>
              <div class="tk-chips" id="tk-escale">${Object.keys(SCALES).map((k) => `<ha-assist-chip data-escale="${k}" label="${esc(T(k.charAt(0).toUpperCase() + k.slice(1)))}" ${k === scale ? "active" : ""}></ha-assist-chip>`).join("")}</div>
              ${rows.map((r, i) => `<div class="tk-erow"><ha-input data-eg="${i}" type="number" inputmode="decimal" min="0" value="${r.grams}"><span slot="end">g</span></ha-input>
                  <div class="tk-ename" data-epick="${i}" role="button" tabindex="0" style="cursor:pointer"><div>${esc(r.food)}</div><div class="muted" data-ekcal="${i}"></div></div>
                  <ha-icon-button data-edel="${i}" label="${esc(T("Remove"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button></div>`).join("")}
              <div class="tk-preview" id="tk-etotal"></div>
              <div class="muted tk-scanmsg">${esc(T("An estimate: the AI guesses what is in the dish, so check the weights. It is logged as estimated."))}</div>`;
            res.querySelectorAll("[data-eg]").forEach((inp) =>
              inp.addEventListener("input", () => {
                rows[+inp.dataset.eg].grams = Math.max(0, parseFloat(String(inp.value).replace(",", ".")) || 0);
                recalc();
              })
            );
            res.querySelectorAll("[data-epick]").forEach((el) => el.addEventListener("click", () => pickFood(+el.dataset.epick)));
            res.querySelectorAll("[data-edel]").forEach((b) =>
              b.addEventListener("click", () => {
                rows.splice(+b.dataset.edel, 1);
                paintRows();
                recalc();
              })
            );
            res.querySelectorAll("[data-escale]").forEach((c) =>
              c.addEventListener("click", () => {
                const factor = SCALES[c.dataset.escale] / SCALES[scale];
                scale = c.dataset.escale;
                rows.forEach((r) => (r.grams = Math.round(r.grams * factor)));
                paintRows();
                recalc();
              })
            );
            paintTotals();
          };
          const showResult = (r) => {
            result = r;
            rows = r.items.filter((i) => i.grams != null).map((i) => ({ food: i.food, grams: Math.round(i.grams) }));
            scale = "normal";
            this._planFooter(dlg, { primary: { id: "tk-eadd", label: T("Add"), icon: "check" }, secondary: [back] });
            dlg.querySelector("#tk-eback").addEventListener("click", pick);
            dlg.querySelector("#tk-eadd").addEventListener("click", async () => {
              const t = result.total;
              if (t.kcal == null) return;
              close();
              const fields = Object.fromEntries(["kcal", "protein", "carbs", "fat"].filter((k) => t[k] != null).map((k) => [k, Math.round(t[k] * 10) / 10]));
              const { ok } = await this._tkCall({ type: "hass_recipes/tracker_add", person_id: d.person.id, date: d.date, meal, kind: "quick", name: dishName || desc.text, estimated: true, ...fields });
              if (ok) await this._tkLoad();
            });
            paintRows();
          };
          body.querySelector("#tk-eg").addEventListener("click", async () => {
            const text = (desc.text || "").trim();
            if (text.length < 2) {
              msg.textContent = T("Describe the dish first.");
              return;
            }
            msg.textContent = T("Asking the AI…");
            res.innerHTML = "";
            try {
              const r = await this._ws({ type: "hass_recipes/dish_estimate", description: text });
              dishName = r.name || text;
              msg.textContent = "";
              showResult(r);
            } catch (err) {
              msg.textContent = (err && err.message) || String(err);
            }
          });
        };
        const pick = () => {
          this._planFooter(dlg);
          body.innerHTML = `<ha-input-search id="tk-q" appearance="outlined" placeholder="${esc(T("Search recipes and foods"))}"></ha-input-search>
            <div class="tk-chips tk-filters" id="tk-filters">${[["all", "All"], ["mine", "Mine"], ["recipes", "Recipes"], ["db", "Database"]].map(([v, l]) => `<ha-assist-chip data-filter="${v}" label="${esc(T(l))}" ${v === "all" ? "active" : ""}></ha-assist-chip>`).join("")}<ha-assist-chip data-scan label="${esc(T("Scan"))}"><ha-icon slot="icon" icon="mdi:barcode-scan"></ha-icon></ha-assist-chip><ha-assist-chip data-estimate-chip label="${esc(T("Estimate"))}"><ha-icon slot="icon" icon="mdi:creation-outline"></ha-icon></ha-assist-chip></div>
            <div id="tk-res" class="tk-res"></div>`;
          const res = body.querySelector("#tk-res");
          let shown = [];
          let dbHits = []; // foods of the Frida and USDA databases that match what is typed and are not yours yet
          let dbTimer = null;
          const row = (item, sub) => {
            shown.push(item);
            // a picture where there is one: a recipe's, or the package of a scanned product
            const pic = item.image || (item.kind === "recipe" ? (this._recipes.find((r) => r.id === item.recipe_id) || {}).image : item.kind === "food" ? (foods.find((f) => f.id === item.food_id) || {}).image : "");
            const start = pic ? `<img slot="start" class="thumb" src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<ha-icon slot="start" icon="${label(item)}"></ha-icon>`;
            const add = item.kind === "quick" ? "" : `<ha-icon-button slot="end" data-qa="${shown.length - 1}" label="${esc(T("Add"))}"><ha-icon icon="mdi:plus-circle-outline"></ha-icon></ha-icon-button>`;
            return `<ha-list-item-button data-n="${shown.length - 1}" headline="${esc(item.name)}" supporting-text="${esc(sub)}">${start}${add}</ha-list-item-button>`;
          };
          let filter = "all"; // all, mine (foods and favourites), recipes, database
          const head = (text) => `<div class="fm-head">${esc(T(text))}</div>`;
          const draw = (q) => {
            shown = [];
            const needle = q.trim().toLowerCase();
            let out = "";
            const show = (kind) => filter === "all" || filter === kind || (filter === "mine" && kind === "foods") || (filter === "db" && kind === "db");
            if (!needle && (filter === "all" || filter === "mine")) {
              const fav = d.favourites || [];
              const rec = (d.recent || []).filter((t) => !fav.some((f) => JSON.stringify(f) === JSON.stringify(t)));
              if (fav.length) out += head("Favourites") + fav.map((t) => row(t, how(t))).join("");
              if (rec.length) out += head("Recent") + rec.map((t) => row(t, how(t))).join("");
            }
            const recipes = !show("recipes") ? [] : this._recipes.filter((r) => !needle || r.name.toLowerCase().includes(needle)).slice(0, needle ? 15 : 5);
            const found = !show("foods") ? [] : fl.rankFoods(foods, [], needle, []).slice(0, needle ? 20 : 8);
            if (recipes.length) out += head("Recipes") + recipes.map((r) => row({ kind: "recipe", recipe_id: r.id, name: r.name }, r.servings ? `${r.servings} ${T("servings")}` : r.yield_amount ? `${r.yield_amount} ${r.yield_unit || ""}`.trim() : "")).join("");
            if (found.length) out += head("Foods") + found.map((f) => {
              const u = usualOf(f);
              return row({ kind: "food", food_id: f.id, name: f.name }, u.kcal != null ? `${num(u.amount, 1)} ${u.unit}${u.unit === "g" ? "" : ` · ${num(u.grams)} g`} · ${num(u.kcal)} kcal` : T("No nutrition yet"));
            }).join("");
            const mine = (h) => foods.some((f) => (h.source === "frida" ? f.frida_id === h.id : f.usda_id === h.id) || f.name.toLowerCase() === h.name.toLowerCase());
            const wanted = needle.split(/\s+/).filter(Boolean);
            // the typed words must be in the name: the database search also finds look-alikes, which are noise here
            const named = (h) => wanted.every((w) => `${h.name} ${h.name_en || ""}`.toLowerCase().includes(w));
            const more = !show("db") ? [] : dbHits.filter((h) => (h.source === "frida" || h.source === "usda") && named(h) && !mine(h)).slice(0, 12);
            if (needle && more.length) out += head("Food database") + more.map((h) => row({ kind: "dbfood", source: h.source, db_id: h.id, name: h.name }, h.kcal != null ? `${num(h.kcal)} kcal / 100 g · ${h.source === "frida" ? "Frida" : "USDA"}` : h.source === "frida" ? "Frida" : "USDA")).join("");
            out += `<ha-list-item-button data-quick headline="${esc(T("Quick entry"))}" supporting-text="${esc(needle ? q.trim() : T("A name and kcal"))}"><ha-icon slot="start" icon="mdi:pencil-outline"></ha-icon></ha-list-item-button>
              <ha-list-item-button data-estimate headline="${esc(T("Estimate a dish"))}" supporting-text="${esc(T("No recipe? Describe it and get a guess"))}"><ha-icon slot="start" icon="mdi:creation-outline"></ha-icon></ha-list-item-button>`;
            res.innerHTML = `<ha-list-base>${out}</ha-list-base>`;
          };
          draw("");
          const scanChip = body.querySelector("[data-scan]");
          if (scanChip) scanChip.addEventListener("click", () => scan());
          const estChip = body.querySelector("[data-estimate-chip]");
          if (estChip) estChip.addEventListener("click", () => estimate((body.querySelector("#tk-q").value || "").trim()));
          body.querySelectorAll("[data-filter]").forEach((chip) =>
            chip.addEventListener("click", () => {
              filter = chip.dataset.filter;
              body.querySelectorAll("[data-filter]").forEach((c) => c.toggleAttribute("active", c === chip));
              draw(body.querySelector("#tk-q").value);
            })
          );
          body.querySelector("#tk-q").addEventListener("input", (e) => {
            draw(e.target.value);
            clearTimeout(dbTimer);
            const q = e.target.value.trim();
            if (q.length < 2) {
              dbHits = [];
              return;
            }
            dbTimer = setTimeout(async () => {
              try {
                dbHits = await this._ws({ type: "hass_recipes/nutrition_search", query: q, limit: 20 });
              } catch (err) {
                dbHits = [];
              }
              if (body.querySelector("#tk-q") && body.querySelector("#tk-q").value.trim() === q) draw(q);
            }, 250);
          });
          // the plus on a row adds one usual portion (a serving, a slice, 100 g) at once
          const quickAdd = async (picked) => {
            let item = picked;
            if (picked.kind === "dbfood") {
              const { ok, res: made } = await this._tkCall({ type: "hass_recipes/foods_save", name: picked.name, source: picked.source, ...(picked.source === "frida" ? { frida_id: picked.db_id } : { usda_id: picked.db_id }) });
              if (!ok || !made) return;
              foods.push(made);
              item = { kind: "food", food_id: made.id, name: made.name };
            }
            if (item.kind === "food") {
              const f = foods.find((x) => x.id === item.food_id);
              const u = f ? usualOf(f) : { unit: item.unit || "g", amount: item.amount ?? 100 };
              item = { ...item, amount: item.amount ?? u.amount, unit: item.unit || u.unit };
            } else if (item.kind === "recipe") item = { ...item, by: item.by || "servings", amount: item.amount ?? 1 };
            close();
            const { ok } = await this._tkCall({ type: "hass_recipes/tracker_add", person_id: d.person.id, date: d.date, ...this._tkPayload({ ...item, meal }) });
            if (ok) await this._tkLoad();
          };
          res.addEventListener("click", async (e) => {
            const qa = e.target.closest("[data-qa]");
            if (qa) {
              e.stopPropagation();
              return quickAdd({ ...shown[+qa.dataset.qa] });
            }
            if (e.target.closest("[data-estimate]")) return estimate((body.querySelector("#tk-q").value || "").trim());
            if (e.target.closest("[data-quick]")) {
              const typed = body.querySelector("#tk-q").value.trim();
              return startWith({ kind: "quick", name: typed, kcal: "" });
            }
            const item = e.target.closest("[data-n]");
            if (!item) return;
            const picked = { ...shown[+item.dataset.n] };
            if (picked.kind !== "dbfood") return startWith(picked);
            // a food of the database becomes one of your foods, with the weight of a slice or a piece where that is known
            const { ok, res: made } = await this._tkCall({
              type: "hass_recipes/foods_save",
              name: picked.name,
              source: picked.source,
              ...(picked.source === "frida" ? { frida_id: picked.db_id } : { usda_id: picked.db_id }),
            });
            if (!ok || !made) return;
            foods.push(made);
            startWith({ kind: "food", food_id: made.id, name: made.name });
          });
        };
        pick();
      }, { subtitle: `${dayLabel(d.date, d.today)} · ${d.person.name}`, fill: true });
    },

    /** Whether this browser can read barcodes with the camera. */
    _barcodeCamera() {
      return !!(window.BarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    /**
     * The camera, full screen: a frame to hold the barcode in, a way out, typing the number, and the torch.
     * `on`: code(raw) when one is read, close() for the X, type() for typing the number, fail() when the camera cannot be opened.
     */
    _barcodeScanner(on) {
      const ov = document.createElement("div");
      ov.className = "tk-scanner";
      ov.setAttribute("popover", "manual");
      ov.innerHTML = `<video class="tk-scanvid" playsinline muted></video>
        <div class="tk-scanframe"><span>${esc(T("Scan the barcode here"))}</span></div>
        <ha-icon-button class="tk-sx" label="${esc(T("Close"))}"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>
        <ha-icon-button class="tk-sk" label="${esc(T("Type the number"))}"><ha-icon icon="mdi:keyboard-outline"></ha-icon></ha-icon-button>
        <ha-icon-button class="tk-st" label="${esc(T("Torch"))}" hidden><ha-icon icon="mdi:flashlight-off"></ha-icon></ha-icon-button>`;
      this.shadowRoot.appendChild(ov);
      if (ov.showPopover) ov.showPopover();
      let stream = null;
      let timer = null;
      let busy = false;
      const stop = () => {
        clearInterval(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        try {
          if (ov.hidePopover) ov.hidePopover();
        } catch (_) {
          /* already hidden */
        }
        ov.remove();
      };
      ov.querySelector(".tk-sx").addEventListener("click", () => {
        stop();
        on.close();
      });
      ov.querySelector(".tk-sk").addEventListener("click", () => {
        stop();
        on.type();
      });
      const vid = ov.querySelector("video");
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((st) => {
          stream = st;
          vid.srcObject = st;
          vid.play();
          const track = st.getVideoTracks()[0];
          const torchBtn = ov.querySelector(".tk-st");
          if (track && track.getCapabilities && track.getCapabilities().torch) {
            let lit = false;
            torchBtn.hidden = false;
            torchBtn.addEventListener("click", async () => {
              lit = !lit;
              try {
                await track.applyConstraints({ advanced: [{ torch: lit }] });
                torchBtn.querySelector("ha-icon").setAttribute("icon", lit ? "mdi:flashlight" : "mdi:flashlight-off");
              } catch (_) {
                lit = !lit;
              }
            });
          }
          const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
          timer = setInterval(async () => {
            if (!ov.isConnected) return stop();
            if (busy) return;
            try {
              const found = await detector.detect(vid);
              if (!found.length) return;
              busy = true;
              stop();
              on.code(found[0].rawValue);
            } catch (_) {
              /* the next frame */
            }
          }, 400);
        })
        .catch(() => {
          stop();
          on.fail();
        });
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
      on("[data-tkwater]", "click", async (e) => {
        const { ok } = await this._tkCall({ type: "hass_recipes/tracker_water", person_id: st.data.person.id, date: st.date || st.data.date, ml: Number(e.currentTarget.dataset.tkwater) });
        if (ok) await this._tkLoad();
      });
      on("[data-tkday]", "click", (e) => this._tkGo(e.currentTarget.dataset.tkday));
      on("[data-tkact]", "click", (e) => this._tkAct(e.currentTarget.dataset.tkact, e.currentTarget));
      on("[data-tkadd]", "click", (e) => this._tkAct("add", e.currentTarget));
      on("[data-tkplan]", "click", (e) => this._tkAct("plan", e.currentTarget));
      on("[data-tkusual]", "click", (e) => this._tkAct("usual", e.currentTarget));
      on("[data-tkentry]", "click", (e) => this._tkAct("entry", e.currentTarget));
    },
  };
}
