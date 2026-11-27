// Parser CSV (RFC 4180) con detección de separador. Los mayores exportados por sistemas
// contables argentinos suelen venir con ";" (Excel es-AR), a veces "," o tabulador.

/** Adivina el separador mirando las primeras líneas (fuera de comillas). */
export function detectSeparator(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  let best = ",", bestN = -1;
  for (const sep of [";", ",", "\t", "|"]) {
    let n = 0, q = false;
    for (const ch of sample) { if (ch === '"') q = !q; else if (!q && ch === sep) n++; }
    if (n > bestN) { best = sep; bestN = n; }
  }
  return best;
}

/**
 * @param {string} text
 * @param {{ sep?: string }} [opts]
 * @returns {string[][]} filas de celdas (sin BOM, sin filas totalmente vacías)
 */
export function parseCsv(text, opts = {}) {
  const src = String(text || "").replace(/^﻿/, "");
  const sep = opts.sep || detectSeparator(src);
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}
