// Liquidaciones de tarjetas: se leen de la planilla de la procesadora, cada una se verifica con su
// regla (bruto − descuentos = neto) y explican los créditos del banco que el libro no tiene.
import test from "node:test";
import assert from "node:assert/strict";
import { leerLiquidaciones, clasificarPlanilla, reconcile, makeMov, resolveConfig } from "../src/core/index.js";

const ENC = ["Fecha de pago", "Nro. liquidación", "Tarjeta", "Ventas brutas", "Arancel", "IVA arancel", "Costo financiero", "Retención IIBB", "Retención IVA", "Neto a cobrar"];
const filas = [
  ["Liquidaciones Payway - junio 2026"], [],
  ENC,
  ["03/06/2026", "100234", "VISA", "100.000,00", "1.800,00", "378,00", "", "1.500,00", "", "96.322,00"],
  ["10/06/2026", "100301", "MASTERCARD", "50.000,00", "900,00", "189,00", "2.000,00", "750,00", "", "46.161,00"],
  ["10/06/2026", "100302", "MASTERCARD", "20.000,00", "360,00", "75,60", "", "300,00", "", "19.264,40"],
];

test("planilla de liquidaciones: se reconoce, se lee y cada liquidación se verifica", () => {
  assert.deepEqual(clasificarPlanilla(filas), { tipo: "liquidacion", seguro: true });
  const r = leerLiquidaciones(filas, { doc: "payway.xlsx" });
  assert.equal(r.liquidaciones.length, 3);
  const v = r.liquidaciones[0];
  assert.deepEqual([v.marca, v.numero, v.fechaPago, v.bruto, v.neto, v.verificada], ["VISA", "100234", "2026-06-03", 10000000, 9632200, true]);
  assert.deepEqual(v.descuentos, { arancel: 180000, ivaArancel: 37800, retIIBB: 150000 });
  assert.equal(r.control.ok, true);
  // Una liquidación que no cierra queda marcada.
  const mal = filas.map((f) => [...f]); mal[3][9] = "96.000,00";
  const r2 = leerLiquidaciones(mal);
  assert.equal(r2.control.ok, false);
  assert.equal(r2.liquidaciones[0].verificada, false);
});

test("por cupón: los cupones de una misma liquidación se suman", () => {
  const cupones = [["Fecha de pago", "Liquidación", "Bruto", "Arancel", "Neto"], ["15/06/2026", "777", "1.000,00", "20,00", "980,00"], ["15/06/2026", "777", "2.000,00", "40,00", "1.960,00"], ["16/06/2026", "778", "500,00", "10,00", "490,00"]];
  const r = leerLiquidaciones(cupones);
  assert.deepEqual(r.liquidaciones.map((l) => [l.numero, l.bruto, l.neto]), [["777", 300000, 294000], ["778", 50000, 49000]]);
});

const cfg = resolveConfig();
const B = (id, fecha, cents, descripcion) => makeMov({ id, lado: "banco", fecha, cents, descripcion });
const L = (id, fecha, cents, descripcion) => makeMov({ id, lado: "libros", fecha, cents, descripcion });
const conciliar = (banco, libros, liquidaciones) => {
  const sb = banco.reduce((s, m) => s + m.cents, 0), sl = libros.reduce((s, m) => s + m.cents, 0);
  return reconcile({ banco, libros, liquidaciones, cfg, periodo: { desde: "2026-06-01", hasta: "2026-06-30" }, saldos: { bancoApertura: 0, bancoCierre: sb, librosApertura: 0, librosCierre: sl }, lectura: { banco: true, libros: true } });
};
const balancea = (a) => a.lineas.reduce((s, l) => s + l.debe - l.haber, 0) === 0;

test("acreditación sin la venta en el libro: queda explicada y sale el asiento completo", () => {
  const { liquidaciones } = leerLiquidaciones(filas);
  const rec = conciliar([B("B1", "2026-06-04", 9632200, "ACRED LIQ VISA 100234")], [], liquidaciones);
  const p = rec.pendientes.find((x) => x.id === "B1");
  assert.equal(p.tipo, "liquidacion_tarjeta");
  assert.equal(p.certeza, "verde");
  assert.match(p.motivo, /ventas 100\.000,00 − descuentos 3\.678,00 = neto 96\.322,00/);
  const a = rec.ajustes.find((x) => x.tipo === "liquidacion_tarjeta");
  assert.ok(balancea(a));
  assert.deepEqual(a.lineas.map((l) => [l.cuenta, l.debe, l.haber]), [
    [cfg.cuentas.banco, 9632200, 0], [cfg.cuentas.arancelesTarjeta, 180000, 0], [cfg.cuentas.ivaCreditoFiscal, 37800, 0],
    [cfg.cuentas.retencionIIBBTarjetas, 150000, 0], [cfg.cuentas.tarjetasACobrar, 0, 10000000]]);
  assert.equal(rec.diferenciaNoExplicada, 0);
  assert.ok(!rec.pendientes.some((x) => x.tipo === "credito_no_identificado"));
  assert.ok(rec.bandeja.some((t) => t.clave === "liquidaciones_tarjeta"));
});

test("dos liquidaciones pagadas el mismo día en un solo crédito", () => {
  const { liquidaciones } = leerLiquidaciones(filas);
  const rec = conciliar([B("B1", "2026-06-11", 4616100 + 1926440, "ACREDITACION MASTERCARD")], [], liquidaciones);
  const p = rec.pendientes.find((x) => x.id === "B1");
  assert.equal(p.tipo, "liquidacion_tarjeta");
  assert.equal(p.liquidaciones.length, 2);
  const a = rec.ajustes.find((x) => x.tipo === "liquidacion_tarjeta");
  assert.ok(balancea(a));
  assert.equal(a.lineas.find((l) => l.cuenta === cfg.cuentas.interesesPagados).debe, 200000); // costo financiero
  assert.equal(a.lineas.at(-1).haber, 7000000);
});

test("la venta bruta ya está en el libro del banco: se emparejan y solo se asientan los descuentos", () => {
  const { liquidaciones } = leerLiquidaciones(filas);
  const rec = conciliar([B("B1", "2026-06-04", 9632200, "ACRED LIQ VISA")], [L("L1", "2026-06-02", 10000000, "Ventas con Visa semana 1")], liquidaciones);
  const m = rec.matches.find((x) => x.estrategia === "liquidacion");
  assert.deepEqual([m.banco, m.libros, m.diferenciaCents, m.certeza], [["B1"], ["L1"], 367800, "verde"]);
  const a = rec.ajustes.find((x) => x.tipo === "liquidacion_tarjeta");
  assert.ok(balancea(a));
  assert.deepEqual(a.lineas.at(-1), { cuenta: cfg.cuentas.banco, debe: 0, haber: 367800 });
  assert.ok(!a.lineas.some((l) => l.cuenta === cfg.cuentas.tarjetasACobrar));
  assert.equal(rec.diferenciaNoExplicada, 0);
});

test("si el banco dice otra tarjeta, queda para revisar; sin liquidación, sigue sin identificar", () => {
  const { liquidaciones } = leerLiquidaciones(filas);
  const rec = conciliar([B("B1", "2026-06-04", 9632200, "ACRED MASTERCARD")], [], liquidaciones);
  assert.equal(rec.pendientes.find((x) => x.id === "B1").certeza, "amarillo");
  const sin = conciliar([B("B1", "2026-06-04", 9632200, "ACRED LIQ VISA")], [], []);
  assert.equal(sin.pendientes.find((x) => x.id === "B1").tipo, "credito_no_identificado");
  // Fuera de la ventana de fechas no se usa.
  const lejos = conciliar([B("B1", "2026-06-20", 9632200, "ACRED LIQ VISA")], [], liquidaciones);
  assert.notEqual(lejos.pendientes.find((x) => x.id === "B1").tipo, "liquidacion_tarjeta");
});
