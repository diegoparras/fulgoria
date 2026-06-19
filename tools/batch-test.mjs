// Corre TODOS los PDFs de samples/private por el motor (auto-detección) y reporta una
// matriz de cobertura. Solo desarrollo/local. No commitear resultados (tienen datos).
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { autoDetect, extract, balanceCheck } from "../src/extract.js";

const DIR = new URL("../samples/private/", import.meta.url);

async function loadItems(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = Util.transform(vp.transform, it.transform);
      const fontH = Math.hypot(tx[2], tx[3]);
      const x = tx[4] / W, y = (tx[5] - fontH) / H, nw = it.width / W, nh = (it.height || fontH) / H;
      items.push({ str: it.str, x, y, w: nw, h: nh, cx: x + nw / 2, cy: y + nh / 2 });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ index: p, W, H, items });
  }
  return { numPages: doc.numPages, pages };
}

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad("ARCHIVO", 34), pad("PG", 3), pad("MOVS", 6), pad("CIERRA", 7), pad("FILA", 5), "DETALLE");
console.log("-".repeat(90));
const rows = [];
for (const f of files) {
  try {
    const pdf = await loadItems(new URL(f, DIR));
    const cols = autoDetect(pdf.pages).columns;
    const r = extract(pdf.pages, cols);
    const segs = r.segments.map((s) => ({ s, b: balanceCheck({ ...s, columns: cols }) }));
    const allOk = segs.length > 0 && segs.every((x) => x.b.globalOk);
    const anyUnknown = segs.some((x) => x.b.opening == null || x.b.closing == null);
    const cierra = allOk ? "SI" : segs.length === 0 ? "?" : anyUnknown ? "?" : "NO";
    const detalle = `cuentas=${r.segments.length} [${r.segments.map((s) => (s.currency || "?") + ":" + s.movements.length + (segs.find((x) => x.s === s).b.globalOk ? "✓" : "✗")).join(" ")}] roles=[${cols.map((c) => c.role[0]).join("")}]`;
    console.log(pad(f, 34), pad(pdf.numPages, 3), pad(r.movements.length, 6), pad(cierra, 7), pad(allOk ? "ok" : "-", 5), detalle);
    rows.push({ f, cierra, movs: r.movements.length });
  } catch (e) {
    console.log(pad(f, 34), "ERROR:", e.message.slice(0, 50));
    rows.push({ f, cierra: "ERR" });
  }
}
console.log("-".repeat(90));
const si = rows.filter((r) => r.cierra === "SI").length;
console.log(`Cierran con auto-detección: ${si}/${rows.length}`);
function fmt(n) { return n == null ? "—" : n.toLocaleString("es-AR", { maximumFractionDigits: 2 }); }
