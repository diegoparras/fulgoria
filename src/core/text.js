// Texto de descripciones bancarias/contables: normalización y similitud.

/** Mayúsculas, sin tildes, espacios simples. "Débito Autom." → "DEBITO AUTOM." */
export function normText(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

// Palabras que no ayudan a distinguir un movimiento de otro.
const STOP = new Set([
  "DE", "LA", "EL", "LOS", "LAS", "Y", "A", "AL", "DEL", "EN", "POR", "PARA", "CON", "S", "SA", "SRL", "SAS",
  "NRO", "NUM", "N", "NO", "CTA", "CUENTA", "BCO", "BANCO", "PAGO", "COBRO", "TRANSFERENCIA", "TRANSF",
]);

/** Tokens significativos (≥3 letras o cualquier número largo). */
export function tokens(s) {
  return normText(s).split(/[^A-Z0-9]+/).filter((t) => t && !STOP.has(t) && (t.length >= 3 || /^\d{4,}$/.test(t)));
}

/** Similitud de Jaccard entre dos descripciones, 0..1. */
export function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
