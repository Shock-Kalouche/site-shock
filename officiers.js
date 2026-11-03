// =========================================================
// Menu « Gestion » du pied de page + page « Gestion des officiers ».
//
// - La page est réservée au CMDM 1010 Fox, c'est-à-dire aux membres du serveur
//   Discord qui ont le rôle de gérant (voir auth.js).
// - Chaque ligne du tableau est un utilisateur Discord (son identifiant), chaque
//   colonne une page : on coche les pages que cet officier peut modifier.
// - La liste est gardée dans site-data.js (settings.officers) :
//     [{ "id": "123…", "name": "Pseudo", "pages": ["effectif", "guide-shock"] }]
//   « Enregistrer » écrit ce fichier dans le dossier du site (comme l'éditeur).
// - L'éditeur (editor.js) lit cette liste : un officier connecté avec Discord ne peut
//   modifier que les pages cochées.
// Rien n'est envoyé sur Internet ; la vérification se fait dans le navigateur.
// =========================================================
(function () {
  const PAGE_ID = "gestion-officiers";
  const byId = (id) => document.getElementById(id);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const editor = () => window.SHOCK_EDITOR;
  const isManager = () => !!window.SHOCK_USER?.manager;

  const list = () => {
    const s = SITE_DATA.settings;
    if (!Array.isArray(s.officers)) s.officers = [];
    return s.officers;
  };
  let dirty = false;
  let message = "";   // dernier message d'erreur du formulaire d'ajout

  // ---------- Droits (lus par l'éditeur) ----------
  const forUser = (u) => (u ? list().find((o) => o.id === String(u.id)) || null : null);
  // Pages (existantes) que cet utilisateur a le droit de modifier
  const pagesFor = (u) => (forUser(u)?.pages || []).filter((id) => PAGES[id]);
  window.SHOCK_OFFICERS = { forUser, pagesFor, get dirty() { return dirty; } };

  // ---------- Colonnes du tableau : pages générales, puis une section par groupe du menu ----------
  function columns() {
    const general = [], groups = [];
    for (const n of SITE_DATA.nav) {
      if (n.children) {
        const leaves = [];
        (function walk(arr) { for (const c of arr) { if (c.children) walk(c.children); else if (c.id) leaves.push(c); } })(n.children);
        if (leaves.length) groups.push({ title: n.title, icon: n.icon, pages: leaves });
      } else if (n.id) {
        general.push(n);
      }
    }
    return [{ title: "Pages générales", icon: "📄", pages: general }, ...groups].filter((g) => g.pages.length);
  }

  // ---------- Page ----------
  function shell(inner) {
    return `<section class="page-hero">
        <p class="breadcrumb"><a href="#accueil">Accueil</a> / Gestion / <span class="crumb-current">Gestion des officiers</span></p>
        <div class="ico">👥</div>
        <h1>Gestion des officiers</h1>
      </section>
      <section class="section"><article class="doc content off-page">${inner}</article></section>`;
  }

  function render() {
    const auth = window.SHOCK_AUTH;
    const u = window.SHOCK_USER;
    if (!u) {
      if (auth?.pending) return shell(`<p>Vérification de ta connexion Discord…</p>`);
      return shell(`<p class="off-lock">🔒 Cette page est réservée au <strong>CMDM 1010 Fox</strong>. Connecte-toi avec Discord pour y accéder.</p>
        ${auth?.available
          ? `<button type="button" class="off-btn off-primary" data-off-login>Se connecter avec Discord</button>`
          : `<p class="off-hint">La connexion Discord n'est pas disponible ici : ouvre le site avec <strong>lancer-le-site.bat</strong> et renseigne l'ID de l'application Discord (voir LISEZMOI.txt).</p>`}`);
    }
    if (!u.manager) {
      return shell(`<p class="off-lock">⛔ Accès refusé : cette page est réservée au <strong>CMDM 1010 Fox</strong>.</p>`);
    }

    const cols = columns();
    const pageIds = cols.flatMap((g) => g.pages.map((p) => p.id));
    const officers = list();

    const head = `
      <tr>
        <th class="off-user off-corner" rowspan="3">Officier<small>utilisateur Discord</small></th>
        <th class="off-top" colspan="${pageIds.length}">Peut modifier la page…</th>
      </tr>
      <tr>${cols.map((g) => `<th class="off-grp" colspan="${g.pages.length}">${g.icon} ${h(g.title)}</th>`).join("")}</tr>
      <tr>${cols.flatMap((g) => g.pages.map((p) => `<th class="off-page-th" title="${h(p.title)}"><span class="off-vert">${h(p.icon)} ${h(p.title)}</span></th>`)).join("")}</tr>`;

    const rows = officers.map((o) => `
      <tr data-off="${h(o.id)}">
        <th class="off-user" scope="row">
          <input class="off-name" data-off-name value="${h(o.name)}" placeholder="Nom / grade" aria-label="Nom de l'officier">
          <small>${h(o.id)}</small>
          <span class="off-row-actions">
            <button type="button" data-off-act="all" title="Cocher toutes les pages">Tout</button>
            <button type="button" data-off-act="none" title="Tout décocher">Aucun</button>
            <button type="button" data-off-act="remove" class="off-del" title="Retirer cet officier">🗑</button>
          </span>
        </th>
        ${pageIds.map((pid) => `<td><input type="checkbox" data-page="${h(pid)}" ${(o.pages || []).includes(pid) ? "checked" : ""}
          aria-label="${h(o.name || o.id)} peut modifier ${h(PAGES[pid]?.title || pid)}"></td>`).join("")}
      </tr>`).join("");

    return shell(`
      <p class="off-lead">Connecté en tant que <strong>${h(u.name)}</strong> — <span class="off-tag">1010 Fox</span></p>
      <p>Ajoute des utilisateurs Discord et coche les pages qu'ils ont le droit de modifier. Un officier connecté avec Discord pourra ensuite utiliser « Gestion → Modifier le site » : il n'aura accès qu'aux pages cochées pour lui.</p>

      <form class="off-add" autocomplete="off">
        <label>Identifiant Discord
          <input name="id" inputmode="numeric" placeholder="ex. 123456789012345678" required>
        </label>
        <label>Nom / grade (facultatif)
          <input name="name" placeholder="ex. CC Rex">
        </label>
        <button type="submit" class="off-btn off-primary">➕ Ajouter l'officier</button>
      </form>
      ${message ? `<p class="off-error">${h(message)}</p>` : ""}
      <p class="off-hint">Pour trouver un identifiant : Discord → Paramètres → Avancés → active le « Mode développeur », puis clic droit sur l'utilisateur → « Copier l'identifiant ».</p>

      <div class="off-bar">
        <button type="button" class="off-btn off-primary${dirty ? " pending" : ""}" data-off-save>💾 Enregistrer</button>
        <span class="off-status" id="off-status">${dirty ? "Modifications non enregistrées" : "Tout est enregistré"}</span>
      </div>

      ${officers.length
        ? `<div class="off-scroll"><table class="off-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
        : `<p class="off-empty">Aucun officier pour l'instant. Ajoute un identifiant Discord ci-dessus.</p>`}`);
  }

  window.SPECIAL_PAGES = window.SPECIAL_PAGES || {};
  window.SPECIAL_PAGES[PAGE_ID] = { title: "Gestion des officiers", icon: "👥", render };

  // Redessine la page en gardant la position de défilement du tableau
  function refresh() {
    const left = document.querySelector(".off-scroll")?.scrollLeft || 0;
    route(true);
    const sc = document.querySelector(".off-scroll");
    if (sc) sc.scrollLeft = left;
  }
  const onPage = () => !!window.SPECIAL_PAGES && currentPage?.id === PAGE_ID;
  function setDirty(v, text) {
    dirty = v;
    byId("off-status") && (byId("off-status").textContent = text || (v ? "Modifications non enregistrées" : "Tout est enregistré"));
    document.querySelector("[data-off-save]")?.classList.toggle("pending", v);
  }
  const officerOf = (el) => list().find((o) => o.id === el.closest("tr[data-off]")?.dataset.off);

  // ---------- Actions sur la page ----------
  const app = byId("app");

  app.addEventListener("submit", (e) => {
    const form = e.target.closest(".off-add");
    if (!form || !onPage() || !isManager()) return;
    e.preventDefault();
    const id = form.id.value.replace(/[<@!&>\s]/g, "");
    const name = form.name.value.trim();
    if (!/^\d{15,25}$/.test(id)) { message = "Identifiant invalide : c'est un nombre de 17 à 19 chiffres (pas le pseudo)."; return refresh(); }
    if (list().some((o) => o.id === id)) { message = "Cet utilisateur est déjà dans la liste."; return refresh(); }
    message = "";
    list().push({ id, name: name || "Officier " + id.slice(-4), pages: [] });
    setDirty(true);
    refresh();
  });

  app.addEventListener("change", (e) => {
    if (!onPage() || !isManager()) return;
    const box = e.target.closest("input[data-page]");
    if (!box) return;
    const o = officerOf(box);
    if (!o) return;
    const pid = box.dataset.page;
    const pages = new Set(o.pages || []);
    box.checked ? pages.add(pid) : pages.delete(pid);
    o.pages = [...pages];
    setDirty(true);
  });

  app.addEventListener("input", (e) => {
    if (!onPage() || !isManager()) return;
    const inp = e.target.closest("input[data-off-name]");
    if (!inp) return;
    const o = officerOf(inp);
    if (!o) return;
    o.name = inp.value;
    setDirty(true);
  });

  app.addEventListener("click", async (e) => {
    if (!onPage()) return;
    if (e.target.closest("[data-off-login]")) return window.SHOCK_AUTH?.login();
    if (!isManager()) return;

    if (e.target.closest("[data-off-save]")) {
      if (!editor()) return;
      const ok = await editor().saveSiteData("✅ Liste des officiers enregistrée dans site-data.js.");
      if (ok) { message = ""; setDirty(false); } else setDirty(true, "Échec de l'enregistrement");
      return;
    }
    const act = e.target.closest("[data-off-act]");
    if (!act) return;
    const o = officerOf(act);
    if (!o) return;
    if (act.dataset.offAct === "all") {
      o.pages = columns().flatMap((g) => g.pages.map((p) => p.id));
      setDirty(true); return refresh();
    }
    if (act.dataset.offAct === "none") {
      o.pages = [];
      setDirty(true); return refresh();
    }
    if (act.dataset.offAct === "remove") {
      const r = await editor().modal({
        title: "Retirer cet officier ?",
        html: `<p><strong>${h(o.name || o.id)}</strong> (${h(o.id)}) ne pourra plus modifier aucune page.</p>`,
        ok: "Retirer",
      });
      if (!r) return;
      SITE_DATA.settings.officers = list().filter((x) => x !== o);
      setDirty(true); refresh();
    }
  });

  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- Menu « Gestion » du pied de page ----------
  const toggle = byId("manage-toggle"), menu = byId("manage-menu"), officersBtn = byId("officers-open");

  function refreshMenu() {
    if (!officersBtn) return;
    const ok = isManager();
    // Le bouton « Gestion » n'existe que pour ceux qui ont accès : le CMDM 1010 Fox et les officiers de la liste
    let pages = [];
    try { pages = pagesFor(window.SHOCK_USER); }
    catch { pages = forUser(window.SHOCK_USER)?.pages || []; }   // le routeur (PAGES) n'est pas encore chargé
    const manage = byId("manage");
    if (manage) manage.hidden = !(ok || pages.length);
    if (manage?.hidden) closeMenu();
    // « Gestion des officiers » : seulement pour le CMDM 1010 Fox
    officersBtn.hidden = !ok;
  }
  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    toggle?.setAttribute("aria-expanded", "false");
  }
  toggle?.addEventListener("click", () => {
    refreshMenu();
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu?.addEventListener("click", () => closeMenu());
  document.addEventListener("click", (e) => { if (!e.target.closest(".manage")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  officersBtn?.addEventListener("click", () => {
    if (window.SHOCK_EDITOR?.isActive?.()) return window.SHOCK_EDITOR.toast("Quitte d'abord l'éditeur.", true);
    location.hash = "#" + PAGE_ID;
  });

  // Connexion / déconnexion / rôles chargés : on met à jour le menu et la page
  document.addEventListener("auth:change", () => {
    refreshMenu();
    let cur = null;
    try { cur = currentPage; } catch { /* le routeur n'est pas encore chargé */ }
    if (cur?.id === PAGE_ID) route(true);
  });
  document.addEventListener("page:rendered", refreshMenu);   // une fois le menu du site chargé (liste des pages connue)
  refreshMenu();
})();
