// Utilidades del generador del dataset sintético: azar con semilla (reproducible), nombres
// ficticios, CUIT con dígito verificador, fechas y formatos de importe.
//
// TODO es ficticio: bancos, empresas, personas, CUIT y números de cuenta. Los CUIT se generan
// al azar con dígito verificador válido para que los detectores funcionen; no corresponden a
// nadie en particular (si alguno coincidiera con uno real, es casualidad).

/** Generador pseudoaleatorio con semilla (mulberry32). Misma semilla → mismo dataset. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** Importe en centavos, "redondeado" como en la vida real (a veces cerrado, a veces con centavos). */
    cents: (minPesos, maxPesos) => {
      const v = minPesos + next() * (maxPesos - minPesos);
      const k = next();
      if (k < 0.35) return Math.round(v / 1000) * 100000;      // múltiplo de $1.000
      if (k < 0.6) return Math.round(v / 10) * 1000;           // múltiplo de $10
      return Math.round(v * 100);                              // con centavos
    },
    shuffle: (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
  return r;
}

export const EMPRESAS = [
  "Distribuidora Los Álamos SRL", "Agro Sur del Plata SA", "Ferretería El Tornillo SRL", "Logística Andina SAS",
  "Panificadora La Espiga SRL", "Textil Río Bermejo SA", "Metalúrgica San Telmo SRL", "Farmacia Del Parque SCS",
  "Estudio Gráfico Cobalto SAS", "Viñedos Altos de Cuyo SA", "Constructora Delta Norte SRL", "Lácteos Valle Verde SA",
  "Tecnología Austral SAS", "Transporte Ruta 3 SRL", "Óptica Mirador SRL", "Librería El Faro SA",
  "Frigorífico Pampa Alta SA", "Cooperativa Hornero Ltda", "Química Litoral SRL", "Muebles Quebracho SAS",
  "Imprenta Tinta Fresca SRL", "Bodega Piedra Negra SA", "Servicios Médicos Lomas SRL", "Hotel Cerro Azul SA",
];
export const PERSONAS = [
  "Martina Gómez", "Lucas Fernández", "Sofía Ramírez", "Joaquín Pereyra", "Valentina Sosa", "Tomás Acosta",
  "Camila Herrera", "Mateo Benítez", "Julieta Medina", "Santiago Rojas", "Florencia Díaz", "Agustín Molina",
  "Paula Castro", "Nicolás Romero", "Lucía Ortiz", "Franco Silva", "Carolina Núñez", "Ignacio Vera",
];
export const SERVICIOS = ["Energía Metropolitana", "Gas del Litoral", "Aguas Urbanas", "Telefonía Federal", "Internet Fibra Sur", "Seguros La Previsora", "Alquileres Centro SA"];

/** CUIT/CUIL con dígito verificador válido (módulo 11). */
export function cuit(r, persona = false) {
  for (;;) {
    const pre = persona ? r.pick(["20", "27", "23"]) : r.pick(["30", "33"]);
    const dni = String(r.int(persona ? 10000000 : 50000000, persona ? 45999999 : 72999999));
    const d = pre + dni;
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const tot = w.reduce((a, wi, i) => a + wi * +d[i], 0);
    let chk = 11 - (tot % 11);
    if (chk === 11) chk = 0;
    if (chk === 10) continue; // ese prefijo/DNI no admite dígito: probar otro
    return d + chk;
  }
}
export const fmtCuit = (c) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

// --- Fechas ISO ---
export function iso(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
/** Día hábil (lunes a viernes) igual o posterior. */
export function habil(isoDate) {
  let x = isoDate;
  for (;;) { const dow = new Date(x + "T12:00:00Z").getUTCDay(); if (dow !== 0 && dow !== 6) return x; x = addDays(x, 1); }
}
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// --- Formatos de importe (centavos → texto) ---
/** es-AR: 1.234.567,89 */
export function fAR(c, { signo = "menos", moneda = false } = {}) {
  const neg = c < 0, a = Math.abs(c);
  const s = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + String(a % 100).padStart(2, "0");
  const body = (moneda ? "$ " : "") + s;
  if (!neg) return body;
  if (signo === "parentesis") return "(" + body + ")";
  if (signo === "atras") return body + "-";
  return "-" + body;
}
/** US: 1,234,567.89 */
export function fUS(c) {
  const neg = c < 0, a = Math.abs(c);
  return (neg ? "-" : "") + Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(a % 100).padStart(2, "0");
}
/** Plano: 1234567.89 (como sale de una planilla sin formato) */
export function fPlano(c) { const neg = c < 0, a = Math.abs(c); return (neg ? "-" : "") + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0"); }

// --- Fechas en texto ---
export function fDate(isoDate, estilo) {
  const [y, m, d] = isoDate.split("-");
  switch (estilo) {
    case "DD/MM/AAAA": return `${d}/${m}/${y}`;
    case "DD/MM/AA": return `${d}/${m}/${y.slice(2)}`;
    case "D/M/AAAA": return `${+d}/${+m}/${y}`;
    case "DD-MM-AA": return `${d}-${m}-${y.slice(2)}`;
    case "AAAA-MM-DD": return isoDate;
    case "DD/MM": return `${d}/${m}`;
    default: throw new Error("estilo de fecha " + estilo);
  }
}

/** Redondeo de un porcentaje sobre centavos (como lo calcula un banco). */
export const pct = (c, p) => Math.round(Math.abs(c) * p / 100);
