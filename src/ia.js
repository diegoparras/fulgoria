// IA para bancos nuevos: cuando ni las plantillas ni la auto-detección leen bien un extracto, se le
// pide a un modelo (Claude, GPT, OpenRouter o uno local, según configure el estudio) que proponga
// dónde está cada columna. La IA PROPONE y la regla del saldo DECIDE: solo se acepta una propuesta
// con la que los saldos cierran, y entonces queda guardada como plantilla (la IA se usa una vez
// por banco, no una vez por extracto).
//
// PRIVACIDAD: al modelo no le llega el extracto. Le llega un ESQUELETO: por cada línea, la
// posición y el TIPO de cada celda (fecha, importe, texto…) con los importes y las fechas
// reducidos a su formato ("9.999,99-", "99/99/9999"). Se conservan solo los rótulos de columna
// ("FECHA", "DEBITO", "SALDO ANTERIOR"…). Ni nombres, ni descripciones, ni montos, ni cuentas.
import { parseAmount, DATE_RE, evaluarColumnas, ROLES } from "./extract.js";

// Palabras que pueden ir tal cual: rótulos de encabezado y de saldo, nunca datos de nadie.
const ROTULOS = /^(FECHA|F\.?\s*VALOR|FEC\.?|CONCEPTO|DETALLE|DESCRIPCI[OÓ]N|REFERENCIA|REF\.?|COMPROB(ANTE)?\.?|N[ROº°]*\.?|NUMERO|N[UÚ]MERO|D[EÉ]BITOS?|CR[EÉ]DITOS?|IMPORTE|MONTO|SALDO|SALDOS|D\/H|DB\/CR|ORIGEN|SUCURSAL|SUC\.?|CAUSAL|MOVIMIENTO|MOVIMIENTOS|C[OÓ]DIGO|COD\.?|CARGOS?|ABONOS?|DEPOSITOS?|EXTRACCIONES|RETIROS|OPERACI[OÓ]N|PAGINA|P[AÁ]GINA|DE|TOTAL(ES)?|SALDO\s+(ANTERIOR|INICIAL|FINAL|ACTUAL|AL)|SALDO\s+[UÚ]LTIMO\s+EXTRACTO|TRANSPORTE)$/i;
const SIGNO = /^(D|H|DB|CR|C|DEB|CRED)$/i;
const PATRON = (s) => String(s).replace(/\d/g, "9");

function tipoCelda(str) {
  const t = String(str).trim();
  if (!t) return null;
  if (DATE_RE.test(t) && t.replace(DATE_RE, "").trim().length <= 2) return { t: "fecha", m: PATRON(t.match(DATE_RE)[0]) };
  if (/^\d{1,2}\/\d{1,2}$/.test(t)) return { t: "fecha", m: PATRON(t) };
  if (parseAmount(t) != null && /^(?:U\$S|USD|\$)?\s*[-(]?\s*(?:\$\s*)?\d[\d.,]*\s*[-)]?$/i.test(t)) return { t: "importe", m: PATRON(t) };
  if (SIGNO.test(t)) return { t: "signo", m: t.toUpperCase() };
  if (/^[\d\s.\-/]+$/.test(t)) return { t: "numero", m: `${t.replace(/\D/g, "").length} dígitos` };
  if (ROTULOS.test(t)) return { t: "rotulo", m: t.toUpperCase() };
  // Línea de saldo con texto + importe en un solo ítem ("Saldo inicial al 01/06: $ 1.234,56").
  // Solo las dos primeras palabras ("SALDO INICIAL"): el resto puede traer cualquier cosa.
  if (/^saldo\s+(anterior|inicial|final|al|actual)/i.test(t)) return { t: "rotulo_saldo", m: t.split(/\s+/).slice(0, 2).join(" ").toUpperCase() + (parseAmount(t) != null ? " + importe" : "") };
  return { t: "texto" };
}

function lineas(items, tol = 0.006) {
  const out = [];
  for (const it of [...items].sort((a, b) => a.cy - b.cy || a.x - b.x)) {
    const l = out[out.length - 1];
    if (l && Math.abs(it.cy - l.cy) <= tol) l.items.push(it); else out.push({ cy: it.cy, items: [it] });
  }
  return out;
}
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Esqueleto anónimo del extracto para el modelo.
 * @param {Array<{items: Array<{str,x,w,cx,cy}>}>} pages
 * @returns {{ paginas: number, lineas: string[] }} cada línea: "0.050-0.120 fecha(99/99/9999) | 0.160-0.420 texto | …"
 */
export function esqueletoDePdf(pages, { maxLineas = 70 } = {}) {
  // La página con más importes (la tabla) y, si es otra, la primera (encabezado y saldo anterior).
  const cuenta = (p) => p.items.filter((it) => tipoCelda(it.str)?.t === "importe").length;
  const idx = pages.reduce((b, p, i) => (cuenta(p) > cuenta(pages[b]) ? i : b), 0);
  const elegidas = [...new Set([0, idx])].map((i) => pages[i]).filter(Boolean);
  const out = [];
  for (const pg of elegidas) {
    for (const l of lineas(pg.items)) {
      const celdas = l.items.sort((a, b) => a.x - b.x).map((it) => {
        const c = tipoCelda(it.str);
        if (!c) return null;
        return `${r3(it.x).toFixed(3)}-${r3(it.x + it.w).toFixed(3)} ${c.t}${c.m ? `(${c.m})` : ""}`;
      }).filter(Boolean);
      if (celdas.length) out.push(celdas.join(" | "));
      if (out.length >= maxLineas) break;
    }
    if (out.length >= maxLineas) break;
  }
  return { paginas: pages.length, lineas: out };
}

/** Lleva una propuesta del modelo a columnas de Fulgoria (ordenadas, sin solaparse, dentro de 0..1). */
export function columnasDePropuesta(p) {
  const cols = (p?.columnas || [])
    .filter((c) => c && ROLES.includes(c.rol) && Number.isFinite(+c.desde) && Number.isFinite(+c.hasta))
    .map((c) => ({ from: Math.max(0, Math.min(1, +c.desde)), to: Math.max(0, Math.min(1, +c.hasta)), role: c.rol }))
    .filter((c) => c.to - c.from > 0.004)
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < cols.length; i++) if (cols[i].from < cols[i - 1].to) cols[i].from = cols[i - 1].to;
  const vistas = {};
  return cols.filter((c) => c.to - c.from > 0.004).map((c) => {
    vistas[c.role] = (vistas[c.role] || 0) + 1;
    const base = { fecha: "Fecha", descripcion: "Descripción", importe: "Importe", debito: "Débito", credito: "Crédito", saldo: "Saldo", signo: "D/H", texto: "Texto", ignorar: "Ignorar" }[c.role];
    return { ...c, label: vistas[c.role] > 1 ? `${base} ${vistas[c.role]}` : base };
  });
}

/**
 * La regla del saldo decide: de las propuestas del modelo, la mejor que hace cerrar los saldos.
 * @returns {{ columnas, verificado: boolean, indice: number, explicacion: string } | null}
 */
export function elegirPropuesta(pages, propuestas) {
  let mejor = null;
  (propuestas || []).forEach((p, i) => {
    const columnas = columnasDePropuesta(p);
    if (!columnas.some((c) => ["importe", "debito", "credito"].includes(c.role))) return;
    const ev = evaluarColumnas(pages, columnas);
    if (!mejor || ev.puntaje > mejor.puntaje) mejor = { columnas, verificado: ev.verificado, puntaje: ev.puntaje, indice: i, explicacion: String(p.explicacion || "") };
  });
  return mejor;
}
