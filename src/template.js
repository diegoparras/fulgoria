// Construcción y serialización de la plantilla Fulgoria (modelo de columnas con roles),
// fingerprint posicional sin contenido, y export de datos (CSV).

const AMOUNT_ROLES = new Set(["importe", "debito", "credito", "saldo"]);

// Construye el objeto plantilla Fulgoria a partir de las columnas marcadas.
export function buildTemplate({ bank, columns, annotations = [], pageSize, anchors = [], source = "digital", contributor = "anon", createdAt = null, rules = [] }) {
  const tplCols = columns.map((c) => {
    const o = { field: c.label, role: c.role, x_band: { from: round(c.from), to: round(c.to) } };
    if (c.fmt && Object.keys(c.fmt).length) o.fmt = c.fmt; // formato de presentación por columna
    return o;
  });
  const fieldsSpec = {};
  for (const c of columns) {
    if (c.role === "ignorar") continue;
    if (c.role === "fecha") fieldsSpec[c.label] = { type: "date", format: "DD/MM/YYYY" };
    else if (c.role === "descripcion" || c.role === "texto") fieldsSpec[c.label] = { type: "text" };
    else if (c.role === "debito") fieldsSpec[c.label] = { type: "amount", locale: "es-AR", sign: "negative", empty_as: null };
    else if (c.role === "credito") fieldsSpec[c.label] = { type: "amount", locale: "es-AR", sign: "positive", empty_as: null };
    else fieldsSpec[c.label] = { type: "amount", locale: "es-AR", sign: "as_is", empty_as: null };
  }

  const hasSigned = columns.some((c) => c.role === "importe");
  const formula = hasSigned
    ? "opening + sum(importe) == closing"
    : "opening + sum(credito) - sum(debito) == closing";

  return {
    fulgoria_template: "0.1",
    meta: {
      template_id: slug(bank) + "-v1",
      country: "AR",
      bank: bank || "Banco",
      document_type: "extracto_bancario",
      format_version: 1,
      // Huella posicional (djb2 de roles + posiciones + tamaño de página). Sin contenido.
      fingerprint: "extfp1:" + fingerprint(columns, pageSize),
      source,
      contributor: contributor || "anon",
      created_at: createdAt, // fecha de creación de la plantilla (no del extracto)
      multipage: true,
    },
    match: {
      page_size: { w_pt: Math.round(pageSize.w), h_pt: Math.round(pageSize.h), tol: 0.02 },
      // Anclas estructurales (rótulos del header) en posición normalizada. SIN datos del cliente.
      anchors: (anchors || []).map((a) => ({ text: a.text, box: { x: round(a.x), y: round(a.y) }, match: "equals_ci" })),
      min_anchors: Math.min(3, (anchors || []).length),
    },
    geometry: {
      coords: "normalized",
      row_detection: { strategy: "amount_anchor", date_regex: "\\d{2}/\\d{2}/\\d{2,4}", continuation: "append_description", table_bound: "saldo_continuity" },
      columns: tplCols,
    },
    fields: fieldsSpec,
    annotations: annotations.map((a) => ({ field: a.label, type: "text", source: "user" })),
    // Reglas de exclusión de filas por contenido (texto estructural, no datos del cliente).
    rules: (rules || []).map((r) => ({ field: r.field, match: r.match, value: r.value })),
    validation: {
      balance_rule: { enabled: columns.some((c) => c.role === "saldo"), formula, tolerance: 0.01, per_row_check: true },
      row_invariants: [],
    },
    community: { votes_up: 0, votes_down: 0, verified_count: 0, verified_rate: null },
  };
}

// Huella: roles + bordes de columna normalizados + tamaño de página. SIN valores.
export function fingerprint(columns, pageSize) {
  const parts = columns.map((c) => `${c.role}:${round(c.from)}-${round(c.to)}`).join("|");
  return djb2(`${Math.round(pageSize.w)}x${Math.round(pageSize.h)}#${parts}`);
}
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// --- Serializador YAML (subset suficiente para la plantilla) ---
export function toYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((v) => (v && typeof v === "object")
      ? `${pad}- ${toYaml(v, indent + 1).replace(/^\s+/, "")}`
      : `${pad}- ${scalar(v)}`).join("\n");
  }
  if (obj && typeof obj === "object") {
    return Object.keys(obj).map((k) => {
      const v = obj[k];
      if (v && typeof v === "object" && !isInline(v)) return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      if (v && typeof v === "object" && isInline(v)) return `${pad}${k}: ${inlineObj(v)}`;
      return `${pad}${k}: ${scalar(v)}`;
    }).join("\n");
  }
  return scalar(obj);
}
function isInline(v) {
  if (Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length <= 4 && keys.every((k) => typeof v[k] !== "object" || v[k] === null);
}
function inlineObj(v) { return "{ " + Object.entries(v).map(([k, val]) => `${k}: ${scalar(val)}`).join(", ") + " }"; }
function scalar(v) {
  if (v === null) return "null";
  if (typeof v === "string") return /[:#]|^\s|\s$/.test(v) ? JSON.stringify(v) : v;
  return String(v);
}
export function toJson(obj) { return JSON.stringify(obj, null, 2); }

// --- Formato por columna (presentación de importes y fechas) ---
// Resuelve el formato efectivo de una columna mezclando su `fmt` con los defaults globales.
export function resolveColFmt(column, def = {}) {
  const f = column.fmt || {};
  return {
    value: f.value || def.value || "asis",        // asis | neg | pos (fuerza el signo del valor)
    sign: f.sign || def.sign || "minus",          // minus(-) | paren(()) | trailing(-) | none
    currency: f.currency != null ? f.currency : (def.currency || false),
    thousands: f.thousands != null ? f.thousands : (def.thousands != null ? def.thousands : true),
    decimal: f.decimal || def.decimal || ",",
    dateFmt: f.dateFmt || def.dateFmt || "DD/MM/YYYY",     // patrón de fecha (libre)
    pattern: f.pattern || def.pattern || "",               // patrón de importe (estilo Excel, libre)
  };
}
// Formatea un importe. Si hay `pattern` (estilo Excel), manda; si no, formato estructurado.
export function formatAmount(value, fmt) {
  if (value == null) return "";
  if (fmt.pattern) return formatAmountPattern(value, fmt.pattern);
  let v = value;
  if (fmt.value === "neg") v = -Math.abs(v);
  else if (fmt.value === "pos") v = Math.abs(v);
  const dec = fmt.decimal || ",";
  const thou = dec === "," ? "." : ",";
  let [i, d] = Math.abs(v).toFixed(2).split(".");
  if (fmt.thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, thou);
  let body = (fmt.currency ? "$ " : "") + i + dec + d;
  if (v >= 0 || Object.is(v, 0)) return body;
  if (fmt.sign === "paren") return "(" + body + ")";
  if (fmt.sign === "trailing") return body + "-";
  if (fmt.sign === "none") return body;
  return "-" + body;
}

// Patrón de importe estilo Excel: "positivo;negativo". Ej: "$ #.##0,00;($ #.##0,00)".
// En el bloque numérico, el ÚLTIMO de . o , es el decimal; el otro es separador de miles;
// la cantidad de 0/# tras el decimal son los decimales. Todo lo demás es literal.
export function formatAmountPattern(value, pattern) {
  if (value == null) return "";
  const sections = String(pattern).split(";");
  const neg = value < 0;
  let useMinus = false, sec;
  if (neg && sections[1] != null) sec = sections[1];
  else { sec = sections[0]; useMinus = neg; }
  const m = sec.match(/[0#][0#.,]*/);
  if (!m) return (useMinus ? "-" : "") + sec; // sin token numérico
  const tok = m[0], pre = sec.slice(0, m.index), post = sec.slice(m.index + tok.length);
  const li = Math.max(tok.lastIndexOf("."), tok.lastIndexOf(","));
  let decimal = "", thousands = "", decimals = 0, intTok = tok;
  if (li >= 0) {
    // Es DECIMAL solo si lo siguen 1-2 dígitos (centavos); si lo siguen 3, es separador de miles.
    const after = (tok.slice(li + 1).match(/[0#]/g) || []).length;
    if (after >= 1 && after <= 2) { decimal = tok[li]; decimals = after; intTok = tok.slice(0, li); }
  }
  for (const ch of [".", ","]) if (ch !== decimal && intTok.includes(ch)) { thousands = ch; break; }
  let s = Math.abs(value).toFixed(decimals);
  let [i, d] = s.split(".");
  if (thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  let num = decimals > 0 ? i + decimal + (d || "") : i;
  return (useMinus ? "-" : "") + pre + num + post;
}

// --- CSV de los movimientos extraídos (+ columnas de anotación), configurable ---
// opts = { sep, decimal, dateFmt, bom, debitoSign, thousands } (defaults globales)
export function rowsToCsv(movements, columns, annotations = [], annoValues = [], opts = {}) {
  const o = { sep: ",", decimal: ",", dateFmt: "DD/MM/YYYY", bom: true, debitoSign: "auto", thousands: true, ...opts };
  const baseDef = { decimal: o.decimal, dateFmt: o.dateFmt, thousands: o.thousands };
  const globalValue = o.debitoSign === "negative" ? "neg" : o.debitoSign === "positive" ? "pos" : "asis";
  // Anonimización básica: solo se aplica a TEXTO (descripción, texto, anotaciones), nunca a importes/fechas.
  const anon = typeof o.anon === "function" ? o.anon : (s) => s;
  const cols = columns.filter((c) => c.role !== "ignorar");
  const multi = movements.some((m) => m._cuenta > 1); // varias cuentas → columna "Cuenta"
  const cell = (v) => {
    const s = String(v ?? "");
    return s.includes(o.sep) || /[\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = [...(multi ? ["Cuenta"] : []), ...cols.map((c) => c.label), ...annotations.map((a) => a.label)].map(cell).join(o.sep);
  const body = movements.map((m, ri) => {
    const cuenta = multi ? [cell(m._currency || "Cuenta " + m._cuenta)] : [];
    const cells = cols.map((c) => {
      const f = resolveColFmt(c, { ...baseDef, value: c.role === "debito" ? globalValue : "asis" });
      if (c.role === "fecha") return cell(formatDate(m.fecha, f.dateFmt));
      if (c.role === "descripcion") return cell(anon(m.descripcion));
      if (c.role === "saldo") return cell(formatAmount(m.saldo, { ...f, value: "asis" }));
      if (AMOUNT_ROLES.has(c.role)) return cell(formatAmount(m.amounts[c.label], f));
      return cell(anon(m.cells[c.label] || ""));
    });
    const annos = annotations.map((a) => cell(anon((annoValues[ri] || {})[a.label] || "")));
    return [...cuenta, ...cells, ...annos].join(o.sep);
  }).join("\n");
  return (o.bom ? "﻿" : "") + head + "\n" + body + "\n";
}

// Misma data que rowsToCsv pero como tabla Markdown (GFM) — para el handoff a Escriba.
export function rowsToMarkdown(movements, columns, annotations = [], annoValues = [], opts = {}) {
  const o = { decimal: ",", dateFmt: "DD/MM/YYYY", debitoSign: "auto", thousands: true, ...opts };
  const baseDef = { decimal: o.decimal, dateFmt: o.dateFmt, thousands: o.thousands };
  const globalValue = o.debitoSign === "negative" ? "neg" : o.debitoSign === "positive" ? "pos" : "asis";
  const anon = typeof o.anon === "function" ? o.anon : (s) => s;
  const cols = columns.filter((c) => c.role !== "ignorar");
  const multi = movements.some((m) => m._cuenta > 1);
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
  const headCells = [...(multi ? ["Cuenta"] : []), ...cols.map((c) => c.label), ...annotations.map((a) => a.label)];
  const head = "| " + headCells.map(cell).join(" | ") + " |";
  const sep = "| " + headCells.map(() => "---").join(" | ") + " |";
  const body = movements.map((m, ri) => {
    const cuenta = multi ? [cell(m._currency || "Cuenta " + m._cuenta)] : [];
    const cells = cols.map((c) => {
      const f = resolveColFmt(c, { ...baseDef, value: c.role === "debito" ? globalValue : "asis" });
      if (c.role === "fecha") return cell(formatDate(m.fecha, f.dateFmt));
      if (c.role === "descripcion") return cell(anon(m.descripcion));
      if (c.role === "saldo") return cell(formatAmount(m.saldo, { ...f, value: "asis" }));
      if (AMOUNT_ROLES.has(c.role)) return cell(formatAmount(m.amounts[c.label], f));
      return cell(anon(m.cells[c.label] || ""));
    });
    const annos = annotations.map((a) => cell(anon((annoValues[ri] || {})[a.label] || "")));
    return "| " + [...cuenta, ...cells, ...annos].join(" | ") + " |";
  }).join("\n");
  return head + "\n" + sep + "\n" + body + "\n";
}

// Reformatea una fecha leída a un PATRÓN LIBRE de tokens.
// Tokens: DD/D (día), MM/M (mes), AAAA|YYYY (año 4), AA|YY (año 2). Separadores: los que quieras.
// Ej: "DD/MM/YYYY", "AAAA-MM-DD", "DD.MM.AA", "D-M-YY". "" o "as-is" = tal cual.
export function formatDate(raw, pattern) {
  if (!pattern || pattern === "as-is") return raw || "";
  const m = String(raw || "").match(/(\d{1,4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,4}))?/);
  if (!m) return raw || "";
  let [, a, mo, c] = m;
  // 4 dígitos al inicio = ISO año-primero (AAAA-MM-DD); si no, día-primero (DD/MM/AAAA).
  const d = (a.length === 4 ? c : a) || "";
  const y = a.length === 4 ? a : c;
  const y4 = y ? (y.length === 2 ? "20" + y : y) : "";
  const map = { AAAA: y4, YYYY: y4, AA: y4.slice(-2), YY: y4.slice(-2), DD: d.padStart(2, "0"), MM: mo.padStart(2, "0"), D: String(+d), M: String(+mo) };
  return pattern.replace(/AAAA|YYYY|DD|MM|AA|YY|D|M/g, (t) => map[t]);
}

export function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) { return (s || "banco").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "banco"; }
function round(n) { return Math.round(n * 1e4) / 1e4; }
