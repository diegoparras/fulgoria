// Anonimizador BÁSICO de Fulgoria (regex, 100% en el navegador). Tapa la PII
// ESTRUCTURADA típica de un extracto bancario: email, teléfono, tarjeta (Luhn),
// CBU, CUIT/CUIL (con dígito verificador), DNI, IP, secretos y URLs. Para nombres,
// direcciones y todo lo no estructurado → "liberá la bestia": mandá a Escriba, que
// delega en Anonimal (motor ML completo).
//
// Es un PORT fiel del motor `anonimal_lite` (Python) para mantener el ecosistema
// coherente: mismas etiquetas/tipos, mismos tokens («TIPO_N», <<ANOM_DATA>>) y los
// mismos 5 modos. Si cambian los detectores allá, replicar acá. Ver
// anonimal_lite/{common,latam,labels,modes}.py.

// --- Taxonomía: label -> [tipo legible, placeholder OPF] (= labels.py) ---
const LABELS = {
  EMAIL: ["EMAIL", "<PRIVATE_EMAIL>"],
  PHONE: ["TEL", "<PRIVATE_PHONE>"],
  AR_DNI: ["ID", "<ACCOUNT_NUMBER>"],
  AR_CUIT: ["ID", "<ACCOUNT_NUMBER>"],
  AR_CBU: ["ID", "<ACCOUNT_NUMBER>"],
  CREDIT_CARD: ["ID", "<ACCOUNT_NUMBER>"],
  URL: ["URL", "<PRIVATE_URL>"],
  SECRET: ["SECRETO", "<SECRET>"],
  IPV4: ["IP", "<REDACTED>"],
};
const DEFAULT_TYPE = "DATO";
const NUMERIC_TYPES = new Set(["ID", "TEL", "IP"]);
export function typeOf(label) { return (LABELS[label] || [DEFAULT_TYPE])[0]; }
export function placeholderOf(label) { return (LABELS[label] || [null, "<REDACTED>"])[1]; }

// --- Detectores por regex (= common.py + latam.py) ---
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Teléfono: separadores o prefijo +; se exige 7+ dígitos al validar.
const PHONE_RE = /(?<![\w.])(?:\+?\d{1,3}[ .\-]?)?(?:\(\d{1,4}\)[ .\-]?)?\d{2,4}(?:[ .\-]\d{2,4}){1,4}(?![\w])/g;
// Tarjeta: 13-19 dígitos con espacios/guiones; se valida con Luhn.
const CC_RE = /(?<!\d)(?:\d[ \-]?){13,19}(?!\d)/g;
const SECRET_RES = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g,   // OpenAI/Stripe-like
  /\bAKIA[0-9A-Z]{16}\b/g,                  // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,        // GitHub token
  /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g,     // Slack token
];
// CUIT/CUIL: XX-XXXXXXXX-X (separadores opcionales) → módulo 11.
const CUIT_RE = /(?<!\d)(\d{2})[ \-]?(\d{8})[ \-]?(\d)(?!\d)/g;
const CBU_RE = /(?<!\d)\d{22}(?!\d)/g;                    // 22 dígitos exactos
const DNI_DOTTED_RE = /(?<!\d)\d{1,2}\.\d{3}\.\d{3}(?!\d)/g;
const DNI_CTX_RE = /\b(?:dni|d\.n\.i\.?|documento)\b[\s:n°º\-]*((?:\d{1,2}\.?\d{3}\.?\d{3})|\d{7,8})/gi;

function digitsOf(s) { return (s.match(/\d/g) || []).join(""); }

function luhnOk(s) {
  const d = (s.match(/\d/g) || []).map(Number);
  if (d.length < 13) return false;
  let total = 0;
  d.reverse().forEach((n, i) => {
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    total += n;
  });
  return total % 10 === 0;
}

function cuitOk(d11) {
  if (d11.length !== 11) return false;
  const n = [...d11].map(Number);
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const total = w.reduce((acc, wi, i) => acc + wi * n[i], 0);
  let chk = 11 - (total % 11);
  chk = chk === 11 ? 0 : (chk === 10 ? 9 : chk);
  return chk === n[10];
}

// Devuelve spans crudos {label, start, end, text}; pueden solaparse.
function detectRaw(text) {
  const spans = [];
  const push = (label, start, end, t) => spans.push({ label, start, end, text: t });
  for (const m of text.matchAll(EMAIL_RE)) push("EMAIL", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(URL_RE)) push("URL", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(IPV4_RE)) push("IPV4", m.index, m.index + m[0].length, m[0]);
  for (const rx of SECRET_RES) for (const m of text.matchAll(rx)) push("SECRET", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(CC_RE)) if (luhnOk(m[0])) push("CREDIT_CARD", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(CUIT_RE)) if (cuitOk(m[1] + m[2] + m[3])) push("AR_CUIT", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(CBU_RE)) push("AR_CBU", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(DNI_DOTTED_RE)) push("AR_DNI", m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(DNI_CTX_RE)) {
    // marcar solo el número (grupo 1), no la palabra "DNI"
    const off = m[0].indexOf(m[1]);
    push("AR_DNI", m.index + off, m.index + off + m[1].length, m[1]);
  }
  for (const m of text.matchAll(PHONE_RE)) if (digitsOf(m[0]).length >= 7) push("PHONE", m.index, m.index + m[0].length, m[0]);
  return spans;
}

// Prioridad ante solapes: los identificadores específicos le ganan al teléfono;
// el secreto manda. A igual prioridad gana el span más largo (= lite_engine.PRIORITY).
const PRIORITY = { SECRET: 50, CREDIT_CARD: 40, AR_CBU: 40, AR_CUIT: 40, AR_DNI: 35, EMAIL: 30, URL: 30, IPV4: 25, PHONE: 10 };
function resolveOverlaps(spans) {
  const sorted = [...spans].sort((a, b) =>
    a.start - b.start || (b.end - b.start) - (a.end - a.start) || (PRIORITY[b.label] || 0) - (PRIORITY[a.label] || 0));
  const kept = [];
  for (const s of sorted) {
    const clash = kept.find((k) => s.start < k.end && k.start < s.end);
    if (!clash) { kept.push(s); continue; }
    // hay solape: reemplazar al previo solo si este gana (prioridad, luego largo)
    const better = (PRIORITY[s.label] || 0) - (PRIORITY[clash.label] || 0) ||
      (s.end - s.start) - (clash.end - clash.start);
    if (better > 0) { kept[kept.indexOf(clash)] = s; }
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function detect(text) { return resolveOverlaps(detectRaw(String(text || ""))); }

// --- Enmascarado type-aware (= modes._mask_value) ---
function maskValue(frag, typ) {
  const s = String(frag).trim();
  if (!s) return frag;
  if (typ === "EMAIL" && s.includes("@")) {
    const [local, dom] = s.split("@");
    return `${local[0] || "•"}•••@${dom}`;
  }
  if (typ === "URL") return "•••";
  const digits = s.replace(/\D/g, "");
  if (NUMERIC_TYPES.has(typ) || digits.length >= 6) {
    const reveal = Math.max(0, Math.min(4, s.length - 1));
    const last = reveal ? s.slice(-reveal) : "";
    const head = s.slice(0, s.length - reveal).replace(/[0-9A-Za-z]/g, "•");
    return head ? head + last : "••••" + last;
  }
  return s.split(/\s+/).map((w) => (w ? w[0] + "•".repeat(Math.max(1, w.length - 1)) : w)).join(" ");
}

// Hash estable básico (FNV-1a 32-bit → hex). NO es HMAC (eso es del motor completo);
// alcanza para "mismo dato → mismo seudónimo" dentro del navegador.
function hashToken(frag, typ) {
  let h = 0x811c9dc5;
  const s = String(frag).trim().toLowerCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `«${typ}_${(h >>> 0).toString(16).padStart(8, "0")}»`;
}

export const GENERIC_TOKEN = "<<ANOM_DATA>>";
export const MODES = ["off", "typed", "anon", "pseudo", "mask", "hash"];

// Acumula estado por documento: consistencia (mismo dato → mismo token) y, en
// modo pseudo, el mapa reversible token→original. Un Anonymizer por export.
export class Anonymizer {
  constructor(mode = "off") {
    this.mode = MODES.includes(mode) ? mode : "off";
    this._tokenFor = new Map();   // original -> token
    this._counters = new Map();   // tipo -> n
    this.summary = {};            // label -> ocurrencias
  }
  _makeToken(label, text) {
    const typ = typeOf(label);
    if (this.mode === "anon") return GENERIC_TOKEN;
    if (this.mode === "typed") return `[${typ}]`;
    if (this.mode === "mask") return maskValue(text, typ);
    if (this.mode === "hash") return hashToken(text, typ);
    const n = (this._counters.get(typ) || 0) + 1;   // pseudo
    this._counters.set(typ, n);
    return `«${typ}_${n}»`;
  }
  _tokenForText(label, text) {
    if (!this._tokenFor.has(text)) this._tokenFor.set(text, this._makeToken(label, text));
    return this._tokenFor.get(text);
  }
  // Anonimiza un fragmento de texto (una celda) y devuelve el resultado.
  transform(text) {
    if (this.mode === "off") return text == null ? "" : String(text);
    const src = text == null ? "" : String(text);
    const spans = detect(src);
    if (!spans.length) return src;
    let out = "";
    let last = 0;
    for (const s of spans) {
      const tok = this._tokenForText(s.label, s.text);
      this.summary[s.label] = (this.summary[s.label] || 0) + 1;
      out += src.slice(last, s.start) + tok;
      last = s.end;
    }
    return out + src.slice(last);
  }
  // Mapa token→original (solo en pseudo; los tokens son únicos → reversible).
  get mapping() {
    if (this.mode !== "pseudo") return {};
    const map = {};
    for (const [orig, tok] of this._tokenFor) map[tok] = orig;
    return map;
  }
}

const TOKEN_RE = /«[A-Z]+_[0-9A-Za-z]+»/g;
// Re-identifica: reemplaza cada token «TIPO_N» por su original.
export function deanonymize(text, mapping) {
  if (!mapping || !Object.keys(mapping).length) return text;
  return String(text).replace(TOKEN_RE, (t) => (t in mapping ? mapping[t] : t));
}
