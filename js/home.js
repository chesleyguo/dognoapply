(() => {
  const App = window.App;
  const { t, COLLEGES, YEARS, STATE_NAMES, HUBS, esc, tag, openDetail } = App;
  const year = YEARS[0];
  const ranked = COLLEGES.filter((c) => c.ranks[year] != null).sort((a, b) => a.ranks[year] - b.ranks[year]);
  const recent = YEARS.slice(0, App.RECENT_YEARS);

  document.getElementById("heroStats").innerHTML = [
    [ranked.length, t("home.stat.ranked", { year })],
    [new Set(ranked.map((c) => c.state)).size, t("home.stat.states")],
    [HUBS.length, t("home.stat.hubs")],
    [`${recent[recent.length - 1]}–${recent[0]}`, t("home.stat.years")],
  ].map(([v, l]) => `<li><b>${v}</b><span>${l}</span></li>`).join("");

  document.getElementById("top10Title").textContent = t("home.top10", { year });
  // The hero dog says something different each time it's clicked, and pulls a matching face.
  // Lines are "expression~text"; expressions are the .ex-* groups in the inline SVG.
  const lines = t("home.dogLines").split("|").map((l) => {
    const [ex, text] = l.includes("~") ? l.split("~", 2) : ["meh", l];
    return { ex, text };
  });
  const bubble = document.getElementById("dogBubble");
  const dog = document.getElementById("dogBtn");
  const face = dog.querySelector(".dog-svg");
  let last = -1;
  dog.addEventListener("click", () => {
    let i;
    do { i = Math.floor(Math.random() * lines.length); } while (i === last && lines.length > 1);
    last = i;
    bubble.textContent = lines[i].text;
    face.dataset.ex = lines[i].ex;
    bubble.classList.remove("pop");
    dog.classList.remove("boop");
    void dog.offsetWidth; // restart the animations
    bubble.classList.add("pop");
    dog.classList.add("boop");
  });

  const top = document.getElementById("topList");
  top.innerHTML = ranked.slice(0, 10).map((c) => `
    <li data-id="${c.ipeds}" tabindex="0">
      <span class="tl-rank">#${c.ranks[year]}</span>
      <span class="tl-name">${esc(c.name)}<small>${esc(c.city)}, ${c.state}</small></span>
      ${tag(c.control)}
    </li>`).join("");
  const open = (e) => {
    const li = e.target.closest("li");
    if (li) openDetail(COLLEGES.find((c) => c.ipeds === li.dataset.id));
  };
  top.addEventListener("click", open);
  top.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });

  document.getElementById("hubChips").innerHTML = HUBS.map((h) => {
    const n = COLLEGES.filter((c) => c.hub === h.id && c.ranks[year] != null).length;
    return `<a class="chip" href="rankings.html?hub=${h.id}">${esc(h.name)} <span>${n}</span></a>`;
  }).join("");

  const counts = {};
  ranked.forEach((c) => { counts[c.state] = (counts[c.state] || 0) + 1; });
  document.getElementById("stateChips").innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([s, n]) => `<a class="chip" href="rankings.html?state=${s}">${esc(STATE_NAMES[s] || s)} <span>${n}</span></a>`)
    .join("");
})();
