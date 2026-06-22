// i18n de Fulgoria — contrato del ecosistema Escriba.
// El HTML marca strings con: data-i18n (textContent), data-i18n-html (innerHTML, para
// strings con <b>/<em>), data-i18n-ph (placeholder), data-i18n-title (title + aria-label).
// El español viene incluido (es la fuente); los demás idiomas se cargan on-demand.
import es from "./i18n/es.js";

export const LANGS = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
];

const LS_KEY = "fulgoria-lang";
const TABLES = { es };
let active = "es";

function pickInitial() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s && LANGS.some((l) => l.code === s)) return s;
  } catch {}
  const navs = navigator.languages || [navigator.language || "es"];
  for (const l of navs) {
    const b = String(l || "").toLowerCase().split("-")[0];
    if (LANGS.some((x) => x.code === b)) return b;
  }
  return "es";
}

export function t(key) {
  const tbl = TABLES[active] || es;
  if (tbl && tbl[key] != null) return tbl[key];
  return es[key] != null ? es[key] : key; // fallback al español, luego a la clave
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const v = t(el.getAttribute("data-i18n-title"));
    el.setAttribute("title", v);
    if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", v);
  });
  document.title = t("doc.title");
  document.documentElement.lang = active;
}

async function loadTable(lang) {
  if (TABLES[lang]) return TABLES[lang];
  try {
    const m = await import(`./i18n/${lang}.js`);
    TABLES[lang] = m.default;
    return m.default;
  } catch {
    return es; // si falta el archivo del idioma, caemos al español
  }
}

export async function setLang(lang) {
  if (!LANGS.some((l) => l.code === lang)) lang = "es";
  await loadTable(lang);
  active = lang;
  try { localStorage.setItem(LS_KEY, lang); } catch {}
  applyI18n();
}

export async function initI18n() {
  const sel = document.getElementById("langSelect");
  if (sel) {
    sel.innerHTML = LANGS.map((l) => `<option value="${l.code}">${l.label}</option>`).join("");
    sel.addEventListener("change", () => setLang(sel.value));
  }
  const initial = pickInitial();
  if (sel) sel.value = initial;
  await setLang(initial);
}
