// Los "mandos" del motor. El modo automático usa estos valores por defecto; el modo
// deportivo los expone todos. Se pisan por capas: estudio → cliente → cuenta → corrida.
//   const cfg = resolveConfig(estudioCfg, clienteCfg, cuentaCfg)

export const DEFAULTS = Object.freeze({
  match: {
    // Estrategias, en orden de aplicación. Cada una se puede apagar.
    estrategias: { referencia: true, exacto: true, agrupado: true, consolidado: true, neto: true, ampliado: true, tolerancia: true },
    // Ventana de fechas: cuántos días ANTES / DESPUÉS de la fecha del libro puede aparecer
    // el movimiento en el banco. El banco suele registrar después (clearing, cheques).
    ventanaDias: { antes: 3, despues: 7 },
    // Con referencia compartida (nº de cheque, comprobante, VEP) la ventana es más amplia:
    // un cheque emitido puede debitarse semanas después.
    ventanaReferenciaDias: 60,
    // Cheques emitidos y partidas arrastradas del período anterior: pueden debitarse
    // varias semanas después de registradas.
    ventanaChequesDias: 45,
    // Segunda pasada: importe exacto con fecha más lejana que la ventana. Siempre en amarillo.
    ventanaAmpliadaDias: 20,
    // Tolerancia de importe para la estrategia "tolerancia" (centavos). 0 = solo exactos.
    // Todo lo que empareja con diferencia queda AMARILLO y la diferencia se explicita.
    toleranciaCents: 0,
    // Agrupados N:1 y 1:N (un depósito que junta varias cobranzas, una liquidación neta).
    agrupado: { maxItems: 8, ventanaDias: 5, maxCandidatos: 16 },
    // Neto: venta bruta − descuentos (arancel, IVA, retenciones) = acreditación del banco.
    neto: { maxDescuentoPct: 10, maxItems: 3, ventanaDias: 3 },
    // Importes idénticos e intercambiables (dos cobros de $5.000 en días parecidos): el
    // par elegido no cambia los saldos, pero sí la explicación. Por defecto: amarillo.
    intercambiablesVerde: false,
  },
  pendientes: {
    // Ingreso registrado en libros que no está en el banco: es "depósito en tránsito"
    // solo si está a pocos días del cierre; si no, es sospechoso (rojo).
    depositoTransitoDias: 3,
    // Cheque/egreso pendiente de débito con más antigüedad que esto → alerta.
    chequeAlertaDias: 30,
  },
  cliente: {
    // % del impuesto ley 25.413 computable como pago a cuenta de Ganancias.
    // General 33%; micro y pequeñas empresas con certificado MiPyME: 100%. (Verificar
    // la condición de cada cliente: es un dato, no una suposición.)
    pagoACuenta25413: 33,
    // Responsable inscripto en IVA: el IVA de las comisiones bancarias es crédito fiscal.
    responsableInscripto: true,
  },
  // Plan de cuentas: nombre (o código) de la cuenta contable para cada tipo de ajuste.
  // Cada estudio/cliente lo pisa con su propio plan.
  cuentas: {
    banco: "Banco cuenta corriente",
    impuesto25413Gasto: "Impuesto a los débitos y créditos bancarios",
    impuesto25413PagoACuenta: "Impuesto ley 25.413 - pago a cuenta Ganancias",
    retencionIIBB: "Retenciones IIBB sufridas (SIRCREB)",
    percepcionIIBB: "Percepciones IIBB sufridas",
    percepcionIVA: "Percepciones IVA sufridas",
    percepcionGanancias: "Percepciones Ganancias sufridas",
    ivaCreditoFiscal: "IVA crédito fiscal",
    gastosBancarios: "Gastos bancarios",
    interesesGanados: "Intereses ganados",
    interesesPagados: "Intereses y gastos financieros",
    aIdentificar: "Partidas a identificar",
  },
});

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Mezcla profunda de capas de configuración sobre DEFAULTS (la última gana). */
export function resolveConfig(...capas) {
  const out = structuredClone(DEFAULTS);
  for (const capa of capas) if (capa) merge(out, capa);
  return out;
}
function merge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(dst[k])) merge(dst[k], v);
    else dst[k] = structuredClone(v);
  }
}
