// Papeles de trabajo: VISTAS sobre el resultado de reconcile(). La conciliación es un dato;
// el papel es una forma de mostrarlo. Hoy: "saldo a saldo" (del extracto al mayor) en
// Markdown y CSV, y los asientos propuestos en CSV. Mañana: 4 columnas, XLSX, PDF.
//
// RT 37 (mod. RT 53): la documentación del encargo tiene que permitir que OTRO contador
// entienda qué se hizo. Por eso cada partida lleva fecha, importe, antigüedad y dónde está en
// el documento de origen, y el papel cierra con "diferencia no explicada".
import { fmtCents } from "./money.js";
import { fmtISO } from "./dates.js";
import { TIPOS_PENDIENTE } from "./reconcile.js";

/**
 * @param {ReturnType<import("./reconcile.js").reconcile>} rec
 * @param {{ cliente?: string, cuenta?: string, banco?: string, preparo?: string, reviso?: string }} [meta]
 */
export function papelSaldoASaldo(rec, meta = {}) {
  const mov = (id) => rec.movimientos[id];
  const item = (p) => {
    const m = mov(p.id);
    return { id: m.id, fecha: m.fecha, descripcion: m.descripcion, referencia: m.referencia || "", cents: m.cents, antiguedadDias: p.antiguedadDias, evidencia: m.evidencia, motivo: p.motivo, arrastre: !!m.arrastre };
  };
  const pend = (lado, f) => rec.pendientes.filter((p) => p.lado === lado && f(p)).map(item);

  // Del saldo del banco al saldo de libros:
  //   + ingresos del libro que el banco aún no acreditó (depósitos en tránsito…)
  //   − egresos del libro que el banco aún no debitó (cheques pendientes…)  [ya vienen negativos]
  //   + débitos del banco no registrados en libros   (el banco ya los restó; el libro no)
  //   − créditos del banco no registrados en libros
  const secciones = [
    { clave: "ingresos_libros", titulo: "Más: ingresos registrados en libros no acreditados por el banco", efecto: +1, items: pend("libros", (p) => mov(p.id).cents > 0) },
    { clave: "egresos_libros", titulo: "Menos: egresos registrados en libros no debitados por el banco", efecto: +1, items: pend("libros", (p) => mov(p.id).cents < 0) },
    { clave: "debitos_banco", titulo: "Más: débitos del banco no registrados en libros", efecto: -1, items: pend("banco", (p) => mov(p.id).cents < 0) },
    { clave: "creditos_banco", titulo: "Menos: créditos del banco no registrados en libros", efecto: -1, items: pend("banco", (p) => mov(p.id).cents > 0) },
  ];
  const dif = rec.matches.filter((m) => m.diferenciaCents !== 0);
  if (dif.length) secciones.push({
    clave: "diferencias", titulo: "Más/menos: diferencias de importe en partidas emparejadas", efecto: +1,
    items: dif.map((m) => ({ id: m.id, fecha: mov(m.libros[0]).fecha, descripcion: mov(m.libros[0]).descripcion, referencia: "", cents: m.diferenciaCents, antiguedadDias: null, evidencia: mov(m.libros[0]).evidencia, motivo: m.motivos.join("; ") })),
  });
  for (const s of secciones) s.subtotalCents = s.efecto * s.items.reduce((a, i) => a + i.cents, 0);

  return {
    titulo: "Conciliación bancaria",
    meta: { ...meta, periodoDesde: rec.periodo.desde, periodoHasta: rec.periodo.hasta },
    saldoBancoCents: rec.saldos.bancoCierre,
    secciones: secciones.filter((s) => s.items.length),
    saldoLibrosCalculadoCents: rec.saldos.librosCalculado,
    saldoLibrosMayorCents: rec.saldos.librosCierre,
    diferenciaNoExplicadaCents: rec.diferenciaNoExplicada,
    // Vista "saldo conciliado": los dos saldos ajustados deben dar lo mismo.
    saldoConciliado: {
      bancoAjustadoCents: rec.saldos.bancoCierre + secciones.filter((s) => s.clave.endsWith("_libros") || s.clave === "diferencias").reduce((a, s) => a + s.subtotalCents, 0),
      librosAjustadoCents: rec.saldos.librosCierre - secciones.filter((s) => s.clave.endsWith("_banco")).reduce((a, s) => a + s.subtotalCents, 0),
    },
    resumen: rec.resumen,
    apertura: rec.apertura,
  };
}

/** Papel → Markdown (legible, imprimible, versionable). */
export function papelToMarkdown(p) {
  const L = [];
  const m = p.meta;
  L.push(`# ${p.titulo}`);
  const enc = [m.cliente && `**Cliente:** ${m.cliente}`, m.banco && `**Banco:** ${m.banco}`, m.cuenta && `**Cuenta:** ${m.cuenta}`,
    `**Período:** ${m.periodoDesde ? fmtISO(m.periodoDesde) + " al " : "al "}${fmtISO(m.periodoHasta)}`].filter(Boolean);
  L.push(enc.join(" · "), "");
  L.push(`| Concepto | Importe |`, `|---|---:|`);
  L.push(`| **Saldo según extracto bancario al ${fmtISO(m.periodoHasta)}** | **${fmtCents(p.saldoBancoCents)}** |`);
  for (const s of p.secciones) L.push(`| ${s.titulo} | ${fmtCents(s.subtotalCents)} |`);
  L.push(`| **Saldo según libros (calculado)** | **${fmtCents(p.saldoLibrosCalculadoCents)}** |`);
  L.push(`| Saldo según mayor | ${fmtCents(p.saldoLibrosMayorCents)} |`);
  L.push(`| **Diferencia no explicada** | **${fmtCents(p.diferenciaNoExplicadaCents)}** ${p.diferenciaNoExplicadaCents === 0 ? "✅" : "❌"} |`, "");
  L.push(`Saldo conciliado: banco ajustado ${fmtCents(p.saldoConciliado.bancoAjustadoCents)} · libros ajustado ${fmtCents(p.saldoConciliado.librosAjustadoCents)}`, "");
  for (const s of p.secciones) {
    L.push(`## ${s.titulo}`, "", `| Fecha | Descripción | Ref. | Importe | Antig. | Evidencia | Nota |`, `|---|---|---|---:|---:|---|---|`);
    for (const i of s.items) {
      L.push(`| ${fmtISO(i.fecha)} | ${esc(i.descripcion)}${i.arrastre ? " *(arrastrado)*" : ""} | ${esc(i.referencia)} | ${fmtCents(i.cents)} | ${i.antiguedadDias ?? ""} | ${evid(i.evidencia)} | ${esc(i.motivo)} |`);
    }
    L.push(`| | **Subtotal** | | **${fmtCents(s.subtotalCents)}** | | | |`, "");
  }
  const r = p.resumen;
  L.push(`---`, `Movimientos del banco: ${r.movimientosBanco} · conciliados solos: ${r.emparejadosVerde} · a confirmar: ${r.emparejadosAmarillo} · pendientes: ${r.pendientes} · estado: **${r.estado.toUpperCase()}**`);
  if (m.preparo || m.reviso) L.push("", `Preparó: ${m.preparo || "—"} · Revisó: ${m.reviso || "—"}`);
  return L.join("\n") + "\n";
}

/** Papel → CSV es-AR (separador ";", coma decimal, BOM para Excel). */
export function papelToCsv(p) {
  const rows = [["Sección", "Fecha", "Descripción", "Referencia", "Importe", "Antigüedad (días)", "Evidencia", "Nota"]];
  rows.push(["Saldo según extracto bancario", p.meta.periodoHasta, "", "", fmtCents(p.saldoBancoCents), "", "", ""]);
  for (const s of p.secciones) {
    for (const i of s.items) rows.push([s.titulo, i.fecha, i.descripcion, i.referencia, fmtCents(i.cents), i.antiguedadDias ?? "", evid(i.evidencia), i.motivo]);
    rows.push([s.titulo + " — subtotal", "", "", "", fmtCents(s.subtotalCents), "", "", ""]);
  }
  rows.push(["Saldo según libros (calculado)", "", "", "", fmtCents(p.saldoLibrosCalculadoCents), "", "", ""]);
  rows.push(["Saldo según mayor", "", "", "", fmtCents(p.saldoLibrosMayorCents), "", "", ""]);
  rows.push(["Diferencia no explicada", "", "", "", fmtCents(p.diferenciaNoExplicadaCents), "", "", ""]);
  return toCsv(rows);
}

/** Asientos propuestos → CSV genérico (una línea por renglón del asiento). */
export function asientosToCsv(ajustes) {
  const rows = [["Asiento", "Fecha", "Cuenta", "Debe", "Haber", "Concepto", "Origen"]];
  for (const a of ajustes) for (const l of a.lineas) rows.push([a.id, fmtISO(a.fecha), l.cuenta, l.debe ? fmtCents(l.debe) : "", l.haber ? fmtCents(l.haber) : "", a.concepto, a.origen.join(" ")]);
  return toCsv(rows);
}

// ---------------------------------------------------------------- asientos para cada sistema contable
// Formatos tomados de la documentación oficial de cada sistema (ver docs/CONCILIACION.md). En el
// plan de cuentas se puede escribir "código nombre" ("1.1.2.01 Banco Río"): Holistor usa el código
// y Xubio el nombre.
const CODIGO_RE = /^(\d[\d.\-]*\d|\d)(?:\s+[-–]?\s*(.*))?$/;
/** "1.1.2.01 Banco Río" → { codigo: "1.1.2.01", nombre: "Banco Río" }; "Banco Río" → { codigo: null, nombre }. */
export function partirCuenta(cuenta) {
  const s = String(cuenta || "").trim(), m = s.match(CODIGO_RE);
  return m ? { codigo: m[1], nombre: (m[2] || "").trim() || m[1] } : { codigo: null, nombre: s };
}
const pesos = (c) => Math.round(c) / 100;

/**
 * Xubio (Contabilidad > Asientos Manuales > Acciones > Importar): planilla con FECHA, CONCEPTO,
 * CIRCUITOCONTABLE, CUENTA, DEBE, HABER, ORGANIZACION, CENTRODECOSTO, DESCRIPCION. La primera fila
 * de cada asiento lleva fecha, concepto y circuito; las siguientes, las cuentas (por NOMBRE).
 * @returns {Array<Array<string|number|{fecha:string}|null>>} filas para escribirXlsx
 */
export function asientosXubio(ajustes, { circuito = "default" } = {}) {
  const filas = [["FECHA", "CONCEPTO", "CIRCUITOCONTABLE", "CUENTA", "DEBE", "HABER", "ORGANIZACION", "CENTRODECOSTO", "DESCRIPCION"]];
  for (const a of ajustes) {
    filas.push([{ fecha: a.fecha }, String(a.concepto || "").slice(0, 250), circuito, null, null, null, null, null, null]);
    for (const l of a.lineas) filas.push([null, null, null, partirCuenta(l.cuenta).nombre, l.debe ? pesos(l.debe) : null, l.haber ? pesos(l.haber) : null, null, null, String(a.concepto || "").slice(0, 250)]);
  }
  return filas;
}

/**
 * Holistor Contabilidad (Útiles > Exportar/Importar > Importar, "archivo único de movimientos" con
 * Debe y Haber en columnas separadas): una línea por movimiento, campos separados por TAB en este
 * orden: Fecha (DD/MM/AAAA) · Número de asiento (orden dentro de la fecha, 0001…) · Número de
 * cuenta (código) · Debe · Haber (coma decimal) · Concepto · Leyenda. Texto en Windows-1252/Latin-1.
 * @returns {{ texto: string, sinCodigo: string[] }} sinCodigo: cuentas del plan que no tienen código
 */
export function asientosHolistor(ajustes) {
  const porFecha = new Map(), lineas = [], sinCodigo = new Set();
  const limpio = (s, n) => String(s || "").replace(/[\t\r\n]+/g, " ").trim().slice(0, n);
  const importe = (c) => (c ? (Math.abs(c) / 100).toFixed(2).replace(".", ",") : "0,00");
  for (const a of ajustes) {
    const nro = (porFecha.get(a.fecha) || 0) + 1;
    porFecha.set(a.fecha, nro);
    for (const l of a.lineas) {
      const { codigo } = partirCuenta(l.cuenta);
      if (!codigo) sinCodigo.add(String(l.cuenta));
      lineas.push([fmtISO(a.fecha), String(nro).padStart(4, "0"), codigo || limpio(l.cuenta, 40), importe(l.debe), importe(l.haber), limpio(a.concepto, 60), limpio((a.origen || []).join(" "), 60)].join("\t"));
    }
  }
  return { texto: lineas.join("\r\n") + "\r\n", sinCodigo: [...sinCodigo] };
}

/** Texto → bytes Latin-1 (los TXT de importación de los sistemas de escritorio no esperan UTF-8). */
export function aLatin1(texto) {
  const out = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) { const c = texto.charCodeAt(i); out[i] = c < 256 ? c : 63; }
  return out;
}

/** Texto corto de la bandeja (para consola / notificaciones). */
export function bandejaToText(bandeja) {
  const icon = { rojo: "🔴", amarillo: "🟡", verde: "🟢" };
  return bandeja.map((t) => `${icon[t.certeza]} ${t.titulo}${t.totalCents ? ` (${fmtCents(t.totalCents)})` : ""}${t.accion !== "ninguna" ? `  → ${t.accion.replace(/_/g, " ")}` : ""}`).join("\n");
}

export { TIPOS_PENDIENTE };

function evid(e) {
  if (!e) return "";
  if (e.page != null) return `${e.doc ? e.doc + " " : ""}p.${e.page}${e.y != null ? ` y=${e.y}` : ""}`;
  if (e.row != null) return `${e.doc ? e.doc + " " : ""}fila ${e.row}`;
  return e.doc || "";
}
function esc(s) { return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "); }
function toCsv(rows) {
  const cell = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n") + "\n";
}
