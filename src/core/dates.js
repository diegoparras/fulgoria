// Fechas del núcleo: siempre ISO "AAAA-MM-DD" (ordenable como texto, sin zona horaria).
// Los extractos argentinos traen DD/MM/AAAA, DD/MM/AA, a veces DD/MM sin año, o ISO.

/**
 * Texto de fecha → "AAAA-MM-DD" o null.
 * @param {string} raw
 * @param {{ anio?: number }} [opts] año por defecto cuando la fecha viene sin año ("15/06").
 */
export function toISO(raw, opts = {}) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; }
  else {
    m = s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if (!m) return null;
    [, d, mo, y] = m;
    if (!y) { if (!opts.anio) return null; y = String(opts.anio); }
    if (y.length === 2) y = "20" + y;
  }
  const yi = +y, mi = +mo, di = +d;
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  if (dt.getUTCMonth() !== mi - 1) return null; // 31/02 y similares
  return `${String(yi).padStart(4, "0")}-${String(mi).padStart(2, "0")}-${String(di).padStart(2, "0")}`;
}

/** Número de día absoluto (para restar fechas ISO). */
export function dayNum(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Días de `a` a `b` (b − a). Positivo si b es posterior. */
export function daysBetween(a, b) {
  const x = dayNum(a), y = dayNum(b);
  return x == null || y == null ? null : y - x;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" (presentación es-AR). */
export function fmtISO(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
