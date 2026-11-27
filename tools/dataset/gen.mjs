// Generador del dataset sintético de conciliación bancaria.
//
//   cd tools && npm install
//   node dataset/gen.mjs                 # genera datasets/conciliacion-sintetica/
//   node dataset/gen.mjs --semillas 3    # más variantes por combinación
//
// Determinista: la misma versión del generador y las mismas semillas producen exactamente los
// mismos archivos. Cada caso trae el extracto (PDF), el mayor (CSV), la plantilla de columnas y
// esperado.json con la respuesta correcta.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rng, EMPRESAS, iso, addDays, habil } from "./lib.mjs";
import { Caso, ESCENARIOS, generarEscenario } from "./escenarios.mjs";
import { BANCOS, plantillaColumnas, renderExtracto } from "./bancos.mjs";
import { SISTEMAS } from "./sistemas.mjs";
import { loadPdfNode } from "./pdfnode.mjs";
import { extractAnchors } from "../../src/extract.js";
import { buildTemplate } from "../../src/template.js";
import { makeMov } from "../../src/core/model.js";

const VERSION = "1.0.0";
const args = process.argv.slice(2);
const SEMILLAS = Number(args[args.indexOf("--semillas") + 1]) || 2;
const ROOT = new URL("../../datasets/conciliacion-sintetica/", import.meta.url).pathname;
const CASOS = join(ROOT, "casos");

if (existsSync(CASOS)) rmSync(CASOS, { recursive: true });
mkdirSync(CASOS, { recursive: true });
mkdirSync(join(ROOT, "plantillas"), { recursive: true });

const bancos = Object.keys(BANCOS), sistemas = Object.keys(SISTEMAS), escenarios = Object.keys(ESCENARIOS);
const indice = [];
let n = 0;

// ---------------------------------------------------------------- un caso
function nuevoCaso(semilla, esc) {
  const r = rng(semilla);
  const mes = r.int(1, 10);
  const cliente = { nombre: r.pick(EMPRESAS), imp25413: r.chance(0.6), sircreb: r.chance(0.5) ? r.pick([0.6, 1.2, 2.0, 3.0]) : 0, percepcionIVA: r.chance(0.3) };
  return { r, mes, cliente };
}

/** Ordena por fecha (estable), asigna ids B1../L1.. en orden de documento y traduce la verdad. */
function cerrar(c, prefijoB = "B", prefijoL = "L") {
  const ordB = c.B.map((m, i) => ({ m, i })).sort((a, b) => a.m.fecha.localeCompare(b.m.fecha) || a.i - b.i);
  const ordL = c.L.map((m, i) => ({ m, i })).sort((a, b) => a.m.fecha.localeCompare(b.m.fecha) || a.i - b.i);
  const idB = new Map(ordB.map((x, k) => [x.i, prefijoB + (k + 1)]));
  const idL = new Map(ordL.map((x, k) => [x.i, prefijoL + (k + 1)]));
  const tr = (map) => (x) => (typeof x === "string" ? x : map.get(x));
  return {
    banco: ordB.map(({ m, i }) => ({ id: idB.get(i), fecha: m.fecha, cents: m.cents, descripcion: m.desc.replace(/\n/g, " "), tipo: m.tipo, _desc: m.desc })),
    libros: ordL.map(({ m, i }) => ({ id: idL.get(i), fecha: m.fecha, cents: m.cents, descripcion: m.desc, comprobante: m.comp, asiento: m.asiento })),
    pares: c.pares.map((p) => ({ banco: p.b.map(tr(idB)), libros: p.l.map(tr(idL)), tipo: p.tipo })),
    pendientes: c.pend.map((p) => ({ id: p.lado === "banco" ? tr(idB)(p.i) : tr(idL)(p.i), lado: p.lado, tipo: p.tipo })),
  };
}

const suma = (xs) => xs.reduce((s, x) => s + x.cents, 0);

async function escribirCaso({ id, esc, banco, sistema, semilla, cuentas, periodo, cliente, pendientesAnterior, notas }) {
  const dir = join(CASOS, id);
  mkdirSync(dir, { recursive: true });
  const B = BANCOS[banco], S = SISTEMAS[sistema];
  const r = rng(semilla * 7919 + 13);
  const meta = { titular: cliente.nombre, desde: periodo.desde, hasta: periodo.hasta, cbu: "0" + String(r.int(1e9, 9e9)) + String(r.int(1e10, 9e10)).slice(0, 11), nroCuenta: `${r.int(100, 999)}-${r.int(100000, 999999)}/${r.int(1, 9)}`, banco: B.nombre };
  const { bytes, paginas } = await renderExtracto(B, cuentas.map((cu) => ({ titulo: cu.moneda === "USD" ? "Caja de ahorro en dólares" : "Cuenta corriente en pesos", moneda: cu.moneda, apertura: cu.saldos.bancoApertura, movs: cu.banco.map((m) => ({ fecha: m.fecha, cents: m.cents, desc: m._desc })) })), meta, r);
  writeFileSync(join(dir, "extracto.pdf"), bytes);
  for (const cu of cuentas) {
    writeFileSync(join(dir, cu.mayor), S.write({ movs: cu.libros.map((l) => ({ ...l, desc: l.descripcion, comp: l.comprobante })), apertura: cu.saldos.librosApertura, meta, r }));
    cu.banco.forEach((m) => delete m._desc);
  }
  writeFileSync(join(dir, "plantilla.json"), JSON.stringify({ banco: B.nombre, columnas: plantillaColumnas(B) }, null, 2) + "\n");
  if (pendientesAnterior) writeFileSync(join(dir, "pendientes-anterior.json"), JSON.stringify({ fulgoria_pendientes: 1, periodo: pendientesAnterior.periodo, pendientes: pendientesAnterior.movs }, null, 2) + "\n");
  const esperado = {
    dataset: "conciliacion-sintetica", version: VERSION, id, escenario: esc, banco, sistema, semilla, periodo,
    cliente: { nombre: cliente.nombre, pagoACuenta25413: 33, responsableInscripto: true },
    archivos: { extracto: "extracto.pdf", plantilla: "plantilla.json", pendientesAnterior: pendientesAnterior ? "pendientes-anterior.json" : null },
    paginas, notas: notas || ESCENARIOS[esc]?.desc || "",
    cuentas: cuentas.map((cu, k) => ({ segmento: k, moneda: cu.moneda, mayor: cu.mayor, saldos: cu.saldos, banco: cu.banco, libros: cu.libros, pares: cu.pares, pendientes: cu.pendientes, diferenciaNoExplicada: 0 })),
  };
  writeFileSync(join(dir, "esperado.json"), JSON.stringify(esperado, null, 1) + "\n");
  const cu0 = cuentas[0];
  indice.push({ id, escenario: esc, banco, sistema, semilla, movBanco: cu0.banco.length, movLibros: cu0.libros.length, pares: cu0.pares.length, pendientes: cu0.pendientes.length, cuentas: cuentas.length, paginas });
}

/** Cuenta en una moneda: genera, cierra y calcula saldos. */
function cuenta(c, moneda, mayor, aperturaBanco, aperturaLibros = aperturaBanco) {
  const t = cerrar(c);
  const saldos = { bancoApertura: aperturaBanco, bancoCierre: aperturaBanco + suma(t.banco), librosApertura: aperturaLibros, librosCierre: aperturaLibros + suma(t.libros) };
  return { moneda, mayor, saldos, ...t };
}

/** Cuenta en dólares simple para el banco con dos cuentas. */
function cuentaUSD(semilla, base) {
  const r = rng(semilla * 31 + 7);
  const c = new Caso({ r, anio: base.anio, mes: base.mes, voc: base.voc, cliente: { imp25413: false, sircreb: 0 } });
  for (let k = 0; k < r.int(3, 7); k++) {
    const f = c.dia(), cents = (r.chance(0.5) ? 1 : -1) * r.int(10000, 900000);
    const bi = c.b(f, cents, cents > 0 ? base.voc.trfRecibida("Exportación cliente exterior", "30-00000000-0", null) : base.voc.trfEnviada("Proveedor exterior", "30-00000000-0"), "transferencia");
    c.par(bi, c.l(f, cents, cents > 0 ? "Cobro exportación (USD)" : "Pago proveedor exterior (USD)"));
  }
  const ci = c.b(habil(addDays(c.hasta, -3)), -r.int(500, 2500), base.voc.comision(), "comision");
  c.pendB(ci, "ajuste_bancario");
  return cuenta(c, "USD", "mayor-usd.csv", r.int(500000, 9000000));
}

// ---------------------------------------------------------------- generación
const t0 = Date.now();
for (const esc of escenarios) {
  for (let bi = 0; bi < bancos.length; bi++) {
    for (let s = 1; s <= SEMILLAS; s++) {
      const banco = bancos[bi];
      const sistema = sistemas[(bi + s + escenarios.indexOf(esc)) % sistemas.length];
      const semilla = 1000 * (escenarios.indexOf(esc) + 1) + 10 * bi + s;
      const { r, mes, cliente } = nuevoCaso(semilla, esc);
      const c = new Caso({ r, anio: 2026, mes, voc: BANCOS[banco].voc, cliente });
      generarEscenario(c, esc);
      const apertura = r.cents(500000, 40000000);
      const cuentas = [cuenta(c, "ARS", BANCOS[banco].dosCuentas ? "mayor-ars.csv" : "mayor.csv", apertura)];
      if (BANCOS[banco].dosCuentas) cuentas.push(cuentaUSD(semilla, c));
      const id = `${String(++n).padStart(3, "0")}-${esc}-${banco}`;
      await escribirCaso({ id, esc, banco, sistema, semilla, cuentas, periodo: { desde: c.desde, hasta: c.hasta }, cliente });
    }
  }
}

// Arrastre: dos meses seguidos; el segundo trae los pendientes del primero.
for (let bi = 0; bi < bancos.length; bi++) {
  const banco = bancos[bi], B = BANCOS[banco];
  if (B.dosCuentas) continue;
  const sistema = sistemas[(bi + 3) % sistemas.length];
  const semilla = 50000 + bi;
  const { r, mes, cliente } = nuevoCaso(semilla, "basico");
  // Mes 1
  const c1 = new Caso({ r, anio: 2026, mes, voc: B.voc, cliente });
  generarEscenario(c1, "basico");
  // un crédito que el cliente identifica recién el mes siguiente
  const fcr = c1.dia(), ccr = r.cents(50000, 600000);
  c1.pendB(c1.b(fcr, ccr, B.voc.trfRecibida("Cliente sin datos", "30-00000000-0", null), "transferencia"), "credito_no_identificado");
  const ap = r.cents(1000000, 20000000);
  const k1 = cuenta(c1, "ARS", "mayor.csv", ap);
  const id1 = `${String(++n).padStart(3, "0")}-arrastre-${banco}-mes1`;
  await escribirCaso({ id: id1, esc: "arrastre", banco, sistema, semilla, cuentas: [k1], periodo: { desde: c1.desde, hasta: c1.hasta }, cliente, notas: "Mes 1 de 2: deja cheques pendientes, un depósito en tránsito y un crédito sin identificar para el mes siguiente." });

  // Pendientes que pasan (los ajustes bancarios del mes 1 se dan por asentados).
  const pasan = k1.pendientes.filter((p) => p.tipo !== "ajuste_bancario");
  const movDe = (p) => (p.lado === "banco" ? k1.banco : k1.libros).find((m) => m.id === p.id);
  const arrastre = pasan.map((p) => { const m = movDe(p); return makeMov({ id: "A-" + p.id, lado: p.lado, fecha: m.fecha, cents: m.cents, descripcion: m.descripcion, periodo: c1.hasta.slice(0, 7) }); });
  const ajustes1 = k1.pendientes.filter((p) => p.tipo === "ajuste_bancario").reduce((s, p) => s + movDe(p).cents, 0);

  // Mes 2
  const mes2 = mes + 1;
  const c2 = new Caso({ r, anio: 2026, mes: mes2, voc: B.voc, cliente });
  for (const a of arrastre) {
    const p = pasan.find((x) => "A-" + x.id === a.id);
    if (p.tipo === "cheque_pendiente") {
      const nro = a.entidades.cheque || "0";
      c2.par(c2.b(habil(iso(2026, mes2, r.int(2, 12))), a.cents, B.voc.cheque(String(nro).padStart(8, "0")), "cheque"), a.id, "arrastre");
    } else if (p.tipo === "deposito_transito") {
      c2.par(c2.b(habil(iso(2026, mes2, r.int(1, 2))), a.cents, B.voc.depositoCheques(), "deposito"), a.id, "arrastre");
    } else if (p.tipo === "credito_no_identificado") {
      c2.par(a.id, c2.l(habil(iso(2026, mes2, r.int(3, 10))), a.cents, "Cobranza identificada del mes anterior (cliente confirmó)"), "arrastre");
    }
  }
  generarEscenario(c2, "basico");
  const k2 = cuenta(c2, "ARS", "mayor.csv", k1.saldos.bancoCierre, k1.saldos.librosCierre + ajustes1);
  const id2 = `${String(++n).padStart(3, "0")}-arrastre-${banco}-mes2`;
  await escribirCaso({ id: id2, esc: "arrastre", banco, sistema, semilla: semilla + 1, cuentas: [k2], periodo: { desde: c2.desde, hasta: c2.hasta }, cliente, pendientesAnterior: { periodo: c1.hasta.slice(0, 7), movs: arrastre }, notas: `Mes 2 de 2 (sigue a ${id1}): se cargan los pendientes del mes anterior; el libro ya incluye los ajustes bancarios del mes 1.` });
}

// ---------------------------------------------------------------- plantillas de Fulgoria por banco
// Plantillas reales (las que se cargan en el Extractor con "Cargar plantilla"), armadas sobre el
// primer extracto de cada banco: guardan la geometría y los rótulos, nunca datos.
for (const banco of bancos) {
  const primero = indice.find((x) => x.banco === banco);
  const pdf = await loadPdfNode(readFileSync(join(CASOS, primero.id, "extracto.pdf")));
  const columns = plantillaColumnas(BANCOS[banco]);
  const tpl = buildTemplate({ bank: BANCOS[banco].nombre, columns, pageSize: { w: pdf.pages[0].W, h: pdf.pages[0].H }, anchors: extractAnchors(pdf.pages, columns), contributor: "dataset-sintetico", createdAt: "2026-11-27" });
  writeFileSync(join(ROOT, "plantillas", `${banco}.ext.json`), JSON.stringify(tpl, null, 2) + "\n");
}

writeFileSync(join(ROOT, "casos.json"), JSON.stringify({ dataset: "conciliacion-sintetica", version: VERSION, casos: indice }, null, 1) + "\n");
const totB = indice.reduce((s, x) => s + x.movBanco, 0), totL = indice.reduce((s, x) => s + x.movLibros, 0);
console.log(`${indice.length} casos · ${totB} líneas de extracto · ${totL} registros de mayor · ${((Date.now() - t0) / 1000).toFixed(1)} s → ${ROOT}`);
