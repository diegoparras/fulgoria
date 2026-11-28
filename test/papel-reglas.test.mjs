// Papel de trabajo en PDF y Excel, y reglas de clasificación del estudio ("enseñar").
import test from "node:test";
import assert from "node:assert/strict";
import { reconcile, makeMov, resolveConfig, papelSaldoASaldo, papelToPdf, papelToHojas, escribirXlsx, leerXlsx, reglaDesdeTexto, textoSugerido, classify, anchoTexto, renglones } from "../src/core/index.js";

const cfg = resolveConfig();
const B = (id, fecha, cents, descripcion) => makeMov({ id, lado: "banco", fecha, cents, descripcion, evidencia: { doc: "extracto.pdf", page: 1 } });
const L = (id, fecha, cents, descripcion) => makeMov({ id, lado: "libros", fecha, cents, descripcion, evidencia: { doc: "mayor.xlsx", row: 3 } });
const conciliar = (banco, libros, reglas = []) => {
  const sb = banco.reduce((s, m) => s + m.cents, 0), sl = libros.reduce((s, m) => s + m.cents, 0);
  return reconcile({ banco, libros, reglas, cfg, periodo: { desde: "2026-06-01", hasta: "2026-06-30" }, saldos: { bancoApertura: 0, bancoCierre: sb, librosApertura: 0, librosCierre: sl }, lectura: { banco: true, libros: true } });
};

test("reglas del estudio: antes que las de fábrica, por signo, a una cuenta propia", () => {
  assert.equal(textoSugerido("DEB. AUT. SEGURO LA CAJA 3071234 CUIT 30-71234567-1"), "DEB AUT SEGURO LA");
  const seguro = B("B1", "2026-06-10", -1250000, "DB AUT SEGURO LA CAJA POLIZA 778");
  // De fábrica, "SEGURO" es una comisión del banco.
  assert.equal(classify(seguro).tipo, "comision");
  const propia = reglaDesdeTexto({ texto: "DB AUT SEGURO", tipo: "cuenta_propia", signo: -1, cuenta: "5.2.10 Seguros" });
  assert.deepEqual([classify(seguro, [propia]).tipo, classify(seguro, [propia]).cuenta], ["cuenta_propia", "5.2.10 Seguros"]);
  // Solo débitos: un crédito con la misma leyenda no se toca.
  assert.notEqual(classify(B("B2", "2026-06-10", 1250000, "DB AUT SEGURO REINTEGRO"), [propia]).tipo, "cuenta_propia");
  // En la conciliación: queda listo para asentar contra la cuenta propia, con el motivo claro.
  const rec = conciliar([seguro], [], [propia]);
  const p = rec.pendientes.find((x) => x.id === "B1");
  assert.equal(p.tipo, "ajuste_bancario");
  assert.match(p.motivo, /regla del estudio: «DB AUT SEGURO» → 5\.2\.10 Seguros/);
  assert.deepEqual(rec.ajustes[0].lineas.map((l) => [l.cuenta, l.debe, l.haber]), [["5.2.10 Seguros", 1250000, 0], [cfg.cuentas.banco, 0, 1250000]]);
  // "No es del banco": corrige una clasificación de fábrica equivocada y queda para identificar.
  const ident = reglaDesdeTexto({ texto: "DB AUT SEGURO", tipo: "identificar", signo: -1 });
  assert.equal(conciliar([seguro], [], [ident]).pendientes[0].tipo, "debito_no_identificado");
  // Reglas inválidas no se arman; el texto se toma literal (sin regex inyectada).
  assert.equal(reglaDesdeTexto({ texto: "", tipo: "comision" }), null);
  assert.equal(reglaDesdeTexto({ texto: "X", tipo: "inventado" }), null);
  const raro = reglaDesdeTexto({ texto: "PAGO (A+B)*", tipo: "comision" });
  assert.equal(classify(B("B3", "2026-06-01", -100, "PAGO (A+B)* MES"), [raro]).tipo, "comision");
  assert.notEqual(classify(B("B4", "2026-06-01", -100, "PAGO AAAB MES"), [raro]).tipo, "comision");
});

const rec = conciliar(
  [B("B1", "2026-06-02", 18000000, "TRANSF RECIBIDA CONSTRUCTORA SUR"), B("B2", "2026-06-10", -450000, "COMISION MANTENIMIENTO CUENTA")],
  [L("L1", "2026-06-02", 18000000, "Cobranza Constructora Sur"), L("L2", "2026-06-30", 6000000, "Depósito ventas de contado")]);
const papel = papelSaldoASaldo(rec, { banco: "Banco del Río" });
const extra = { cliente: "Ferretería El Tornillo SRL", cuenta: "Cuenta corriente", estado: "Revisado", ajustes: rec.ajustes, preparo: { u: "ana", en: "2026-07-03T14:10:00Z" } };

test("papel de trabajo en PDF: estructura válida y referencias internas correctas", () => {
  const pdf = Buffer.from(papelToPdf(papel, extra));
  const txt = pdf.toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.ok(txt.trimEnd().endsWith("%%EOF"));
  // Cada entrada de la tabla xref apunta al comienzo de su objeto.
  const xref = Number(txt.match(/startxref\n(\d+)/)[1]);
  assert.ok(txt.slice(xref).startsWith("xref"));
  const offs = [...txt.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(txt.slice(o).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`));
  assert.match(txt, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count [1-9]/);
  // El texto va en WinAnsi (hex): "Ferretería" con í = ED.
  assert.ok(txt.includes(Buffer.from("Ferreter").toString("hex") + "ed"));
});

test("medidas de texto: renglones que entran en el ancho", () => {
  assert.equal(anchoTexto("0,00", 10), (556 + 278 + 556 + 556) / 100);
  const ls = renglones("COMISION MANTENIMIENTO CUENTA CORRIENTE PAQUETE EMPRESAS PREMIUM", 120, 9);
  assert.ok(ls.length > 1 && ls.every((l) => anchoTexto(l, 9) <= 120));
});

test("papel de trabajo en Excel: hojas, números, fechas y títulos en negrita", async () => {
  const { hojas } = await leerXlsx(escribirXlsx(papelToHojas(papel, extra)));
  assert.deepEqual(hojas.map((h) => h.nombre), ["Conciliación", "Asientos"]);
  const c = hojas[0];
  const fila = c.rows.findIndex((r) => r[0].startsWith("Saldo según extracto"));
  assert.equal(c.tipos[fila][3], "numero");
  const det = c.rows.findIndex((r) => r[1] === "Depósito ventas de contado");
  assert.equal(c.tipos[det][0], "fecha");
  assert.deepEqual(hojas[1].rows[0], ["Asiento", "Fecha", "Cuenta", "Debe", "Haber", "Concepto"]);
  assert.equal(hojas[1].rows.length, 1 + rec.ajustes.reduce((s, a) => s + a.lineas.length, 0));
});
