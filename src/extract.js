// Motor de extracción flexible y multipágina.
// Columnas con ROLES (no 5 fijas). Fila-ancla por monto presente (robusto a fechas
// corridas, descripciones multilínea, páginas de pie legal). Saldo adaptativo.

export const ROLES = ["fecha", "descripcion", "importe", "debito", "credito", "saldo", "texto", "ignorar"];
const AMOUNT_ROLES = new Set(["importe", "debito", "credito", "saldo"]);
const MOV_ROLES = new Set(["importe", "debito", "credito"]); // suman al saldo
// Fecha: ISO año-primero (2003-10-14, separador / - .) O día-primero con barras (14/10/2003).
// El año-primero solo se reconoce con 4 dígitos al inicio → no choca con el día-primero es-AR.
export const DATE_RE = /\b(?:\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

const OPENING_LABELS = ["saldo inicial", "saldo anterior", "saldo ultimo extracto", "saldo último extracto"];
const CLOSING_LABELS = ["saldo final", "saldo total", "saldo actual", "saldo al"];

// --- Parseo de importe es-AR: "$ 1.234,56" / "-$ 1.234,56" -> número ; "" -> null ---
// Gate "parece plata": exige símbolo $ o coma decimal ",dd". Así NO confunde fechas
// (24/04/26), CUIT (20-26363074-3), CBU ni números de cuenta con importes.
// Modo de lectura de importes: "auto" | "es-AR" | "us". Configurable desde la UI.
let AMOUNT_MODE = "auto";
export function setAmountMode(m) { AMOUNT_MODE = m || "auto"; }

export function parseAmount(s) {
  if (s == null) return null;
  const raw = String(s);
  // "Parece plata" si tiene $ o un decimal de 2 dígitos con coma O punto.
  // Cubre es-AR "1.234,56" y formato yanqui "1,234.56" (¡bind usa este!).
  const looksMoney = /\$/.test(raw) || /\d[.,]\d{2}(?!\d)/.test(raw);
  if (!looksMoney) return null;
  let t = raw.replace(/[^\d.,-]/g, "").trim();
  if (!t || !/\d/.test(t)) return null;
  // Negativo: menos (adelante o atrás) o entre paréntesis (estilo contable).
  const neg = /-/.test(t) || /\(\s*[\d.,]+\s*\)/.test(raw);
  let clean = t.replace(/-/g, "");
  // Separador decimal: forzado por config, o el último de , o . (auto).
  const lastComma = clean.lastIndexOf(","), lastDot = clean.lastIndexOf(".");
  const decSep = AMOUNT_MODE === "es-AR" ? "," : AMOUNT_MODE === "us" ? "."
    : (lastComma > lastDot ? "," : (lastDot > lastComma ? "." : ""));
  if (decSep) {
    const milSep = decSep === "," ? "." : ",";
    clean = clean.split(milSep).join("").replace(decSep, ".");
  }
  if (clean === "" || isNaN(Number(clean))) return null;
  const n = Number(clean);
  return neg ? -n : n;
}

// Para CELDAS de columna (texto unido): toma el ÚLTIMO importe con decimales —el de la
// derecha en columnas right-aligned— para que un nº de referencia pegado adelante no lo
// arruine ("82376869 22.000.000,00" → 22.000.000,00). Conserva signo/paréntesis adyacentes.
function parseAmountCell(s) {
  if (s == null) return null;
  const raw = String(s);
  const ms = [...raw.matchAll(/\d[\d.,]*[.,]\d{1,2}(?!\d)/g)];
  if (!ms.length) return parseAmount(raw);
  const last = ms[ms.length - 1];
  const head = raw.slice(0, last.index), after = raw.slice(last.index + last[0].length);
  const neg = /[-(]\s*\$?\s*$/.test(head) || /^\s*[-)]/.test(after);
  return parseAmount((neg ? "-" : "") + last[0]);
}

function colOf(cx, columns) {
  for (let i = 0; i < columns.length; i++) if (cx >= columns[i].from && cx < columns[i].to) return i;
  return -1;
}

// Agrupa items de UNA página en líneas (por cy con tolerancia).
function groupByLine(items, tol = 0.006) {
  const sorted = [...items].sort((a, b) => a.cy - b.cy || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    if (cur && Math.abs(it.cy - cur.cy) <= tol) {
      cur.items.push(it);
      cur.cy = (cur.cy * (cur.items.length - 1) + it.cy) / cur.items.length;
    } else {
      cur = { cy: it.cy, items: [it] };
      lines.push(cur);
    }
  }
  return lines;
}

function cellText(lineItems, columns) {
  const cells = columns.map(() => []);
  for (const it of lineItems) {
    const c = colOf(it.cx, columns);
    if (c >= 0) cells[c].push(it);
  }
  return cells.map((arr) => arr.sort((a, b) => a.x - b.x).map((t) => t.str).join(" ").replace(/\s+/g, " ").trim());
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Detector heurístico de ReDoS: rechaza CUANTIFICADORES ANIDADOS (el caso de
// backtracking exponencial dominante: (a+)+, (.*)+, ([a-z]*)+ ...). No es exhaustivo,
// pero las reglas se comparten en plantillas y una ajena NO debe poder congelar el
// navegador — acotar la longitud no alcanza (explota con ~33 chars). Ver auditoría 2026-06.
function reDoSRisk(src) {
  const s = String(src || "").replace(/\\./g, ""); // neutraliza escapes (\+, \d, \., ...)
  return /\([^()]*[*+][^()]*\)[*+]/.test(s);        // grupo con cuantificador, cuantificado otra vez
}

// ¿La fila matchea alguna REGLA de exclusión? (por contenido, no por posición).
// rule = { field: "<label>"|"*", match: "contains"|"equals"|"regex"|"empty", value }
function rowExcluded(text, lineText, columns, rules) {
  for (const r of rules) {
    let cell;
    if (!r.field || r.field === "*") cell = lineText;
    else { const i = columns.findIndex((c) => c.label === r.field); if (i < 0) continue; cell = norm(text[i]); }
    const v = norm(r.value);
    if (r.match === "empty") { if (!cell) return true; }
    else if (r.match === "equals") { if (cell === v) return true; }
    // regex: detector de ReDoS + acoto patrón/texto. Las reglas se comparten en plantillas,
    // así que una ajena no debe poder colgar el navegador. Patrón peligroso -> se ignora (fail-safe).
    else if (r.match === "regex") {
      try {
        const src = (r.value || "").slice(0, 200);
        if (reDoSRisk(src)) continue;                 // cuantificador anidado: regla ignorada
        if (new RegExp(src, "i").test(cell.slice(0, 2000))) return true;
      } catch {}
    }
    else if (v && cell.includes(v)) return true; // contains (default)
  }
  return false;
}

// --- Extracción principal ---
// pages = [{ index, items }]  (de loadPdf)
// columns = [{ from, to, role, label }]; rules = reglas de exclusión por contenido
// Devuelve { movements, opening, closing, columns }
//   movement = { fecha, descripcion, saldo, amounts:{<label>:num}, cells:{<label>:str}, _page }
export function extract(pages, columns, rules = []) {
  const idxByRole = (r) => columns.findIndex((c) => c.role === r);
  const saldoIdx = idxByRole("saldo");
  const fechaIdx = idxByRole("fecha");
  const descIdx = idxByRole("descripcion");
  const movIdxs = columns.map((c, i) => (MOV_ROLES.has(c.role) ? i : -1)).filter((i) => i >= 0);

  const netOf = (text) => {
    let s = 0, any = false;
    for (const i of movIdxs) { const v = parseAmountCell(text[i]); if (v == null) continue; any = true; const r = columns[i].role; s += r === "debito" ? -Math.abs(v) : r === "credito" ? Math.abs(v) : v; }
    return { net: s, any };
  };

  // ¿El banco imprime SALDO CORRIDO por fila? (Santander/banco-rio sí; Credicoop no).
  // Decide el modo: con saldo corrido lo usamos de ancla y acotamos por continuidad;
  // sin saldo corrido, el ancla es tener un importe (débito/crédito).
  let saldoMode = false;
  if (saldoIdx >= 0) {
    let movLines = 0, withSaldo = 0;
    for (const pg of pages) for (const line of groupByLine(pg.items)) {
      const text = cellText(line.items, columns);
      if (movIdxs.some((i) => parseAmountCell(text[i]) != null)) { movLines++; if (parseAmountCell(text[saldoIdx]) != null) withSaldo++; }
    }
    saldoMode = movLines > 0 && withSaldo / movLines > 0.6;
  }

  // Cada APERTURA (SALDO INICIAL/ANTERIOR/…) inicia una CUENTA (segmento). Generaliza
  // multi-cuenta: pesos + dólares, o varios productos, en un mismo PDF.
  const segments = [];
  let seg = null, current = null, lastY = -1;
  const startSegment = (op, currency, labeled) => {
    // Al aparecer una cuenta CON rótulo, descartar SOLO cuentas implícitas chicas previas
    // (basura pre-tabla: resúmenes de productos, totales = 0-1 filas). Las cuentas implícitas
    // con movimientos reales (ej: Galicia sin rótulo) se conservan.
    if (labeled) for (let i = segments.length - 1; i >= 0; i--) if (!segments[i].labeled && segments[i].movements.length < 2) segments.splice(i, 1);
    seg = { opening: op, closing: null, currency, movements: [], last: op, closed: false, labeled, breaks: 0 };
    segments.push(seg); current = null;
  };

  for (const pg of pages) {
    for (const line of groupByLine(pg.items)) {
      const gy = pg.index + line.cy; // y global para medir cercanía
      const text = cellText(line.items, columns);
      const saldoVal = saldoIdx >= 0 ? parseAmountCell(text[saldoIdx]) : null;
      const { net, any: anyMov } = netOf(text);
      const lineText = norm(text.join(" ")); // rótulos pueden caer en fecha/combte, no en descripción
      // Reglas de exclusión: filas que el usuario marcó como basura → se ignoran (no rompen continuidad).
      if (rules.length && rowExcluded(text, lineText, columns, rules)) { current = null; continue; }
      const dateMatch = (fechaIdx >= 0 ? text[fechaIdx] : "").match(DATE_RE);
      const isMain = saldoMode ? saldoVal != null : anyMov;

      // Apertura: arranca una cuenta nueva (descarta lo de arriba: resúmenes, totales).
      if (OPENING_LABELS.some((l) => lineText.includes(l))) { if (saldoVal != null) startSegment(saldoVal, detectCurrency(lineText), true); else current = null; continue; }
      // Cierre: cierra la cuenta actual.
      if (CLOSING_LABELS.some((l) => lineText.includes(l))) { if (seg && !seg.closed && saldoVal != null && seg.movements.length > 0) { seg.closing = saldoVal; seg.closed = true; } current = null; continue; }

      if (!seg) { if (isMain) startSegment(null, null, false); else continue; } // sin rótulo: cuenta implícita al 1er movimiento
      if (seg.closed) { current = null; continue; } // cuenta cerrada: esperar próxima apertura

      if (isMain) {
        // Con saldo corrido: límite de la cuenta por continuidad (control de integridad del banco).
        // Si el saldo no encaja con la cadena: la fila es basura (resumen/header repetido por
        // página) y la salteo sin cerrar; la cadena reanuda después. Pero si se acumulan MUCHAS
        // seguidas sin reanudar (>8), es otra tabla → cierro la cuenta.
        if (saldoMode && seg.last != null && Math.abs(saldoVal - round2(seg.last + net)) > 0.01) {
          if ((seg.breaks = (seg.breaks || 0) + 1) > 8) { seg.closed = true; }
          current = null; continue;
        }
        seg.breaks = 0; // la cadena reanudó
        const amounts = {}, cells = {};
        columns.forEach((c, i) => { cells[c.label] = text[i]; if (AMOUNT_ROLES.has(c.role)) amounts[c.label] = parseAmountCell(text[i]); });
        current = { fecha: dateMatch ? dateMatch[0] : "", descripcion: descIdx >= 0 ? text[descIdx] : "", saldo: saldoVal, amounts, cells, _page: pg.index };
        seg.movements.push(current); lastY = gy;
        if (saldoVal != null) seg.last = saldoVal;
      } else if (current && !anyMov && gy - lastY <= 0.05) {
        if (!current.fecha && dateMatch) current.fecha = dateMatch[0];
        if (descIdx >= 0 && text[descIdx]) current.descripcion = (current.descripcion + " " + text[descIdx]).trim();
        lastY = gy;
      } else current = null;
    }
  }

  // Finalizar cada cuenta: filtrar filas fantasma; completar apertura/cierre por defecto.
  const isReal = (m) => m.fecha || columns.some((c) => MOV_ROLES.has(c.role) && m.amounts[c.label] != null);
  for (const s of segments) {
    s.movements = s.movements.filter(isReal);
    if (s.closing == null && s.movements.length && saldoIdx >= 0) s.closing = s.movements[s.movements.length - 1].saldo;
    if (s.opening == null && s.movements.length && saldoIdx >= 0) {
      const n = sumMov(s.movements[0], columns);
      if (s.movements[0].saldo != null && n != null) s.opening = round2(s.movements[0].saldo - n);
    }
    delete s.last; delete s.closed; delete s.labeled; delete s.breaks;
  }
  const segs = segments.filter((s) => s.movements.length);
  const movements = [];
  segs.forEach((s, i) => s.movements.forEach((m) => { m._cuenta = i + 1; m._currency = s.currency; movements.push(m); }));
  return { segments: segs, movements, opening: segs[0] ? segs[0].opening : null, closing: segs.length ? segs[segs.length - 1].closing : null, columns };
}

// Detecta la moneda desde la línea de apertura ("$"/"U$S"/"USD"/"dólares").
function detectCurrency(text) {
  const t = text.toLowerCase();
  if (/u\$s|u\$d|usd|d[oó]lar/.test(t)) return "USD";
  if (/\$|pesos|ars/.test(t)) return "ARS";
  return null;
}

function sumMov(mov, columns) {
  let s = 0, any = false;
  for (const c of columns) {
    if (!MOV_ROLES.has(c.role)) continue;
    const v = mov.amounts[c.label];
    if (v == null) continue;
    any = true;
    if (c.role === "debito") s -= Math.abs(v);
    else if (c.role === "credito") s += Math.abs(v);
    else s += v; // importe con signo
  }
  return any ? s : null;
}

// --- Regla del saldo: global + fila a fila contra el saldo corrido ---
export function balanceCheck(result, tolerance = 0.01) {
  const { movements, opening, closing, columns } = result;
  const hasSaldo = columns.some((c) => c.role === "saldo");
  let sum = 0;
  for (const m of movements) { const v = sumMov(m, columns); if (v != null) sum += v; }
  const computed = opening != null ? round2(opening + sum) : null;
  const globalOk = opening != null && closing != null && Math.abs(computed - closing) <= tolerance;

  // Chequeo fila a fila: saldo[i] == saldo[i-1] + neto[i]. Solo si hay saldo corrido
  // en la mayoría de las filas (Credicoop no lo tiene → no aplica, queda null).
  let rowOk = null, rowMismatches = [];
  const withSaldo = movements.filter((m) => m.saldo != null).length;
  if (hasSaldo && opening != null && movements.length > 0 && withSaldo / movements.length > 0.6) {
    rowOk = true; let prev = opening;
    movements.forEach((m, i) => {
      const net = sumMov(m, columns);
      if (m.saldo == null || net == null) return;
      const expected = round2(prev + net);
      if (Math.abs(expected - m.saldo) > tolerance) { rowOk = false; rowMismatches.push(i); }
      prev = m.saldo;
    });
  }
  return { globalOk, rowOk, rowMismatches, opening, closing, computed, sum: round2(sum), rowCount: movements.length };
}

// --- Anclas para matching: rótulos del header (estructural, SIN datos del cliente) ---
// Toma la línea de títulos de columna que está justo arriba del primer movimiento.
export function extractAnchors(pages, columns) {
  const movRoles = new Set(["importe", "debito", "credito", "saldo"]);
  const saldoIdx = columns.findIndex((c) => c.role === "saldo");
  const probeIdx = saldoIdx >= 0 ? [saldoIdx] : columns.map((c, i) => (movRoles.has(c.role) ? i : -1)).filter((i) => i >= 0);
  for (const pg of pages) {
    const lines = groupByLine(pg.items);
    let headerLine = null;
    for (const line of lines) {
      const text = cellText(line.items, columns);
      if (probeIdx.some((i) => parseAmountCell(text[i]) != null)) {
        if (headerLine) return anchorsFromLine(headerLine);
        break; // primer importe sin header en esta página; probar la siguiente
      }
      if (text.filter((t) => /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(t)).length >= 2) headerLine = line;
    }
  }
  return [];
}
function anchorsFromLine(line) {
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  return line.items
    .filter((it) => /[a-zA-Z]/.test(it.str) && it.str.replace(/[^a-zA-Z0-9]/g, "").length >= 3)
    .map((it) => ({ text: it.str.trim(), x: r4(it.x), y: r4(it.y) }));
}

// Puntaje de coincidencia 0..1: fracción de anclas halladas (mismo texto, ~misma x).
export function matchScore(pages, anchors) {
  if (!anchors || !anchors.length) return 0;
  const items = pages.flatMap((p) => p.items);
  let hit = 0;
  for (const a of anchors) {
    const at = a.text.toLowerCase();
    if (items.some((it) => it.str.trim().toLowerCase() === at && Math.abs(it.x - a.x) < 0.05)) hit++;
  }
  return hit / anchors.length;
}

// --- Auto-detección genérica (best-effort; el usuario corrige) ---
// Clusteriza sobre la página con MÁS importes (la tabla de movimientos), así evita
// carátulas/resúmenes que suelen estar en la página 1.
export function autoDetect(pages) {
  // Clusteriza sobre la página con MÁS importes (la tabla de movimientos), así evita
  // carátulas/resúmenes que suelen estar en la página 1.
  let items = pages[0] ? pages[0].items : [];
  let bestN = items.filter((it) => parseAmount(it.str) != null).length;
  for (const p of pages) {
    const n = p.items.filter((it) => parseAmount(it.str) != null).length;
    if (n > bestN) { bestN = n; items = p.items; }
  }
  // Líneas de datos: las que tienen al menos un importe.
  const amountItems = items.filter((it) => parseAmount(it.str) != null);
  // Fechas de la columna de fecha viven a la izquierda y son CASI solo una fecha (no texto que
  // apenas la contiene, como "Período: 01/06/2026 al 30/06/2026" del header, que ensancharía la
  // banda y se tragaría la descripción). Pido la fecha al inicio y ocupando casi todo el ítem.
  const isDateCell = (s) => { const t = s.trim(); const m = t.match(DATE_RE); return !!m && m.index === 0 && t.length - m[0].length <= 2; };
  const dateItems = items.filter((it) => it.x < 0.30 && isDateCell(it.str));
  if (amountItems.length < 3) return { columns: defaultColumns() };

  const amountCols = clusterBands(amountItems.map((it) => ({ a: it.x, b: it.x + it.w })));
  const dateBand = dateItems.length ? span(dateItems.map((it) => ({ a: it.x, b: it.x + it.w }))) : { a: 0.0, b: 0.10 };

  // Signo: ¿hay importes negativos en columnas que NO sean la última (saldo)?
  const colsRaw = amountCols.slice();
  const saldoBand = colsRaw.length ? colsRaw[colsRaw.length - 1] : { a: 0.85, b: 1 };
  const movBands = colsRaw.slice(0, -1);
  const anyNeg = amountItems.some((it) => parseAmount(it.str) < 0);

  const firstAmt = movBands[0] || saldoBand;
  const columns = [];
  // fecha: desde 0 hasta justo después de la banda de fechas (sin pisar la 1ª columna de importe).
  const fechaTo = Math.min(Math.max(dateBand.b + 0.01, 0.06), firstAmt.a - 0.02);
  columns.push({ from: 0, to: fechaTo, role: "fecha", label: "Fecha" });
  // descripción: hasta justo antes de la primera banda de importe.
  columns.push({ from: fechaTo, to: firstAmt.a - 0.005, role: "descripcion", label: "Descripción" });
  // bandas de importe + saldo: bordes en el punto medio entre banda y banda.
  for (let i = 0; i < colsRaw.length; i++) {
    const isSaldo = i === colsRaw.length - 1;
    const from = columns[columns.length - 1].to;
    const to = isSaldo ? 1 : (colsRaw[i].b + colsRaw[i + 1].a) / 2;
    let role, label;
    if (isSaldo) { role = "saldo"; label = "Saldo"; }
    else if (anyNeg) { role = "importe"; label = movBands.length > 1 ? `Importe ${i + 1}` : "Importe"; }
    else if (movBands.length === 2) { role = i === 0 ? "debito" : "credito"; label = i === 0 ? "Débito" : "Crédito"; }
    else { role = "importe"; label = "Importe"; }
    columns.push({ from, to, role, label });
  }
  // Monotonía + guarda: si algo quedó degenerado, default razonable.
  for (let i = 1; i < columns.length; i++) if (columns[i].from < columns[i - 1].to) columns[i].from = columns[i - 1].to;
  const bad = columns.length < 3 || columns.some((c) => c.to - c.from <= 0.005);
  return { columns: bad ? defaultColumns() : columns };
}

// Default genérico para empezar a marcar a mano cuando la auto-detección no sirve.
function defaultColumns() {
  return [
    { from: 0.00, to: 0.12, role: "fecha", label: "Fecha" },
    { from: 0.12, to: 0.55, role: "descripcion", label: "Descripción" },
    { from: 0.55, to: 0.78, role: "importe", label: "Importe" },
    { from: 0.78, to: 1.00, role: "saldo", label: "Saldo" },
  ];
}

// Agrupa intervalos x en bandas por cercanía; devuelve [{a,b}] de izq a der.
function clusterBands(intervals, gap = 0.03) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((p, q) => p.a - q.a);
  const bands = [];
  let cur = { a: sorted[0].a, b: sorted[0].b, n: 1 };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].a <= cur.b + gap) { cur.b = Math.max(cur.b, sorted[i].b); cur.n++; }
    else { bands.push(cur); cur = { a: sorted[i].a, b: sorted[i].b, n: 1 }; }
  }
  bands.push(cur);
  // Descartar singletons (ruido); columnas reales pueden tener pocas filas (saldo de Credicoop = 2×).
  return bands.filter((b) => b.n >= 2);
}

function span(intervals) { return { a: Math.min(...intervals.map((i) => i.a)), b: Math.max(...intervals.map((i) => i.b)) }; }
function mid(a, b) { return (a + b) / 2; }
function clampMid(a, b) { return a < b ? mid(a, b) : a + 0.02; }
function round2(n) { return Math.round(n * 100) / 100; }
