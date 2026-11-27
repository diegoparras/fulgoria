// Benchmark de Fulgoria contra el dataset sintético.
//
//   cd tools && npm install
//   node dataset/bench.mjs                     # todos los casos, con la plantilla de cada banco
//   node dataset/bench.mjs --auto              # además mide la auto-detección de columnas
//   node dataset/bench.mjs --solo cheques      # filtra por texto en el id del caso
//   node dataset/bench.mjs --detalle 017       # muestra lo que falló en un caso
//   node dataset/bench.mjs --dir datasets/desde-plantillas/banco-del-rio   # otro dataset
//
// Lee cada caso EXACTAMENTE como la app (extractor + motor), compara contra esperado.json y
// escribe datasets/conciliacion-sintetica/RESULTADOS.md. La métrica que no se negocia:
// "verdes incorrectos" (un emparejamiento que el sistema confirmó solo y estaba mal) = 0.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPdfNode } from "./pdfnode.mjs";
import { extract, balanceCheck, autoDetect } from "../../src/extract.js";
import { fromExtract, parseLedgerCsv, parseLedgerConPlantilla, reconocerPlantillaMayor, parseCsv, resolveConfig, reconcile, classify, GRUPOS_AJUSTABLES } from "../../src/core/index.js";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const AUTO = args.includes("--auto"), SOLO = opt("--solo"), DETALLE = opt("--detalle");
const ROOT = opt("--dir") ? resolve(opt("--dir")) + "/" : new URL("../../datasets/conciliacion-sintetica/", import.meta.url).pathname;
const ids = readdirSync(join(ROOT, "casos")).filter((d) => !SOLO || d.includes(SOLO)).sort();
const cfg = resolveConfig();
// Como la app: si hay plantillas de mayor guardadas, se usan primero; si no, detección automática.
const DIR_TPL_MAYOR = join(ROOT, "plantillas-mayor");
const PLANTILLAS_MAYOR = existsSync(DIR_TPL_MAYOR) ? readdirSync(DIR_TPL_MAYOR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(DIR_TPL_MAYOR, f), "utf8"))) : [];

const sig = (m) => `${m.fecha}|${m.cents}`;
const keyOf = (bs, ls) => [...bs].sort().join(",") + "|" + [...ls].sort().join(",");

/** Alinea los movimientos leídos con los esperados: por orden si coinciden; si no, por fecha+importe. */
function alinear(leidos, esperados) {
  const map = new Map();
  const iguales = leidos.length === esperados.length && leidos.every((m, i) => m.fecha === esperados[i].fecha && m.cents === esperados[i].cents);
  if (iguales) { leidos.forEach((m, i) => map.set(m.id, esperados[i].id)); return { map, exacta: true, faltan: 0, sobran: 0 }; }
  const libres = new Map();
  for (const e of esperados) { const k = sig(e); if (!libres.has(k)) libres.set(k, []); libres.get(k).push(e.id); }
  let sobran = 0;
  for (const m of leidos) { const l = libres.get(sig(m)); if (l && l.length) map.set(m.id, l.shift()); else sobran++; }
  const faltan = [...libres.values()].reduce((s, l) => s + l.length, 0);
  return { map, exacta: false, faltan, sobran };
}

async function evaluarCaso(id, modo) {
  const dir = join(ROOT, "casos", id);
  const esp = JSON.parse(readFileSync(join(dir, "esperado.json"), "utf8"));
  const pdf = await loadPdfNode(readFileSync(join(dir, "extracto.pdf")));
  const columns = modo === "auto" ? autoDetect(pdf.pages).columns : JSON.parse(readFileSync(join(dir, "plantilla.json"), "utf8")).columnas;
  const ext = extract(pdf.pages, columns);
  const arrastre = esp.archivos.pendientesAnterior ? JSON.parse(readFileSync(join(dir, esp.archivos.pendientesAnterior), "utf8")).pendientes : [];
  const res = [];
  for (const cu of esp.cuentas) {
    const r = { id, escenario: esp.escenario, banco: esp.banco, sistema: esp.sistema, moneda: cu.moneda, fallas: [] };
    const seg = ext.segments[cu.segmento];
    // --- lectura del extracto ---
    let bank = { movs: [], apertura: null, cierre: null }, chk = { globalOk: false };
    if (seg) { bank = fromExtract({ ...seg, columns }, { doc: "extracto.pdf", anio: +esp.periodo.desde.slice(0, 4) }); chk = balanceCheck({ ...seg, columns }); }
    const aB = alinear(bank.movs, cu.banco);
    r.lecturaBanco = aB.exacta && bank.apertura === cu.saldos.bancoApertura && bank.cierre === cu.saldos.bancoCierre;
    r.reglaSaldo = !!chk.globalOk;
    if (!r.lecturaBanco) r.fallas.push(`extracto: leídos ${bank.movs.length}/${cu.banco.length} (faltan ${aB.faltan}, sobran ${aB.sobran}); apertura ${bank.apertura} vs ${cu.saldos.bancoApertura}; cierre ${bank.cierre} vs ${cu.saldos.bancoCierre}`);
    // --- lectura del mayor ---
    let led = null;
    try {
      const txt = readFileSync(join(dir, cu.mayor), "utf8"), o = { doc: cu.mayor, anio: +esp.periodo.desde.slice(0, 4) };
      const rp = reconocerPlantillaMayor(parseCsv(txt), PLANTILLAS_MAYOR);
      led = rp ? parseLedgerConPlantilla(txt, rp.plantilla, o) : parseLedgerCsv(txt, o);
    }
    catch (e) { r.fallas.push("mayor: " + e.message); }
    const aL = led ? alinear(led.movs, cu.libros) : { map: new Map(), exacta: false, faltan: cu.libros.length, sobran: 0 };
    r.lecturaMayor = !!led && aL.exacta && led.apertura === cu.saldos.librosApertura && led.cierre === cu.saldos.librosCierre;
    if (led && !r.lecturaMayor) r.fallas.push(`mayor: leídos ${led.movs.length}/${cu.libros.length} (faltan ${aL.faltan}, sobran ${aL.sobran}); apertura ${led.apertura} vs ${cu.saldos.librosApertura}; cierre ${led.cierre} vs ${cu.saldos.librosCierre}`);
    if (!led) { res.push(r); continue; }

    // --- conciliación ---
    const saldos = {
      bancoApertura: bank.apertura ?? cu.saldos.bancoApertura, bancoCierre: bank.cierre ?? cu.saldos.bancoCierre,
      librosApertura: led.apertura, librosCierre: led.cierre,
    };
    const rec = reconcile({ banco: bank.movs, libros: led.movs, arrastre: cu.segmento === 0 ? arrastre : [], saldos, periodo: esp.periodo, cfg,
      lectura: { banco: !!chk.globalOk && bank.apertura != null, libros: led.control.ok !== false } });
    const toTruth = (eid) => (eid.startsWith("A-") ? eid : aB.map.get(eid) ?? aL.map.get(eid) ?? "?" + eid);
    const truthMov = new Map([...cu.banco, ...cu.libros, ...arrastre].map((m) => [m.id, m]));
    const esperados = new Set(cu.pares.map((p) => keyOf(p.banco, p.libros)));
    const firma = (bs, ls) => [...bs.map((x) => sig(truthMov.get(x) || { fecha: "?", cents: x }))].sort().join(",") + "|" + [...ls.map((x) => sig(truthMov.get(x) || { fecha: "?", cents: x }))].sort().join(",");
    const firmasEsperadas = new Set(cu.pares.map((p) => firma(p.banco, p.libros)));
    let ok = 0, okVerde = 0, verdeMal = 0, amarilloMal = 0;
    for (const m of rec.matches) {
      const bs = m.banco.map(toTruth), ls = m.libros.map(toTruth);
      const bien = esperados.has(keyOf(bs, ls)) || firmasEsperadas.has(firma(bs, ls));
      if (bien) { ok++; if (m.certeza === "verde") okVerde++; }
      else if (m.certeza === "verde") { verdeMal++; r.fallas.push(`VERDE INCORRECTO: ${bs.join("+")} ⇄ ${ls.join("+")} (${m.estrategia})`); }
      else amarilloMal++;
    }
    r.pares = cu.pares.length; r.paresOk = ok; r.paresVerdeOk = okVerde; r.verdeMal = verdeMal; r.amarilloMal = amarilloMal;
    // Pares esperados no encontrados, por tipo (para saber qué falta en el motor).
    const encontrados = new Set(rec.matches.map((m) => firma(m.banco.map(toTruth), m.libros.map(toTruth))));
    r.faltantesPorTipo = {};
    for (const p of cu.pares) if (!encontrados.has(firma(p.banco, p.libros))) r.faltantesPorTipo[p.tipo] = (r.faltantesPorTipo[p.tipo] || 0) + 1;

    // --- pendientes: multiconjunto (lado, tipo, importe) ---
    const bolsa = new Map();
    for (const p of cu.pendientes) { const k = `${p.lado}|${p.tipo}|${truthMov.get(p.id)?.cents}`; bolsa.set(k, (bolsa.get(k) || 0) + 1); }
    let pendOk = 0;
    for (const p of rec.pendientes) { const k = `${p.lado}|${p.tipo}|${rec.movimientos[p.id].cents}`; if (bolsa.get(k)) { pendOk++; bolsa.set(k, bolsa.get(k) - 1); } }
    r.pendientes = cu.pendientes.length; r.pendientesOk = pendOk; r.pendientesMotor = rec.pendientes.length;

    // --- clasificación de las líneas del banco: ¿reconoce lo que se ajusta sin identificar? ---
    let aj = 0, ajOk = 0, falsosAj = 0;
    for (const m of cu.banco) {
      const c = classify({ descripcion: m.descripcion, cents: m.cents });
      const esAj = GRUPOS_AJUSTABLES.has(grupoDe(m.tipo));
      if (esAj) { aj++; if (c.tipo === m.tipo) ajOk++; else if (DETALLE && id.includes(DETALLE)) r.fallas.push(`clasificación: "${m.descripcion}" esperado ${m.tipo}, dio ${c.tipo}`); }
      else if (GRUPOS_AJUSTABLES.has(c.grupo)) { falsosAj++; r.fallas.push(`clasificó como ajuste algo operativo: "${m.descripcion}" → ${c.tipo}`); }
    }
    r.ajustables = aj; r.ajustablesOk = ajOk; r.falsosAjustes = falsosAj;
    r.diferenciaOk = rec.diferenciaNoExplicada === 0;
    if (!r.diferenciaOk) r.fallas.push(`diferencia no explicada ${rec.diferenciaNoExplicada}`);
    r.estado = rec.resumen.estado;
    res.push(r);
  }
  return res;
}
const GRUPO = { impuesto_25413: "fiscal", retencion_iibb: "fiscal", percepcion_iva: "fiscal", percepcion_iibb: "fiscal", percepcion_ganancias: "fiscal", iva_comision: "gasto_bancario", comision: "gasto_bancario", interes_ganado: "financiero", interes_pagado: "financiero" };
const grupoDe = (t) => GRUPO[t] || "operativo";

// ---------------------------------------------------------------- correr y resumir
const t0 = Date.now();
const filas = [];
for (const id of ids) filas.push(...(await evaluarCaso(id, "plantilla")));
let auto = null;
if (AUTO) { auto = []; for (const id of ids) auto.push(...(await evaluarCaso(id, "auto"))); }

const pctf = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 100);
function resumen(rs) {
  const s = (k) => rs.reduce((t, r) => t + (r[k] || 0), 0);
  return {
    cuentas: rs.length,
    lecturaBanco: pctf(rs.filter((r) => r.lecturaBanco).length, rs.length),
    lecturaMayor: pctf(rs.filter((r) => r.lecturaMayor).length, rs.length),
    paresEncontrados: pctf(s("paresOk"), s("pares")),
    paresSolos: pctf(s("paresVerdeOk"), s("pares")),
    verdeMal: s("verdeMal"),
    amarilloMal: s("amarilloMal"),
    pendientes: pctf(s("pendientesOk"), s("pendientes")),
    ajustables: pctf(s("ajustablesOk"), s("ajustables")),
    falsosAjustes: s("falsosAjustes"),
    diferencia0: pctf(rs.filter((r) => r.diferenciaOk).length, rs.length),
  };
}
const agrupar = (k) => Object.entries(filas.reduce((g, r) => ((g[r[k]] ||= []).push(r), g), {})).map(([v, rs]) => [v, resumen(rs)]);
const global = resumen(filas);
const faltantes = filas.reduce((t, r) => { for (const [k, v] of Object.entries(r.faltantesPorTipo || {})) t[k] = (t[k] || 0) + v; return t; }, {});

const H = "| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
const fila = (n, x) => `| ${n} | ${x.cuentas} | ${x.lecturaBanco}% | ${x.lecturaMayor}% | ${x.paresEncontrados}% | ${x.paresSolos}% | **${x.verdeMal}** | ${x.amarilloMal} | ${x.pendientes}% | ${x.ajustables}% | ${x.falsosAjustes} | ${x.diferencia0}% |`;
const md = [
  "# Resultados del benchmark", "",
  `Generado por \`node tools/dataset/bench.mjs\` sobre ${ids.length} casos (${filas.length} cuentas), leyendo cada extracto con la plantilla de su banco.`,
  "Este archivo se regenera: es la foto del estado actual del lector y del motor contra el dataset.", "",
  "## Global", "", H, fila("**Total**", global), "",
  "## Por escenario", "", H, ...agrupar("escenario").map(([k, x]) => fila(k, x)), "",
  "## Por formato de banco", "", H, ...agrupar("banco").map(([k, x]) => fila(k, x)), "",
  "## Por formato de mayor", "", H, ...agrupar("sistema").map(([k, x]) => fila(k, x)), "",
  "## Pares esperados que el motor no encontró, por tipo", "",
  "| Tipo de par | Cantidad |", "|---|---:|", ...Object.entries(faltantes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), "",
  ...(auto ? ["## Auto-detección de columnas (sin plantilla)", "", H, fila("**Total (auto)**", resumen(auto)), ""] : []),
  "## Cómo leer la tabla", "",
  "- **Lectura extracto / mayor**: el lector obtuvo exactamente los mismos movimientos (fecha e importe) y los mismos saldos que el documento.",
  "- **Pares encontrados**: emparejamientos correctos (en verde o en amarillo) sobre el total de emparejamientos esperados.",
  "- **Pares confirmados solos**: los que quedaron en verde y estaban bien; el resto necesitó un clic o no se encontró.",
  "- **Verdes incorrectos**: emparejamientos que el sistema confirmó solo y estaban mal. Tiene que ser 0.",
  "- **Pendientes bien tipificados**: partidas sin pareja que quedaron con el tipo correcto (cheque pendiente, depósito en tránsito, ajuste bancario…).",
  "- **Ajustes bien clasificados**: líneas de impuestos, gastos e intereses del banco reconocidas con el tipo correcto. **Falsos ajustes**: líneas operativas tomadas por gastos.",
  "- **Diferencia 0**: la ecuación de cierre dio exacto al centavo.", "",
];
writeFileSync(join(ROOT, "RESULTADOS.md"), md.join("\n"));
writeFileSync(join(ROOT, "resultados.json"), JSON.stringify({ global, porEscenario: Object.fromEntries(agrupar("escenario")), porBanco: Object.fromEntries(agrupar("banco")), porSistema: Object.fromEntries(agrupar("sistema")), faltantes, auto: auto ? resumen(auto) : null }, null, 1) + "\n");

console.log(md.slice(4, 8 + agrupar("escenario").length + agrupar("banco").length + agrupar("sistema").length + 12).join("\n"));
if (DETALLE) for (const r of (auto && args.includes("--detalle-auto") ? auto : filas).filter((x) => x.id.includes(DETALLE))) console.log(`\n${r.id} (${r.moneda})\n  ` + (r.fallas.join("\n  ") || "sin fallas"));
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!existsSync(join(ROOT, "RESULTADOS.md"))) process.exit(1);
