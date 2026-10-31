/* Recipes panel: search the Danish recipe sites from the Import page. Mixed into the panel class by recipes-panel.js.
 *
 * The server (recipe_sites.py) searches the sites by the names of their recipes. Opening a result reads the page
 * like a pasted link and shows it as a draft to review before it is saved.
 */
export default function (h) {
  const { esc, T } = h;
  const KEY = "hass_recipes_sites";

  return {
    _siteState() {
      return (this._st = this._st || { q: "", list: null, sel: null, results: null, loading: false, error: "", seq: 0 });
    },

    /** The sites that can be searched (loaded once), and which of them are ticked (kept in this browser). */
    async _sitesLoad() {
      const st = this._siteState();
      if (st.list) return;
      st.list = [];
      try {
        st.list = await this._ws({ type: "hass_recipes/sites" });
      } catch (err) {
        st.error = err.message || String(err);
      }
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || "null");
      } catch (_) {
        /* not remembered */
      }
      st.sel = new Set(Array.isArray(saved) ? saved.filter((id) => st.list.some((s) => s.id === id)) : st.list.map((s) => s.id));
      if (!st.sel.size) st.sel = new Set(st.list.map((s) => s.id));
      if (this._view.name === "import") this._render();
      if (st.q) this._sitesSearch();
    },

    _sitesResultsHtml() {
      const st = this._siteState();
      if (st.loading) return `<div class="muted st-note"><ha-spinner size="small"></ha-spinner> ${esc(T("Searching… the first search reads the sites' recipe lists and can take half a minute."))}</div>`;
      if (st.error) return `<ha-alert alert-type="warning">${esc(st.error)}</ha-alert>`;
      if (!st.results) return "";
      if (!st.results.length) return `<div class="muted st-note">${esc(T("No recipes found. Try another word, or more sites."))}</div>`;
      return `<ha-list-base>${st.results
        .map(
          (r, n) => `<ha-list-item-button data-site-open="${n}" headline="${esc(r.title)}" supporting-text="${esc(r.site_name)}">
            ${r.image ? `<img slot="start" class="thumb" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<ha-icon slot="start" icon="mdi:chef-hat"></ha-icon>`}
            <ha-icon-button slot="end" data-site-link="${n}" label="${esc(T("Open the page"))}"><ha-icon icon="mdi:open-in-new"></ha-icon></ha-icon-button></ha-list-item-button>`
        )
        .join("")}</ha-list-base>`;
    },

    _sitesHtml() {
      const st = this._siteState();
      if (!st.list) this._sitesLoad();
      const chips = (st.list || [])
        .map((s) => `<ha-assist-chip data-site="${esc(s.id)}" label="${esc(s.name)}" ${st.sel && st.sel.has(s.id) ? "active" : ""}></ha-assist-chip>`)
        .join("");
      return `<div class="panel st-panel">
          <h2>${esc(T("Search recipe sites"))}</h2>
          <p class="muted">${esc(T("Find recipes on Valdemarsro, Madens Verden, Louises madblog, DK-kogebogen and Arla. Open one to review it before it is saved."))}</p>
          <ha-input-search id="sites-q" appearance="outlined" placeholder="${esc(T("Search for a dish, for example risengrød"))}" value="${esc(st.q)}"></ha-input-search>
          <div class="st-chips">${chips}</div>
          <div id="sites-res">${this._sitesResultsHtml()}</div>
        </div>`;
    },

    async _sitesSearch() {
      const st = this._siteState();
      const q = st.q.trim();
      const seq = ++st.seq;
      st.error = "";
      if (!q || !st.sel || !st.sel.size) {
        st.results = null;
        st.loading = false;
        return this._sitesPaint();
      }
      st.loading = true;
      this._sitesPaint();
      try {
        const res = await this._ws({ type: "hass_recipes/sites_search", query: q, sites: [...st.sel] });
        if (seq !== st.seq) return;
        st.results = res.results;
      } catch (err) {
        if (seq !== st.seq) return;
        st.error = err.message || String(err);
        st.results = null;
      }
      st.loading = false;
      this._sitesPaint();
    },

    _sitesPaint() {
      const box = this.shadowRoot && this.shadowRoot.getElementById("sites-res");
      if (!box) return;
      box.innerHTML = this._sitesResultsHtml();
      this._sitesBindResults(box);
    },

    _sitesBindResults(box) {
      const st = this._siteState();
      box.querySelectorAll("[data-site-open]").forEach((el) =>
        el.addEventListener("click", () => this._sitesOpen(st.results[+el.dataset.siteOpen].url))
      );
      box.querySelectorAll("[data-site-link]").forEach((el) =>
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          window.open(st.results[+el.dataset.siteLink].url, "_blank", "noopener");
        })
      );
    },

    /** Read the recipe on a page and show it as a draft to review. */
    async _sitesOpen(url) {
      try {
        this._draft = await this._ws({ type: "hass_recipes/import_url", url });
        this._go({ name: "edit" });
      } catch (err) {
        this._error = err.message || String(err);
        this._render();
      }
    },

    _bindSites(root) {
      const st = this._siteState();
      const search = root.getElementById("sites-q");
      if (!search) return;
      let timer = null;
      search.addEventListener("input", () => {
        st.q = search.value || "";
        clearTimeout(timer);
        timer = setTimeout(() => this._sitesSearch(), 500);
      });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          clearTimeout(timer);
          this._sitesSearch();
        }
      });
      root.querySelectorAll("[data-site]").forEach((chip) =>
        chip.addEventListener("click", () => {
          const id = chip.dataset.site;
          if (st.sel.has(id)) st.sel.delete(id);
          else st.sel.add(id);
          chip.toggleAttribute("active", st.sel.has(id));
          try {
            localStorage.setItem(KEY, JSON.stringify([...st.sel]));
          } catch (_) {
            /* not remembered */
          }
          if (st.q.trim()) this._sitesSearch();
        })
      );
      const box = root.getElementById("sites-res");
      if (box) this._sitesBindResults(box);
      if (st.q && !st.results && !st.loading && st.list && st.list.length) this._sitesSearch();
      if (!st.q) search.focus();
    },
  };
}
