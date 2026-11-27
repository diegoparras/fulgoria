// Dinero en CENTAVOS ENTEROS. Todo el núcleo de conciliación trabaja en centavos para que
// ninguna suma arrastre errores de coma flotante (0,1 + 0,2 ≠ 0,3). La plata se convierte
// una sola vez al entrar (toCents) y otra al salir (fmtCents).

/** Número (pesos, puede tener decimales) → centavos enteros. null/NaN → null. */
export function toCents(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100);
}

/** Centavos → número en pesos (para exportar a sistemas que piden decimal). */
export function fromCents(c) {
  return c == null ? null : c / 100;
}

/**
 * Parseo TOLERANTE de importes para planillas (mayores en CSV/Excel). A diferencia de
 * parseAmount de extract.js —que exige pinta de plata para no confundir fechas/CUIT en un
 * PDF— acá la columna ya es de importes, así que aceptamos enteros ("1234"), es-AR
 * ("1.234,56"), yanqui ("1,234.56"), signo adelante/atrás y paréntesis contables.
 * Devuelve CENTAVOS o null si la celda está vacía o no es un número.
 * @param {string|number} s
 * @param {"auto"|"es-AR"|"us"} [mode]
 */
export function parseMoneyCents(s, mode = "auto") {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? Math.round(s * 100) : null;
  const raw = String(s).trim();
  if (!raw || !/\d/.test(raw)) return null;
  // Negativo: un "-" (adelante o atrás, "$ -1.234,56" o "1.234,56-") o paréntesis contables.
  const neg = /-/.test(raw) || /^\(.*\)$/.test(raw.replace(/[\s$]/g, ""));
  let t = raw.replace(/[^\d.,]/g, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  let dec = "";
  if (mode === "es-AR") dec = ",";
  else if (mode === "us") dec = ".";
  else if (lastComma >= 0 && lastDot >= 0) dec = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) dec = /,\d{1,2}$/.test(t) ? "," : "";     // "1.234" sin coma = miles
  else if (lastDot >= 0) dec = /\.\d{1,2}$/.test(t) && (t.match(/\./g) || []).length === 1 ? "." : "";
  let clean;
  if (dec) {
    const mil = dec === "," ? "." : ",";
    clean = t.split(mil).join("");
    const i = clean.lastIndexOf(dec);
    clean = clean.slice(0, i).split(dec).join("") + "." + clean.slice(i + 1);
  } else clean = t.replace(/[.,]/g, "");
  const n = Number(clean);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return neg ? -c : c;
}

/**
 * Centavos → texto es-AR ("1.234,56", "-1.234,56"). opts.signo: "menos" | "parentesis".
 * @param {number|null} c
 * @param {{ signo?: "menos"|"parentesis", moneda?: string }} [opts]
 */
export function fmtCents(c, opts = {}) {
  if (c == null) return "";
  const neg = c < 0;
  const abs = Math.abs(c);
  const ent = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = (opts.moneda ? opts.moneda + " " : "") + ent + "," + String(abs % 100).padStart(2, "0");
  if (!neg) return body;
  return opts.signo === "parentesis" ? "(" + body + ")" : "-" + body;
}

/** Suma de centavos de una lista de objetos con `cents`. */
export function sumCents(list) {
  let s = 0;
  for (const x of list) s += x.cents || 0;
  return s;
}
