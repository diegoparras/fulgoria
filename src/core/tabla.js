// Planillas (CSV o Excel): ¿es el MAYOR, un EXTRACTO bancario exportado a planilla o el reporte
// de MERCADO PAGO? Y la lectura de los dos últimos como lado banco.
//
// Ojo con "Débito / Crédito": en un mayor contable son Debe / Haber; en un extracto bancario son
// lo contrario (un crédito del banco es plata que ENTRA). Por eso primero se decide qué es la
// planilla (por sus encabezados y su título) y recién después se leen los importes.
import { parseLedgerRows, detectLedgerColumns } from "./ledger.js";
import { parseMoneyCents, fmtCents } from "./money.js";
import { toISO } from "./dates.js";
import { normText } from "./text.js";
import { makeMov } from "./model.js";

const normH = (s) => normText(String(s ?? "")).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- extracto bancario en planilla
const BANCO = {
  fecha: ["FECHA", "FECHA OPERACION", "FECHA DE OPERACION", "FECHA MOVIMIENTO", "FECHA MOV", "FEC", "F OPERACION", "FECHA ORIGEN"],
  descripcion: ["CONCEPTO", "DESCRIPCION", "DETALLE", "MOVIMIENTO", "LEYENDA", "DESCRIPCION MOVIMIENTO", "CONCEPTO OPERACION", "OPERACION", "DESCRIPCION OPERACION"],
  debito: ["DEBITO", "DEBITOS", "EGRESO", "EGRESOS", "RETIROS", "EXTRACCIONES", "CARGOS", "IMPORTE DEBITO", "DEB", "DEBITOS EN PESOS"],
  credito: ["CREDITO", "CREDITOS", "INGRESO", "INGRESOS", "DEPOSITOS", "ABONOS", "IMPORTE CREDITO", "CRED", "CREDITOS EN PESOS"],
  importe: ["IMPORTE", "MONTO", "IMPORTE EN PESOS", "VALOR"],
  saldo: ["SALDO", "SALDO EN PESOS", "SALDO CONTABLE", "SALDO PARCIAL"],
  referencia: ["COMPROBANTE", "NRO COMPROBANTE", "REFERENCIA", "NRO OPERACION", "NUMERO DE OPERACION", "NUMERO", "NRO", "CODIGO", "CHEQUE", "NRO CHEQUE", "NRO DE REFERENCIA"],
};
/** Columnas de un extracto en planilla (perspectiva del banco). */
export function detectarColumnasExtracto(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map = {};
    rows[r].forEach((cell, i) => {
      const h = normH(cell);
      for (const [rol, syns] of Object.entries(BANCO)) if (map[rol] == null && syns.includes(h)) { map[rol] = i; break; }
    });
    if (map.fecha != null && (map.importe != null || map.debito != null || map.credito != null)) return { headerRow: r, map };
  }
  return null;
}

// ---------------------------------------------------------------- Mercado Pago
// Reportes "Liberaciones" y "Dinero en cuenta": columnas con identificadores en inglés
// (DATE, SOURCE_ID, RECORD_TYPE, DESCRIPTION, NET_CREDIT_AMOUNT, NET_DEBIT_AMOUNT…). Se aceptan
// también rótulos en castellano por si el archivo viene traducido.
const MP = {
  fecha: ["DATE", "RELEASE DATE", "FECHA", "FECHA DE LIBERACION", "FECHA DE LIQUIDACION", "DATE SHORT"],
  id: ["SOURCE ID", "ID DE OPERACION", "ID DE LA OPERACION", "ID DE OPERACION EN MERCADO PAGO", "NUMERO DE OPERACION"],
  ref: ["EXTERNAL REFERENCE", "CODIGO DE REFERENCIA", "REFERENCIA EXTERNA"],
  tipo: ["RECORD TYPE", "TIPO DE REGISTRO"],
  desc: ["DESCRIPTION", "DESCRIPCION"],
  credito: ["NET CREDIT AMOUNT", "MONTO NETO ACREDITADO", "NETO ACREDITADO"],
  debito: ["NET DEBIT AMOUNT", "MONTO NETO DEBITADO", "NETO DEBITADO"],
  bruto: ["GROSS AMOUNT", "MONTO BRUTO", "MONTO BRUTO DE LA OPERACION"],
  comision: ["MP FEE AMOUNT", "COMISION DE MERCADO PAGO", "COMISION"],
  financiacion: ["FINANCING FEE AMOUNT", "COSTO DE OFRECER CUOTAS SIN INTERES"],
  envio: ["SHIPPING FEE AMOUNT", "COSTO DE ENVIO"],
  impuestos: ["TAXES AMOUNT", "IMPUESTOS", "IMPUESTOS COBRADOS POR RETENCIONES IIBB"],
  saldo: ["BALANCE AMOUNT", "SALDO"],
  medio: ["PAYMENT METHOD", "MEDIO DE PAGO"],
};
function columnasMP(rows) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const map = {};
    rows[r].forEach((cell, i) => {
      const h = normH(cell);
      for (const [rol, syns] of Object.entries(MP)) if (map[rol] == null && syns.includes(h)) { map[rol] = i; break; }
    });
    if (map.tipo != null && (map.credito != null || map.debito != null) && map.fecha != null) return { headerRow: r, map };
  }
  return null;
}

// Códigos de DESCRIPTION → texto que entiende un contador (y el clasificador de ruido fiscal).
const DESC_MP = [
  [/^payment$/, "Cobro"],
  [/^refund$/, "Devolución de un cobro"],
  [/^chargeback$/, "Contracargo"],
  [/^dispute$/, "Reclamo o mediación"],
  [/^shipping$/, "Costo de envío"],
  [/^shipping_(cancel|refund|return)$/, "Devolución de costo de envío"],
  [/^payout$/, "Retiro de dinero a cuenta bancaria"],
  [/^credit_payment$/, "Cuota de préstamo Mercado Pago"],
  [/^fee_release_in_advance$/, "Comisión por adelanto de dinero"],
  [/^asset_management_gain$/, "Intereses ganados (rendimientos)"],
  [/^asset_management_loss$/, "Rendimientos negativos (intereses)"],
  [/^tax_payment_ibcf_cancel$/, "Anulación percepción IIBB CABA"],
  [/^tax_payment_ibcf$/, "Percepción IIBB CABA"],
  [/^tax_payment_iibb_cancel$/, "Anulación percepción IIBB Buenos Aires"],
  [/^tax_payment_iibb_cre_(.+)$/, "Percepción IIBB $1"],
  [/^tax_payment_iibb$/, "Percepción IIBB Buenos Aires"],
  [/^tax_payment_ibex$/, "Percepción sujeto excedido Régimen Simplificado 2%"],
  [/^tax_iibb_(.+)$/, "Retención IIBB $1"],
  [/^tax_iva_cre$/, "IVA (crédito)"],
  [/^tax_iva$/, "IVA"],
  [/^tax_credit_debit$/, "Impuesto ley 25.413 débitos y créditos"],
  [/^tax_withholding_cancel$/, "Retención de impuesto cancelada"],
  [/^tax_with(d)?holding/, "Retención de impuesto"],
  [/^(restriction|fraud|judgment_bacen|trava_de_recibibles)$/, "Dinero retenido"],
  [/^reserve_for_/, "Reserva de dinero"],
  [/^tip$/, "Propina"],
  [/^digitalchange_transaction$/, "Vuelto digital"],
];
const textoMP = (codigo) => {
  const c = String(codigo || "").trim();
  for (const [re, t] of DESC_MP) if (re.test(c.toLowerCase())) return c.toLowerCase().replace(re, t).replace(/_/g, " ");
  return c; // ya viene en castellano ("Pago", "Retención de impuesto"…) o es un código nuevo
};
const fechaMP = (s) => { const t = String(s || "").trim(); const iso = t.match(/^(\d{4}-\d{2}-\d{2})/); return iso ? iso[1] : toISO(t); };

/**
 * Reporte de Mercado Pago → lado banco (la cuenta de Mercado Pago funciona como un banco).
 * Saldo inicial: fila initial_available_balance. Control: la fila total y/o BALANCE_AMOUNT.
 */
export function leerMercadoPago(rows, { doc } = {}) {
  const c = columnasMP(rows);
  if (!c) throw new Error("No reconocí las columnas del reporte de Mercado Pago (RECORD_TYPE, NET_CREDIT_AMOUNT…).");
  const { headerRow, map } = c;
  const val = (row, k) => (map[k] != null ? String(row[map[k]] ?? "").trim() : "");
  const plata = (row, k) => parseMoneyCents(val(row, k));
  const neto = (row) => Math.abs(plata(row, "credito") || 0) - Math.abs(plata(row, "debito") || 0);
  const movs = [], avisos = [];
  let apertura = null, total = null, saldoFinal = null, prev = null, cadenaOk = true, conSaldo = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((x) => String(x || "").trim())) continue;
    const tipo = val(row, "tipo").toLowerCase();
    if (tipo === "initial_available_balance") { apertura = neto(row); prev = apertura; continue; }
    if (tipo === "total") { total = neto(row); continue; }
    if (tipo === "available_balance") continue; // marcas de saldo antes/después de un retiro
    const cents = neto(row);
    const fecha = fechaMP(val(row, "fecha"));
    if (!fecha || !cents) { if (cents) avisos.push(`Fila ${r + 1} sin fecha: ignorada.`); continue; }
    const id = val(row, "id"), ref = val(row, "ref"), medio = val(row, "medio");
    const partes = [];
    const bruto = plata(row, "bruto"), com = plata(row, "comision"), fin = plata(row, "financiacion"), env = plata(row, "envio"), imp = plata(row, "impuestos");
    if (bruto && bruto !== Math.abs(cents)) {
      partes.push(`bruto ${fmtCents(Math.abs(bruto))}`);
      if (com) partes.push(`comisión ${fmtCents(Math.abs(com))}`);
      if (fin) partes.push(`cuotas sin interés ${fmtCents(Math.abs(fin))}`);
      if (env) partes.push(`envío ${fmtCents(Math.abs(env))}`);
      if (imp) partes.push(`retenciones ${fmtCents(Math.abs(imp))}`);
    }
    const descripcion = [textoMP(val(row, "desc")) || "Movimiento", medio && medio !== "account_money" ? `(${medio})` : "", ref ? `ref ${ref}` : "", partes.length ? `· ${partes.join(", ")}` : ""].filter(Boolean).join(" ");
    const saldo = plata(row, "saldo");
    if (saldo != null) {
      conSaldo++;
      if (prev != null && prev + cents !== saldo) cadenaOk = false;
      prev = saldo; saldoFinal = saldo;
    } else if (prev != null) prev += cents;
    movs.push(makeMov({ id: "B" + (movs.length + 1), lado: "banco", fecha, cents, descripcion, referencia: id ? `Op. ${id}` : "", saldo, evidencia: { doc, row: r + 1 } }));
  }
  const suma = movs.reduce((s, m) => s + m.cents, 0);
  if (apertura == null) {
    if (movs[0]?.saldo != null) apertura = movs[0].saldo - movs[0].cents;
    else { apertura = 0; avisos.push("El reporte no trae el saldo inicial (initial_available_balance): se asume 0."); }
  }
  const cierre = saldoFinal ?? apertura + suma;
  // Control: el total del reporte coincide con los movimientos (neto del período o saldo final), y
  // si hay saldo fila a fila, la cadena cierra.
  const totalOk = total == null ? null : total === suma || total === apertura + suma;
  const ok = conSaldo ? cadenaOk && totalOk !== false && cierre === apertura + suma : totalOk;
  return { movs, apertura, cierre, control: { ok: ok ?? null, calculado: apertura + suma, total }, avisos, banco: "Mercado Pago" };
}

// ---------------------------------------------------------------- ¿qué es esta planilla?
const TITULO_BANCO = /\b(BANCO|EXTRACTO|RESUMEN DE CUENTA|MOVIMIENTOS DE (LA )?CUENTA|CBU|CAJA DE AHORRO|HOME ?BANKING|ULTIMOS MOVIMIENTOS)\b/;
const TITULO_MAYOR = /\b(MAYOR|LIBRO|CUENTA CONTABLE|PLAN DE CUENTAS|ASIENTOS?)\b/;
const H_MAYOR = new Set(["DEBE", "HABER", "ASIENTO", "NRO ASIENTO", "N ASIENTO", "NUM ASIENTO", "FECHA ASIENTO", "FECHA CONTABLE", "GLOSA"]);
const H_BANCO = new Set(["CAUSAL", "SUCURSAL", "SUC", "FECHA VALOR", "NRO OPERACION", "COD OPERACION", "CODIGO OPERACION", "SALDO DISPONIBLE", "DEPOSITOS", "EXTRACCIONES", "RETIROS", "CONCEPTO OPERACION", "NRO DE REFERENCIA"]);

/**
 * @param {string[][]} rows
 * @returns {{ tipo: "mercadopago"|"extracto"|"mayor"|null, seguro: boolean }}
 *   seguro = false cuando la planilla podría ser cualquiera de los dos (p. ej. solo Débito/Crédito).
 */
export function clasificarPlanilla(rows) {
  if (columnasMP(rows)) return { tipo: "mercadopago", seguro: true };
  const enc = detectarColumnasExtracto(rows), led = detectLedgerColumns(rows);
  const fila = enc?.headerRow ?? led?.headerRow ?? 0;
  const titulo = normText(rows.slice(0, Math.max(fila, 1)).map((r) => r.join(" ")).join(" "));
  const hs = new Set((rows[fila] || []).map((c) => normH(c)));
  let mayor = 0, banco = 0;
  for (const h of hs) { if (H_MAYOR.has(h)) mayor += 3; if (H_BANCO.has(h)) banco += 2; }
  if (TITULO_MAYOR.test(titulo)) mayor += 3;
  if (TITULO_BANCO.test(titulo)) banco += 2;
  if (!enc && !led) return { tipo: null, seguro: false };
  if (mayor > banco) return { tipo: "mayor", seguro: mayor - banco >= 3 };
  if (banco > mayor) return { tipo: "extracto", seguro: banco - mayor >= 2 };
  // Empate (p. ej. solo "Débito / Crédito"): decide la regla del saldo. Leída de una manera los
  // saldos cierran y de la otra no (el signo queda al revés); si no hay con qué verificar, se pregunta.
  const porSaldo = decidirPorSaldo(rows);
  return porSaldo ? { tipo: porSaldo, seguro: true, por: "saldo" } : { tipo: "mayor", seguro: false };
}

function decidirPorSaldo(rows) {
  const prueba = (fn) => { try { const r = fn(); return r.movs.length && r.control.ok === true && r.control.filasConError?.length === 0; } catch { return false; } };
  const comoMayor = prueba(() => parseLedgerRows(rows)), comoExtracto = prueba(() => leerExtractoPlanilla(rows));
  return comoMayor === comoExtracto ? null : comoMayor ? "mayor" : "extracto";
}

/** Extracto bancario en planilla → lado banco, con su control (apertura + movimientos = cierre). */
export function leerExtractoPlanilla(rows, { headerRow, map, doc, anio, amountMode = "auto" } = {}) {
  if (!map) {
    const det = detectarColumnasExtracto(rows);
    if (!det) throw new Error("No encontré las columnas del extracto (Fecha y Débito/Crédito o Importe).");
    ({ headerRow, map } = det);
  }
  // Mismo lector que el mayor, con los roles del banco dados vuelta: Crédito (entra) = Debe.
  const led = parseLedgerRows(rows, {
    headerRow, doc, anio, amountMode, prefijo: "B",
    map: { fecha: map.fecha, descripcion: map.descripcion, debe: map.credito, haber: map.debito, importe: map.importe, saldo: map.saldo, comprobante: map.referencia },
  });
  return { ...led, movs: led.movs.map((m) => ({ ...m, lado: "banco", referencia: m.referencia })), mapeo: map };
}
