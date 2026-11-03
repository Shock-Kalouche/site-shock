// =========================================================
// Éditeur du site, façon Google Sites (version locale).
// - Accès : bouton « Modifier le site » en bas de page.
// - Les pages sont faites de rangées (.blk-row) contenant des blocs (.blk) :
//   zone de texte, image, intégration, bouton, carrousel… Chaque bloc se
//   sélectionne d'un clic, se glisse par sa bordure (ou ⠿), se redimensionne
//   par la poignée entre deux colonnes et se supprime avec la corbeille.
// - « Enregistrer » (ou Ctrl+S) écrit site-data.js, content.js et les nouvelles
//   images directement dans le dossier du site : aucun serveur, aucun compte.
//   (Chrome / Edge : le navigateur demande le dossier une fois.
//   Autres navigateurs : les fichiers sont téléchargés.)
// =========================================================
(() => {
  const MAX_COLUMNS = 4;
  // L'accès à l'éditeur passe uniquement par Discord (voir openEditor et officiers.js).
  // Ancien « code d'accès » : supprimé ; on retire sa trace des réglages au prochain enregistrement.
  delete SITE_DATA.settings.editCodeHash;

  const ed = {
    active: false,
    dirty: false,
    scope: null,      // null = tout le site ; sinon liste des pages que l'officier connecté peut modifier
    orig: null,       // copie de CONTENT à l'ouverture (mode officier)
    dir: null,        // dossier du site choisi pour l'enregistrement (en mémoire)
    uploads: {},      // chemin -> { blobUrl, blob, done }
    savedRange: null,
    activeRt: null,   // zone de texte en cours d'édition
    selected: null,   // bloc sélectionné
    targetFigure: null,
    imageTarget: null,
    lastSnap: "",
  };
  const hist = { undo: [], redo: [], typing: null };

  // ---------- Petits utilitaires ----------
  const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Enregistrement dans le dossier du site ----------
  // Le navigateur écrit directement les fichiers (Chrome, Edge…). Sans cette
  // possibilité (Firefox, Safari), les fichiers sont téléchargés à la place.
  const canWriteFolder = () => typeof window.showDirectoryPicker === "function";

  async function chooseFolder() {
    const dir = await window.showDirectoryPicker({ id: "site-shock", mode: "readwrite" });
    let isSite = true;
    try { await dir.getFileHandle("site-data.js"); } catch { isSite = false; }
    if (!isSite) {
      const r = await modal({
        title: "Ce dossier est-il bien celui du site ?",
        html: `<p>Le dossier « <strong>${esc(dir.name)}</strong> » ne contient pas de fichier <strong>site-data.js</strong>. Les fichiers risquent d'être créés au mauvais endroit.</p>`,
        ok: "Enregistrer ici quand même",
        cancel: "Choisir un autre dossier",
      });
      if (!r) return chooseFolder();
    }
    return dir;
  }
  async function ensureAccess(dir) {
    const opts = { mode: "readwrite" };
    if ((await dir.queryPermission(opts)) === "granted") return;
    if ((await dir.requestPermission(opts)) !== "granted") throw new Error("accès au dossier refusé");
  }
  async function writeFile(root, path, data) {
    const parts = path.split("/");
    const name = parts.pop();
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
  function downloadFile(name, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "text/javascript;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- Fichiers générés ----------
  function serializeSiteData() {
    return "// Données du site : réglages, page d'accueil et menu.\n"
      + "// Ce fichier est réécrit par l'éditeur du site (bouton « Modifier le site »).\n"
      + "const SITE_DATA = " + JSON.stringify(SITE_DATA, null, 2) + ";\n";
  }
  function serializeContent() {
    const tpl = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return "// Contenu des pages (rangées .blk-row de blocs .blk, modifiées avec l'éditeur).\n"
      + "// Les clés correspondent aux `id` des pages définies dans site-data.js.\n"
      + "const CONTENT = {\n"
      + Object.entries(CONTENT).filter(([, v]) => v).map(([k, v]) => `  ${JSON.stringify(k)}: \`\n${tpl(v.trim())}\n\`,\n`).join("\n")
      + "};\n";
  }

  // ---------- Fenêtres (modales) et notifications ----------
  function modal({ title, html, ok = "Valider", cancel = "Annuler", extra = "", wide = false, onOpen }) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "ed-modal-wrap";
      wrap.innerHTML = `<form class="ed-modal${wide ? " wide" : ""}" autocomplete="off">
        <h3>${title}</h3>
        <div class="ed-modal-body">${html}</div>
        <div class="ed-modal-actions">${extra}${cancel ? `<button type="button" class="ed-btn" data-v="cancel">${cancel}</button>` : ""}${ok ? `<button type="submit" class="ed-btn ed-primary">${ok}</button>` : ""}</div>
      </form>`;
      document.body.appendChild(wrap);
      const form = wrap.querySelector("form");
      const values = () => {
        const v = Object.fromEntries(new FormData(form));
        form.querySelectorAll("input[type=checkbox][name]").forEach((c) => { v[c.name] = c.checked; });
        return v;
      };
      const close = (v) => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") close(null); };
      document.addEventListener("keydown", onKey);
      form.addEventListener("submit", (e) => { e.preventDefault(); close(values()); });
      wrap.addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (b) close(b.dataset.v === "cancel" ? null : { ...values(), _action: b.dataset.v });
      });
      onOpen?.(form);
      setTimeout(() => form.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea")?.focus(), 30);
    });
  }

  let toastTimer;
  function toast(msg, isError) {
    let t = document.getElementById("ed-toast");
    if (!t) { t = document.createElement("div"); t.id = "ed-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ""), isError ? 8000 : 4500);
  }

  function markDirty() {
    ed.dirty = true;
    document.querySelector('#ed-bar [data-act="publish"]')?.classList.add("pending");
    setStatus("Modifications non enregistrées");
  }
  function setStatus(text) {
    const s = document.getElementById("ed-status");
    if (s) s.textContent = text;
  }


  // ---------- Accès à l'éditeur : uniquement par Discord ----------
  // Un officier (voir officiers.js) ne modifie que les pages qui lui sont attribuées
  const canEditPage = (id) => !ed.scope || ed.scope.includes(id);

  async function openEditor() {
    if (ed.active) return;
    const user = window.SHOCK_USER;
    const auth = window.SHOCK_AUTH;
    // Le CMDM 1010 Fox (rôle de gérant Discord) : accès complet
    if (user?.manager) { ed.scope = null; return startEditing(); }
    // Un officier de la liste : seulement les pages que le CMDM lui a cochées
    const pages = window.SHOCK_OFFICERS?.pagesFor(user) || [];
    if (pages.length) { ed.scope = pages; return startEditing(); }
    // Tous les autres (connectés ou non) : pas d'accès
    ed.scope = null;
    if (auth?.pending) return toast("Vérification de ta connexion Discord… réessaie dans un instant.");
    if (!user) {
      const canLogin = !!auth?.available;
      const r = await modal({
        title: "🔒 Accès réservé",
        html: `<p>Seuls le CMDM 1010 Fox et les officiers qu'il a désignés peuvent modifier le site. Connecte-toi avec Discord pour vérifier tes droits.</p>
          ${canLogin ? "" : `<p class="ed-hint">La connexion Discord n'est pas disponible ici : ouvre le site avec lancer-le-site.bat (voir LISEZMOI.txt).</p>`}`,
        ok: canLogin ? "Se connecter avec Discord" : "",
        cancel: canLogin ? "Annuler" : "Fermer",
      });
      if (r) auth.login();
      return;
    }
    await modal({
      title: "⛔ Accès refusé",
      html: `<p>Tu es connecté en tant que <strong>${esc(user.name)}</strong>, mais tu n'as pas la permission de modifier le site. Demande au CMDM 1010 Fox de t'ajouter à la liste des officiers.</p>`,
      ok: "",
      cancel: "Fermer",
    });
  }

  function startEditing() {
    // On revient sur une vraie page si on est sur « Gestion des officiers » ou sur une page non autorisée
    const cur = currentPage;
    if (cur?.special || !canEditPage(cur?.id)) location.hash = "#" + (ed.scope ? ed.scope[0] : "accueil");
    ed.orig = ed.scope ? { ...CONTENT } : null;
    enterEditMode();
    if (ed.scope) toast(`Mode officier : tu peux modifier ${ed.scope.length} page${ed.scope.length > 1 ? "s" : ""}.`);
  }

  // Écrit seulement site-data.js (réglages, menu, liste des officiers) dans le dossier du site
  async function saveSiteData(okMsg = "✅ Enregistré dans site-data.js.") {
    try {
      const text = serializeSiteData();
      if (canWriteFolder()) {
        if (!ed.dir) ed.dir = await chooseFolder(); else await ensureAccess(ed.dir);
        await writeFile(ed.dir, "site-data.js", text);
        toast(okMsg);
      } else {
        downloadFile("site-data.js", text);
        toast("📥 Remplace site-data.js dans le dossier du site par le fichier téléchargé.");
      }
      return true;
    } catch (err) {
      if (err.name !== "AbortError") ed.dir = null;
      toast(err.name === "AbortError" ? "Annulé : rien n'a été enregistré." : `❌ Enregistrement impossible : ${err.message}`, true);
      return false;
    }
  }
  // Utilisé par officiers.js (page « Gestion des officiers »)
  window.SHOCK_EDITOR = { saveSiteData, modal, toast, isActive: () => ed.active };


  // =========================================================
  // Modèle de blocs
  // =========================================================
  const EMPTY_FIG = `<figure class="doc-img img-empty"><span class="img-empty-label">🖼️ Cliquer pour ajouter une image</span></figure>`;
  const B = {
    text: (html = "<p><br></p>", grow) => `<div class="blk blk-text"${grow ? ` style="flex-grow:${grow}"` : ""}>${html}</div>`,
    image: (inner = EMPTY_FIG, grow) => `<div class="blk blk-image"${grow ? ` style="flex-grow:${grow}"` : ""}>${inner}</div>`,
    card: () => `<div class="blk blk-card">${EMPTY_FIG}<div class="card-body rt"><h3>Titre</h3><p>Ton texte ici.</p></div></div>`,
    media: () => `<div class="blk blk-media">${EMPTY_FIG}<div class="media-body rt"><h4>Titre</h4><p>Ton texte ici.</p></div></div>`,
    imgstack: () => `<div class="blk blk-imgstack">${EMPTY_FIG}${EMPTY_FIG}</div>`,
    divider: () => `<div class="blk blk-divider"><hr></div>`,
    spacer: (h = 60) => `<div class="blk blk-spacer"><div class="spacer" style="height:${h}px"></div></div>`,
    // Le groupe réductible contient des rangées de blocs (texte, images, intégrations…)
    collapse: (title) => `<div class="blk blk-collapse"><details class="collapse"><summary>${esc(title)}</summary><div class="collapse-body">${row(B.text("<p>Contenu du groupe…</p>"))}</div></details></div>`,
    zone: (inner = "") => `<section class="zone">${inner}</section>`,
    toc: () => `<div class="blk blk-toc"><nav class="toc" data-toc></nav></div>`,
    placeholder: () => `<div class="blk blk-placeholder-blk"><div class="blk-placeholder">➕ Espace réservé : clique pour y mettre une image ou un contenu intégré</div></div>`,
  };
  const row = (...blocks) => `<div class="blk-row">${blocks.join("")}</div>`;

  const LAYOUTS = [
    { name: "Image + texte", html: () => row(B.image(EMPTY_FIG, 1), B.text("<h3>Titre</h3><p>Ton texte ici.</p>", 2)),
      svg: '<rect x="4" y="12" width="34" height="36" rx="2"/><path d="M12 40l7-9 5 6 4-4 6 7z" class="m"/><rect x="46" y="16" width="40" height="4"/><rect x="46" y="26" width="36" height="3"/><rect x="46" y="33" width="38" height="3"/><rect x="46" y="40" width="30" height="3"/>' },
    { name: "2 colonnes image + texte", html: () => row(B.card(), B.card()),
      svg: '<rect x="4" y="6" width="38" height="26" rx="2"/><rect x="48" y="6" width="38" height="26" rx="2"/><rect x="4" y="38" width="30" height="3"/><rect x="4" y="45" width="36" height="3"/><rect x="48" y="38" width="30" height="3"/><rect x="48" y="45" width="36" height="3"/>' },
    { name: "2 petites images + 1 grande", html: () => row(B.imgstack(), B.image(EMPTY_FIG, 2)),
      svg: '<rect x="4" y="6" width="24" height="22" rx="2"/><rect x="4" y="32" width="24" height="22" rx="2"/><rect x="34" y="6" width="52" height="48" rx="2"/>' },
    { name: "3 colonnes image + texte", html: () => row(B.card(), B.card(), B.card()),
      svg: '<rect x="4" y="8" width="24" height="20" rx="2"/><rect x="33" y="8" width="24" height="20" rx="2"/><rect x="62" y="8" width="24" height="20" rx="2"/><rect x="4" y="34" width="22" height="3"/><rect x="33" y="34" width="22" height="3"/><rect x="62" y="34" width="22" height="3"/><rect x="4" y="41" width="18" height="3"/><rect x="33" y="41" width="18" height="3"/><rect x="62" y="41" width="18" height="3"/>' },
    { name: "2 × image à côté du texte", html: () => row(B.media(), B.media()),
      svg: '<rect x="4" y="20" width="16" height="18" rx="2"/><rect x="24" y="22" width="18" height="3"/><rect x="24" y="29" width="14" height="3"/><rect x="48" y="20" width="16" height="18" rx="2"/><rect x="68" y="22" width="18" height="3"/><rect x="68" y="29" width="14" height="3"/>' },
    { name: "4 colonnes image + texte", html: () => row(B.card(), B.card(), B.card(), B.card()),
      svg: '<rect x="4" y="14" width="17" height="16" rx="2"/><rect x="26" y="14" width="17" height="16" rx="2"/><rect x="48" y="14" width="17" height="16" rx="2"/><rect x="70" y="14" width="17" height="16" rx="2"/><rect x="4" y="36" width="15" height="3"/><rect x="26" y="36" width="15" height="3"/><rect x="48" y="36" width="15" height="3"/><rect x="70" y="36" width="15" height="3"/>' },
  ];

  // Intégrations : conversion du lien collé en adresse intégrable + lien « Ouvrir »
  const EMBEDS = {
    youtube: { label: "YouTube", icon: "▶️", cls: "video", field: "Lien de la vidéo YouTube",
      conv(u) { const m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/); return m && { src: `https://www.youtube.com/embed/${m[1]}`, open: `https://www.youtube.com/watch?v=${m[1]}` }; } },
    calendar: { label: "Agenda", icon: "📅", cls: "calendar", field: "Lien « Intégrer » de Google Agenda ou adresse de l'agenda public",
      hint: "Dans Google Agenda : paramètres de l'agenda → « Intégrer l'agenda » → copie l'URL publique. L'agenda doit être public.",
      conv(u) {
        if (/calendar\.google\.com\/calendar\/(u\/\d+\/)?embed/.test(u)) return { src: u, open: u };
        if (/^[^\s@]+@[^\s@]+$/.test(u)) { const src = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(u)}&ctz=Europe%2FParis`; return { src, open: src }; }
        return null;
      } },
    map: { label: "Carte", icon: "📍", cls: "map", field: "Adresse ou lieu", plain: true,
      conv(q) { return q && { src: `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, open: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` }; } },
    docs: { label: "Docs", icon: "📄", cls: "", field: "Lien du Google Doc",
      conv(u) { const m = u.match(/docs\.google\.com\/document\/d\/(e\/)?([\w-]+)/); return m && (m[1]
        ? { src: `https://docs.google.com/document/d/e/${m[2]}/pub?embedded=true`, open: `https://docs.google.com/document/d/e/${m[2]}/pub` }
        : { src: `https://docs.google.com/document/d/${m[2]}/preview`, open: `https://docs.google.com/document/d/${m[2]}/edit` }); } },
    slides: { label: "Présentations", icon: "🖥️", cls: "slides", field: "Lien de la présentation Google Slides",
      conv(u) { const m = u.match(/docs\.google\.com\/presentation\/d\/(e\/)?([\w-]+)/); return m && (m[1]
        ? { src: `https://docs.google.com/presentation/d/e/${m[2]}/embed?start=false&loop=false`, open: `https://docs.google.com/presentation/d/e/${m[2]}/pub` }
        : { src: `https://docs.google.com/presentation/d/${m[2]}/embed?start=false&loop=false`, open: `https://docs.google.com/presentation/d/${m[2]}/edit` }); } },
    sheets: { label: "Feuilles de calcul", icon: "📊", cls: "", field: "Lien du Google Sheets",
      conv(u) { const m = u.match(/docs\.google\.com\/spreadsheets\/d\/(e\/)?([\w-]+)/); return m && (m[1]
        ? { src: `https://docs.google.com/spreadsheets/d/e/${m[2]}/pubhtml?widget=true&headers=false`, open: `https://docs.google.com/spreadsheets/d/e/${m[2]}/pubhtml` }
        : { src: `https://docs.google.com/spreadsheets/d/${m[2]}/htmlembed`, open: `https://docs.google.com/spreadsheets/d/${m[2]}/edit` }); } },
    forms: { label: "Formulaires", icon: "📝", cls: "", field: "Lien du Google Forms (docs.google.com/forms/d/e/…)",
      hint: "Utilise le lien d'envoi complet : bouton « Envoyer » → onglet lien → décoche « Raccourcir l'URL ».",
      conv(u) { const m = u.match(/docs\.google\.com\/forms\/d\/e\/([\w-]+)/); return m && { src: `https://docs.google.com/forms/d/e/${m[1]}/viewform?embedded=true`, open: `https://docs.google.com/forms/d/e/${m[1]}/viewform` }; } },
    charts: { label: "Graphiques", icon: "📈", cls: "chart", field: "Lien du graphique publié",
      hint: "Dans Google Sheets : clique sur le graphique → ⋮ → « Publier le graphique » → « Intégrer » → copie le lien (src).",
      conv(u) { const src = (u.match(/src="([^"]+)"/) || [])[1] || u; return /^https:\/\/docs\.google\.com\/spreadsheets\//.test(src) && { src, open: src }; } },
    generic: { label: "Intégrer", icon: "🧩", cls: "", field: "Lien (https://…) ou code d'intégration <iframe>",
      conv(u) { const src = (u.match(/<iframe[^>]+src="([^"]+)"/i) || [])[1] || u; return /^https:\/\//.test(src) && { src, open: src }; } },
  };
  const SOCIALS = ["Discord", "YouTube", "Twitch", "TikTok", "Instagram", "X", "Facebook", "Steam", "Site web"];

  // Trouve l'adresse intégrable ; avec « Intégrer », un lien YouTube, Docs, Sheets… est reconnu automatiquement
  function resolveEmbed(kind, raw) {
    if (kind === "generic") {
      const src = (raw.match(/<iframe[^>]+src="([^"]+)"/i) || [])[1] || raw;
      const guess = guessEmbedKind(src);
      if (guess !== "generic" && guess !== "map") {
        const conv = EMBEDS[guess].conv(src);
        if (conv) return { kind: guess, conv };
      }
    }
    const conv = EMBEDS[kind].conv(raw);
    return conv ? { kind, conv } : null;
  }

  const embedBlockHtml = (kind0, raw, title, showOpen) => {
    const found = resolveEmbed(kind0, raw.trim());
    if (!found) return null;
    const { kind, conv } = found, k = EMBEDS[kind];
    const t = title.trim() || k.label;
    return `<div class="blk blk-embed"><div class="embed ${k.cls}" data-kind="${kind}" data-url="${esc(raw.trim())}" data-title="${esc(t)}">`
      + `<iframe src="${esc(conv.src)}" title="${esc(t)}" loading="lazy" allowfullscreen></iframe>`
      + (showOpen ? `<a class="embed-open" href="${esc(conv.open)}" target="_blank" rel="noopener">↗ Ouvrir ${esc(t)}</a>` : "")
      + `</div></div>`;
  };
  // Devine le type d'une intégration reprise de l'ancien site
  function guessEmbedKind(src) {
    if (/youtube\.com/.test(src)) return "youtube";
    if (/\/document\//.test(src)) return "docs";
    if (/\/presentation\//.test(src)) return "slides";
    if (/\/forms\//.test(src)) return "forms";
    if (/\/spreadsheets\//.test(src)) return "sheets";
    if (/calendar\.google/.test(src)) return "calendar";
    if (/google\.com\/maps/.test(src)) return "map";
    return "generic";
  }

  // Ancien contenu (sections de l'ancien site, Docs convertis) → rangées de blocs
  function legacyType(n) {
    if (n.matches(".embed")) return "embed";
    if (n.matches(".gallery")) return "gallery";
    if (n.matches("figure")) return "image";
    if (n.matches(".link-card")) return "linkcard";
    if (n.matches("hr")) return "divider";
    const btn = n.matches("p") && n.querySelector(".btn");
    if (btn && n.textContent.trim() === btn.textContent.trim()) return "button";
    return "text";
  }
  // Contenu enregistré → zones (<section class="zone">) contenant des rangées de blocs
  function migrate(html) {
    const src = document.createElement("div");
    src.innerHTML = html;
    if (![...src.childNodes].some((n) => n.nodeType === 1 || n.textContent.trim())) return "";
    // Anciens groupes réductibles (texte seul) : leur contenu devient une zone de texte
    src.querySelectorAll(".collapse-body.rt").forEach((cb) => {
      cb.classList.remove("rt");
      cb.innerHTML = row(B.text(cb.innerHTML.trim() || "<p><br></p>"));
    });
    const kids = [...src.children];
    if (kids.every((c) => c.classList.contains("zone"))) return src.innerHTML;
    if (kids.every((c) => c.classList.contains("blk-row"))) return B.zone(src.innerHTML);
    const rows = [];
    let buf = [];
    const flush = () => {
      const h = buf.map((n) => (n.nodeType === 3 ? esc(n.textContent) : n.outerHTML)).join("").trim();
      if (h) rows.push(B.text(h));
      buf = [];
    };
    const walk = (parent) => {
      for (const n of [...parent.childNodes]) {
        if (n.nodeType === 3) { if (n.textContent.trim()) buf.push(n); continue; }
        if (n.nodeType !== 1) continue;
        if (n.matches(".gs-section, .gdoc")) { flush(); walk(n); flush(); continue; }
        const t = legacyType(n);
        if (t === "text") { buf.push(n); continue; }
        flush();
        rows.push(`<div class="blk blk-${t}">${n.outerHTML}</div>`);
      }
    };
    walk(src);
    flush();
    return B.zone(rows.map((b) => row(b)).join("\n"));
  }

  const blockType = (blk) => ([...blk.classList].find((c) => c.startsWith("blk-")) || "blk-text").slice(4);
  const TYPE_LABELS = {
    text: "Zone de texte", image: "Image", card: "Image + texte", media: "Image + texte", imgstack: "Images",
    embed: "Contenu intégré", button: "Bouton", divider: "Séparateur", spacer: "Espace vide", collapse: "Groupe réductible",
    toc: "Table des matières", carousel: "Carrousel", social: "Réseaux sociaux", "placeholder-blk": "Espace réservé",
    gallery: "Galerie", linkcard: "Lien",
  };
  const EDITABLE_TYPES = ["image", "card", "media", "imgstack", "gallery", "embed", "button", "spacer", "carousel", "social", "placeholder-blk", "linkcard"];

  // =========================================================
  // Mode édition : barre d'outils
  // =========================================================
  const FONTS = [
    ["Rajdhani", "Rajdhani (texte du site)"], ["Orbitron", "Orbitron (titres du site)"],
    ["Arial", "Arial"], ["Verdana", "Verdana"], ["Trebuchet MS", "Trebuchet MS"], ["Georgia", "Georgia"],
    ["Times New Roman", "Times New Roman"], ["Courier New", "Courier New"], ["Impact", "Impact"],
  ];
  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
  const COLORS = ["#ffffff", "#f4f4f4", "#a3a3ad", "#5c5c66", "#000000", "#d7191f", "#ff5a5f", "#9e0f14", "#ffb020", "#ffd84d", "#3ecf6e", "#2fa4ff", "#7b61ff", "#ff7ad9"];

  const BAR_HTML = `
    <div class="ed-bar-top">
      <div class="ed-left"><strong>✏️ Édition</strong><span id="ed-status"></span></div>
      <label class="ed-goto">Page :
        <select id="ed-goto" title="Aller à une autre page"></select>
      </label>
      <div class="ed-right">
        <button class="ed-btn" data-act="insert">➕ Insérer</button>
        <button class="ed-btn" data-act="pages">📄 Pages</button>
        <button class="ed-btn" data-act="settings">⚙️ Réglages</button>
        <button class="ed-btn ed-primary" data-act="publish" title="Enregistrer dans le dossier du site (Ctrl+S)">Enregistrer</button>
        <button class="ed-btn" data-act="quit">Quitter</button>
      </div>
    </div>
    <div class="ed-tools" id="ed-tools">
      <select id="ed-block" title="Style du paragraphe">
        <option value="p">Paragraphe</option>
        <option value="h2">Titre</option>
        <option value="h3">Sous-titre</option>
        <option value="h4">Petit titre</option>
      </select>
      <select id="ed-font" title="Police d'écriture">
        <option value="">Police</option>
        ${FONTS.map(([f, l]) => `<option value="${f}" style="font-family:'${f}'">${l}</option>`).join("")}
      </select>
      <select id="ed-size" title="Taille du texte">
        <option value="">Taille</option>
        ${SIZES.map((s) => `<option value="${s}">${s} px</option>`).join("")}
      </select>
      <input id="ed-size-custom" type="number" min="6" max="200" step="1" placeholder="px" title="Taille personnalisée (en px) : écris un nombre puis Entrée">
      <button data-act="color" title="Couleur du texte" class="ed-color-btn">A<span id="ed-color-sample"></span></button>
      <span class="ed-sep"></span>
      <button data-cmd="bold" title="Gras (Ctrl+B)"><b>G</b></button>
      <button data-cmd="italic" title="Italique (Ctrl+I)"><i>I</i></button>
      <button data-cmd="underline" title="Souligné (Ctrl+U)"><u>S</u></button>
      <button data-cmd="strikeThrough" title="Barré"><s>B</s></button>
      <span class="ed-sep"></span>
      <button data-cmd="justifyLeft" title="Aligner à gauche">⇤</button>
      <button data-cmd="justifyCenter" title="Centrer">⇔</button>
      <button data-cmd="justifyRight" title="Aligner à droite">⇥</button>
      <button data-cmd="insertUnorderedList" title="Liste à puces">• ≡</button>
      <button data-cmd="insertOrderedList" title="Liste numérotée">1.≡</button>
      <span class="ed-sep"></span>
      <button data-act="link" title="Lien">🔗</button>
      <button data-cmd="removeFormat" title="Effacer la mise en forme">⌫</button>
      <button data-act="undo" title="Annuler (Ctrl+Z)">↶</button>
      <button data-act="redo" title="Rétablir (Ctrl+Y)">↷</button>
    </div>`;

  let bar, blockTools, fileInput, resizeObs, colorPop, linkTip, dropLine, ghost;

  function enterEditMode() {
    ed.active = true;
    document.body.classList.add("editing");

    bar = document.createElement("div");
    bar.id = "ed-bar";
    bar.innerHTML = BAR_HTML;
    document.body.appendChild(bar);
    resizeObs = new ResizeObserver(() => document.documentElement.style.setProperty("--ed-h", bar.offsetHeight + "px"));
    resizeObs.observe(bar);

    // Les boutons de la barre ne doivent pas faire perdre la sélection du texte
    bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    bar.addEventListener("click", onBarClick);
    bar.querySelector("#ed-block").addEventListener("change", (e) => {
      if (!restoreRange()) return;
      document.execCommand("formatBlock", false, `<${e.target.value}>`);
      afterTextCommand();
    });
    bar.querySelector("#ed-font").addEventListener("change", (e) => {
      const f = e.target.value;
      e.target.value = "";
      if (f) styleSelection("fontName", f, (el) => { el.style.fontFamily = `'${f}'`; });
    });
    bar.querySelector("#ed-size").addEventListener("change", (e) => {
      const s = e.target.value;
      e.target.value = "";
      if (s) styleSelection("fontSize", "7", (el) => { el.style.fontSize = `${s}px`; });
    });
    // Taille personnalisée : appliquée avec Entrée ou en quittant le champ
    const sizeInput = bar.querySelector("#ed-size-custom");
    const applyCustomSize = () => {
      const s = Math.round(parseFloat(sizeInput.value));
      if (!s || s === +sizeInput.dataset.cur) return;
      const px = Math.max(6, Math.min(200, s));
      sizeInput.value = sizeInput.dataset.cur = px;
      styleSelection("fontSize", "7", (el) => { el.style.fontSize = `${px}px`; });
    };
    sizeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustomSize(); } });
    sizeInput.addEventListener("change", applyCustomSize);
    bar.querySelector("#ed-goto").addEventListener("change", (e) => { location.hash = e.target.value; });
    if (ed.scope) {
      // Mode officier : pas de gestion des pages ni des réglages du site
      bar.querySelectorAll('[data-act="pages"], [data-act="settings"]').forEach((b) => b.remove());
      bar.querySelector(".ed-left strong").textContent = "✏️ Édition (officier)";
    }

    blockTools = document.createElement("div");
    blockTools.id = "ed-blk-tools";
    blockTools.addEventListener("mousedown", (e) => e.preventDefault());
    blockTools.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-bt=drag]") && ed.selected) startDrag(ed.selected, e);
    });
    blockTools.addEventListener("click", onBlockTool);
    document.body.appendChild(blockTools);

    colorPop = document.createElement("div");
    colorPop.id = "ed-color-pop";
    colorPop.innerHTML = `<p>Couleur du texte</p><div class="ed-swatches" data-mode="foreColor">${COLORS.map((c) => `<button style="background:${c}" data-color="${c}" title="${c}"></button>`).join("")}</div>
      <p>Surlignage</p><div class="ed-swatches" data-mode="hiliteColor"><button class="ed-none" data-color="transparent" title="Aucun">✕</button>${COLORS.slice(4).map((c) => `<button style="background:${c}" data-color="${c}" title="${c}"></button>`).join("")}</div>
      <label>Autre couleur <input type="color" value="#d7191f"></label>`;
    colorPop.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    colorPop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      applyColor(b.closest("[data-mode]").dataset.mode, b.dataset.color);
    });
    colorPop.querySelector("input").addEventListener("change", (e) => applyColor("foreColor", e.target.value));
    document.body.appendChild(colorPop);

    linkTip = document.createElement("div");
    linkTip.id = "ed-link-tip";
    linkTip.addEventListener("mousedown", (e) => e.preventDefault());
    linkTip.addEventListener("click", onLinkTip);
    document.body.appendChild(linkTip);

    createImgFrame();

    dropLine = document.createElement("div");
    dropLine.id = "ed-drop";
    document.body.appendChild(dropLine);

    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", onImagesChosen);
    document.body.appendChild(fileInput);

    setStatus("");
    if (innerWidth >= 1100) togglePanel("insert");
    applyEditable();
  }

  async function exitEditMode() {
    if (ed.dirty) {
      const r = await modal({
        title: "Modifications non enregistrées",
        html: "<p>Tu as des modifications qui ne sont pas encore enregistrées.</p>",
        ok: "Enregistrer et quitter",
        cancel: "Continuer à modifier",
        extra: `<button type="button" class="ed-btn ed-danger" data-v="discard">Abandonner</button>`,
      });
      if (!r) return;
      if (r._action === "discard") { ed.dirty = false; location.reload(); return; }
      if (!(await publish())) return;
    }
    ed.active = false;
    ed.scope = null; ed.orig = null;
    document.body.classList.remove("editing", "ed-panel-open");
    resizeObs.disconnect();
    [bar, blockTools, fileInput, colorPop, linkTip, dropLine, imgFrame, sideMenu].forEach((el) => el?.remove());
    sideMenu = null;
    document.getElementById("ed-panel")?.remove();
    panelMode = null;
    document.documentElement.style.removeProperty("--ed-h");
    renderAll(true);
  }

  async function onBarClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cmd) {
      if (!restoreRange()) return;
      document.execCommand("styleWithCSS", false, false);
      document.execCommand(b.dataset.cmd, false, null);
      afterTextCommand();
      return;
    }
    switch (b.dataset.act) {
      case "color": return toggleColorPop(b);
      case "link": return insertLink();
      case "undo": return undo();
      case "redo": return redo();
      case "insert": return togglePanel("insert");
      case "pages": return togglePanel("pages");
      case "settings": return togglePanel("settings");
      case "publish": return publish();
      case "quit": return exitEditMode();
    }
  }

  function fillGoto() {
    const sel = document.getElementById("ed-goto");
    if (!sel) return;
    const pages = Object.values(PAGES).filter((p) => canEditPage(p.id));
    const locked = currentPage && !canEditPage(currentPage.id)
      ? `<option value="${currentPage.id}" selected>🔒 ${esc(currentPage.title)} (lecture seule)</option>` : "";
    sel.innerHTML = locked + pages.map((p) =>
      `<option value="${p.id}"${p.id === currentPage?.id ? " selected" : ""}>${(ed.scope ? "" : "\u00a0\u00a0".repeat(p.trail.length))}${p.icon} ${esc(p.title)}</option>`).join("");
  }

  // ---------- Texte : sélection, polices, tailles, couleurs ----------
  const bodyEl = () => document.querySelector("#app [data-page-body]");
  const rtOf = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const rt = el?.closest?.(".rt, .blk-text");
    return rt && bodyEl()?.contains(rt) ? rt : null;
  };
  function saveRange() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const rt = rtOf(sel.anchorNode);
    if (rt) { ed.savedRange = sel.getRangeAt(0).cloneRange(); ed.activeRt = rt; }
  }
  function restoreRange() {
    const rt = ed.activeRt;
    if (!rt || !rt.isConnected) { toast("Clique d'abord dans une zone de texte.", true); return false; }
    rt.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    if (ed.savedRange && rt.contains(ed.savedRange.startContainer)) sel.addRange(ed.savedRange);
    else { const r = document.createRange(); r.selectNodeContents(rt); r.collapse(false); sel.addRange(r); }
    return true;
  }
  document.addEventListener("selectionchange", () => {
    if (!ed.active) return;
    saveRange();
    const sel = getSelection();
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const block = rtOf(node) && node.closest("p, h2, h3, h4, li");
    const select = document.getElementById("ed-block");
    if (select && block) select.value = block.tagName === "LI" ? "p" : block.tagName.toLowerCase();
    // Le champ de taille affiche la taille du texte sélectionné
    const size = document.getElementById("ed-size-custom");
    if (size && rtOf(node) && document.activeElement !== size) {
      let el = node;
      const rg = sel.rangeCount && sel.getRangeAt(0);
      const first = rg && rg.startContainer.nodeType === 1 && rg.startContainer.childNodes[rg.startOffset];
      if (first) el = first.nodeType === 1 ? first : first.parentElement;
      size.value = size.dataset.cur = Math.round(parseFloat(getComputedStyle(el).fontSize));
    }
  });

  // Applique une police ou une taille : la commande crée des <font>, remplacés par des <span style>
  function styleSelection(cmd, value, setStyle) {
    if (!restoreRange()) return;
    if (getSelection().isCollapsed) return toast("Sélectionne d'abord le texte à modifier.", true);
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(cmd, false, value);
    reselect(fontsToSpans(ed.activeRt, setStyle));
    afterTextCommand();
  }
  // Garde le texte sélectionné après une mise en forme, pour enchaîner taille, police, couleur…
  function reselect(spans) {
    if (!spans.length) return saveRange();
    const r = document.createRange();
    r.setStartBefore(spans[0]);
    r.setEndAfter(spans[spans.length - 1]);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    ed.savedRange = r.cloneRange();
  }
  function fontsToSpans(root, setStyle) {
    const created = [];
    root.querySelectorAll("font").forEach((f) => {
      const span = document.createElement("span");
      span.append(...f.childNodes);
      // Le nouveau style remplace celui du texte sélectionné
      const clear = (prop) => span.querySelectorAll("span").forEach((s) => { s.style[prop] = ""; });
      if (f.getAttribute("color")) { clear("color"); span.style.color = f.getAttribute("color"); }
      if (f.getAttribute("face")) { clear("fontFamily"); span.style.fontFamily = f.getAttribute("face").split(",").map((x) => `'${x.trim().replace(/['"]/g, "")}'`).join(", "); }
      if (f.getAttribute("size") === "7" && setStyle) { clear("fontSize"); setStyle(span); }
      span.querySelectorAll('span[style=""]').forEach((s) => s.replaceWith(...s.childNodes));
      f.replaceWith(span);
      created.push(span);
    });
    return created;
  }
  function applyColor(mode, color) {
    colorPop.classList.remove("open");
    if (!restoreRange()) return;
    if (getSelection().isCollapsed) return toast("Sélectionne d'abord le texte à colorer.", true);
    if (mode === "foreColor") {
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("foreColor", false, color);
      reselect(fontsToSpans(ed.activeRt));
    } else {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("hiliteColor", false, color);
      document.execCommand("styleWithCSS", false, false);
      saveRange();
    }
    document.getElementById("ed-color-sample").style.background = mode === "foreColor" ? color : "";
    afterTextCommand();
  }
  function toggleColorPop(btn) {
    saveRange();
    const r = btn.getBoundingClientRect();
    colorPop.style.top = `${r.bottom + 6}px`;
    colorPop.style.left = `${Math.min(r.left, innerWidth - 250)}px`;
    colorPop.classList.toggle("open");
  }
  function afterTextCommand() {
    updateEmpty(ed.activeRt);
    sync();
  }

  // ---------- Liens dans le texte ----------
  function destinationFields(current = "") {
    const pages = Object.values(PAGES).map((p) =>
      `<option value="#${p.id}"${current === "#" + p.id ? " selected" : ""}>${p.icon} ${esc(p.title)}</option>`).join("");
    const isUrl = current && !current.startsWith("#");
    return `<label>Destination
        <select name="dest"><option value="__url"${isUrl || !current ? " selected" : ""}>Adresse web (ci-dessous)</option>${pages}</select>
      </label>
      <label>Adresse web<input name="url" placeholder="https://…" value="${isUrl ? esc(current) : ""}"></label>`;
  }
  const destOf = (r) => (r.dest === "__url" ? r.url.trim() : r.dest);
  const linkAttrs = (href) => (href.startsWith("#") ? `href="${esc(href)}"` : `href="${esc(href)}" target="_blank" rel="noopener"`);

  async function insertLink(existing) {
    if (!existing && !restoreRange()) return;
    const range = ed.savedRange;
    const text = existing ? existing.textContent : (range ? range.toString() : "");
    const r = await modal({
      title: existing ? "🔗 Modifier le lien" : "🔗 Insérer un lien",
      html: `<label>Texte du lien<input name="text" value="${esc(text)}" required></label>${destinationFields(existing?.getAttribute("href") || "")}`,
    });
    if (!r) return;
    const href = destOf(r);
    if (!href) return toast("Choisis une page ou indique une adresse web.", true);
    pushHistory();
    if (existing) {
      existing.textContent = r.text;
      existing.setAttribute("href", href);
      if (href.startsWith("#")) { existing.removeAttribute("target"); existing.removeAttribute("rel"); }
      else { existing.target = "_blank"; existing.rel = "noopener"; }
    } else {
      restoreRange();
      document.execCommand("insertHTML", false, `<a ${linkAttrs(href)}>${esc(r.text)}</a>`);
    }
    afterTextCommand();
  }

  // Petite bulle sur un lien : ouvrir l'original, modifier, retirer
  let tipLink = null;
  function showLinkTip(a) {
    tipLink = a;
    const href = a.getAttribute("href") || "";
    const label = href.startsWith("#") ? (PAGES[href.slice(1)]?.title || href) : href.replace(/^https?:\/\//, "").slice(0, 40);
    linkTip.innerHTML = `<span class="ed-tip-url">${esc(label)}</span>
      <button data-tip="open">↗ Ouvrir</button><button data-tip="edit">✏️ Modifier</button><button data-tip="unlink">✖ Retirer</button>`;
    const r = a.getBoundingClientRect();
    linkTip.style.top = `${r.bottom + scrollY + 6}px`;
    linkTip.style.left = `${Math.min(r.left + scrollX, scrollX + innerWidth - 360)}px`;
    linkTip.classList.add("open");
  }
  function hideLinkTip() { linkTip?.classList.remove("open"); tipLink = null; }
  function onLinkTip(e) {
    const b = e.target.closest("[data-tip]");
    if (!b || !tipLink) return;
    const a = tipLink;
    hideLinkTip();
    if (b.dataset.tip === "open") {
      const href = a.getAttribute("href");
      if (href.startsWith("#")) location.hash = href.slice(1);
      else window.open(href, "_blank", "noopener");
    } else if (b.dataset.tip === "edit") insertLink(a);
    else { pushHistory(); a.replaceWith(...a.childNodes); sync(); }
  }

  // =========================================================
  // Page modifiable
  // =========================================================
  function applyEditable() {
    if (!ed.active) return;
    const page = currentPage;
    if (page.special) return;   // « Gestion des officiers » n'est pas modifiable
    selectBlock(null);
    hideLinkTip();
    renderPanel();
    fillGoto();
    hist.undo = []; hist.redo = [];
    ed.activeRt = null; ed.savedRange = null; ed.container = null;

    // Page non attribuée à cet officier : on l'affiche en lecture seule
    if (!canEditPage(page.id)) {
      document.getElementById("app").insertAdjacentHTML("afterbegin",
        `<p class="ed-readonly">🔒 Lecture seule : le CMDM ne t'a pas donné le droit de modifier cette page.</p>`);
      return;
    }

    if (ed.scope) {
      // Officier : seul le contenu de la page se modifie (pas le titre, l'icône ni les textes de l'accueil)
    } else if (page.id === "accueil") {
      const htmlFields = ["title", "welcome"];
      document.querySelectorAll("[data-field]").forEach((el) => {
        el.contentEditable = "true";
        el.addEventListener("input", () => {
          const f = el.dataset.field;
          SITE_DATA.home[f] = htmlFields.includes(f) ? el.innerHTML.trim() : el.textContent.trim();
          markDirty();
        });
        el.addEventListener("paste", onPastePlain);
      });
    } else {
      const title = document.querySelector("[data-page-title]");
      title.contentEditable = "true";
      title.addEventListener("paste", onPastePlain);
      title.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
      title.addEventListener("input", () => {
        findNode(page.id).node.title = title.textContent.trim() || "Sans titre";
        buildIndex(); renderNav(); fillGoto();
        document.querySelector(".crumb-current").textContent = title.textContent;
        markDirty();
      });
      const icon = document.querySelector("[data-page-icon]");
      icon.title = "Changer l'icône";
      icon.addEventListener("click", async () => {
        const r = await modal({ title: "Icône de la page", html: `<label>Emoji<input name="icon" value="${esc(page.icon)}" maxlength="8"></label>` });
        if (!r || !r.icon.trim()) return;
        findNode(page.id).node.icon = r.icon.trim();
        markDirty();
        renderAll(true);
      });
    }

    const body = bodyEl();
    let html = migrate(CONTENT[page.id] || "");
    body.innerHTML = html;
    enhance(body.parentElement);
    prepare(body);
    ed.lastSnap = serializeBody(body);

    body.addEventListener("input", onBodyInput);
    body.addEventListener("paste", onPasteRich);
    body.addEventListener("click", onBodyClick);
    body.addEventListener("pointerdown", onBodyPointerDown);
    body.addEventListener("dragstart", (e) => e.preventDefault());
    body.addEventListener("keydown", (e) => {
      if (e.target.matches("summary") && (e.key === "Enter" || e.key === " ")) {
        if (e.key === "Enter") e.preventDefault();
        if (e.key === " ") { e.preventDefault(); document.execCommand("insertText", false, " "); }
      }
    });
  }
  document.addEventListener("page:rendered", applyEditable);

  // Prépare les blocs : zones de texte modifiables, poignées, images en mémoire
  const ZONE_BAR = `<div class="ed-zone-bar" data-ed contenteditable="false"><span>Zone</span>
    <button type="button" data-zone="up" title="Monter la zone">↑</button>
    <button type="button" data-zone="down" title="Descendre la zone">↓</button>
    <button type="button" data-zone="style" title="Changer le style de la zone (encadrée, transparente, rouge)">🎨</button>
    <button type="button" data-zone="dup" title="Dupliquer la zone">⧉</button>
    <button type="button" data-zone="del" class="ed-bt-del" title="Supprimer la zone et tout son contenu">🗑</button></div>`;
  function prepare(body) {
    const zones = body.matches(".zone") ? [body] : [...body.querySelectorAll(".zone")];
    zones.forEach((z) => { if (!z.querySelector(":scope > .ed-zone-bar")) z.insertAdjacentHTML("afterbegin", ZONE_BAR); });
    if (body === bodyEl() && !body.querySelector(":scope > .ed-add-zone")) {
      body.insertAdjacentHTML("beforeend", `<button type="button" class="ed-add-zone" data-ed contenteditable="false">➕ Ajouter une zone</button>`);
    }
    body.querySelectorAll(".blk").forEach((blk) => {
      blk.classList.add("ed-blk");
      if (!blk.querySelector(":scope > .ed-grip")) {
        blk.insertAdjacentHTML("beforeend", `<div class="ed-grip" data-ed contenteditable="false" title="Glisser pour déplacer">⠿</div>`);
      }
    });
    (body.matches(".blk-row") ? [body] : [...body.querySelectorAll(".blk-row")]).forEach(refreshRow);
    body.querySelectorAll(".blk-text, .rt").forEach((rt) => { rt.contentEditable = "true"; updateEmpty(rt); });
    // Corbeille sur les zones qui peuvent rester vides : emplacements d'image et zones de texte
    const MINI_DEL = `<button type="button" class="ed-mini-del" data-ed data-del-part contenteditable="false" title="Retirer cette zone"></button>`;
    body.querySelectorAll(".blk-text, .rt, .blk figure").forEach((part) => {
      if (!part.querySelector(":scope > .ed-mini-del")) part.insertAdjacentHTML("beforeend", MINI_DEL);
    });
    body.querySelectorAll(".collapse summary, .doc-img figcaption, .car-track figcaption").forEach((el) => (el.contentEditable = "true"));
    body.querySelectorAll("details.collapse").forEach((d) => (d.open = true));
    body.querySelectorAll(".embed, .blk-image, .blk-gallery, .blk-button, .blk-social, .blk-linkcard, .blk-carousel, .blk-placeholder-blk")
      .forEach((el) => { if (!el.matches(".rt")) el.setAttribute("contenteditable", "false"); });
    body.querySelectorAll(".doc-img figcaption").forEach((el) => el.setAttribute("contenteditable", "true"));
    body.querySelectorAll("img").forEach((img) => {
      img.draggable = false;
      const path = img.dataset.upload || img.getAttribute("src");
      if (ed.uploads[path]) { img.dataset.upload = path; img.src = ed.uploads[path].blobUrl; }
    });
  }
  function refreshRow(rowEl) {
    rowEl.querySelectorAll(":scope > .blk > .ed-resize").forEach((r) => r.remove());
    const blocks = [...rowEl.querySelectorAll(":scope > .blk")];
    blocks.slice(0, -1).forEach((b) => b.insertAdjacentHTML("beforeend", `<div class="ed-resize" data-ed contenteditable="false" title="Glisser pour changer la largeur"></div>`));
    // Boutons ＋ pour ajouter un élément à gauche / à droite (tant que la rangée n'est pas pleine)
    blocks.forEach((b) => {
      if (b.querySelector(":scope > .ed-side-add")) return;
      b.insertAdjacentHTML("beforeend",
        `<button type="button" class="ed-side-add left" data-ed data-side="left" contenteditable="false" title="Ajouter un élément à gauche">＋</button>`
        + `<button type="button" class="ed-side-add right" data-ed data-side="right" contenteditable="false" title="Ajouter un élément à droite">＋</button>`);
    });
    rowEl.classList.toggle("ed-row-full", blocks.length >= MAX_COLUMNS);
  }

  // ---------- Ajouter un élément à côté d'un bloc ----------
  const SIDE_ITEMS = [
    ["text", "𝐓", "Zone de texte"], ["image", "🖼️", "Image"], ["button", "🔘", "Bouton"],
    ["generic", "🧩", "Intégrer (lien)"], ["youtube", "▶️", "Vidéo YouTube"], ["collapse", "↕️", "Groupe réductible"],
    ["social", "👥", "Réseaux sociaux"], ["placeholder", "➕", "Espace réservé"], ["spacer", "⬜", "Espace vide"],
  ];
  let sideMenu;
  function openSideMenu(blk, side, btn) {
    ed.side = { blk, side };
    if (!sideMenu) {
      sideMenu = document.createElement("div");
      sideMenu.id = "ed-side-menu";
      sideMenu.addEventListener("mousedown", (e) => e.preventDefault());
      sideMenu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-side-ins]");
        if (!b) return;
        closeSideMenu(true);
        if (b.dataset.sideIns === "more") {
          if (panelMode !== "insert") togglePanel("insert");
          toast(`Choisis un élément dans le panneau Insérer : il sera ajouté à ${ed.side.side === "left" ? "gauche" : "droite"} du bloc.`);
        } else insertItem(b.dataset.sideIns);
      });
      document.body.appendChild(sideMenu);
    }
    sideMenu.innerHTML = `<p>Ajouter à ${side === "left" ? "gauche" : "droite"}</p>`
      + SIDE_ITEMS.map(([k, i, l]) => `<button type="button" data-side-ins="${k}"><span>${i}</span>${l}</button>`).join("")
      + `<button type="button" data-side-ins="more"><span>⋯</span>Autres éléments…</button>`;
    sideMenu.classList.add("open");
    const r = btn.getBoundingClientRect();
    const left = side === "left" ? r.left - sideMenu.offsetWidth - 8 : r.right + 8;
    sideMenu.style.left = `${Math.max(8, Math.min(left, innerWidth - sideMenu.offsetWidth - 8)) + scrollX}px`;
    sideMenu.style.top = `${Math.max(8, Math.min(r.top - 20, innerHeight - sideMenu.offsetHeight - 8)) + scrollY}px`;
  }
  // keep = garder la cible « à côté » pour l'élément qui va être inséré
  function closeSideMenu(keep) {
    sideMenu?.classList.remove("open");
    if (!keep) ed.side = null;
  }

  // Place les blocs à côté du bloc visé ; une image réduite cède sa place libre au nouvel élément
  function insertBeside(html, target, side) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const blocks = [...tpl.content.querySelectorAll(".blk-row > .blk")];
    const rowEl = target.parentElement;
    const count = rowEl.querySelectorAll(":scope > .blk").length;
    if (!blocks.length || count + blocks.length > MAX_COLUMNS) {
      toast(`Une rangée contient au maximum ${MAX_COLUMNS} éléments : l'élément est ajouté en dessous.`, true);
      return false;
    }
    pushHistory();
    if (side === "left") target.before(...blocks); else target.after(...blocks);
    const img = target.matches(".blk-image") && target.querySelector("img");
    const pct = img && parseFloat(img.style.width);
    if (pct && pct < 95 && blocks.length === 1) {
      const g = parseFloat(target.style.flexGrow) || 1;
      target.style.flexGrow = (g * pct / 100).toFixed(2);
      blocks[0].style.flexGrow = (g * (1 - pct / 100)).toFixed(2);
      img.style.width = "100%";
    } else if (target.style.flexGrow) {
      // Le bloc visé a une largeur réglée : le nouvel élément en prend la moitié
      const share = (parseFloat(target.style.flexGrow) / (blocks.length + 1)).toFixed(2);
      [target, ...blocks].forEach((b) => { b.style.flexGrow = share; });
    }
    prepare(rowEl);
    refreshRow(rowEl);
    enhance(rowEl);
    sync();
    selectBlock(blocks[0]);
    if (blocks[0].matches(".blk-text")) { blocks[0].focus(); ed.activeRt = blocks[0]; }
    return true;
  }
  function updateEmpty(rt) {
    if (!rt) return;
    // Les poignées de l'éditeur (data-ed) ne comptent pas comme du texte
    const text = [...rt.childNodes].filter((n) => !(n.nodeType === 1 && n.hasAttribute("data-ed"))).map((n) => n.textContent).join("");
    const empty = !text.trim() && !rt.querySelector("img, iframe, table, hr");
    rt.toggleAttribute("data-empty", empty);
  }

  function serializeBody(body) {
    const c = body.cloneNode(true);
    c.querySelectorAll("[data-ed], [data-gen]").forEach((e) => e.remove());
    c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    c.querySelectorAll("[data-empty]").forEach((e) => e.removeAttribute("data-empty"));
    c.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    c.querySelectorAll('[id^="titre-"]').forEach((h) => h.removeAttribute("id"));
    c.querySelectorAll("img[draggable]").forEach((i) => i.removeAttribute("draggable"));
    c.querySelectorAll("img[data-upload]").forEach((img) => { img.setAttribute("src", img.dataset.upload); img.removeAttribute("data-upload"); });
    c.querySelectorAll("b, i").forEach((el) => {
      const repl = document.createElement(el.tagName === "B" ? "strong" : "em");
      repl.append(...el.childNodes);
      el.replaceWith(repl);
    });
    c.querySelectorAll("[class]").forEach((el) => {
      [...el.classList].filter((k) => k.startsWith("ed-") || k === "car-on").forEach((k) => el.classList.remove(k));
      if (!el.classList.length) el.removeAttribute("class");
    });
    c.querySelectorAll('[style=""]').forEach((el) => el.removeAttribute("style"));
    return c.innerHTML.trim();
  }

  // Enregistre la page affichée dans CONTENT
  function sync() {
    const body = bodyEl();
    if (!ed.active || !body || !currentPage || currentPage.special || !canEditPage(currentPage.id)) return;
    if (body.querySelector("[data-toc]")) enhance(body.parentElement);
    const html = serializeBody(body);
    if (html === ed.lastSnap) return;
    CONTENT[currentPage.id] = html;
    ed.lastSnap = html;
    markDirty();
  }

  // ---------- Historique (annuler / rétablir) ----------
  function pushHistory() {
    if (hist.undo[hist.undo.length - 1] !== ed.lastSnap) hist.undo.push(ed.lastSnap);
    if (hist.undo.length > 100) hist.undo.shift();
    hist.redo = [];
  }
  function setBody(html) {
    const body = bodyEl();
    body.innerHTML = html;
    enhance(body.parentElement);
    prepare(body);
    selectBlock(null);
    CONTENT[currentPage.id] = html;
    ed.lastSnap = html;
    markDirty();
  }
  function undo() {
    sync();
    if (!hist.undo.length) return toast("Rien à annuler.");
    hist.redo.push(ed.lastSnap);
    setBody(hist.undo.pop());
  }
  function redo() {
    if (!hist.redo.length) return toast("Rien à rétablir.");
    hist.undo.push(ed.lastSnap);
    setBody(hist.redo.pop());
  }

  function onBodyInput(e) {
    // Au début d'une saisie, on mémorise l'état d'avant pour pouvoir annuler
    if (!hist.typing) pushHistory();
    clearTimeout(hist.typing);
    hist.typing = setTimeout(() => { hist.typing = null; }, 1000);
    updateEmpty(rtOf(e.target));
    // Un « tout sélectionner + supprimer » peut effacer la poignée : on la remet
    const blk = e.target.closest?.(".blk");
    if (blk && !blk.querySelector(":scope > .ed-grip")) prepare(blk.parentElement);
    sync();
    if (ed.selected) positionBlockTools();
  }

  // =========================================================
  // Sélection d'un bloc + barre d'outils du bloc (corbeille…)
  // =========================================================
  function onBodyClick(e) {
    const body = bodyEl();
    if (e.target.closest("summary")) e.preventDefault();   // le groupe reste ouvert pendant l'édition
    const a = e.target.closest("a");
    if (a && body.contains(a)) {
      e.preventDefault();
      if (rtOf(a)) showLinkTip(a); else hideLinkTip();
    } else hideLinkTip();

    // Zones : barre d'outils, bouton d'ajout, clic dans le fond d'une zone ou d'un groupe
    const zb = e.target.closest("[data-zone]");
    if (zb) return zoneAction(zb.closest(".zone"), zb.dataset.zone);
    if (e.target.closest(".ed-add-zone")) return addZone();
    const cont = e.target.closest(".collapse-body, .zone");
    setContainer(cont && body.contains(cont) ? cont : null);
    if (e.target === cont) { selectBlock(null); return; }

    const blk = e.target.closest(".blk");
    if (!blk || !body.contains(blk)) return;
    const partDel = e.target.closest("[data-del-part]");
    if (partDel) { e.preventDefault(); return removePart(partDel.parentElement); }
    const sideBtn = e.target.closest(".ed-side-add");
    if (sideBtn) { selectBlock(blk); return openSideMenu(blk, sideBtn.dataset.side, sideBtn); }
    selectBlock(blk);

    const fig = e.target.closest(".doc-img, .blk figure");
    ed.targetFigure = fig && blk.contains(fig) ? fig : null;
    if (ed.targetFigure?.querySelector("img") && !ed.targetFigure.closest(".car-track")) showImgFrame(ed.targetFigure);
    if (fig?.classList.contains("img-empty")) pickImages({ figure: fig });
    if (e.target.closest(".blk-placeholder")) editBlock(blk);
  }

  function selectBlock(blk) {
    document.querySelectorAll(".ed-selected").forEach((x) => x.classList.remove("ed-selected"));
    ed.selected = blk;
    closeSideMenu();
    hideImgFrame();
    if (!blockTools) return;
    if (!blk) { blockTools.classList.remove("open"); return; }
    blk.classList.add("ed-selected");
    const type = blockType(blk);
    blockTools.innerHTML = `<span class="ed-bt-label">${TYPE_LABELS[type] || "Bloc"}</span>
      <button data-bt="drag" title="Glisser pour déplacer" class="ed-bt-drag">⠿</button>
      ${EDITABLE_TYPES.includes(type) ? `<button data-bt="edit" title="Modifier">✏️</button>` : ""}
      <button data-bt="dup" title="Dupliquer">⧉</button>
      <button data-bt="del" title="Supprimer" class="ed-bt-del">🗑</button>`;
    blockTools.classList.add("open");
    positionBlockTools();
  }
  function positionBlockTools() {
    const blk = ed.selected;
    if (!blk?.isConnected) return selectBlock(null);
    const r = blk.getBoundingClientRect();
    blockTools.style.top = `${Math.max(r.top + scrollY - 44, scrollY + 4)}px`;
    blockTools.style.left = `${Math.max(scrollX + 8, r.right + scrollX - blockTools.offsetWidth)}px`;
    positionImgFrame();
  }
  window.addEventListener("resize", () => ed.selected && positionBlockTools());

  // =========================================================
  // Cadre d'une image sélectionnée : poignées de taille aux coins,
  // glisser l'image à gauche / au centre / à droite
  // =========================================================
  let imgFrame, frameFig = null;
  const ALIGN_LABELS = { left: "◧ À gauche", center: "▣ Centrée", right: "◨ À droite" };
  function getAlign(fig, img) {
    const cls = [...img.classList].find((c) => c.startsWith("al-"));
    return cls ? cls.slice(3) : (fig.style.textAlign || "center");
  }
  function setAlign(fig, img, al) {
    img.classList.remove("al-left", "al-center", "al-right");
    img.classList.add(`al-${al}`);
    fig.style.textAlign = al === "center" ? "" : al;
  }
  // Largeur en % de la place disponible ; hauteur en px (vide = proportionnelle)
  const heightPx = (img) => (/px$/.test(img.style.height) ? parseFloat(img.style.height) : null);
  function setWidthPct(img, pct) {
    img.style.width = `${Math.round(pct)}%`;
    img.style.maxHeight = "none";
  }
  function setHeightPx(img, px) {
    if (px) {
      img.style.height = `${Math.round(px)}px`;
      img.style.maxHeight = "none";
      // L'image prend exactement la taille choisie, même si elle est déformée
      if (!img.style.objectFit) img.style.objectFit = "fill";
    } else {
      img.style.height = "";
      img.style.objectFit = "";
    }
  }
  const sizeLabel = (img) => `${img.style.width ? img.style.width.replace("%", " %") : "auto"} × ${heightPx(img) ? `${heightPx(img)} px` : "auto"}`;

  function createImgFrame() {
    imgFrame = document.createElement("div");
    imgFrame.id = "ed-img-frame";
    // Coins : taille proportionnelle ; côtés : largeur seule (e/w) ou hauteur seule (n/s)
    imgFrame.innerHTML = ["nw", "ne", "sw", "se", "n", "e", "s", "w"].map((h) => `<span class="ed-if-h ${h}" data-h="${h}"></span>`).join("")
      + `<span class="ed-if-label"></span><button type="button" class="ed-if-crop" title="Recadrer l'image">✂️ Recadrer</button>`
      + `<button type="button" class="ed-if-del" title="Retirer cette image"></button>`;
    imgFrame.addEventListener("pointerdown", onFramePointerDown);
    imgFrame.addEventListener("dblclick", () => frameFig && imageModal(frameFig));
    document.body.appendChild(imgFrame);
  }
  function showImgFrame(fig) {
    frameFig = fig;
    imgFrame.classList.add("open");
    positionImgFrame();
  }
  function hideImgFrame() {
    frameFig = null;
    imgFrame?.classList.remove("open");
  }
  function positionImgFrame(label) {
    const img = frameFig?.querySelector("img");
    if (!img || !img.isConnected) return hideImgFrame();
    const r = img.getBoundingClientRect();
    Object.assign(imgFrame.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
    imgFrame.querySelector(".ed-if-label").textContent = label || `${sizeLabel(img)} · ${ALIGN_LABELS[getAlign(frameFig, img)]}`;
  }

  function onFramePointerDown(e) {
    if (e.button !== 0 || !frameFig) return;
    e.preventDefault();
    e.stopPropagation();
    const fig = frameFig, img = fig.querySelector("img"), blk = fig.closest(".blk");
    if (e.target.closest(".ed-if-del")) { hideImgFrame(); return removePart(fig); }
    if (e.target.closest(".ed-if-crop")) return cropImage(fig);
    const handle = e.target.dataset.h;
    const startX = e.clientX, startY = e.clientY;
    const figW = fig.getBoundingClientRect().width;
    const startW = img.getBoundingClientRect().width;
    const startH = img.getBoundingClientRect().height;
    const startHpx = heightPx(img);
    let changed = false;
    const begin = () => { if (!changed) { pushHistory(); changed = true; } };

    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (handle) {
        begin();
        if (handle === "n" || handle === "s") {
          // Hauteur seule
          if (!img.style.width) setWidthPct(img, (startW / figW) * 100);
          setHeightPx(img, Math.max(30, startH + (handle === "s" ? dy : -dy)));
        } else {
          // Largeur : un côté droit agrandit vers la droite, un côté gauche vers la gauche ; centré = des deux côtés
          const sign = handle.endsWith("e") ? 1 : -1;
          const mult = getAlign(fig, img) === "center" ? 2 : 1;
          const newW = Math.min(figW, Math.max(figW * 0.05, startW + sign * dx * mult));
          setWidthPct(img, (newW / figW) * 100);
          if (handle.length === 1) setHeightPx(img, startH);                  // côté : la hauteur ne bouge pas
          else if (startHpx) setHeightPx(img, startHpx * (newW / startW));   // coin : on garde les proportions
        }
        positionImgFrame(sizeLabel(img));
        return;
      }
      // Glissé surtout vertical : on déplace tout le bloc
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        cleanup();
        if (changed) sync();
        hideImgFrame();
        startDrag(blk, ev);
        return;
      }
      // Glissé horizontal : gauche / centre / droite selon le tiers où se trouve la souris
      const fr = fig.getBoundingClientRect();
      const rel = (ev.clientX - fr.left) / fr.width;
      const al = rel < 1 / 3 ? "left" : rel > 2 / 3 ? "right" : "center";
      if (Math.abs(dx) > 6 && al !== getAlign(fig, img)) { begin(); setAlign(fig, img, al); }
      positionImgFrame(Math.abs(dx) > 6 ? ALIGN_LABELS[al] : undefined);
    };
    const up = () => { cleanup(); if (changed) sync(); positionImgFrame(); positionBlockTools(); };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.classList.remove("ed-is-resizing", "ed-is-moving-img");
    };
    document.body.classList.add(handle ? "ed-is-resizing" : "ed-is-moving-img");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // Clic ailleurs : on désélectionne
  document.addEventListener("pointerdown", (e) => {
    if (!ed.active) return;
    if (!e.target.closest("#ed-color-pop, [data-act=color]")) colorPop?.classList.remove("open");
    // Clic ailleurs que dans le menu, le panneau ou une fenêtre : on abandonne l'ajout « à côté »
    if (!e.target.closest("#ed-side-menu, .ed-side-add, #ed-panel, .ed-modal-wrap")) closeSideMenu();
    if (e.target.closest(".blk, #ed-blk-tools, #ed-bar, #ed-panel, .ed-modal-wrap, #ed-link-tip, #ed-color-pop, #ed-img-frame, #ed-side-menu")) return;
    selectBlock(null);
    hideLinkTip();
  });

  // Retire un bloc (et sa rangée si elle devient vide) ; une page peut rester vide
  function removeBlock(blk) {
    const rowEl = blk.parentElement;
    blk.remove();
    if (!rowEl.querySelector(":scope > .blk")) rowEl.remove(); else refreshRow(rowEl);
    selectBlock(null);
  }

  // ---------- Zones (cadres de contenu) ----------
  function setContainer(c) {
    document.querySelectorAll(".ed-zone-active").forEach((z) => z.classList.remove("ed-zone-active"));
    ed.container = c || null;
    c?.classList.add("ed-zone-active");
  }
  function addZone() {
    const body = bodyEl();
    pushHistory();
    const tpl = document.createElement("template");
    tpl.innerHTML = B.zone();
    const zone = tpl.content.firstElementChild;
    const after = ed.selected?.closest(".zone") || ed.container?.closest(".zone");
    if (after) after.after(zone); else body.querySelector(":scope > .ed-add-zone").before(zone);
    prepare(zone);
    selectBlock(null);
    setContainer(zone);
    sync();
    zone.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Nouvelle zone ajoutée : utilise ➕ Insérer pour la remplir, ou glisses-y un élément.");
  }
  async function zoneAction(zone, act) {
    switch (act) {
      case "up": case "down": {
        const sib = act === "up" ? zone.previousElementSibling : zone.nextElementSibling;
        if (!sib?.classList.contains("zone")) return;
        pushHistory();
        if (act === "up") sib.before(zone); else sib.after(zone);
        break;
      }
      case "style": {
        const styles = ["", "plain", "accent"];
        const next = styles[(styles.indexOf(zone.dataset.style || "") + 1) % styles.length];
        pushHistory();
        if (next) zone.dataset.style = next; else delete zone.dataset.style;
        toast(`Style de la zone : ${{ "": "encadrée", plain: "transparente", accent: "rouge" }[next]}`);
        break;
      }
      case "dup": {
        pushHistory();
        const tmp = document.createElement("div");
        tmp.append(zone.cloneNode(true));
        zone.insertAdjacentHTML("afterend", serializeBody(tmp));
        prepare(zone.nextElementSibling);
        enhance(zone.nextElementSibling);
        break;
      }
      case "del": {
        const n = zone.querySelectorAll(".blk").length;
        if (n) {
          const ok = await modal({
            title: "🗑 Supprimer la zone ?",
            html: `<p>Cette zone contient <strong>${n} élément${n > 1 ? "s" : ""}</strong>. Ils seront supprimés avec elle.</p><p class="ed-hint">Tu pourras annuler avec ↶ (Ctrl+Z).</p>`,
            ok: "Supprimer",
          });
          if (!ok) return;
        }
        pushHistory();
        if (ed.selected && zone.contains(ed.selected)) selectBlock(null);
        if (ed.container && zone.contains(ed.container)) setContainer(null);
        zone.remove();
        break;
      }
    }
    sync();
    if (ed.selected) positionBlockTools();
  }

  // Corbeille d'une zone à l'intérieur d'un bloc (emplacement d'image, image, texte vidé)
  function removePart(part) {
    const blk = part.closest(".blk");
    pushHistory();
    if (part === blk) removeBlock(blk);
    else {
      part.remove();
      // Plus rien dans le bloc : on retire le bloc entier
      if (!blk.querySelector("figure, .rt, img, iframe")) removeBlock(blk);
      else selectBlock(blk);
    }
    sync();
  }

  function onBlockTool(e) {
    const b = e.target.closest("[data-bt]");
    const blk = ed.selected;
    if (!b || !blk) return;
    switch (b.dataset.bt) {
      case "del": {
        pushHistory();
        removeBlock(blk);
        sync();
        break;
      }
      case "dup": {
        pushHistory();
        const tmp = document.createElement("div");
        tmp.append(blk.cloneNode(true));
        const html = serializeBody(tmp).replace(/ed-selected/g, "");
        blk.parentElement.insertAdjacentHTML("afterend", row(html));
        const newRow = blk.parentElement.nextElementSibling;
        prepare(newRow);
        enhance(newRow);
        sync();
        selectBlock(newRow.querySelector(".blk"));
        break;
      }
      case "edit": editBlock(blk); break;
    }
  }

  // =========================================================
  // Glisser-déposer des blocs et largeur des colonnes
  // =========================================================
  let pending = null;
  function onBodyPointerDown(e) {
    if (e.button !== 0) return;
    const resizer = e.target.closest(".ed-resize");
    if (resizer) return startResize(resizer.closest(".blk"), e);
    const blk = e.target.closest(".blk");
    if (!blk || e.target.closest("[data-del-part], .ed-zone-bar, .ed-add-zone, .ed-side-add")) return;
    // Clic dans le fond d'un groupe réductible : ce n'est pas une prise du bloc
    if (e.target.matches(".collapse-body")) return;
    const onGrip = !!e.target.closest(".ed-grip");
    // La bordure du bloc : une bande de 10 px sur chaque bord
    const r = blk.getBoundingClientRect();
    const onFrame = e.clientX - r.left < 10 || r.right - e.clientX < 10 || e.clientY - r.top < 10 || r.bottom - e.clientY < 10;
    const inText = !!e.target.closest(".rt, .blk-text, summary, figcaption, input, select");
    if (onGrip || onFrame) { startDrag(blk, e); return; }
    const btn = e.target.closest(".blk-button a.btn");
    if (btn && blk.contains(btn)) return startButtonMove(blk, btn, e);
    // Images, boutons, intégrations… : on peut aussi les attraper n'importe où
    if (!inText) pending = { blk, x: e.clientX, y: e.clientY, ev: e };
  }
  document.addEventListener("pointermove", (e) => {
    if (!pending) return;
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) {
      const p = pending;
      pending = null;
      startDrag(p.blk, e);
    }
  });
  document.addEventListener("pointerup", () => { pending = null; });

  // Glisser un bouton : gauche / centre / droite dans sa zone ; glissé vertical = déplacer le bloc
  const BTN_ALIGN = { "": "left", center: "center", right: "right" };
  function startButtonMove(blk, btn, e) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let moving = false, changed = false, hint = null;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moving && Math.hypot(dx, dy) < 6) return;
      if (!moving) { moving = true; selectBlock(blk); blockTools.classList.remove("open"); document.body.classList.add("ed-is-moving-img"); }
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        cleanup();
        if (changed) sync();
        startDrag(blk, ev);
        return;
      }
      const r = blk.getBoundingClientRect();
      const rel = (ev.clientX - r.left) / r.width;
      const al = rel < 1 / 3 ? "" : rel > 2 / 3 ? "right" : "center";
      if (al !== buttonAlign(btn)) {
        if (!changed) { pushHistory(); changed = true; }
        setButtonAlign(btn, al);
      }
      if (!hint) { hint = document.createElement("div"); hint.id = "ed-btn-hint"; document.body.appendChild(hint); }
      const br = btn.getBoundingClientRect();
      hint.textContent = ALIGN_LABELS[BTN_ALIGN[al]];
      Object.assign(hint.style, { left: `${br.left + br.width / 2 + scrollX}px`, top: `${br.top + scrollY - 8}px` });
    };
    const up = () => {
      cleanup();
      if (changed) sync();
      if (!moving) selectBlock(blk);
      positionBlockTools();
    };
    const cleanup = () => {
      hint?.remove();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.classList.remove("ed-is-moving-img");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  let drag = null;
  function startDrag(blk, e) {
    e.preventDefault();
    getSelection().removeAllRanges();
    selectBlock(blk);
    blockTools.classList.remove("open");
    drag = { blk, target: null };
    blk.classList.add("ed-dragging");
    document.body.classList.add("ed-is-dragging");
    ghost = document.createElement("div");
    ghost.id = "ed-ghost";
    ghost.textContent = `⠿ ${TYPE_LABELS[blockType(blk)] || "Bloc"}`;
    document.body.appendChild(ghost);
    moveGhost(e);
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd, { once: true });
    document.addEventListener("keydown", onDragKey);
  }
  function moveGhost(e) {
    ghost.style.left = `${e.clientX + 14}px`;
    ghost.style.top = `${e.clientY + 10}px`;
  }
  function onDragMove(e) {
    moveGhost(e);
    const edH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ed-h")) || 0;
    if (e.clientY < edH + 90) scrollBy(0, -14);
    else if (e.clientY > innerHeight - 50) scrollBy(0, 14);
    drag.target = computeTarget(e.clientX, e.clientY);
    showDropLine(drag.target);
  }
  // Conteneur visé : le groupe réductible ou la zone le plus « intérieur » sous la souris
  function containerAt(x, y) {
    const body = bodyEl();
    const all = [...body.querySelectorAll(".zone, .collapse-body")].filter((c) => !drag.blk.contains(c));
    const area = (c) => { const r = c.getBoundingClientRect(); return r.width * r.height; };
    const hits = all.filter((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }).sort((a, b) => area(a) - area(b));
    if (hits[0]) return hits[0];
    // Hors de toute zone : la zone la plus proche verticalement
    let best = null;
    for (const z of body.querySelectorAll(":scope > .zone")) {
      const r = z.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (!best || d < best.d) best = { d, z };
    }
    return best?.z || null;
  }
  function computeTarget(x, y) {
    const cont = containerAt(x, y);
    if (!cont) return null;
    const rows = [...cont.querySelectorAll(":scope > .blk-row")];
    if (!rows.length) return { kind: "into", container: cont };
    for (const r of rows) {
      const rr = r.getBoundingClientRect();
      if (y < rr.top - 11 || y > rr.bottom + 11) continue;
      const blocks = [...r.querySelectorAll(":scope > .blk")];
      const others = blocks.filter((b) => b !== drag.blk).length;
      for (const b of blocks) {
        const br = b.getBoundingClientRect();
        if (x < br.left - 14 || x > br.right + 14) continue;
        const edge = Math.min(120, br.width * 0.25);
        if (others < MAX_COLUMNS && b !== drag.blk) {
          if (x < br.left + edge) return { kind: "col", rowEl: r, ref: b, before: true };
          if (x > br.right - edge) return { kind: "col", rowEl: r, ref: b, before: false };
        }
        return { kind: "row", ref: r, before: y < rr.top + rr.height / 2 };
      }
      return { kind: "row", ref: r, before: y < rr.top + rr.height / 2 };
    }
    // Entre deux rangées, au-dessus de la première ou sous la dernière
    let best = null;
    for (const r of rows) {
      const rr = r.getBoundingClientRect();
      const d = Math.min(Math.abs(y - rr.top), Math.abs(y - rr.bottom));
      if (!best || d < best.d) best = { d, ref: r, before: y < rr.top + rr.height / 2 };
    }
    return { kind: "row", ref: best.ref, before: best.before };
  }
  function showDropLine(t) {
    if (!t) { dropLine.classList.remove("open"); return; }
    dropLine.classList.add("open");
    if (t.kind === "into") {
      const cr = t.container.getBoundingClientRect();
      Object.assign(dropLine.style, {
        left: `${cr.left + 12 + scrollX}px`, top: `${cr.top + cr.height / 2 + scrollY}px`,
        width: `${cr.width - 24}px`, height: "4px",
      });
    } else if (t.kind === "col") {
      const rr = t.rowEl.getBoundingClientRect(), br = t.ref.getBoundingClientRect();
      Object.assign(dropLine.style, {
        left: `${(t.before ? br.left - 16 : br.right + 12) + scrollX}px`, top: `${rr.top + scrollY}px`,
        width: "4px", height: `${rr.height}px`,
      });
    } else {
      const rr = t.ref.getBoundingClientRect(), cr = t.ref.parentElement.getBoundingClientRect();
      Object.assign(dropLine.style, {
        left: `${cr.left + scrollX}px`, top: `${(t.before ? rr.top - 13 : rr.bottom + 9) + scrollY}px`,
        width: `${cr.width}px`, height: "4px",
      });
    }
  }
  function endDrag() {
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("keydown", onDragKey);
    drag.blk.classList.remove("ed-dragging");
    document.body.classList.remove("ed-is-dragging");
    ghost.remove();
    dropLine.classList.remove("open");
  }
  function onDragKey(e) {
    if (e.key !== "Escape") return;
    document.removeEventListener("pointerup", onDragEnd);
    endDrag();
    selectBlock(drag.blk);
    drag = null;
  }
  function onDragEnd() {
    const { blk, target } = drag;
    endDrag();
    drag = null;
    if (!target) return selectBlock(blk);
    pushHistory();
    const oldRow = blk.parentElement;
    if (target.kind === "col") {
      if (target.before) target.ref.before(blk); else target.ref.after(blk);
    } else if (target.kind === "into") {
      const r = document.createElement("div");
      r.className = "blk-row";
      r.append(blk);
      target.container.append(r);
    } else {
      const r = document.createElement("div");
      r.className = "blk-row";
      if (target.ref === oldRow && oldRow.querySelectorAll(":scope > .blk").length === 1) return selectBlock(blk);
      if (target.before) target.ref.before(r); else target.ref.after(r);
      r.append(blk);
    }
    blk.style.flexGrow = "";
    if (!oldRow.querySelector(":scope > .blk")) oldRow.remove(); else refreshRow(oldRow);
    refreshRow(blk.parentElement);
    sync();
    selectBlock(blk);
  }

  function startResize(blk, e) {
    e.preventDefault();
    const next = blk.nextElementSibling;
    if (!next?.classList.contains("blk")) return;
    const g1 = parseFloat(blk.style.flexGrow) || 1, g2 = parseFloat(next.style.flexGrow) || 1;
    const total = g1 + g2;
    const left = blk.getBoundingClientRect().left, right = next.getBoundingClientRect().right;
    pushHistory();
    document.body.classList.add("ed-is-resizing");
    const move = (ev) => {
      const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - left) / (right - left)));
      blk.style.flexGrow = (total * ratio).toFixed(2);
      next.style.flexGrow = (total * (1 - ratio)).toFixed(2);
      if (ed.selected) positionBlockTools();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", () => {
      document.removeEventListener("pointermove", move);
      document.body.classList.remove("ed-is-resizing");
      sync();
    }, { once: true });
  }

  // =========================================================
  // Insertion de blocs
  // =========================================================
  // Ajoute une ou plusieurs rangées sous le bloc sélectionné (ou en bas de la page)
  function insertRows(html) {
    const body = bodyEl();
    if (!body) return;
    if (!canEditPage(currentPage?.id)) return toast("Cette page est en lecture seule.", true);
    // Ajout demandé avec un bouton ＋ : à gauche ou à droite du bloc
    if (ed.side?.blk?.isConnected) {
      const { blk, side } = ed.side;
      ed.side = null;
      if (insertBeside(html, blk, side)) return;
    }
    ed.side = null;
    pushHistory();
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const rows = [...tpl.content.children];
    // Sous le bloc sélectionné, sinon dans la zone / le groupe cliqué, sinon dans la dernière zone
    const after = ed.selected?.isConnected ? ed.selected.parentElement : null;
    if (after) after.after(...rows);
    else {
      let cont = ed.container?.isConnected ? ed.container : [...body.querySelectorAll(":scope > .zone")].pop();
      if (!cont) {
        body.querySelector(":scope > .ed-add-zone").insertAdjacentHTML("beforebegin", B.zone());
        cont = [...body.querySelectorAll(":scope > .zone")].pop();
        prepare(cont);
      }
      cont.append(...rows);
    }
    rows.forEach((r) => { prepare(r); enhance(r); });
    sync();
    const first = rows[0]?.querySelector(".blk");
    if (first) {
      selectBlock(first);
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(positionBlockTools, 400);
      const rt = first.matches(".blk-text") ? first : null;
      if (rt) { rt.focus(); ed.activeRt = rt; }
    }
  }

  async function insertItem(kind) {
    if (!canEditPage(currentPage?.id)) return toast("Cette page est en lecture seule.", true);
    switch (kind) {
      case "zone": return addZone();
      case "text": return insertRows(row(B.text()));
      case "image": return pickImages({ newBlock: true });
      case "collapse": {
        const r = await modal({ title: "↕️ Groupe réductible", html: `<label>Titre du groupe<input name="title" required value="Titre du groupe"></label><p class="ed-hint">Ensuite, écris directement dans le groupe, glisse-y des images ou d'autres éléments, ou clique dans le groupe puis utilise ➕ Insérer.</p>`, ok: "Insérer" });
        return r && insertRows(row(B.collapse(r.title)));
      }
      case "toc": return insertRows(row(B.toc()));
      case "carousel": return pickImages({ carousel: true });
      case "button": {
        const html = await buttonModal();
        return html && insertRows(row(`<div class="blk blk-button">${html}</div>`));
      }
      case "divider": return insertRows(row(B.divider()));
      case "spacer": return insertRows(row(B.spacer()));
      case "social": {
        const html = await socialModal();
        return html && insertRows(row(`<div class="blk blk-social">${html}</div>`));
      }
      case "placeholder": return insertRows(row(B.placeholder()));
      default:
        if (EMBEDS[kind]) {
          const html = await embedModal(kind);
          return html && insertRows(row(html));
        }
    }
  }

  // ---------- Modales des différents éléments ----------
  // Aperçu en direct du contenu dans la fenêtre d'intégration
  function setupEmbedPreview(form, kind) {
    const input = form.querySelector("[name=url]");
    const box = form.querySelector(".ed-preview");
    let timer, lastSrc = null;
    const update = () => {
      const raw = input.value.trim();
      const found = raw && resolveEmbed(kind, raw);
      if (!raw) { lastSrc = null; box.innerHTML = `<p class="ed-preview-empty">L'aperçu s'affichera ici.</p>`; return; }
      if (!found) { lastSrc = null; box.innerHTML = `<p class="ed-preview-empty">❌ Lien non reconnu pour ce type de contenu.</p>`; return; }
      if (found.conv.src === lastSrc) return;
      lastSrc = found.conv.src;
      box.innerHTML = `<div class="embed ${EMBEDS[found.kind].cls}"><iframe src="${esc(found.conv.src)}" title="Aperçu" allowfullscreen></iframe></div>
        <p class="ed-hint">✅ ${EMBEDS[found.kind].icon} ${EMBEDS[found.kind].label} reconnu. Si l'aperçu reste vide, ce site refuse d'être affiché dans une autre page : utilise plutôt un bouton ou un lien.</p>`;
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 350); });
    update();
  }

  async function embedModal(kind, current) {
    const k = EMBEDS[kind];
    let error = "";
    let v = { url: current?.url || "", title: current?.title || "", open: current ? current.open : true };
    for (;;) {
      const r = await modal({
        title: `${k.icon} ${k.label}`,
        wide: true,
        html: `<label>${esc(k.field)}<input name="url" required value="${esc(v.url)}" placeholder="${k.plain ? "" : "https://…"}"></label>
          ${k.hint ? `<p class="ed-hint">${k.hint}</p>` : ""}
          <div class="ed-preview"></div>
          <label>Nom affiché (pour le lien « ↗ Ouvrir … »)<input name="title" value="${esc(v.title)}" placeholder="${k.label}"></label>
          <label class="ed-check"><input type="checkbox" name="open"${v.open ? " checked" : ""}> Afficher un lien « ↗ Ouvrir » vers l'original</label>
          ${error ? `<p class="ed-error">${error}</p>` : ""}`,
        ok: current ? "Enregistrer" : "Insérer",
        onOpen: (form) => setupEmbedPreview(form, kind),
      });
      if (!r) return null;
      v = r;
      const html = embedBlockHtml(kind, r.url, r.title, r.open);
      if (html) return html;
      error = "Ce lien n'est pas reconnu pour ce type de contenu.";
    }
  }

  // Alignement d'un bouton : classe du paragraphe qui le contient ("" = gauche)
  const buttonAlign = (a) => (!a ? "center" : a.parentElement.classList.contains("center") ? "center" : a.parentElement.classList.contains("right") ? "right" : "");
  function setButtonAlign(a, al) {
    const p = a.parentElement;
    p.classList.remove("center", "right", "left");
    if (al) p.classList.add(al);
    if (!p.classList.length) p.removeAttribute("class");
  }

  async function buttonModal(a) {
    const r = await modal({
      title: "🔘 Bouton",
      html: `<label>Texte du bouton<input name="text" required value="${esc(a?.textContent || "")}"></label>
        ${destinationFields(a?.getAttribute("href") || "")}
        <label>Style<select name="style">
          <option value="primary"${a?.classList.contains("ghost") ? "" : " selected"}>Plein (rouge)</option>
          <option value="ghost"${a?.classList.contains("ghost") ? " selected" : ""}>Contour</option>
        </select></label>
        <label>Alignement<select name="align">
          ${[["", "Gauche"], ["center", "Centré"], ["right", "Droite"]].map(([v, l]) => `<option value="${v}"${buttonAlign(a) === v ? " selected" : ""}>${l}</option>`).join("")}
        </select></label>`,
      ok: a ? "Enregistrer" : "Insérer",
    });
    if (!r) return null;
    const href = destOf(r);
    if (!href) { toast("Choisis une page ou indique une adresse web.", true); return null; }
    return `<p${r.align ? ` class="${r.align}"` : ""}><a class="btn ${r.style}" ${linkAttrs(href)}>${esc(r.text)}</a></p>`;
  }

  async function socialModal(container) {
    const current = {};
    container?.querySelectorAll("a.social").forEach((a) => { current[a.dataset.net || a.textContent] = a.getAttribute("href"); });
    const r = await modal({
      title: "👥 Liens vers les réseaux sociaux",
      html: `<p class="ed-hint">Laisse vide les réseaux que tu n'utilises pas.</p>
        ${SOCIALS.map((n) => `<label>${n}<input name="${n}" value="${esc(current[n] || "")}" placeholder="https://…"></label>`).join("")}`,
      ok: container ? "Enregistrer" : "Insérer",
    });
    if (!r) return null;
    const links = SOCIALS.filter((n) => r[n]?.trim()).map((n) =>
      `<a class="social" data-net="${n}" href="${esc(r[n].trim())}" target="_blank" rel="noopener">${n}</a>`);
    if (!links.length) { toast("Indique au moins un lien.", true); return null; }
    return `<div class="social-links">${links.join("")}</div>`;
  }

  async function imageModal(fig) {
    const img = fig.querySelector("img");
    const cap = fig.querySelector("figcaption");
    const link = img.closest("a");
    const fit = img.style.objectFit || "fill";
    const r = await modal({
      title: "🖼️ Image",
      html: `<p class="ed-hint">Astuce : sur la page, tire les coins bleus pour agrandir en gardant les proportions, les côtés pour changer seulement la largeur ou la hauteur, et glisse l'image à gauche, au centre ou à droite.</p>
        <div class="ed-dims">
          <label>Largeur (%)<input name="width" type="number" min="5" max="100" placeholder="auto" value="${parseFloat(img.style.width) || ""}"></label>
          <label>Hauteur (px)<input name="height" type="number" min="30" max="2000" placeholder="auto" value="${heightPx(img) || ""}"></label>
        </div>
        <p class="ed-hint">Laisse « auto » pour garder les proportions de l'image.</p>
        <label>Si la largeur et la hauteur sont fixées<select name="fit">
          ${[["fill", "Étirer l'image à la taille choisie (peut la déformer)"], ["cover", "Remplir le cadre (l'image est rognée)"], ["contain", "Afficher l'image en entier"]].map(([v, l]) => `<option value="${v}"${fit === v ? " selected" : ""}>${l}</option>`).join("")}
        </select></label>
        <label>Alignement<select name="align">
          ${[["center", "Centré"], ["left", "Gauche"], ["right", "Droite"]].map(([v, l]) => `<option value="${v}"${getAlign(fig, img) === v ? " selected" : ""}>${l}</option>`).join("")}
        </select></label>
        <label>Légende (facultatif)<input name="caption" value="${esc(cap?.textContent || "")}"></label>
        <label>Texte alternatif (description pour l'accessibilité)<input name="alt" value="${esc(img.alt || "")}"></label>
        ${destinationFields(link?.getAttribute("href") || "")}
        <p class="ed-hint">Laisse « Adresse web » vide pour une image sans lien.</p>`,
      ok: "Enregistrer",
      extra: `<button type="button" class="ed-btn" data-v="crop">✂️ Recadrer</button><button type="button" class="ed-btn" data-v="replace">🔄 Remplacer l'image</button>`,
    });
    if (!r) return;
    if (r._action === "replace") return pickImages({ figure: fig });
    if (r._action === "crop") return cropImage(fig);
    pushHistory();
    const w = Math.min(100, Math.max(5, parseFloat(r.width) || 0));
    if (r.width) setWidthPct(img, w); else img.style.width = "";
    setHeightPx(img, r.height ? Math.max(30, parseFloat(r.height)) : null);
    if (r.height) img.style.objectFit = r.fit;
    if (!r.width && !r.height) img.style.maxHeight = "";
    setAlign(fig, img, r.align);
    img.alt = r.alt.trim();
    if (r.caption.trim()) {
      const c = cap || fig.appendChild(document.createElement("figcaption"));
      c.textContent = r.caption.trim();
      c.contentEditable = "true";
    } else cap?.remove();
    const href = destOf(r);
    if (link) link.replaceWith(img);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      if (!href.startsWith("#")) { a.target = "_blank"; a.rel = "noopener"; }
      img.replaceWith(a);
      a.append(img);
    }
    sync();
  }

  // Gestion du carrousel : ajouter, retirer et ordonner les images (la première est affichée en premier)
  async function carouselModal(blk) {
    const track = blk.querySelector(".car-track");
    const items = [...track.querySelectorAll(":scope > figure")].map((f) => f.cloneNode(true));
    let list;
    const render = () => {
      list.innerHTML = items.length ? items.map((f, i) => `<div class="ed-car-item" draggable="true" data-i="${i}">
          <span class="ed-car-num">${i === 0 ? "1 · affichée en premier" : i + 1}</span>
          <img src="${esc(f.querySelector("img")?.src || "")}" alt="" draggable="false">
          <div class="ed-car-acts">
            <button type="button" data-car="first" title="Mettre en premier"${i === 0 ? " disabled" : ""}>⏮</button>
            <button type="button" data-car="up" title="Avancer"${i === 0 ? " disabled" : ""}>◀</button>
            <button type="button" data-car="down" title="Reculer"${i === items.length - 1 ? " disabled" : ""}>▶</button>
            <button type="button" data-car="del" title="Retirer cette image">🗑️</button>
          </div>
        </div>`).join("") : '<p class="ed-hint">Aucune image. Ajoute des images avec le bouton ci-dessous.</p>';
    };
    const moveItem = (from, to) => {
      if (to < 0 || to >= items.length || from === to) return;
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      render();
    };
    const r = await modal({
      title: "🎞️ Carrousel d'images",
      wide: true,
      html: `<p class="ed-hint">La première image est celle affichée au départ ; les flèches ‹ › du carrousel passent à l'image suivante. Glisse les images pour changer l'ordre, ou utilise les flèches sous chaque image.</p>
        <div class="ed-car-list"></div>
        <button type="button" class="ed-btn ed-car-add">➕ Ajouter des images</button>`,
      ok: "Enregistrer",
      onOpen: (form) => {
        list = form.querySelector(".ed-car-list");
        render();
        form.querySelector(".ed-car-add").addEventListener("click", () => {
          pickImages({ onPaths: (paths) => {
            items.push(...paths.map((p) => { const f = document.createElement("figure"); f.innerHTML = imgTag(p); return f; }));
            render();
          } });
        });
        list.addEventListener("click", (e) => {
          const b = e.target.closest("[data-car]");
          if (!b) return;
          const i = +b.closest(".ed-car-item").dataset.i;
          if (b.dataset.car === "del") { items.splice(i, 1); render(); }
          else moveItem(i, b.dataset.car === "first" ? 0 : b.dataset.car === "up" ? i - 1 : i + 1);
        });
        // Glisser-déposer pour changer l'ordre
        let dragFrom = null;
        list.addEventListener("dragstart", (e) => {
          const it = e.target.closest(".ed-car-item");
          if (!it) return;
          dragFrom = +it.dataset.i;
          it.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        list.addEventListener("dragover", (e) => { if (dragFrom !== null) e.preventDefault(); });
        list.addEventListener("drop", (e) => {
          e.preventDefault();
          const it = e.target.closest(".ed-car-item");
          const from = dragFrom;
          dragFrom = null;
          if (from !== null && it) moveItem(from, +it.dataset.i);
        });
        list.addEventListener("dragend", () => { dragFrom = null; render(); });
      },
    });
    if (!r) return;
    if (!items.length) { toast("Le carrousel doit garder au moins une image.", true); return; }
    pushHistory();
    track.querySelectorAll(":scope > figure").forEach((f) => f.remove());
    track.prepend(...items);
    prepare(track);
    showCarImage(blk.querySelector("[data-carousel]"), 0);
    sync();
  }

  async function linkcardModal(blk) {
    const a = blk.querySelector("a.link-card");
    const strong = a.querySelector("strong");
    const desc = [...a.querySelectorAll("span")].pop();
    const descText = desc ? [...desc.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() : "";
    const r = await modal({
      title: "🔗 Carte lien",
      html: `<label>Titre<input name="title" value="${esc(strong?.textContent || "")}"></label>
        <label>Description<input name="desc" value="${esc(descText)}"></label>
        <label>Adresse<input name="url" value="${esc(a.getAttribute("href"))}"></label>`,
      ok: "Enregistrer",
    });
    if (!r) return;
    pushHistory();
    a.setAttribute("href", r.url.trim());
    if (strong) strong.textContent = r.title;
    if (desc) desc.innerHTML = `<strong>${esc(r.title)}</strong>\n${esc(r.desc)}`;
    sync();
  }

  async function editBlock(blk) {
    const type = blockType(blk);
    switch (type) {
      case "image": case "card": case "media": case "imgstack": case "gallery": {
        const fig = (ed.targetFigure && blk.contains(ed.targetFigure)) ? ed.targetFigure : blk.querySelector(".doc-img, figure");
        if (!fig || fig.classList.contains("img-empty")) return pickImages({ figure: fig });
        return imageModal(fig);
      }
      case "embed": {
        const em = blk.querySelector(".embed");
        const iframe = em.querySelector("iframe");
        const kind = em.dataset.kind || guessEmbedKind(iframe?.src || "");
        const html = await embedModal(kind, {
          url: em.dataset.url || iframe?.getAttribute("src") || "",
          title: em.dataset.title || (em.querySelector(".embed-open")?.textContent.replace(/^↗\s*Ouvrir\s*/, "") || iframe?.title || ""),
          open: !!em.querySelector(".embed-open"),
        });
        if (!html) return;
        return replaceBlock(blk, html);
      }
      case "button": {
        const html = await buttonModal(blk.querySelector("a.btn"));
        return html && replaceBlock(blk, `<div class="blk blk-button">${html}</div>`);
      }
      case "spacer": {
        const sp = blk.querySelector(".spacer");
        const r = await modal({ title: "↕️ Espace vide", html: `<label>Hauteur (px)<input name="h" type="number" min="10" max="400" value="${parseInt(sp.style.height) || 60}"></label>` });
        if (!r) return;
        pushHistory();
        sp.style.height = `${Math.max(10, Math.min(400, +r.h || 60))}px`;
        return sync();
      }
      case "social": {
        const html = await socialModal(blk);
        return html && replaceBlock(blk, `<div class="blk blk-social">${html}</div>`);
      }
      case "carousel": return carouselModal(blk);
      case "linkcard": return linkcardModal(blk);
      case "placeholder-blk": {
        const r = await modal({
          title: "➕ Espace réservé",
          html: "<p>Que veux-tu mettre ici ?</p>",
          ok: "", cancel: "Annuler",
          extra: `<button type="button" class="ed-btn ed-primary" data-v="image">🖼️ Une image</button>
            ${Object.entries(EMBEDS).map(([k, e]) => `<button type="button" class="ed-btn" data-v="${k}">${e.icon} ${e.label}</button>`).join("")}`,
        });
        if (!r) return;
        if (r._action === "image") return pickImages({ replaceBlock: blk });
        const html = await embedModal(r._action);
        return html && replaceBlock(blk, html);
      }
    }
  }

  function replaceBlock(blk, html) {
    pushHistory();
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const nb = tpl.content.firstElementChild;
    if (blk.style.flexGrow) nb.style.flexGrow = blk.style.flexGrow;
    blk.replaceWith(nb);
    prepare(nb.parentElement);
    enhance(nb.parentElement);
    sync();
    selectBlock(nb);
  }

  // ---------- Images ----------
  function pickImages(target) {
    ed.imageTarget = target;
    fileInput.multiple = !!(target.carousel || target.carouselOf || target.onPaths);
    fileInput.value = "";
    fileInput.click();
  }

  // Réduit les grosses images (max 1600 px, JPEG) pour garder un site léger
  async function prepareImage(file) {
    if (file.type === "image/gif" || file.size < 400 * 1024) return { blob: file, ext: (file.name.split(".").pop() || "png").toLowerCase() };
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return { blob, ext: "jpg" };
  }
  async function storeImage(file) {
    const { blob, ext } = await prepareImage(file);
    return storeBlob(blob, file.name.replace(/\.[^.]+$/, ""), ext);
  }
  // Garde une image en mémoire ; elle sera écrite dans le dossier du site à l'enregistrement
  async function storeBlob(blob, name, ext) {
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${slug(name)}.${ext}`;
    ed.uploads[path] = { blobUrl: URL.createObjectURL(blob), blob, done: false };
    return path;
  }

  // ---------- Recadrage ----------
  // Une fenêtre montre l'image entière avec un cadre à déplacer et redimensionner ;
  // « Appliquer » crée une nouvelle image recadrée qui remplace l'ancienne.
  async function cropImage(fig) {
    const img = fig.querySelector("img");
    if (!img) return;
    hideImgFrame();
    let box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };   // en fraction de l'image
    let ratio = 0;                                     // 0 = libre
    const r = await modal({
      title: "✂️ Recadrer l'image",
      wide: true,
      html: `<p class="ed-hint">Déplace le cadre et tire ses poignées pour choisir la partie de l'image à garder.</p>
        <div class="ed-crop-ratios">${[["0", "Libre"], ["1", "Carré"], ["1.3333", "4:3"], ["1.7778", "16:9"], ["0.75", "3:4"]].map(([v, l], i) =>
          `<button type="button" data-ratio="${v}"${i ? "" : ' class="active"'}>${l}</button>`).join("")}</div>
        <div class="ed-crop"><img src="${esc(img.src)}" alt="" draggable="false">
          <div class="ed-crop-box">${["nw", "ne", "sw", "se", "n", "e", "s", "w"].map((h) => `<span data-c="${h}" class="${h}"></span>`).join("")}</div>
        </div>`,
      ok: "Appliquer",
      onOpen: (form) => {
        const wrap = form.querySelector(".ed-crop"), cbox = form.querySelector(".ed-crop-box"), cimg = wrap.querySelector("img");
        const draw = () => Object.assign(cbox.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
        // Proportion en fraction : ratio réel × (hauteur / largeur de l'image)
        const fracRatio = () => ratio * (cimg.clientHeight / cimg.clientWidth);
        const applyRatio = () => {
          if (!ratio) return;
          const fr = fracRatio();
          let w = box.w, h = w / fr;
          if (h > 1) { h = 1; w = h * fr; }
          box = { x: Math.min(box.x, 1 - w), y: Math.min(box.y, 1 - h), w, h };
        };
        form.querySelector(".ed-crop-ratios").addEventListener("click", (e) => {
          const b = e.target.closest("[data-ratio]");
          if (!b) return;
          form.querySelectorAll("[data-ratio]").forEach((x) => x.classList.toggle("active", x === b));
          ratio = +b.dataset.ratio;
          applyRatio();
          draw();
        });
        cbox.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          const h = e.target.dataset.c;
          const W = cimg.clientWidth, H = cimg.clientHeight;
          const sx = e.clientX, sy = e.clientY, start = { ...box };
          const move = (ev) => {
            const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H;
            const min = 0.05;
            let { x, y, w, h: hh } = start;
            if (!h) {
              x = Math.min(1 - w, Math.max(0, x + dx));
              y = Math.min(1 - hh, Math.max(0, y + dy));
            } else {
              if (h.includes("e")) w = Math.min(1 - x, Math.max(min, w + dx));
              if (h.includes("s")) hh = Math.min(1 - y, Math.max(min, hh + dy));
              if (h.includes("w")) { const nx = Math.min(x + w - min, Math.max(0, x + dx)); w += x - nx; x = nx; }
              if (h.includes("n")) { const ny = Math.min(y + hh - min, Math.max(0, y + dy)); hh += y - ny; y = ny; }
              if (ratio) {
                const fr = fracRatio();
                if (h === "n" || h === "s") w = Math.min(1 - x, hh * fr); else hh = Math.min(1 - y, w / fr);
                if (hh * fr < w) w = hh * fr;
              }
            }
            box = { x, y, w, h: hh };
            draw();
          };
          const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
          document.addEventListener("pointermove", move);
          document.addEventListener("pointerup", up);
        });
        if (cimg.complete) draw(); else cimg.onload = draw;
        draw();
      },
    });
    if (!r) return showImgFrame(fig);
    try {
      // On recharge l'image en pleine résolution pour découper la zone choisie
      const src = new Image();
      src.src = img.src;
      await src.decode();
      const sw = Math.max(1, Math.round(box.w * src.naturalWidth)), sh = Math.max(1, Math.round(box.h * src.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      canvas.getContext("2d").drawImage(src, box.x * src.naturalWidth, box.y * src.naturalHeight, sw, sh, 0, 0, sw, sh);
      const png = /\.png($|\?)/i.test(img.dataset.upload || img.getAttribute("src") || "");
      const blob = await new Promise((res) => canvas.toBlob(res, png ? "image/png" : "image/jpeg", 0.9));
      const base = (img.dataset.upload || img.getAttribute("src") || "image").split("/").pop().replace(/\.[^.]+$/, "").replace(/^\d+-\w{4}-/, "");
      const path = await storeBlob(blob, `${base}-recadre`, png ? "png" : "jpg");
      pushHistory();
      img.src = ed.uploads[path].blobUrl;
      img.dataset.upload = path;
      // La hauteur fixée ne correspond plus aux nouvelles proportions : on la remet en automatique
      setHeightPx(img, null);
      sync();
      showImgFrame(fig);
      toast("✂️ Image recadrée.");
    } catch (e) {
      toast(`Recadrage impossible : ${e.message}`, true);
    }
  }
  const imgTag = (path) => `<img src="${ed.uploads[path].blobUrl}" data-upload="${path}" alt="">`;

  async function onImagesChosen() {
    const files = [...fileInput.files];
    const t = ed.imageTarget;
    if (!files.length || !t) return;
    const paths = [];
    for (const f of files) paths.push(await storeImage(f));

    if (t.onPaths) {
      t.onPaths(paths);
    } else if (t.figure) {
      pushHistory();
      const fig = t.figure;
      fig.classList.remove("img-empty");
      fig.querySelector(".img-empty-label")?.remove();
      const old = fig.querySelector("img");
      if (old) { old.src = ed.uploads[paths[0]].blobUrl; old.dataset.upload = paths[0]; }
      else fig.insertAdjacentHTML("afterbegin", imgTag(paths[0]));
      sync();
    } else if (t.replaceBlock) {
      replaceBlock(t.replaceBlock, B.image(`<figure class="doc-img">${imgTag(paths[0])}</figure>`));
    } else if (t.carousel) {
      insertRows(row(`<div class="blk blk-carousel"><div class="carousel" data-carousel><div class="car-track">${paths.map((p) => `<figure>${imgTag(p)}</figure>`).join("")}</div></div></div>`));
    } else if (t.carouselOf) {
      pushHistory();
      t.carouselOf.querySelector(".car-track").insertAdjacentHTML("beforeend", paths.map((p) => `<figure>${imgTag(p)}</figure>`).join(""));
      updateCarCount(t.carouselOf.querySelector("[data-carousel]"));
      sync();
    } else {
      insertRows(row(B.image(`<figure class="doc-img">${imgTag(paths[0])}</figure>`)));
    }
    ed.imageTarget = null;
  }

  // ---------- Collage : on garde la mise en forme simple, pas les styles ----------
  function onPastePlain(e) {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }
  function onPasteRich(e) {
    if (!rtOf(e.target)) { onPastePlain(e); return; }
    const html = e.clipboardData.getData("text/html");
    e.preventDefault();
    pushHistory();
    if (html) document.execCommand("insertHTML", false, cleanHtml(html));
    else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    sync();
  }
  const BLOCK_TAGS = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "DIV", "TABLE"];
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = (n) => [...n.childNodes].map((c) => {
      if (c.nodeType === 3) return esc(c.textContent);
      if (c.nodeType !== 1) return "";
      const t = c.tagName;
      const inner = walk(c);
      const st = c.style || {};
      switch (t) {
        case "BR": return "<br>";
        case "P": return inner.trim() ? `<p>${inner}</p>` : "";
        case "H1": case "H2": return `<h2>${inner}</h2>`;
        case "H3": return `<h3>${inner}</h3>`;
        case "H4": case "H5": case "H6": return `<h4>${inner}</h4>`;
        case "UL": case "OL": return `<${t.toLowerCase()}>${inner}</${t.toLowerCase()}>`;
        case "LI": return `<li>${inner}</li>`;
        case "STRONG": return `<strong>${inner}</strong>`;
        case "B": return st.fontWeight === "normal" ? inner : `<strong>${inner}</strong>`;
        case "EM": case "I": return `<em>${inner}</em>`;
        case "U": return `<u>${inner}</u>`;
        case "A": {
          const h = c.getAttribute("href");
          return h ? `<a ${linkAttrs(h)}>${inner}</a>` : inner;
        }
        case "SPAN": {
          let s = inner;
          if (st.fontWeight === "bold" || +st.fontWeight >= 600) s = `<strong>${s}</strong>`;
          if (st.fontStyle === "italic") s = `<em>${s}</em>`;
          return s;
        }
        case "DIV": return [...c.children].some((k) => BLOCK_TAGS.includes(k.tagName)) ? inner : (inner.trim() ? `<p>${inner}</p>` : "");
        case "STYLE": case "SCRIPT": case "META": case "TITLE": return "";
        default: return inner;
      }
    }).join("");
    return walk(doc.body);
  }

  // =========================================================
  // Menu : retrouver / déplacer une page ou un groupe
  // =========================================================
  function findNode(id) {
    let found = null;
    (function walk(arr, parent) {
      arr.forEach((node, idx) => {
        if (found) return;
        if (node.id === id) found = { node, arr, idx, parent };
        if (node.children) walk(node.children, { node, arr, idx, parent });
      });
    })(SITE_DATA.nav, null);
    return found;
  }
  function nodeAt(path) {
    let arr = SITE_DATA.nav, parent = null, node, idx;
    path.forEach((i, depth) => {
      idx = i; node = arr[i];
      if (depth < path.length - 1) { parent = { node, arr, idx: i, parent }; arr = node.children; }
    });
    return { node, arr, idx, parent };
  }
  function uniqueId(title) {
    const base = slug(title);
    let id = base, n = 2;
    while (PAGES[id]) id = `${base}-${n++}`;
    return id;
  }
  function groupOptions() {
    const out = ['<option value="">Menu principal</option>'];
    (function walk(arr, path, depth) {
      arr.forEach((n, i) => {
        if (n.children) {
          out.push(`<option value="${[...path, i].join(".")}">${"— ".repeat(depth + 1)}${n.icon} ${esc(n.title)}</option>`);
          walk(n.children, [...path, i], depth + 1);
        }
      });
    })(SITE_DATA.nav, [], 0);
    return out.join("");
  }
  const parsePath = (s) => (s === "" ? [] : s.split(".").map(Number));

  async function addPage() {
    const r = await modal({
      title: "➕ Nouvelle page",
      html: `<label>Titre<input name="title" required></label>
        <label>Icône (emoji)<input name="icon" value="📄" maxlength="8"></label>
        <label>Emplacement<select name="where">${groupOptions()}</select></label>
        <label>Structure de départ<select name="start">
          <option value="1">1 zone de texte</option>
          <option value="2">2 zones de texte côte à côte</option>
          <option value="3">Titre + 2 colonnes de texte</option>
          <option value="img">Image + texte</option>
        </select></label>`,
      ok: "Créer",
    });
    if (!r) return;
    const node = { id: uniqueId(r.title), title: r.title.trim(), icon: r.icon.trim() || "📄" };
    const where = parsePath(r.where);
    (where.length ? nodeAt(where).node.children : SITE_DATA.nav).push(node);
    const t = (h) => B.text(`<h2>${h}</h2><p>Ton texte ici.</p>`);
    CONTENT[node.id] = {
      1: row(B.text("<p>Ton texte ici.</p>")),
      2: row(t("Colonne 1"), t("Colonne 2")),
      3: row(B.text(`<h2 class="center">${esc(node.title)}</h2>`)) + row(t("Partie 1"), t("Partie 2")),
      img: LAYOUTS[0].html(),
    }[r.start];
    markDirty();
    renderAll(true);
    renderPanel();
    location.hash = node.id;
  }

  async function addGroup() {
    const r = await modal({
      title: "📁 Nouveau groupe",
      html: `<p class="ed-hint">Un groupe est un menu déroulant qui contient des pages.</p>
        <label>Nom<input name="title" required></label>
        <label>Icône (emoji)<input name="icon" value="📂" maxlength="8"></label>
        <label>Emplacement<select name="where">${groupOptions()}</select></label>`,
      ok: "Créer",
    });
    if (!r) return;
    const where = parsePath(r.where);
    (where.length ? nodeAt(where).node.children : SITE_DATA.nav).push({ title: r.title.trim(), icon: r.icon.trim() || "📂", children: [] });
    markDirty();
    renderAll(true);
    renderPanel();
  }

  async function treeAction(path, act) {
    const { node, arr, idx, parent } = nodeAt(path);
    switch (act) {
      case "up": if (idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; break;
      case "down": if (idx < arr.length - 1) [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; break;
      case "out":
        if (!parent) return;
        arr.splice(idx, 1);
        parent.arr.splice(parent.idx + 1, 0, node);
        break;
      case "in": {
        const prev = arr[idx - 1];
        if (!prev?.children) return toast("Pour ranger dans un groupe, place l'élément juste sous ce groupe.", true);
        arr.splice(idx, 1);
        prev.children.push(node);
        break;
      }
      case "open": if (node.id) location.hash = node.id; return;
      case "delete": {
        if (node.id === "accueil") return toast("La page d'accueil ne peut pas être supprimée.", true);
        const isGroup = !!node.children;
        const ok = await modal({
          title: "Supprimer ?",
          html: isGroup
            ? `<p>Supprimer le groupe <strong>${esc(node.title)}</strong> ? Ses pages remontent d'un niveau (elles ne sont pas supprimées).</p>`
            : `<p>Supprimer la page <strong>${esc(node.title)}</strong> et tout son contenu ?</p>`,
          ok: "Supprimer",
        });
        if (!ok) return;
        if (isGroup) arr.splice(idx, 1, ...node.children);
        else {
          arr.splice(idx, 1);
          delete CONTENT[node.id];
          if (currentPage.id === node.id) location.hash = "accueil";
        }
        break;
      }
    }
    markDirty();
    renderAll(true);
    renderPanel();
  }

  // =========================================================
  // Panneau latéral : Insérer / Pages / Réglages
  // =========================================================
  let panelMode = null;
  function togglePanel(mode) {
    if (panelMode === mode) {
      document.getElementById("ed-panel")?.remove();
      document.body.classList.remove("ed-panel-open");
      panelMode = null;
      return;
    }
    panelMode = mode;
    renderPanel();
  }

  function renderPanel() {
    if (!panelMode) return;
    if (ed.scope) panelMode = "insert";   // officier : seulement « Insérer »
    let panel = document.getElementById("ed-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "ed-panel";
      document.body.appendChild(panel);
      panel.addEventListener("mousedown", (e) => { if (e.target.closest(".ins-item, .ins-layout")) e.preventDefault(); });
      panel.addEventListener("click", onPanelClick);
      panel.addEventListener("change", onPanelChange);
    }
    document.body.classList.add("ed-panel-open");
    const tabs = `<div class="ed-tabs">${[["insert", "Insérer"], ["pages", "Pages"], ["settings", "Réglages"]].filter(([k]) => !ed.scope || k === "insert").map(([k, l]) =>
      `<button data-tab="${k}"${panelMode === k ? ' class="active"' : ""}>${l}</button>`).join("")}</div>`;
    const content = { insert: insertPanelHtml, pages: pagesPanelHtml, settings: settingsPanelHtml }[panelMode]();
    panel.innerHTML = `<div class="ed-panel-head">${tabs}<button class="ed-close" data-close title="Fermer">✕</button></div>${content}`;
  }

  function insertPanelHtml() {
    const item = (k, icon, label) => `<button class="ins-item" data-ins="${k}"><span>${icon}</span>${label}</button>`;
    return `
      <div class="ins-top">
        <button class="ins-big" data-ins="text"><span>𝐓</span>Zone de texte</button>
        <button class="ins-big" data-ins="image"><span>🖼️</span>Images</button>
        <button class="ins-big" data-ins="generic"><span>🧩</span>Intégrer</button>
      </div>
      <button class="ins-zone" data-ins="zone">▭ Ajouter une zone (nouveau cadre)</button>
      <h4>Blocs de contenu</h4>
      <div class="ins-layouts">${LAYOUTS.map((l, i) => `<button class="ins-layout" data-layout="${i}" title="${l.name}"><svg viewBox="0 0 90 60">${l.svg}</svg></button>`).join("")}</div>
      <h4>Autres éléments</h4>
      <div class="ins-list">
        ${item("collapse", "↕️", "Groupe réductible")}
        ${item("toc", "☰", "Table des matières")}
        ${item("carousel", "🎞️", "Carrousel d'images")}
        ${item("button", "🔘", "Bouton")}
        ${item("divider", "➖", "Séparateur")}
        ${item("spacer", "⬜", "Espace vide")}
        ${item("social", "👥", "Liens vers les réseaux sociaux")}
        ${item("placeholder", "➕", "Espace réservé")}
        ${["youtube", "calendar", "map", "docs", "slides", "sheets", "forms", "charts"].map((k) => item(k, EMBEDS[k].icon, EMBEDS[k].label)).join("")}
      </div>
      <p class="ed-hint">Les éléments s'ajoutent sous le bloc sélectionné, ou dans la zone / le groupe réductible où tu as cliqué. Ensuite, attrape un bloc par sa bordure ou par ⠿ pour le placer où tu veux : au-dessus, en dessous, à côté d'un autre bloc, dans une autre zone ou dans un groupe réductible.</p>`;
  }

  function pagesPanelHtml() {
    const tree = (arr, path) => `<ul class="ed-tree">${arr.map((n, i) => {
      const p = [...path, i].join(".");
      return `<li>
        <div class="ed-node${n.id === currentPage?.id ? " current" : ""}" data-path="${p}">
          <input class="ed-node-icon" data-edit="icon" value="${esc(n.icon)}" maxlength="8" title="Icône">
          <input class="ed-node-title" data-edit="title" value="${esc(n.title)}" title="${n.children ? "Nom du groupe" : "Titre de la page"}">
          <span class="ed-node-actions">
            ${n.id ? `<button data-tree="open" title="Aller sur cette page">↗</button>` : `<span class="ed-tag">groupe</span>`}
            <button data-tree="up" title="Monter">↑</button>
            <button data-tree="down" title="Descendre">↓</button>
            <button data-tree="out" title="Sortir du groupe">⇤</button>
            <button data-tree="in" title="Ranger dans le groupe au-dessus">⇥</button>
            <button data-tree="delete" title="Supprimer">🗑</button>
          </span>
        </div>
        ${n.children ? tree(n.children, [...path, i]) : ""}
      </li>`;
    }).join("")}</ul>`;
    return `<div class="ed-panel-actions">
        <button class="ed-btn ed-primary" data-add="page">➕ Nouvelle page</button>
        <button class="ed-btn" data-add="group">📁 Nouveau groupe</button>
      </div>
      <p class="ed-hint">↗ ouvre la page pour la modifier. ⇤ sort un élément de son groupe, ⇥ le range dans le groupe juste au-dessus.</p>
      ${tree(SITE_DATA.nav, [])}`;
  }

  function settingsPanelHtml() {
    const s = SITE_DATA.settings, h = SITE_DATA.home;
    const pageOptions = (sel) => Object.values(PAGES).filter((p) => p.id !== "accueil")
      .map((p) => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${p.icon} ${esc(p.title)}</option>`).join("");
    const buttons = h.buttons.map((b, i) => `
      <div class="ed-row" data-list="buttons" data-i="${i}">
        <input data-key="icon" value="${esc(b.icon)}" class="ed-mini" maxlength="8">
        <input data-key="label" value="${esc(b.label)}">
        <select data-key="page">${pageOptions(b.page)}</select>
        <button data-row="up" title="Monter">↑</button><button data-row="delete" title="Supprimer">🗑</button>
      </div>`).join("");
    const featured = h.featured.map((f, i) => `
      <div class="ed-row ed-row-stack" data-list="featured" data-i="${i}">
        <div><select data-key="page">${pageOptions(f.page)}</select>
        <button data-row="up" title="Monter">↑</button><button data-row="delete" title="Supprimer">🗑</button></div>
        <input data-key="text" value="${esc(f.text)}" placeholder="Petite description">
      </div>`).join("");
    return `<h4>Site</h4>
      <label>Nom du site<input data-setting="siteName" value="${esc(s.siteName)}"></label>
      <label>Titre du menu<input data-setting="sidebarTitle" value="${esc(s.sidebarTitle)}"></label>
      <label>Texte du pied de page<input data-setting="footerText" value="${esc(s.footerText)}"></label>
      <label>Crédit<input data-setting="credit" value="${esc(s.credit)}"></label>
      <h4>Connexion Discord</h4>
      <p class="ed-hint">Facultative pour les visiteurs. Colle ici l'« Application ID » de ton application Discord (Developer Portal → OAuth2). Laisse vide pour masquer le bouton « Connexion ».</p>
      <label>ID de l'application Discord<input data-setting="discordClientId" inputmode="numeric" placeholder="ex. 123456789012345678" value="${esc(s.discordClientId || "")}"></label>
      <p class="ed-hint">Adresse de redirection à déclarer dans Discord : <strong>${esc(location.origin + location.pathname)}</strong></p>
      <p class="ed-hint">Les membres de ce serveur Discord qui ont ce rôle sont le CMDM 1010 Fox : étiquette rouge dans le menu de leur profil, accès complet à l'éditeur et à « Gestion des officiers ». Les autres officiers se désignent dans « Gestion → Gestion des officiers ».</p>
      <label>ID du serveur Discord<input data-setting="discordGuildId" inputmode="numeric" value="${esc(s.discordGuildId || "")}"></label>
      <label>ID du ou des rôles « CMDM 1010 Fox » (séparés par une virgule)<input data-setting="discordRoleId" placeholder="ex. 1313599623004160082, 744164481365573692" value="${esc(s.discordRoleId || "")}"></label>
      <h4>Accueil : boutons</h4>
      <p class="ed-hint">Le titre et les textes de l'accueil se modifient directement sur la page d'accueil, et tu peux ajouter des blocs en bas de l'accueil.</p>
      ${buttons}
      <button class="ed-btn" data-add-row="buttons">➕ Ajouter un bouton</button>
      <h4>Accueil : accès rapide</h4>
      ${featured}
      <button class="ed-btn" data-add-row="featured">➕ Ajouter un raccourci</button>`;
  }

  function onPanelClick(e) {
    const t = e.target;
    if (t.closest("[data-close]")) return togglePanel(panelMode);
    const tab = t.closest("[data-tab]");
    if (tab) { panelMode = tab.dataset.tab; return renderPanel(); }
    const ins = t.closest("[data-ins]");
    if (ins) return insertItem(ins.dataset.ins);
    const lay = t.closest("[data-layout]");
    if (lay) return insertRows(LAYOUTS[+lay.dataset.layout].html());
    const add = t.closest("[data-add]");
    if (add) return add.dataset.add === "page" ? addPage() : addGroup();
    const tb = t.closest("[data-tree]");
    if (tb) return treeAction(parsePath(tb.closest(".ed-node").dataset.path), tb.dataset.tree);

    const addRow = t.closest("[data-add-row]");
    if (addRow) {
      const first = Object.values(PAGES).find((p) => p.id !== "accueil");
      if (addRow.dataset.addRow === "buttons") SITE_DATA.home.buttons.push({ icon: first.icon, label: first.title, page: first.id });
      else SITE_DATA.home.featured.push({ page: first.id, text: "" });
      return afterSettingsChange();
    }
    const rowBtn = t.closest("[data-row]");
    if (rowBtn) {
      const r = rowBtn.closest(".ed-row");
      const list = SITE_DATA.home[r.dataset.list], i = +r.dataset.i;
      if (rowBtn.dataset.row === "delete") list.splice(i, 1);
      else if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      return afterSettingsChange();
    }
  }

  function onPanelChange(e) {
    const t = e.target;
    if (t.dataset.edit) {
      const { node } = nodeAt(parsePath(t.closest(".ed-node").dataset.path));
      node[t.dataset.edit] = t.value.trim() || (t.dataset.edit === "icon" ? "📄" : "Sans titre");
      markDirty();
      renderAll(true);
      return;
    }
    if (t.dataset.setting) {
      SITE_DATA.settings[t.dataset.setting] = t.value;
      return afterSettingsChange();
    }
    if (t.dataset.key) {
      const r = t.closest(".ed-row");
      SITE_DATA.home[r.dataset.list][+r.dataset.i][t.dataset.key] = t.value;
      return afterSettingsChange();
    }
  }

  function afterSettingsChange() {
    markDirty();
    renderAll(true);
    renderPanel();
  }

  // =========================================================
  // Enregistrement (bouton « Enregistrer », Ctrl+S)
  // =========================================================
  let publishing = false;
  async function publish() {
    if (publishing) return false;
    sync();
    if (!ed.dirty) { toast("Aucune modification à enregistrer."); return true; }
    publishing = true;
    const btn = document.querySelector('#ed-bar [data-act="publish"]');
    btn.disabled = true;
    setStatus("Enregistrement en cours…");
    try {
      if (ed.scope && ed.orig) {
        // Officier : seules les pages attribuées peuvent changer, tout le reste reste comme à l'ouverture
        for (const k of Object.keys(CONTENT)) if (!ed.scope.includes(k) && !(k in ed.orig)) delete CONTENT[k];
        for (const k of Object.keys(ed.orig)) if (!ed.scope.includes(k)) CONTENT[k] = ed.orig[k];
      }
      const all = JSON.stringify(CONTENT);
      const images = Object.entries(ed.uploads).filter(([path, up]) => !up.done && all.includes(path));
      // Un officier n'écrit que content.js (et ses images) : jamais le menu, les réglages ni la liste des officiers
      const files = [...(ed.scope ? [] : [["site-data.js", serializeSiteData()]]), ["content.js", serializeContent()]];
      if (canWriteFolder()) {
        if (!ed.dir) ed.dir = await chooseFolder(); else await ensureAccess(ed.dir);
        for (const [path, up] of images) { await writeFile(ed.dir, path, up.blob); up.done = true; }
        for (const [name, text] of files) await writeFile(ed.dir, name, text);
        toast(`✅ Enregistré dans le dossier « ${ed.dir.name} ».`);
      } else {
        for (const [name, text] of files) downloadFile(name, text);
        for (const [path, up] of images) { downloadFile(path.split("/").pop(), up.blob); up.done = true; }
        toast("📥 Fichiers téléchargés : remplace " + (ed.scope ? "content.js" : "site-data.js et content.js") + " dans le dossier du site"
          + (images.length ? ", et mets les images dans son sous-dossier « uploads »." : "."));
      }
      ed.dirty = false;
      btn.classList.remove("pending");
      setStatus("Enregistré");
      return true;
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Enregistrement annulé");
        toast("Enregistrement annulé : aucun dossier choisi.", true);
      } else {
        ed.dir = null;   // dossier introuvable ou refusé : on le redemandera
        setStatus("Échec de l'enregistrement");
        toast(`❌ Enregistrement impossible : ${err.message}`, true);
      }
      return false;
    } finally {
      publishing = false;
      btn.disabled = false;
    }
  }

  // ---------- Démarrage ----------
  document.getElementById("edit-open").addEventListener("click", openEditor);
  document.addEventListener("keydown", (e) => {
    if (!ed.active) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); publish(); return; }
    if (e.target.closest?.("input, select, textarea, .ed-modal-wrap")) return;
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  });
  window.addEventListener("scroll", () => { if (ed.selected && !drag) positionBlockTools(); }, { passive: true });
  window.addEventListener("beforeunload", (e) => { if (ed.dirty) { e.preventDefault(); e.returnValue = ""; } });
})();
