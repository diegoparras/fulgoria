// Conciliación de UN período de UNA cuenta: empareja, clasifica lo que quedó sin pareja,
// propone asientos, arma la bandeja de excepciones y verifica la ecuación de cierre:
//
//   saldo libros = saldo banco + Σ pendientes del libro − Σ pendientes del banco + Σ diferencias
//
// Si esa ecuación no da exacto al centavo, hay una DIFERENCIA NO EXPLICADA y la conciliación
// no puede quedar en verde. No existe la partida "varios" para forzar el cuadre.
import { matchAll } from "./match.js";
import { classifyAll, GRUPOS_AJUSTABLES } from "./classify.js";
import { daysBetween } from "./dates.js";
import { fmtCents, sumCents } from "./money.js";

/**
 * @typedef {Object} Pendiente
 * @property {string} id            id del movimiento
 * @property {"banco"|"libros"} lado
 * @property {string} tipo          ver TIPOS_PENDIENTE
 * @property {"verde"|"amarillo"|"rojo"} certeza
 * @property {number} antiguedadDias días desde la fecha del movimiento al cierre del período
 * @property {string} motivo
 * @property {object} [clasificacion] (lado banco)
 */
export const TIPOS_PENDIENTE = {
  ajuste_bancario: "Débito/crédito del banco a registrar (impuestos, gastos, intereses)",
  credito_no_identificado: "Crédito del banco sin identificar",
  debito_no_identificado: "Débito del banco sin identificar",
  cheque_pendiente: "Cheque emitido pendiente de débito",
  egreso_pendiente: "Egreso registrado pendiente de débito",
  deposito_transito: "Depósito en tránsito",
  ingreso_no_acreditado: "Ingreso registrado que no aparece en el banco",
};

/**
 * @param {Object} p
 * @param {import("./model.js").Mov[]} p.banco
 * @param {import("./model.js").Mov[]} p.libros
 * @param {import("./model.js").Mov[]} [p.arrastre]  pendientes del período anterior (ambos lados)
 * @param {{ bancoApertura?: number|null, bancoCierre: number, librosApertura?: number|null, librosCierre: number }} p.saldos  centavos
 * @param {{ desde?: string, hasta: string }} p.periodo  fechas ISO
 * @param {ReturnType<import("./config.js").resolveConfig>} p.cfg
 * @param {Array} [p.reglas]   reglas de clasificación del cliente (modo deportivo)
 * @param {Parameters<typeof matchAll>[3]} [p.decisiones]  emparejamientos manuales, rechazados y confirmados
 * @param {{ banco?: boolean, libros?: boolean }} [p.lectura]  ¿la lectura de cada documento está verificada
 *   (regla del saldo)? Si alguna no lo está, NADA se confirma solo: los verdes pasan a amarillo. Sin
 *   este dato, el extracto se da por no verificado cuando no se leyeron sus saldos.
 */
export function reconcile({ banco, libros, arrastre = [], saldos, periodo, cfg, reglas = [], decisiones = {}, lectura = {} }) {
  const arr = arrastre.map((m) => ({ ...m, arrastre: true }));
  const poolB = [...arr.filter((m) => m.lado === "banco"), ...banco];
  const poolL = [...arr.filter((m) => m.lado === "libros"), ...libros];
  const byId = new Map([...poolB, ...poolL].map((m) => [m.id, m]));
  if (byId.size !== poolB.length + poolL.length) throw new Error("Hay ids repetidos entre banco, libros y arrastre");

  const clasif = classifyAll(poolB, reglas);
  const { matches, libresBanco, libresLibros } = matchAll(poolB, poolL, cfg, decisiones, { clasif });

  // Lectura no verificada → ningún emparejamiento automático queda confirmado. Un verde sobre datos
  // mal leídos es exactamente el error que el producto no puede cometer.
  const bancoOk = lectura.banco ?? (saldos.bancoApertura != null && saldos.bancoCierre != null);
  const librosOk = lectura.libros ?? true;
  const lecturaOk = bancoOk && librosOk;
  if (!lecturaOk) for (const m of matches) {
    if (m.certeza === "verde" && m.estrategia !== "manual" && !m.confirmado) {
      m.certeza = "amarillo";
      m.motivos = [...m.motivos, `pendiente de revisión: la lectura del ${!bancoOk ? "extracto" : "mayor"} no está verificada`];
    }
  }

  // --- Pendientes ---
  const pc = cfg.pendientes;
  const pendientes = [];
  for (const m of libresBanco) {
    const c = clasif.get(m.id);
    const ant = daysBetween(m.fecha, periodo.hasta) ?? 0;
    if (GRUPOS_AJUSTABLES.has(c.grupo)) {
      pendientes.push({ id: m.id, lado: "banco", tipo: "ajuste_bancario", certeza: c.confianza === "alta" ? "verde" : "amarillo", antiguedadDias: ant, motivo: c.motivo, clasificacion: c });
    } else {
      const tipo = m.cents > 0 ? "credito_no_identificado" : "debito_no_identificado";
      const pista = c.tipo !== "desconocido" ? ` (parece ${c.tipo.replace(/_/g, " ")})` : "";
      pendientes.push({ id: m.id, lado: "banco", tipo, certeza: "rojo", antiguedadDias: ant, motivo: `no tiene contrapartida en el libro${pista}`, clasificacion: c });
    }
  }
  for (const m of libresLibros) {
    const ant = daysBetween(m.fecha, periodo.hasta) ?? 0;
    if (m.cents < 0) {
      const cheque = !!m.entidades?.cheque || /CHEQ|\bCH\b|\bCHQ\b/i.test(m.descripcion);
      const viejo = ant > pc.chequeAlertaDias;
      pendientes.push({
        id: m.id, lado: "libros", tipo: cheque ? "cheque_pendiente" : "egreso_pendiente",
        certeza: viejo ? "amarillo" : cheque ? "verde" : "amarillo", antiguedadDias: ant,
        motivo: viejo ? `lleva ${ant} días sin debitarse` : cheque ? "cheque todavía no presentado al cobro" : "el banco todavía no lo debitó: verificar que no sea un error de registración",
      });
    } else {
      const transito = ant <= pc.depositoTransitoDias;
      pendientes.push({
        id: m.id, lado: "libros", tipo: transito ? "deposito_transito" : "ingreso_no_acreditado",
        certeza: transito ? "verde" : "rojo", antiguedadDias: ant,
        motivo: transito ? (ant === 0 ? "registrado el día del cierre" : `registrado ${ant} día${ant === 1 ? "" : "s"} antes del cierre`) : `registrado hace ${ant} días y el banco no lo acreditó`,
      });
    }
  }

  // --- Ecuación de cierre ---
  const pendL = pendientes.filter((p) => p.lado === "libros").map((p) => byId.get(p.id));
  const pendB = pendientes.filter((p) => p.lado === "banco").map((p) => byId.get(p.id));
  const sumDif = matches.reduce((s, m) => s + m.diferenciaCents, 0);
  const librosCalculado = saldos.bancoCierre + sumCents(pendL) - sumCents(pendB) + sumDif;
  const diferenciaNoExplicada = saldos.librosCierre - librosCalculado;

  // Apertura: la diferencia inicial entre libros y banco debe ser exactamente el arrastre.
  let apertura = null;
  if (saldos.bancoApertura != null && saldos.librosApertura != null) {
    const dif = saldos.librosApertura - saldos.bancoApertura;
    const explicada = sumCents(arr.filter((m) => m.lado === "libros")) - sumCents(arr.filter((m) => m.lado === "banco"));
    apertura = { diferencia: dif, explicadaPorArrastre: explicada, ok: dif === explicada };
  }

  const ajustes = proponerAjustes(pendientes.filter((p) => p.tipo === "ajuste_bancario"), byId, cfg);
  const bandeja = armarBandeja({ matches, pendientes, byId, diferenciaNoExplicada, apertura, lectura: { banco: bancoOk, libros: librosOk } });
  const rojos = bandeja.filter((t) => t.certeza === "rojo").length;
  const amarillos = bandeja.filter((t) => t.certeza === "amarillo").length;

  return {
    periodo,
    lectura: { banco: bancoOk, libros: librosOk },
    saldos: { ...saldos, librosCalculado },
    diferenciaNoExplicada,
    apertura,
    matches,
    pendientes,
    ajustes,
    bandeja,
    clasificacion: Object.fromEntries(clasif),
    movimientos: Object.fromEntries(byId),
    resumen: {
      movimientosBanco: poolB.length,
      movimientosLibros: poolL.length,
      emparejadosVerde: matches.filter((m) => m.certeza === "verde").reduce((s, m) => s + m.banco.length, 0),
      emparejadosAmarillo: matches.filter((m) => m.certeza === "amarillo").reduce((s, m) => s + m.banco.length, 0),
      pendientes: pendientes.length,
      // Estado global del semáforo de la cuenta-mes.
      estado: diferenciaNoExplicada !== 0 || rojos || !lecturaOk ? "rojo" : amarillos ? "amarillo" : "verde",
    },
  };
}

// --- Asientos de ajuste propuestos para las partidas del banco no registradas ---
// Cada asiento sale con el detalle del movimiento de origen; el contador puede aceptarlos de a
// uno, todos juntos, o consolidarlos en un asiento mensual.
function proponerAjustes(items, byId, cfg) {
  const K = cfg.cuentas, cli = cfg.cliente;
  const out = [];
  for (const p of items) {
    const m = byId.get(p.id);
    const abs = Math.abs(m.cents);
    const entra = m.cents > 0;
    /** @type {Array<{cuenta:string, cents:number}>} contrapartidas (del lado opuesto al banco) */
    let contra;
    switch (p.clasificacion.tipo) {
      case "impuesto_25413": {
        const pac = Math.round(abs * cli.pagoACuenta25413 / 100);
        contra = [{ cuenta: K.impuesto25413PagoACuenta, cents: pac }, { cuenta: K.impuesto25413Gasto, cents: abs - pac }].filter((x) => x.cents);
        break;
      }
      case "retencion_iibb": contra = [{ cuenta: K.retencionIIBB, cents: abs }]; break;
      case "percepcion_iibb": contra = [{ cuenta: K.percepcionIIBB, cents: abs }]; break;
      case "percepcion_iva": contra = [{ cuenta: K.percepcionIVA, cents: abs }]; break;
      case "percepcion_ganancias": contra = [{ cuenta: K.percepcionGanancias, cents: abs }]; break;
      case "iva_comision": contra = [{ cuenta: cli.responsableInscripto ? K.ivaCreditoFiscal : K.gastosBancarios, cents: abs }]; break;
      case "interes_ganado": contra = [{ cuenta: K.interesesGanados, cents: abs }]; break;
      case "interes_pagado": contra = [{ cuenta: K.interesesPagados, cents: abs }]; break;
      default: contra = [{ cuenta: K.gastosBancarios, cents: abs }];
    }
    // Salida de plata: Debe contrapartidas / Haber Banco. Entrada: Debe Banco / Haber contrapartidas.
    const lineas = entra
      ? [{ cuenta: K.banco, debe: abs, haber: 0 }, ...contra.map((c) => ({ cuenta: c.cuenta, debe: 0, haber: c.cents }))]
      : [...contra.map((c) => ({ cuenta: c.cuenta, debe: c.cents, haber: 0 })), { cuenta: K.banco, debe: 0, haber: abs }];
    out.push({ id: "A" + (out.length + 1), fecha: m.fecha, concepto: m.descripcion, origen: [m.id], tipo: p.clasificacion.tipo, certeza: p.certeza, lineas });
  }
  return out;
}

// --- Bandeja de excepciones: lo que necesita al contador, de lo más urgente a lo más tranquilo ---
function armarBandeja({ matches, pendientes, byId, diferenciaNoExplicada, apertura, lectura }) {
  const cards = [];
  const tot = (ids) => ids.reduce((s, id) => s + byId.get(id).cents, 0);
  const add = (clave, certeza, titulo, ids, accion, extra = {}) => {
    if (!ids.length && !extra.forzar) return;
    cards.push({ clave, certeza, titulo, cantidad: ids.length, totalCents: tot(ids), ids, accion, ...extra });
  };
  const de = (tipo, f = () => true) => pendientes.filter((p) => p.tipo === tipo && f(p)).map((p) => p.id);
  const n = (k) => (k === 1 ? "" : "s");

  if (!lectura.banco || !lectura.libros) {
    const doc = !lectura.banco ? "del extracto" : "del mayor";
    cards.push({ clave: "lectura_no_verificada", certeza: "rojo", titulo: `La lectura ${doc} no está verificada: los saldos no cierran con los movimientos leídos`, cantidad: 0, totalCents: 0, ids: [], accion: "revisar_lectura" });
  }
  if (diferenciaNoExplicada !== 0) {
    cards.push({ clave: "diferencia_no_explicada", certeza: "rojo", titulo: `Diferencia no explicada de ${fmtCents(diferenciaNoExplicada)}: falta un movimiento o hay un saldo mal cargado`, cantidad: 0, totalCents: diferenciaNoExplicada, ids: [], accion: "revisar_saldos" });
  }
  if (apertura && !apertura.ok) {
    cards.push({ clave: "apertura_no_cuadra", certeza: "rojo", titulo: `Las aperturas no cuadran por ${fmtCents(apertura.diferencia - apertura.explicadaPorArrastre)}: falta el arrastre del período anterior`, cantidad: 0, totalCents: apertura.diferencia - apertura.explicadaPorArrastre, ids: [], accion: "cargar_arrastre" });
  }
  const cred = de("credito_no_identificado"), deb = de("debito_no_identificado"), ing = de("ingreso_no_acreditado");
  add("creditos_no_identificados", "rojo", `${cred.length} crédito${n(cred.length)} del banco sin identificar`, cred, "pedir_al_cliente");
  add("debitos_no_identificados", "rojo", `${deb.length} débito${n(deb.length)} del banco sin identificar`, deb, "pedir_al_cliente");
  add("ingresos_no_acreditados", "rojo", `${ing.length} ingreso${n(ing.length)} registrado${n(ing.length)} que el banco no acreditó`, ing, "revisar");

  const viejos = pendientes.filter((p) => p.lado === "libros" && p.certeza === "amarillo").map((p) => p.id);
  add("egresos_a_revisar", "amarillo", `${viejos.length} egreso${n(viejos.length)} pendiente${n(viejos.length)} de débito para revisar`, viejos, "revisar");
  const am = matches.filter((m) => m.certeza === "amarillo");
  add("emparejamientos_a_confirmar", "amarillo", `${am.length} emparejamiento${n(am.length)} para confirmar`, am.flatMap((m) => m.banco), "confirmar", { matches: am.map((m) => m.id) });

  const aj = de("ajuste_bancario");
  const ajDudosos = pendientes.some((p) => p.tipo === "ajuste_bancario" && p.certeza !== "verde");
  add("ajustes_bancarios", ajDudosos ? "amarillo" : "verde", `${aj.length} impuesto${n(aj.length)}, gasto${n(aj.length)} e interes${aj.length === 1 ? "" : "es"} del banco listos para asentar`, aj, "generar_asientos");

  const normales = pendientes.filter((p) => p.lado === "libros" && p.certeza === "verde").map((p) => p.id);
  add("pendientes_normales", "verde", `${normales.length} partida${n(normales.length)} en tránsito (normales al cierre)`, normales, "ninguna");
  const vm = matches.filter((m) => m.certeza === "verde");
  add("conciliados", "verde", (() => { const n = vm.reduce((s, m) => s + m.banco.length, 0); return n === 1 ? "1 movimiento conciliado solo" : `${n} movimientos conciliados solos`; })(), vm.flatMap((m) => m.banco), "ninguna", { matches: vm.map((m) => m.id), totalCents: 0 });

  // Orden: primero lo que invalida la conciliación entera (saldos), después rojo → amarillo →
  // verde y, dentro de cada color, lo de mayor importe.
  const ord = { rojo: 0, amarillo: 1, verde: 2 };
  const bloqueante = (t) => (t.clave === "lectura_no_verificada" ? -1 : t.clave === "diferencia_no_explicada" || t.clave === "apertura_no_cuadra" ? 0 : 1);
  return cards.sort((a, b) => bloqueante(a) - bloqueante(b) || ord[a.certeza] - ord[b.certeza] || Math.abs(b.totalCents) - Math.abs(a.totalCents));
}

/**
 * Pendientes de este período que pasan al siguiente (para `arrastre`). Excluye los ajustes
 * bancarios que el contador ya aceptó asentar (`ajustesAceptados`: ids de movimiento).
 */
export function arrastreSiguiente(rec, ajustesAceptados = []) {
  const ok = new Set(ajustesAceptados);
  return rec.pendientes
    .filter((p) => !(p.tipo === "ajuste_bancario" && ok.has(p.id)))
    .map((p) => {
      const { arrastre, ...m } = rec.movimientos[p.id];
      return { ...m, periodo: m.periodo || rec.periodo.hasta.slice(0, 7) };
    });
}

/**
 * Continuidad entre extractos consecutivos de una cuenta: el cierre de uno debe ser la
 * apertura del siguiente y no debe haber huecos de fechas. Detecta extractos faltantes.
 * @param {Array<{ id: string, desde: string, hasta: string, apertura: number, cierre: number }>} extractos
 */
export function continuidad(extractos) {
  const xs = [...extractos].sort((a, b) => a.desde.localeCompare(b.desde));
  const problemas = [];
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i];
    if (a.cierre !== b.apertura) problemas.push({ entre: [a.id, b.id], tipo: "saldo", detalle: `el cierre de ${a.id} (${fmtCents(a.cierre)}) no es la apertura de ${b.id} (${fmtCents(b.apertura)})` });
    const hueco = daysBetween(a.hasta, b.desde);
    if (hueco > 1) problemas.push({ entre: [a.id, b.id], tipo: "fechas", detalle: `faltan ${hueco - 1} días entre ${a.hasta} y ${b.desde}` });
  }
  return { ok: problemas.length === 0, problemas };
}
