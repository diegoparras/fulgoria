// Carga y render del PDF + extracción de texto con coordenadas NORMALIZADAS (0..1).
// Multipágina: cada página trae sus items con coords normalizadas dentro de esa página.
// Todo corre en el navegador: el PDF nunca sale de la máquina.
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

// Devuelve { numPages, pages: [{ index, page, W, H, items }] }
//   items: [{ str, x, y, w, h, cx, cy }] coords normalizadas 0..1, origen arriba-izq.
export async function loadPdf(data) {
  // isEvalSupported:false → PDF.js no usa eval para fuentes (defensa ante PDFs hostiles).
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport1 = page.getViewport({ scale: 1 });
    const items = await extractItems(page, viewport1);
    pages.push({ index: p, page, W: viewport1.width, H: viewport1.height, items });
  }
  return { numPages: doc.numPages, pages };
}

async function extractItems(page, viewport1) {
  const W = viewport1.width, H = viewport1.height;
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = pdfjs.Util.transform(viewport1.transform, it.transform);
    const left = tx[4];
    const fontH = Math.hypot(tx[2], tx[3]);
    const top = tx[5] - fontH; // tx[5] es baseline; subimos al tope de la caja
    const w = it.width, h = it.height || fontH;
    const x = left / W, y = top / H, nw = w / W, nh = h / H;
    items.push({ str: it.str, x, y, w: nw, h: nh, cx: x + nw / 2, cy: y + nh / 2 });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  return items;
}

// Renderiza una página a un canvas de N píxeles de ancho (alta resolución para OCR).
export async function renderToCanvas(page, pxWidth = 1600) {
  const vp1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pxWidth / vp1.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

// Renderiza una página en un canvas al ancho deseado (px CSS). Devuelve {canvas, cssHeight}.
export async function renderPage(page, cssWidth) {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = cssWidth / vp1.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // Display RESPONSIVE (100% del contenedor), no un ancho fijo en px: así el canvas y el
  // overlay de columnas comparten siempre el mismo marco y no se desalinean al hacer zoom/resize.
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, cssHeight: viewport.height / dpr };
}
