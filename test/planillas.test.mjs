// Planillas: Excel (.xlsx) sin dependencias, extractos bancarios en planilla, reporte de Mercado
// Pago, y cómo se decide qué es cada planilla (Débito/Crédito significa cosas opuestas en un
// extracto y en un mayor).
import test from "node:test";
import assert from "node:assert/strict";
import { escribirXlsx } from "../tools/dataset/xlsx-escribir.mjs";
import { leerXlsx, clasificarPlanilla, leerExtractoPlanilla, leerMercadoPago, parseLedgerRows, classify } from "../src/core/index.js";

test("xlsx: texto, números (sin perder decimales) y fechas reales de Excel", async () => {
  const buf = escribirXlsx([{ nombre: "Hoja1", filas: [["Fecha", "Detalle", "Importe"], [{ fecha: "2026-06-02" }, "Cobro <A&B>", 1234.5], [{ fecha: "2026-06-30" }, "Pago", -0.1 - 0.2]] }]);
  const { hojas } = await leerXlsx(buf);
  assert.deepEqual(hojas[0].rows, [["Fecha", "Detalle", "Importe"], ["02/06/2026", "Cobro <A&B>", "1234.5"], ["30/06/2026", "Pago", "-0.3"]]);
  await assert.rejects(leerXlsx(Buffer.from("no soy un zip")), /xlsx/);
});

const filasBanco = [
  ["Banco del Río S.A. - Resumen de cuenta corriente"], [],
  ["Fecha", "Concepto", "Débito", "Crédito", "Saldo"],
  [{ fecha: "2026-06-01" }, "SALDO ANTERIOR", null, null, 10000],
  [{ fecha: "2026-06-02" }, "TRANSF RECIBIDA JUAN PEREZ", null, 1500.25, 11500.25],
  [{ fecha: "2026-06-03" }, "IMP LEY 25413 DEB", 9, null, 11491.25],
];

test("extracto en planilla: Crédito entra, Débito sale, y verifica los saldos", async () => {
  const { hojas } = await leerXlsx(escribirXlsx([{ nombre: "Movimientos", filas: filasBanco }]));
  const rows = hojas[0].rows;
  assert.deepEqual(clasificarPlanilla(rows), { tipo: "extracto", seguro: true });
  const x = leerExtractoPlanilla(rows, { doc: "banco.xlsx" });
  assert.equal(x.apertura, 1000000);
  assert.deepEqual(x.movs.map((m) => [m.lado, m.fecha, m.cents]), [["banco", "2026-06-02", 150025], ["banco", "2026-06-03", -900]]);
  assert.equal(x.control.ok, true);
  assert.equal(x.cierre, 1149125);
  assert.equal(x.movs[0].evidencia.row, 5);
});

test("qué es cada planilla: mayor con Debe/Haber o asiento; ambigua si solo dice Débito/Crédito", async () => {
  const mayor = [["Mayor de la cuenta 1.1.2 Banco del Río"], ["Fecha", "Asiento", "Concepto", "Debe", "Haber", "Saldo"]];
  assert.deepEqual(clasificarPlanilla(mayor), { tipo: "mayor", seguro: true });
  const ambigua = [["Fecha", "Detalle", "Débitos", "Créditos", "Saldo"], ["02/06/2026", "x", "", "10", "10"]];
  assert.deepEqual(clasificarPlanilla(ambigua), { tipo: "mayor", seguro: false });
  assert.equal(clasificarPlanilla([["hola"], ["chau"]]).tipo, null);
  // Con saldo anterior, la regla del saldo decide: leída como mayor no cierra, como extracto sí.
  const conSaldo = [["Fecha", "Detalle", "Débitos", "Créditos", "Saldo"], ["01/06/2026", "SALDO ANTERIOR", "", "", "1.000,00"], ["02/06/2026", "TRANSFERENCIA", "", "500,00", "1.500,00"], ["03/06/2026", "COMISION", "50,00", "", "1.450,00"]];
  assert.deepEqual(clasificarPlanilla(conSaldo), { tipo: "extracto", seguro: true, por: "saldo" });
  // Y al revés: un mayor con Débitos = Debe.
  const mayorDC = [["Fecha", "Detalle", "Débitos", "Créditos", "Saldo"], ["01/06/2026", "SALDO ANTERIOR", "", "", "1.000,00"], ["02/06/2026", "COBRANZA", "500,00", "", "1.500,00"]];
  assert.deepEqual(clasificarPlanilla(mayorDC), { tipo: "mayor", seguro: true, por: "saldo" });
  // La misma planilla leída como mayor: Débitos = Debe (entra), al revés que en el banco.
  assert.equal(parseLedgerRows(ambigua).movs[0].cents, -1000);
  assert.equal(leerExtractoPlanilla(ambigua).movs[0].cents, 1000);
});

const filasMP = [
  ["DATE", "SOURCE_ID", "EXTERNAL_REFERENCE", "RECORD_TYPE", "DESCRIPTION", "NET_CREDIT_AMOUNT", "NET_DEBIT_AMOUNT", "GROSS_AMOUNT", "MP_FEE_AMOUNT", "TAXES_AMOUNT", "PAYMENT_METHOD", "BALANCE_AMOUNT"],
  ["2026-06-01T00:00:00.000-03:00", "", "", "initial_available_balance", "", 2000, 0, "", "", "", "", 2000],
  ["2026-06-03T10:15:00.000-03:00", "111222333", "PEDIDO-77", "release", "payment", 940.5, 0, 1000, 44.5, 15, "visa", 2940.5],
  ["2026-06-03T10:15:00.000-03:00", "111222334", "", "release", "tax_payment_iibb", 0, 15, "", "", "", "account_money", 2925.5],
  ["2026-06-05T09:00:00.000-03:00", "pre_payout_9", "", "available_balance", "", 2925.5, 0, "", "", "", "", ""],
  ["2026-06-05T09:00:00.000-03:00", "999", "", "release", "payout", 0, 2000, "", "", "", "", 925.5],
  ["", "", "", "total", "", 940.5, 2015, "", "", "", "", ""],
];

test("Mercado Pago: saldo inicial, neto por operación, códigos en castellano y control del total", async () => {
  const { hojas } = await leerXlsx(escribirXlsx([{ nombre: "release", filas: filasMP }]));
  const rows = hojas[0].rows;
  assert.deepEqual(clasificarPlanilla(rows), { tipo: "mercadopago", seguro: true });
  const r = leerMercadoPago(rows, { doc: "mp.xlsx" });
  assert.equal(r.banco, "Mercado Pago");
  assert.equal(r.apertura, 200000);
  assert.deepEqual(r.movs.map((m) => m.cents), [94050, -1500, -200000]);
  assert.equal(r.cierre, 92550);
  assert.equal(r.control.ok, true);
  assert.match(r.movs[0].descripcion, /^Cobro \(visa\) ref PEDIDO-77 · bruto 1\.000,00, comisión 44,50, retenciones 15,00$/);
  assert.equal(r.movs[0].referencia, "Op. 111222333");
  assert.match(r.movs[1].descripcion, /Percepción IIBB Buenos Aires/);
  assert.match(r.movs[2].descripcion, /Retiro de dinero/);
  assert.equal(r.movs[0].fecha, "2026-06-03");
  // Un total que no coincide deja la lectura sin verificar.
  const mal = rows.map((f) => [...f]); mal[mal.length - 1][5] = "999";
  assert.equal(leerMercadoPago(mal).control.ok, false);
  // La percepción la reconoce el clasificador de ruido fiscal como cualquier otra.
  assert.ok(classify(r.movs[1]));
});
