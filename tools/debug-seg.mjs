import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import { autoDetect, extract, balanceCheck } from "../src/extract.js";

async function load(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height; const content = await page.getTextContent(); const items = [];
    for (const it of content.items) { if (!it.str.trim()) continue; const tx = Util.transform(vp.transform, it.transform); const fh = Math.hypot(tx[2], tx[3]); const x = tx[4] / W, y = (tx[5] - fh) / H, nw = it.width / W, nh = (it.height || fh) / H; items.push({ str: it.str, x, y, w: nw, h: nh, cx: x + nw / 2, cy: y + nh / 2 }); }
    items.sort((a, b) => a.y - b.y || a.x - b.x); pages.push({ index: p, W, H, items });
  }
  return pages;
}
for (const f of process.argv.slice(2)) {
  const pages = await load(f);
  const cols = autoDetect(pages).columns;
  const r = extract(pages, cols);
  console.log("\n===", f.split(/[\\/]/).pop(), "| cols:", cols.map((c) => c.role).join(","), "===");
  r.segments.forEach((s, i) => {
    const b = balanceCheck({ ...s, columns: cols });
    console.log(`  cuenta ${i} ${s.currency || "?"}: ${s.movements.length} movs | op=${fmt(s.opening)} cl=${fmt(s.closing)} comp=${fmt(b.computed)} ${b.globalOk ? "OK" : "NO"}`);
  });
}
function fmt(n) { return n == null ? "—" : n.toLocaleString("es-AR", { maximumFractionDigits: 2 }); }
