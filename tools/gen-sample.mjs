// Genera un extracto de cuenta corriente AR sintético (banco ficticio, datos truchos).
// PDF digital con capa de texto: PDF.js podrá leer cada palabra con sus coordenadas.
// El saldo reconcilia: saldo_anterior + sum(credito) - sum(debito) == saldo_final.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

// --- Datos del extracto (en centavos para no arrastrar errores de float) ---
const opening = 15_000_00; // $150.000,00

// Cada movimiento: [dia, detalle, debito_centavos, credito_centavos]
// Las descripciones con "\n" prueban el caso multilínea (segunda línea sin fecha).
const movs = [
  ["02/06/2026", "TRANSFERENCIA RECIBIDA CBU\nCLIENTE PROVEEDOR SRL", 0, 8_500_00],
  ["03/06/2026", "PAGO PROVEEDORES VARIOS", 3_200_50, 0],
  ["05/06/2026", "DEBITO AUTOMATICO SERVICIOS", 1_145_00, 0],
  ["08/06/2026", "DEPOSITO EFECTIVO SUCURSAL CENTRO", 0, 12_000_00],
  ["09/06/2026", "COMISION MANTENIMIENTO CUENTA", 980_00, 0],
  ["10/06/2026", "IMPUESTO LEY 25.413 DEBITOS", 58_80, 0],
  ["12/06/2026", "TRANSFERENCIA RECIBIDA\nHONORARIOS ESTUDIO CONTABLE", 0, 4_300_00],
  ["15/06/2026", "PAGO TARJETA CORPORATIVA", 6_750_25, 0],
  ["17/06/2026", "ACREDITACION INTERESES PLAZO FIJO", 0, 1_240_00],
  ["19/06/2026", "DEBITO AUTOMATICO ALQUILER", 9_500_00, 0],
  ["22/06/2026", "RETIRO CAJERO AUTOMATICO", 2_000_00, 0],
  ["24/06/2026", "TRANSFERENCIA RECIBIDA VENTA\nFACTURA A 0001-00012345", 0, 18_900_00],
  ["26/06/2026", "PERCEPCION IIBB CABA", 412_30, 0],
  ["29/06/2026", "PAGO SUELDOS PERSONAL", 14_300_00, 0],
];

// --- Formato es-AR: 1.234.567,89 ---
function fmt(cents) {
  const neg = cents < 0;
  const s = Math.abs(cents).toString().padStart(3, "0");
  const dec = s.slice(-2);
  let int = s.slice(0, -2);
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + int + "," + dec;
}

const doc = await PDFDocument.create();
const page = doc.addPage([595, 842]); // A4 en puntos
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const ink = rgb(0.1, 0.12, 0.16);
const grey = rgb(0.45, 0.48, 0.52);

const W = 595;
function text(s, x, y, { f = font, size = 9, color = ink } = {}) {
  page.drawText(s, { x, y, size, font: f, color });
}
// Texto alineado a la derecha terminando en el borde `xRight`.
function textR(s, xRight, y, { f = font, size = 9, color = ink } = {}) {
  const w = f.widthOfTextAtSize(s, size);
  text(s, xRight - w, y, { f, size, color });
}

// Bordes derechos de las columnas numéricas
const X_DEB = 400;
const X_CRE = 480;
const X_SAL = 555;
const X_FECHA = 40;
const X_DET = 105;

// --- Encabezado del banco (texto estructural, sin PII) ---
text("Banco del Río", 40, 800, { f: bold, size: 16 });
text("Resumen de Cuenta Corriente en Pesos", 40, 783, { size: 10, color: grey });
text("Período: 01/06/2026 al 30/06/2026", 40, 769, { size: 9, color: grey });
text("Cuenta Corriente Nº 0000-00000000-0", 40, 755, { size: 9, color: grey });

// --- Rótulos de columna (anclas) ---
const yHead = 712;
text("FECHA", X_FECHA, yHead, { f: bold, size: 9 });
text("DETALLE", X_DET, yHead, { f: bold, size: 9 });
textR("DEBITO", X_DEB, yHead, { f: bold, size: 9 });
textR("CREDITO", X_CRE, yHead, { f: bold, size: 9 });
textR("SALDO", X_SAL, yHead, { f: bold, size: 9 });
page.drawLine({ start: { x: 40, y: yHead - 5 }, end: { x: 555, y: yHead - 5 }, thickness: 0.7, color: grey });

// --- Fila de saldo anterior ---
let y = yHead - 22;
let saldo = opening;
text("SALDO ANTERIOR", X_DET, y, { size: 9 });
textR(fmt(saldo), X_SAL, y, { size: 9 });
y -= 18;

// --- Movimientos ---
let sumDeb = 0, sumCre = 0;
for (const [fecha, detalle, deb, cre] of movs) {
  sumDeb += deb; sumCre += cre;
  saldo += cre - deb;
  const lines = detalle.split("\n");
  text(fecha, X_FECHA, y, { size: 9 });
  text(lines[0], X_DET, y, { size: 9 });
  if (deb) textR(fmt(deb), X_DEB, y, { size: 9 });
  if (cre) textR(fmt(cre), X_CRE, y, { size: 9 });
  textR(fmt(saldo), X_SAL, y, { size: 9 });
  y -= 14;
  // líneas de continuación de la descripción (sin fecha)
  for (let i = 1; i < lines.length; i++) {
    text(lines[i], X_DET, y, { size: 8, color: grey });
    y -= 14;
  }
  y -= 2;
}

// --- Fila de saldo final ---
y -= 6;
page.drawLine({ start: { x: 40, y: y + 10 }, end: { x: 555, y: y + 10 }, thickness: 0.7, color: grey });
text("SALDO FINAL", X_DET, y, { f: bold, size: 9 });
textR(fmt(saldo), X_SAL, y, { f: bold, size: 9 });

// Verificación de consistencia del propio generador
const check = opening + sumCre - sumDeb;
if (check !== saldo) throw new Error(`No reconcilia: ${check} != ${saldo}`);

text("Documento de prueba sintético — datos ficticios — Fulgoria", 40, 40, { size: 7, color: grey });

const bytes = await doc.save();
writeFileSync(new URL("../samples/banco-rio-cc.pdf", import.meta.url), bytes);
console.log(`OK  banco-rio-cc.pdf  | apertura ${fmt(opening)}  débitos ${fmt(sumDeb)}  créditos ${fmt(sumCre)}  saldo final ${fmt(saldo)}`);
