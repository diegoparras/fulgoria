// Orquestación de la UI: multipágina, columnas con roles (marcado manual), campos
// de anotación propios, tabla en vivo, saldo adaptativo y export.
import { loadPdf, renderPage, renderToCanvas } from "./pdf.js";
import { ocrCanvas, imageFileToCanvas } from "./ocr.js";
import { extract, balanceCheck, autoDetect, extractAnchors, matchScore, setAmountMode, parseAmount, ROLES } from "./extract.js";
import { buildTemplate, toYaml, toJson, rowsToCsv, rowsToMarkdown, download, resolveColFmt, formatAmount, formatDate } from "./template.js";
import { Anonymizer } from "./anon.js";

const $ = (id) => document.getElementById(id);

// Íconos de línea del ecosistema (SVG, nunca emojis). `s` = tamaño en px.
const svg = (s, body) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24">${body}</svg>`;
const ICON = {
  x: (s = 12) => svg(s, '<path d="M18 6 6 18M6 6l12 12"/>'),
  ban: (s = 13) => svg(s, '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>'),
  gear: (s = 13) => svg(s, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  spark: (s = 15) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/></svg>`,
};

const ROLE_LABELS = {
  fecha: "Fecha", descripcion: "Descripción", importe: "Importe (con signo)",
  debito: "Débito", credito: "Crédito", saldo: "Saldo", texto: "Texto / dato", ignorar: "Ignorar",
};

const state = {
  pdf: null,         // { numPages, pages }
  columns: [],       // [{ from, to, role, label }]
  annotations: [],   // [{ label }]  campos propios (no están en el PDF)
  annoValues: [],    // por índice de movimiento: { label: valor }
  curPage: 0,
  result: null,            // resultado EFECTIVO = rawResult + ediciones (lo que se ve/exporta)
  rawResult: null,         // extracción pristina (nunca se muta)
  cellEdits: {},           // correcciones de celda: "cuenta:fila:campo" -> texto
  deletedRows: new Set(),  // filas extraídas ocultadas: "cuenta:fila"
  addedRows: [],           // filas agregadas a mano: { aid, si, vals:{campo->texto} }
  balanceEdits: {},        // apertura/cierre forzados: "cuenta:opening" | "cuenta:closing" -> texto
  annoStore: {},           // valores de campos propios por IDENTIDAD de fila: "_id" -> {label: valor}
  history: [], future: [], // deshacer / rehacer (snapshots)
  aidSeq: 0,               // contador de filas agregadas
  bank: "",
  cssHeight: 0,
  placing: null,            // estado de "marcar nueva columna" (barra inicio/fin)
  pendingTemplate: null,    // plantilla a aplicar cuando se abra un PDF
  rules: [],                // reglas de exclusión de filas (por contenido)
};

// ---------- Carga ----------
async function onFile(file) {
  setBusy(true); setOcrProgress("");
  try {
    if (file.type && file.type.startsWith("image/")) {
      state.pdf = await loadImageDoc(file);              // imagen → OCR
    } else {
      const model = await loadPdf(new Uint8Array(await file.arrayBuffer()));
      if (isScanned(model)) await ocrAllPages(model);     // PDF escaneado → OCR por página
      state.pdf = model;
    }
    setOcrProgress(null);
    state.annotations = []; state.annoValues = []; state.curPage = 0; state.rules = []; resetEdits();
    if (state.pendingTemplate) {
      applyTemplate(state.pendingTemplate); state.pendingTemplate = null;
    } else {
      const m = bestMatch(state.pdf); // ¿reconozco el banco por una plantilla guardada?
      if (m && m.score >= 0.6) {
        applyTemplate(m.tpl);
        showMatch(m.tpl.meta && m.tpl.meta.bank, m.score);
      } else {
        state.columns = autoDetect(state.pdf.pages).columns;
        state.bank = guessBank(state.pdf.pages[0].items);
        showMatch(null);
      }
    }
    $("bankName").value = state.bank;
    $("emptyState").style.display = "none";
    $("workspace").style.display = "grid";
    // Datos primero: tabla + saldo no dependen del canvas.
    renderColumnsPanel();
    renderAnnotations();
    renderRules();
    recompute();
    coachOnce();
  } finally { setBusy(false); setOcrProgress(null); }
  // El render del PDF va aparte y no bloquea los datos (un tab oculto puede demorarlo).
  renderCurrentPage().catch((e) => console.warn("render", e));
}

function setBusy(b) { document.body.classList.toggle("busy", b); }
function setOcrProgress(msg) { const el = $("ocrProgress"); if (!el) return; if (msg) { el.textContent = msg; el.style.display = "block"; } else { el.style.display = "none"; } }

// ¿El PDF no tiene capa de texto? (escaneado) → muy pocos items por página.
function isScanned(model) {
  const tot = model.pages.reduce((a, p) => a + p.items.length, 0);
  return model.pages.length > 0 && tot / model.pages.length < 5;
}
async function ocrAllPages(model) {
  for (let i = 0; i < model.pages.length; i++) {
    const pg = model.pages[i];
    setOcrProgress(`Leyendo página ${i + 1}/${model.pages.length} con OCR…`);
    const canvas = await renderToCanvas(pg.page, 1600);
    pg.items = await ocrCanvas(canvas, (p) => setOcrProgress(`OCR página ${i + 1}/${model.pages.length} — ${Math.round(p * 100)}%`));
    pg.ocrCanvas = canvas; pg.W = canvas.width; pg.H = canvas.height;
  }
  model.scanned = true;
}
async function loadImageDoc(file) {
  setOcrProgress("Leyendo imagen con OCR…");
  const canvas = await imageFileToCanvas(file);
  const items = await ocrCanvas(canvas, (p) => setOcrProgress(`OCR — ${Math.round(p * 100)}%`));
  return { numPages: 1, scanned: true, pages: [{ index: 1, page: null, W: canvas.width, H: canvas.height, items, ocrCanvas: canvas }] };
}
function guessBank(items) {
  // Palabras del encabezado que sean texto real (no fragmentos sueltos ni números).
  const top = items.filter((it) => it.y < 0.18 && /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(it.str) && it.str.replace(/[^a-zA-Z]/g, "").length >= 3);
  if (!top.length) return "Banco";
  // Agrupar por línea y armar el texto de cada una.
  const byLine = {};
  for (const it of top) { const k = Math.round(it.y * 200); (byLine[k] ||= []).push(it); }
  const lines = Object.values(byLine).map((arr) => ({
    h: Math.max(...arr.map((i) => i.h)),
    text: arr.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
  }));
  // Preferir una línea que mencione un banco; si no, la del texto más grande.
  const named = lines.find((l) => /banco|coop|galicia|santander|macro|provincia|naci[oó]n|supervielle|credicoop|industrial|ciudad|icbc|bind|brubank|patagonia|hsbc|bbva/i.test(l.text));
  const best = named || lines.sort((a, b) => b.h - a.h)[0];
  return best.text.slice(0, 40).trim() || "Banco";
}

// ---------- Render de la página actual + overlay de columnas ----------
async function renderCurrentPage() {
  const wrap = $("pdfWrap");
  wrap.innerHTML = "";
  const pg = state.pdf.pages[state.curPage];
  let canvas, cssHeight;
  if (pg.ocrCanvas) {
    canvas = pg.ocrCanvas;                 // imagen/escaneado: usamos el canvas ya rasterizado
    canvas.style.width = "100%"; canvas.style.height = "auto";
    cssHeight = (wrap.clientWidth || 540) * canvas.height / canvas.width;
  } else {
    ({ canvas, cssHeight } = await renderPage(pg.page, wrap.clientWidth || 540));
  }
  canvas.id = "pdfCanvas";
  state.cssHeight = cssHeight;
  wrap.appendChild(canvas);
  const overlay = document.createElement("div");
  overlay.id = "overlay";
  overlay.addEventListener("click", onOverlayClick);
  wrap.appendChild(overlay);
  $("pageLabel").textContent = `Página ${state.curPage + 1} / ${state.pdf.numPages}`;
  layoutOverlay();
}

function layoutOverlay() {
  const overlay = $("overlay");
  if (!overlay) return;
  overlay.innerHTML = "";
  overlay.classList.toggle("placing", !!state.placing);
  const pct = (v) => v * 100 + "%";

  state.columns.forEach((c, i) => {
    // banda sombreada con su color de rol
    const band = document.createElement("div");
    band.className = "col-band r-" + c.role;
    band.style.left = pct(c.from);
    band.style.width = pct(Math.max(0, c.to - c.from));
    const lab = document.createElement("div");
    lab.className = "col-band-label";
    lab.textContent = c.label + " ";
    const del = document.createElement("button");
    del.className = "band-del"; del.innerHTML = ICON.x(10); del.title = "Quitar columna";
    del.addEventListener("click", (e) => { e.stopPropagation(); removeColumn(i); });
    lab.appendChild(del);
    band.appendChild(lab);
    overlay.appendChild(band);
    // barra de inicio y barra de fin, independientes
    for (const edge of ["from", "to"]) {
      const bar = document.createElement("div");
      bar.className = "edge edge-" + (edge === "from" ? "start" : "end") + " r-" + c.role;
      bar.style.left = pct(c[edge]);
      bar.title = edge === "from" ? "Inicio de la columna" : "Fin de la columna";
      bar.addEventListener("pointerdown", (e) => startEdgeDrag(e, i, edge));
      overlay.appendChild(bar);
    }
  });

  // fantasma: primera barra ya marcada, esperando la segunda
  if (state.placing && state.placing.startX != null) {
    const g = document.createElement("div");
    g.className = "edge ghost";
    g.style.left = pct(state.placing.startX);
    overlay.appendChild(g);
  }
}

// ---------- Nueva columna: marcar barra de inicio y barra de fin ----------
function startPlacing() {
  state.placing = { startX: null };
  setHint("Nueva columna: marcá el INICIO (click en el PDF). Esc para cancelar.");
  layoutOverlay();
}
function cancelPlacing() { state.placing = null; setHint(""); layoutOverlay(); }

function onOverlayClick(e) {
  if (!state.placing) return;
  const rect = $("pdfWrap").getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (state.placing.startX == null) {
    state.placing.startX = x;
    setHint("Ahora marcá el FIN de la columna. Esc para cancelar.");
    layoutOverlay();
  } else {
    const from = Math.min(state.placing.startX, x), to = Math.max(state.placing.startX, x);
    state.placing = null; setHint("");
    if (to - from > 0.01) {
      state.columns.push({ from, to, role: "texto", label: "Nueva" });
      sortColumns(); renderColumnsPanel(); recompute();
    }
    layoutOverlay();
  }
}
function setHint(msg) {
  const el = $("placeHint");
  if (el) { el.textContent = msg; el.style.display = msg ? "block" : "none"; }
}
function removeColumn(i) {
  state.columns.splice(i, 1);
  renderColumnsPanel(); layoutOverlay(); recompute();
}
function sortColumns() { state.columns.sort((a, b) => a.from - b.from); }

// ---------- Drag de barras (inicio / fin) independientes ----------
let drag = null;
function startEdgeDrag(e, i, edge) {
  if (state.placing) return;
  e.preventDefault(); e.stopPropagation();
  drag = { i, edge };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag, { once: true });
  document.body.classList.add("dragging");
}
function onDragMove(e) {
  if (!drag) return;
  const rect = $("pdfWrap").getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const c = state.columns[drag.i];
  if (drag.edge === "from") c.from = Math.min(x, c.to - 0.01);
  else c.to = Math.max(x, c.from + 0.01);
  layoutOverlay();
  scheduleRecompute();
}
function endDrag() {
  drag = null;
  window.removeEventListener("pointermove", onDragMove);
  document.body.classList.remove("dragging");
  sortColumns(); renderColumnsPanel(); recompute();
}
let raf = 0;
function scheduleRecompute() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; recompute(); }); }

// Defaults de formato para la tabla (lo que ves = lo que exportás).
function tableDefaults() {
  return { decimal: settings.csvDecimal, dateFmt: settings.dateFmt, thousands: true, debitoValue: settings.debitoSign === "negative" ? "neg" : settings.debitoSign === "positive" ? "pos" : "asis" };
}
const hasFmt = (role) => isAmount(role) || role === "fecha";

// ---------- Panel de columnas (roles + formato por columna) ----------
function renderColumnsPanel() {
  const host = $("columnsPanel");
  host.innerHTML = "";
  state.columns.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "col-row";
    const name = document.createElement("input");
    name.className = "col-name"; name.value = c.label;
    name.addEventListener("input", () => { c.label = name.value || "Campo"; layoutOverlay(); recompute(); });
    const sel = document.createElement("select");
    sel.className = "col-role r-" + c.role;
    for (const r of ROLES) {
      const o = document.createElement("option");
      o.value = r; o.textContent = ROLE_LABELS[r]; if (r === c.role) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { c.role = sel.value; sel.className = "col-role r-" + c.role; renderColumnsPanel(); layoutOverlay(); recompute(); });
    const del = document.createElement("button");
    del.className = "col-del"; del.innerHTML = ICON.x(12); del.title = "Quitar columna";
    del.addEventListener("click", () => { removeColumn(i); });

    if (hasFmt(c.role)) {
      const gear = document.createElement("button");
      gear.className = "col-fmt-btn"; gear.innerHTML = ICON.gear(13); gear.title = "Formato de presentación";
      const panel = buildFmtPanel(c);
      panel.style.display = c._fmtOpen ? "" : "none";
      gear.addEventListener("click", () => { c._fmtOpen = !c._fmtOpen; panel.style.display = c._fmtOpen ? "" : "none"; });
      row.append(name, sel, gear, del);
      host.appendChild(row);
      host.appendChild(panel);
    } else {
      const spacer = document.createElement("span"); spacer.className = "col-fmt-spacer";
      row.append(name, sel, spacer, del); // hueco en el carril del engranaje → todo alineado
      host.appendChild(row);
    }
  });
  if ($("ruleField")) renderRules(); // mantener el dropdown de campos en sync con las columnas
}

// Panel desplegable de formato de una columna (importes o fecha).
function buildFmtPanel(c) {
  const p = document.createElement("div");
  p.className = "col-fmt";
  const f = c.fmt || (c.fmt = {});
  const set = (k, v) => { if (v === "") delete f[k]; else f[k] = v === "true" ? true : v === "false" ? false : v; recompute(); };
  const ctl = (label, opts, cur) => {
    const w = document.createElement("label"); w.className = "fmt-ctl";
    const s = document.createElement("select");
    for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === cur) o.selected = true; s.appendChild(o); }
    w.append(document.createTextNode(label), s);
    return [w, s];
  };
  const add = (label, opts, cur, key) => { const [w, s] = ctl(label, opts, cur); s.addEventListener("change", () => set(key, s.value)); p.appendChild(w); };
  // Campo de texto libre (patrón) que ocupa toda la fila.
  const addPattern = (label, hint, cur, key) => {
    const w = document.createElement("label"); w.className = "fmt-ctl fmt-wide";
    const inp = document.createElement("input"); inp.type = "text"; inp.value = cur || ""; inp.placeholder = hint;
    inp.addEventListener("input", () => set(key, inp.value.trim()));
    w.append(document.createTextNode(label), inp);
    p.appendChild(w);
  };

  if (c.role === "fecha") {
    addPattern("Patrón de fecha (vacío = global)", "DD/MM/YYYY · AAAA-MM-DD · DD.MM.AA …", f.dateFmt, "dateFmt");
    const leg = document.createElement("p"); leg.className = "fmt-legend";
    leg.textContent = "Tokens: DD/D día · MM/M mes · AAAA/YYYY año · AA/YY año corto. Separadores: los que quieras.";
    p.appendChild(leg);
  } else {
    addPattern("Patrón propio (vacío = usar opciones de abajo)", "$ #.##0,00;($ #.##0,00)", f.pattern, "pattern");
    const leg = document.createElement("p"); leg.className = "fmt-legend";
    leg.textContent = "Estilo Excel: positivo;negativo. El último . o , es el decimal, el otro miles. Ej: #,##0.00;(#,##0.00)";
    p.appendChild(leg);
    add("Negativos", [["", "Global"], ["minus", "−1.234,56"], ["paren", "(1.234,56)"], ["trailing", "1.234,56−"], ["none", "Sin signo"]], f.sign || "", "sign");
    add("Moneda", [["", "Global"], ["true", "Con $"], ["false", "Sin $"]], f.currency == null ? "" : String(f.currency), "currency");
    add("Miles", [["", "Global"], ["true", "Con separador"], ["false", "Sin separador"]], f.thousands == null ? "" : String(f.thousands), "thousands");
    add("Decimal", [["", "Global"], [",", "Coma (,)"], [".", "Punto (.)"]], f.decimal || "", "decimal");
    if (c.role !== "saldo") add("Valor", [["", "Global"], ["asis", "Como viene"], ["neg", "Siempre negativo"], ["pos", "Siempre positivo"]], f.value || "", "value");
  }
  return p;
}

// ---------- Campos de anotación propios ----------
function renderAnnotations() {
  const host = $("annoList");
  host.innerHTML = "";
  state.annotations.forEach((a, i) => {
    const chip = document.createElement("span");
    chip.className = "anno-chip";
    chip.textContent = a.label;
    const x = document.createElement("button");
    x.innerHTML = ICON.x(11); x.title = "Quitar campo";
    x.addEventListener("click", () => { state.annotations.splice(i, 1); renderAnnotations(); renderResult(); });
    chip.appendChild(x);
    host.appendChild(chip);
  });
}
function addAnnotation() {
  const inp = $("annoInput");
  const label = inp.value.trim();
  if (!label) return;
  state.annotations.push({ label });
  inp.value = "";
  renderAnnotations(); renderResult();
}

// ---------- Reglas de exclusión de filas (por contenido) ----------
const MATCH_LABELS = { contains: "contiene", equals: "es igual a", regex: "regex", empty: "está vacía" };
function renderRules() {
  // opciones de campo: cualquier celda + columnas no ignoradas
  const fieldSel = $("ruleField");
  if (fieldSel) {
    const cur = fieldSel.value;
    fieldSel.innerHTML = `<option value="*">Cualquier celda</option>` +
      state.columns.filter((c) => c.role !== "ignorar").map((c) => `<option value="${esc(c.label)}">${esc(c.label)}</option>`).join("");
    if ([...fieldSel.options].some((o) => o.value === cur)) fieldSel.value = cur;
  }
  const host = $("rulesList");
  host.innerHTML = "";
  state.rules.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    const field = r.field === "*" || !r.field ? "cualquier celda" : r.field;
    const txt = r.match === "empty" ? `Saltear si ${field} está vacía` : `Saltear si ${field} ${MATCH_LABELS[r.match] || "contiene"} “${r.value}”`;
    const span = document.createElement("span"); span.className = "rule-text"; span.textContent = txt;
    const del = document.createElement("button"); del.className = "rule-del"; del.innerHTML = ICON.x(11); del.title = "Quitar regla";
    del.addEventListener("click", () => { state.rules.splice(i, 1); renderRules(); recompute(); });
    row.append(span, del);
    host.appendChild(row);
  });
  $("rulesCount").textContent = state.rules.length ? `(${state.rules.length})` : "";
}
function addRule() {
  const field = $("ruleField").value, match = $("ruleMatch").value, value = $("ruleValue").value.trim();
  if (match !== "empty" && !value) return;
  state.rules.push({ field, match, value });
  $("ruleValue").value = "";
  renderRules(); recompute();
}
// Crear una regla a partir de una fila de ejemplo (botón de excluir en la tabla).
function excludeFromExample(mov) {
  const descCol = state.columns.find((c) => c.role === "descripcion");
  let field = "*", value = norm(mov.descripcion || "");
  if (descCol && mov.descripcion) field = descCol.label;
  if (!value) { // sin descripción: usar la celda de texto más larga
    const cell = Object.values(mov.cells || {}).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
    value = norm(cell);
  }
  if (!value) return;
  state.rules.push({ field, match: "contains", value });
  renderRules(); recompute();
  const block = $("rulesBlock"); if (block) block.open = true;
}
const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

// ---------- Extracción + tabla + saldo ----------
function recompute() {
  if (!state.pdf) return;
  state.rawResult = extract(state.pdf.pages, state.columns, state.rules);
  applyEdits();
  renderResult();
}

// Campo-clave de una columna en el overlay de ediciones.
function editField(c) {
  if (c.role === "fecha") return "fecha";
  if (c.role === "descripcion") return "descripcion";
  if (c.role === "saldo") return "saldo";
  if (isAmount(c.role)) return "amt:" + c.label;
  return "cell:" + c.label;
}
// Escribe un valor de texto en la celda de un movimiento según el rol de la columna.
function setCell(mm, c, v) {
  if (c.role === "fecha") mm.fecha = v;
  else if (c.role === "descripcion") mm.descripcion = v;
  else if (c.role === "saldo") mm.saldo = v.trim() === "" ? null : parseAmount(v);
  else if (isAmount(c.role)) mm.amounts[c.label] = v.trim() === "" ? null : parseAmount(v);
  else mm.cells[c.label] = v;
}
// Construye state.result = extracción pristina + ediciones (celdas, filas borradas/agregadas,
// apertura/cierre forzados). Cada movimiento lleva un `_id` ESTABLE ("cuenta:fila" o "add:N") para
// que los campos propios (annoStore) viajen con la fila aunque se borren/agreguen filas.
function applyEdits() {
  const raw = state.rawResult;
  if (!raw) { state.result = null; state.annoValues = []; return; }
  const ed = state.cellEdits, del = state.deletedRows, be = state.balanceEdits;
  const cols = state.columns.filter((c) => c.role !== "ignorar");
  const segs = raw.segments.map((s, si) => {
    const movements = [];
    s.movements.forEach((m, ri) => {
      if (del.has(`${si}:${ri}`)) return;                       // fila borrada a mano
      const mm = { ...m, amounts: { ...m.amounts }, cells: { ...m.cells }, _id: `${si}:${ri}` };
      for (const c of cols) { const k = `${si}:${ri}:${editField(c)}`; if (k in ed) setCell(mm, c, ed[k]); }
      movements.push(mm);
    });
    state.addedRows.filter((a) => a.si === si).forEach((a) => {  // filas agregadas a mano
      const mm = { fecha: "", descripcion: "", saldo: null, amounts: {}, cells: {}, _id: "add:" + a.aid };
      for (const c of cols) { const v = a.vals[editField(c)]; if (v != null) setCell(mm, c, v); }
      movements.push(mm);
    });
    let opening = s.opening, closing = s.closing;
    if (be[`${si}:opening`] != null && be[`${si}:opening`] !== "") opening = parseAmount(be[`${si}:opening`]);
    if (be[`${si}:closing`] != null && be[`${si}:closing`] !== "") closing = parseAmount(be[`${si}:closing`]);
    return { ...s, opening, closing, movements };
  });
  const movements = [];
  segs.forEach((s, i) => s.movements.forEach((m) => { m._cuenta = i + 1; m._currency = s.currency; movements.push(m); }));
  state.annoValues = movements.map((m) => ({ ...(state.annoStore[m._id] || {}) }));  // alineado al orden final
  state.result = { segments: segs, movements, opening: segs[0] ? segs[0].opening : null, closing: segs.length ? segs[segs.length - 1].closing : null, columns: raw.columns };
}

// ----- Deshacer / rehacer: snapshot completo del estado de edición (los datos son chicos) -----
function snapshot() { return JSON.stringify({ cellEdits: state.cellEdits, deletedRows: [...state.deletedRows], addedRows: state.addedRows, balanceEdits: state.balanceEdits, annoStore: state.annoStore }); }
function restoreSnap(s) { const o = JSON.parse(s); state.cellEdits = o.cellEdits; state.deletedRows = new Set(o.deletedRows); state.addedRows = o.addedRows; state.balanceEdits = o.balanceEdits; state.annoStore = o.annoStore; }
function pushHistory() { state.history.push(snapshot()); if (state.history.length > 200) state.history.shift(); state.future.length = 0; }
function hasEdits() { return Object.keys(state.cellEdits).length + state.deletedRows.size + state.addedRows.length + Object.keys(state.balanceEdits).length > 0; }
function undo() { if (!state.history.length) return; state.future.push(snapshot()); restoreSnap(state.history.pop()); afterEditMutation(); }
function redo() { if (!state.future.length) return; state.history.push(snapshot()); restoreSnap(state.future.pop()); afterEditMutation(); }
// Tras una mutación que cambia la estructura (filas) o por undo/redo: re-armar todo y re-render del editor.
function afterEditMutation() { applyEdits(); buildEditor(); updateEditBtn(); }

const fmtAR = (n) => n == null ? "" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isAmount = (role) => role === "importe" || role === "debito" || role === "credito" || role === "saldo";
const CUR_LABEL = { USD: "Dólares (U$S)", ARS: "Pesos ($)" };

// Renderiza una tarjeta por CUENTA (segmento): semáforo + tabla. Multi-cuenta generalizado.
function renderResult() {
  const host = $("segmentsHost");
  host.innerHTML = "";
  const cols = state.columns.filter((c) => c.role !== "ignorar");
  const segs = state.result ? state.result.segments : [];
  if (!segs.length) {
    host.innerHTML = `<div class="balance unknown"><strong>Sin movimientos detectados</strong><span>Marcá las columnas de importes y saldo sobre la tabla del PDF (o tocá Recalcular).</span></div>`;
    return;
  }
  const multi = segs.length > 1;
  segs.forEach((seg, si) => {
    const b = balanceCheck({ ...seg, columns: state.columns }, settings.toleranceCents / 100);
    const card = document.createElement("div");
    card.className = "seg-card";
    card.appendChild(balanceEl(b, seg, multi, si));
    card.appendChild(tableEl(seg, cols, b));
    host.appendChild(card);
  });
}

function segTitle(seg, multi, si) {
  return multi ? `<span class="seg-title">Cuenta ${si + 1}${seg.currency ? " · " + (CUR_LABEL[seg.currency] || seg.currency) : ""}</span>` : "";
}
// Clase + innerHTML del semáforo del saldo. Compartido por la tarjeta de resultado y el editor.
function balanceInner(b, title) {
  if (b.opening == null || b.closing == null) {
    return { cls: "unknown", html: title + `<strong>Regla del saldo: sin datos suficientes</strong>` +
      `<span>Marcá una columna con rol <b>Saldo</b> (y revisá apertura/cierre).</span>` };
  }
  const ok = b.globalOk && (b.rowOk !== false);
  const rowInfo = b.rowOk === true ? "fila a fila ✓" : b.rowOk === false ? `${b.rowMismatches.length} filas no encajan` : "";
  return { cls: ok ? "ok" : "fail", html: title +
    `<strong>${ok ? "✓ La cuenta cierra" : "✗ La cuenta no cierra"}</strong>` +
    `<span class="bcalc">${fmtAR(b.opening)} + Σmov ${fmtAR(b.sum)} = <b>${fmtAR(b.computed)}</b> vs cierre <b>${fmtAR(b.closing)}</b></span>` +
    `<span>${b.rowCount} movimientos · ${rowInfo}</span>` };
}
function balanceEl(b, seg, multi, si) {
  const el = document.createElement("div");
  const { cls, html } = balanceInner(b, segTitle(seg, multi, si));
  el.className = "balance " + cls;
  el.innerHTML = html;
  return el;
}

function tableEl(seg, cols, b) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const mism = new Set(b.rowMismatches || []);
  const head = "<tr><th class=\"th-x\"></th>" + cols.map((c) => `<th class="${isAmount(c.role) ? "num" : ""}">${esc(c.label)}</th>`).join("") +
    state.annotations.map((a) => `<th class="anno">${esc(a.label)}</th>`).join("") + "</tr>";
  const def = tableDefaults();
  const body = seg.movements.map((m, i) => {
    let html = `<td class="td-x"><button class="row-x" data-i="${i}" title="Excluir filas como esta">${ICON.ban(13)}</button></td>`;
    html += cols.map((c) => {
      const f = resolveColFmt(c, { ...def, value: c.role === "debito" ? def.debitoValue : "asis" });
      if (c.role === "fecha") return `<td class="c-fecha">${esc(formatDate(m.fecha, f.dateFmt))}</td>`;
      if (c.role === "descripcion") return `<td class="c-det">${esc(m.descripcion)}</td>`;
      if (c.role === "saldo") return `<td class="num">${esc(formatAmount(m.saldo, { ...f, value: "asis" }))}</td>`;
      if (isAmount(c.role)) return `<td class="num">${esc(formatAmount(m.amounts[c.label], f))}</td>`;
      return `<td>${esc(m.cells[c.label] || "")}</td>`;
    }).join("");
    html += state.annotations.map((a) => `<td class="anno" contenteditable data-id="${esc(m._id)}" data-a="${esc(a.label)}">${esc((state.annoStore[m._id] || {})[a.label] || "")}</td>`).join("");
    return `<tr class="${mism.has(i) ? "row-warn" : ""}">${html}</tr>`;
  }).join("");
  wrap.innerHTML = `<table class="rows"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  wrap.querySelectorAll("td.anno[contenteditable]").forEach((td) => {
    td.addEventListener("input", () => { (state.annoStore[td.dataset.id] ||= {})[td.dataset.a] = td.textContent.trim(); applyEdits(); });
  });
  wrap.querySelectorAll("button.row-x").forEach((btn) => {
    btn.addEventListener("click", () => excludeFromExample(seg.movements[+btn.dataset.i]));
  });
  return wrap;
}

// ---------- Editor de tabla (modal tipo planilla, saldo en vivo) ----------
function displayVal(m, c, f) {
  if (c.role === "fecha") return formatDate(m.fecha, f.dateFmt);
  if (c.role === "descripcion") return m.descripcion || "";
  if (c.role === "saldo") return formatAmount(m.saldo, { ...f, value: "asis" });
  if (isAmount(c.role)) return formatAmount(m.amounts[c.label], f);
  return m.cells[c.label] || "";
}
function buildEditor() {
  const body = $("editorBody");
  body.innerHTML = "";
  const segs = state.result ? state.result.segments : [];
  if (!segs.length) { body.innerHTML = `<p class="hint">No hay movimientos para editar todavía.</p>`; return; }
  const cols = state.columns.filter((c) => c.role !== "ignorar");
  const def = tableDefaults();
  segs.forEach((seg, si) => {
    const segDiv = document.createElement("div"); segDiv.className = "editor-seg";
    const bal = document.createElement("div"); bal.id = "edBal" + si; bal.className = "balance";
    segDiv.appendChild(bal);
    // Apertura / cierre forzables (útil cuando el banco no los imprime).
    const beRow = document.createElement("div"); beRow.className = "ed-be-row";
    beRow.innerHTML = `<label>Apertura <input class="ed-be num" data-si="${si}" data-be="opening" value="${esc(fmtAR(seg.opening))}" /></label>` +
      `<label>Cierre <input class="ed-be num" data-si="${si}" data-be="closing" value="${esc(fmtAR(seg.closing))}" /></label>`;
    segDiv.appendChild(beRow);
    const scroll = document.createElement("div"); scroll.className = "editor-scroll";
    const heads = `<th class="ehx">#</th>${[...cols.map((c) => c.label), ...state.annotations.map((a) => a.label)].map((h) => `<th>${esc(h)}</th>`).join("")}<th class="ehx"></th>`;
    const rows = seg.movements.map((m, ri) => {
      const tds = [`<td class="ehx">${ri + 1}</td>`];
      cols.forEach((c) => {
        const f = resolveColFmt(c, { ...def, value: c.role === "debito" ? def.debitoValue : "asis" });
        tds.push(`<td><input class="ed-cell${isAmount(c.role) ? " num" : ""}" value="${esc(displayVal(m, c, f))}" data-id="${esc(m._id)}" data-field="${esc(editField(c))}" /></td>`);
      });
      state.annotations.forEach((a) => {
        tds.push(`<td><input class="ed-cell ed-anno" value="${esc((state.annoStore[m._id] || {})[a.label] || "")}" data-id="${esc(m._id)}" data-anno="${esc(a.label)}" /></td>`);
      });
      tds.push(`<td class="ehx"><button class="ed-del" data-id="${esc(m._id)}" title="Borrar fila">${ICON.x(12)}</button></td>`);
      return `<tr data-si="${si}" data-ri="${ri}" data-id="${esc(m._id)}">${tds.join("")}</tr>`;
    }).join("");
    scroll.innerHTML = `<table class="editor-grid"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
    segDiv.appendChild(scroll);
    const addBtn = document.createElement("button"); addBtn.className = "btn sm ed-addrow"; addBtn.dataset.si = si;
    addBtn.textContent = "+ Agregar fila"; segDiv.appendChild(addBtn);
    body.appendChild(segDiv);
  });
  refreshEditorBalances();
  populateCatCols();
  updateUndoBtns();
}
// Escribe el valor tipeado al overlay correcto (fila extraída → cellEdits; fila agregada → vals).
function commitCell(inp) {
  const id = inp.dataset.id;
  if (inp.dataset.anno != null) { (state.annoStore[id] ||= {})[inp.dataset.anno] = inp.value; return; }
  const field = inp.dataset.field;
  if (id.startsWith("add:")) { const a = state.addedRows.find((x) => "add:" + x.aid === id); if (a) a.vals[field] = inp.value; }
  else state.cellEdits[`${id}:${field}`] = inp.value;
}
let cellPre = null; // snapshot tomado al entrar a una celda (para agrupar el undo por celda)
function onCellInput(inp) {
  if (cellPre) { state.history.push(cellPre); state.future.length = 0; cellPre = null; } // 1er cambio = 1 paso de undo
  commitCell(inp);
  applyEdits(); refreshEditorBalances(); updateEditBtn(); updateUndoBtns();
}
function onCellKey(e, inp) {
  if (e.ctrlKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); fillDown(inp); return; }
  if ((e.key === "Enter" && !e.shiftKey) || e.key === "ArrowDown") { e.preventDefault(); editorNav(inp, 1); }
  else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) { e.preventDefault(); editorNav(inp, -1); }
}
function editorNav(inp, dr) {
  const tr = inp.closest("tr"); const cells = [...tr.querySelectorAll("input.ed-cell")];
  const ci = cells.indexOf(inp); const rows = [...tr.parentElement.children];
  const target = rows[rows.indexOf(tr) + dr]; if (!target) return;
  const t = [...target.querySelectorAll("input.ed-cell")][ci];
  if (t) { t.focus(); t.select(); }
}
// Pegar un bloque (de Excel: tab = columnas, salto = filas) repartido desde la celda enfocada.
function onCellPaste(e, inp) {
  const text = e.clipboardData.getData("text/plain");
  if (!/\t|\n/.test(text)) return; // un solo valor → pegado normal
  e.preventDefault(); pushHistory();
  const block = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((r) => r.split("\t"));
  const tr0 = inp.closest("tr"); const rows = [...tr0.parentElement.children]; const r0 = rows.indexOf(tr0);
  const cells0 = [...tr0.querySelectorAll("input.ed-cell")]; const c0 = cells0.indexOf(inp);
  block.forEach((vals, dr) => {
    const tr = rows[r0 + dr]; if (!tr) return; // no agrego filas en overflow (v1)
    const cells = [...tr.querySelectorAll("input.ed-cell")];
    vals.forEach((v, dc) => { const t = cells[c0 + dc]; if (t) { t.value = v; commitCell(t); } });
  });
  applyEdits(); refreshEditorBalances(); updateEditBtn(); updateUndoBtns();
}
// Rellenar hacia abajo el valor de la celda en toda su columna (categorías repetidas).
function fillDown(inp) {
  const tr = inp.closest("tr"); const cells = [...tr.querySelectorAll("input.ed-cell")];
  const ci = cells.indexOf(inp); const rows = [...tr.parentElement.children]; const r0 = rows.indexOf(tr);
  pushHistory(); let n = 0;
  for (let r = r0 + 1; r < rows.length; r++) { const t = [...rows[r].querySelectorAll("input.ed-cell")][ci]; if (t) { t.value = inp.value; commitCell(t); n++; } }
  applyEdits(); refreshEditorBalances(); updateEditBtn(); updateUndoBtns();
  toast(`Rellené ${n} celda(s) hacia abajo.`);
}
function refreshEditorBalances() {
  const segs = state.result ? state.result.segments : [];
  const multi = segs.length > 1;
  segs.forEach((seg, si) => {
    const b = balanceCheck({ ...seg, columns: state.columns }, settings.toleranceCents / 100);
    const el = $("edBal" + si); if (!el) return;
    const { cls, html } = balanceInner(b, segTitle(seg, multi, si));
    el.className = "balance " + cls; el.innerHTML = html;
    const mism = new Set(b.rowMismatches || []);
    $("editorBody").querySelectorAll(`tr[data-si="${si}"]`).forEach((tr) => tr.classList.toggle("ed-mism", mism.has(+tr.dataset.ri)));
  });
}
// Agregar / borrar filas (estructural → snapshot + re-render).
function addRow(si) {
  pushHistory();
  const aid = ++state.aidSeq; state.addedRows.push({ aid, si: +si, vals: {} });
  afterEditMutation();
  const tr = $("editorBody").querySelector(`tr[data-id="add:${aid}"]`);
  const first = tr && tr.querySelector("input.ed-cell"); if (first) first.focus();
}
function deleteRow(id) {
  pushHistory();
  if (id.startsWith("add:")) state.addedRows = state.addedRows.filter((a) => "add:" + a.aid !== id);
  else state.deletedRows.add(id);
  afterEditMutation();
}
function setBalanceEdit(inp) {
  if (cellPre) { state.history.push(cellPre); state.future.length = 0; cellPre = null; }
  const v = inp.value.trim();
  if (v === "") delete state.balanceEdits[`${inp.dataset.si}:${inp.dataset.be}`];
  else state.balanceEdits[`${inp.dataset.si}:${inp.dataset.be}`] = v;
  applyEdits(); refreshEditorBalances(); updateEditBtn(); updateUndoBtns();
}
// Buscar y reemplazar en celdas de texto (no toca montos, para no corromper números).
function findReplaceAll() {
  const find = $("edFind").value; const repl = $("edRepl").value;
  if (!find) { toast("Escribí qué buscar."); return; }
  pushHistory();
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let n = 0;
  $("editorBody").querySelectorAll("input.ed-cell:not(.num)").forEach((inp) => {
    if (re.test(inp.value)) { inp.value = inp.value.replace(re, repl); commitCell(inp); n++; }
    re.lastIndex = 0;
  });
  applyEdits(); refreshEditorBalances(); updateEditBtn(); updateUndoBtns();
  toast(`${n} reemplazo(s).`);
}
// Categorización asistida: a las filas cuya descripción contiene la palabra, les pone un valor
// en un campo propio (anotación). Se acumula aplicando varias veces.
function populateCatCols() {
  const sel = $("edCatCol"); if (!sel) return;
  sel.innerHTML = state.annotations.length
    ? state.annotations.map((a) => `<option value="${esc(a.label)}">${esc(a.label)}</option>`).join("")
    : `<option value="">(agregá un Campo propio primero)</option>`;
}
function applyCategory() {
  const key = $("edCatKey").value.trim().toLowerCase(); const val = $("edCatVal").value; const col = $("edCatCol").value;
  if (!col) { toast("Agregá un Campo propio (ej: Categoría) primero."); return; }
  if (!key) { toast("Escribí una palabra a buscar en la descripción."); return; }
  pushHistory(); let n = 0;
  state.result.movements.forEach((m) => { if ((m.descripcion || "").toLowerCase().includes(key)) { (state.annoStore[m._id] ||= {})[col] = val; n++; } });
  afterEditMutation();
  toast(`Categoricé ${n} fila(s).`);
}
// Flags de calidad: duplicados (misma fecha+descr+neto) y huecos (fecha que retrocede).
function qualityCheck() {
  const seen = new Map(); let dups = 0, gaps = 0;
  const netOf = (m) => Object.entries(m.amounts || {}).reduce((s, [, v]) => s + (v || 0), 0);
  const segs = state.result ? state.result.segments : [];
  segs.forEach((seg, si) => {
    let prev = null;
    seg.movements.forEach((m, ri) => {
      const tr = $("editorBody").querySelector(`tr[data-si="${si}"][data-ri="${ri}"]`); if (!tr) return;
      const key = `${m.fecha}|${(m.descripcion || "").toLowerCase()}|${netOf(m).toFixed(2)}`;
      const dup = seen.has(key); if (dup) dups++; else seen.set(key, 1);
      const d = dateNum(m.fecha); let gap = false;
      if (d != null && prev != null && d < prev) { gap = true; gaps++; }
      if (d != null) prev = d;
      tr.classList.toggle("ed-dup", dup); tr.classList.toggle("ed-gap", gap);
    });
  });
  $("edStatus").textContent = (dups || gaps) ? `${dups} duplicado(s) · ${gaps} fecha(s) fuera de orden` : "Sin duplicados ni huecos de fecha ✓";
}
function dateNum(raw) { const m = String(raw || "").match(/(\d{1,4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,4}))?/); if (!m) return null; const a = m[1], mo = m[2], c = m[3]; const d = a.length === 4 ? c : a, y = a.length === 4 ? a : c; const y4 = y ? (y.length === 2 ? "20" + y : y) : "0"; return +y4 * 10000 + (+mo) * 100 + (+(d || 0)); }
function editTotal() { return Object.keys(state.cellEdits).length + state.deletedRows.size + state.addedRows.length + Object.keys(state.balanceEdits).length; }
function updateEditBtn() {
  const b = $("btnEdit"); if (!b) return;
  const n = editTotal();
  let tag = b.querySelector(".ed-count");
  if (n) { if (!tag) { tag = document.createElement("span"); tag.className = "ed-count"; b.appendChild(tag); } tag.textContent = n; }
  else if (tag) tag.remove();
}
function updateUndoBtns() { const u = $("edUndo"), r = $("edRedo"); if (u) u.disabled = !state.history.length; if (r) r.disabled = !state.future.length; }
function openEditor() {
  if (!state.result || !state.result.segments.length) { toast("Primero abrí y extraé un documento."); return; }
  buildEditor(); $("editorModal").hidden = false;
}
function closeEditor() { $("editorModal").hidden = true; renderResult(); } // el resultado refleja las ediciones
function clearEdits() {
  if (!hasEdits()) return;
  pushHistory();
  state.cellEdits = {}; state.deletedRows = new Set(); state.addedRows = []; state.balanceEdits = {}; state.annoStore = {};
  afterEditMutation();
}
// Reseteo total (documento nuevo / Auto-detectar): borra ediciones e historial.
function resetEdits() {
  state.cellEdits = {}; state.deletedRows = new Set(); state.addedRows = []; state.balanceEdits = {};
  state.annoStore = {}; state.history = []; state.future = []; state.aidSeq = 0;
  updateEditBtn();
}

// ---------- Export ----------
function pageSize() { return { w: state.pdf.pages[0].W, h: state.pdf.pages[0].H }; }
function exportTemplate(kind) {
  const anchors = extractAnchors(state.pdf.pages, state.columns);
  const contributor = $("contributor").value.trim() || "anon";
  const createdAt = new Date().toISOString().slice(0, 10); // fecha de creación de la plantilla (hoy)
  const tpl = buildTemplate({ bank: $("bankName").value.trim() || "Banco", columns: state.columns, annotations: state.annotations, pageSize: pageSize(), anchors, contributor, createdAt, rules: state.rules });
  const id = tpl.meta.template_id;
  if (kind === "yaml") download(`${id}.ext.yaml`, toYaml(tpl), "text/yaml");
  else download(`${id}.ext.json`, toJson(tpl), "application/json");
  saveTemplateLS(tpl); refreshSavedTemplates(); // queda disponible para reusar con un click
}
// ---------- Anonimización básica (componente compartido del ecosistema) ----------
const ANON_MODE_KEY = "fulgoria.anonMode";
function getAnonMode() {
  const el = document.getElementById("anonOptionsMount");
  const v = (window.AnonOptions && el) ? AnonOptions.getValues(el) : null;
  return v ? v.mode : "off";
}
function mountAnon() {
  const el = document.getElementById("anonOptionsMount");
  if (!el || !window.AnonOptions) return;
  let saved = "off"; try { saved = localStorage.getItem(ANON_MODE_KEY) || "off"; } catch {}
  AnonOptions.mount(el, {
    lang: document.documentElement.lang || "es",
    hasService: false,   // Fulgoria básico (regex en el navegador); el motor completo se libera vía Escriba
    showRules: false,
    mode: saved,
    onChange: (v) => { try { localStorage.setItem(ANON_MODE_KEY, v.mode); } catch {} },
  });
}
mountAnon();

function exportCsv() {
  if (!state.result) return;
  const anon = new Anonymizer(getAnonMode());
  const opts = {
    sep: settings.csvSep === "tab" ? "\t" : settings.csvSep,
    decimal: settings.csvDecimal, dateFmt: settings.dateFmt, bom: settings.csvBom, debitoSign: settings.debitoSign,
    anon: (s) => anon.transform(s),
  };
  download("movimientos.csv", rowsToCsv(state.result.movements, state.columns, state.annotations, state.annoValues, opts), "text/csv");
  // En modo pseudo los tokens son reversibles: bajamos el mapa token→original aparte.
  const map = anon.mapping;
  if (Object.keys(map).length) download("movimientos.map.json", JSON.stringify(map, null, 2), "application/json");
}

// ---------- Configuración (persistida en el navegador) ----------
const SETTINGS_KEY = "fulgoria.settings";
const DEFAULT_SETTINGS = { decimalIn: "auto", dateFmt: "DD/MM/YYYY", csvSep: ",", csvDecimal: ",", csvBom: true, debitoSign: "auto", toleranceCents: 1, contributor: "" };
let settings = (() => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULT_SETTINGS }; } })();
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
function applyAmountMode() { setAmountMode(settings.decimalIn); }

function wireSettings() {
  const bind = (id, key, ev = "change", parse = (v) => v) => {
    const el = $(id); if (!el) return;
    if (el.type === "checkbox") el.checked = !!settings[key]; else el.value = settings[key];
    el.addEventListener(ev, () => {
      settings[key] = el.type === "checkbox" ? el.checked : parse(el.value);
      saveSettings();
      if (key === "decimalIn") { applyAmountMode(); recompute(); }
      if (key === "toleranceCents") recompute();
    });
  };
  bind("setDecimalIn", "decimalIn");
  bind("setDateFmt", "dateFmt", "input");
  bind("setCsvSep", "csvSep");
  bind("setCsvDecimal", "csvDecimal");
  bind("setDebitoSign", "debitoSign");
  bind("setCsvBom", "csvBom");
  bind("setTolerance", "toleranceCents", "input", (v) => Math.max(0, parseInt(v, 10) || 0));
  bind("contributor", "contributor", "input"); // alias persistido para la biblioteca
}

// ---------- Reusar plantilla (cargar / guardar / aplicar) ----------
// Reconstruye columnas y campos desde una plantilla Fulgoria exportada.
function applyTemplate(tpl) {
  if (!tpl || !tpl.geometry || !Array.isArray(tpl.geometry.columns)) throw new Error("Plantilla inválida");
  state.columns = tpl.geometry.columns.map((c) => ({
    from: c.x_band.from, to: c.x_band.to, role: c.role || "texto", label: c.field || "Campo", fmt: c.fmt || undefined,
  }));
  state.annotations = Array.isArray(tpl.annotations) ? tpl.annotations.map((a) => ({ label: a.field || a.label })) : [];
  state.rules = Array.isArray(tpl.rules) ? tpl.rules.map((r) => ({ field: r.field, match: r.match, value: r.value })) : [];
  state.annoValues = [];
  if (tpl.meta && tpl.meta.bank) state.bank = tpl.meta.bank;
}

// Aplica una plantilla ya parseada: si hay PDF abierto, re-extrae; si no, queda pendiente.
function useTemplate(tpl) {
  saveTemplateLS(tpl);
  refreshSavedTemplates();
  if (state.pdf) {
    applyTemplate(tpl);
    $("bankName").value = state.bank;
    renderColumnsPanel(); renderAnnotations(); layoutOverlay(); recompute();
  } else {
    state.pendingTemplate = tpl;
    alert("Plantilla cargada. Ahora abrí un PDF de ese banco y se aplica sola.");
  }
}

async function onLoadTemplateFile(file) {
  const text = await file.text();
  let tpl;
  try { tpl = JSON.parse(text); }
  catch { alert("Por ahora se puede reusar la plantilla .json (la .yaml todavía no). Descargá/usá la .json."); return; }
  try { useTemplate(tpl); }
  catch (e) { alert("No pude leer la plantilla: " + e.message); }
}

// Auto-match: elige la plantilla guardada que mejor reconoce este PDF.
function anchorsOf(tpl) { return ((tpl.match && tpl.match.anchors) || []).map((a) => ({ text: a.text, x: a.box ? a.box.x : a.x })); }
function scoreTpl(pdf, tpl) {
  const ps = tpl.match && tpl.match.page_size;
  if (ps) {
    const w = pdf.pages[0].W, h = pdf.pages[0].H;
    if (Math.abs(w - ps.w_pt) / w > 0.06 || Math.abs(h - ps.h_pt) / h > 0.06) return 0; // otro tamaño de hoja
  }
  return matchScore(pdf.pages, anchorsOf(tpl));
}
function bestMatch(pdf) {
  const cands = savedTemplates().map((t) => ({ tpl: t.tpl, score: scoreTpl(pdf, t.tpl) })).filter((c) => c.score > 0);
  cands.sort((a, b) => b.score - a.score);
  return cands[0];
}
function showMatch(bank, score) {
  const el = $("matchBanner");
  if (!el) return;
  if (bank) {
    el.innerHTML = `${ICON.spark()} Reconocí “${esc(bank)}” — plantilla aplicada sola (${Math.round(score * 100)}% de coincidencia)`;
    el.style.display = "block";
    clearTimeout(showMatch._t); showMatch._t = setTimeout(() => { el.style.display = "none"; }, 7000);
  } else {
    el.style.display = "none";
  }
}

const LS_KEY = "fulgoria.templates";
function savedTemplates() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } }
function saveTemplateLS(tpl) {
  if (!tpl.meta) return;
  const all = savedTemplates().filter((t) => t.id !== tpl.meta.template_id);
  all.push({ id: tpl.meta.template_id, bank: tpl.meta.bank, tpl });
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch {}
}
function refreshSavedTemplates() {
  const sel = $("savedTpl");
  if (!sel) return;
  const all = savedTemplates();
  sel.innerHTML = `<option value="">Elegí una…</option>` +
    all.map((t, i) => `<option value="${i}">${esc(t.bank || t.id)}</option>`).join("");
  const row = $("savedTplRow");
  if (row) row.style.display = all.length ? "" : "none";
}

// ---------- utils ----------
function esc(s) { return (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- wire ----------
$("fileInput").addEventListener("change", (e) => { if (e.target.files[0]) onFile(e.target.files[0]); });
$("btnSample").addEventListener("click", async () => {
  const res = await fetch("samples/banco-rio-cc.pdf");
  onFile(new File([await res.blob()], "banco-rio-cc.pdf", { type: "application/pdf" }));
});
$("btnPrev").addEventListener("click", async () => { if (state.curPage > 0) { state.curPage--; await renderCurrentPage(); } });
$("btnNext").addEventListener("click", async () => { if (state.curPage < state.pdf.numPages - 1) { state.curPage++; await renderCurrentPage(); } });
$("btnRecalc").addEventListener("click", () => { if (state.pdf) { cancelPlacing(); recompute(); renderCurrentPage().catch(() => {}); } });
$("btnReset").addEventListener("click", () => { if (state.pdf) { state.columns = autoDetect(state.pdf.pages).columns; resetEdits(); cancelPlacing(); renderColumnsPanel(); recompute(); renderCurrentPage().catch(() => {}); } });
$("btnNewCol").addEventListener("click", () => { if (state.pdf) startPlacing(); });
// Menú de acciones (•••)
const actionMenu = $("actionMenu"), btnMenu = $("btnMenu");
function closeMenu() { actionMenu.hidden = true; btnMenu.setAttribute("aria-expanded", "false"); }
function toggleMenu() { actionMenu.hidden ? (actionMenu.hidden = false, btnMenu.setAttribute("aria-expanded", "true")) : closeMenu(); }
btnMenu.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
// Cerrar al elegir una acción (menos abrir el select de plantillas, que se usa adentro)
actionMenu.addEventListener("click", (e) => { if (!e.target.closest("#savedTplRow")) closeMenu(); });
document.addEventListener("click", (e) => { if (!actionMenu.hidden && !e.target.closest(".menu-wrap")) closeMenu(); });

// Tema claro/oscuro (ecosistema Escriba) — claro por defecto, persistido; toggle en la topbar.
const SUN_SVG = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_SVG = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
function paintTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  $("themeBtn").innerHTML = dark ? SUN_SVG : MOON_SVG; // ícono = a dónde vas
  $("themeBtn").title = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
}
paintTheme();
$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("fulgoria.theme", next); } catch {}
  paintTheme();
});

// Enviar a Escriba (mismo origen): dejo lo extraído en sessionStorage y abro Escriba.
// El documento nunca sale del navegador; el handoff es local (tu Escriba del ecosistema).
const ESCRIBA_URL_KEY = "fulgoria.escribaUrl";
function escribaUrl() {
  // Prioridad: override local (localStorage) > config del server (meta inyectada de ESCRIBA_URL) > "/".
  let u = "";
  try { u = localStorage.getItem(ESCRIBA_URL_KEY) || ""; } catch {}
  if (!u) u = document.querySelector('meta[name="fulgoria-escriba-url"]')?.content || "";
  u = u || "/";
  // Solo rutas relativas o http(s). Bloqueo javascript:/data: (evita ejecución vía window.open).
  try { const abs = new URL(u, location.origin); return abs.protocol === "http:" || abs.protocol === "https:" ? u : "/"; } catch { return "/"; }
}
$("btnEscriba").addEventListener("click", () => {
  if (!state.result || !state.result.movements.length) { toast("Primero abrí y extraé un documento."); return; }
  const o = { decimal: settings.csvDecimal, dateFmt: settings.dateFmt, debitoSign: settings.debitoSign };
  const md = rowsToMarkdown(state.result.movements, state.columns, state.annotations, state.annoValues, o);
  const csv = rowsToCsv(state.result.movements, state.columns, state.annotations, state.annoValues, { ...o, sep: ",", bom: false });
  const bank = ($("bankName")?.value || "").trim();
  const payload = { from: "fulgoria", version: 1, title: "Fulgoria — " + (bank || "movimientos"), source: bank, mime: "text/markdown", content: md, alt: { csv }, ts: Date.now() };
  // Canal 1 (mismo origen): storage. localStorage se comparte al instante entre pestañas del mismo
  // origen; sessionStorage es el contrato del ecosistema. Escriba lee cualquiera.
  try { const s = JSON.stringify(payload); localStorage.setItem("escriba.handoff", s); sessionStorage.setItem("escriba.handoff", s); } catch {}
  // Canal 2 (CROSS-ORIGEN): postMessage. El storage NO cruza orígenes distintos (ej. Fulgoria y
  // Escriba en subdominios distintos). Abro Escriba SIN noopener (para tener su window), y cuando
  // ella avisa "ready" le mando el handoff por postMessage al origen exacto. Funciona estén donde estén.
  const url = escribaUrl();
  let targetOrigin = "*"; try { targetOrigin = new URL(url, location.origin).origin; } catch {}
  let win = null;
  const onMsg = (e) => { if (win && e.source === win && e.data && e.data.type === "escriba-ready") { try { win.postMessage({ type: "escriba-handoff", payload }, targetOrigin); } catch {} } };
  window.addEventListener("message", onMsg);
  setTimeout(() => window.removeEventListener("message", onMsg), 120000); // limpio el listener a los 2 min
  toast("Abriendo Escriba con tus datos…");
  win = window.open(url, "_blank");
});

// Toast mínimo (estilo ecosistema)
let toastT = 0;
function toast(msg, ms = 2600) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
}
// Tip de descubrimiento: la primera vez, explico la interacción estrella (arrastrar columnas).
function coachOnce() {
  try { if (localStorage.getItem("fulgoria.coachSeen")) return; localStorage.setItem("fulgoria.coachSeen", "1"); } catch { return; }
  toast("Tip: arrastrá las barras de color sobre el documento para ajustar las columnas (o usá + Nueva columna).", 6000);
}

// Modal de ayuda
$("btnHelp").addEventListener("click", () => { $("helpModal").hidden = false; });
$("helpModal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) $("helpModal").hidden = true; });
// Editor de tabla
$("btnEdit").addEventListener("click", openEditor);
$("editorClear").addEventListener("click", clearEdits);
$("editorModal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeEditor(); });
(() => {
  const eb = $("editorBody");
  eb.addEventListener("focusin", (e) => { if (e.target.matches("input.ed-cell, input.ed-be")) cellPre = snapshot(); });
  eb.addEventListener("input", (e) => { const t = e.target; if (t.matches("input.ed-cell")) onCellInput(t); else if (t.matches("input.ed-be")) setBalanceEdit(t); });
  eb.addEventListener("keydown", (e) => { if (e.target.matches("input.ed-cell")) onCellKey(e, e.target); });
  eb.addEventListener("paste", (e) => { if (e.target.matches("input.ed-cell")) onCellPaste(e, e.target); });
  eb.addEventListener("click", (e) => {
    const del = e.target.closest(".ed-del"); if (del) return deleteRow(del.dataset.id);
    const add = e.target.closest(".ed-addrow"); if (add) return addRow(add.dataset.si);
  });
})();
$("edUndo").addEventListener("click", undo);
$("edRedo").addEventListener("click", redo);
$("edReplace").addEventListener("click", findReplaceAll);
$("edQuality").addEventListener("click", qualityCheck);
$("edCat").addEventListener("click", () => { $("edCatPanel").hidden = !$("edCatPanel").hidden; });
$("edCatApply").addEventListener("click", applyCategory);
window.addEventListener("keydown", (e) => {
  if ($("editorModal").hidden || !e.ctrlKey) return;
  if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
  else if (e.key === "y" || e.key === "Y") { e.preventDefault(); redo(); }
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("actionMenu").hidden) closeMenu();
  else if (!$("editorModal").hidden) closeEditor();
  else if (!$("helpModal").hidden) $("helpModal").hidden = true;
  else if (state.placing) cancelPlacing();
});
let resizeT = 0;
window.addEventListener("resize", () => { if (!state.pdf) return; clearTimeout(resizeT); resizeT = setTimeout(() => renderCurrentPage().catch(() => {}), 200); });
$("annoAdd").addEventListener("click", addAnnotation);
$("annoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addAnnotation(); });
$("ruleAdd").addEventListener("click", addRule);
$("ruleValue").addEventListener("keydown", (e) => { if (e.key === "Enter") addRule(); });
$("ruleMatch").addEventListener("change", () => { $("ruleValue").style.display = $("ruleMatch").value === "empty" ? "none" : ""; });
$("btnYaml").addEventListener("click", () => exportTemplate("yaml"));
$("btnJson").addEventListener("click", () => exportTemplate("json"));
$("btnCsv").addEventListener("click", exportCsv);
$("tplInput").addEventListener("change", (e) => { if (e.target.files[0]) onLoadTemplateFile(e.target.files[0]); e.target.value = ""; });
$("savedTpl").addEventListener("change", (e) => {
  const i = e.target.value; if (i === "") return;
  const t = savedTemplates()[+i]; if (t) useTemplate(t.tpl);
  e.target.value = "";
});
refreshSavedTemplates();

const dz = $("emptyState");
["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("hover"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("hover"); }));
dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });

applyAmountMode(); // aplicar modo de lectura de importes guardado
wireSettings();

window.__fulgoriaReady = true; // marcador: listeners enganchados
