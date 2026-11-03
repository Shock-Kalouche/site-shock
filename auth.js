// =========================================================
// Connexion facultative avec Discord.
// Tout se passe dans le navigateur (connexion « implicite » de Discord).
// Portées demandées : « identify » (pseudo, avatar) et
// « guilds.members.read » (rôles sur le serveur de la Shock).
// Les membres du serveur ayant le rôle de gérant voient une étiquette rouge « 1010 Fox »
// et ont accès complet à l'éditeur et à la page « Gestion des officiers ».
// Aucun serveur ni compte externe : la vérification du rôle se fait dans le navigateur.
// Les identifiants se règlent dans site-data.js (settings.discord…)
// ou dans l'éditeur. Le bouton n'apparaît que si le site est ouvert via une
// adresse web (http/https) déclarée dans Discord, pas depuis un fichier local.
// =========================================================

(function () {
  const STORE = "shock-discord";
  const STATE = "shock-discord-state";
  const API = "https://discord.com/api/v10";
  const SCOPE = "identify guilds.members.read";
  // Valeurs par défaut si les réglages sont vides
  const DEFAULT_GUILD = "733070665569140769";
  const DEFAULT_ROLES = "1313599623004160082, 744164481365573692";   // rôles « CMDM 1010 Fox »
  const guildId = () => (SITE_DATA.settings.discordGuildId || DEFAULT_GUILD).trim();
  // Un ou plusieurs rôles (séparés par une virgule) donnent le statut de gérant « CMDM 1010 Fox »
  const roleIds = () => String(SITE_DATA.settings.discordRoleId || DEFAULT_ROLES).split(/[\s,;]+/).filter(Boolean);

  const store = {
    get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
    set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
    del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
  };
  const clientId = () => (SITE_DATA.settings.discordClientId || "").trim();
  const canLogin = () => /^https?:$/.test(location.protocol);
  // Adresse de retour : la page du site sans le #… (à déclarer telle quelle dans Discord)
  // (« …/index.html » et « …/ » sont ramenés à la même adresse : une seule à déclarer dans Discord)
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

  let session = store.get(STORE);
  if (session && session.expires < Date.now()) { store.del(STORE); session = null; }

  // ---------- Retour de Discord : #access_token=…&state=… ----------
  // Lu avant le routeur (script.js) pour que l'adresse ne soit pas prise pour une page.
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("access_token") || params.has("error")) {
    const saved = store.get(STATE, sessionStorage);
    store.del(STATE, sessionStorage);
    let back = "";
    if (saved && saved.nonce === params.get("state")) {
      back = saved.back || "";
      if (params.has("access_token")) {
        session = {
          token: params.get("access_token"),
          expires: Date.now() + (+params.get("expires_in") || 3600) * 1000,
          scope: params.get("scope") || "",
          user: null,
        };
        store.set(STORE, session);
      }
    }
    history.replaceState(null, "", location.pathname + location.search + back);
  }

  function login() {
    if (!clientId() || !canLogin()) return;
    const nonce = crypto.getRandomValues(new Uint32Array(4)).join("-");
    store.set(STATE, { nonce, back: location.hash }, sessionStorage);
    const q = new URLSearchParams({
      client_id: clientId(),
      response_type: "token",
      redirect_uri: redirectUri(),
      scope: SCOPE,
      state: nonce,
      prompt: "none",
    });
    location.href = `https://discord.com/oauth2/authorize?${q}`;
  }

  function logout() {
    store.del(STORE);
    session = null;
    window.SHOCK_USER = null;
    render();
    document.dispatchEvent(new CustomEvent("auth:change", { detail: null }));
  }

  // Profil Discord et rôles (gardés en mémoire 5 minutes : un rôle retiré est vite pris en compte)
  async function loadUser() {
    if (!session) return;
    if (session.user && Date.now() - session.user.fetched < 3e5) return;
    try {
      const r = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (r.status === 401) return logout();
      if (!r.ok) return;
      const u = await r.json();
      session.user = { id: u.id, username: u.username, name: u.global_name || u.username, avatar: u.avatar, fetched: Date.now(), ...(await loadMembership()) };
      store.set(STORE, session);
    } catch { /* hors ligne : on garde l'ancien profil */ }
  }

  // Membre du serveur de la Shock ? Avec le rôle de gérant ?
  // (une ancienne connexion sans la portée guilds.members.read n'est pas vérifiable)
  async function loadMembership() {
    if (!(session.scope || "").split(" ").includes("guilds.members.read")) return { inGuild: false, manager: false };
    try {
      const r = await fetch(`${API}/users/@me/guilds/${guildId()}/member`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!r.ok) return { inGuild: false, manager: false };   // 404 / 403 : pas sur le serveur
      const m = await r.json();
      return { inGuild: true, manager: (m.roles || []).some((r) => roleIds().includes(r)) };
    } catch {
      return { inGuild: false, manager: false };
    }
  }

  const avatarUrl = (u) => u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

  const DISCORD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.06a19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1 0-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1 0 .13 12.3 12.3 0 0 1-1.87.89.08.08 0 0 0-.04.11c.36.7.78 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z"/></svg>`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- Bouton dans la barre du haut ----------
  function render() {
    const box = document.getElementById("auth");
    if (!box) return;
    const u = session?.user;
    window.SHOCK_USER = u || null;
    if (u) {
      box.innerHTML = `<button type="button" class="auth-user" aria-haspopup="true" aria-expanded="false" title="Connecté avec Discord">
          <img src="${esc(avatarUrl(u))}" alt=""><span>${esc(u.name)}</span></button>
        <div class="auth-menu" hidden>
          <p class="auth-who">${DISCORD_ICON}<span>Connecté en tant que<strong>${esc(u.name)}</strong><small>@${esc(u.username)}</small></span></p>
          ${u.manager ? `<p class="auth-badge">1010 Fox</p>` : ""}
          <button type="button" class="auth-logout">Se déconnecter</button>
        </div>`;
    } else if (session) {
      box.innerHTML = "";   // profil en cours de chargement
    } else if (clientId() && canLogin()) {
      box.innerHTML = `<button type="button" class="auth-login" title="Se connecter avec Discord (facultatif)">${DISCORD_ICON}<span>Connexion</span></button>`;
    } else {
      box.innerHTML = "";   // connexion Discord pas encore configurée
    }
  }

  document.addEventListener("click", (e) => {
    const box = document.getElementById("auth");
    if (!box) return;
    const menu = box.querySelector(".auth-menu");
    if (e.target.closest(".auth-login")) return login();
    if (e.target.closest(".auth-logout")) return logout();
    const toggle = e.target.closest(".auth-user");
    if (toggle && menu) {
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
    } else if (menu && !e.target.closest(".auth-menu")) {
      menu.hidden = true;
      box.querySelector(".auth-user")?.setAttribute("aria-expanded", "false");
    }
  });

  window.renderAuth = render;
  let loading = true;   // profil en cours de chargement
  window.SHOCK_AUTH = {
    login, logout,
    get user() { return session?.user || null; },
    get pending() { return loading && !!session && !session.user; },
    get available() { return !!clientId() && canLogin(); },   // bouton « Connexion » utilisable ?
  };

  render();
  loadUser().then(() => {
    loading = false;
    render();
    document.dispatchEvent(new CustomEvent("auth:change", { detail: session?.user || null }));
  });
})();
