// Lado LIBROS: el mayor de la cuenta Banco, venga del sistema que venga (Holistor, Tango,
// Bejerman, Xubio, Colppy, SOS Contador o un Excel del cliente). Se lee como planilla con un
// MAPEO de columnas (detectado solo por los encabezados, o indicado a mano) y se verifica con
// la misma idea que el extracto: apertura + Debe − Haber == cierre, y fila a fila si hay saldo.
import { parseCsv } from "./csv.js";
import { parseMoneyCents } from "./money.js";
import { toISO } from "./dates.js";
import { normText } from "./text.js";
import { makeMov } from "./model.js";

// Sinónimos de encabezados por rol. En el mayor de una cuenta Banco, "Débitos/Créditos"
// significan Debe/Haber (perspectiva contable), no la del extracto.
const HEADERS = {
  fecha: ["FECHA", "FEC", "FECHA CONTABLE", "FECHA ASIENTO", "F. EMISION", "FECHA EMISION", "FECHA COMPROBANTE"],
  descripcion: ["CONCEPTO", "LEYENDA", "DETALLE", "DESCRIPCION", "GLOSA", "OBSERVACIONES", "REFERENCIA ASIENTO", "MOTIVO"],
  debe: ["DEBE", "DEBITOS", "DEBITO", "INGRESOS", "ENTRADAS", "DEB"],
  haber: ["HABER", "CREDITOS", "CREDITO", "EGRESOS", "SALIDAS", "CRED"],
  importe: ["IMPORTE", "MONTO", "IMPORTE NETO"],
  saldo: ["SALDO", "SALDO ACUMULADO", "SALDO ACUM"],
  comprobante: ["COMPROBANTE", "COMP", "COMPROB", "NRO COMPROBANTE", "NUMERO", "NRO", "CHEQUE", "NRO CHEQUE", "REFERENCIA"],
  asiento: ["ASIENTO", "NRO ASIENTO", "N ASIENTO", "NUM ASIENTO"],
};
const OPENING_RE = /SALDO\s+(ANTERIOR|INICIAL|DE\s+APERTURA|AL\s+INICIO|TRANSPORTE|ARRASTRE)|^TRANSPORTE$/;
const TOTAL_RE = /^(TOTAL(ES)?|SUMAS|SALDO\s+FINAL|SALDO\s+AL\s+CIERRE)\b/;

const normH = (s) => normText(s).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Busca la fila de encabezados y arma el mapeo rol → índice de columna.
 * @param {string[][]} rows
 * @returns {{ headerRow: number, map: Record<string, number> } | null}
 */
export function detectLedgerColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const map = {};
    rows[r].forEach((cell, i) => {
      const h = normH(cell);
      for (const [rol, syns] of Object.entries(HEADERS)) {
        if (map[rol] != null) continue;
        if (syns.includes(h)) { map[rol] = i; break; }
      }
    });
    const tieneImporte = map.importe != null || (map.debe != null && map.haber != null);
    if (map.fecha != null && tieneImporte) return { headerRow: r, map };
  }
  return null;
}

/**
 * Lee un mayor desde CSV.
 * @param {string} text
 * @param {{ map?: Record<string, number>, headerRow?: number, anio?: number, doc?: string,
 *           prefijo?: string, amountMode?: "auto"|"es-AR"|"us" }} [opts]
 * @returns {{ movs: import("./model.js").Mov[], apertura: number|null, cierre: number|null,
 *             control: { ok: boolean|null, calculado: number|null, filasConError: number[] },
 *             mapeo: Record<string, number>, avisos: string[] }}
 */
export function parseLedgerCsv(text, opts = {}) {
  return parseLedgerRows(parseCsv(text), opts);
}

/** Igual que parseLedgerCsv pero sobre filas ya parseadas (sirve para XLSX convertido a filas). */
export function parseLedgerRows(rows, opts = {}) {
  const avisos = [];
  let headerRow = opts.headerRow, map = opts.map;
  if (!map) {
    const det = detectLedgerColumns(rows);
    if (!det) throw new Error("No encontré los encabezados del mayor (Fecha + Debe/Haber o Importe). Indicá el mapeo de columnas.");
    ({ headerRow, map } = det);
  }
  headerRow = headerRow ?? -1;
  const pre = opts.prefijo || "L";
  const money = (row, rol) => (map[rol] != null ? parseMoneyCents(row[map[rol]], opts.amountMode) : null);
  const txt = (row, rol) => (map[rol] != null ? row[map[rol]] || "" : "");

  const movs = [];
  let apertura = null, cierre = null;
  const saldos = []; // [{ idx, saldo }] para el control fila a fila
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const desc = txt(row, "descripcion");
    const lineText = normText(row.join(" "));
    // Apertura: "Saldo anterior" / "Saldo inicial" / "Transporte".
    if (OPENING_RE.test(normText(desc)) || (!txt(row, "fecha") && OPENING_RE.test(lineText))) {
      const s = money(row, "saldo") ?? signed(money(row, "debe"), money(row, "haber"), money(row, "importe"));
      if (s != null && apertura == null && movs.length === 0) apertura = s;
      continue;
    }
    if (TOTAL_RE.test(normText(desc)) || (!txt(row, "fecha") && TOTAL_RE.test(lineText))) {
      const s = money(row, "saldo");
      if (s != null) cierre = s;
      continue;
    }
    const fecha = toISO(txt(row, "fecha"), { anio: opts.anio });
    const cents = signed(money(row, "debe"), money(row, "haber"), money(row, "importe"));
    if (!fecha || cents == null || cents === 0) {
      if (row.some((c) => c) && cents !== 0) avisos.push(`Fila ${r + 1} ignorada (sin fecha o sin importe): ${row.join(" | ").slice(0, 80)}`);
      continue;
    }
    const comp = txt(row, "comprobante"), asiento = txt(row, "asiento");
    const mov = makeMov({
      id: pre + (movs.length + 1),
      lado: "libros",
      fecha,
      cents,
      descripcion: desc,
      referencia: [comp, asiento ? `As. ${asiento}` : ""].filter(Boolean).join(" "),
      saldo: money(row, "saldo"),
      evidencia: { doc: opts.doc, row: r + 1 },
    });
    movs.push(mov);
    if (mov.saldo != null) saldos.push({ idx: movs.length - 1, saldo: mov.saldo });
  }

  // Apertura implícita: si no hay rótulo pero sí saldo corrido, se deduce de la 1ª fila.
  if (apertura == null && movs.length && movs[0].saldo != null) apertura = movs[0].saldo - movs[0].cents;
  if (cierre == null && movs.length && movs[movs.length - 1].saldo != null) cierre = movs[movs.length - 1].saldo;
  if (apertura == null) avisos.push("El mayor no trae saldo inicial: se asume 0.");

  // Control (la "regla del saldo" del lado libros).
  const total = movs.reduce((s, m) => s + m.cents, 0);
  const calculado = (apertura ?? 0) + total;
  const filasConError = [];
  let prev = apertura ?? 0;
  for (const m of movs) {
    if (m.saldo != null) { if (prev + m.cents !== m.saldo) filasConError.push(m.evidencia.row); prev = m.saldo; }
    else prev += m.cents;
  }
  const ok = cierre == null ? (filasConError.length ? false : null) : calculado === cierre && filasConError.length === 0;
  if (cierre == null) cierre = calculado;
  return { movs, apertura: apertura ?? 0, cierre, control: { ok, calculado, filasConError }, mapeo: map, avisos };
}

// Debe/Haber o importe con signo → centavos con signo (Debe +, Haber −).
function signed(debe, haber, importe) {
  if (debe != null || haber != null) {
    const d = Math.abs(debe || 0), h = Math.abs(haber || 0);
    if (!d && !h) return debe != null || haber != null ? 0 : null;
    return d - h;
  }
  return importe;
}
