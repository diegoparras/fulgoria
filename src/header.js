// Fulgoria · header compartido. TODAS las páginas lo arman desde acá, así no vuelven a divergir.
//
// Uso: en el HTML, como primer hijo del <body>,
//   <header class="topbar" data-topbar data-pagina="inicio|conciliar">
//     <div class="topbar-ctrl">…controles propios de la sección (opcional)…</div>
//     <template data-menu data-titulo="nav.extractor">…ítems propios para el menú ⋮ (opcional)…</template>
//   </header>
//   <script src="src/header.js"></script>
// Es un script clásico y sincrónico: el header queda armado antes del primer pintado (sin saltos)
// y antes de que corra el módulo de la página, que encuentra sus botones con los mismos id.
// Respeta el CSP (script-src 'self'): nada inline. El i18n se carga con import() del mismo origen.
(function () {
  "use strict";
  const head = document.querySelector("header[data-topbar]");
  if (!head) return;
  const SRC = document.currentScript && document.currentScript.src;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ico = (s, body, cls = "ico") => `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const P = {
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    swap: '<path d="M7 7h12l-4-4M17 17H5l4 4"/>',
    cols: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    news: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h0"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    dots: '<circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/>',
  };
  const LOGO = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#3b76d9"/><path d="M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z" transform="translate(2,2) scale(2.5)" fill="#ffffff"/></svg>';

  // Las secciones de Fulgoria. Inicio y Extractor son la misma página (index.html): el Extractor es
  // la portada sin el hero, con el documento al frente. Conciliar es su propia página.
  const SECCIONES = [
    { id: "inicio", href: "./", key: "nav.home", txt: "Inicio", ico: P.bolt },
    { id: "conciliar", href: "conciliar.html", key: "nav.conciliar", txt: "Conciliar", ico: P.swap },
    { id: "extractor", href: "./#extractor", key: "nav.extractor", txt: "Extractor", ico: P.cols },
  ];
  const pagina = head.dataset.pagina || "inicio";
  const enIndex = pagina !== "conciliar";
  let seccion = pagina === "conciliar" ? "conciliar" : location.hash === "#extractor" ? "extractor" : "inicio";

  // i18n: hasta que carga, los textos van en español (son los mismos del HTML de siempre).
  let I = null;
  const t = (key, fallback) => (I ? I.t(key) : fallback);

  // ---- Armado -------------------------------------------------------------------------------
  const ctrl = head.querySelector(".topbar-ctrl");
  const tpl = head.querySelector("template[data-menu]");
  const propios = tpl ? tpl.content.cloneNode(true) : null;
  const tituloPropios = tpl && tpl.dataset.titulo, tituloTxt = (tpl && tpl.dataset.tituloTxt) || "";

  const itemSeccion = (s) =>
    `<a class="menu-item menu-sec" role="menuitem" href="${s.href}" data-nav="${s.id}">` +
    `${ico(16, s.ico)}<span data-i18n="${s.key}">${s.txt}</span>${ico(15, P.check, "ico mi-check")}</a>`;

  head.innerHTML =
    `<div class="topbar-brand">` +
      `<a class="brand" href="./" data-nav="inicio" data-i18n-title="nav.home.title" title="Ir al inicio" aria-label="Ir al inicio">` +
        `<span class="logo">${LOGO}</span><span class="brand-name">Fulgoria</span></a>` +
      `<span class="brand-sec" id="brandSec"></span>` +
    `</div>` +
    `<div class="menu-wrap">` +
      `<button id="btnMenu" class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="actionMenu" data-i18n-title="menu.more" title="Más acciones" aria-label="Más acciones">` +
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P.dots}</svg></button>` +
      `<div id="actionMenu" class="menu menu-right" role="menu" hidden>` +
        `<div id="menuUser" class="menu-user" hidden></div>` +
        `<div class="menu-label" data-i18n="nav.sections">Secciones</div>` +
        SECCIONES.map(itemSeccion).join("") +
        `<div class="menu-sep"></div>` +
        `<div id="menuPropios" hidden></div>` +
        `<div id="langRow" class="menu-item lang-row" data-menu-queda>` +
          `${ico(16, P.globe)}<span data-i18n="lang.label">Idioma</span>` +
          `<select id="langSelect" class="langsel" title="Idioma" aria-label="Idioma"></select></div>` +
        (enIndex ? "" : `<p class="menu-note" data-i18n="nav.soloEs">Conciliar está, por ahora, solo en español.</p>`) +
        `<button id="themeBtn" class="menu-item" type="button" role="menuitem"></button>` +
        `<button id="btnNews" class="menu-item" type="button" role="menuitem">${ico(16, P.news)}<span data-i18n="menu.news">Novedades</span></button>` +
        `<button id="btnAbout" class="menu-item" type="button" role="menuitem">${ico(16, P.info)}<span data-i18n="menu.about">Acerca de Fulgoria</span></button>` +
        `<div class="menu-sep" data-salir></div>` +
        `<a href="/logout" id="btnSalir" class="menu-item" role="menuitem" data-salir>${ico(16, P.out)}<span data-i18n="logout">Salir</span></a>` +
      `</div>` +
    `</div>`;
  // Los controles propios de la sección van a la derecha, antes del menú.
  if (ctrl) head.insertBefore(ctrl, head.querySelector(".menu-wrap"));
  if (propios) {
    const box = $("menuPropios");
    box.hidden = false;
    if (tituloPropios) box.insertAdjacentHTML("beforeend", `<div class="menu-label" data-i18n="${esc(tituloPropios)}">${esc(tituloTxt)}</div>`);
    box.appendChild(propios);
    box.insertAdjacentHTML("beforeend", `<div class="menu-sep"></div>`);
  }

  // Modales canónicos del ecosistema: "Acerca de" y "Novedades" (salen del CHANGELOG).
  const modal = (id, cls, inner) =>
    `<div id="${id}" class="modal" hidden><div class="modal-backdrop" data-close></div>` +
    `<div class="modal-card ${cls}" role="dialog" aria-modal="true" aria-labelledby="${id}Title">` +
    `<button class="modal-close" type="button" data-close data-i18n-title="common.close" title="Cerrar" aria-label="Cerrar">${ico(18, P.x)}</button>${inner}</div></div>`;
  document.body.insertAdjacentHTML("beforeend",
    modal("aboutModal", "about-card",
      `<h2 id="aboutModalTitle" data-i18n="about.title">Acerca de Fulgoria</h2>` +
      `<p class="modal-lead" data-i18n="about.tagline">Extraé datos de cualquier documento, 100% en tu navegador.</p>` +
      `<dl class="about-rows"><dt data-i18n="about.version">Versión</dt><dd><span id="aboutVersion">—</span> · ` +
      `<button id="aboutNews" class="linkbtn" type="button" data-i18n="about.news">Qué cambió</button></dd>` +
      `<dt data-i18n="about.role">Rol en la suite</dt><dd data-i18n="about.roleVal">Satélite · Ecosistema Escriba</dd></dl>` +
      `<p class="about-foot">Diego Parras · Ecosistema Escriba</p>`) +
    modal("newsModal", "news-card",
      `<h2 id="newsModalTitle" data-i18n="news.title">Novedades</h2><p id="newsLead" class="modal-lead"></p><div id="newsBody"></div>` +
      `<div class="news-actions"><button class="btn primary" type="button" data-close data-i18n="news.ok">Entendido</button></div>`));
  const version = (document.querySelector('meta[name="fulgoria-version"]')?.content || "").trim();
  $("aboutVersion").textContent = version ? "v" + version : "—";

  // ---- Sección actual -----------------------------------------------------------------------
  function pintarSeccion() {
    document.body.dataset.seccion = seccion;
    const s = SECCIONES.find((x) => x.id === seccion);
    // En la portada el header dice solo "Fulgoria": es la puerta de entrada a las dos secciones.
    $("brandSec").innerHTML = seccion === "inicio" ? "" : `${ico(15, s.ico)}<span data-i18n="${s.key}">${esc(t(s.key, s.txt))}</span>`;
    $("brandSec").hidden = seccion === "inicio";
    head.querySelectorAll(".menu-sec").forEach((a) => {
      if (a.dataset.nav === seccion) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function irA(id, { historial = true } = {}) {
    if (!enIndex || id === "conciliar" || id === seccion) return false;
    seccion = id;
    if (historial) history.replaceState(null, "", id === "extractor" ? "#extractor" : location.pathname + location.search);
    pintarSeccion();
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("fulgoria:seccion", { detail: { seccion } }));
    return true;
  }
  pintarSeccion();
  // Inicio y Extractor viven en la misma página: se cambia sin recargar (no se pierde el documento).
  head.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || !enIndex || a.dataset.nav === "conciliar" || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    cerrarMenu();
    irA(a.dataset.nav);
  });
  window.addEventListener("hashchange", () => irA(location.hash === "#extractor" ? "extractor" : "inicio", { historial: false }));

  // ---- Menú ⋮ -------------------------------------------------------------------------------
  const menu = $("actionMenu"), btn = $("btnMenu");
  const itemsMenu = () => [...menu.querySelectorAll("a[href], button, select")].filter((x) => x.offsetParent !== null && !x.hidden);
  function abrirMenu() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  function cerrarMenu(foco) { if (menu.hidden) return; menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (foco) btn.focus(); }
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? abrirMenu() : cerrarMenu(); });
  // Se cierra al elegir algo, salvo en lo que se usa adentro (idioma, plantillas guardadas).
  menu.addEventListener("click", (e) => { if (e.target.closest(".menu-item, a") && !e.target.closest("[data-menu-queda]")) cerrarMenu(); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest(".menu-wrap")) cerrarMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!menu.hidden) { cerrarMenu(true); e.stopImmediatePropagation(); return; }
      for (const id of ["newsModal", "aboutModal"]) if (!$(id).hidden) { $(id).hidden = true; e.stopImmediatePropagation(); return; }
    }
    if (!menu.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.target.matches("select")) {
      e.preventDefault();
      const its = itemsMenu(), i = its.indexOf(document.activeElement);
      const n = e.key === "ArrowDown" ? (i + 1) % its.length : (i <= 0 ? its.length - 1 : i - 1);
      its[n]?.focus();
    }
  }, true);

  // Selector segmentado (role=tablist): flechas, Inicio y Fin mueven la selección (patrón de pestañas).
  document.addEventListener("keydown", (e) => {
    const tab = e.target.closest && e.target.closest('.seg [role="tab"]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...tab.closest(".seg").querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(tab);
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[n].focus(); tabs[n].click();
  });

  // ---- Tema claro/oscuro (claro por defecto, persistido) --------------------------------------
  function pintarTema() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const label = dark ? t("menu.theme.light", "Tema claro") : t("menu.theme.dark", "Tema oscuro");
    const b = $("themeBtn");
    b.innerHTML = ico(16, dark ? P.sun : P.moon) + `<span>${esc(label)}</span>`;
    b.title = label; b.setAttribute("aria-label", label);
  }
  $("themeBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("fulgoria.theme", next); } catch {}
    pintarTema();
    document.dispatchEvent(new CustomEvent("fulgoria:tema", { detail: { tema: next } }));
  });
  pintarTema();

  // ---- Acerca de y Novedades ------------------------------------------------------------------
  const ti = (key, fallback, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll("{" + k + "}", v), t(key, fallback));
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const novHtml = (vs) => vs.map((v) =>
    `<div class="nov-ver"><b>v${esc(v.version)}</b>${v.fecha ? `<span>${esc(v.fecha)}</span>` : ""}</div>` +
    v.secciones.map((s) => `<div class="nov-sec">${md(s.titulo)}</div><ul class="nov-list">${s.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul>`).join(""),
  ).join("");
  async function novFetch(qs) {
    const r = await fetch("/api/novedades" + qs, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  function mostrarNovedades(r, lead) {
    $("newsLead").innerHTML = lead;
    $("newsBody").innerHTML = r.versiones.length ? novHtml(r.versiones) : `<p class="modal-lead">${esc(t("news.empty", "No hay notas para esta versión."))}</p>`;
    $("newsModal").hidden = false;
  }
  // Aparece solo una vez después de una actualización (la última versión vista queda en el navegador).
  const NOV_KEY = "fulgoria.versionVista";
  async function avisarNovedades() {
    let vista = null;
    try { vista = localStorage.getItem(NOV_KEY); } catch {}
    let r;
    try { r = await novFetch(vista ? "?desde=" + encodeURIComponent(vista) : ""); } catch { return; }
    try { localStorage.setItem(NOV_KEY, r.version); } catch {}
    if (vista === r.version || !r.versiones.length) return;
    if (document.querySelector(".modal:not([hidden]), .modal-back:not([hidden])")) return; // no tapar lo que se abrió
    mostrarNovedades(r, ti("news.updated", "Fulgoria se actualizó a la {v}. Esto cambió desde la última versión que viste:", { v: "<b>v" + esc(r.version) + "</b>" }));
  }
  async function novedadesTodas() {
    $("aboutModal").hidden = true;
    try {
      const r = await novFetch("?todas=1");
      mostrarNovedades({ ...r, versiones: r.versiones.slice(0, 15) }, ti("news.history", "Versión instalada: {v}. Últimas versiones, de la más nueva a la más vieja:", { v: "<b>v" + esc(r.version) + "</b>" }));
    } catch { aviso(t("news.error", "No se pudieron cargar las novedades.")); }
  }
  $("btnNews").addEventListener("click", novedadesTodas);
  $("aboutNews").addEventListener("click", novedadesTodas);
  $("btnAbout").addEventListener("click", () => { $("aboutModal").hidden = false; });
  for (const id of ["aboutModal", "newsModal"]) $(id).addEventListener("click", (e) => { if (e.target.closest("[data-close]")) $(id).hidden = true; });
  function aviso(msg) {
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove("show"), 3000);
  }

  // ---- Sesión: quién entró (modo estudio) y si hay login ---------------------------------------
  fetch("/api/v1/estado", { credentials: "same-origin", headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((e) => {
      if (!e) return;
      if (e.modoUsuarios === "sin_login") head.querySelectorAll("[data-salir]").forEach((x) => { x.hidden = true; });
      else if (e.usuario) {
        const u = $("menuUser");
        u.textContent = e.rol ? `${e.usuario} · ${e.rol}` : e.usuario;
        u.hidden = false;
      }
    })
    .catch(() => {});

  // ---- i18n (mismo módulo que usa la página: una sola instancia) -------------------------------
  const listo = (SRC ? import(new URL("i18n.js", SRC).href) : Promise.reject(new Error("sin src")))
    .then(async (m) => {
      I = m;
      document.addEventListener("fulgoria:idioma", () => { pintarTema(); pintarSeccion(); });
      await m.initI18n();
      pintarTema(); pintarSeccion();
    })
    .catch(() => {});
  listo.then(() => setTimeout(avisarNovedades, 400));

  window.FulgoriaHeader = { listo, seccion: (id) => irA(id), get actual() { return seccion; }, cerrarMenu };
})();
