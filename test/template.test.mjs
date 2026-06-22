// Tests de formateo y export (CSV). Runner: `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { formatAmount, formatAmountPattern, rowsToCsv } from "../src/template.js";

test("formatAmount — es-AR con miles y signo", () => {
  assert.equal(formatAmount(1234.5, { decimal: ",", thousands: true }), "1.234,50");
  assert.equal(formatAmount(-50, { decimal: ",", thousands: true, sign: "paren" }), "(50,00)");
  assert.equal(formatAmount(-50, { decimal: ",", thousands: true, sign: "trailing" }), "50,00-");
  assert.equal(formatAmount(1234.5, { decimal: ",", thousands: true, currency: true }), "$ 1.234,50");
  assert.equal(formatAmount(null, { decimal: "," }), "");
});

test("formatAmountPattern — patrón estilo Excel", () => {
  assert.equal(formatAmountPattern(1234.56, "#.##0,00"), "1.234,56");
  assert.equal(formatAmountPattern(-1234.56, "#.##0,00;(#.##0,00)"), "(1.234,56)");
  assert.equal(formatAmountPattern(-1234.56, "#.##0,00"), "-1.234,56");
  assert.equal(formatAmountPattern(1234.56, "#,##0.00"), "1,234.56"); // yanqui
});

test("rowsToCsv — header + fila con importes formateados", () => {
  const cols = [
    { role: "fecha", label: "Fecha" },
    { role: "descripcion", label: "Desc" },
    { role: "importe", label: "Importe" },
    { role: "saldo", label: "Saldo" },
  ];
  const movements = [
    { fecha: "01/06/2026", descripcion: "Pago", amounts: { Importe: 500 }, saldo: 1500, cells: {} },
  ];
  const csv = rowsToCsv(movements, cols, [], [], { bom: false, sep: "," });
  assert.ok(csv.startsWith("Fecha,Desc,Importe,Saldo\n"), "header esperado");
  assert.ok(csv.includes("Pago"), "descripción presente");
  assert.ok(csv.includes("500,00"), "importe formateado es-AR");
  assert.ok(csv.includes("1.500,00"), "saldo formateado con miles");
});

test("rowsToCsv — escapa celdas con el separador", () => {
  const cols = [{ role: "descripcion", label: "Desc" }];
  const movements = [{ descripcion: "Pago, con coma", amounts: {}, cells: {} }];
  const csv = rowsToCsv(movements, cols, [], [], { bom: false, sep: "," });
  assert.ok(csv.includes('"Pago, con coma"'), "celda con coma va entre comillas");
});
