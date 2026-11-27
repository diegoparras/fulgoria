// Fulgoria · Conciliar — interfaz de la conciliación bancaria.
//
// Modo AUTOMÁTICO: soltás el extracto y el mayor, el sistema lee, verifica, empareja y te
// muestra solo lo que necesita tu decisión (la bandeja), con el papel de trabajo listo.
// Modo DEPORTIVO: los mismos datos + todos los mandos del motor editables en vivo + la mesa
// para emparejar a mano. Un solo motor (src/core), dos maneras de manejarlo.
//
// Todo corre en el navegador: el PDF y el mayor nunca salen de la máquina.
import { loadPdf, renderToCanvas } from "./pdf.js";
import { ocrCanvas, imageFileToCanvas } from "./ocr.js";
import { extract, balanceCheck, autoDetect, matchScore } from "./extract.js";
import {
  fromExtract, parseLedgerCsv, resolveConfig, DEFAULTS, reconcile, arrastreSiguiente, pairKey,
  papelSaldoASaldo, papelToMarkdown, papelToCsv, asientosToCsv, fmtCents, fmtISO,
} from "./core/index.js";

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
const dot = (c, lg) => `<span class="dot ${c}${lg ? " lg" : ""}"></span>`;

const LS_MANDOS = "fulgoria.conciliar.mandos";
const LS_MODO = "fulgoria.conciliar.modo";
const LS_TPL = "fulgoria.templates"; // las mismas plantillas que guarda el extractor

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
  for (const f of files) {
    const n = f.name.toLowerCase();
    try {
      if (n.endsWith(".pdf") || (f.type || "").startsWith("image/")) await cargarExtracto(f.name, f);
      else if (n.endsWith(".csv") || n.endsWith(".txt")) await cargarMayor(f.name, await f.text());
      else if (n.endsWith(".json")) await cargarArrastre(f.name, await f.text());
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
      const canvas = await imageFileToCanvas(file);
      const items = await ocrCanvas(canvas, (p) => progress(`OCR — ${Math.round(p * 100)}%`));
      pdf = { numPages: 1, scanned: true, pages: [{ index: 1, page: null, W: canvas.width, H: canvas.height, items, ocrCanvas: canvas }] };
    } else {
      pdf = await loadPdf(new Uint8Array(await file.arrayBuffer()));
      const tot = pdf.pages.reduce((a, p) => a + p.items.length, 0);
      if (pdf.pages.length && tot / pdf.pages.length < 5) { // escaneado
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
  const anio = Number((s.movements.find((m) => /\d{4}/.test(m.fecha))?.fecha.match(/\d{4}/) || [])[0]) || new Date().getFullYear();
  x.anio = anio;
  x.data = fromExtract({ ...s, columns: x.columns }, { doc: x.name, anio });
  x.error = null;
}

async function cargarMayor(name, text) {
  try {
    const led = parseLedgerCsv(text, { doc: name, anio: state.extracto?.anio });
    state.mayor = { name, led, error: null };
  } catch (e) {
    state.mayor = { name, led: null, error: e.message };
  }
  resetDecisiones();
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
  if (!listo) { state.rec = null; return; }
  const fechas = x.data.movs.map((v) => v.fecha).filter(Boolean).sort();
  const ult = fechas[fechas.length - 1] || m.led.movs.at(-1)?.fecha;
  const hasta = state.cierre || finDeMes(ult);
  const desde = (fechas[0] || ult).slice(0, 8) + "01";
  state.rec = reconcile({
    banco: x.data.movs, libros: m.led.movs, arrastre: state.arrastre,
    saldos: { bancoApertura: x.data.apertura, bancoCierre: x.data.cierre, librosApertura: m.led.apertura, librosCierre: m.led.cierre },
    periodo: { desde, hasta }, cfg: cfg(), decisiones: state.decisiones,
  });
  // Si la lectura del extracto no está verificada, nada puede quedar en verde.
  if (!x.check.globalOk) state.rec.resumen.estado = "rojo";
  renderResult();
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
      <div class="s">${x.data.movs.length} movimientos · saldo ${fmtCents(x.data.apertura)} → ${fmtCents(x.data.cierre)} · ${ok ? "lectura verificada con la regla del saldo" : `<b>la lectura no cierra</b> (diferencia ${fmtCents(Math.round(((x.check.closing ?? 0) - (x.check.computed ?? 0)) * 100))}): abrilo en el <a class="link" href="./">Extractor</a> para ajustar las columnas`}${x.plantilla ? " · plantilla reconocida" : ""}${x.pdf.scanned ? " · OCR" : ""}</div>${sel}</div></div>`;
  })() : `<div class="c-doc falta">${ICON.doc}<div><div class="k">Extracto</div><div class="s">Falta el PDF o la imagen del extracto bancario.</div></div></div>`;
  const docM = m ? (m.error
    ? `<div class="c-doc">${dot("rojo")}<div><div class="k">Mayor</div><div class="n">${esc(m.name)}</div><div class="s">${esc(m.error)}</div></div></div>`
    : (() => {
      const c = m.led.control;
      const est = c.ok === true ? "verde" : c.ok === false ? "rojo" : "amarillo";
      const txt = c.ok === true ? "saldos verificados" : c.ok === false ? `<b>el saldo no cierra</b>${c.filasConError.length ? ` en las filas ${c.filasConError.slice(0, 5).join(", ")}` : ""}` : "sin saldo para verificar";
      return `<div class="c-doc">${dot(est)}<div><div class="k">Mayor de la cuenta Banco</div><div class="n">${esc(m.name)}</div>
        <div class="s">${m.led.movs.length} registros · saldo ${fmtCents(m.led.apertura)} → ${fmtCents(m.led.cierre)} · ${txt}${m.led.avisos.length ? ` · ${m.led.avisos.length} aviso${m.led.avisos.length > 1 ? "s" : ""}` : ""}</div></div></div>`;
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
  const ev = m.evidencia?.page != null ? `<button class="lnk" data-ev="${esc(id)}">Ver en el extracto</button>` : m.evidencia?.row != null ? `<span class="muted" style="font-size:12px">${esc(m.evidencia.doc || "mayor")} · fila ${m.evidencia.row}</span>` : "";
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
    else html.push(`<label class="f">${esc(m.t)}<input type="number" min="0" step="${m.tipo === "money" ? "0.01" : "1"}" data-m="${m.k}" data-t="${m.tipo}" value="${m.tipo === "money" ? v / 100 : v}" /></label>`);
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
  lsSet(LS_MANDOS, JSON.stringify(state.mandos));
  run();
});
$("mandos").addEventListener("click", (e) => {
  if (e.target.id === "mandosReset") { state.mandos = {}; state.cierre = null; lsSet(LS_MANDOS, "{}"); run(); toast("Mandos en sus valores por defecto."); }
});

// ---------------------------------------------------------------- acciones (delegación)
document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-ev]");
  if (!b) return;
  if (b.closest("summary") && b.tagName === "BUTTON") e.preventDefault(); // un botón en el encabezado no abre/cierra la tarjeta
  const d = b.dataset;
  if (d.ev) return verEvidencia(d.ev);
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
  const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- utilidades de UI
function abrirModal(tit, html) { $("modalTit").innerHTML = tit; $("modalBody").innerHTML = html; $("modal").hidden = false; }
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
