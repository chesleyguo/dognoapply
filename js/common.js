// Helpers shared by every page that shows school data. Exposes window.App.
(() => {
  const { t, lang } = window.I18N;
  const YEARS = window.RANK_YEARS; // newest first
  const COLLEGES = window.COLLEGES;
  const byId = new Map(COLLEGES.map((c) => [c.ipeds, c]));

  const STATE_NAMES = {
    AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut",
    DC: "Washington, D.C.", DE: "Delaware", FL: "Florida", GA: "Georgia", IA: "Iowa", IL: "Illinois",
    IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland",
    MI: "Michigan", MN: "Minnesota", MO: "Missouri", MS: "Mississippi", NC: "North Carolina",
    NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NY: "New York", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
  };
  const CONTROL_LABEL = { public: t("control.public"), private: t("control.private") };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tag = (control) => `<span class="tag ${control}">${CONTROL_LABEL[control] || control}</span>`;
  // ---- location: metro setting + industry clusters (see scripts/build_data.py) ----
  const CLUSTERS = (window.CLUSTERS || []).map((c) => ({ id: c.id, ...c[lang] }));
  const clusterById = new Map(CLUSTERS.map((c) => [c.id, c]));
  const fmtPop = (n) => lang === "zh"
    ? (n >= 1e8 ? `${(n / 1e8).toFixed(1)} 亿` : `${Math.round(n / 1e4)} 万`)
    : (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);
  const settingTag = (s) => `<span class="tag setting ${s}">${t(`setting.${s}`)}</span>`;

  // ---- costs (c.cost = { tuitionIn, tuitionOut, living, livingBasis, books }, see build_data.py) ----
  const COST_YEAR = window.COST_YEAR || "";
  // Which tuition rate to use everywhere: "out" (out-of-state / international, default) or "in".
  const RES_KEY = "dognoapply.residency";
  let res = "out";
  try { if (localStorage.getItem(RES_KEY) === "in") res = "in"; } catch {}
  const residency = {
    get: () => res,
    set(v) { res = v === "in" ? "in" : "out"; try { localStorage.setItem(RES_KEY, res); } catch {} },
  };
  const tuitionOf = (c, r = res) => c.cost?.[r === "in" ? "tuitionIn" : "tuitionOut"] ?? null;
  const costTotal = (c, r = res) => {
    const tu = tuitionOf(c, r);
    return tu == null || c.cost.living == null ? null : tu + c.cost.living + (c.cost.books || 0);
  };
  // Source data is in USD. The Chinese UI shows CNY at a user-adjustable rate (default 6.7),
  // saved in this browser; the English UI shows USD.
  const FX_KEY = "dognoapply.fxRate";
  const FX_DEFAULT = 6.7;
  let fx = FX_DEFAULT;
  try { const v = parseFloat(localStorage.getItem(FX_KEY)); if (v > 0) fx = v; } catch {}
  const fxRate = {
    DEFAULT: FX_DEFAULT,
    get: () => fx,
    set(v) { v = parseFloat(v); fx = v > 0 ? v : FX_DEFAULT; try { localStorage.setItem(FX_KEY, fx); } catch {} },
  };
  const useCny = lang === "zh";
  const local = (usd) => (usd == null ? null : useCny ? usd * fx : usd); // USD -> display currency
  const money = (n) => (n == null ? "—" : useCny
    ? `${(n * fx / 10000).toFixed(1)} 万元`
    : `$${(n / 1000).toFixed(1)}k`);
  const moneyFull = (n) => (n == null ? "—" : useCny
    ? `¥${Math.round(n * fx).toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US")}`);

  function costSection(c) {
    if (!c.cost) return "";
    const cell = (r, v) => `<td class="num${r === res ? " cur" : ""}">${moneyFull(v)}</td>`;
    const row = (label, vin, vout, cls = "") => `<tr class="${cls}"><th>${label}</th>${cell("in", vin)}${cell("out", vout)}</tr>`;
    const living = c.cost.livingBasis === "on" ? t("cost.livingOn") : t("cost.living");
    return `<div class="d-cost">
      <h3>${t("cost.title", { year: COST_YEAR })}</h3>
      <table>
        <thead><tr><th></th><th class="${res === "in" ? "cur" : ""}">${t("cost.in")}</th><th class="${res === "out" ? "cur" : ""}">${t("cost.out")}</th></tr></thead>
        <tbody>
          ${row(t("cost.tuition"), c.cost.tuitionIn, c.cost.tuitionOut)}
          ${row(living, c.cost.living, c.cost.living)}
          ${row(t("cost.books"), c.cost.books, c.cost.books)}
          ${row(t("cost.total"), costTotal(c, "in"), costTotal(c, "out"), "total")}
        </tbody>
      </table>
      <p class="d-credit">${t("cost.note", { year: COST_YEAR })}${useCny ? " " + t("cost.fxNote", { rate: fx }) : ""}</p>
    </div>`;
  }

  // ---- CSRankings (c.csr = { rank, faculty, cat: {ai,...}, areas: {vision,...} }, absent if not listed) ----
  const CSR_META = window.CSR_META || { years: [] };
  const CSR_CATS = {
    ai: ["ai", "vision", "mlmining", "nlp", "inforet"],
    systems: ["arch", "comm", "sec", "mod", "da", "bed", "hpc", "mobile", "metrics", "ops", "plan", "soft"],
    theory: ["act", "crypt", "log"],
    interdisciplinary: ["bio", "graph", "csed", "ecom", "chi", "robotics", "visualization"],
  };
  // Direction values: "" (overall), "cat:<category>" or "area:<area>".
  const csrRank = (c, dir = "") => {
    if (!c.csr) return null;
    if (!dir) return c.csr.rank;
    const [kind, id] = dir.split(":");
    return (kind === "cat" ? c.csr.cat : c.csr.areas)[id] ?? null;
  };
  const csrLabel = (dir) => {
    if (!dir) return t("csr.allAreas");
    const [kind, id] = dir.split(":");
    return t(kind === "cat" ? `csr.cat.${id}` : `csr.area.${id}`);
  };
  // <option>s for a direction picker: overall, the four categories, then areas grouped by category.
  const csrOptions = () => `<option value="">${t("csr.allAreas")}</option>
    <optgroup label="${t("csr.categories")}">${Object.keys(CSR_CATS).map((k) => `<option value="cat:${k}">${t(`csr.cat.${k}`)}</option>`).join("")}</optgroup>
    ${Object.entries(CSR_CATS).map(([k, areas]) => `<optgroup label="${t(`csr.cat.${k}`)}">${areas
      .map((a) => `<option value="area:${a}">${t(`csr.area.${a}`)}</option>`).join("")}</optgroup>`).join("")}`;

  function csrSection(c) {
    if (!c.csr) return `<div class="d-csr"><h3>${t("csr.title")}</h3><p class="muted">${t("csr.none")}</p><p class="d-credit">${t("csr.credit")}</p></div>`;
    const [from, to] = CSR_META.years;
    const strong = Object.entries(c.csr.areas).sort((a, b) => a[1] - b[1]).slice(0, 6);
    return `<div class="d-csr">
      <h3>${t("csr.title")}</h3>
      <p class="muted">${t("csr.sub", { from, to, faculty: c.csr.faculty })}</p>
      <div class="csr-cats">${Object.keys(CSR_CATS).map((k) => `
        <a class="csr-cat" href="rankings.html?csr=cat:${k}"><b>${c.csr.cat[k] ? "#" + c.csr.cat[k] : "—"}</b><span>${t(`csr.cat.${k}`)}</span></a>`).join("")}
      </div>
      <p class="muted">${t("csr.strong")}:</p>
      <div class="chips">${strong.map(([a, r]) => `<a class="chip" href="rankings.html?csr=area:${a}">${t(`csr.area.${a}`)} <span>#${r}</span></a>`).join("")}</div>
      <p class="d-credit">${t("csr.credit")}</p>
    </div>`;
  }

  // Subject ranks (graduate programs) are optional per school: { rank, tied } or absent.
  const subj = (s) => (s ? `#${s.rank}` : "—");

  // ---- 选校库 (application library) ----
  // Stored in this browser only, as an ordered list; order within a status is the board order.
  const STATUSES = [
    { id: "considering" },
    { id: "applying" },
    { id: "submitted" },
    { id: "interview" },
    { id: "admitted", outcome: true },
    { id: "rejected", outcome: true },
    { id: "waitlist", outcome: true },
  ].map((s) => ({ ...s, label: t(`status.${s.id}`) }));
  const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
  const LIB_KEY = "dognoapply.library";
  const OLD_FAV_KEY = "dognoapply.favorites";

  let lib = [];
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) lib = JSON.parse(raw);
    else lib = JSON.parse(localStorage.getItem(OLD_FAV_KEY) || "[]").map((id) => ({ id, status: "considering" }));
  } catch {}
  lib = lib.filter((x) => byId.has(x.id) && STATUS_LABEL[x.status]);
  const save = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch {} };

  const library = {
    STATUSES,
    STATUS_LABEL,
    has: (id) => lib.some((x) => x.id === id),
    status: (id) => lib.find((x) => x.id === id)?.status,
    get size() { return lib.length; },
    items: () => lib.map((x) => ({ ...x })),
    add(id, status = "considering") {
      if (!library.has(id)) { lib.push({ id, status }); save(); }
    },
    remove(id) { lib = lib.filter((x) => x.id !== id); save(); },
    toggle(id) { library.has(id) ? library.remove(id) : library.add(id); },
    // Move to `status`, placed before `beforeId` (or at the end of that status when null).
    move(id, status, beforeId = null) {
      const item = lib.find((x) => x.id === id) || { id };
      lib = lib.filter((x) => x.id !== id);
      item.status = status;
      const at = beforeId ? lib.findIndex((x) => x.id === beforeId) : -1;
      at === -1 ? lib.push(item) : lib.splice(at, 0, item);
      save();
    },
  };

  // ---- detail dialog ----
  // Rank history defaults to the most recent editions; older years are opt-in.
  const RECENT_YEARS = 10;
  let detailSpan = "recent"; // "recent" | "all" — kept for this page visit once the user switches

  function chart(c, years) {
    years = [...years].reverse(); // oldest first
    const pts = years.map((y, i) => ({ y, i, r: c.ranks[y] })).filter((p) => p.r != null);
    if (pts.length < 2) {
      return `<p class="chart-cap">${t(pts.length ? "d.chartOne" : "d.chartNone")}${detailSpan === "recent" ? t("d.chartTryAll") : ""}</p>`;
    }

    const W = 600, H = 220, L = 36, R = 12, T = 12, B = 26;
    const first = pts[0].i, last = years.length - 1;
    const maxR = Math.max(...pts.map((p) => p.r));
    const top = Math.ceil(maxR / 10) * 10 || 10;
    const x = (i) => L + ((i - first) / Math.max(1, last - first)) * (W - L - R);
    const y = (r) => T + ((r - 1) / (top - 1)) * (H - T - B);

    // Break the line wherever a school dropped off the list for a year.
    let d = "";
    pts.forEach((p, k) => { d += `${k && pts[k - 1].i === p.i - 1 ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.r).toFixed(1)}`; });

    const ticks = [1, ...[0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f))];
    const step = Math.ceil((last - first + 1) / 7);
    const xt = years.map((yr, i) => ({ yr, i })).filter(({ i }) => i >= first && (last - i) % step === 0);

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("d.chartAria", { name: esc(c.name) })}">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
      ${xt.map(({ yr, i }) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${yr}</text>`).join("")}
      <path class="line" d="${d}"/>
      ${pts.map((p, k) => `<circle class="dot" cx="${x(p.i)}" cy="${y(p.r)}" r="${k === pts.length - 1 ? 4.5 : 2.5}"><title>${p.y}: #${p.r}</title></circle>`).join("")}
    </svg>
    <p class="chart-cap">${t("d.chartCap")}</p>`;
  }

  function history(c) {
    const years = detailSpan === "all" ? YEARS : YEARS.slice(0, RECENT_YEARS);
    const ranked = years.filter((y) => c.ranks[y] != null).map((y) => [y, c.ranks[y]]);
    // Best rank in the window; ties go to the most recent year.
    const best = ranked.reduce((a, b) => (b[1] < a[1] ? b : a), ranked[0]);
    const span = `${years[years.length - 1]}–${years[0]}`;
    return `
      <div class="d-history-head">
        <h3>${t("d.history")} <small>${span}</small></h3>
        <div class="seg seg-sm" role="radiogroup" aria-label="${t("d.span")}">
          <button type="button" data-span="recent" aria-pressed="${detailSpan === "recent"}">${t("d.recent")}</button>
          <button type="button" data-span="all" aria-pressed="${detailSpan === "all"}">${t("d.all", { year: YEARS[YEARS.length - 1] })}</button>
        </div>
      </div>
      <div class="d-stats">
        <div class="d-stat"><b>${best ? "#" + best[1] : "—"}</b><span>${t(`d.best.${detailSpan}`)}${best ? ` (${best[0]})` : ""}</span></div>
        <div class="d-stat"><b>${ranked.length}</b><span>${t(`d.count.${detailSpan}`)}</span></div>
      </div>
      ${chart(c, years)}`;
  }

  let dialog;
  function libButton(c) {
    const s = library.status(c.ipeds);
    return s
      ? `<button type="button" class="btn btn-ghost" data-lib="remove">${t("d.inLib", { status: STATUS_LABEL[s] })}</button>`
      : `<button type="button" class="btn btn-primary" data-lib="add">${t("d.addLib")}</button>`;
  }
  function openDetail(c, onChange) {
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "detail";
      document.body.appendChild(dialog);
      dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    }
    const latest = c.ranks[YEARS[0]];
    dialog.innerHTML = `
      <form method="dialog"><button class="close" aria-label="${t("d.close")}">×</button></form>
      <h2 class="d-title">${esc(c.name)}</h2>
      <p class="d-meta">
        <span>📍 ${esc(c.city)}, ${esc(STATE_NAMES[c.state] || c.state)}</span>
        ${tag(c.control)}
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${t("d.website")}</a>` : ""}
        ${location.pathname.endsWith("map.html") ? "" : `<a href="map.html?school=${c.ipeds}">${t("d.viewOnMap")}</a>`}
      </p>
      <div class="d-stats">
        <div class="d-stat"><b>${latest ? "#" + latest : "—"}</b><span>${t("d.overallRank", { year: YEARS[0] })}</span></div>
        <div class="d-stat"><b>${subj(c.cs)}</b><span>${t("d.csGrad")}</span></div>
        <div class="d-stat"><b>${c.csr ? "#" + c.csr.rank : "—"}</b><span>${t("d.csr")}</span></div>
      </div>
      <div class="d-geo">
        <p><span class="muted">${t("geo.metroArea")}:</span> ${esc(c.metro)} <span class="muted">· ${t("geo.pop", { pop: fmtPop(c.metroPop) })}</span> ${settingTag(c.setting)}</p>
        <p class="muted">${t("geo.clusters")}:</p>
        ${c.clusters.length
          ? `<div class="chips">${c.clusters.map((id) => clusterById.get(id)).map((cl) =>
              `<a class="chip" href="rankings.html?cluster=${cl.id}">${esc(cl.name)} <span>${esc(cl.industries)}</span></a>`).join("")}</div>`
          : `<p class="muted">${t("geo.noCluster")}</p>`}
      </div>
      ${costSection(c)}
      ${csrSection(c)}
      <div id="dHistory">${history(c)}</div>
      <div class="d-actions" id="dLib">${libButton(c)}</div>`;
    dialog.querySelector("#dHistory").addEventListener("click", (e) => {
      const b = e.target.closest("[data-span]");
      if (!b) return;
      detailSpan = b.dataset.span;
      e.currentTarget.innerHTML = history(c);
    });
    dialog.querySelector("#dLib").addEventListener("click", (e) => {
      const b = e.target.closest("[data-lib]");
      if (!b) return;
      b.dataset.lib === "add" ? library.add(c.ipeds) : library.remove(c.ipeds);
      e.currentTarget.innerHTML = libButton(c);
      onChange?.();
    });
    dialog.showModal();
  }

  window.App = { t, lang, COST_YEAR, residency, tuitionOf, costTotal, money, moneyFull, local, useCny, fxRate, CSR_META, CSR_CATS, csrRank, csrLabel, csrOptions, CLUSTERS, clusterById, fmtPop, settingTag, COLLEGES, byId, YEARS, RECENT_YEARS, STATE_NAMES, CONTROL_LABEL, esc, tag, subj, library, openDetail };
})();
