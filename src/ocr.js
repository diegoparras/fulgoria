// OCR 100% en el navegador (Tesseract.js, vendorizado). La imagen nunca sale de la máquina.
// Devuelve items {str,x,y,w,h,cx,cy} normalizados — MISMA forma que el extractor de texto digital,
// así todo el pipeline (columnas, roles, saldo, auto-match) funciona idéntico.
import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
const { createWorker } = Tesseract;

let workerPromise = null;
function getWorker(onProgress) {
  if (!workerPromise) {
    const base = new URL("../vendor/tesseract/", import.meta.url).href;
    workerPromise = createWorker("spa", 1, {
      workerPath: base + "worker.min.js",
      corePath: base,
      langPath: base,
      gzip: true,
      logger: (m) => { if (onProgress && m.status === "recognizing text") onProgress(m.progress); },
    });
  }
  return workerPromise;
}

// Corre OCR sobre un canvas/imagen y devuelve items normalizados por su tamaño.
export async function ocrCanvas(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const W = canvas.width, H = canvas.height;
  const items = [];
  for (const w of collectWords(data)) {
    const s = (w.text || "").trim();
    if (!s || !w.bbox) continue;
    const b = w.bbox;
    const x = b.x0 / W, y = b.y0 / H, nw = (b.x1 - b.x0) / W, nh = (b.y1 - b.y0) / H;
    items.push({ str: s, x, y, w: nw, h: nh, cx: x + nw / 2, cy: y + nh / 2 });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  return items;
}

// Tesseract v5 puede devolver data.words o data.blocks→paragraphs→lines→words.
function collectWords(data) {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const blk of data.blocks || [])
    for (const par of blk.paragraphs || [])
      for (const ln of par.lines || [])
        for (const w of ln.words || []) out.push(w);
  return out;
}

// Carga un archivo de imagen a un canvas (lo agranda si es chico, para que el OCR lea mejor).
export async function imageFileToCanvas(file, minWidth = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < minWidth ? minWidth / bmp.width : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close && bmp.close();
  return canvas;
}
