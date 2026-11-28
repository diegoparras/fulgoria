// Liquidaciones de tarjetas (Visa, Mastercard, Cabal, Amex, Naranja… vía Prisma/Payway, Fiserv,
// etc.). El banco acredita UN neto por liquidación (o varias juntas); la liquidación explica de
// dónde sale: ventas brutas − arancel − IVA − costo financiero − retenciones − percepciones = neto.
//
// Se leen de la planilla que exporta la procesadora (Excel o CSV) por sus encabezados —igual que
// el mayor—; si no se reconocen, se indican una vez y queda la plantilla. Cada liquidación se
// verifica con su propia "regla del saldo" (bruto − descuentos = neto).
import { parseMoneyCents } from "./money.js";
import { toISO } from "./dates.js";
import { normText } from "./text.js";

const normH = (s) => normText(String(s ?? "")).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Descuentos de una liquidación, con el texto para el contador. */
export const DESCUENTOS = {
  arancel: "Arancel",
  ivaArancel: "IVA sobre arancel",
  costoFinanciero: "Costo financiero (cuotas / adelanto)",
  ivaCostoFinanciero: "IVA sobre costo financiero",
  retIVA: "Retención de IVA",
  retGanancias: "Retención de Ganancias",
  retIIBB: "Retención de Ingresos Brutos",
  percIVA: "Percepción de IVA",
  percIIBB: "Percepción de Ingresos Brutos",
  otros: "Otros descuentos",
};
export const ROLES_LIQUIDACION = {
  fechaPago: "Fecha de pago / acreditación", numero: "Nº de liquidación", marca: "Tarjeta / marca",
  bruto: "Ventas brutas", ...DESCUENTOS, neto: "Neto a cobrar", ignorar: "Ignorar",
};
const SINONIMOS = {
  fechaPago: ["FECHA DE PAGO", "FECHA PAGO", "F PAGO", "FECHA DE ACREDITACION", "FECHA ACREDITACION", "FEC PAGO", "FECHA DE COBRO", "FECHA COBRO", "PAGO"],
  numero: ["NRO LIQUIDACION", "NUMERO DE LIQUIDACION", "N LIQUIDACION", "NRO DE LIQUIDACION", "LIQUIDACION", "NRO LIQ", "LIQ", "NUMERO LIQUIDACION", "ID LIQUIDACION"],
  marca: ["MARCA", "TARJETA", "PRODUCTO", "BANDERA", "MEDIO DE PAGO"],
  bruto: ["BRUTO", "IMPORTE BRUTO", "TOTAL BRUTO", "MONTO BRUTO", "VENTAS", "IMPORTE VENTAS", "TOTAL VENTAS", "TOTAL PRESENTADO", "IMPORTE PRESENTADO", "VENTAS BRUTAS"],
  arancel: ["ARANCEL", "ARANCELES", "COMISION", "COMISIONES", "ARANCEL TARJETA", "IMPORTE ARANCEL"],
  ivaArancel: ["IVA ARANCEL", "IVA ARANCELES", "IVA S ARANCEL", "IVA SOBRE ARANCEL", "IVA COMISION", "IVA 21", "IVA"],
  costoFinanciero: ["COSTO FINANCIERO", "COSTO FINANC", "CARGO FINANCIERO", "COSTO PLAN CUOTAS", "COSTO CUOTAS", "INTERESES", "COSTO ADELANTO", "DESCUENTO FINANCIERO"],
  ivaCostoFinanciero: ["IVA COSTO FINANCIERO", "IVA COSTO FINANC", "IVA 10 5", "IVA CARGO FINANCIERO"],
  retIVA: ["RETENCION IVA", "RET IVA", "RETENCIONES IVA", "RET DE IVA"],
  retGanancias: ["RETENCION GANANCIAS", "RET GANANCIAS", "RETENCIONES GANANCIAS", "RET DE GANANCIAS"],
  retIIBB: ["RETENCION IIBB", "RET IIBB", "RETENCION INGRESOS BRUTOS", "RETENCIONES IIBB", "IIBB", "RET DE IIBB", "INGRESOS BRUTOS"],
  percIVA: ["PERCEPCION IVA", "PERC IVA", "PERCEPCIONES IVA"],
  percIIBB: ["PERCEPCION IIBB", "PERC IIBB", "PERCEPCIONES IIBB"],
  otros: ["OTROS", "OTROS DESCUENTOS", "OTROS CARGOS", "DESCUENTOS", "CARGOS", "AJUSTES"],
  neto: ["NETO", "IMPORTE NETO", "NETO A COBRAR", "NETO A LIQUIDAR", "TOTAL NETO", "NETO PAGADO", "IMPORTE A PAGAR", "NETO A PAGAR", "IMPORTE NETO DE PAGO", "MONTO NETO"],
};
const MARCAS = [["VISA", /\bVISA\b/], ["Mastercard", /\bMASTER(CARD)?\b|\bMC\b/], ["Cabal", /\bCABAL\b/], ["American Express", /\bAMEX\b|AMERICAN EXPRESS/], ["Naranja", /\bNARANJA\b/], ["Maestro", /\bMAESTRO\b/], ["Diners", /\bDINERS\b/], ["Argencard", /\bARGENCARD\b/]];
export const marcaDe = (texto) => { const t = normText(String(texto || "")); return MARCAS.find(([, re]) => re.test(t))?.[0] || ""; };

/** Columnas de una planilla de liquidaciones → { headerRow, map } o null. */
export function detectarColumnasLiquidacion(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const map = {};
    rows[r].forEach((cell, i) => {
      const h = normH(cell);
      for (const [rol, syns] of Object.entries(SINONIMOS)) if (map[rol] == null && syns.includes(h)) { map[rol] = i; break; }
    });
    const descuentos = Object.keys(DESCUENTOS).filter((k) => map[k] != null).length;
    if (map.fechaPago != null && (map.neto != null || map.bruto != null) && (descuentos >= 1 || (map.neto != null && map.bruto != null))) return { headerRow: r, map };
  }
  return null;
}

/**
 * Planilla de liquidaciones → liquidaciones (una por número; si la planilla viene por cupón, se
 * suman los cupones de cada liquidación).
 * @returns {{ liquidaciones: Array<object>, control: { ok: boolean, filasConError: number[] }, avisos: string[] }}
 */
export function leerLiquidaciones(rows, { headerRow, map, doc, marca: marcaArchivo = "" } = {}) {
  if (!map) {
    const det = detectarColumnasLiquidacion(rows);
    if (!det) throw new Error("No reconocí las columnas de la liquidación (fecha de pago, bruto o neto, arancel…). Indicalas una vez y queda guardado.");
    ({ headerRow, map } = det);
  }
  const titulo = rows.slice(0, headerRow).map((r) => r.join(" ")).join(" ");
  const marcaGeneral = marcaArchivo || marcaDe(titulo) || marcaDe(doc);
  const val = (r, k) => (map[k] != null ? String(r[map[k]] ?? "").trim() : "");
  const plata = (r, k) => { const c = parseMoneyCents(val(r, k)); return c == null ? null : Math.abs(c); };
  const grupos = new Map(), avisos = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c || "").trim())) continue;
    const fecha = toISO(val(r, "fechaPago"));
    const texto = normText(r.join(" "));
    if (!fecha) { if (/TOTAL/.test(texto)) continue; if (plata(r, "neto") || plata(r, "bruto")) avisos.push(`Fila ${i + 1} sin fecha de pago: ignorada.`); continue; }
    const numero = val(r, "numero");
    const clave = numero ? `${numero}|${fecha}` : `fila${i}`;
    const g = grupos.get(clave) || { numero, fechaPago: fecha, marca: marcaDe(val(r, "marca")) || val(r, "marca") || marcaGeneral, bruto: 0, neto: 0, conBruto: false, conNeto: false, descuentos: {}, filas: [] };
    if (plata(r, "bruto") != null) { g.bruto += plata(r, "bruto"); g.conBruto = true; }
    if (plata(r, "neto") != null) { g.neto += plata(r, "neto"); g.conNeto = true; }
    for (const k of Object.keys(DESCUENTOS)) { const c = plata(r, k); if (c) g.descuentos[k] = (g.descuentos[k] || 0) + c; }
    g.filas.push(i + 1);
    grupos.set(clave, g);
  }
  const liquidaciones = [], filasConError = [];
  let n = 0;
  for (const g of grupos.values()) {
    const desc = Object.values(g.descuentos).reduce((s, c) => s + c, 0);
    if (!g.conNeto) g.neto = g.bruto - desc;
    if (!g.conBruto) g.bruto = g.neto + desc;
    const cierra = Math.abs(g.bruto - desc - g.neto) <= Math.max(1, g.filas.length); // centavos de redondeo por cupón
    if (g.conNeto && g.conBruto && !cierra) filasConError.push(...g.filas);
    if (!g.neto) continue;
    liquidaciones.push({
      id: "T" + ++n, numero: g.numero, fechaPago: g.fechaPago, marca: g.marca, bruto: g.bruto, descuentos: g.descuentos, neto: g.neto,
      verificada: g.conNeto && g.conBruto ? cierra : null, evidencia: { doc, row: g.filas[0] },
    });
  }
  return { liquidaciones, control: { ok: liquidaciones.length > 0 && !filasConError.length, filasConError }, avisos, mapeo: map };
}

/** Plantilla de liquidaciones: los NOMBRES de los encabezados de cada rol (forma, no datos). */
export function crearPlantillaLiquidacion({ nombre, rows, headerRow, map }) {
  const enc = rows[headerRow] || [];
  const mapeo = {};
  for (const [rol, i] of Object.entries(map)) if (i != null && i >= 0 && ROLES_LIQUIDACION[rol] && rol !== "ignorar") mapeo[rol] = String(enc[i] ?? "");
  if (mapeo.fechaPago == null || (mapeo.neto == null && mapeo.bruto == null)) throw new Error("Hacen falta al menos la fecha de pago y el neto (o el bruto).");
  return { fulgoria_plantilla_liquidacion: 1, nombre: String(nombre || "Liquidaciones").slice(0, 60), mapeo };
}
export function reconocerPlantillaLiquidacion(rows, plantillas = []) {
  for (const tpl of plantillas.filter((t) => t?.fulgoria_plantilla_liquidacion)) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const cells = rows[r].map(normH), map = {};
      if (Object.entries(tpl.mapeo).every(([rol, nombre]) => { const i = cells.indexOf(normH(nombre)); if (i < 0) return false; map[rol] = i; return true; })) return { plantilla: tpl, headerRow: r, map };
    }
  }
  return null;
}

/**
 * Asiento de una liquidación (o varias acreditadas juntas).
 *  - Sin la venta en el libro del banco: Banco (neto) + descuentos / a Tarjetas a cobrar (bruto).
 *  - Con la venta bruta ya registrada en el banco: solo los descuentos / a Banco.
 */
export function asientoLiquidacion(liqs, { cuentas: K, cliente = {} }, { brutoEnLibros = false } = {}) {
  const suma = (f) => liqs.reduce((s, l) => s + f(l), 0);
  const d = (k) => suma((l) => l.descuentos[k] || 0);
  const ri = cliente.responsableInscripto !== false;
  const cuentaDe = {
    arancel: K.arancelesTarjeta, ivaArancel: ri ? K.ivaCreditoFiscal : K.arancelesTarjeta,
    costoFinanciero: K.interesesPagados, ivaCostoFinanciero: ri ? K.ivaCreditoFiscal : K.interesesPagados,
    retIVA: K.retencionIVA, retGanancias: K.retencionGanancias, retIIBB: K.retencionIIBBTarjetas,
    percIVA: K.percepcionIVA, percIIBB: K.percepcionIIBB, otros: K.arancelesTarjeta,
  };
  const debe = new Map();
  for (const k of Object.keys(DESCUENTOS)) { const c = d(k); if (c) debe.set(cuentaDe[k], (debe.get(cuentaDe[k]) || 0) + c); }
  const descuentos = [...debe].map(([cuenta, c]) => ({ cuenta, debe: c, haber: 0 }));
  const total = descuentos.reduce((s, x) => s + x.debe, 0);
  if (brutoEnLibros) return total ? [...descuentos, { cuenta: K.banco, debe: 0, haber: total }] : [];
  return [{ cuenta: K.banco, debe: suma((l) => l.neto), haber: 0 }, ...descuentos, { cuenta: K.tarjetasACobrar, debe: 0, haber: suma((l) => l.bruto) }];
}
