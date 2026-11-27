// Entidades que viven DENTRO de las descripciones y sirven para emparejar con certeza:
// CUIT (con dígito verificador), CBU/CVU, número de cheque/ECHEQ, comprobante (0001-00012345),
// número de VEP. Todo determinista: si no está, no se inventa.
import { cuitOk } from "../anon.js";
import { normText } from "./text.js";

const CUIT_RE = /(?<!\d)(\d{2})[ \-]?(\d{8})[ \-]?(\d)(?!\d)/g;
const CBU_RE = /(?<!\d)\d{22}(?!\d)/g;
// "CHEQUE 12345678", "CH. NRO 00012345", "ECHEQ N° 123", "CHQ 4521", "CHEQUE N 4521"
const CHEQUE_RE = /\b(?:E-?CHEQ|CHEQUE|CHQ|CH)\b\.?\s*(?:(?:EMITIDO|DIFERIDO|PROPIO|ELECTRONICO|DE\s+TERCEROS|DEPOSITADO|PAGADO)\s*)*(?:N(?:RO|UM)?\.?|N°|#)?\s*:?\s*(\d{3,10})\b/;
// Comprobante AR: punto de venta (4-5 dígitos) - número (8 dígitos). "0001-00012345"
const COMPROB_RE = /(?<!\d)(\d{4,5})-(\d{8})(?!\d)/;
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
  const cp = s.match(COMPROB_RE);
  if (cp) out.comprobante = `${cp[1].padStart(5, "0")}-${cp[2]}`;
  const vep = s.match(VEP_RE);
  if (vep) out.vep = vep[1];
  return out;
}

/** Claves compartidas entre dos juegos de entidades (las que identifican la operación). */
export function sharedEntities(a, b) {
  const keys = [];
  for (const k of ["cheque", "comprobante", "vep", "cuit", "cbu"]) if (a[k] && b[k] && a[k] === b[k]) keys.push(k);
  return keys;
}
