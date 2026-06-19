// Imprime las líneas que contienen "saldo" en cada PDF, para descubrir los rótulos
// de apertura/cierre que usa cada banco. Solo desarrollo local.
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

const targets = process.argv.slice(2);
for (const path of targets) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const seen = new Set();
  console.log("\n===", path.split(/[\\/]/).pop(), "===");
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines = {};
    for (const it of content.items) {
      if (!it.str.trim()) continue;
      const tx = Util.transform(vp.transform, it.transform);
      const key = Math.round(tx[5] / 3);
      (lines[key] ||= []).push([tx[4], it.str]);
    }
    for (const k of Object.keys(lines)) {
      const txt = lines[k].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(" ").replace(/\s+/g, " ").trim();
      if (/saldo/i.test(txt) && !seen.has(txt)) { seen.add(txt); console.log("  p" + p, "|", txt.slice(0, 90)); }
    }
  }
}
