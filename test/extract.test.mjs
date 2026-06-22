// Tests del motor de extracción (lógica financiera). Runner: `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, setAmountMode, balanceCheck } from "../src/extract.js";

test("parseAmount — formato es-AR (coma decimal, punto de miles)", () => {
  setAmountMode("auto");
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1.234.567,89"), 1234567.89);
  assert.equal(parseAmount("$ 8.573,40"), 8573.4);
  assert.equal(parseAmount("0,00"), 0);
});

test("parseAmount — formato yanqui (punto decimal, coma de miles)", () => {
  setAmountMode("auto");
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("8,573.40"), 8573.4);
});

test("parseAmount — negativos: menos adelante/atrás y paréntesis contables", () => {
  setAmountMode("auto");
  assert.equal(parseAmount("-1.234,56"), -1234.56);
  assert.equal(parseAmount("52.000,00-"), -52000);
  assert.equal(parseAmount("(1.234,56)"), -1234.56);
});

test("parseAmount — basura y enteros sin decimales NO son plata", () => {
  setAmountMode("auto");
  assert.equal(parseAmount("texto"), null);
  assert.equal(parseAmount("12345"), null);   // sin separador decimal de 2 dígitos
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount("CUIT 20-12345678-3"), null);
});

test("parseAmount — modo forzado es-AR ignora el punto como decimal", () => {
  setAmountMode("es-AR");
  assert.equal(parseAmount("1.234,56"), 1234.56);
  setAmountMode("auto"); // restaurar para los demás tests
});

// --- balanceCheck (la regla del saldo) ---
const COLS = [
  { role: "fecha", label: "Fecha" },
  { role: "importe", label: "Importe" },
  { role: "saldo", label: "Saldo" },
];
const mov = (imp, saldo) => ({ amounts: { Importe: imp }, saldo, descripcion: "", cells: {} });

test("balanceCheck — cierra global y fila a fila", () => {
  const r = { columns: COLS, opening: 1000, closing: 1300,
    movements: [mov(500, 1500), mov(-200, 1300)] };
  const b = balanceCheck(r);
  assert.equal(b.globalOk, true);
  assert.equal(b.computed, 1300);
  assert.equal(b.rowOk, true);
  assert.deepEqual(b.rowMismatches, []);
});

test("balanceCheck — NO cierra global", () => {
  const r = { columns: COLS, opening: 1000, closing: 9999,
    movements: [mov(500, 1500), mov(-200, 1300)] };
  assert.equal(balanceCheck(r).globalOk, false);
});

test("balanceCheck — detecta la fila que rompe el saldo corrido", () => {
  const r = { columns: COLS, opening: 1000, closing: 1300,
    movements: [mov(500, 1500), mov(-200, 1250)] }; // saldo mal en la fila 1
  const b = balanceCheck(r);
  assert.equal(b.rowOk, false);
  assert.deepEqual(b.rowMismatches, [1]);
});

test("balanceCheck — sin columna de saldo, rowOk queda null (estilo Credicoop)", () => {
  const cols = [{ role: "importe", label: "Importe" }];
  const m = (imp) => ({ amounts: { Importe: imp }, saldo: null, cells: {} });
  const r = { columns: cols, opening: 0, closing: 300, movements: [m(100), m(200)] };
  const b = balanceCheck(r);
  assert.equal(b.globalOk, true);
  assert.equal(b.rowOk, null);
});
