// Fulgoria · Conciliar — interfaz de la conciliación bancaria.
//
// Modo AUTOMÁTICO: soltás el extracto y el mayor, el sistema lee, verifica, empareja y te
// muestra solo lo que necesita tu decisión (la bandeja), con el papel de trabajo listo.
// Modo DEPORTIVO: los mismos datos + todos los mandos del motor editables en vivo + la mesa
// para emparejar a mano. Un solo motor (src/core), dos maneras de manejarlo.
//
// Todo corre en el navegador: el PDF y el mayor nunca salen de la máquina.
import { loadPdf, renderToCanvas } from "./pdf.js";
import { extract, balanceCheck, autoDetect, matchScore, docYear, extractAnchors } from "./extract.js";
import { buildTemplate } from "./template.js";
import { esqueletoDePdf, elegirPropuesta } from "./ia.js";
import {
  fromExtract, resolveConfig, DEFAULTS, reconcile, arrastreSiguiente, pairKey,
  papelSaldoASaldo, papelToMarkdown, papelToCsv, asientosToCsv, fmtCents, fmtISO as fmtISOcrudo,
  parseCsv, parseLedgerRows, detectLedgerColumns, adivinarFilaEncabezado, crearPlantillaMayor, reconocerPlantillaMayor, ROLES_MAYOR,
} from "./core/index.js";

// OCR (Tesseract, pesado) se carga solo si hace falta: un PDF digital no lo necesita.
const ocr = () => import("./ocr.js");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = (s, body) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24">${body}</svg>`;
const ICON = {
  chev: svg(14, '<path d="M9 18l6-6-6-6"/>'),
  arrow: svg(16, '<path d="M7 7h12l-4-4M17 17H5l4 4"/>'),
  doc: svg(18, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  sheet: svg(18, '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'),
  sun: svg(17, '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg(17, '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
};
// Lo que llega del servidor (o de un mes anterior) puede traer cualquier cosa: solo colores conocidos y fechas escapadas.
const COLORES = new Set(["verde", "amarillo", "rojo"]);
const dot = (c, lg) => `<span class="dot ${COLORES.has(c) ? c : "amarillo"}${lg ? " lg" : ""}"></span>`;
const fmtISO = (iso) => esc(fmtISOcrudo(typeof iso === "string" ? iso : ""));

const LS_MANDOS = "fulgoria.conciliar.mandos";
const LS_MODO = "fulgoria.conciliar.modo";
const LS_TPL = "fulgoria.templates"; // las mismas plantillas que guarda el extractor
const LS_TPL_MAYOR = "fulgoria.plantillasMayor"; // plantillas de mayor por sistema contable

const state = {
  extracto: null,   // { name, pdf, columns, ext, check, seg, banco, error }
  mayor: null,      // { name, led, error }
  arrastre: [],     // pendientes del mes anterior (cargados desde JSON)
  decisiones: { manuales: [], rechazados: [], confirmados: [] },
  modo: lsGet(LS_MODO) || "auto",
  mandos: safeJson(lsGet(LS_MANDOS)) || {},
  cierre: null,     // fecha de cierre elegida a mano (deportivo)
  rec: null,
  sel: { banco: new Set(), libros: new Set() },
};

// ---------------------------------------------------------------- carga de archivos
const fileInput = $("fileInput");
fileInput.addEventListener("change", () => { handleFiles([...fileInput.files]); fileInput.value = ""; });
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hover"); }));
["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) drop.classList.remove("hover"); }));
document.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]); });
$("btnEjemplo").addEventListener("click", cargarEjemplo);

async function handleFiles(files) {
  if (soloLectura()) return toast(puedo("editar") ? "El mes está cerrado. Reabrilo para cambiar los documentos." : "Tu rol solo permite ver.");
  for (const f of files) {
    const n = f.name.toLowerCase();
    try {
      if (n.endsWith(".pdf") || (f.type || "").startsWith("image/")) { await cargarExtracto(f.name, f); await estudioSubir("extracto", f); }
      else if (n.endsWith(".csv") || n.endsWith(".txt")) { await cargarMayor(f.name, await f.text()); await estudioSubir("mayor", f); }
      else if (n.endsWith(".json")) {
        const txt = await f.text(), j = JSON.parse(txt);
        if (j.fulgoria_plantilla_mayor) importarPlantillaMayor(j);
        else await cargarArrastre(f.name, txt);
      }
      else if (/\.xlsx?$/.test(n)) toast("Por ahora el mayor va en CSV: en Excel, Archivo → Guardar como → CSV.");
      else toast(`No sé qué hacer con ${f.name}`);
    } catch (e) {
      console.error(e);
      toast(`No pude leer ${f.name}: ${e.message}`);
    }
  }
  run();
}

async function cargarEjemplo() {
  try {
    const [pdf, csv] = await Promise.all([fetch("samples/banco-rio-cc.pdf"), fetch("samples/mayor-banco-rio-cc.csv")]);
    if (!pdf.ok || !csv.ok) throw new Error("no encontré los archivos de ejemplo");
    state.arrastre = []; resetDecisiones();
    await cargarExtracto("banco-rio-cc.pdf", new Blob([await pdf.arrayBuffer()], { type: "application/pdf" }));
    await cargarMayor("mayor-banco-rio-cc.csv", await csv.text());
    run();
  } catch (e) { toast("No pude cargar el ejemplo: " + e.message); }
}

async function cargarExtracto(name, file) {
  progress("Leyendo el extracto…");
  try {
    let pdf;
    if ((file.type || "").startsWith("image/")) {
      progress("Leyendo la imagen con OCR…");
      const { ocrCanvas, imageFileToCanvas } = await ocr();
      const canvas = await imageFileToCanvas(file);
      const items = await ocrCanvas(canvas, (p) => progress(`OCR — ${Math.round(p * 100)}%`));
      pdf = { numPages: 1, scanned: true, pages: [{ index: 1, page: null, W: canvas.width, H: canvas.height, items, ocrCanvas: canvas }] };
    } else {
      pdf = await loadPdf(new Uint8Array(await file.arrayBuffer()));
      const tot = pdf.pages.reduce((a, p) => a + p.items.length, 0);
      if (pdf.pages.length && tot / pdf.pages.length < 5) { // escaneado
        const { ocrCanvas } = await ocr();
        for (let i = 0; i < pdf.pages.length; i++) {
          const pg = pdf.pages[i];
          const canvas = await renderToCanvas(pg.page, 1600);
          pg.items = await ocrCanvas(canvas, (p) => progress(`OCR página ${i + 1}/${pdf.pages.length} — ${Math.round(p * 100)}%`));
          pg.ocrCanvas = canvas; pg.W = canvas.width; pg.H = canvas.height;
        }
        pdf.scanned = true;
      }
    }
    // ¿Reconozco el banco por una plantilla guardada en el extractor? Si no, auto-detección.
    const tpl = mejorPlantilla(pdf);
    const columns = tpl ? tpl.columns : autoDetect(pdf.pages).columns;
    const rules = tpl ? tpl.rules : [];
    const ext = extract(pdf.pages, columns, rules);
    state.extracto = { name, pdf, columns, ext, seg: 0, banco: tpl?.bank || adivinarBanco(pdf.pages[0]?.items || []), plantilla: !!tpl };
    elegirSegmento(0);
    resetDecisiones();
  } finally { progress(null); }
}

function elegirSegmento(i) {
  const x = state.extracto;
  x.seg = i;
  const s = x.ext.segments[i];
  if (!s) { x.error = "No encontré movimientos en el extracto. Abrilo en el Extractor para marcar las columnas."; return; }
  x.check = balanceCheck({ ...s, columns: x.columns });
  const anio = docYear(x.pdf.pages, s.movements) || new Date().getFullYear();
  x.anio = anio;
  x.data = fromExtract({ ...s, columns: x.columns }, { doc: x.name, anio });
  x.error = null;
}

// El mayor se lee: 1) con una plantilla guardada si reconoce sus encabezados; 2) si no, con la
// detección automática; 3) si tampoco, queda pidiendo que se indiquen las columnas a mano.
async function cargarMayor(name, text) {
  const rows = parseCsv(text);
  state.mayor = { name, rows, led: null, error: null, plantilla: null, lectura: null };
  const rec = reconocerPlantillaMayor(rows, plantillasMayor());
  if (rec) leerMayor({ headerRow: rec.headerRow, map: rec.map, amountMode: rec.plantilla.formato?.numeros, unirContinuacion: rec.plantilla.unirContinuacion !== false, ignorar: rec.plantilla.ignorar || [] }, rec.plantilla.sistema);
  else {
    const det = detectLedgerColumns(rows);
    if (det) leerMayor({ headerRow: det.headerRow, map: det.map });
    else state.mayor.error = "No reconocí las columnas de este mayor. Indicá cuál es cada una (una sola vez: queda guardado para este sistema).";
  }
  resetDecisiones();
}
function leerMayor(lectura, plantilla = null) {
  const m = state.mayor;
  try {
    m.led = parseLedgerRows(m.rows, { ...lectura, doc: m.name, anio: state.extracto?.anio });
    m.lectura = lectura; m.plantilla = plantilla; m.error = null;
  } catch (e) { m.led = null; m.error = e.message; }
}
function plantillasMayor() { return safeJson(lsGet(LS_TPL_MAYOR)) || []; }
function guardarPlantillaMayor(tpl, compartir = true) {
  const todas = plantillasMayor().filter((t) => t.sistema !== tpl.sistema);
  todas.push(tpl);
  lsSet(LS_TPL_MAYOR, JSON.stringify(todas));
  if (compartir && est.activo) srv("PUT", "/plantillas", { tipo: "mayor", nombre: tpl.sistema, plantilla: tpl }); // la ve todo el estudio
}
function importarPlantillaMayor(tpl) {
  guardarPlantillaMayor(tpl);
  toast(`Plantilla de mayor "${tpl.sistema}" guardada.`);
  if (state.mayor?.rows) cargarMayor(state.mayor.name, state.mayor.rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\n"));
}

// ---------------------------------------------------------------- mapear columnas del mayor
const ROL_MAYOR_TXT = {
  fecha: "Fecha", descripcion: "Descripción / concepto", debe: "Debe (entra plata)", haber: "Haber (sale plata)",
  importe: "Importe con signo (si no hay Debe/Haber)", saldo: "Saldo", comprobante: "Comprobante / nº de cheque", asiento: "Nº de asiento",
};
function abrirMapeo() {
  const m = state.mayor;
  if (!m?.rows) return;
  const lec = m.lectura || {};
  let hr = lec.headerRow ?? adivinarFilaEncabezado(m.rows);
  let map = { ...(lec.map || detectLedgerColumns(m.rows)?.map || {}) };
  const opciones = () => (m.rows[hr] || []).map((c, i) => `<option value="${i}">${esc(c || "Columna " + (i + 1))}</option>`).join("");
  const sel = (rol) => `<label class="c-map-f">${ROL_MAYOR_TXT[rol]}<select data-rol="${rol}"><option value="">—</option>${opciones()}</select></label>`;
  abrirModal("Columnas del mayor", `
    <p>Indicá qué es cada columna. Si lo guardás como plantilla, la próxima vez que llegue un mayor de este sistema se lee solo.</p>
    <div class="c-map">
      <label class="c-map-f">Fila de los encabezados<input type="number" min="1" max="${m.rows.length}" id="mapFila" value="${hr + 1}" /></label>
      <label class="c-map-f">Números<select id="mapNum"><option value="auto">Detectar solo</option><option value="es-AR">1.234,56</option><option value="us">1,234.56</option></select></label>
      <div id="mapRoles" class="c-map-roles"></div>
      <label class="c-map-f wide">Ignorar filas que contengan (separado por comas)<input id="mapIgnorar" value="${esc((lec.ignorar || []).join(", "))}" placeholder="p. ej. Total hoja, Firma" /></label>
      <label class="chk"><input type="checkbox" id="mapUnir" checked /> Unir a la anterior las filas que solo tienen texto (descripciones partidas)</label>
      <label class="c-map-f wide">Nombre del sistema o planilla<input id="mapSistema" value="${esc(m.plantilla || "")}" placeholder="p. ej. Sistema del estudio, Planilla de Juan" /></label>
    </div>
    <div id="mapVista" class="c-map-vista"></div>
    <div class="modal-acciones">
      <button class="btn ghost" id="mapBajar" title="Para compartirla con otro estudio o colega: no tiene datos, solo los nombres de las columnas">Descargar plantilla</button>
      <button class="btn" id="mapAplicar">Aplicar a este archivo</button>
      <button class="btn primary" id="mapGuardar">Guardar plantilla y aplicar</button>
    </div>
    ${plantillasMayor().length ? `<p class="muted" style="font-size:12.5px;margin-top:12px">Plantillas guardadas: ${plantillasMayor().map((t) => `${esc(t.sistema)} <button class="lnk" data-borrar-tpl="${esc(t.sistema)}">borrar</button>`).join(" · ")}</p>` : ""}`);
  const pintarRoles = () => {
    $("mapRoles").innerHTML = ROLES_MAYOR.map(sel).join("");
    for (const s of $("mapRoles").querySelectorAll("select")) s.value = map[s.dataset.rol] ?? "";
  };
  const lectura = () => ({ headerRow: hr, map, amountMode: $("mapNum").value, unirContinuacion: $("mapUnir").checked, ignorar: $("mapIgnorar").value.split(",").map((x) => x.trim()).filter(Boolean) });
  const vista = () => {
    try {
      const led = parseLedgerRows(m.rows, { ...lectura(), doc: m.name, anio: state.extracto?.anio });
      const c = led.control;
      const ej = led.movs.slice(0, 4).map((x) => `<tr><td>${fmtISO(x.fecha)}</td><td>${esc(x.descripcion)}</td><td class="num">${fmtCents(x.cents)}</td></tr>`).join("");
      $("mapVista").innerHTML = `<div class="c-map-res ${c.ok === false ? "bad" : "ok"}">${dot(c.ok === true ? "verde" : c.ok === false ? "rojo" : "amarillo")} ${led.movs.length} registros · saldo ${fmtCents(led.apertura)} → ${fmtCents(led.cierre)} · ${c.ok === true ? "los saldos cierran" : c.ok === false ? "los saldos NO cierran: revisá Debe/Haber o el formato de números" : "sin saldo para verificar"}</div><table><tbody>${ej}</tbody></table>`;
      return led;
    } catch (e) { $("mapVista").innerHTML = `<div class="c-map-res bad">${dot("rojo")} ${esc(e.message)}</div>`; return null; }
  };
  $("mapNum").value = lec.amountMode || "auto";
  pintarRoles(); vista();
  $("mapFila").addEventListener("change", (e) => { hr = Math.max(0, Math.min(m.rows.length - 1, (+e.target.value || 1) - 1)); map = {}; pintarRoles(); vista(); });
  $("mapRoles").addEventListener("change", (e) => { const v = e.target.value; if (v === "") delete map[e.target.dataset.rol]; else map[e.target.dataset.rol] = +v; vista(); });
  for (const id of ["mapNum", "mapUnir", "mapIgnorar"]) $(id).addEventListener("change", vista);
  const armar = () => crearPlantillaMayor({ sistema: $("mapSistema").value.trim() || "Mayor", rows: m.rows, headerRow: hr, map, amountMode: $("mapNum").value, unirContinuacion: $("mapUnir").checked, ignorar: lectura().ignorar });
  $("mapAplicar").addEventListener("click", () => { if (!vista()) return; leerMayor(lectura(), null); resetDecisiones(); cerrarModal(); run(); });
  $("mapGuardar").addEventListener("click", () => {
    let tpl; try { tpl = armar(); } catch (e) { return toast(e.message); }
    if (!vista()) return;
    guardarPlantillaMayor(tpl); leerMayor(lectura(), tpl.sistema); resetDecisiones(); cerrarModal(); run();
    toast(`Plantilla "${tpl.sistema}" guardada: la próxima vez se lee sola.`);
  });
  $("mapBajar").addEventListener("click", () => {
    let tpl; try { tpl = armar(); } catch (e) { return toast(e.message); }
    download(`plantilla-mayor-${tpl.sistema.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`, JSON.stringify(tpl, null, 2), "application/json");
  });
  $("modalBody").querySelectorAll("[data-borrar-tpl]").forEach((b) => b.addEventListener("click", () => {
    lsSet(LS_TPL_MAYOR, JSON.stringify(plantillasMayor().filter((t) => t.sistema !== b.dataset.borrarTpl)));
    toast("Plantilla borrada."); abrirMapeo();
  }));
}

async function cargarArrastre(name, text) {
  const j = JSON.parse(text);
  if (!Array.isArray(j.pendientes)) throw new Error("no es un archivo de pendientes de Fulgoria");
  // Prefijo para que los ids del mes anterior no choquen con los de este mes.
  state.arrastre = j.pendientes.map((m) => ({ ...m, id: "P-" + m.id }));
  toast(`Cargué ${state.arrastre.length} pendientes del período anterior (${j.periodo || "?"}).`);
}

function mejorPlantilla(pdf) {
  let best = null;
  for (const t of safeJson(lsGet(LS_TPL)) || []) {
    const tpl = t.tpl;
    if (!tpl?.geometry?.columns) continue;
    const anchors = ((tpl.match && tpl.match.anchors) || []).map((a) => ({ text: a.text, x: a.box ? a.box.x : a.x }));
    const sc = matchScore(pdf.pages, anchors);
    if (sc >= 0.6 && (!best || sc > best.score)) best = { score: sc, tpl };
  }
  if (!best) return null;
  return {
    bank: best.tpl.meta?.bank || "",
    columns: best.tpl.geometry.columns.map((c) => ({ from: c.x_band.from, to: c.x_band.to, role: c.role || "texto", label: c.field || "Campo" })),
    rules: (best.tpl.rules || []).map((r) => ({ field: r.field, match: r.match, value: r.value })),
  };
}

// Nombre del banco a partir del encabezado (solo si una línea lo menciona; si no, vacío).
function adivinarBanco(items) {
  const top = items.filter((it) => it.y < 0.2 && /[a-záéíóúñ]{3,}/i.test(it.str));
  const lines = {};
  for (const it of top) (lines[Math.round(it.y * 200)] ||= []).push(it);
  for (const arr of Object.values(lines)) {
    const t = arr.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (/banco|coop|galicia|santander|macro|naci[oó]n|provincia|supervielle|credicoop|icbc|bbva|patagonia|hsbc|brubank|mercado pago|ciudad/i.test(t)) return t.slice(0, 40);
  }
  return "";
}

function resetDecisiones() { state.decisiones = { manuales: [], rechazados: [], confirmados: [] }; state.sel.banco.clear(); state.sel.libros.clear(); }

// ---------------------------------------------------------------- conciliar
function cfg() { return resolveConfig(state.mandos); }

function run() {
  renderDocs();
  const x = state.extracto, m = state.mayor;
  const listo = x && !x.error && m && m.led;
  $("result").hidden = !listo;
  drop.classList.toggle("compacta", !!(x || m));
  if (!listo) { state.rec = null; renderFlujo(); return; }
  const fechas = x.data.movs.map((v) => v.fecha).filter(Boolean).sort();
  const ult = fechas[fechas.length - 1] || m.led.movs.at(-1)?.fecha;
  const hasta = state.cierre || finDeMes(ult);
  const desde = (fechas[0] || ult).slice(0, 8) + "01";
  state.rec = reconcile({
    banco: x.data.movs, libros: m.led.movs, arrastre: state.arrastre,
    saldos: { bancoApertura: x.data.apertura, bancoCierre: x.data.cierre, librosApertura: m.led.apertura, librosCierre: m.led.cierre },
    periodo: { desde, hasta }, cfg: cfg(), decisiones: state.decisiones,
    // Si la lectura de un documento no está verificada, el motor no confirma nada solo.
    lectura: { banco: !!x.check.globalOk, libros: m.led.control.ok !== false },
  });
  renderResult();
  renderFlujo();
  programarGuardado();
}

function finDeMes(iso) {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const y = +iso.slice(0, 4), mo = +iso.slice(5, 7);
  const d = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- render: documentos
function renderDocs() {
  const x = state.extracto, m = state.mayor;
  const docX = x ? (() => {
    const segs = x.ext.segments;
    const sel = segs.length > 1 ? `<select id="segSel">${segs.map((s, i) => `<option value="${i}"${i === x.seg ? " selected" : ""}>Cuenta ${i + 1}${s.currency ? " · " + s.currency : ""} (${s.movements.length} mov.)</option>`).join("")}</select>` : "";
    if (x.error) return `<div class="c-doc">${dot("rojo")}<div><div class="k">Extracto</div><div class="n">${esc(x.name)}</div><div class="s">${esc(x.error)}</div></div></div>`;
    const ok = x.check.globalOk;
    return `<div class="c-doc">${dot(ok ? "verde" : "rojo")}<div><div class="k">Extracto${x.banco ? " · " + esc(x.banco) : ""}</div><div class="n">${esc(x.name)}</div>
      <div class="s">${x.data.movs.length} movimientos · saldo ${fmtCents(x.data.apertura)} → ${fmtCents(x.data.cierre)} · ${ok ? "lectura verificada con la regla del saldo" : `<b>la lectura no cierra</b> (diferencia ${fmtCents(Math.round(((x.check.closing ?? 0) - (x.check.computed ?? 0)) * 100))}): ${iaEstado.disponible && !soloLectura() ? "pedile a la IA que lea las columnas, o ajustalas" : "ajustá las columnas"} en el <a class="link" href="./">Extractor</a>`}${x.plantilla === "ia" ? " · columnas leídas por la IA" : x.plantilla ? " · plantilla reconocida" : ""}${x.pdf.scanned ? " · OCR" : ""}</div>${!ok && iaEstado.disponible && !soloLectura() ? `<button class="btn sm primary" data-ia="1" style="margin-top:8px">Pedirle a la IA que lea las columnas</button>` : ""}${sel}</div></div>`;
  })() : `<div class="c-doc falta">${ICON.doc}<div><div class="k">Extracto</div><div class="s">Falta el PDF o la imagen del extracto bancario.</div></div></div>`;
  const docM = m ? (m.error
    ? `<div class="c-doc">${dot("rojo")}<div><div class="k">Mayor</div><div class="n">${esc(m.name)}</div><div class="s">${esc(m.error)}</div>${m.rows ? `<button class="btn sm primary" data-mapear="1" style="margin-top:8px">Indicar columnas</button>` : ""}</div></div>`
    : (() => {
      const c = m.led.control;
      const est = c.ok === true ? "verde" : c.ok === false ? "rojo" : "amarillo";
      const txt = c.ok === true ? "saldos verificados" : c.ok === false ? `<b>el saldo no cierra</b>${c.filasConError.length ? ` en las filas ${c.filasConError.slice(0, 5).join(", ")}` : ""}` : "sin saldo para verificar";
      return `<div class="c-doc">${dot(est)}<div><div class="k">Mayor de la cuenta Banco</div><div class="n">${esc(m.name)}</div>
        <div class="s">${m.led.movs.length} registros · saldo ${fmtCents(m.led.apertura)} → ${fmtCents(m.led.cierre)} · ${txt}${m.led.avisos.length ? ` · ${m.led.avisos.length} aviso${m.led.avisos.length > 1 ? "s" : ""}` : ""}${m.plantilla ? ` · plantilla ${esc(m.plantilla)}` : ""} · <button class="lnk" data-mapear="1">columnas</button></div></div></div>`;
    })())
    : `<div class="c-doc falta">${ICON.sheet}<div><div class="k">Mayor</div><div class="s">Falta el mayor de la cuenta Banco (CSV exportado de tu sistema contable o un Excel guardado como CSV).</div></div></div>`;
  const docA = state.arrastre.length ? `<div class="c-doc">${dot("verde")}<div><div class="k">Pendientes del mes anterior</div><div class="s">${state.arrastre.length} partidas arrastradas · <button class="lnk" id="quitarArrastre">quitar</button></div></div></div>` : "";
  $("docs").innerHTML = docX + docM + docA;
  $("segSel")?.addEventListener("change", (e) => { elegirSegmento(+e.target.value); resetDecisiones(); run(); });
  $("quitarArrastre")?.addEventListener("click", () => { state.arrastre = []; run(); });
}

// ---------------------------------------------------------------- render: resultado
function renderResult() {
  const rec = state.rec;
  const sport = state.modo === "sport";
  $("result").classList.toggle("sport", sport);
  $("mandos").hidden = !sport;
  $("mesa").hidden = !sport;
  renderEstado(rec);
  renderBandeja(rec);
  renderPapel(rec);
  if (sport) { renderMesa(rec); renderMandos(); }
}

function renderEstado(rec) {
  const r = rec.resumen;
  const atencion = rec.bandeja.filter((t) => t.certeza !== "verde").length;
  const tit = r.estado === "verde" ? "Conciliado" : `${atencion} ${atencion === 1 ? "cosa necesita" : "cosas necesitan"} tu atención`;
  const leyendaRoja = !state.extracto.check.globalOk ? "La lectura del extracto no está verificada. " : "";
  const sub = `${leyendaRoja}${r.emparejadosVerde} de ${r.movimientosBanco} movimientos del banco conciliados solos · período ${fmtISO(rec.periodo.desde)} al ${fmtISO(rec.periodo.hasta)}`;
  const dif = rec.diferenciaNoExplicada;
  $("estado").className = "c-estado " + r.estado;
  $("estado").innerHTML = `${dot(r.estado, true)}<div><h2>${tit}</h2><div class="sub">${sub}</div></div>
    <div class="c-cifras">
      <div class="c-cifra"><div class="k">Saldo banco</div><div class="v">${fmtCents(rec.saldos.bancoCierre)}</div></div>
      <div class="c-cifra"><div class="k">Saldo libros</div><div class="v">${fmtCents(rec.saldos.librosCierre)}</div></div>
      <div class="c-cifra ${dif === 0 ? "ok" : "bad"}"><div class="k">Diferencia no explicada</div><div class="v">${fmtCents(dif)}</div></div>
    </div>`;
}

const mov = (id) => state.rec.movimientos[id];
function itemRow(id, extra = "") {
  const m = mov(id);
  const p = state.rec.pendientes.find((x) => x.id === id);
  const why = p?.motivo ? `<span class="why">${esc(p.motivo)}${p.antiguedadDias != null ? ` · ${p.antiguedadDias} día${p.antiguedadDias === 1 ? "" : "s"}` : ""}</span>` : "";
  const ev = m.evidencia?.page != null ? `<button class="lnk" data-ev="${esc(id)}">Ver en el extracto</button>` : m.evidencia?.row != null ? `<span class="muted" style="font-size:12px">${esc(m.evidencia.doc || "mayor")} · fila ${esc(m.evidencia.row)}</span>` : "";
  return `<div class="c-item"><span class="f">${fmtISO(m.fecha)}</span><span class="d">${esc(m.descripcion)}${m.arrastre ? ' <span class="muted">(mes anterior)</span>' : ""}${why}</span><span class="i ${m.cents < 0 ? "neg" : ""}">${fmtCents(m.cents)}</span>${ev || extra ? `<span class="x">${ev}${extra}</span>` : ""}</div>`;
}
function pairHtml(mt, acts = true) {
  const side = (ids, k) => `<div class="side"><div class="k">${k}</div>${ids.map((id) => { const m = mov(id); return `<div><span class="muted num">${fmtISO(m.fecha)}</span> ${esc(m.descripcion)} <b class="num">${fmtCents(m.cents)}</b>${m.evidencia?.page != null ? ` <button class="lnk" data-ev="${esc(id)}">ver</button>` : ""}</div>`; }).join("")}</div>`;
  const btns = acts ? (mt.certeza === "amarillo"
    ? `<div class="acts"><button class="btn sm primary" data-conf="${mt.id}">Confirmar</button><button class="btn sm ghost" data-rech="${mt.id}">No es esto</button></div>`
    : `<div class="acts"><button class="btn sm ghost" data-rech="${mt.id}">Deshacer</button></div>`) : "";
  return `<div class="c-match"><div class="c-pair">${side(mt.banco, "Banco")}<span class="arrow">${ICON.arrow}</span>${side(mt.libros, "Libros")}</div>
    <div class="why">¿Por qué? ${esc(mt.motivos.join(" · "))}${mt.diferenciaCents ? ` · diferencia ${fmtCents(mt.diferenciaCents)}` : ""}</div>${btns}</div>`;
}

const NOTAS = {
  diferencia_no_explicada: "Los saldos no cierran con las partidas encontradas. Lo más común: falta una página del extracto, el mayor no es de la misma fecha de cierre, o hay un movimiento que el lector no tomó. Revisá que ambos documentos sean del mismo período y completos.",
  apertura_no_cuadra: "La diferencia entre el saldo inicial del banco y el de libros no es la de las partidas pendientes del mes anterior. Cargá el archivo de pendientes del mes anterior (lo descargás desde el papel de trabajo de ese mes) o revisá los saldos iniciales.",
  creditos_no_identificados: "Entró plata al banco y no hay nada registrado que lo explique. Hay que preguntarle al cliente qué es (una cobranza, un préstamo, un aporte…) y pedirle el comprobante.",
  debitos_no_identificados: "Salió plata del banco y no hay nada registrado que lo explique. Hay que preguntarle al cliente a qué corresponde y pedirle el comprobante.",
  ingresos_no_acreditados: "Está registrado como ingreso hace más de unos días y el banco no lo acreditó. Puede ser un error de registración o un depósito rechazado.",
  egresos_a_revisar: "Están registrados como salida y el banco no los debitó. Si son cheques viejos, conviene confirmar si siguen en circulación.",
  lectura_no_verificada: "Los movimientos leídos no explican los saldos del documento: puede faltar una fila, una columna estar mal marcada o una página no haberse leído. Mientras tanto, nada se confirma solo. Abrí el extracto en el Extractor, ajustá las columnas y guardá la plantilla del banco.",
  emparejamientos_a_confirmar: "Son propuestas razonables pero no seguras. Confirmalas o marcá \"No es esto\" para que busque otra opción.",
  ajustes_bancarios: "El banco los debitó o acreditó y todavía no están en libros. Ya están clasificados y con su asiento propuesto: descargalos para importarlos en tu sistema.",
  pendientes_normales: "Partidas registradas cerca del cierre que el banco todavía no procesó. Es normal: se arrastran al mes siguiente.",
  conciliados: "Emparejados sin ambigüedad (mismo importe, referencia o fecha). Se confirmaron solos.",
};

function renderBandeja(rec) {
  const abiertos = new Set([...$("bandeja").querySelectorAll("details[open]")].map((d) => d.dataset.k));
  const primera = !$("bandeja").childElementCount;
  $("bandeja").innerHTML = rec.bandeja.map((t) => {
    const open = primera ? t.certeza !== "verde" : abiertos.has(t.clave);
    let acts = "", body = "";
    if (t.matches) {
      const ms = t.matches.map((id) => rec.matches.find((m) => m.id === id));
      body = ms.map((m) => pairHtml(m)).join("");
      if (t.certeza === "amarillo" && ms.length > 1) acts = `<button class="btn sm" data-confall="1">Confirmar todos</button>`;
    } else if (t.ids.length) {
      const ajuste = t.clave === "ajustes_bancarios";
      body = t.ids.map((id) => {
        const a = ajuste ? rec.ajustes.find((x) => x.origen.includes(id)) : null;
        const lin = a ? `<span class="muted" style="font-size:12px">${a.lineas.map((l) => `${l.debe ? "D" : "H"} ${esc(l.cuenta)} ${fmtCents(l.debe || l.haber)}`).join(" · ")}</span>` : "";
        return itemRow(id, lin);
      }).join("");
    }
    if (t.accion === "pedir_al_cliente") acts = `<button class="btn sm primary" data-pedir="${t.clave}">Pedir al cliente</button>`;
    if (t.accion === "generar_asientos") acts = `<button class="btn sm primary" data-exp="asientos">Descargar asientos</button>`;
    if (t.accion === "cargar_arrastre") acts = `<label class="btn sm">Cargar pendientes del mes anterior<input type="file" accept=".json" hidden data-arr="1" /></label>`;
    const nota = NOTAS[t.clave] ? `<div class="c-nota">${NOTAS[t.clave]}</div>` : "";
    const total = t.totalCents ? `<span class="num muted">${fmtCents(t.totalCents)}</span>` : "";
    return `<details class="c-card" data-k="${t.clave}"${open ? " open" : ""}><summary>${dot(t.certeza)}<span class="t">${esc(t.titulo)}</span>${total}<span class="acts">${acts}</span><span class="chev">${ICON.chev}</span></summary>
      <div class="c-card-body">${nota}${body}</div></details>`;
  }).join("");
}

function renderPapel(rec) {
  const meta = { banco: state.extracto.banco || state.extracto.name.replace(/\.[^.]+$/, "") };
  const p = papelSaldoASaldo(rec, meta);
  state.papel = p;
  const fila = (k, v, cls = "") => `<tr class="${cls}"><td>${k}</td><td class="num">${fmtCents(v)}</td></tr>`;
  let h = `<table><tbody>`;
  h += fila(`Saldo según extracto bancario al ${fmtISO(rec.periodo.hasta)}`, p.saldoBancoCents, "tot");
  for (const s of p.secciones) {
    h += fila(esc(s.titulo), s.subtotalCents, "sec");
    for (const i of s.items) h += `<tr class="det"><td>${fmtISO(i.fecha)} · ${esc(i.descripcion)}</td><td class="num">${fmtCents(i.cents)}</td></tr>`;
  }
  h += fila("Saldo según libros (calculado)", p.saldoLibrosCalculadoCents, "tot");
  h += fila("Saldo según mayor", p.saldoLibrosMayorCents);
  h += `<tr class="tot"><td>Diferencia no explicada</td><td class="num ${p.diferenciaNoExplicadaCents === 0 ? "difok" : "difbad"}">${fmtCents(p.diferenciaNoExplicadaCents)}</td></tr>`;
  h += `</tbody></table>`;
  h += `<p class="muted" style="font-size:12.5px">Saldo conciliado: banco ajustado ${fmtCents(p.saldoConciliado.bancoAjustadoCents)} · libros ajustado ${fmtCents(p.saldoConciliado.librosAjustadoCents)}</p>`;
  $("papel").innerHTML = h;
}

// ---------------------------------------------------------------- mesa (deportivo)
function renderMesa(rec) {
  const pend = (lado) => rec.pendientes.filter((p) => p.lado === lado).map((p) => mov(p.id)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const col = (lado, titulo) => {
    const list = pend(lado);
    return `<div class="c-mesa-col"><div class="k">${titulo} (${list.length})</div><div class="c-mesa-list">${list.map((m) =>
      `<label><input type="checkbox" data-sel="${lado}" value="${esc(m.id)}"${state.sel[lado].has(m.id) ? " checked" : ""} /><span class="muted num">${fmtISO(m.fecha)}</span><span>${esc(m.descripcion)}</span><b class="num">${fmtCents(m.cents)}</b></label>`).join("") || '<div class="c-nota">Nada pendiente.</div>'}</div></div>`;
  };
  const sb = [...state.sel.banco].reduce((s, id) => s + (mov(id)?.cents || 0), 0);
  const sl = [...state.sel.libros].reduce((s, id) => s + (mov(id)?.cents || 0), 0);
  const puede = state.sel.banco.size && state.sel.libros.size;
  const nMan = state.decisiones.manuales.length + state.decisiones.rechazados.length + state.decisiones.confirmados.length;
  $("mesa").innerHTML = `<h3>Mesa de conciliación</h3><div class="muted" style="font-size:12.5px">Elegí uno o varios de cada lado y emparejalos a mano. Las diferencias de importe quedan a la vista en el papel.</div>
    <div class="c-mesa-cols">${col("banco", "Banco sin pareja")}${col("libros", "Libros sin pareja")}</div>
    <div class="c-mesa-bar"><span>Banco <b class="num">${fmtCents(sb)}</b></span><span>Libros <b class="num">${fmtCents(sl)}</b></span><span>Diferencia <b class="num">${fmtCents(sl - sb)}</b></span><span class="sp"></span>
      ${nMan ? `<button class="btn sm ghost" id="limpiarDec">Deshacer mis decisiones (${nMan})</button>` : ""}
      <button class="btn sm primary" id="emparejar"${puede ? "" : " disabled"}>Emparejar</button></div>`;
}

// ---------------------------------------------------------------- mandos (deportivo)
const MANDOS = [
  { grp: "Emparejamiento" },
  { k: "match.ventanaDias.antes", t: "Días que el banco puede registrar ANTES", tipo: "int" },
  { k: "match.ventanaDias.despues", t: "Días que el banco puede registrar DESPUÉS", tipo: "int" },
  { k: "match.ventanaChequesDias", t: "Días para debitar un cheque", tipo: "int" },
  { k: "match.toleranciaCents", t: "Tolerancia de importe ($)", tipo: "money" },
  { k: "match.estrategias.agrupado", t: "Buscar agrupados (1 = varios)", tipo: "bool" },
  { k: "match.agrupado.maxItems", t: "Máximo de partidas por agrupado", tipo: "int" },
  { k: "match.intercambiablesVerde", t: "Importes repetidos en verde", tipo: "bool" },
  { grp: "Pendientes" },
  { k: "pendientes.depositoTransitoDias", t: "Depósito en tránsito hasta (días)", tipo: "int" },
  { k: "pendientes.chequeAlertaDias", t: "Alertar cheques con más de (días)", tipo: "int" },
  { grp: "Cliente" },
  { k: "cliente.pagoACuenta25413", t: "Ley 25.413: % pago a cuenta", tipo: "int" },
  { k: "cliente.responsableInscripto", t: "Responsable inscripto en IVA", tipo: "bool" },
  { grp: "Plan de cuentas" },
  ...Object.keys(DEFAULTS.cuentas).map((c) => ({ k: "cuentas." + c, t: DEFAULTS.cuentas[c], tipo: "text" })),
];
function getPath(o, k) { return k.split(".").reduce((a, p) => (a == null ? a : a[p]), o); }
function setPath(o, k, v) { const ps = k.split("."); let a = o; for (const p of ps.slice(0, -1)) a = a[p] ??= {}; a[ps.at(-1)] = v; }

function renderMandos() {
  const c = cfg();
  const html = [`<h3>Mandos</h3><div class="muted" style="font-size:12.5px">Cambian la conciliación en vivo. Se guardan en este navegador.</div>`,
    `<div class="grp"><div class="grp-t">Período</div><label class="f fecha">Fecha de cierre<input type="date" id="cierreIn" value="${state.cierre || state.rec.periodo.hasta}" style="width:auto" /></label></div>`];
  let open = false;
  for (const m of MANDOS) {
    if (m.grp) { if (open) html.push("</div>"); html.push(`<div class="grp"><div class="grp-t">${m.grp}</div>`); open = true; continue; }
    const v = getPath(c, m.k);
    if (m.tipo === "bool") html.push(`<label class="chk"><input type="checkbox" data-m="${m.k}" data-t="bool"${v ? " checked" : ""} />${esc(m.t)}</label>`);
    else if (m.tipo === "text") html.push(`<label class="f wide"><span class="muted" style="font-size:11.5px">${esc(m.t)}</span><input data-m="${m.k}" data-t="text" value="${esc(v)}" /></label>`);
    else html.push(`<label class="f">${esc(m.t)}<input type="number" min="0" step="${m.tipo === "money" ? "0.01" : "1"}" data-m="${m.k}" data-t="${m.tipo}" value="${esc(m.tipo === "money" ? v / 100 : v)}" /></label>`);
  }
  if (open) html.push("</div>");
  html.push(`<div class="grp"><button class="btn sm ghost" id="mandosReset">Volver a los valores por defecto</button></div>`);
  $("mandos").innerHTML = html.join("");
}

$("mandos").addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "cierreIn") { state.cierre = el.value || null; run(); return; }
  if (!el.dataset.m) return;
  const t = el.dataset.t;
  const v = t === "bool" ? el.checked : t === "int" ? Math.max(0, parseInt(el.value || "0", 10)) : t === "money" ? Math.round(parseFloat(el.value || "0") * 100) : el.value;
  setPath(state.mandos, el.dataset.m, v);
  if (est.cuenta) guardarMandosCuenta(); else lsSet(LS_MANDOS, JSON.stringify(state.mandos));
  run();
});
$("mandos").addEventListener("click", (e) => {
  if (e.target.id === "mandosReset") { state.mandos = {}; state.cierre = null; if (est.cuenta) guardarMandosCuenta(); else lsSet(LS_MANDOS, "{}"); run(); toast("Mandos en sus valores por defecto."); }
});

// ---------------------------------------------------------------- acciones (delegación)
document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-ev]");
  if (!b) return;
  if (b.closest("summary") && b.tagName === "BUTTON") e.preventDefault(); // un botón en el encabezado no abre/cierra la tarjeta
  const d = b.dataset;
  if (d.ev) return verEvidencia(d.ev);
  if (soloLectura() && (d.conf || d.rech || d.confall || d.mapear || b.id === "emparejar" || b.id === "limpiarDec")) return toast(puedo("editar") ? "El mes está cerrado. Reabrilo para hacer cambios." : "Tu rol solo permite ver.");
  if (d.mapear) return abrirMapeo();
  if (d.ia) return pedirColumnasIA();
  if (d.conf) { const m = state.rec.matches.find((x) => x.id === d.conf); state.decisiones.confirmados.push({ banco: m.banco, libros: m.libros }); return run(); }
  if (d.rech) {
    const m = state.rec.matches.find((x) => x.id === d.rech);
    const k = pairKey(m);
    state.decisiones.confirmados = state.decisiones.confirmados.filter((x) => pairKey(x) !== k);
    state.decisiones.manuales = state.decisiones.manuales.filter((x) => pairKey(x) !== k);
    if (m.estrategia !== "manual") state.decisiones.rechazados.push({ banco: m.banco, libros: m.libros });
    return run();
  }
  if (d.confall) { for (const m of state.rec.matches.filter((x) => x.certeza === "amarillo")) state.decisiones.confirmados.push({ banco: m.banco, libros: m.libros }); return run(); }
  if (d.pedir) return pedirAlCliente(d.pedir);
  if (d.exp) return exportar(d.exp);
  if (b.id === "emparejar") {
    state.decisiones.manuales.push({ banco: [...state.sel.banco], libros: [...state.sel.libros] });
    state.sel.banco.clear(); state.sel.libros.clear();
    return run();
  }
  if (b.id === "limpiarDec") { resetDecisiones(); return run(); }
  if (b.id === "modalX") return cerrarModal();
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset.sel) {
    const s = state.sel[el.dataset.sel];
    el.checked ? s.add(el.value) : s.delete(el.value);
    renderMesa(state.rec);
  }
  if (el.dataset.arr && el.files?.[0]) { try { await cargarArrastre(el.files[0].name, await el.files[0].text()); run(); } catch (err) { toast("No pude leer los pendientes: " + err.message); } }
});
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") cerrarModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarModal(); });

// Modo
function setModo(m) {
  state.modo = m; lsSet(LS_MODO, m);
  $("modoAuto").classList.toggle("on", m === "auto"); $("modoAuto").setAttribute("aria-selected", m === "auto");
  $("modoSport").classList.toggle("on", m === "sport"); $("modoSport").setAttribute("aria-selected", m === "sport");
  if (state.rec) renderResult();
}
$("modoAuto").addEventListener("click", () => setModo("auto"));
$("modoSport").addEventListener("click", () => setModo("sport"));

// ---------------------------------------------------------------- pedir al cliente
function pedirAlCliente(clave) {
  const t = state.rec.bandeja.find((x) => x.clave === clave);
  const items = [...t.ids].map(mov).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const mes = new Date(state.rec.periodo.hasta + "T12:00:00Z").toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
  const banco = state.extracto.banco ? ` de ${state.extracto.banco}` : "";
  const txt = `Hola, ¿cómo estás?\n\nEstamos cerrando la conciliación bancaria${banco} de ${mes} y necesitamos que nos ayudes con estos movimientos que no encontramos registrados:\n\n` +
    items.map((m) => `• ${fmtISO(m.fecha)} — ${m.descripcion} — $ ${fmtCents(Math.abs(m.cents))} (${m.cents > 0 ? "entró a la cuenta" : "salió de la cuenta"})`).join("\n") +
    `\n\n¿Nos contás a qué corresponde cada uno y, si lo tenés, nos mandás el comprobante (factura, recibo, contrato)?\n\n¡Gracias!`;
  abrirModal("Pedido al cliente", `<p>Copialo y mandalo por mail o WhatsApp. Podés editarlo antes.</p><textarea class="c-msg" id="msg">${esc(txt)}</textarea>
    <div class="modal-acciones"><button class="btn primary" id="copiarMsg">Copiar</button></div>`);
  $("copiarMsg").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("msg").value); toast("Copiado."); } catch { $("msg").select(); toast("Seleccionado: copialo con Ctrl+C."); }
  });
}

// ---------------------------------------------------------------- evidencia: el recorte del PDF
async function verEvidencia(id) {
  const m = mov(id);
  const pg = state.extracto.pdf.pages[(m.evidencia.page || 1) - 1];
  if (!pg) return;
  abrirModal(`${fmtISO(m.fecha)} · ${esc(m.descripcion)}`, `<div class="c-evid"><div class="muted">Cargando la página…</div></div>`);
  try {
    const src = pg.ocrCanvas || await renderToCanvas(pg.page, 1400);
    const W = src.width, H = src.height;
    const y = (m.evidencia.y ?? 0.5) * H;
    const top = Math.max(0, Math.round(y - H * 0.06)), bot = Math.min(H, Math.round(y + H * 0.06));
    const out = document.createElement("canvas");
    out.width = W; out.height = bot - top;
    const ctx = out.getContext("2d");
    ctx.drawImage(src, 0, top, W, bot - top, 0, 0, W, bot - top);
    // Marca la fila: banda translúcida del color de acento (plana, sin brillo).
    const band = H * 0.012;
    ctx.fillStyle = "rgba(59,118,217,.16)";
    ctx.fillRect(0, y - top - band, W, band * 2);
    ctx.fillStyle = "rgba(59,118,217,.9)";
    ctx.fillRect(0, y - top - band, 4, band * 2);
    const box = $("modalBody").querySelector(".c-evid");
    box.innerHTML = "";
    box.appendChild(out);
    box.insertAdjacentHTML("beforeend", `<div class="cap">${esc(m.evidencia.doc || "")} · página ${m.evidencia.page} · importe ${fmtCents(m.cents)}</div>`);
  } catch (e) {
    $("modalBody").querySelector(".c-evid").textContent = "No pude mostrar la página: " + e.message;
  }
}

// ---------------------------------------------------------------- exportar
function exportar(kind) {
  const rec = state.rec, p = state.papel;
  const base = `conciliacion-${(state.extracto.banco || "banco").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${rec.periodo.hasta.slice(0, 7)}`;
  if (kind === "md") return download(base + ".md", papelToMarkdown(p), "text/markdown");
  if (kind === "csv") return download(base + ".csv", papelToCsv(p), "text/csv");
  if (kind === "asientos") return download(base + "-asientos.csv", asientosToCsv(rec.ajustes), "text/csv");
  if (kind === "json") return download(base + ".json", JSON.stringify({ ...rec, decisiones: state.decisiones, mandos: state.mandos }, null, 2), "application/json");
  if (kind === "arrastre") {
    // Los ajustes bancarios se dan por asentados (se descargaron como asientos): no pasan.
    const aceptados = rec.pendientes.filter((x) => x.tipo === "ajuste_bancario").map((x) => x.id);
    const pendientes = arrastreSiguiente(rec, aceptados);
    return download(base + "-pendientes.json", JSON.stringify({ fulgoria_pendientes: 1, periodo: rec.periodo.hasta.slice(0, 7), pendientes }, null, 2), "application/json");
  }
}
function download(name, text, mime) {
  // Dentro de un visor embebido (iframe) las descargas pueden estar bloqueadas: muestro el
  // contenido para copiarlo. Fuera de un iframe (la app normal), descarga directa.
  let embebido = false;
  try { embebido = window.top !== window.self; } catch { embebido = true; }
  if (embebido) {
    abrirModal(esc(name), `<p>Copiá el contenido y pegalo en un archivo <b>${esc(name)}</b> (o directamente en Excel si es CSV).</p><textarea class="c-msg" id="expTxt" readonly>${esc(text.replace(/^\uFEFF/, ""))}</textarea>
      <div class="modal-acciones"><button class="btn primary" id="copiarExp">Copiar</button></div>`);
    $("copiarExp").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("expTxt").value); toast("Copiado."); } catch { $("expTxt").select(); toast("Seleccionado: copialo con Ctrl+C."); }
    });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- utilidades de UI
function abrirModal(tit, html, { ancho = false } = {}) { $("modalTit").innerHTML = tit; $("modalBody").innerHTML = html; $("modal").querySelector(".modal-card").classList.toggle("ancho", ancho); $("modal").hidden = false; }
function cerrarModal() { $("modal").hidden = true; }
function toast(msg, ms = 3200) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms); }
function progress(msg) { const el = $("progress"); if (msg) { el.textContent = msg; el.style.display = "block"; } else el.style.display = "none"; }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function paintTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  $("themeBtn").innerHTML = dark ? ICON.sun : ICON.moon;
  $("themeBtn").title = dark ? "Tema claro" : "Tema oscuro";
}
$("themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  if (dark) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", "dark");
  lsSet("fulgoria.theme", dark ? "light" : "dark");
  paintTheme();
});
paintTheme();
setModo(state.modo);


// =====================================================================================================
// Modo estudio (persistencia en el servidor del estudio o en su bucket S3/R2)
// Se activa solo si /api/v1/estado lo indica. El procesamiento sigue en el navegador; el servidor
// guarda los documentos, las decisiones, el resultado, los pendientes para el mes siguiente y el
// estado del mes (borrador → preparado → revisado → cerrado).
// =====================================================================================================
// `abierto` = el mes cuyos datos están en pantalla ({ cuentaId, periodo }). Todo guardado va a ESE mes,
// nunca al que esté eligiendo el usuario en ese momento; `gen` descarta aperturas que quedaron viejas.
const est = { activo: false, usuario: null, clientes: [], cuentas: [], cliente: null, cuenta: null, periodo: null, per: null, anterior: null, docs: { extracto: null, mayor: null }, ultimo: "", timer: 0, abierto: null, gen: 0 };
const puedo = (permiso) => !est.activo || (est.permisos || []).includes(permiso);
// Solo lectura: mes cerrado, o un rol que no puede modificar (lector).
const soloLectura = () => est.activo && (est.per?.estado === "cerrado" || !puedo("editar"));

async function srv(metodo, ruta, body, headers = {}) {
  try {
    const bin = body instanceof Blob;
    const r = await fetch("/api/v1" + ruta, {
      method: metodo, credentials: "same-origin",
      headers: body && !bin ? { "content-type": "application/json", ...headers } : headers,
      body: body == null ? undefined : bin ? body : JSON.stringify(body),
    });
    if (r.status === 401) { location.href = "/login"; return { ok: false, status: 401, body: {} }; }
    const ct = r.headers.get("content-type") || "";
    return { ok: r.ok, status: r.status, body: ct.includes("json") ? await r.json() : await r.blob(), headers: r.headers };
  } catch (e) { return { ok: false, status: 0, body: { mensaje: "Sin conexión con el servidor." } }; }
}
function setGuardado(txt, mal = false) { const g = $("guardado"); g.textContent = txt; g.classList.toggle("bad", mal); }

async function iniciarEstudio() {
  const r = await srv("GET", "/estado");
  if (!r.ok || !r.body.persistencia) return; // modo local: todo como siempre
  est.activo = true; est.usuario = r.body.usuario; est.rol = r.body.rol || "admin"; est.permisos = r.body.permisos || ["leer", "editar", "preparar", "revisar", "administrar"];
  $("cartera").hidden = false;
  $("nuevoCliente").hidden = $("nuevaCuenta").hidden = !puedo("editar");
  if (r.body.modoUsuarios === "local" && puedo("administrar")) $("verUsuarios").hidden = false;
  if (puedo("administrar")) $("verIA").hidden = false;
  $("sesion").textContent = r.body.modoUsuarios === "sin_login" ? "" : `${est.usuario} · ${est.rol}`;
  $("selMes").value = new Date().toISOString().slice(0, 7);
  est.periodo = $("selMes").value;
  setGuardado(`Guardando en el ${r.body.almacenamiento === "s3" ? "bucket" : "servidor"} del estudio${r.body.cifrado ? " (cifrado)" : ""}`);
  await sincronizarPlantillas();
  await cargarClientes();
}

// Las plantillas (de banco y de mayor) son del estudio: se bajan al empezar y quedan disponibles.
async function sincronizarPlantillas() {
  const r = await srv("GET", "/plantillas");
  if (!r.ok) return;
  const bancos = safeJson(lsGet(LS_TPL)) || [];
  for (const p of r.body.filter((x) => x.tipo === "banco")) {
    const id = p.plantilla.meta?.template_id || p.nombre;
    const i = bancos.findIndex((t) => t.id === id);
    const entrada = { id, bank: p.plantilla.meta?.bank || p.nombre, tpl: p.plantilla };
    if (i >= 0) bancos[i] = entrada; else bancos.push(entrada);
  }
  lsSet(LS_TPL, JSON.stringify(bancos));
  for (const p of r.body.filter((x) => x.tipo === "mayor")) guardarPlantillaMayor(p.plantilla, false);
}

async function cargarClientes(seleccionar) {
  const r = await srv("GET", "/clientes");
  est.clientes = r.ok ? r.body : [];
  $("selCliente").innerHTML = `<option value="">— Elegí un cliente —</option>` + est.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  if (seleccionar) $("selCliente").value = seleccionar;
  await elegirCliente($("selCliente").value);
}
async function elegirCliente(id, cuentaId) {
  est.cliente = est.clientes.find((c) => c.id === id) || null;
  const r = est.cliente ? await srv("GET", `/clientes/${id}/cuentas`) : { ok: true, body: [] };
  est.cuentas = r.ok ? r.body : [];
  $("selCuenta").innerHTML = (est.cliente ? `<option value="">— Elegí una cuenta —</option>` : `<option value="">—</option>`) +
    est.cuentas.map((c) => `<option value="${c.id}">${esc(c.nombre)}${c.banco ? " · " + esc(c.banco) : ""}</option>`).join("");
  $("selCuenta").disabled = !est.cliente;
  $("nuevaCuenta").disabled = !est.cliente;
  if (cuentaId) $("selCuenta").value = cuentaId;
  else if (est.cuentas.length === 1) $("selCuenta").value = est.cuentas[0].id;
  await elegirCuenta($("selCuenta").value);
}
async function elegirCuenta(id) {
  est.cuenta = est.cuentas.find((c) => c.id === id) || null;
  if (est.cuenta) await abrirPeriodo();
  else { est.gen++; est.abierto = null; est.per = null; est.docs = { extracto: null, mayor: null }; renderFlujo(); }
}

/** Abre un mes: baja sus documentos, sus decisiones y los pendientes del mes anterior, y concilia. */
async function abrirPeriodo() {
  if (!est.cuenta || !est.periodo) return;
  clearTimeout(est.timer);
  const gen = ++est.gen, destino = { cuentaId: est.cuenta.id, periodo: est.periodo };
  est.abierto = null; // mientras se abre, no se guarda nada
  setGuardado("Abriendo…");
  const r = await srv("GET", `/cuentas/${destino.cuentaId}/periodos/${destino.periodo}`);
  if (gen !== est.gen) return; // el usuario ya eligió otro mes
  if (!r.ok) { setGuardado(r.body.mensaje || "No se pudo abrir el mes", true); return; }
  const per = r.body.periodo;
  est.per = per; est.anterior = r.body.anterior;
  est.docs = { extracto: per?.extractoDoc || null, mayor: per?.mayorDoc || null };
  state.extracto = null; state.mayor = null; state.cierre = null; resetDecisiones();
  state.mandos = structuredClone(est.cuenta.mandos || {});
  // Arrastre automático: lo que quedó pendiente el mes anterior.
  state.arrastre = (r.body.anterior?.pendientes || []).map((m) => ({ ...m }));
  try {
    if (per?.extractoDoc) { const d = await bajarDocumento(per.extractoDoc); await cargarExtracto(d.nombre, d.blob); if (per.segmento) elegirSegmento(per.segmento); }
    if (per?.mayorDoc) { const d = await bajarDocumento(per.mayorDoc); await cargarMayor(d.nombre, await d.blob.text()); }
  } catch (e) { toast("No pude abrir los documentos guardados: " + e.message); }
  if (gen !== est.gen) return;
  if (per?.decisiones) state.decisiones = { manuales: [], rechazados: [], confirmados: [], ...per.decisiones };
  document.body.classList.toggle("solo-lectura", soloLectura());
  est.abierto = destino;
  run();
  est.ultimo = firmaGuardado(); // recién abierto: no hay nada nuevo que guardar
  setGuardado(per ? `Abierto · guardado ${new Date(per.actualizado).toLocaleString("es-AR")} por ${per.actualizadoPor}` : (est.anterior ? `Mes nuevo · ${state.arrastre.length} pendientes de ${est.anterior.periodo}` : "Mes nuevo"));
}
async function bajarDocumento(id) {
  const r = await srv("GET", `/documentos/${id}`);
  if (!r.ok) throw new Error(r.body?.mensaje || `documento ${r.status}`);
  const cd = r.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  return { blob: r.body, nombre: m ? decodeURIComponent(m[1]) : "documento" };
}

/** Sube un documento recién soltado al estudio (si hay una cuenta y un mes abiertos). */
async function estudioSubir(tipo, file) {
  if (!est.activo || !est.abierto) return;
  setGuardado("Subiendo " + file.name + "…");
  const r = await srv("POST", "/documentos", file, { "x-tipo": tipo, "x-nombre": encodeURIComponent(file.name), "content-type": file.type || (tipo === "mayor" ? "text/csv" : "application/octet-stream") });
  if (!r.ok) { setGuardado(r.body.mensaje || "No se pudo subir el documento", true); return; }
  est.docs[tipo] = r.body.id;
}

// ---------------- guardado automático
function cuerpoGuardado() {
  const rec = state.rec;
  if (!rec || !est.abierto || !est.docs.extracto || !est.docs.mayor) return null;
  const aceptados = rec.pendientes.filter((p) => p.tipo === "ajuste_bancario").map((p) => p.id);
  // Ids de los pendientes con el mes de origen, para que no choquen al arrastrarse varios meses.
  const pendientes = arrastreSiguiente(rec, aceptados).map((m) => ({ ...m, id: String(m.id).includes(":") ? m.id : `${est.abierto.periodo}:${m.id}` }));
  return {
    extractoDoc: est.docs.extracto, mayorDoc: est.docs.mayor, segmento: state.extracto?.seg || 0, decisiones: state.decisiones,
    resumen: {
      estado: rec.resumen.estado, diferenciaNoExplicada: rec.diferenciaNoExplicada, atencion: rec.bandeja.filter((t) => t.certeza !== "verde").length,
      saldos: rec.saldos, movimientosBanco: rec.resumen.movimientosBanco, emparejadosVerde: rec.resumen.emparejadosVerde, pendientes: rec.resumen.pendientes,
    },
    pendientes,
    resultado: { papel: state.papel, ajustes: rec.ajustes },
  };
}
const firmaGuardado = () => JSON.stringify(cuerpoGuardado());
function programarGuardado() {
  if (!est.activo || !est.abierto || soloLectura()) return;
  clearTimeout(est.timer);
  est.timer = setTimeout(() => guardarPeriodo(), 800);
}
async function guardarPeriodo(accion) {
  clearTimeout(est.timer);
  const destino = est.abierto;
  if (!destino) return false;
  const body = cuerpoGuardado();
  if (!body) { if (accion) toast("Faltan el extracto o el mayor."); return false; }
  const firma = JSON.stringify(body);
  if (!accion && firma === est.ultimo) return true;
  setGuardado(accion ? "Actualizando el estado…" : "Guardando…");
  const r = await srv("PUT", `/cuentas/${destino.cuentaId}/periodos/${destino.periodo}`, { ...body, version: est.per?.version, accion });
  if (est.abierto !== destino) return r.ok; // mientras guardaba se abrió otro mes: no pisar su estado
  if (r.ok) {
    est.per = r.body; est.ultimo = firma;
    setGuardado(`Guardado · ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`);
    document.body.classList.toggle("solo-lectura", soloLectura());
    renderFlujo();
    return true;
  }
  if (r.status === 409) { toast("Otra persona guardó cambios en este mes: lo vuelvo a abrir con lo último."); await abrirPeriodo(); return false; }
  if (r.status === 403) { setGuardado(r.body.mensaje, true); toast(r.body.mensaje); return false; }
  setGuardado(r.body.mensaje || "No se pudo guardar", true);
  if (accion) toast(r.body.mensaje || "No se pudo guardar");
  return false;
}

// ---------------- estado del mes (preparó / revisó / cerrado)
const ESTADO_TXT = { borrador: "Borrador", preparado: "Preparado", revisado: "Revisado", cerrado: "Cerrado" };
function renderFlujo() {
  const f = $("flujo");
  const visible = est.activo && est.cuenta && state.rec;
  f.hidden = !visible;
  if (!visible) return;
  const p = est.per || { estado: "borrador" };
  const quien = (u, t) => (u ? `<b>${esc(u)}</b> · ${new Date(t).toLocaleDateString("es-AR")}` : "—");
  const dif = state.rec.diferenciaNoExplicada;
  const boton = soloLecturaPorRol() ? "" : {
    borrador: `<button class="btn sm primary" data-flujo="preparar">Marcar preparado</button>`,
    preparado: `<button class="btn sm primary" data-flujo="revisar">Marcar revisado</button>`,
    revisado: `<button class="btn sm primary" data-flujo="cerrar"${dif !== 0 ? ` disabled title="Con diferencia no explicada no se cierra"` : ""}>Cerrar el mes</button>`,
    cerrado: `<button class="btn sm ghost" data-flujo="reabrir">Reabrir</button>`,
  }[p.estado];
  // Cada botón solo para quien puede usarlo: preparar (preparador+), revisar/cerrar/reabrir (revisor+).
  const permisoDe = { borrador: "preparar", preparado: "revisar", revisado: "revisar", cerrado: "revisar" }[p.estado];
  const accion = puedo(permisoDe) ? boton : `<span class="paso">${{ borrador: "Lo prepara un preparador o revisor", preparado: "Lo revisa un revisor", revisado: "Lo cierra un revisor", cerrado: "Lo reabre un revisor" }[p.estado]}</span>`;
  const ant = est.anterior ? `<span class="paso">Mes anterior: ${ESTADO_TXT[est.anterior.estado] || est.anterior.estado}${state.arrastre.length ? ` · ${state.arrastre.length} pendientes arrastrados` : ""}</span>` : "";
  f.innerHTML = `<span class="c-chip ${p.estado}">${ESTADO_TXT[p.estado]}</span>
    <span class="paso">Preparó: ${quien(p.preparo, p.preparoEn)}</span><span class="paso">Revisó: ${quien(p.reviso, p.revisoEn)}</span>
    ${p.estado === "cerrado" ? `<span class="paso">Cerró: ${quien(p.cerro, p.cerroEn)}</span>` : ""}${ant}<span class="sp"></span>${accion}`;
}

function soloLecturaPorRol() { return est.activo && !puedo("editar") && !puedo("preparar"); }

// ---------------- usuarios (modo standalone, solo admin)
async function abrirUsuarios() {
  const r = await srv("GET", "/usuarios");
  if (!r.ok) return toast(r.body.mensaje || "No pude abrir los usuarios.");
  const { roles, usuarios } = r.body;
  const optRol = (sel) => roles.map((x) => `<option value="${x}"${x === sel ? " selected" : ""}>${x}</option>`).join("");
  const filas = usuarios.map((x) => `<tr><td><b>${esc(x.usuario)}</b>${x.nombre ? `<div class="muted">${esc(x.nombre)}</div>` : ""}</td>
    <td><select data-u-rol="${esc(x.usuario)}">${optRol(x.rol)}</select></td>
    <td><label class="chk"><input type="checkbox" data-u-activo="${esc(x.usuario)}"${x.activo ? " checked" : ""} /> activo</label></td>
    <td><button class="lnk" data-u-clave="${esc(x.usuario)}">cambiar contraseña</button></td></tr>`).join("");
  abrirModal("Usuarios del estudio", `<p>El usuario del archivo de configuración (<b>${esc(est.usuario)}</b>) es administrador. Los cambios de rol y las bajas rigen en el momento.</p>
    <p class="muted" style="font-size:12.5px">lector: mira · preparador: carga, concilia y marca preparado · revisor: además revisa, cierra y reabre · admin: además administra usuarios</p>
    <div class="c-tablero"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>${filas || `<tr><td colspan="4" class="vacio">Todavía no hay otros usuarios.</td></tr>`}</tbody></table></div>
    <form class="c-form" id="altaUsuario"><b style="margin-top:10px">Agregar usuario</b>
      <label>Usuario<input name="usuario" required placeholder="ana.gomez" autocomplete="off" /></label>
      <label>Nombre (opcional)<input name="nombre" placeholder="Ana Gómez" /></label>
      <label>Contraseña inicial (10 caracteres o más)<input name="password" type="password" required minlength="10" autocomplete="new-password" /></label>
      <label>Rol<select name="rol">${optRol("preparador")}</select></label>
      <div class="modal-acciones"><button class="btn primary" type="submit">Agregar</button></div></form>`, { ancho: true });
  const body = $("modalBody");
  body.querySelectorAll("[data-u-rol]").forEach((el) => el.addEventListener("change", async () => {
    const x = await srv("PATCH", `/usuarios/${encodeURIComponent(el.dataset.uRol)}`, { rol: el.value });
    toast(x.ok ? "Rol actualizado." : x.body.mensaje);
  }));
  body.querySelectorAll("[data-u-activo]").forEach((el) => el.addEventListener("change", async () => {
    const x = await srv("PATCH", `/usuarios/${encodeURIComponent(el.dataset.uActivo)}`, { activo: el.checked });
    toast(x.ok ? (el.checked ? "Usuario activado." : "Usuario desactivado: ya no puede entrar.") : x.body.mensaje);
  }));
  body.querySelectorAll("[data-u-clave]").forEach((el) => el.addEventListener("click", () => {
    const quien = el.dataset.uClave;
    formModal(`Nueva contraseña para ${esc(quien)}`, [{ k: "password", t: "Contraseña (10 caracteres o más)", req: true }], async (d) => {
      const x = await srv("PATCH", `/usuarios/${encodeURIComponent(quien)}`, { password: d.password });
      toast(x.ok ? "Contraseña cambiada." : x.body.mensaje); return x.ok;
    });
  }));
  $("altaUsuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const x = await srv("POST", "/usuarios", Object.fromEntries(new FormData(e.target)));
    if (!x.ok) return toast(x.body.mensaje);
    toast("Usuario agregado."); abrirUsuarios();
  });
}
$("verUsuarios").addEventListener("click", abrirUsuarios);

// ---------------- configuración de la IA (solo admin): sin IA, IA local o IA externa
async function abrirConfigIA() {
  const r = await srv("GET", "/ia/config");
  if (!r.ok) return toast(r.body.mensaje || "No pude abrir la configuración de la IA.");
  const v = r.body, L = v.local || {}, E = v.externa || {}, provs = v.proveedores;
  const nombreProv = (k) => (k === "local" ? "IA local" : provs[k]?.nombre || k);
  const enUso = v.enUso
    ? `En uso: <b>${esc(nombreProv(v.enUso.proveedor))} · ${esc(v.enUso.modelo)}</b> (${v.enUso.origen === "panel" ? "elegida acá" : "desde el .env del servidor"})`
    : v.modo === "ninguna" && v.origen === "panel" ? "La IA está <b>apagada</b>." : `Sin IA en uso${v.error ? ` · <span class="bad">${esc(v.error)}</span>` : ""}.`;
  const estadoL = L.modelo ? `${esc(L.modelo)}${L.desdeEnv ? " · del .env" : ""}` : "sin configurar";
  const estadoE = E.proveedor ? `${esc(nombreProv(E.proveedor))}${E.modelo ? " · " + esc(E.modelo) : ""}${E.clave ? ` · clave ${esc(E.clave)}` : ""}` : "sin configurar";
  const opcion = (k, t, d, est) => `<label class="c-modo"><input type="radio" name="modo" value="${k}"${v.modo === k ? " checked" : ""} /><span><b>${t}</b><small>${d}</small>${est ? `<small class="c-modo-est">${est}</small>` : ""}</span></label>`;
  const provSel = E.proveedor || "anthropic";
  abrirModal("IA para bancos nuevos", `<p>${enUso}</p>
    <form class="c-form" id="iaForm" autocomplete="off">
      <div class="c-modos">
        ${opcion("ninguna", "Sin IA", "Las columnas de un banco nuevo se marcan a mano.")}
        ${opcion("local", "IA local", "Corre en tu servidor: nada sale del estudio.", estadoL)}
        ${opcion("externa", "IA externa", "Claude, OpenAI, Gemini u OpenRouter.", estadoE)}
      </div>
      <div id="iaLocal" class="c-form">
        <label>Modelo<span class="c-fila"><input name="lModelo" list="iaModelosL" value="${esc(L.modelo || "")}" placeholder="p. ej. qwen2.5:7b" /><button type="button" class="btn sm ghost" data-listar="local">Ver modelos</button></span><datalist id="iaModelosL"></datalist></label>
        <label>URL del servidor de modelos<input name="lUrl" value="${esc(L.url || "")}" placeholder="por defecto: ${esc(v.urlLocal)} · en EasyPanel: http://<proyecto>_ollama:11434/v1" /></label>
        <label>Temperatura (opcional)<input name="lTemp" type="number" min="0" max="2" step="0.1" value="${L.temperatura ?? ""}" placeholder="vacía = no se manda" /></label>
      </div>
      <div id="iaExterna" class="c-form">
        <label>Proveedor<select name="eProv">${Object.entries(provs).map(([k, x]) => `<option value="${esc(k)}"${k === provSel ? " selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label>
        <label>Modelo<span class="c-fila"><input name="eModelo" list="iaModelosE" value="${esc(E.modelo || "")}" /><button type="button" class="btn sm ghost" data-listar="externa">Ver modelos</button></span><datalist id="iaModelosE"></datalist></label>
        <label>Clave de API<input name="eClave" type="password" autocomplete="new-password" /></label>
        <label>URL (opcional)<input name="eUrl" value="${esc(E.url || "")}" /></label>
        <label>Temperatura (opcional)<input name="eTemp" type="number" min="0" max="2" step="0.1" value="${E.temperatura ?? ""}" placeholder="vacía = no se manda" /></label>
        <p class="muted" style="font-size:12px;margin:0">Al modelo externo solo le llega el esqueleto anónimo del extracto (posiciones y tipos de celda, sin nombres, montos ni cuentas).${v.puedeGuardarClave ? " La clave se guarda cifrada y no se vuelve a mostrar." : " <b>Para guardar una clave hace falta DOCS_CLAVE en el servidor.</b>"}</p>
      </div>
      <label id="iaMax">Consultas por persona y por hora<input name="maxPorHora" type="number" min="1" max="1000" step="1" value="${v.maxPorHora ?? 30}" /></label>
      <p id="iaTempNota" class="muted" style="font-size:12px;margin:0">Temperatura: vacía es lo recomendado. Hay modelos que no la aceptan (los de razonamiento de OpenAI, los Claude actuales): si el modelo la rechaza, Fulgoria reintenta sin ella.</p>
      <div id="iaRes" class="c-nota" hidden></div>
      <div class="modal-acciones">${v.origen === "panel" && v.env ? `<button type="button" class="btn ghost" id="iaEnv">Volver al .env</button>` : ""}<button type="button" class="btn" id="iaProbar">Probar</button><button class="btn primary" type="submit">Guardar</button></div>
    </form>`, { ancho: true });
  const f = $("iaForm");
  const modo = () => f.querySelector("input[name=modo]:checked")?.value || "ninguna";
  const datos = (m = modo()) => {
    const d = { modo: m, maxPorHora: f.maxPorHora.value };
    if (m === "local") d.local = { modelo: f.lModelo.value, url: f.lUrl.value, temperatura: f.lTemp.value };
    if (m === "externa") d.externa = { proveedor: f.eProv.value, modelo: f.eModelo.value, url: f.eUrl.value, temperatura: f.eTemp.value, ...(f.eClave.value ? { apiKey: f.eClave.value } : {}) };
    return d;
  };
  const nota = (txt, mal = false) => { const n = $("iaRes"); n.hidden = false; n.textContent = txt; n.classList.toggle("bad", mal); };
  const ajustar = () => {
    const m = modo(), p = provs[f.eProv.value];
    $("iaLocal").hidden = m !== "local"; $("iaExterna").hidden = m !== "externa";
    $("iaMax").hidden = $("iaTempNota").hidden = $("iaProbar").hidden = m === "ninguna";
    f.eUrl.placeholder = p.url ? `por defecto: ${p.url}` : "por defecto la del proveedor";
    f.eModelo.placeholder = p.modelo ? `por defecto: ${p.modelo}` : "el nombre exacto del modelo";
    f.eClave.placeholder = f.eProv.value === E.proveedor && E.clave ? `guardada (${E.clave}); dejala vacía para mantenerla` : "pegala acá";
    $("iaRes").hidden = true;
  };
  f.addEventListener("change", (e) => { if (e.target.name === "modo" || e.target.name === "eProv") ajustar(); });
  ajustar();
  f.querySelectorAll("[data-listar]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.listar;
    nota("Pidiendo la lista de modelos…");
    const x = await srv("POST", "/ia/modelos", datos(m));
    if (!x.ok) return nota(x.body.mensaje || "No pude listar los modelos.", true);
    $(m === "local" ? "iaModelosL" : "iaModelosE").innerHTML = x.body.modelos.map((id) => `<option value="${esc(id)}"></option>`).join("");
    nota(x.body.modelos.length ? `${x.body.modelos.length} modelos disponibles: empezá a escribir en Modelo para elegir.` : "El servidor no devolvió modelos (en Ollama: ollama pull <modelo>).");
  }));
  $("iaProbar").addEventListener("click", async () => {
    nota("Probando con un extracto de ejemplo (no es de ningún cliente)…");
    const x = await srv("POST", "/ia/probar", datos());
    nota(x.ok ? `Funciona: respondió ${x.body.propuestas} propuesta(s) en ${(x.body.ms / 1000).toFixed(1)} s.` : x.body.mensaje || "No funcionó.", !x.ok);
  });
  $("iaEnv")?.addEventListener("click", async () => {
    const x = await srv("DELETE", "/ia/config");
    if (!x.ok) return nota(x.body.mensaje || "No pude volver al .env.", true);
    cerrarModal(); toast("La IA vuelve a tomar la configuración del .env."); refrescarIA();
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const x = await srv("PUT", "/ia/config", datos());
    if (!x.ok) return nota(x.body.mensaje || "No pude guardar.", true);
    cerrarModal();
    toast(x.body.enUso ? `IA activa: ${nombreProv(x.body.enUso.proveedor)} · ${x.body.enUso.modelo}` : "IA apagada: las columnas de un banco nuevo se marcan a mano.");
    refrescarIA();
  });
}
async function refrescarIA() { iaEstado.disponible = false; await iniciarIA(); if (state.extracto) renderDocs(); }
$("verIA").addEventListener("click", abrirConfigIA);

// ---------------- mandos por cuenta
function guardarMandosCuenta() {
  est.cuenta.mandos = structuredClone(state.mandos);
  clearTimeout(guardarMandosCuenta._t);
  guardarMandosCuenta._t = setTimeout(() => srv("PATCH", `/cuentas/${est.cuenta.id}`, { mandos: state.mandos }), 600);
}

// ---------------- altas
function formModal(titulo, campos, alGuardar) {
  abrirModal(titulo, `<form class="c-form" id="altaForm">${campos.map((c) => c.opciones
    ? `<label>${c.t}<select name="${c.k}">${c.opciones.map((o) => `<option value="${o}">${o}</option>`).join("")}</select></label>`
    : `<label>${c.t}<input name="${c.k}" ${c.req ? "required" : ""} placeholder="${esc(c.ph || "")}" /></label>`).join("")}
    <div class="modal-acciones"><button class="btn primary" type="submit">Guardar</button></div></form>`);
  $("altaForm").querySelector("input")?.focus();
  $("altaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target));
    if (await alGuardar(datos)) cerrarModal();
  });
}
$("nuevoCliente").addEventListener("click", () => formModal("Nuevo cliente", [{ k: "nombre", t: "Razón social o nombre", req: true, ph: "Ferretería El Tornillo SRL" }, { k: "cuit", t: "CUIT (opcional)", ph: "30-12345678-9" }], async (d) => {
  const r = await srv("POST", "/clientes", d);
  if (!r.ok) { toast(r.body.mensaje); return false; }
  await cargarClientes(r.body.id); toast("Cliente creado."); return true;
}));
$("nuevaCuenta").addEventListener("click", () => est.cliente && formModal(`Nueva cuenta de ${esc(est.cliente.nombre)}`, [
  { k: "nombre", t: "Cuenta", req: true, ph: "Cuenta corriente en pesos" }, { k: "banco", t: "Banco", ph: "Banco del Río" }, { k: "moneda", t: "Moneda", opciones: ["ARS", "USD"] }, { k: "cbu", t: "CBU (opcional)" },
], async (d) => {
  const r = await srv("POST", `/clientes/${est.cliente.id}/cuentas`, d);
  if (!r.ok) { toast(r.body.mensaje); return false; }
  await elegirCliente(est.cliente.id, r.body.id); toast("Cuenta creada."); return true;
}));
$("selCliente").addEventListener("change", (e) => elegirCliente(e.target.value));
$("selCuenta").addEventListener("change", (e) => elegirCuenta(e.target.value));
$("selMes").addEventListener("change", async (e) => {
  const mes = e.target.value;
  if (!/^\d{4}-\d{2}$/.test(mes) || mes === est.periodo) return;
  await guardarPeriodo(); // lo pendiente del mes que se deja
  est.periodo = mes; await abrirPeriodo();
});

// ---------------- tablero de cartera
$("verTablero").addEventListener("click", async () => {
  const r = await srv("GET", `/cartera?hasta=${est.periodo}&meses=6`);
  if (!r.ok) return toast(r.body.mensaje || "No pude abrir el tablero.");
  const { meses, clientes } = r.body;
  const mesTxt = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
  const filas = clientes.flatMap((c) => (c.cuentas.length ? c.cuentas : [null]).map((cu) => {
    if (!cu) return `<tr><td><b>${esc(c.nombre)}</b><div class="vacio">sin cuentas</div></td>${meses.map(() => "<td></td>").join("")}</tr>`;
    const celdas = meses.map((m) => {
      const p = cu.periodos[m];
      if (!p) return `<td class="cel"><button data-abrir="${c.id}|${cu.id}|${m}" class="vacio" title="Sin empezar">—</button></td>`;
      const color = p.estado === "cerrado" ? "verde" : p.semaforo || "amarillo";
      return `<td class="cel"><button data-abrir="${c.id}|${cu.id}|${m}" title="${p.diferencia ? "Diferencia " + fmtCents(p.diferencia) : ""}">${dot(color)} ${ESTADO_TXT[p.estado]}</button></td>`;
    }).join("");
    return `<tr><td><b>${esc(c.nombre)}</b><div class="muted">${esc(cu.nombre)}${cu.banco ? " · " + esc(cu.banco) : ""}</div></td>${celdas}</tr>`;
  })).join("");
  abrirModal("Tablero de cartera", `<p>Estado de cada cuenta por mes. Tocá una celda para abrirla.</p><div class="c-tablero"><table><thead><tr><th>Cliente y cuenta</th>${meses.map((m) => `<th class="cel">${mesTxt(m)}</th>`).join("")}</tr></thead><tbody>${filas || `<tr><td colspan="${meses.length + 1}" class="vacio">Todavía no hay clientes. Creá el primero con “+ Cliente”.</td></tr>`}</tbody></table></div>`, { ancho: true });
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-abrir], [data-flujo]");
  if (!b) return;
  if (b.dataset.flujo) {
    const ok = await guardarPeriodo(b.dataset.flujo);
    if (ok) toast({ preparar: "Marcado como preparado.", revisar: "Marcado como revisado.", cerrar: "Mes cerrado: queda en solo lectura.", reabrir: "Mes reabierto." }[b.dataset.flujo]);
    if (ok && b.dataset.flujo === "reabrir") run();
    return;
  }
  const [cli, cta, mes] = b.dataset.abrir.split("|");
  cerrarModal();
  await guardarPeriodo();
  est.periodo = mes; $("selMes").value = mes;
  $("selCliente").value = cli;
  await elegirCliente(cli, cta);
});

iniciarEstudio();


// =====================================================================================================
// IA para bancos nuevos: la IA propone columnas a partir de un esqueleto anónimo; la regla del saldo
// decide. Si cierra, queda guardada como plantilla del banco (la IA se usa una vez por banco).
// =====================================================================================================
const iaEstado = { disponible: false };
async function iniciarIA() {
  try { const r = await fetch("/api/ia/estado", { credentials: "same-origin" }); if (r.ok) Object.assign(iaEstado, await r.json()); } catch {}
  if (iaEstado.disponible && state.extracto) renderDocs();
}
const NOMBRE_PROVEEDOR = { anthropic: "Claude (Anthropic)", openai: "OpenAI", gemini: "Gemini (Google)", openrouter: "OpenRouter", local: "el modelo local del estudio" };

function pedirColumnasIA() {
  const x = state.extracto;
  if (!x?.pdf) return;
  const esq = esqueletoDePdf(x.pdf.pages);
  const quien = `${NOMBRE_PROVEEDOR[iaEstado.proveedor] || iaEstado.proveedor} · ${iaEstado.modelo}`;
  abrirModal("Leer las columnas con IA", `<p>Se envía a <b>${esc(quien)}</b> solo el <b>esqueleto</b> del extracto: dónde está cada celda y de qué tipo es. Los importes y las fechas van como formato (9.999,99), sin nombres, descripciones, montos ni cuentas. Esto es exactamente lo que viaja (primeras líneas de ${esq.lineas.length}):</p>
    <textarea class="c-msg" readonly>${esc(esq.lineas.slice(0, 12).join("\n"))}</textarea>
    <p class="muted" style="font-size:12.5px">La IA propone hasta tres lecturas; Fulgoria solo acepta la que hace cerrar los saldos.</p>
    <div class="modal-acciones"><button class="btn primary" id="iaEnviar">Enviar</button></div>`);
  $("iaEnviar").addEventListener("click", async () => {
    $("iaEnviar").disabled = true; $("iaEnviar").textContent = "Consultando…";
    let j;
    try {
      const r = await fetch("/api/ia/columnas", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ esqueleto: esq }) });
      j = await r.json();
      if (!r.ok) throw new Error(j.mensaje || `error ${r.status}`);
    } catch (e) { cerrarModal(); return toast("No se pudo consultar a la IA: " + e.message); }
    cerrarModal();
    const elegida = elegirPropuesta(x.pdf.pages, j.propuestas);
    if (!elegida) return toast("La IA no propuso columnas utilizables. Marcalas en el Extractor.");
    if (!elegida.verificado) return toast("La IA propuso columnas, pero con ninguna cierran los saldos: no las uso. Marcalas en el Extractor.");
    // Cierra: se aplica y se guarda como plantilla del banco (también para el estudio, si hay modo estudio).
    x.columns = elegida.columnas; x.ext = extract(x.pdf.pages, x.columns); x.plantilla = "ia";
    elegirSegmento(0);
    try {
      const pg = x.pdf.pages[0];
      const tpl = buildTemplate({ bank: x.banco || x.name.replace(/\.[^.]+$/, ""), columns: x.columns, pageSize: { w: pg.W, h: pg.H }, anchors: extractAnchors(x.pdf.pages, x.columns), contributor: "ia", createdAt: new Date().toISOString().slice(0, 10) });
      const todas = (safeJson(lsGet(LS_TPL)) || []).filter((t) => t.id !== tpl.meta.template_id);
      todas.push({ id: tpl.meta.template_id, bank: tpl.meta.bank, tpl });
      lsSet(LS_TPL, JSON.stringify(todas));
      if (est.activo && puedo("editar")) srv("PUT", "/plantillas", { tipo: "banco", nombre: tpl.meta.bank, plantilla: tpl });
    } catch (e) { console.warn("plantilla", e); }
    resetDecisiones();
    run();
    toast(`La IA leyó las columnas y los saldos cierran (propuesta ${elegida.indice + 1}). Quedó guardada la plantilla de este banco.`, 5000);
  });
}
iniciarIA();
