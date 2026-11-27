// Lectura de PDF en Node con las MISMAS coordenadas normalizadas que usa la app en el navegador
// (src/pdf.js), para que el benchmark mida exactamente el lector de Fulgoria.
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function loadPdfNode(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
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
  return { numPages: doc.numPages, pages };
}
