/* Recipes panel: progress methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { normStep, state, PROGRESS_KEY, HANDLED_KEY } = h;
  return {
    // ---- checked ingredients / done steps survive reloads (per recipe, 2 days) ----
    _readProgress() {
      try {
        return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      } catch (_) {
        return {};
      }
    },

    _loadProgress(id) {
      let entry = id ? this._readProgress()[id] : null;
      // Checks older than two days are stale: ignore them even before they are pruned.
      if (entry && Date.now() - (entry.t || 0) > 2 * 864e5) entry = null;
      this._checked = new Set((entry && entry.ing) || []);
      this._doneSteps = new Set((entry && entry.steps) || []);
      // A recipe whose steps were all completed (e.g. by timers) starts fresh next time.
      const r = id ? this._recipe(id) : null;
      if (r && this._allDone(r)) {
        this._checked = new Set();
        this._doneSteps = new Set();
        this._saveProgress();
      }
    },

    _stepIndexes(r) {
      return r.instructions
        .map(normStep)
        .map((st, i) => (st.section ? -1 : i))
        .filter((i) => i >= 0);
    },

    _allDone(r) {
      const idx = this._stepIndexes(r);
      return idx.length > 0 && idx.every((i) => this._doneSteps.has(i));
    },

    /** Called after any step is checked: when every step is done, start over. */
    _checkAllDone() {
      clearTimeout(this._resetTimer);
      const r = this._recipe(this._view.id);
      if (!r || !this._allDone(r)) return;
      // a short pause so the finished state is visible before it resets
      this._resetTimer = setTimeout(() => {
        const cur = this._recipe(this._view.id);
        if (!cur || cur.id !== r.id || !this._allDone(cur)) return; // user un-ticked something
        this._checked = new Set();
        this._doneSteps = new Set();
        this._saveProgress();
        this._flash("All steps done. Checks cleared for next time.");
      }, 1500);
    },

    _setStepDone(n, done) {
      if (done) this._doneSteps.add(n);
      else this._doneSteps.delete(n);
      this._saveProgress();
      this._checkAllDone();
      this._scrollToCurrent = this._view.name === "cook" && !this._cookFocus;
      this._render();
    },

    _flash(text) {
      this._notice = text;
      clearTimeout(this._noticeTimer);
      if (!["edit", "import"].includes(this._view.name)) this._render();
      this._noticeTimer = setTimeout(() => {
        this._notice = "";
        if (!["edit", "import"].includes(this._view.name)) this._render();
      }, 3500);
    },

    /** A finished timer completes the step it belongs to, on this or another recipe. */
    _markStepDoneFor(recipeId, step) {
      if (this._view.id === recipeId) {
        this._doneSteps.add(step);
        this._saveProgress();
        this._checkAllDone();
        return;
      }
      const all = this._readProgress();
      const entry = all[recipeId] || { ing: [], steps: [], t: 0 };
      if (!entry.steps.includes(step)) entry.steps.push(step);
      entry.t = Date.now();
      all[recipeId] = entry;
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
      } catch (_) { /* ignore */ }
    },

    _handleFinishedTimers(timers) {
      let handled = [];
      try {
        handled = JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]");
      } catch (_) { /* ignore */ }
      const seen = new Set(handled);
      const waiting = new Set();
      for (const t of timers) {
        if (t.done && !seen.has(t.id) && t.recipe_id && Number.isInteger(t.step)) {
          // a step with several timers is done when the last of them has finished
          if (timers.some((o) => !o.done && o.recipe_id === t.recipe_id && o.step === t.step)) {
            waiting.add(t.id);
            continue;
          }
          this._markStepDoneFor(t.recipe_id, t.step);
        }
      }
      // remember only timers that still exist, so the list cannot grow without bound
      const keep = timers.filter((t) => t.done && !waiting.has(t.id)).map((t) => t.id);
      try {
        localStorage.setItem(HANDLED_KEY, JSON.stringify(keep));
      } catch (_) { /* ignore */ }
    },

    _saveProgress() {
      const id = this._view.id;
      if (!id) return;
      const all = this._readProgress();
      const now = Date.now();
      for (const key of Object.keys(all)) if (now - (all[key].t || 0) > 2 * 864e5) delete all[key];
      if (this._checked.size || this._doneSteps.size) {
        all[id] = { ing: [...this._checked], steps: [...this._doneSteps], t: now };
      } else {
        delete all[id];
      }
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
      } catch (_) { /* ignore */ }
    },
  };
}
