// Clasificador DETERMINISTA del "ruido" bancario argentino: impuesto ley 25.413, SIRCREB,
// percepciones, comisiones con su IVA, intereses, VEP, tarjetas, Mercado Pago…
// Va antes que cualquier IA: estas líneas son muchas, repetitivas y se resuelven con reglas
// que el contador puede leer, corregir y ampliar (modo deportivo: `extraRules`).
import { normText } from "./text.js";
import { daysBetween } from "./dates.js";

/**
 * Grupos:
 *  - fiscal:         impuestos/retenciones/percepciones → asiento de ajuste (crédito fiscal o gasto)
 *  - gasto_bancario: comisiones, mantenimiento, seguros, IVA de comisiones → asiento de ajuste
 *  - financiero:     intereses → asiento de ajuste
 *  - operativo:      transferencias, depósitos, cheques, débitos automáticos… → hay que
 *                    IDENTIFICAR contra qué (no se ajusta a ciegas)
 */
export const RULES = [
  { tipo: "impuesto_25413", grupo: "fiscal", re: /LEY\s*25\.?413|IMP(?:UESTO)?\.?\s*(?:S\/|SOBRE\s+)?(?:DEB|CRED|DB|CR)[A-Z.]*\s*(?:Y\s*(?:CRED|CR)[A-Z.]*)?\s*(?:BANC|LEY|\d|$)|IMP(?:UESTO)?\.?\s*(?:A\s+LOS\s+)?(?:DEBITOS|CREDITOS)\s+(?:Y\s+CREDITOS\s+)?BANC|IMP\.?\s*DB\/CR|\bIDCB\b/ },
  { tipo: "retencion_iibb", grupo: "fiscal", re: /SIRCREB|SIRCUPA|RET(?:\.|ENCION)?\s*(?:DE\s+)?(?:IIBB|I\.?\s?B\.?|ING(?:\.|RESOS)?\s*BR)/ },
  { tipo: "percepcion_iva", grupo: "fiscal", re: /PERC(?:\.|EP(?:\.|CION)?)?\s*(?:DE\s+)?I\.?\s?V\.?\s?A\b|R\.?G\.?\s*2408/ },
  { tipo: "percepcion_iibb", grupo: "fiscal", re: /PERC(?:\.|EP(?:\.|CION)?)?\s*(?:DE\s+)?(?:IIBB|I\.?\s?B\.?|ING(?:\.|RESOS)?\s*BR)/ },
  { tipo: "percepcion_ganancias", grupo: "fiscal", re: /PERC(?:\.|EP(?:\.|CION)?)?\s*(?:DE\s+)?GAN/ },
  { tipo: "iva_comision", grupo: "gasto_bancario", re: /\bI\.?\s?V\.?\s?A\b/ },
  { tipo: "interes_ganado", grupo: "financiero", re: /INTERES/, signo: +1 },
  { tipo: "interes_pagado", grupo: "financiero", re: /INTERES|INT\.?\s*(?:DEUDOR|ACUERDO|DESCUBIERTO)/, signo: -1 },
  { tipo: "comision", grupo: "gasto_bancario", re: /COMIS|MANT(?:\.|ENIMIENTO)?\s*(?:DE\s+)?(?:CTA|CUENTA|PAQUETE)|CARGO\s+(?:POR\s+)?(?:SERV|MANT|EMISION)|GASTOS?\s+BANC|SEGURO|CUOTA\s+(?:PAQUETE|SERVICIO)|CHEQUERA/ },
  { tipo: "vep_arca", grupo: "operativo", re: /\bVEP\b|\bAFIP\b|\bARCA\b|\bDGI\b|ANSES/ },
  { tipo: "pago_tarjeta", grupo: "operativo", re: /PAGO\s+(?:DE\s+)?(?:RESUMEN\s+)?TARJ|RESUMEN\s+TARJ/, signo: -1 },
  { tipo: "tarjeta_liquidacion", grupo: "operativo", re: /PRISMA|PAYWAY|FISERV|FIRST\s*DATA|LIQ(?:\.|UIDACION)?\s*(?:TARJ|COMERCIO|VISA|MASTER|CABAL)|\bVISA\b|MASTERCARD|\bCABAL\b|NARANJA|AMEX|AMERICAN\s+EXPRESS/ },
  { tipo: "mercadopago", grupo: "operativo", re: /MERCADO\s*PAGO|MERCADOPAGO|\bMP\b/ },
  { tipo: "plazo_fijo", grupo: "operativo", re: /PLAZO\s*FIJO|\bP\.?\s?F\.?\b/ },
  { tipo: "debito_automatico", grupo: "operativo", re: /DEB(?:\.|ITO)?\s*AUT(?:\.|OM)?/ },
  { tipo: "sueldos", grupo: "operativo", re: /SUELDO|HABERES|REMUNERAC/ },
  { tipo: "cheque", grupo: "operativo", re: /E-?CHEQ|CHEQUE|\bCHQ\b|\bCH\b|CLEARING|CAMARA/ },
  { tipo: "extraccion", grupo: "operativo", re: /RETIRO|EXTRACCION|CAJERO|\bATM\b/ },
  { tipo: "deposito", grupo: "operativo", re: /DEPOSITO|\bDEP\b\.?/ },
  { tipo: "transferencia", grupo: "operativo", re: /TRANSF|\bTRF\b|\bTEF\b|\bCVU\b|\bCBU\b|DEBIN/ },
];

/** Grupos que generan asiento de ajuste sin necesitar identificación. */
export const GRUPOS_AJUSTABLES = new Set(["fiscal", "gasto_bancario", "financiero"]);

/**
 * Clasifica un movimiento por su descripción.
 * @param {{ descripcion: string, cents: number }} mov
 * @param {Array<{tipo:string, grupo:string, re:RegExp|string, signo?:number}>} [extraRules] reglas del
 *        cliente/estudio, que se evalúan ANTES que las de fábrica.
 * @returns {{ tipo: string, grupo: string, regla: string|null }}
 */
export function classify(mov, extraRules = []) {
  const s = normText(mov.descripcion);
  for (const r of [...extraRules, ...RULES]) {
    const re = typeof r.re === "string" ? new RegExp(r.re, "i") : r.re;
    if (r.signo && Math.sign(mov.cents) !== r.signo) continue;
    if (re.test(s)) return { tipo: r.tipo, grupo: r.grupo, regla: String(r.id || r.tipo) };
  }
  return { tipo: "desconocido", grupo: "desconocido", regla: null };
}

/**
 * Clasifica todos los movimientos del banco y agrega el CONTROL DE PLAUSIBILIDAD del
 * impuesto ley 25.413: su importe debería ser ~0,6% (o 1,2%) de algún movimiento del mismo
 * día (±1). Si cierra, la confianza es "alta" y se dice contra qué movimiento.
 * @param {import("./model.js").Mov[]} movs
 * @returns {Map<string, { tipo:string, grupo:string, regla:string|null, confianza:"alta"|"media"|"baja", motivo:string }>}
 */
export function classifyAll(movs, extraRules = []) {
  const out = new Map();
  for (const m of movs) {
    const c = classify(m, extraRules);
    let confianza = c.grupo === "desconocido" ? "baja" : "media";
    let motivo = c.regla ? `la descripción coincide con la regla "${c.regla}"` : "ninguna regla reconoce la descripción";
    if (c.tipo === "impuesto_25413") {
      const base = plausible25413(m, movs);
      if (base) { confianza = "alta"; motivo += `; el importe es el ${base.alicuota}% del movimiento ${base.id}`; }
    } else if (c.grupo !== "desconocido" && c.grupo !== "operativo") confianza = "alta";
    out.set(m.id, { ...c, confianza, motivo });
  }
  return out;
}

function plausible25413(imp, movs) {
  const abs = Math.abs(imp.cents);
  for (const m of movs) {
    if (m.id === imp.id || Math.abs(daysBetween(m.fecha, imp.fecha) ?? 99) > 1) continue;
    for (const alic of [0.6, 1.2]) {
      const esperado = Math.round(Math.abs(m.cents) * alic / 100);
      if (Math.abs(esperado - abs) <= 1) return { id: m.id, alicuota: String(alic).replace(".", ",") };
    }
  }
  return null;
}
