// Shared site header + footer. Include synchronously right after <header id="siteNav"> so the
// nav renders before first paint. To add a new feature page, add one entry to NAV.
(() => {
  const { t, lang, setLang } = window.I18N;
  const NAV = [
    { href: "index.html", key: "nav.home" },
    { href: "rankings.html", key: "nav.rankings" },
    { href: "map.html", key: "nav.map" },
    { href: "library.html", key: "nav.library" },
    { href: "about.html", key: "nav.about" },
  ];

  const here = location.pathname.split("/").pop() || "index.html";
  const nav = document.getElementById("siteNav");
  nav.innerHTML = `
    <div class="wrap nav-inner">
      <a class="brand" href="index.html">
        <img class="brand-logo" src="assets/logo.svg" width="36" height="36" alt="${t("site.logoAlt")}">
        <span class="brand-text"><span class="bt-full">${t("site.name")}</span><span class="bt-short">${t("site.short")}</span></span>
      </a>
      <nav id="navLinks" class="nav-links" aria-label="${t("nav.main")}">
        ${NAV.map((n) => `<a href="${n.href}"${n.href === here ? ' aria-current="page"' : ""}>${t(n.key)}</a>`).join("")}
      </nav>
      <button type="button" class="lang-toggle" lang="${lang === "zh" ? "en" : "zh-CN"}"
              aria-label="${t("lang.switchLabel")}" title="${t("lang.switchLabel")}">${t("lang.switch")}</button>
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="navLinks" aria-label="${t("nav.menu")}">
        <span></span><span></span><span></span>
      </button>
    </div>`;

  nav.querySelector(".lang-toggle").addEventListener("click", () => setLang(lang === "zh" ? "en" : "zh"));

  // Hamburger menu (phones / narrow windows): opens a drop-down; closes on link tap, outside tap,
  // Escape, or when the window grows back to desktop width.
  const toggle = nav.querySelector(".nav-toggle");
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", open);
    nav.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  nav.querySelector(".nav-links").addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("click", (e) => { if (nav.classList.contains("open") && !nav.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) { setOpen(false); toggle.focus(); }
  });
  matchMedia("(min-width: 761px)").addEventListener("change", (m) => { if (m.matches) setOpen(false); });

  document.addEventListener("DOMContentLoaded", () => {
    const foot = document.createElement("footer");
    foot.className = "site-foot";
    foot.innerHTML = `
      <div class="wrap">
        <p class="foot-tagline"><img src="assets/logo.svg" width="20" height="20" alt=""> ${t("foot.tagline")}</p>
        <p>${t("foot.sources")}</p>
        <p>${t("foot.disclaimer")}</p>
      </div>`;
    document.body.appendChild(foot);
  });
})();
