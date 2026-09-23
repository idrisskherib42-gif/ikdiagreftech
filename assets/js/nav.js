import { icon } from "./icons.js";
import { currentUser, logout, requireAuth } from "./auth.js";
import { qs, appUrl } from "./util.js";
import { install as installMonitor } from "./monitor.js";

installMonitor();

const BOTTOM_ITEMS = [
  { key: "home", href: appUrl("index.html"), label: "Accueil", icon: "home" },
  { key: "missions", href: appUrl("missions.html"), label: "Missions", icon: "mission" },
  { key: "assistant-terrain", href: appUrl("assistant-terrain.html"), label: "Terrain", icon: "field" },
  { key: "assistant-ia", href: appUrl("assistant-ia.html"), label: "Assistant", icon: "assistant" },
  { key: "outils", href: appUrl("outils.html"), label: "Outils", icon: "tools" },
];

const MENU_GROUPS = [
  {
    title: "Missions",
    items: [
      { key: "home", href: appUrl("index.html"), label: "Accueil", icon: "home" },
      { key: "mission-new", href: appUrl("mission-nouvelle.html"), label: "Nouvelle mission", icon: "plus" },
      { key: "missions", href: appUrl("missions.html"), label: "Mes missions", icon: "mission" },
      { key: "checklists", href: appUrl("checklists.html"), label: "Checklists", icon: "checklist" },
    ],
  },
  {
    title: "Sur le terrain",
    items: [
      { key: "assistant-terrain", href: appUrl("assistant-terrain.html"), label: "Assistant terrain", icon: "field" },
      { key: "assistant-ia", href: appUrl("assistant-ia.html"), label: "Assistant IA", icon: "assistant" },
      { key: "outils", href: appUrl("outils.html"), label: "Outils et calculateurs", icon: "tools" },
    ],
  },
  {
    title: "Réglementaire",
    items: [
      { key: "diagnostics", href: appUrl("diagnostics.html"), label: "Diagnostics (fiches)", icon: "book" },
      { key: "references", href: appUrl("references.html"), label: "Références techniques", icon: "book" },
      { key: "veille", href: appUrl("veille.html"), label: "Veille réglementaire", icon: "bell" },
      { key: "a-venir", href: appUrl("a-venir.html"), label: "Ce qui change bientôt", icon: "clock" },
    ],
  },
  {
    title: "Compte",
    items: [
      { key: "compte", href: appUrl("compte.html"), label: "Mon compte et sauvegarde", icon: "user" },
    ],
  },
];

export function mount(active, { auth = true } = {}) {
  if (auth) {
    const ok = requireAuth();
    if (!ok) return false;
  }
  const host = qs("#app-shell");
  if (!host) return false;
  const user = currentUser();

  host.innerHTML = `
    <header class="topbar">
      <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">${icon("settings")}</button>
      <a class="brand" href="${appUrl("index.html")}">
        <img class="brand-mark" src="${appUrl("assets/img/logo-icon.png")}" alt="IK DIAG" />
        <span class="brand-text"><strong>IK DIAG</strong><small>Réf Technique</small></span>
      </a>
      <div class="topbar-actions">
        ${user ? `<a class="user-chip" href="${appUrl("compte.html")}" style="text-decoration:none;">${icon("user")}<span>${user.fullName}</span></a>` : ""}
      </div>
    </header>

    <nav class="side-drawer" id="side-drawer" aria-hidden="true">
      <div class="side-drawer-inner">
        <div class="side-drawer-head">
          <img class="brand-mark" src="${appUrl("assets/img/logo-icon.png")}" alt="IK DIAG" />
          <div><strong>IK DIAG</strong><br><small>Réf Technique</small></div>
        </div>
        <div class="side-nav">
          ${MENU_GROUPS.map((group) => `
            <p class="side-group-label">${group.title}</p>
            <ul class="side-nav-group">
              ${group.items.map((it) => `
                <li>
                  <a href="${it.href}" class="side-link ${active === it.key ? "is-active" : ""}">
                    ${icon(it.icon)} <span>${it.label}</span>
                  </a>
                </li>`).join("")}
            </ul>
          `).join("")}
          ${user?.role === "admin" ? `
            <p class="side-group-label">Administration</p>
            <ul class="side-nav-group">
              <li><a href="${appUrl("admin.html")}" class="side-link ${active === "admin" ? "is-active" : ""}">${icon("edit")} <span>Back-office</span></a></li>
            </ul>
          ` : ""}
        </div>
        <button class="side-link side-logout" id="logout-btn">${icon("logout")} <span>Déconnexion</span></button>
      </div>
    </nav>
    <div class="side-drawer-backdrop" id="side-drawer-backdrop"></div>

    <nav class="bottom-nav">
      ${BOTTOM_ITEMS.map((it) => `
        <a href="${it.href}" class="bottom-link ${active === it.key ? "is-active" : ""}">
          ${icon(it.icon)}<span>${it.label}</span>
        </a>`).join("")}
    </nav>
  `;

  const drawer = qs("#side-drawer");
  const backdrop = qs("#side-drawer-backdrop");
  const openDrawer = () => { drawer.classList.add("is-open"); backdrop.classList.add("is-open"); };
  const closeDrawer = () => { drawer.classList.remove("is-open"); backdrop.classList.remove("is-open"); };
  qs("#menu-toggle")?.addEventListener("click", openDrawer);
  backdrop?.addEventListener("click", closeDrawer);
  qs("#logout-btn")?.addEventListener("click", logout);

  document.body.classList.add("has-shell");
  return true;
}

export function disclaimerBanner(text) {
  return `<div class="disclaimer">${icon("alert")}<p>${text}</p></div>`;
}
