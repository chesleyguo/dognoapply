(() => {
  const { t, COST_YEAR, costTotal, money, COLLEGES, byId, YEARS, STATE_NAMES, esc, tag, subj, library, openDetail } = window.App;
  const { STATUSES, STATUS_LABEL } = library;
  const year = YEARS[0];
  const $ = (id) => document.getElementById(id);
  const el = {
    board: $("board"), table: $("tableView"), rows: $("tableRows"), empty: $("empty"), summary: $("summary"),
    view: $("view"), addInput: $("addInput"), addList: $("addList"),
  };

  // Board columns; the three outcomes share one "结果" column as stacked drop zones.
  const COLUMNS = [
    { statuses: ["considering"] },
    { statuses: ["applying"] },
    { statuses: ["submitted"] },
    { statuses: ["interview"] },
    { title: t("status.outcome"), statuses: ["admitted", "rejected", "waitlist"] },
  ];

  const VIEW_KEY = "dognoapply.libView";
  let view = "board";
  try { view = localStorage.getItem(VIEW_KEY) === "table" ? "table" : "board"; } catch {}
  const tableSort = { key: "status", dir: 1 };

  const rankOf = (c) => c.ranks[year] ?? null;
  const statusOptions = (cur) => STATUSES.map((s) => `<option value="${s.id}"${s.id === cur ? " selected" : ""}>${s.label}</option>`).join("");

  // ---- render ----
  function render() {
    const items = library.items();
    el.empty.hidden = items.length > 0;
    el.board.hidden = view !== "board" || !items.length;
    el.table.hidden = view !== "table" || !items.length;
    el.view.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === view));

    const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
    items.forEach((x) => counts[x.status]++);
    el.summary.innerHTML = items.length
      ? `<b>${t("lib.total", { n: items.length })}</b>` + STATUSES.filter((s) => counts[s.id])
          .map((s) => `<span class="st-chip s-${s.id}"><i></i>${s.label} ${counts[s.id]}</span>`).join("")
      : "";

    if (view === "board") renderBoard(items, counts);
    else renderTable(items);
  }

  function card(x) {
    const c = byId.get(x.id);
    const r = rankOf(c);
    return `
      <article class="kcard s-${x.status}" draggable="true" data-id="${c.ipeds}" tabindex="0">
        <div class="kc-head">
          <span class="kc-rank">${r ? t("lib.overall", { r }) : t("lib.unranked")}</span>
          <button type="button" class="kc-x" data-act="remove" aria-label="${t("lib.remove", { name: esc(c.name) })}">×</button>
        </div>
        <h3>${esc(c.name)}</h3>
        <p class="kc-meta">${esc(c.city)}, ${c.state} ${tag(c.control)}</p>
        <p class="kc-subj"><span>${t("subj.cs")} ${subj(c.cs)}</span><span>${t("subj.csr")} ${c.csr ? "#" + c.csr.rank : "—"}</span></p>
        <p class="kc-cost">${t("cost.perYear", { amt: money(costTotal(c)) })}</p>
        <select class="kc-status" aria-label="${t("lib.statusOf", { name: esc(c.name) })}">${statusOptions(x.status)}</select>
      </article>`;
  }

  function zone(status, items) {
    const list = items.filter((x) => x.status === status);
    return `<div class="zone" data-status="${status}">${list.map(card).join("") || `<p class="zone-empty">${t("lib.dropHere")}</p>`}</div>`;
  }

  function renderBoard(items, counts) {
    el.board.innerHTML = COLUMNS.map((col) => {
      if (col.statuses.length === 1) {
        const s = col.statuses[0];
        return `<section class="col">
          <header class="col-head s-${s}"><i></i>${STATUS_LABEL[s]}<span class="count">${counts[s]}</span></header>
          ${zone(s, items)}
        </section>`;
      }
      const total = col.statuses.reduce((n, s) => n + counts[s], 0);
      return `<section class="col col-outcome">
        <header class="col-head"><i></i>${col.title}<span class="count">${total}</span></header>
        ${col.statuses.map((s) => `
          <div class="sublane">
            <h4 class="s-${s}"><i></i>${STATUS_LABEL[s]}<span class="count">${counts[s]}</span></h4>
            ${zone(s, items)}
          </div>`).join("")}
      </section>`;
    }).join("");
  }

  function renderTable(items) {
    const order = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));
    const val = (x, c) => ({
      status: order[x.status], name: c.name, rank: rankOf(c), cs: c.cs?.rank ?? null, csr: c.csr?.rank ?? null, cost: costTotal(c),
      state: c.state + c.city, control: c.control,
    })[tableSort.key];
    const rows = items.map((x) => ({ x, c: byId.get(x.id) })).sort((a, b) => {
      const va = val(a.x, a.c), vb = val(b.x, b.c);
      if (va == null || vb == null) return (va == null) - (vb == null);
      const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return r * tableSort.dir || (rankOf(a.c) ?? 999) - (rankOf(b.c) ?? 999);
    });
    el.rows.innerHTML = rows.map(({ x, c }) => `
      <tr data-id="${c.ipeds}">
        <td><select class="kc-status s-${x.status}" aria-label="${t("lib.statusOf", { name: esc(c.name) })}">${statusOptions(x.status)}</select></td>
        <td class="name">${esc(c.name)}</td>
        <td class="num">${rankOf(c) ? "#" + rankOf(c) : "—"}</td>
        <td class="num">${subj(c.cs)}</td>
        <td class="num">${c.csr ? "#" + c.csr.rank : "—"}</td>
        <td class="cost">${money(costTotal(c))}</td>
        <td class="c-hide-sm">${esc(c.city)}, ${c.state}</td>
        <td class="c-hide-sm">${tag(c.control)}</td>
        <td><button type="button" class="kc-x" data-act="remove" aria-label="${t("lib.remove", { name: esc(c.name) })}">×</button></td>
      </tr>`).join("");
    document.querySelectorAll("#tableView th.sortable").forEach((th) => {
      th.removeAttribute("aria-sort");
      if (th.dataset.sort === tableSort.key) th.setAttribute("aria-sort", tableSort.dir > 0 ? "ascending" : "descending");
    });
  }

  // ---- shared card/row interactions ----
  function onClick(e) {
    const host = e.target.closest("[data-id]");
    if (!host || e.target.closest("select")) return;
    if (e.target.closest('[data-act="remove"]')) {
      library.remove(host.dataset.id);
      render();
      return;
    }
    openDetail(byId.get(host.dataset.id), render);
  }
  // ---- admit celebration: paw prints burst out of the card + a toast ----
  let toastEl, toastTimer;
  function celebrate(id) {
    const host = document.querySelector(`.kcard[data-id="${id}"], #tableRows tr[data-id="${id}"]`);
    if (host && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const r = host.getBoundingClientRect();
      for (let i = 0; i < 14; i++) {
        const p = document.createElement("span");
        p.className = "paw-burst";
        p.textContent = "🐾";
        const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
        const dist = 60 + Math.random() * 70;
        p.style.left = `${r.left + r.width / 2}px`;
        p.style.top = `${r.top + Math.min(r.height / 2, 60)}px`;
        p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
        p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
        p.style.setProperty("--rot", `${Math.random() * 360 - 180}deg`);
        document.body.appendChild(p);
        p.addEventListener("animationend", () => p.remove());
      }
    }
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = t("lib.congrats");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }
  // Move a school, re-render, and celebrate if it just became "admitted".
  function moveTo(id, status, beforeId = null) {
    const was = library.status(id);
    library.move(id, status, beforeId);
    render();
    if (status === "admitted" && was !== "admitted") celebrate(id);
  }

  function onChange(e) {
    const sel = e.target.closest(".kc-status");
    if (!sel) return;
    moveTo(sel.closest("[data-id]").dataset.id, sel.value);
  }
  [el.board, el.rows].forEach((root) => {
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
  });
  el.board.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("kcard")) openDetail(byId.get(e.target.dataset.id), render);
  });

  // ---- drag & drop ----
  let dragId = null;
  const marker = document.createElement("div");
  marker.className = "drop-marker";

  el.board.addEventListener("dragstart", (e) => {
    const c = e.target.closest(".kcard");
    if (!c) return;
    dragId = c.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    requestAnimationFrame(() => c.classList.add("dragging"));
  });
  el.board.addEventListener("dragend", () => {
    dragId = null;
    marker.remove();
    el.board.querySelectorAll(".dragging, .over").forEach((n) => n.classList.remove("dragging", "over"));
  });
  // The card the pointer is above, i.e. the one the dragged card will be inserted before.
  const cardAfter = (z, y) => [...z.querySelectorAll(".kcard:not(.dragging)")]
    .find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });

  el.board.addEventListener("dragover", (e) => {
    const z = e.target.closest(".zone");
    if (!z || !dragId) return;
    e.preventDefault();
    el.board.querySelectorAll(".zone.over").forEach((n) => n !== z && n.classList.remove("over"));
    z.classList.add("over");
    const after = cardAfter(z, e.clientY);
    after ? z.insertBefore(marker, after) : z.appendChild(marker);
  });
  el.board.addEventListener("dragleave", (e) => {
    const z = e.target.closest(".zone");
    if (z && !z.contains(e.relatedTarget)) { z.classList.remove("over"); marker.remove(); }
  });
  el.board.addEventListener("drop", (e) => {
    const z = e.target.closest(".zone");
    if (!z || !dragId) return;
    e.preventDefault();
    const before = marker.nextElementSibling?.closest(".kcard");
    const id = dragId;
    marker.remove();
    moveTo(id, z.dataset.status, before && before.dataset.id !== id ? before.dataset.id : null);
  });

  // ---- view toggle & table sort ----
  el.view.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    view = b.dataset.v;
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
    render();
  });
  document.querySelectorAll("#tableView th.sortable").forEach((th) => th.addEventListener("click", () => {
    tableSort.dir = tableSort.key === th.dataset.sort ? -tableSort.dir : 1;
    tableSort.key = th.dataset.sort;
    render();
  }));

  // ---- add school ----
  let matches = [];
  function suggest() {
    const q = el.addInput.value.trim().toLowerCase();
    matches = q
      ? COLLEGES.filter((c) => !library.has(c.ipeds) && `${c.name} ${c.city} ${STATE_NAMES[c.state] || ""}`.toLowerCase().includes(q))
          .sort((a, b) => (rankOf(a) ?? 999) - (rankOf(b) ?? 999)).slice(0, 8)
      : [];
    el.addList.innerHTML = matches.map((c, i) => `
      <li role="option" data-i="${i}"><span>${esc(c.name)}<small>${esc(c.city)}, ${c.state}</small></span>
        <span class="muted">${rankOf(c) ? "#" + rankOf(c) : ""}</span></li>`).join("")
      || (q ? `<li class="none">${t("lib.noMatch")}</li>` : "");
    el.addList.hidden = !q;
    el.addInput.setAttribute("aria-expanded", !!q);
  }
  function addMatch(i) {
    const c = matches[i];
    if (!c) return;
    library.add(c.ipeds);
    el.addInput.value = "";
    suggest();
    render();
  }
  el.addInput.addEventListener("input", suggest);
  el.addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addMatch(0); }
    if (e.key === "Escape") { el.addInput.value = ""; suggest(); }
  });
  el.addList.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  el.addList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) addMatch(+li.dataset.i);
  });
  el.addInput.addEventListener("blur", () => { el.addList.hidden = true; });

  render();
})();
