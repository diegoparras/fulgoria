// Asientos para importar en cada sistema contable, con los formatos de su documentación oficial:
// Xubio (planilla modelo "ej_impo_asiento_contable_manual") y Holistor ("Importación de datos de
// Otros Sistemas – Requisitos", archivo único de movimientos con Debe y Haber separados).
import test from "node:test";
import assert from "node:assert/strict";
import { asientosXubio, asientosHolistor, partirCuenta, aLatin1, escribirXlsx, leerXlsx } from "../src/core/index.js";

const ajustes = [
  { id: "A1", fecha: "2026-06-05", concepto: "Impuesto ley 25.413 del mes", origen: ["B3", "B4"], lineas: [
    { cuenta: "5.2.01 Impuesto a los débitos y créditos bancarios", debe: 1650, haber: 0 },
    { cuenta: "1.1.2.01 Banco Río cuenta corriente", debe: 0, haber: 1650 } ] },
  { id: "A2", fecha: "2026-06-05", concepto: "Comisión de mantenimiento", origen: ["B5"], lineas: [
    { cuenta: "5.2.02 Gastos bancarios", debe: 450000, haber: 0 },
    { cuenta: "1.1.2.01 Banco Río cuenta corriente", debe: 0, haber: 450000 } ] },
  { id: "A3", fecha: "2026-06-30", concepto: "Intereses", origen: ["B9"], lineas: [
    { cuenta: "Banco Río cuenta corriente", debe: 11200, haber: 0 },
    { cuenta: "Intereses ganados", debe: 0, haber: 11200 } ] },
];

test("cuenta: \"código nombre\" sirve para los dos sistemas", () => {
  assert.deepEqual(partirCuenta("1.1.2.01 Banco Río"), { codigo: "1.1.2.01", nombre: "Banco Río" });
  assert.deepEqual(partirCuenta("1.1.2.01 - Banco Río"), { codigo: "1.1.2.01", nombre: "Banco Río" });
  assert.deepEqual(partirCuenta("Impuesto ley 25.413 - pago a cuenta"), { codigo: null, nombre: "Impuesto ley 25.413 - pago a cuenta" });
  assert.deepEqual(partirCuenta("110201"), { codigo: "110201", nombre: "110201" });
});

test("Xubio: las columnas del modelo oficial, una fila de cabecera por asiento y las cuentas por nombre", async () => {
  const filas = asientosXubio(ajustes);
  // Encabezados exactamente como en el modelo que publica Xubio.
  assert.deepEqual(filas[0], ["FECHA", "CONCEPTO", "CIRCUITOCONTABLE", "CUENTA", "DEBE", "HABER", "ORGANIZACION", "CENTRODECOSTO", "DESCRIPCION"]);
  const { hojas } = await leerXlsx(escribirXlsx([{ nombre: "Hoja1", filas }]));
  const rows = hojas[0].rows;
  assert.deepEqual(rows[1].slice(0, 3), ["05/06/2026", "Impuesto ley 25.413 del mes", "default"]);
  assert.deepEqual(rows[2].slice(0, 6), ["", "", "", "Impuesto a los débitos y créditos bancarios", "16.5", ""]);
  assert.deepEqual(rows[3].slice(3, 6), ["Banco Río cuenta corriente", "", "16.5"]);
  assert.equal(rows.length, 1 + 3 + 6);
  // Cada asiento balancea.
  for (const a of ajustes) assert.equal(a.lineas.reduce((s, l) => s + l.debe - l.haber, 0), 0);
});

test("Holistor: TXT de movimientos con fecha, número de asiento por fecha, código, debe y haber con coma", () => {
  const { texto, sinCodigo } = asientosHolistor(ajustes);
  const lineas = texto.trimEnd().split("\r\n").map((l) => l.split("\t"));
  assert.deepEqual(lineas[0], ["05/06/2026", "0001", "5.2.01", "16,50", "0,00", "Impuesto ley 25.413 del mes", "B3 B4"]);
  assert.deepEqual(lineas[1], ["05/06/2026", "0001", "1.1.2.01", "0,00", "16,50", "Impuesto ley 25.413 del mes", "B3 B4"]);
  assert.deepEqual(lineas[2].slice(0, 5), ["05/06/2026", "0002", "5.2.02", "4500,00", "0,00"]); // segundo asiento del mismo día
  assert.deepEqual(lineas[4].slice(0, 2), ["30/06/2026", "0001"]); // la numeración vuelve a 1 con otra fecha
  assert.deepEqual(sinCodigo, ["Banco Río cuenta corriente", "Intereses ganados"]);
  // Latin-1: "é" es un byte (0xE9), no dos.
  const b = aLatin1("débitos");
  assert.equal(b.length, 7); assert.equal(b[1], 0xe9);
});
