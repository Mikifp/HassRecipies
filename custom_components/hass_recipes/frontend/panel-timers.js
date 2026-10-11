/* Recipes panel: timers methods. Mixed into the panel class by recipes-panel.js. */
export default function (h) {
  const { esc, clock } = h;
  return {
    // ---- keep the screen on while cooking ----
    async _syncWake() {
      const cooking = this._view.name === "cook";
      if (!cooking) return this._releaseWake();
      if (this._wake || !("wakeLock" in navigator)) return;
      try {
        this._wake = await navigator.wakeLock.request("screen");
        this._wake.addEventListener("release", () => (this._wake = null));
      } catch (_) { /* needs a secure context / user gesture; cooking still works */ }
    },

    _releaseWake() {
      if (this._wake) {
        this._wake.release().catch(() => {});
        this._wake = null;
      }
    },

    // ---- timers (kept on the server: shared across devices, fire HA events) ----
    _timerRunning(key) {
      return this._timers.some((t) => t.key === key && !t.done);
    },

    async _startTimer(key, label, seconds, recipeId, step) {
      if (this._timerRunning(key)) return;
      try {
        this._audio = this._audio || new AudioContext(); // created on a user gesture so the alarm can play
        this._audio.resume();
      } catch (_) { /* no audio */ }
      try {
        await this._ws({ type: "hass_recipes/timer_start", key, label, seconds, recipe_id: recipeId, step });
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    async _dismissTimer(id) {
      try {
        await this._ws({ type: "hass_recipes/timer_dismiss", timer_id: id });
      } catch (_) { /* the subscription will resync */ }
    },

    _onTimers(snapshot) {
      const wasDone = new Set(this._timers.filter((t) => t.done).map((t) => t.id));
      this._skew = snapshot.now_ms - Date.now();
      this._timers = snapshot.timers;
      if (this._timers.some((t) => t.done && !wasDone.has(t.id))) {
        this._lastBeep = Date.now();
        this._beep();
      }
      this._handleFinishedTimers(this._timers);
      if (!this._loaded) return;
      // Never rebuild a form the user may be typing in; just refresh the timer bar.
      if (["edit", "import"].includes(this._view.name)) this._renderTimers();
      else this._render();
    },

    _beep() {
      try {
        const ctx = this._audio;
        if (!ctx) return;
        for (let i = 0; i < 4; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.2;
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.35);
          osc.stop(ctx.currentTime + i * 0.35 + 0.2);
        }
      } catch (_) { /* ignore */ }
    },

    _tick() {
      this._renderTimers();
      const now = Date.now() + this._skew;
      const ringing = this._timers.some((t) => t.done && now - t.ends_at_ms < 5 * 60e3);
      if (ringing && Date.now() - (this._lastBeep || 0) > 7000) {
        this._lastBeep = Date.now();
        this._beep();
      }
    },

    _renderTimers() {
      const box = this.shadowRoot.getElementById("timers");
      if (!box) return;
      const sig = this._timers.map((t) => t.id + t.done).join("|");
      if (sig !== this._timerSig) {
        this._timerSig = sig;
        box.innerHTML = this._timers
          .map(
            (t) => `<div class="timer ${t.done ? "done" : ""}">
              <span>⏱ ${esc(t.label)}</span><span class="t-time" data-end="${t.ends_at_ms}"></span>
              <button data-dismiss="${esc(t.id)}" class="${t.done ? "stop" : ""}" title="${t.done ? "Stop the alarm" : "Cancel timer"}">${t.done ? "Stop" : "✕"}</button></div>`
          )
          .join("");
        box.querySelectorAll("[data-dismiss]").forEach((b) =>
          b.addEventListener("click", () => this._dismissTimer(b.dataset.dismiss))
        );
      }
      const now = Date.now() + this._skew;
      box.querySelectorAll(".t-time").forEach((el) => {
        const left = (+el.dataset.end - now) / 1000;
        el.textContent = left > 0 ? clock(left) : "Done!";
      });
    },

    async _subscribeTimers() {
      try {
        this._unsubTimers = await this._hass.connection.subscribeMessage(
          (snapshot) => this._onTimers(snapshot),
          { type: "hass_recipes/subscribe_timers" }
        );
      } catch (err) {
        this._error = `Timers unavailable: ${err.message || err}`;
      }
    },
  };
}
