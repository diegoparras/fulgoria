// Papel de trabajo en PDF y en Excel, a partir de papelSaldoASaldo(). Pensado para archivar el
// encargo (RT 37): quién, qué cuenta, qué período, del saldo del banco al de libros, el detalle de
// cada partida con su antigüedad y su origen, los asientos propuestos y quién preparó, revisó y
// cerró.
import { crearPdf, renglones } from "./pdf.js";
import { fmtCents } from "./money.js";
import { fmtISO } from "./dates.js";

const AZUL = "#1f4fa3", GRIS = "#5f6b7a", LINEA = "#c9d1db", FONDO = "#eef2f7", VERDE = "#1f8a5b", ROJO = "#c0392b";
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "");
const quien = (x) => (x?.u ? `${x.u}${x.en ? ` · ${fechaHora(x.en)}` : ""}` : "—");
const evid = (e) => (!e ? "" : e.page != null ? `${e.doc ? e.doc + " " : ""}p.${e.page}` : e.row != null ? `${e.doc ? e.doc + " " : ""}fila ${e.row}` : e.doc || "");

/**
 * @param {ReturnType<import("./workpaper.js").papelSaldoASaldo>} p
 * @param {{ ajustes?: Array, cliente?: string, cuenta?: string, banco?: string, estado?: string,
 *           preparo?: {u,en}, reviso?: {u,en}, cerro?: {u,en}, generado?: string }} extra
 * @returns {Uint8Array}
 */
export function papelToPdf(p, extra = {}) {
  const m = { ...p.meta, ...extra };
  const doc = crearPdf({ titulo: `Conciliación bancaria ${m.cliente || ""} ${m.periodoHasta || ""}`.trim() });
  const X0 = 40, X1 = doc.W - 40, ABAJO = doc.H - 50;
  let y = 0;
  const pagina = () => { doc.nuevaPagina(); y = 48; };
  const lugar = (alto) => { if (y + alto > ABAJO) { pagina(); encabezadoCorto(); } };
  const encabezadoCorto = () => {
    doc.texto(X0, y, `Conciliación bancaria · ${[m.cliente, m.cuenta].filter(Boolean).join(" · ")} · al ${fmtISO(m.periodoHasta)}`, { size: 8, color: GRIS });
    doc.linea(X0, y + 5, X1, y + 5, { color: LINEA }); y += 20;
  };

  // --- Encabezado
  pagina();
  doc.texto(X0, y, "Conciliación bancaria", { size: 18, bold: true, color: AZUL });
  const ok = p.diferenciaNoExplicadaCents === 0;
  doc.texto(X1, y, ok ? "CONCILIADA" : "CON DIFERENCIA", { size: 10, bold: true, color: ok ? VERDE : ROJO, alinear: "der" });
  y += 20;
  const datos = [["Cliente", m.cliente], ["Cuenta", m.cuenta], ["Banco", m.banco], ["Período", `${m.periodoDesde ? fmtISO(m.periodoDesde) + " al " : "al "}${fmtISO(m.periodoHasta)}`], ["Estado", m.estado]].filter(([, v]) => v);
  for (const [k, v] of datos) { doc.texto(X0, y, k, { size: 9, color: GRIS }); doc.texto(X0 + 60, y, String(v), { size: 9.5 }); y += 13; }
  y += 6;

  // --- Del saldo del banco al saldo de libros
  doc.rect(X0, y - 11, X1 - X0, 17, { relleno: FONDO });
  doc.texto(X0 + 6, y, "Del saldo del banco al saldo de libros", { size: 10, bold: true }); y += 18;
  const fila = (k, v, { bold = false, colorV } = {}) => {
    const ls = renglones(k, 380, 9.5, bold);
    lugar(ls.length * 12 + 4);
    ls.forEach((l, i) => doc.texto(X0 + 6, y + i * 12, l, { size: 9.5, bold }));
    doc.texto(X1 - 6, y, fmtCents(v), { size: 9.5, bold, alinear: "der", color: colorV });
    y += ls.length * 12; doc.linea(X0, y - 8, X1, y - 8, { color: LINEA, grosor: 0.3 }); y += 4;
  };
  fila(`Saldo según extracto bancario al ${fmtISO(m.periodoHasta)}`, p.saldoBancoCents, { bold: true });
  for (const s of p.secciones) fila(s.titulo, s.subtotalCents);
  fila("Saldo según libros (calculado)", p.saldoLibrosCalculadoCents, { bold: true });
  fila("Saldo según mayor", p.saldoLibrosMayorCents);
  fila("Diferencia no explicada", p.diferenciaNoExplicadaCents, { bold: true, colorV: ok ? VERDE : ROJO });
  y += 8;

  // --- Detalle de cada sección
  const C = { fecha: X0, desc: X0 + 52, imp: X0 + 330, dias: X0 + 360, nota: X0 + 368 };
  for (const s of p.secciones) {
    lugar(48);
    y += 6;
    doc.texto(X0, y, s.titulo, { size: 10, bold: true, color: AZUL }); y += 14;
    doc.texto(C.fecha, y, "Fecha", { size: 7.5, color: GRIS }); doc.texto(C.desc, y, "Descripción · origen", { size: 7.5, color: GRIS });
    doc.texto(C.imp, y, "Importe", { size: 7.5, color: GRIS, alinear: "der" }); doc.texto(C.dias + 0, y, "Días", { size: 7.5, color: GRIS, alinear: "der" });
    doc.texto(C.nota + 8, y, "Nota", { size: 7.5, color: GRIS }); y += 4;
    doc.linea(X0, y, X1, y, { color: LINEA }); y += 10;
    for (const i of s.items) {
      const desc = renglones(`${i.descripcion}${i.referencia ? ` · ${i.referencia}` : ""}${i.arrastre ? " (mes anterior)" : ""}`, C.imp - C.desc - 62, 8.5);
      const org = evid(i.evidencia);
      const nota = renglones(i.motivo || "", X1 - C.nota - 8, 7.5);
      const alto = Math.max(desc.length + (org ? 1 : 0), nota.length) * 10.5 + 4;
      lugar(alto);
      doc.texto(C.fecha, y, fmtISO(i.fecha), { size: 8.5 });
      desc.forEach((l, k) => doc.texto(C.desc, y + k * 10.5, l, { size: 8.5 }));
      if (org) doc.texto(C.desc, y + desc.length * 10.5, org, { size: 7, color: GRIS });
      doc.texto(C.imp, y, fmtCents(i.cents), { size: 8.5, alinear: "der" });
      if (i.antiguedadDias != null) doc.texto(C.dias, y, String(i.antiguedadDias), { size: 8.5, alinear: "der", color: GRIS });
      nota.forEach((l, k) => doc.texto(C.nota + 8, y + k * 10.5, l, { size: 7.5, color: GRIS }));
      y += alto; doc.linea(X0, y - 9, X1, y - 9, { color: LINEA, grosor: 0.2 });
    }
    lugar(16);
    doc.texto(C.desc, y, "Subtotal", { size: 8.5, bold: true }); doc.texto(C.imp, y, fmtCents(s.subtotalCents), { size: 8.5, bold: true, alinear: "der" });
    y += 16;
  }

  // --- Asientos propuestos
  const ajustes = m.ajustes || [];
  if (ajustes.length) {
    lugar(48); y += 6;
    doc.texto(X0, y, "Asientos de ajuste propuestos", { size: 10, bold: true, color: AZUL });
    doc.texto(X1 - 90, y, "Debe", { size: 7.5, color: GRIS, alinear: "der" }); doc.texto(X1, y, "Haber", { size: 7.5, color: GRIS, alinear: "der" }); y += 14;
    for (const a of ajustes) {
      const conc = renglones(`${a.id} · ${fmtISO(a.fecha)} · ${a.concepto}`, X1 - X0, 8.5, true);
      lugar(conc.length * 11 + a.lineas.length * 11 + 8);
      conc.forEach((l, k) => doc.texto(X0, y + k * 11, l, { size: 8.5, bold: true })); y += conc.length * 11;
      for (const l of a.lineas) {
        doc.texto(X0 + (l.haber ? 30 : 10), y, `${l.haber ? "a " : ""}${l.cuenta}`, { size: 8.5 });
        if (l.debe) doc.texto(X1 - 90, y, fmtCents(l.debe), { size: 8.5, alinear: "der" });
        if (l.haber) doc.texto(X1, y, fmtCents(l.haber), { size: 8.5, alinear: "der" });
        y += 11;
      }
      y += 6;
    }
  }

  // --- Resumen y firmas
  const r = p.resumen || {};
  lugar(90); y += 8;
  doc.linea(X0, y, X1, y, { color: LINEA }); y += 14;
  doc.texto(X0, y, `Movimientos del banco: ${r.movimientosBanco ?? "—"} · conciliados solos: ${r.emparejadosVerde ?? "—"} · a confirmar: ${r.emparejadosAmarillo ?? 0} · pendientes: ${r.pendientes ?? "—"}`, { size: 8.5, color: GRIS }); y += 24;
  const firmas = [["Preparó", m.preparo], ["Revisó", m.reviso], ["Cerró", m.cerro]];
  const ancho = (X1 - X0) / 3;
  firmas.forEach(([k, v], i) => {
    const x = X0 + i * ancho;
    doc.linea(x, y + 18, x + ancho - 20, y + 18, { color: "#666666" });
    doc.texto(x, y + 30, k, { size: 8, color: GRIS });
    doc.texto(x, y + 41, quien(v), { size: 8.5 });
  });

  const generado = m.generado || new Date().toISOString();
  doc.enCadaPagina((n, total) => {
    doc.linea(X0, doc.H - 32, X1, doc.H - 32, { color: LINEA, grosor: 0.3 });
    doc.texto(X0, doc.H - 20, `Generado con Fulgoria el ${fechaHora(generado)}`, { size: 7.5, color: GRIS });
    doc.texto(X1, doc.H - 20, `Página ${n} de ${total}`, { size: 7.5, color: GRIS, alinear: "der" });
  });
  return doc.generar();
}

/**
 * El mismo papel en hojas de Excel (para escribirXlsx): "Conciliación" y "Asientos".
 * Fechas reales y números (no texto), para seguir trabajando.
 */
export function papelToHojas(p, extra = {}) {
  const m = { ...p.meta, ...extra };
  const B = (texto) => ({ texto, negrita: true });
  const pesos = (c) => (c == null ? null : Math.round(c) / 100);
  const f = [];
  f.push([B("Conciliación bancaria")]);
  for (const [k, v] of [["Cliente", m.cliente], ["Cuenta", m.cuenta], ["Banco", m.banco], ["Período", `${m.periodoDesde ? fmtISO(m.periodoDesde) + " al " : "al "}${fmtISO(m.periodoHasta)}`], ["Estado", m.estado]]) if (v) f.push([k, String(v)]);
  f.push([]);
  f.push([B("Del saldo del banco al saldo de libros"), null, null, B("Importe")]);
  f.push([`Saldo según extracto bancario al ${fmtISO(m.periodoHasta)}`, null, null, pesos(p.saldoBancoCents)]);
  for (const s of p.secciones) f.push([s.titulo, null, null, pesos(s.subtotalCents)]);
  f.push([B("Saldo según libros (calculado)"), null, null, pesos(p.saldoLibrosCalculadoCents)]);
  f.push(["Saldo según mayor", null, null, pesos(p.saldoLibrosMayorCents)]);
  f.push([B("Diferencia no explicada"), null, null, pesos(p.diferenciaNoExplicadaCents)]);
  for (const s of p.secciones) {
    f.push([]);
    f.push([B(s.titulo)]);
    f.push([B("Fecha"), B("Descripción"), B("Referencia"), B("Importe"), B("Días"), B("Origen"), B("Nota")]);
    for (const i of s.items) f.push([{ fecha: i.fecha }, i.descripcion + (i.arrastre ? " (mes anterior)" : ""), i.referencia || null, pesos(i.cents), i.antiguedadDias ?? null, evid(i.evidencia) || null, i.motivo || null]);
    f.push([null, B("Subtotal"), null, pesos(s.subtotalCents)]);
  }
  f.push([]);
  for (const [k, v] of [["Preparó", m.preparo], ["Revisó", m.reviso], ["Cerró", m.cerro]]) f.push([k, quien(v)]);
  const asientos = [[B("Asiento"), B("Fecha"), B("Cuenta"), B("Debe"), B("Haber"), B("Concepto")]];
  for (const a of m.ajustes || []) for (const l of a.lineas) asientos.push([a.id, { fecha: a.fecha }, l.cuenta, l.debe ? pesos(l.debe) : null, l.haber ? pesos(l.haber) : null, a.concepto]);
  return [
    { nombre: "Conciliación", filas: f, anchos: [44, 46, 18, 16, 8, 24, 60] },
    { nombre: "Asientos", filas: asientos, anchos: [10, 12, 40, 16, 16, 60] },
  ];
}
