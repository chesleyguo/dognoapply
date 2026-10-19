(() => {
  const { t, costTotal, money, HUBS, COLLEGES, byId, YEARS, STATE_NAMES, esc, tag, subj, library, openDetail } = window.App;
  const year = YEARS[0];
  const $ = (id) => document.getElementById(id);
  const el = {
    q: $("mapQ"), control: $("mapControl"), rank: $("mapRank"), subj: $("mapSubj"), lib: $("mapLib"),
    list: $("mapList"), summary: $("mapSummary"), setting: $("mapSetting"), hub: $("mapHub"),
  };
  const rankOf = (c) => c.ranks[year] ?? null;
  let control = "";
  let setting = "";

  el.hub.innerHTML = `<option value="">${t("geo.anyHub")}</option>` +
    HUBS.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("");

  el.rank.innerHTML = [25, 50, 100].map((n) => `<option value="${n}">${t("map.top", { year, n })}</option>`).join("") +
    `<option value="ranked" selected>${t("map.ranked", { year })}</option><option value="all">${t("map.all")}</option>`;

  // ---- map ----
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const COLORS = { public: color("--public"), private: color("--private"), lib: color("--gold") };

  // Base map is drawn from bundled state outlines (data/us-states.js): no tile service or API key needed.
  const map = L.map("map", { zoomSnap: 0.25, minZoom: 3, maxZoom: 11, attributionControl: true });
  map.attributionControl.setPrefix(false).addAttribution(t("map.attrib"));
  const US_BOUNDS = [[24.5, -125], [49.5, -66.9]];
  map.fitBounds(US_BOUNDS);

  const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([k, v]) => [v, k]));
  NAME_TO_ABBR["District of Columbia"] = "DC";
  const stateStyle = { color: color("--map-border"), weight: 1, fillColor: color("--map-land"), fillOpacity: 1 };
  const states = L.geoJSON(window.US_STATES, {
    style: stateStyle,
    onEachFeature(f, lyr) {
      lyr.bindTooltip(() => {
        const ab = NAME_TO_ABBR[f.properties.name];
        const n = ab ? [...markers.keys()].filter((id) => byId.get(id).state === ab).length : 0;
        return `${esc(f.properties.name)}${n ? t("map.stateCount", { n }) : ""}`;
      }, { sticky: true, className: "state-tip" });
      lyr.on({
        mouseover: () => lyr.setStyle({ fillColor: color("--map-land-hover") }),
        mouseout: () => lyr.setStyle({ fillColor: stateStyle.fillColor }),
        click: () => map.fitBounds(lyr.getBounds(), { padding: [30, 30], maxZoom: 8 }),
      });
    },
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const markers = new Map(); // ipeds -> circleMarker

  function popup(c) {
    const r = rankOf(c);
    const inLib = library.status(c.ipeds);
    return `
      <div class="map-pop">
        <b>${esc(c.name)}</b>
        <div class="muted">${esc(c.city)}, ${esc(STATE_NAMES[c.state] || c.state)} ${tag(c.control)}</div>
        <div class="map-pop-ranks">
          <span>${t("subj.overall")} ${r ? "#" + r : "—"}</span><span>${t("subj.cs")} ${subj(c.cs)}</span><span>${t("subj.csr")} ${c.csr ? "#" + c.csr.rank : "—"}</span>
        </div>
        <div class="map-pop-cost">${t("cost.th")}: <b>${money(costTotal(c))}</b></div>
        <div class="map-pop-actions">
          <button type="button" class="btn btn-ghost" data-detail="${c.ipeds}">${t("map.details")}</button>
          ${inLib
            ? `<button type="button" class="btn btn-ghost" data-lib="${c.ipeds}">✓ ${library.STATUS_LABEL[inLib]}</button>`
            : `<button type="button" class="btn btn-primary" data-lib="${c.ipeds}">${t("map.add")}</button>`}
        </div>
      </div>`;
  }

  function style(c) {
    const inLib = library.has(c.ipeds);
    const r = rankOf(c);
    return {
      radius: r == null ? 5 : r <= 25 ? 9 : r <= 50 ? 8 : r <= 100 ? 7 : 6,
      color: inLib ? COLORS.lib : "#ffffff",
      weight: inLib ? 3 : 1.5,
      fillColor: COLORS[c.control] || COLORS.private,
      fillOpacity: 0.85,
    };
  }

  // ---- filtering ----
  function filtered() {
    const q = el.q.value.trim().toLowerCase();
    const rf = el.rank.value;
    return COLLEGES.filter((c) => {
      const r = rankOf(c);
      if (rf !== "all" && r == null) return false;
      if (/^\d+$/.test(rf) && r > +rf) return false;
      if (control && c.control !== control) return false;
      if (setting && c.setting !== setting) return false;
      if (el.hub.value && c.hub !== el.hub.value) return false;
      if (el.subj.value && !c[el.subj.value]) return false;
      if (el.lib.checked && !library.has(c.ipeds)) return false;
      if (q && !`${c.name} ${c.city} ${STATE_NAMES[c.state] || ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (rankOf(a) ?? 999) - (rankOf(b) ?? 999) || a.name.localeCompare(b.name));
  }

  function render() {
    const list = filtered();
    layer.clearLayers();
    markers.clear();
    // Draw lower-ranked first so top schools sit on top where points overlap.
    [...list].reverse().forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], style(c))
        .bindTooltip(esc(c.name), { direction: "top", offset: [0, -6] })
        .bindPopup(() => popup(c), { maxWidth: 280 });
      m.addTo(layer);
      markers.set(c.ipeds, m);
    });

    const pub = list.filter((c) => c.control === "public").length;
    el.summary.textContent = t("map.summary", { n: list.length, pub, priv: list.length - pub });
    el.list.innerHTML = list.map((c) => `
      <li data-id="${c.ipeds}" tabindex="0">
        <span class="ml-rank">${rankOf(c) ? "#" + rankOf(c) : "—"}</span>
        <span class="ml-name">${esc(c.name)}<small>${esc(c.city)}, ${c.state}</small></span>
        <i class="lg ${c.control}${library.has(c.ipeds) ? " lib" : ""}" title="${t(`control.${c.control}`)}"></i>
      </li>`).join("") || `<li class="none">${t("map.none")}</li>`;
  }

  function focus(id) {
    const m = markers.get(id);
    if (!m) return;
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 11), { duration: 0.8 });
    map.once("moveend", () => m.openPopup());
  }

  // ---- events ----
  el.control.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    control = b.dataset.v;
    el.control.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    render();
  });
  el.setting.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setting = b.dataset.v;
    el.setting.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    render();
  });
  // Picking a city zooms to its schools; clearing it goes back to the whole country.
  el.hub.addEventListener("change", () => {
    render();
    const pts = [...markers.values()].map((m) => m.getLatLng());
    if (el.hub.value && pts.length) map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 10, duration: 0.8 });
    else map.flyToBounds(US_BOUNDS, { duration: 0.8 });
  });
  el.q.addEventListener("input", render);
  [el.rank, el.subj, el.lib].forEach((i) => i.addEventListener("change", render));

  const pick = (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) focus(li.dataset.id);
  };
  el.list.addEventListener("click", pick);
  el.list.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(e); });

  // Popup buttons (popups are rendered inside the map container).
  $("map").addEventListener("click", (e) => {
    const d = e.target.closest("[data-detail]");
    if (d) openDetail(byId.get(d.dataset.detail), refresh);
    const l = e.target.closest("[data-lib]");
    if (l) {
      library.toggle(l.dataset.lib);
      refresh();
    }
  });
  // Re-style markers + list after the library changes, keeping the open popup in sync.
  function refresh() {
    const open = [...markers].find(([, m]) => m.isPopupOpen());
    render();
    if (open) markers.get(open[0])?.openPopup();
  }

  render();
  // map.html?school=<ipeds> opens straight onto one school (linked from the detail dialog).
  const id = new URLSearchParams(location.search).get("school");
  if (id && byId.has(id)) {
    if (!markers.has(id)) { el.rank.value = "all"; render(); }
    const c = byId.get(id);
    map.setView([c.lat, c.lon], 12);
    markers.get(id)?.openPopup();
  }
})();
