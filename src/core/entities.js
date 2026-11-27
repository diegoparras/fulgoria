// Entidades que viven DENTRO de las descripciones y sirven para emparejar con certeza:
// CUIT (con dígito verificador), CBU/CVU, número de cheque/ECHEQ, comprobante (0001-00012345),
// número de VEP. Todo determinista: si no está, no se inventa.
import { cuitOk } from "../anon.js";
import { normText } from "./text.js";

const CUIT_RE = /(?<!\d)(\d{2})[ \-]?(\d{8})[ \-]?(\d)(?!\d)/g;
const CBU_RE = /(?<!\d)\d{22}(?!\d)/g;
// "CHEQUE 12345678", "CH. NRO 00012345", "ECHEQ N° 123", "CHQ 4521", "CHEQUE N 4521", "CHEQUE EMITIDO NRO 4521"
// Admite hasta 3 palabras entre "cheque" y el número: "CHEQUE CAMARA NRO 00031598", "CHQ PAGADO POR CAMARA 00062624".
const CHEQUE_RE = /\b(?:E-?CHEQ|CHEQUE|CHQ|CH)\b\.?(?:\s+(?!N(?:RO|UM)?\b|N°)[A-Z]{2,}\.?){0,3}\s*(?:N(?:RO|UM)?\.?|N°|#)?\s*:?\s*(\d{3,10})\b/;
// Comprobante AR: punto de venta (4-5 dígitos) - número (8 dígitos). "0001-00012345"
const COMPROB_RE = /(?<!\d)(\d{4,5})-(\d{8})(?!\d)/g;
const VEP_RE = /\bVEP\b\s*(?:N(?:RO)?\.?|N°)?\s*:?\s*(\d{6,15})/;

/**
 * @param {string} desc
 * @returns {{ cuit?: string, cbu?: string, cheque?: string, comprobante?: string, vep?: string }}
 */
export function extractEntities(desc) {
  const s = normText(desc);
  const out = {};
  for (const m of s.matchAll(CUIT_RE)) {
    const d = m[1] + m[2] + m[3];
    if (cuitOk(d)) { out.cuit = d; break; }
  }
  const cbu = s.match(CBU_RE);
  if (cbu) out.cbu = cbu[0];
  const ch = s.match(CHEQUE_RE);
  if (ch) out.cheque = String(Number(ch[1])); // sin ceros a la izquierda: "00004521" ≡ "4521"
  // Una operación puede citar varios comprobantes (recibo y factura): se guardan todos.
  const cps = [...new Set([...s.matchAll(COMPROB_RE)].map((m) => `${m[1].padStart(5, "0")}-${m[2]}`))];
  if (cps.length) { out.comprobante = cps[0]; if (cps.length > 1) out.comprobantes = cps; }
  const vep = s.match(VEP_RE);
  if (vep) out.vep = vep[1];
  return out;
}

/** Todos los valores de una entidad (comprobante puede tener varios). */
export function valoresEntidad(e, k) {
  if (!e) return [];
  if (k === "comprobante") return e.comprobantes || (e.comprobante ? [e.comprobante] : []);
  return e[k] ? [e[k]] : [];
}

/** Claves compartidas entre dos juegos de entidades (las que identifican la operación). */
export function sharedEntities(a, b) {
  const keys = [];
  for (const k of ["cheque", "comprobante", "vep", "cuit", "cbu"]) {
    const x = valoresEntidad(a, k), y = valoresEntidad(b, k);
    if (x.length && y.length && x.some((v) => y.includes(v))) keys.push(k);
  }
  return keys;
}
