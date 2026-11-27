// Tests del núcleo de conciliación (src/core). Runner: `node --test`.
// El caso integral usa el extracto sintético de samples/banco-rio-cc.pdf (mismos movimientos
// que tools/gen-sample.mjs) contra samples/mayor-banco-rio-cc.csv, armado a propósito con
// partidas conocidas: agrupado, cheque pendiente, depósito en tránsito, gastos sin registrar
// y un crédito que el cliente no registró.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseMoneyCents, fmtCents, toISO, daysBetween, extractEntities, classify, classifyAll,
  makeMov, resolveConfig, parseLedgerCsv, matchAll, subsetSums, reconcile, arrastreSiguiente,
  continuidad, papelSaldoASaldo, papelToMarkdown, papelToCsv, asientosToCsv, fromExtract,
} from "../src/core/index.js";

// --- Fixture: movimientos del extracto de ejemplo (tools/gen-sample.mjs) ---
const EXTRACTO = [
  ["02/06/2026", "TRANSFERENCIA RECIBIDA CBU CLIENTE PROVEEDOR SRL", 0, 8_500_00],
  ["03/06/2026", "PAGO PROVEEDORES VARIOS", 3_200_50, 0],
  ["05/06/2026", "DEBITO AUTOMATICO SERVICIOS", 1_145_00, 0],
  ["08/06/2026", "DEPOSITO EFECTIVO SUCURSAL CENTRO", 0, 12_000_00],
  ["09/06/2026", "COMISION MANTENIMIENTO CUENTA", 980_00, 0],
  ["10/06/2026", "IMPUESTO LEY 25.413 DEBITOS", 58_80, 0],
  ["12/06/2026", "TRANSFERENCIA RECIBIDA HONORARIOS ESTUDIO CONTABLE", 0, 4_300_00],
  ["15/06/2026", "PAGO TARJETA CORPORATIVA", 6_750_25, 0],
  ["17/06/2026", "ACREDITACION INTERESES PLAZO FIJO", 0, 1_240_00],
  ["19/06/2026", "DEBITO AUTOMATICO ALQUILER", 9_500_00, 0],
  ["22/06/2026", "RETIRO CAJERO AUTOMATICO", 2_000_00, 0],
  ["24/06/2026", "TRANSFERENCIA RECIBIDA VENTA FACTURA A 0001-00012345", 0, 18_900_00],
  ["26/06/2026", "PERCEPCION IIBB CABA", 412_30, 0],
  ["29/06/2026", "PAGO SUELDOS PERSONAL", 14_300_00, 0],
];
const APERTURA = 15_000_00; // el extracto de ejemplo abre con $15.000,00
const banco = () => EXTRACTO.map(([f, d, deb, cre], i) => makeMov({ id: "B" + (i + 1), lado: "banco", fecha: toISO(f), cents: cre - deb, descripcion: d, evidencia: { doc: "banco-rio-cc.pdf", page: 1 } }));
const cierreBanco = () => APERTURA + banco().reduce((s, m) => s + m.cents, 0);
const mayor = () => parseLedgerCsv(readFileSync(new URL("../samples/mayor-banco-rio-cc.csv", import.meta.url), "utf8"), { doc: "mayor.csv" });
const JUNIO = { desde: "2026-06-01", hasta: "2026-06-30" };
const B = (id, fecha, cents, descripcion = "") => makeMov({ id, lado: "banco", fecha, cents, descripcion });
const L = (id, fecha, cents, descripcion = "") => makeMov({ id, lado: "libros", fecha, cents, descripcion });

// ---------------------------------------------------------------- dinero y fechas
test("parseMoneyCents — formatos de planilla", () => {
  assert.equal(parseMoneyCents("1.234,56"), 123456);
  assert.equal(parseMoneyCents("1,234.56"), 123456);
  assert.equal(parseMoneyCents("1234"), 123400);
  assert.equal(parseMoneyCents("1.234"), 123400);      // punto de miles es-AR
  assert.equal(parseMoneyCents("1234.5"), 123450);
  assert.equal(parseMoneyCents("-58,80"), -5880);
  assert.equal(parseMoneyCents("58,80-"), -5880);
  assert.equal(parseMoneyCents("(1.000,00)"), -100000);
  assert.equal(parseMoneyCents("$ 0,10"), 10);
  assert.equal(parseMoneyCents(""), null);
  assert.equal(parseMoneyCents("abc"), null);
  assert.equal(fmtCents(15200425), "152.004,25");
  assert.equal(fmtCents(-5880), "-58,80");
  assert.equal(fmtCents(-5880, { signo: "parentesis" }), "(58,80)");
});

test("toISO / daysBetween", () => {
  assert.equal(toISO("08/06/2026"), "2026-06-08");
  assert.equal(toISO("8/6/26"), "2026-06-08");
  assert.equal(toISO("2026-06-08"), "2026-06-08");
  assert.equal(toISO("15/06", { anio: 2026 }), "2026-06-15");
  assert.equal(toISO("31/02/2026"), null);
  assert.equal(daysBetween("2026-05-28", "2026-06-02"), 5);
});

// ---------------------------------------------------------------- entidades y clasificación
test("extractEntities — cheque, comprobante, CUIT válido, VEP", () => {
  assert.deepEqual(extractEntities("Cheque emitido Nro 00004521 a Distribuidora Norte"), { cheque: "4521" });
  assert.equal(extractEntities("CH. 4521").cheque, "4521");
  assert.equal(extractEntities("ECHEQ N° 123456").cheque, "123456");
  assert.equal(extractEntities("TRANSF FACTURA A 0001-00012345").comprobante, "00001-00012345");
  assert.equal(extractEntities("TRANSF CUIT 20-12345678-6").cuit, "20123456786");
  assert.equal(extractEntities("TRANSF CUIT 20-12345678-3").cuit, undefined); // dígito verificador inválido
  assert.equal(extractEntities("PAGO VEP 123456789 AFIP").vep, "123456789");
});

test("classify — ruido fiscal argentino y operaciones", () => {
  const t = (d, c = -1) => classify({ descripcion: d, cents: c }).tipo;
  assert.equal(t("IMPUESTO LEY 25.413 DEBITOS"), "impuesto_25413");
  assert.equal(t("IMP. S/CRED. LEY 25413"), "impuesto_25413");
  assert.equal(t("IMP DB/CR"), "impuesto_25413");
  assert.equal(t("Imp. Créd. 25413"), "impuesto_25413");
  assert.equal(t("RET. IIBB SIRCREB"), "retencion_iibb");
  assert.equal(t("PERCEPCION IIBB CABA"), "percepcion_iibb");
  assert.equal(t("PERCEP. IVA RG 2408"), "percepcion_iva");
  assert.equal(t("I.V.A. TASA GENERAL"), "iva_comision");
  assert.equal(t("COMISION MANTENIMIENTO CUENTA"), "comision");
  assert.equal(t("ACREDITACION INTERESES PLAZO FIJO", 1), "interes_ganado");
  assert.equal(t("INTERESES ACUERDO DESCUBIERTO", -1), "interes_pagado");
  assert.equal(t("PAGO VEP AFIP"), "vep_arca");
  assert.equal(t("LIQ PRISMA VISA", 1), "tarjeta_liquidacion");
  assert.equal(t("PAGO TARJETA CORPORATIVA"), "pago_tarjeta");
  assert.equal(t("DEBITO AUTOMATICO SERVICIOS"), "debito_automatico");
  assert.equal(t("XYZ 123"), "desconocido");
  // Reglas del cliente (modo deportivo) van antes que las de fábrica.
  assert.equal(classify({ descripcion: "DEBITO AUTOMATICO SERVICIOS", cents: -1 }, [{ tipo: "comision", grupo: "gasto_bancario", re: "SERVICIOS" }]).tipo, "comision");
});

test("classifyAll — plausibilidad del 0,6% del impuesto ley 25.413", () => {
  const movs = [B("B1", "2026-06-10", -980000, "PAGO PROVEEDOR"), B("B2", "2026-06-10", -5880, "IMP.DEB.LEY 25413"), B("B3", "2026-06-11", -1000, "IMP.DEB.LEY 25413")];
  const c = classifyAll(movs);
  assert.equal(c.get("B2").confianza, "alta");
  assert.match(c.get("B2").motivo, /0,6% del movimiento B1/);
  assert.equal(c.get("B3").confianza, "media"); // no es el 0,6% de nada: se clasifica pero sin respaldo
});

// ---------------------------------------------------------------- lado libros
test("parseLedgerCsv — mayor de ejemplo: columnas, apertura, cierre y control", () => {
  const m = mayor();
  assert.equal(m.movs.length, 12);
  assert.equal(m.apertura, APERTURA);
  assert.equal(m.cierre, 17_004_25);
  assert.equal(m.control.ok, true);
  assert.deepEqual(m.control.filasConError, []);
  const ch = m.movs.find((x) => x.entidades.cheque);
  assert.equal(ch.entidades.cheque, "4521");
  assert.equal(ch.cents, -3_000_00);                  // Haber = sale plata
  assert.equal(ch.evidencia.row, 12);
});

test("parseLedgerCsv — detecta saldo corrido mal cargado", () => {
  const csv = "Fecha;Concepto;Debe;Haber;Saldo\n;Saldo inicial;;;1000,00\n01/06/2026;A;100,00;;1100,00\n02/06/2026;B;;50,00;1060,00\n";
  const m = parseLedgerCsv(csv);
  assert.equal(m.control.ok, false);
  assert.deepEqual(m.control.filasConError, [4]);
});

// ---------------------------------------------------------------- emparejamiento
test("subsetSums — encuentra la combinación exacta", () => {
  const items = [700000, 500000, 850000, 250000].map((c, i) => ({ id: "x" + i, cents: c }));
  const sols = subsetSums(items, 1200000, 4, 3);
  assert.deepEqual(sols.map((s) => s.map((x) => x.cents).sort()), [[500000, 700000]]);
});

test("matchAll — importes repetidos NUNCA quedan en verde", () => {
  const cfg = resolveConfig();
  const r = matchAll(
    [B("B1", "2026-06-03", 500000), B("B2", "2026-06-04", 500000)],
    [L("L1", "2026-06-03", 500000), L("L2", "2026-06-04", 500000)], cfg);
  assert.equal(r.matches.length, 2);
  assert.ok(r.matches.every((m) => m.certeza === "amarillo"));
  // y elige por cercanía de fecha
  assert.deepEqual(r.matches.map((m) => [m.banco[0], m.libros[0]]).sort(), [["B1", "L1"], ["B2", "L2"]]);
  // modo deportivo: el usuario acepta que los intercambiables vayan a verde
  const r2 = matchAll([B("B1", "2026-06-03", 500000), B("B2", "2026-06-04", 500000)],
    [L("L1", "2026-06-03", 500000), L("L2", "2026-06-04", 500000)], resolveConfig({ match: { intercambiablesVerde: true } }));
  assert.ok(r2.matches.every((m) => m.certeza === "verde"));
});

test("matchAll — fuera de la ventana de fechas no empareja", () => {
  const r = matchAll([B("B1", "2026-06-20", 100000)], [L("L1", "2026-06-01", 100000)], resolveConfig());
  assert.equal(r.matches.length, 0);
  const r2 = matchAll([B("B1", "2026-06-20", 100000)], [L("L1", "2026-06-01", 100000)], resolveConfig({ match: { ventanaDias: { despues: 30 } } }));
  assert.equal(r2.matches.length, 1);
});

test("matchAll — referencia de cheque con fecha lejana: verde", () => {
  const r = matchAll([B("B1", "2026-07-15", -300000, "CHEQUE 4521 CAMARA")], [L("L1", "2026-06-26", -300000, "Cheque emitido Nro 00004521")], resolveConfig());
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].estrategia, "referencia");
  assert.equal(r.matches[0].certeza, "verde");
});

test("matchAll — tolerancia: empareja con diferencia explícita y en amarillo", () => {
  const cfg = resolveConfig({ match: { toleranciaCents: 100 } });
  const r = matchAll([B("B1", "2026-06-05", -114500)], [L("L1", "2026-06-05", -114550)], cfg);
  assert.equal(r.matches[0].estrategia, "tolerancia");
  assert.equal(r.matches[0].certeza, "amarillo");
  assert.equal(r.matches[0].diferenciaCents, -50);
  // sin tolerancia configurada no empareja
  assert.equal(matchAll([B("B1", "2026-06-05", -114500)], [L("L1", "2026-06-05", -114550)], resolveConfig()).matches.length, 0);
});

// ---------------------------------------------------------------- conciliación integral
test("reconcile — caso de ejemplo completo: cierra al centavo y explica cada partida", () => {
  const cfg = resolveConfig();
  const m = mayor();
  const rec = reconcile({ banco: banco(), libros: m.movs, saldos: { bancoApertura: APERTURA, bancoCierre: cierreBanco(), librosApertura: m.apertura, librosCierre: m.cierre }, periodo: JUNIO, cfg });

  assert.equal(rec.diferenciaNoExplicada, 0);
  assert.equal(rec.apertura.ok, true);

  // Verdes: los 1:1 sin ambigüedad (incluida la factura por referencia).
  const verdes = rec.matches.filter((x) => x.certeza === "verde");
  assert.equal(verdes.length, 8);
  const fac = rec.matches.find((x) => x.banco.includes("B12"));
  assert.equal(fac.estrategia, "referencia");

  // El depósito de $12.000 = dos cobranzas del libro (7.000 + 5.000): agrupado, amarillo.
  const dep = rec.matches.find((x) => x.banco.includes("B4"));
  assert.equal(dep.estrategia, "agrupado");
  assert.equal(dep.certeza, "amarillo");
  assert.equal(dep.libros.length, 2);

  const tipo = (id) => rec.pendientes.find((p) => p.id === id)?.tipo;
  assert.equal(tipo("B5"), "ajuste_bancario");          // comisión
  assert.equal(tipo("B6"), "ajuste_bancario");          // ley 25.413
  assert.equal(tipo("B9"), "ajuste_bancario");          // intereses
  assert.equal(tipo("B13"), "ajuste_bancario");         // percepción IIBB
  assert.equal(tipo("B7"), "credito_no_identificado");  // honorarios que el cliente no registró
  const ch = rec.pendientes.find((p) => p.tipo === "cheque_pendiente");
  assert.equal(ch.certeza, "verde");
  assert.equal(ch.antiguedadDias, 4);
  assert.ok(rec.pendientes.find((p) => p.tipo === "deposito_transito"));

  // Estado global: rojo, porque hay un crédito sin identificar (hay que pedírselo al cliente).
  assert.equal(rec.resumen.estado, "rojo");
  assert.equal(rec.bandeja[0].clave, "creditos_no_identificados");
  assert.equal(rec.bandeja[0].accion, "pedir_al_cliente");
  assert.equal(rec.bandeja[0].totalCents, 4_300_00);

  // Asiento del impuesto ley 25.413: 33% pago a cuenta + 67% gasto, contra Banco.
  const a = rec.ajustes.find((x) => x.tipo === "impuesto_25413");
  assert.deepEqual(a.lineas.map((l) => [l.debe, l.haber]), [[19_40, 0], [39_40, 0], [0, 58_80]]);
  const pyme = reconcile({ banco: banco(), libros: m.movs, saldos: { bancoCierre: cierreBanco(), librosCierre: m.cierre }, periodo: JUNIO, cfg: resolveConfig({ cliente: { pagoACuenta25413: 100 } }) });
  assert.deepEqual(pyme.ajustes.find((x) => x.tipo === "impuesto_25413").lineas.map((l) => [l.debe, l.haber]), [[58_80, 0], [0, 58_80]]);
  // Todo asiento balancea.
  for (const x of rec.ajustes) assert.equal(x.lineas.reduce((s, l) => s + l.debe - l.haber, 0), 0);

  // Papel de trabajo: el saldo conciliado del banco y de libros coincide.
  const p = papelSaldoASaldo(rec, { cliente: "Cliente de ejemplo", banco: "Banco Río", cuenta: "CC $" });
  assert.equal(p.saldoConciliado.bancoAjustadoCents, p.saldoConciliado.librosAjustadoCents);
  assert.equal(p.diferenciaNoExplicadaCents, 0);
  const md = papelToMarkdown(p);
  assert.match(md, /Diferencia no explicada\*\* \| \*\*0,00\*\* ✅/);
  assert.match(papelToCsv(p), /^﻿Sección;Fecha/);
  assert.match(asientosToCsv(rec.ajustes), /Impuesto ley 25\.413 - pago a cuenta Ganancias;19,40/);
});

test("reconcile — si el extractor pierde una fila, la diferencia no explicada lo delata", () => {
  const m = mayor();
  const incompleto = banco().filter((x) => x.id !== "B3"); // se "perdió" el débito automático
  const rec = reconcile({ banco: incompleto, libros: m.movs, saldos: { bancoCierre: cierreBanco(), librosCierre: m.cierre }, periodo: JUNIO, cfg: resolveConfig() });
  assert.notEqual(rec.diferenciaNoExplicada, 0);
  assert.equal(rec.resumen.estado, "rojo");
  assert.equal(rec.bandeja[0].clave, "diferencia_no_explicada");
});

test("reconcile — arrastre: el cheque pendiente de junio se debita en julio", () => {
  const cfg = resolveConfig();
  const m = mayor();
  const junio = reconcile({ banco: banco(), libros: m.movs, saldos: { bancoApertura: APERTURA, bancoCierre: cierreBanco(), librosApertura: m.apertura, librosCierre: m.cierre }, periodo: JUNIO, cfg });
  const aceptados = junio.pendientes.filter((p) => p.tipo === "ajuste_bancario").map((p) => p.id);
  const arrastre = arrastreSiguiente(junio, aceptados).map((x) => ({ ...x, id: "J-" + x.id }));
  // Pasan: cheque pendiente, depósito en tránsito y el crédito sin identificar.
  assert.equal(arrastre.length, 3);

  // Julio: en libros se registran los ajustes de junio y la cobranza identificada; el banco
  // debita el cheque y acredita el depósito.
  const ajustesJunio = junio.ajustes.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === cfg.cuentas.banco).reduce((t, l) => t + l.debe - l.haber, 0), 0);
  const librosApJul = m.cierre + ajustesJunio;
  const bJul = [B("B1", "2026-07-02", 250000, "DEPOSITO CHEQUES"), B("B2", "2026-07-08", -300000, "CHEQUE 4521 CAMARA")];
  const lJul = [L("L1", "2026-07-01", 430000, "Honorarios cobrados en junio (identificado por el cliente)")];
  const recJul = reconcile({
    banco: bJul, libros: lJul, arrastre,
    saldos: { bancoApertura: cierreBanco(), bancoCierre: cierreBanco() + 250000 - 300000, librosApertura: librosApJul, librosCierre: librosApJul + 430000 },
    periodo: { desde: "2026-07-01", hasta: "2026-07-31" }, cfg,
  });
  assert.equal(recJul.apertura.ok, true, JSON.stringify(recJul.apertura));
  assert.equal(recJul.diferenciaNoExplicada, 0);
  assert.equal(recJul.pendientes.length, 0, JSON.stringify(recJul.pendientes));
  const chq = recJul.matches.find((x) => x.banco.includes("B2"));
  assert.equal(chq.estrategia, "referencia");
});

test("continuidad — detecta el extracto faltante", () => {
  const r = continuidad([
    { id: "abr", desde: "2026-04-01", hasta: "2026-04-30", apertura: 100, cierre: 200 },
    { id: "jun", desde: "2026-06-01", hasta: "2026-06-30", apertura: 350, cierre: 400 },
    { id: "may", desde: "2026-05-01", hasta: "2026-05-31", apertura: 200, cierre: 300 },
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problemas.map((p) => [p.entre.join(">"), p.tipo]), [["may>jun", "saldo"]]);
});

test("fromExtract — convierte el resultado del extractor (débito/crédito → signo, evidencia)", () => {
  const columns = [{ role: "fecha", label: "Fecha" }, { role: "descripcion", label: "Desc" }, { role: "debito", label: "Débito" }, { role: "credito", label: "Crédito" }, { role: "saldo", label: "Saldo" }];
  const seg = { columns, opening: 1000, closing: 1450.5, movements: [
    { fecha: "02/06/2026", descripcion: "DEP", amounts: { "Débito": null, "Crédito": 500 }, saldo: 1500, _page: 1, _y: 0.3 },
    { fecha: "03/06/2026", descripcion: "COM", amounts: { "Débito": 49.5, "Crédito": null }, saldo: 1450.5, _page: 2, _y: 0.1 },
  ] };
  const r = fromExtract(seg, { doc: "x.pdf" });
  assert.deepEqual(r.movs.map((x) => [x.id, x.fecha, x.cents]), [["B1", "2026-06-02", 50000], ["B2", "2026-06-03", -4950]]);
  assert.deepEqual(r.movs[1].evidencia, { doc: "x.pdf", page: 2, y: 0.1 });
  assert.equal(r.apertura, 100000);
  assert.equal(r.cierre, 145050);
});
