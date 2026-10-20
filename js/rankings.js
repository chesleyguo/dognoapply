(() => {
  const { t, COST_YEAR, residency, tuitionOf, money, moneyFull, local, useCny, fxRate, csrRank, csrLabel, csrOptions, WORLD_EDITIONS, worldRank, worldNum, worldFmt, matchesQuery, debounce, climateFields, climateFilter, climateMatch, byId, COLLEGES, YEARS, RECENT_YEARS, STATE_NAMES, HUBS, esc, tag, subj, library, openDetail } = window.App;

  const $ = (id) => document.getElementById(id);
  const el = {
    q: $("q"), year: $("year"), state: $("state"), control: $("control"), rmin: $("rmin"), rmax: $("rmax"),
    unranked: $("unranked"), onlyFav: $("onlyFav"), favCount: $("favCount"), summary: $("summary"),
    rows: $("rows"), empty: $("empty"), city: $("city"), setting: $("setting"), hub: $("hub"),
    csrDir: $("csrDir"), csrHead: $("csrHead"), res: $("res"), costHead: $("costHead"),
    maxTuition: $("maxTuition"), maxLiving: $("maxLiving"), fx: $("fx"), fxField: $("fxField"),
    sys: $("sys"), selAll: $("selAll"), selBar: $("selBar"), selCount: $("selCount"), toast: $("toast"),
  };

  const state = { control: "", setting: "", sort: "rank", dir: 1 };
  $("rkClimate").innerHTML = climateFields("rk");
  const climate = climateFilter("rk");

  // ---- ranking system: U.S. News national, or QS / THE world rankings ----
  // QS and THE ranks below the top few hundred are bands ("601–650"); they filter and sort by their top end.
  const SYSTEMS = { usnews: YEARS, qs: WORLD_EDITIONS.qs, the: WORLD_EDITIONS.the };
  let sys = "usnews";
  const years = () => SYSTEMS[sys];
  const sysName = () => t(`rk.sys.${sys}`);
  const rankIn = (c, y) => (y == null ? null : sys === "usnews" ? c.ranks[y] ?? null : worldRank(c, sys, y));
  const prevYear = (y) => years()[years().indexOf(y) + 1];

  // ---- controls ----
  // Only the most recent editions are listed until the user asks for older ones.
  let allYears = false;
  let currentYear = YEARS[0];
  function fillYears() {
    const ys = years();
    const short = ys.length > RECENT_YEARS + 1; // QS / THE have few enough editions to list them all
    const list = allYears || !short ? ys : ys.slice(0, RECENT_YEARS);
    el.year.innerHTML = list.map((y) => `<option value="${y}">${t("rk.yearOpt", { year: y })}</option>`).join("") +
      (!short ? "" : allYears
        ? `<option value="less">${t("rk.less")}</option>`
        : `<option value="more">${t("rk.more", { from: ys[ys.length - 1], to: ys[RECENT_YEARS] })}</option>`);
    el.year.value = currentYear;
  }
  function setSys(v) {
    sys = SYSTEMS[v] ? v : "usnews";
    el.sys.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === sys));
    allYears = false;
    currentYear = years()[0];
    fillYears();
    $("rankHead").textContent = t("rk.th.rankSys", { sys: sysName() });
    // The active world ranking already fills the Rank column, so hide its own column.
    $("table").classList.toggle("sys-qs", sys === "qs");
    $("table").classList.toggle("sys-the", sys === "the");
  }
  setSys(new URLSearchParams(location.search).get("sys"));
  el.sys.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === sys) return;
    setSys(b.dataset.v);
    render();
  });
  // Registered before the generic change → render listener below, so the value is settled first.
  el.year.addEventListener("change", () => {
    const v = el.year.value;
    if (v === "more" || v === "less") {
      allYears = v === "more";
      if (!allYears && !years().slice(0, RECENT_YEARS).includes(currentYear)) currentYear = years()[0];
      fillYears();
      if (allYears) try { el.year.showPicker(); } catch {}
    } else {
      currentYear = v;
    }
  });
  const states = [...new Set(COLLEGES.map((c) => c.state))].sort();
  el.state.insertAdjacentHTML("beforeend", states.map((s) => {
    const n = COLLEGES.filter((c) => c.state === s).length;
    return `<option value="${s}">${s} · ${STATE_NAMES[s] || s} (${n})</option>`;
  }).join(""));

  // City options follow the chosen state; "Boston, MA (8)".
  function fillCities() {
    const keep = el.city.value;
    const counts = {};
    COLLEGES.filter((c) => !el.state.value || c.state === el.state.value)
      .forEach((c) => { const k = `${c.city}|${c.state}`; counts[k] = (counts[k] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    el.city.innerHTML = `<option value="">${t("geo.allCities")}</option>` + keys.map((k) => {
      const [city, st] = k.split("|");
      return `<option value="${esc(k)}">${esc(city)}, ${st} (${counts[k]})</option>`;
    }).join("");
    el.city.value = keys.includes(keep) ? keep : "";
  }
  // CSRankings direction: picking one shows that area's rank in the CSRankings column, lists only
  // schools ranked in it, and sorts by it (like selecting the area on csrankings.org).
  el.csrDir.innerHTML = csrOptions();
  const setCsrDir = () => {
    el.csrHead.textContent = el.csrDir.value ? `CSRankings · ${csrLabel(el.csrDir.value)}` : t("subj.csr");
  };
  el.csrDir.addEventListener("change", () => {
    setCsrDir();
    if (el.csrDir.value) { state.sort = "csr"; state.dir = 1; }
    else if (state.sort === "csr") { state.sort = "rank"; state.dir = 1; }
  });

  // Exchange rate box, Chinese UI only.
  el.fxField.hidden = !useCny;
  el.fx.value = fxRate.get();
  if (useCny) [el.maxTuition, el.maxLiving].forEach((i) => { i.step = 10000; });
  el.fx.addEventListener("change", () => {
    fxRate.set(el.fx.value);
    el.fx.value = fxRate.get();
    render();
  });

  // Costs: tuition rate (shared with other pages) and separate caps on tuition and living costs.
  el.costHead.title = t("rk.th.livingTitle", { year: COST_YEAR });
  $("qsHead").title = t("rk.th.worldTitle", { sys: "QS", year: WORLD_EDITIONS.qs[0] });
  $("theHead").title = t("rk.th.worldTitle", { sys: "Times Higher Education (THE)", year: WORLD_EDITIONS.the[0] });
  const showRes = () => el.res.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === residency.get()));
  showRes();
  el.res.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    residency.set(b.dataset.v);
    showRes();
    render();
  });

  el.hub.innerHTML = `<option value="">${t("geo.anyHub")}</option>` + HUBS.map((h) => {
    const n = COLLEGES.filter((c) => c.hub === h.id).length;
    return `<option value="${h.id}">${esc(h.name)} (${n})</option>`;
  }).join("");

  // Segmented buttons: type (public/private) and setting (metro/town).
  const setSeg = (key, root, v) => {
    state[key] = v;
    root.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v));
  };
  const setControl = (v) => setSeg("control", el.control, v);
  [["control", el.control], ["setting", el.setting]].forEach(([key, root]) => root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setSeg(key, root, b.dataset.v);
    render();
  }));
  el.state.addEventListener("change", fillCities); // before the generic render listener below
  const renderSoon = debounce(() => render());
  [el.q, el.rmin, el.rmax, el.maxTuition, el.maxLiving].forEach((i) => i.addEventListener("input", renderSoon));
  [el.year, el.state, el.unranked, el.onlyFav, el.city, el.hub, el.csrDir, ...climate.selects]
    .forEach((i) => i.addEventListener("change", render));

  document.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.dir = state.sort === k ? -state.dir : 1;
    state.sort = k;
    render();
  }));

  // Links from other pages can preset filters, e.g. rankings.html?state=CA&control=public&q=boston
  const params = new URLSearchParams(location.search);
  if (params.get("q")) el.q.value = params.get("q");
  if (states.includes(params.get("state"))) el.state.value = params.get("state");
  if (["public", "private"].includes(params.get("control"))) setControl(params.get("control"));
  if (["metro", "town"].includes(params.get("setting"))) setSeg("setting", el.setting, params.get("setting"));
  if (HUBS.some((h) => h.id === params.get("hub"))) el.hub.value = params.get("hub");
  climate.set({ type: params.get("climate") || "" });
  if ([...el.csrDir.options].some((o) => o.value && o.value === params.get("csr"))) {
    el.csrDir.value = params.get("csr");
    state.sort = "csr";
  }
  setCsrDir();
  fillCities();

  // ---- table ----
  function rows() {
    const year = el.year.value;
    const q = el.q.value.trim().toLowerCase();
    const rmin = parseInt(el.rmin.value, 10) || 1;
    const rmax = parseInt(el.rmax.value, 10) || Infinity;
    const hasRange = el.rmin.value || el.rmax.value;
    const clim = climate.get();

    return COLLEGES.map((c) => {
      const rank = rankIn(c, year), prev = rankIn(c, prevYear(year));
      const rankN = worldNum(rank), prevN = worldNum(prev);
      // A band can't give an exact move; it still sorts and shows as up/down by the band's top end.
      const exact = typeof rank === "number" && typeof prev === "number";
      return { c, rank, rankN, prev, exact, change: rank != null && prev != null ? prevN - rankN : null };
    }).filter(({ c, rank, rankN }) => {
      if (rank == null && !el.unranked.checked) return false;
      if (hasRange && (rank == null || rankN < rmin || rankN > rmax)) return false;
      if (el.state.value && c.state !== el.state.value) return false;
      if (state.control && c.control !== state.control) return false;
      if (el.city.value && `${c.city}|${c.state}` !== el.city.value) return false;
      if (state.setting && c.setting !== state.setting) return false;
      if (el.hub.value && c.hub !== el.hub.value) return false;
      if (el.csrDir.value && csrRank(c, el.csrDir.value) == null) return false;
      if (!climateMatch(c, clim)) return false;
      // Caps are typed in the display currency (CNY in Chinese, USD in English).
      if (el.maxTuition.value && !(local(tuitionOf(c)) <= +el.maxTuition.value)) return false;
      if (el.maxLiving.value && !(local(c.cost?.living) <= +el.maxLiving.value)) return false;
      if (el.onlyFav.checked && !library.has(c.ipeds)) return false;
      if (!matchesQuery(c, q)) return false;
      return true;
    }).sort((a, b) => {
      const k = state.sort;
      let va, vb;
      if (["rank", "change", "cs", "csr", "qs", "the", "living"].includes(k)) {
        const get = (r) => (k === "cs" ? r.c.cs?.rank : k === "csr" ? csrRank(r.c, el.csrDir.value)
          : k === "qs" || k === "the" ? worldNum(worldRank(r.c, k))
          : k === "living" ? r.c.cost?.living : k === "rank" ? r.rankN : r[k]);
        va = get(a);
        vb = get(b);
        // Missing values always sink to the bottom regardless of direction.
        if (va == null || vb == null) return (va == null) - (vb == null) || a.c.name.localeCompare(b.c.name);
        // "Change" reads best biggest-gain-first.
        if (k === "change") [va, vb] = [vb, va];
      } else {
        va = a.c[k]; vb = b.c[k];
      }
      const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return r * state.dir || (a.rankN ?? 1e9) - (b.rankN ?? 1e9);
    });
  }

  function changeCell(r) {
    if (r.rank == null) return "";
    if (r.prev == null) return `<span class="chg new">${t("rk.new")}</span>`;
    if (r.rank === r.prev || (r.exact && r.change === 0)) return `<span class="chg flat">—</span>`;
    const n = r.exact ? ` ${Math.abs(r.change)}` : "";
    const title = r.exact ? "" : ` title="${esc(t("rk.bandMove", { from: r.prev, to: r.rank }))}"`;
    return r.change > 0
      ? `<span class="chg up"${title}>▲${n}</span>`
      : `<span class="chg down"${title}>▼${n}</span>`;
  }

  // ---- bulk selection: tick rows (or the header box for everything shown), then act on them ----
  const selected = new Set();
  let shownIds = [];

  function renderSelection() {
    const n = shownIds.filter((id) => selected.has(id)).length;
    el.selAll.checked = n > 0 && n === shownIds.length;
    el.selAll.indeterminate = n > 0 && n < shownIds.length;
    el.selBar.hidden = selected.size === 0;
    el.selCount.textContent = t("sel.count", { n: selected.size });
  }
  let toastTimer;
  function toast(msg) {
    el.toast.innerHTML = `${msg} <a href="library.html">${t("sel.view")}</a>`;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
  }
  el.selAll.addEventListener("change", () => {
    shownIds.forEach((id) => (el.selAll.checked ? selected.add(id) : selected.delete(id)));
    render();
  });
  $("selAdd").addEventListener("click", () => {
    const n = [...selected].filter((id) => !library.has(id)).length;
    selected.forEach((id) => library.add(id));
    selected.clear();
    render();
    toast(t("sel.added", { n }));
  });
  $("selRemove").addEventListener("click", () => {
    const n = [...selected].filter((id) => library.has(id)).length;
    selected.forEach((id) => library.remove(id));
    selected.clear();
    render();
    toast(t("sel.removed", { n }));
  });
  $("selClear").addEventListener("click", () => { selected.clear(); render(); });

  function render() {
    const list = rows();
    // Only what is on screen can stay selected, so actions never touch hidden schools.
    shownIds = list.map((r) => r.c.ipeds);
    const shown = new Set(shownIds);
    [...selected].forEach((id) => { if (!shown.has(id)) selected.delete(id); });
    el.rows.innerHTML = list.map((r) => `
      <tr data-id="${r.c.ipeds}">
        <td class="c-sel"><input type="checkbox" class="sel" ${selected.has(r.c.ipeds) ? "checked" : ""}
              aria-label="${t("sel.row", { name: esc(r.c.name) })}"></td>
        <td class="c-fav"><button class="star" aria-label="${t("rk.star")}" title="${t("rk.starTitle")}" aria-pressed="${library.has(r.c.ipeds)}">★</button></td>
        <td class="c-rank">${r.rank == null ? '<span class="na">—</span>' : "#" + r.rank}</td>
        <td class="name">${esc(r.c.name)}</td>
        <td class="num c-sub">${subj(r.c.cs)}</td>
        <td class="num c-sub">${csrRank(r.c, el.csrDir.value) ? "#" + csrRank(r.c, el.csrDir.value) : "—"}</td>
        <td class="num c-sub c-qs">${worldFmt(worldRank(r.c, "qs"))}</td>
        <td class="num c-sub c-the">${worldFmt(worldRank(r.c, "the"))}</td>
        <td class="cost" title="${r.c.cost?.living != null ? `${t(r.c.cost.livingBasis === "on" ? "cost.livingOn" : "cost.living")}: ${moneyFull(r.c.cost.living)}` : ""}">${money(r.c.cost?.living)}</td>
        <td class="c-hide-sm" title="${esc(r.c.metro)}">${esc(r.c.city)}<span class="city-setting">${t(`setting.${r.c.setting}Short`)}</span></td>
        <td class="c-hide-sm" title="${esc(STATE_NAMES[r.c.state] || "")}">${r.c.state}</td>
        <td>${tag(r.c.control)}</td>
        <td class="c-hide-sm">${changeCell(r)}</td>
      </tr>`).join("");
    el.empty.hidden = list.length > 0;

    const pub = list.filter((r) => r.c.control === "public").length;
    el.summary.textContent = t("rk.summary", { n: list.length, pub, priv: list.length - pub, year: el.year.value, sys: sysName() });
    el.favCount.textContent = library.size;
    renderSelection();

    document.querySelectorAll("th.sortable").forEach((th) => {
      th.removeAttribute("aria-sort");
      if (th.dataset.sort === state.sort) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
    });
  }

  el.rows.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const box = e.target.closest(".sel");
    if (box) {
      box.checked ? selected.add(tr.dataset.id) : selected.delete(tr.dataset.id);
      renderSelection();
      return;
    }
    if (e.target.closest(".c-sel")) return; // clicks around the checkbox don't open the dialog
    if (e.target.closest(".star")) {
      library.toggle(tr.dataset.id);
      render();
      return;
    }
    openDetail(byId.get(tr.dataset.id), render);
  });

  render();
})();
