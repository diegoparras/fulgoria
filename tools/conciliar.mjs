// Conciliación de punta a punta desde la consola: extracto PDF (motor de Fulgoria, regla del
// saldo) + mayor CSV → bandeja de excepciones, papel de trabajo y asientos propuestos.
//
//   cd tools && npm install
//   node tools/conciliar.mjs samples/banco-rio-cc.pdf samples/mayor-banco-rio-cc.csv
//   node tools/conciliar.mjs extracto.pdf mayor.csv --config mandos.json --out salida/
//
// --config: JSON con los mandos a pisar (ver src/core/config.js), p. ej.
//   { "cliente": { "pagoACuenta25413": 100 }, "match": { "toleranciaCents": 100 } }
// --out: carpeta donde escribir papel.md, papel.csv, asientos.csv y conciliacion.json.
// Solo desarrollo/local: la salida contiene los datos del extracto.
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { autoDetect, extract, balanceCheck, docYear } from "../src/extract.js";
import {
  fromExtract, parseLedgerCsv, resolveConfig, reconcile, papelSaldoASaldo, papelToMarkdown,
  papelToCsv, asientosToCsv, bandejaToText, fmtCents,
} from "../src/core/index.js";

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const cfgPath = flag("--config"), outDir = flag("--out");
const [pdfPath, ledgerPath] = args;
if (!pdfPath || !ledgerPath) {
  console.error("Uso: node tools/conciliar.mjs <extracto.pdf> <mayor.csv> [--config mandos.json] [--out carpeta]");
  process.exit(2);
}

async function loadItems(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const items = [];
    for (const it of (await page.getTextContent()).items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = Util.transform(vp.transform, it.transform);
      const fontH = Math.hypot(tx[2], tx[3]);
      const x = tx[4] / W, y = (tx[5] - fontH) / H, nw = it.width / W, nh = (it.height || fontH) / H;
      items.push({ str: it.str, x, y, w: nw, h: nh, cx: x + nw / 2, cy: y + nh / 2 });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ index: p, W, H, items });
  }
  return pages;
}

// --- Lado banco: el motor de siempre + la regla del saldo ---
const pages = await loadItems(resolve(pdfPath));
const columns = autoDetect(pages).columns;
const ext = extract(pages, columns);
const chk = balanceCheck(ext);
if (ext.segments.length !== 1) console.warn(`⚠ El PDF tiene ${ext.segments.length} cuentas; concilio la primera.`);
const seg = { ...ext.segments[0], columns };
const anio = docYear(pages, ext.movements) || new Date().getFullYear();
const bank = fromExtract(seg, { doc: basename(pdfPath), anio });
console.log(`Extracto: ${bank.movs.length} movimientos · apertura ${fmtCents(bank.apertura)} · cierre ${fmtCents(bank.cierre)} · regla del saldo ${chk.globalOk ? "✅ cierra" : "❌ NO cierra"}${chk.rowOk === false ? ` (filas con error: ${chk.rowMismatches.join(", ")})` : ""}`);
if (!chk.globalOk) console.warn("⚠ La lectura del extracto no está verificada: la conciliación no puede quedar en verde.");

// --- Lado libros ---
const led = parseLedgerCsv(readFileSync(resolve(ledgerPath), "utf8"), { doc: basename(ledgerPath), anio });
console.log(`Mayor: ${led.movs.length} registros · apertura ${fmtCents(led.apertura)} · cierre ${fmtCents(led.cierre)} · control ${led.control.ok === true ? "✅ cierra" : led.control.ok === false ? "❌ NO cierra" : "— (sin saldo para verificar)"}`);
for (const a of led.avisos) console.warn("⚠ " + a);

// --- Conciliación ---
const fechas = [...bank.movs, ...led.movs].map((m) => m.fecha).sort();
const hasta = fechas[fechas.length - 1], desde = fechas[0].slice(0, 8) + "01";
const cfg = resolveConfig(cfgPath ? JSON.parse(readFileSync(resolve(cfgPath), "utf8")) : null);
const rec = reconcile({
  banco: bank.movs, libros: led.movs,
  saldos: { bancoApertura: bank.apertura, bancoCierre: bank.cierre, librosApertura: led.apertura, librosCierre: led.cierre },
  periodo: { desde, hasta: hasta.slice(0, 8) + String(new Date(Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7), 0)).getUTCDate()).padStart(2, "0") },
  cfg,
  lectura: { banco: !!chk.globalOk, libros: led.control.ok !== false },
});

console.log(`\nEstado: ${{ rojo: "🔴", amarillo: "🟡", verde: "🟢" }[rec.resumen.estado]} ${rec.resumen.estado.toUpperCase()} · diferencia no explicada ${fmtCents(rec.diferenciaNoExplicada)}\n`);
console.log("BANDEJA\n" + bandejaToText(rec.bandeja) + "\n");
for (const m of rec.matches.filter((x) => x.certeza === "amarillo")) {
  const d = (ids) => ids.map((id) => `${rec.movimientos[id].fecha} ${rec.movimientos[id].descripcion} ${fmtCents(rec.movimientos[id].cents)}`).join(" + ");
  console.log(`  🟡 ${d(m.banco)}  ⇄  ${d(m.libros)}\n     ¿por qué? ${m.motivos.join("; ")}`);
}
const papel = papelSaldoASaldo(rec, { banco: basename(pdfPath, ".pdf") });
const md = papelToMarkdown(papel);
console.log("\n" + md);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "papel.md"), md);
  writeFileSync(join(outDir, "papel.csv"), papelToCsv(papel));
  writeFileSync(join(outDir, "asientos.csv"), asientosToCsv(rec.ajustes));
  writeFileSync(join(outDir, "conciliacion.json"), JSON.stringify(rec, null, 2));
  console.log(`Archivos escritos en ${outDir}/ (papel.md, papel.csv, asientos.csv, conciliacion.json)`);
}
