// =========================================================
// Affichage du site.
// Les données (menu, accueil, réglages) sont dans site-data.js,
// le contenu des pages dans content.js (clé = `id` de la page).
// Les deux fichiers sont réécrits par l'éditeur (editor.js).
// =========================================================

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Index des pages (avec leur fil d'Ariane) ----------
let PAGES = {};
function buildIndex() {
  PAGES = {};
  (function index(items, trail) {
    for (const item of items) {
      if (item.id) PAGES[item.id] = { ...item, trail };
      if (item.children) index(item.children, [...trail, item.title]);
    }
  })(SITE_DATA.nav, []);
}

// ---------- Réglages (nom du site, pied de page) ----------
function renderSettings() {
  const s = SITE_DATA.settings;
  $("#brand-name").textContent = s.siteName;
  $("#sidebar-title").textContent = s.sidebarTitle;
  $("#sidebar-subtitle").textContent = s.siteName;
  $("#footer-text").innerHTML = s.footerText;
  $("#footer-credit").textContent = s.credit;
  window.renderAuth?.();   // bouton Discord (dépend de l'identifiant réglé)
}

// ---------- Menu ----------
function buildNav(items) {
  return items.map((item) => {
    if (item.children) {
      return `<div class="group">
        <button class="group-toggle" type="button"><span>${item.icon}</span>${esc(item.title)}<span class="chev">▶</span></button>
        <div class="group-items">${buildNav(item.children)}</div>
      </div>`;
    }
    return `<a href="#${item.id}" data-id="${item.id}"><span>${item.icon}</span>${esc(item.title)}</a>`;
  }).join("");
}

const nav = $("#nav");
function renderNav() {
  nav.innerHTML = buildNav(SITE_DATA.nav);
  markActive();
}
nav.addEventListener("click", (e) => {
  const toggle = e.target.closest(".group-toggle");
  if (toggle) toggle.parentElement.classList.toggle("open");
  if (e.target.closest("a")) closeMenu();
});

const sidebar = $("#sidebar"), overlay = $("#overlay");
function closeMenu() { sidebar.classList.remove("open"); overlay.classList.remove("open"); }
$("#burger").addEventListener("click", () => { sidebar.classList.add("open"); overlay.classList.add("open"); });
overlay.addEventListener("click", closeMenu);

// ---------- Rendu des pages ----------
function renderHome() {
  const h = SITE_DATA.home;
  const buttons = h.buttons.filter((b) => PAGES[b.page]).map((b, i) =>
    `<a class="btn ${i === 0 ? "primary" : "ghost"}" href="#${b.page}">${b.icon} ${esc(b.label)}</a>`).join("");
  const cards = h.featured.filter((f) => PAGES[f.page]).map((f) => {
    const p = PAGES[f.page];
    return `<a class="card" href="#${f.page}"><span class="ico">${p.icon}</span><h3>${esc(p.title)}</h3><p>${esc(f.text)}</p></a>`;
  }).join("");

  return `
  <section class="hero">
    <div class="hero-inner">
      <img class="emblem" src="logo.png" alt="Emblème Shock Trooper">
      <p class="kicker" data-field="kicker">${esc(h.kicker)}</p>
      <h1 data-field="title">${h.title}</h1>
      <p class="lead" data-field="lead">${esc(h.lead)}</p>
      <div class="btn-row">${buttons}</div>
    </div>
    <a class="scroll-hint" href="#bienvenue" aria-label="Défiler vers le bas">⌄</a>
  </section>

  <section class="section" id="bienvenue">
    <h2 class="section-title" data-field="welcomeTitle">${esc(h.welcomeTitle)}</h2>
    <div class="welcome">
      <p data-field="welcome">${h.welcome}</p>
      <img src="logo.png" alt="">
    </div>
  </section>

  <section class="section">
    <h2 class="section-title" data-field="featuredTitle">${esc(h.featuredTitle)}</h2>
    <div class="grid">${cards}</div>
  </section>

  <section class="section home-blocks">
    <article class="doc content" data-page-body>${CONTENT.accueil || ""}</article>
  </section>`;
}

function renderPage(p) {
  const crumbs = ['<a href="#accueil">Accueil</a>', ...p.trail.map(esc), `<span class="crumb-current">${esc(p.title)}</span>`].join(" / ");
  const hasContent = !!CONTENT[p.id];
  const body = hasContent ? CONTENT[p.id] : "";

  return `
  <section class="page-hero">
    <p class="breadcrumb">${crumbs}</p>
    <div class="ico" data-page-icon>${p.icon}</div>
    <h1 data-page-title>${esc(p.title)}</h1>
  </section>
  <section class="section">
    <article class="doc content" data-page-body data-page="${p.id}">${body}</article>
  </section>`;
}

let currentPage = null;
function markActive() {
  nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.id === currentPage?.id));
  // Ouvre les groupes parents de la page active
  const active = nav.querySelector("a.active");
  for (let el = active?.parentElement; el && el !== nav; el = el.parentElement) {
    if (el.classList.contains("group")) el.classList.add("open");
  }
}

function route(keepScroll) {
  const id = decodeURIComponent(location.hash.slice(1)) || "accueil";
  // Ancre interne de l'accueil : on laisse le navigateur défiler
  if (id === "bienvenue" && $("#bienvenue")) return;
  // Pages spéciales (hors menu), déclarées par d'autres scripts : ex. « Gestion des officiers »
  const special = window.SPECIAL_PAGES?.[id];
  const page = special
    ? { id, title: special.title, icon: special.icon, trail: [], special: true }
    : PAGES[id] || PAGES.accueil || Object.values(PAGES)[0];
  currentPage = page;
  $("#app").innerHTML = special ? special.render(page) : page.id === "accueil" ? renderHome() : renderPage(page);
  if (!special) enhance($("#app"));
  document.title = special ? `${page.title} | Shock Trooper`
    : page.id === "accueil" ? `Shock Trooper | ${SITE_DATA.settings.siteName}` : `${page.title} | Shock Trooper`;
  if (keepScroll !== true) window.scrollTo(0, 0);
  markActive();
  document.dispatchEvent(new CustomEvent("page:rendered", { detail: page }));
}
window.addEventListener("hashchange", route);

// Redessine tout (utilisé par l'éditeur après une modification du menu ou des réglages)
function renderAll(keepScroll) {
  buildIndex();
  renderSettings();
  renderNav();
  route(keepScroll);
}
renderAll();

// ---------- Blocs dynamiques : table des matières, carrousels ----------
// Les éléments ajoutés ici portent data-gen : l'éditeur ne les enregistre pas.
function enhance(root) {
  root.querySelectorAll("[data-toc]").forEach((toc) => {
    const body = toc.closest("[data-page-body]") || root;
    const heads = [...body.querySelectorAll("h2, h3")].filter((h) => !h.closest("[data-toc]") && h.textContent.trim());
    heads.forEach((h, i) => { h.id = `titre-${i + 1}`; });
    toc.innerHTML = `<div data-gen><p class="toc-title">Sommaire</p><ul>${heads.map((h) =>
      `<li class="toc-${h.tagName.toLowerCase()}"><a href="#" data-target="${h.id}">${esc(h.textContent)}</a></li>`).join("")
    || "<li>Ajoute des titres à la page pour remplir le sommaire.</li>"}</ul></div>`;
  });
  root.querySelectorAll("[data-carousel]").forEach((c) => {
    if (!c.querySelector(":scope > [data-gen]")) {
      c.insertAdjacentHTML("beforeend",
        '<button class="car-btn car-prev" data-gen type="button" aria-label="Image précédente">‹</button>'
        + '<button class="car-btn car-next" data-gen type="button" aria-label="Image suivante">›</button>'
        + '<span class="car-count" data-gen></span>');
    }
    showCarImage(c, 0);   // on commence toujours par la première image
  });
}

// Affiche l'image n° i du carrousel (en boucle) et met à jour le compteur « 2 / 5 »
const carFigures = (c) => [...c.querySelectorAll(".car-track > figure")];
function showCarImage(c, i) {
  const figs = carFigures(c);
  const n = figs.length;
  if (n) {
    i = ((i % n) + n) % n;
    figs.forEach((f, k) => f.classList.toggle("car-on", k === i));
  }
  const count = c.querySelector(".car-count");
  if (count) count.textContent = n > 1 ? `${i + 1} / ${n}` : "";
}
function updateCarCount(c) {
  if (c) showCarImage(c, Math.max(0, carFigures(c).findIndex((f) => f.classList.contains("car-on"))));
}

$("#app").addEventListener("click", (e) => {
  const tocLink = e.target.closest("[data-target]");
  if (tocLink) {
    e.preventDefault();
    document.getElementById(tocLink.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const carBtn = e.target.closest(".car-btn");
  if (carBtn) {
    // Après la dernière image on revient à la première, et inversement
    const c = carBtn.closest("[data-carousel]");
    const cur = Math.max(0, carFigures(c).findIndex((f) => f.classList.contains("car-on")));
    showCarImage(c, cur + (carBtn.classList.contains("car-prev") ? -1 : 1));
  }
});

// Image absente : on affiche seulement la légende
document.addEventListener("error", (e) => {
  const fig = e.target.tagName === "IMG" && e.target.closest("figure");
  if (fig) fig.classList.add("missing");
}, true);

// ---------- Recherche ----------
const search = $("#search"), results = $("#search-results");
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
search.addEventListener("input", () => {
  const q = norm(search.value.trim());
  if (!q) { results.classList.remove("open"); return; }
  const hits = Object.values(PAGES).filter((p) => norm(p.title + " " + p.trail.join(" ")).includes(q));
  results.innerHTML = hits.length
    ? hits.map((p) => `<li><a href="#${p.id}">${p.icon} ${esc(p.title)}</a></li>`).join("")
    : '<li class="empty">Aucun résultat</li>';
  results.classList.add("open");
});
results.addEventListener("click", () => { search.value = ""; results.classList.remove("open"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) results.classList.remove("open"); });
