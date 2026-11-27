// Modelo de datos del núcleo de conciliación.
//
// CONVENCIÓN DE SIGNO (una sola, para los dos lados): `cents` > 0 = ENTRA plata a la cuenta,
// `cents` < 0 = SALE plata. En el extracto: crédito bancario > 0, débito < 0. En el mayor de
// la cuenta Banco (un activo): Debe > 0, Haber < 0. Así un movimiento y su contrapartida
// tienen el MISMO signo y el mismo importe, y el emparejamiento compara números iguales.
import { toCents } from "./money.js";
import { toISO } from "./dates.js";
import { extractEntities } from "./entities.js";
import { sumMov } from "../extract.js";

/**
 * @typedef {"banco"|"libros"} Lado
 * @typedef {{ doc?: string, page?: number, y?: number, row?: number }} Evidencia
 *   Dónde está el movimiento en su documento de origen (página y altura en el PDF, o fila
 *   de la planilla). Permite saltar del papel de trabajo al recorte exacto del extracto.
 * @typedef {Object} Mov
 * @property {string} id           Único dentro de la conciliación ("B12", "L7", "A3"…).
 * @property {Lado} lado
 * @property {string} fecha         ISO "AAAA-MM-DD".
 * @property {number} cents         Importe con signo, en centavos (ver convención arriba).
 * @property {string} descripcion
 * @property {string} [referencia]  Comprobante / nº de asiento / nº de cheque del documento.
 * @property {ReturnType<typeof extractEntities>} entidades
 * @property {number|null} [saldo]  Saldo corrido impreso en esa fila (centavos), si lo hay.
 * @property {Evidencia} evidencia
 * @property {string} [periodo]     "AAAA-MM" de origen (para partidas arrastradas).
 */

/** Construye un Mov validando lo mínimo. */
export function makeMov({ id, lado, fecha, cents, descripcion = "", referencia = "", saldo = null, evidencia = {}, periodo }) {
  if (!id) throw new Error("Mov sin id");
  if (lado !== "banco" && lado !== "libros") throw new Error(`Mov ${id}: lado inválido`);
  if (!Number.isInteger(cents)) throw new Error(`Mov ${id}: importe no es centavos enteros`);
  const texto = `${descripcion} ${referencia}`;
  return { id, lado, fecha, cents, descripcion, referencia, saldo, entidades: extractEntities(texto), evidencia, periodo };
}

/**
 * Resultado de `extract()` de Fulgoria (una cuenta/segmento) → Mov[] del lado banco.
 * @param {{ movements: any[], columns: any[], opening?: number|null, closing?: number|null }} seg
 * @param {{ doc?: string, anio?: number, prefijo?: string }} [opts]
 * @returns {{ movs: Mov[], apertura: number|null, cierre: number|null }}
 */
export function fromExtract(seg, opts = {}) {
  const pre = opts.prefijo || "B";
  const movs = [];
  seg.movements.forEach((m, i) => {
    const net = sumMov(m, seg.columns);
    if (net == null) return; // fila sin importe (no debería quedar, pero por las dudas)
    movs.push(makeMov({
      id: pre + (i + 1),
      lado: "banco",
      fecha: toISO(m.fecha, { anio: opts.anio }),
      cents: toCents(net),
      descripcion: m.descripcion || "",
      saldo: m.saldo != null ? toCents(m.saldo) : null,
      evidencia: { doc: opts.doc, page: m._page, y: m._y },
    }));
  });
  return { movs, apertura: toCents(seg.opening), cierre: toCents(seg.closing) };
}
