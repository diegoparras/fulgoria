// Formato de asientos aprendido de un EJEMPLO. El contador sube un archivo de importación de
// asientos que su sistema contable acepta (Excel, CSV, TXT con separadores o de ancho fijo) y
// Fulgoria deduce cómo es: columnas, orden, formato de fechas e importes, cómo numera los
// asientos, si cada asiento lleva una fila de cabecera… Con eso genera los asientos propuestos en
// el MISMO formato. El formato guarda FORMA, nunca datos: los valores del ejemplo no se guardan
// (salvo los que son iguales en todas las filas, como un "circuito" o una sucursal: van fijos).
import { leerXlsx } from "./xlsx.js";
import { escribirXlsx } from "./xlsx-escribir.js";
import { normText } from "./text.js";

export const ROLES_ASIENTO = {
  fecha: "Fecha", asiento: "Número de asiento", cuenta: "Cuenta", debe: "Debe", haber: "Haber",
  importe: "Importe (con D/H en otra columna)", importeConSigno: "Importe con signo (negativo = Haber)", importeDH: "Importe con D/H pegado (1980.00D)", signo: "Debe/Haber (D/H)",
  concepto: "Concepto del asiento", detalle: "Detalle de la línea", fijo: "Valor fijo", vacio: "Vacía",
};

const normH = (s) => normText(String(s ?? "")).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const TITULOS = [
  ["fecha", /^(FECHA|FEC|F)( (DEL )?(ASIENTO|CONTABLE|EMISION|OPERACION|MOVIMIENTO|IMPUTACION))?$/],
  ["asiento", /^((NRO|NUM|NUMERO|N|NO)( DE)? )?ASIENTO( NRO| NUMERO| N)?$|^(NRO|NUMERO|NUM) ASTO$|^ASTO$/],
  ["cuenta", /^((COD|CODIGO|NRO|NUMERO|NUM)( DE)? )?(CUENTA|CTA)( CONTABLE| COD| CODIGO)?$|^IMPUTACION$|^CODIGO$/],
  ["debe", /^(DEBE|DEBITOS?|DEB|IMPORTE DEBE|MONTO DEBE)$/],
  ["haber", /^(HABER|CREDITOS?|CRED|IMPORTE HABER|MONTO HABER)$/],
  ["signo", /^(D H|DH|SIGNO|DEBE HABER|TIPO MOV(IMIENTO)?|D C|DC)$/],
  ["importe", /^(IMPORTE|MONTO|VALOR|IMPORTE MONEDA (LOCAL|CORRIENTE))$/],
  ["concepto", /^(CONCEPTO|CONCEPTO (DEL )?ASIENTO|LEYENDA ASIENTO|DESCRIPCION ASIENTO|GLOSA)$/],
  ["detalle", /^(LEYENDA|DESCRIPCION|DETALLE|OBSERVACION(ES)?|REFERENCIA|TEXTO|DETALLE (DE LA )?LINEA)$/],
];

// ---------------------------------------------------------------- leer el ejemplo
function decodificar(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bom = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
  let texto, codificacion;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bom ? u8.subarray(3) : u8); codificacion = /[^\x00-\x7f]/.test(texto) || bom ? "utf-8" : "latin1"; }
  catch { texto = new TextDecoder("windows-1252").decode(u8); codificacion = "latin1"; }
  return { texto, codificacion, bom };
}
function partirDelimitado(linea, sep) {
  const out = []; let cell = "", q = false, comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (q) { if (ch === '"') { if (linea[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && cell.trim() === "") { q = true; comillas = true; cell = ""; }
    else if (ch === sep) { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return { celdas: out.map((c) => c.trim()), comillas };
}
// Ancho fijo: las columnas son los tramos donde alguna línea tiene texto, separados por posiciones
// que son espacio en TODAS las líneas.
function anchosFijos(lineas) {
  const largo = Math.max(...lineas.map((l) => l.length));
  const ocupado = Array.from({ length: largo }, (_, i) => lineas.some((l) => l[i] && l[i] !== " "));
  const tramos = [];
  for (let i = 0; i < largo; i++) if (ocupado[i] && !ocupado[i - 1]) tramos.push([i, i + 1]); else if (ocupado[i]) tramos[tramos.length - 1][1] = i + 1;
  // Cada columna va desde donde empieza su texto hasta donde empieza la siguiente (incluye el relleno);
  // "fin" es hasta dónde llega el texto (para alinear a la derecha).
  return tramos.map(([a, b], k) => ({ desde: k === 0 ? 0 : a, hasta: k + 1 < tramos.length ? tramos[k + 1][0] : largo, fin: b }));
}

/**
 * Lee el archivo de ejemplo → filas de celdas + cómo es el archivo.
 * @returns {Promise<{ archivo: object, rows: string[][], tipos: string[][]|null, vacias: number[] }>}
 */
export async function leerEjemplo(nombre, bytes) {
  const ext = (String(nombre).match(/\.([a-z0-9]+)$/i) || [, "txt"])[1].toLowerCase();
  if (ext === "xlsx") {
    const { hojas } = await leerXlsx(bytes);
    const h = hojas.find((x) => x.rows.some((r) => r.some((c) => c))) || hojas[0];
    const vacias = h.rows.map((r, i) => (r.some((c) => c) ? -1 : i)).filter((i) => i >= 0);
    return { archivo: { tipo: "xlsx", ext, hoja: h.nombre }, rows: h.rows, tipos: h.tipos, vacias };
  }
  if (ext === "xls") throw new Error("Ese es el formato viejo de Excel (.xls): abrilo y guardalo como .xlsx, o exportá el ejemplo como CSV o TXT.");
  const { texto, codificacion, bom } = decodificar(bytes);
  const eol = /\r\n/.test(texto) ? "\r\n" : "\n";
  const finalNL = /\r?\n$/.test(texto);
  const lineas = texto.replace(/\r?\n$/, "").split(/\r?\n/);
  const llenas = lineas.filter((l) => l.trim());
  if (!llenas.length) throw new Error("El ejemplo está vacío.");
  // ¿Delimitado? El separador que aparece la misma cantidad de veces (≥1) en casi todas las líneas.
  let sep = null;
  for (const s of ["\t", ";", "|", ","]) {
    const n = llenas.map((l) => partirDelimitado(l, s).celdas.length);
    const moda = n.sort((a, b) => n.filter((x) => x === b).length - n.filter((x) => x === a).length)[0];
    if (moda > 1 && n.filter((x) => x === moda).length >= llenas.length * 0.8) { sep = s; break; }
  }
  const vacias = lineas.map((l, i) => (l.trim() ? -1 : i)).filter((i) => i >= 0);
  const base = { ext, codificacion, bom, eol, finalNL };
  if (sep) {
    let comillas = false;
    const rows = lineas.map((l) => { const p = partirDelimitado(l, sep); comillas ||= p.comillas; return l.trim() ? p.celdas : []; });
    return { archivo: { ...base, tipo: "delimitado", delimitador: sep, comillas }, rows, tipos: null, vacias };
  }
  const anchos = anchosFijos(llenas);
  const rows = lineas.map((l) => (l.trim() ? anchos.map((a) => l.slice(a.desde, a.hasta).trim()) : []));
  // Alineación: a la derecha si en todas las líneas el valor termina pegado al borde de la columna
  // y en alguna empieza con espacios (los importes suelen ir así).
  const alinear = anchos.map((a, k) => {
    const trozos = llenas.map((l) => l.slice(a.desde, a.fin)).filter((t) => t.trim());
    if (k === anchos.length - 1) return "izq";
    return trozos.every((t) => t.length === a.fin - a.desde && !/\s$/.test(t)) && trozos.some((t) => /^\s/.test(t)) ? "der" : "izq";
  });
  return { archivo: { ...base, tipo: "fijo", anchos: anchos.map((a, i) => ({ ancho: a.hasta - a.desde, alinear: alinear[i], contenido: a.fin - a.desde, ultima: i === anchos.length - 1 })) }, rows, tipos: null, vacias };
}

// ---------------------------------------------------------------- reconocer valores
const FECHA_SEP = /^(\d{1,4})([\/\-.])(\d{1,2})\2(\d{1,4})$/;
function patronFecha(valores) {
  const v = valores.filter(Boolean);
  if (!v.length) return null;
  if (v.every((x) => /^\d{8}$/.test(x))) {
    const ok = (p) => v.every((x) => {
      const g = (t) => +x.slice(p.indexOf(t), p.indexOf(t) + t.length);
      return g("MM") >= 1 && g("MM") <= 12 && g("DD") >= 1 && g("DD") <= 31 && g("AAAA") >= 1900 && g("AAAA") <= 2100;
    });
    return ["AAAAMMDD", "DDMMAAAA", "MMDDAAAA", "AAAADDMM"].find(ok) || null;
  }
  if (v.every((x) => /^\d{6}$/.test(x))) return v.every((x) => +x.slice(2, 4) >= 1 && +x.slice(2, 4) <= 12) ? "DDMMAA" : null;
  const m = v.map((x) => x.match(FECHA_SEP));
  if (!m.every(Boolean)) return null;
  const s = m[0][2];
  if (m[0][1].length === 4) return `AAAA${s}${m.some((x) => x[3].length === 1) ? "M" : "MM"}${s}${m.some((x) => x[4].length === 1) ? "D" : "DD"}`;
  const anio = m[0][4].length === 4 ? "AAAA" : "AA";
  const mesPrimero = m.some((x) => +x[3] > 12) && m.every((x) => +x[1] <= 12);
  const corto1 = m.some((x) => x[1].length === 1), corto2 = m.some((x) => x[3].length === 1);
  const [a, b] = mesPrimero ? ["M", "D"] : ["D", "M"];
  return `${corto1 ? a : a + a}${s}${corto2 ? b : b + b}${s}${anio}`;
}
export function formatearFecha(iso, patron) {
  const [y, m, d] = iso.split("-");
  const t = { AAAA: y, AA: y.slice(2), MM: m, M: String(+m), DD: d, D: String(+d) };
  return patron.replace(/AAAA|AA|MM|M|DD|D/g, (k) => t[k]);
}

// Un importe: miles en grupos de 3 y hasta 2-4 decimales ("1.980,00", "1980.00", "-150,5", "(12,00)").
// Un código de cuenta como "4.1.1.01" no lo es (grupos que no son de 3).
const NUM_RE = /^\(?-?\s*\$?\s*(\d{1,3}([.,]\d{3})+|\d+)([.,]\d{1,4})?\s*-?\)?$/;
const esNumero = (x) => NUM_RE.test(x);
const DH_PEGADO = /^-?\s*(\d{1,3}([.,]\d{3})+|\d+)([.,]\d{1,4})?\s*([DH])$/i;
function formatoImporte(valores, tipos) {
  const v = valores.filter(Boolean);
  const f = { decimal: ",", miles: "", decimales: 2, negativo: "-x", cero: "vacio", excel: !!tipos && tipos.some((t) => t === "numero") };
  if (f.excel) return f;
  const decs = {}, miles = {};
  let maxDec = 0;
  for (const x of v) {
    const t = x.replace(/[^\d.,]/g, "");
    const ult = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
    if (ult < 0) continue;
    const cola = t.slice(ult + 1), antes = t.slice(0, ult).replace(/\d/g, "");
    if (cola.length === 1 || cola.length === 2) {
      decs[t[ult]] = (decs[t[ult]] || 0) + 1; maxDec = Math.max(maxDec, cola.length);
      if (antes && antes[0] !== t[ult]) miles[antes[0]] = (miles[antes[0]] || 0) + 1;
    } else if (cola.length === 3) miles[t[ult]] = (miles[t[ult]] || 0) + 1; // "1.980" = miles
  }
  const masVisto = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];
  const dec = masVisto(decs), mil = masVisto(miles);
  if (dec) { f.decimal = dec; f.decimales = Math.max(2, maxDec); f.miles = mil && mil !== dec ? mil : ""; }
  else { f.dudoso = true; f.miles = mil || ""; f.decimal = mil === "," ? "." : ","; }
  if (v.some((x) => /^\(.*\)$/.test(x))) f.negativo = "(x)";
  else if (v.some((x) => /\d-$/.test(x))) f.negativo = "x-";
  if (v.some((x) => /^0+([.,]0+)?$/.test(x))) f.cero = "cero";
  return f;
}
export function formatearImporte(cents, f, { abs = true } = {}) {
  const neg = !abs && cents < 0;
  const n = Math.abs(cents) / 100;
  if (f.excel) return abs ? n : neg ? -n : n;
  let [ent, dec] = n.toFixed(f.decimales).split(".");
  if (f.miles) ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, f.miles);
  const s = dec ? `${ent}${f.decimal}${dec}` : ent;
  if (!neg) return s;
  return f.negativo === "(x)" ? `(${s})` : f.negativo === "x-" ? `${s}-` : `-${s}`;
}

// ---------------------------------------------------------------- aprender
/**
 * @param {{ archivo: object, rows: string[][], tipos?: string[][]|null, vacias?: number[] }} ej
 * @returns {object} formato (sin datos del ejemplo)
 */
export function aprenderFormato(ej, { nombre = "Mi sistema" } = {}) {
  const rows = ej.rows, tipos = ej.tipos;
  const llenas = rows.map((r, i) => ({ r, i })).filter((x) => x.r.some((c) => c));
  if (!llenas.length) throw new Error("El ejemplo no tiene filas.");
  const ancho = Math.max(...llenas.map((x) => x.r.length));
  const celda = (r, c) => String(r[c] ?? "").trim();
  // ¿Primera fila de títulos? Ninguna celda con número ni fecha, y alguna reconocible.
  const primera = llenas[0].r;
  const pareceTitulo = (c) => c && !/\d{2}/.test(c);
  const conTitulos = primera.filter(Boolean).every(pareceTitulo) && llenas.length > 1;
  const titulos = conTitulos ? Array.from({ length: ancho }, (_, c) => celda(primera, c)) : null;
  const datos = llenas.slice(conTitulos ? 1 : 0);
  const col = (c) => datos.map((x) => celda(x.r, c));
  const tiposCol = (c) => (tipos ? datos.map((x) => tipos[x.i]?.[c] || "").filter(Boolean) : null);

  const conFecha = datos.map((x) => x.r.some((v, j) => (tipos && tipos[x.i]?.[j] === "fecha") || FECHA_SEP.test(String(v ?? "").trim())));
  const columnas = Array.from({ length: ancho }, (_, c) => {
    const vals = col(c), llenos = vals.filter(Boolean);
    const t = titulos ? normH(titulos[c]) : "";
    const porTitulo = t && TITULOS.find(([, re]) => re.test(t))?.[0];
    const tc = tiposCol(c);
    const info = { titulo: titulos ? titulos[c] : "", rol: porTitulo || null };
    if (!llenos.length) return { ...info, rol: info.rol || "vacio" };
    // Valor que no cambia: un dato fijo del sistema ("default", sucursal, moneda…). Tiene que estar
    // en TODAS las filas de su tipo (todas, todas las que tienen fecha o todas las que no); si está
    // solo en algunas, es un dato opcional (un centro de costo que se repitió por casualidad).
    const lleno = datos.map((x) => !!celda(x.r, c));
    const igual = (a, b) => a.every((v, i) => v === b[i]);
    const estructural = lleno.every(Boolean) || igual(lleno, conFecha) || igual(lleno, conFecha.map((v) => !v));
    const unico = new Set(llenos).size === 1 && llenos.length >= 2 && datos.length >= 3 && estructural;
    if (!info.rol) {
      if ((tc && tc.length && tc.every((x) => x === "fecha")) || patronFecha(llenos)) info.rol = "fecha";
      else if (llenos.every((x) => /^(D|H|DEBE|HABER|DB|CR|C)$/i.test(x)) && new Set(llenos.map((x) => x.toUpperCase())).size === 2) info.rol = "signo";
      else if (llenos.every((x) => DH_PEGADO.test(x))) info.rol = "importeDH";
      else if (llenos.every(esNumero) && llenos.some((x) => /[.,]\d{1,2}$/.test(x) || /-/.test(x)) || (tc && tc.every((x) => x === "numero") && llenos.some((x) => /\.\d/.test(x)))) info.rol = "monto";
      else if (unico) info.rol = "fijo";
      else if (llenos.every((x) => /^\d{1,8}$/.test(x)) && corridas(vals)) info.rol = "asiento";
      else if (llenos.every((x) => /^\d[\d.\-]*\d$|^\d$/.test(x))) info.rol = "cuenta";
      else info.rol = "texto";
    }
    if (info.rol === "fijo" || (unico && !["fecha", "asiento", "debe", "haber", "importe", "cuenta"].includes(info.rol) && !porTitulo)) return { ...info, rol: "fijo", valor: llenos[0] };
    return info;
  });

  // Montos: dos columnas → Debe y Haber (izquierda Debe, salvo títulos); una con D/H → importe;
  // una con negativos → importe con signo.
  const montos = columnas.map((c, i) => (c.rol === "monto" ? i : -1)).filter((i) => i >= 0);
  const hayDH = columnas.some((c) => c.rol === "debe" || c.rol === "haber");
  if (!hayDH) {
    if (columnas.some((c) => c.rol === "signo") && montos.length) columnas[montos[0]].rol = "importe";
    else if (montos.length >= 2) { columnas[montos[0]].rol = "debe"; columnas[montos[1]].rol = "haber"; }
    else if (montos.length === 1) columnas[montos[0]].rol = col(montos[0]).some((x) => /-|\(/.test(x)) ? "importeConSigno" : "importe";
  }
  for (const c of columnas) if (c.rol === "monto") c.rol = "vacio";
  columnas.forEach((c, i) => { if (c.rol === "importe" && !columnas.some((x) => x.rol === "signo") && col(i).some((x) => /^-|-$|^\(/.test(x))) c.rol = "importeConSigno"; });
  // Cuenta: si no hay ninguna, la columna de texto con más valores distintos que se repiten (nombres).
  if (!columnas.some((c) => c.rol === "cuenta")) {
    const textos = columnas.map((c, i) => (c.rol === "texto" ? i : -1)).filter((i) => i >= 0);
    const enLineas = textos.filter((i) => datos.every((x) => !filaDeImporte(x.r, columnas) || celda(x.r, i)));
    if (enLineas.length) columnas[enLineas[0]].rol = "cuenta";
  }
  // Textos restantes: completan el concepto del asiento y el detalle de la línea, en ese orden. Un
  // texto que aparece solo en algunas filas (organización, centro de costo…) es opcional: vacío.
  const faltan = ["concepto", "detalle"].filter((r) => !columnas.some((c) => c.rol === r));
  columnas.forEach((c, i) => {
    if (c.rol !== "texto") return;
    const llenas = col(i).filter(Boolean).length;
    const esporadico = llenas < datos.length * 0.5 && !(estructuraCab(datos, columnas) && llenas >= cuentaCab(datos, columnas));
    c.rol = !esporadico && faltan.length ? faltan.shift() : "vacio";
  });

  // Estructura: ¿hay filas de cabecera (fecha/concepto sin importes) seguidas por las líneas?
  const conImporte = datos.filter((x) => filaDeImporte(x.r, columnas));
  const cabeceras = datos.filter((x) => !filaDeImporte(x.r, columnas));
  const estructura = cabeceras.length && conImporte.length ? "cabecera" : "linea";
  for (const [i, c] of columnas.entries()) {
    const enCab = cabeceras.some((x) => celda(x.r, i)), enLin = conImporte.some((x) => celda(x.r, i));
    c.en = estructura === "linea" ? "linea" : enCab && enLin ? "ambas" : enCab ? "cabecera" : "linea";
    if (c.rol === "fijo" && estructura === "cabecera" && !enLin && !enCab) c.en = "linea";
  }

  const idx = (rol) => columnas.findIndex((c) => c.rol === rol);
  const iF = idx("fecha"), iA = idx("asiento"), iC = idx("cuenta");
  const montoCols = ["debe", "haber", "importe", "importeConSigno", "importeDH"].map(idx).filter((i) => i >= 0);
  const iDH = idx("importeDH");
  const formato = {
    fulgoria_formato_asientos: 1,
    nombre: String(nombre).slice(0, 60),
    archivo: { ...ej.archivo, separadorEnBlanco: estructuraConBlancos(rows, ej.vacias || []) },
    titulos,
    columnas: columnas.map(({ titulo, rol, valor, en }) => ({ titulo, rol, en, ...(rol === "fijo" ? { valor } : {}) })),
    estructura,
    fecha: { patron: iF >= 0 ? (tiposCol(iF)?.every((x) => x === "fecha") && tiposCol(iF).length ? "excel" : patronFecha(col(iF).filter(Boolean)) || "DD/MM/AAAA") : "DD/MM/AAAA" },
    importe: formatoImporte(montoCols.flatMap((i) => col(i).map((x) => x.replace(/\s*[DH]$/i, ""))), montoCols.length && tipos ? montoCols.flatMap((i) => tiposCol(i)) : null),
    signo: aprenderSigno(idx("signo") >= 0 ? col(idx("signo")).filter(Boolean) : iDH >= 0 ? col(iDH).filter(Boolean).map((x) => x.match(DH_PEGADO)[4]) : []),
    asiento: aprenderNumeracion(iA >= 0 ? col(iA) : [], iF >= 0 ? col(iF) : []),
    cuenta: aprenderCuenta(iC >= 0 ? col(iC).filter(Boolean) : []),
  };
  return formato;
}
// Con filas de cabecera, un texto que está en todas las cabeceras (el concepto) no es esporádico.
function estructuraCab(datos, columnas) { return datos.some((x) => !filaDeImporte(x.r, columnas)) && datos.some((x) => filaDeImporte(x.r, columnas)); }
function cuentaCab(datos, columnas) { return datos.filter((x) => !filaDeImporte(x.r, columnas)).length; }
function filaDeImporte(r, columnas) {
  return columnas.some((c, i) => ["monto", "debe", "haber", "importe", "importeConSigno", "importeDH"].includes(c.rol) && String(r[i] ?? "").trim() && !/^0+([.,]0+)?$/.test(String(r[i]).trim()))
    || columnas.some((c, i) => ["debe", "haber"].includes(c.rol) && String(r[i] ?? "").trim());
}
function corridas(vals) { // el mismo número en filas seguidas: es un número de asiento
  const v = vals.filter(Boolean);
  return v.length <= 2 || v.some((x, i) => i > 0 && x === v[i - 1]);
}
function estructuraConBlancos(rows, vacias) {
  const primera = rows.findIndex((r) => r.some((c) => c)), ultima = rows.length - 1 - [...rows].reverse().findIndex((r) => r.some((c) => c));
  return vacias.some((i) => i > primera && i < ultima);
}
function aprenderSigno(vals) {
  const u = [...new Set(vals.map((x) => x.trim()))];
  const d = u.find((x) => /^(D|DEBE|DB)$/i.test(x)) || "D", h = u.find((x) => /^(H|HABER|CR|C)$/i.test(x)) || "H";
  return { debe: d, haber: h };
}
function aprenderNumeracion(nros, fechas) {
  const v = nros.map((x, i) => ({ n: x, f: fechas[i] })).filter((x) => x.n);
  const ancho = v.some((x) => /^0\d/.test(x.n)) ? Math.max(...v.map((x) => x.n.length)) : 0;
  let reinicia = false;
  for (let i = 1; i < v.length; i++) if (+v[i].n < +v[i - 1].n && v[i].f !== v[i - 1].f) reinicia = true;
  // Con varias fechas y cada una empezando en 1 también es "por fecha".
  const porFecha = new Map(); for (const x of v) if (!porFecha.has(x.f)) porFecha.set(x.f, +x.n);
  if (porFecha.size > 1 && [...porFecha.values()].every((n) => n === 1)) reinicia = true;
  return { ancho, reinicio: reinicia ? "fecha" : "nunca", desde: 1 };
}
function aprenderCuenta(vals) {
  if (!vals.length) return { modo: "nombre", separadores: true };
  const codigos = vals.every((x) => /^\d[\d.\-]*$/.test(x));
  const completo = !codigos && vals.every((x) => /^\d[\d.\-]*\s+\S/.test(x));
  return { modo: codigos ? "codigo" : completo ? "completo" : "nombre", separadores: !codigos || vals.some((x) => /[.\-]/.test(x)) };
}

// ---------------------------------------------------------------- generar
const CODIGO_RE = /^(\d[\d.\-]*\d|\d)(?:\s+[-–]?\s*(.*))?$/;
function cuentaSegun(cuenta, f) {
  const s = String(cuenta || "").trim(), m = s.match(CODIGO_RE);
  const codigo = m ? m[1] : null, nombreC = m ? (m[2] || "").trim() || m[1] : s;
  if (f.modo === "nombre") return { valor: nombreC, falta: false };
  if (f.modo === "completo") return { valor: s, falta: !codigo };
  if (!codigo) return { valor: s, falta: true };
  return { valor: f.separadores ? codigo : codigo.replace(/\D/g, ""), falta: false };
}

/**
 * Filas (valores ya formateados) de los asientos en el formato aprendido.
 * @returns {{ filas: Array<Array<string|number|{fecha:string}|null>>, faltanCodigos: string[] }}
 */
export function filasAsientos(formato, ajustes) {
  const f = formato, filas = [], faltan = new Set();
  if (f.titulos) filas.push(f.titulos.map((t) => t ?? ""));
  const nros = new Map(); let correlativo = (f.asiento?.desde || 1) - 1;
  const fecha = (iso) => (f.fecha.patron === "excel" ? { fecha: iso } : formatearFecha(iso, f.fecha.patron));
  const nro = (n) => (f.asiento.ancho ? String(n).padStart(f.asiento.ancho, "0") : String(n));
  const imp = (c) => formatearImporte(c, f.importe);
  const cero = () => (f.importe.excel ? null : f.importe.cero === "cero" ? formatearImporte(0, f.importe) : "");
  ajustes.forEach((a, k) => {
    let n;
    if (f.asiento.reinicio === "fecha") { n = (nros.get(a.fecha) || (f.asiento.desde || 1) - 1) + 1; nros.set(a.fecha, n); }
    else n = ++correlativo;
    if (k > 0 && f.archivo.separadorEnBlanco) filas.push([]);
    const valor = (c, l) => {
      switch (c.rol) {
        case "fecha": return fecha(a.fecha);
        case "asiento": return nro(n);
        case "concepto": return String(a.concepto || "").replace(/[\t\r\n]+/g, " ");
        case "detalle": return String(a.concepto || "").replace(/[\t\r\n]+/g, " ");
        case "fijo": return c.valor ?? "";
        case "vacio": return null;
      }
      if (!l) return null;
      switch (c.rol) {
        case "cuenta": { const r = cuentaSegun(l.cuenta, f.cuenta); if (r.falta) faltan.add(String(l.cuenta)); return r.valor; }
        case "debe": return l.debe ? imp(l.debe) : cero();
        case "haber": return l.haber ? imp(l.haber) : cero();
        case "importe": return imp(l.debe || l.haber);
        case "importeConSigno": return formatearImporte(l.debe ? l.debe : -l.haber, f.importe, { abs: false });
        case "signo": return l.debe ? f.signo.debe : f.signo.haber;
        case "importeDH": return `${formatearImporte(l.debe || l.haber, { ...f.importe, excel: false })}${l.debe ? f.signo.debe : f.signo.haber}`;
      }
      return null;
    };
    if (f.estructura === "cabecera") filas.push(f.columnas.map((c) => (c.en === "cabecera" || c.en === "ambas" ? valor(c, null) : null)));
    for (const l of a.lineas) filas.push(f.columnas.map((c) => (f.estructura === "cabecera" && c.en === "cabecera" ? null : valor(c, l))));
  });
  return { filas, faltanCodigos: [...faltan] };
}

const aLatin1 = (t) => { const o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); o[i] = c < 256 ? c : 63; } return o; };
/** Archivo listo para importar: { bytes, ext, mime }. */
export function generarArchivo(formato, ajustes) {
  const { filas, faltanCodigos } = filasAsientos(formato, ajustes);
  const a = formato.archivo;
  if (a.tipo === "xlsx") return { bytes: escribirXlsx([{ nombre: a.hoja || "Hoja1", filas }]), ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", faltanCodigos };
  const txt = (v) => (v == null ? "" : typeof v === "object" ? formatearFecha(v.fecha, "DD/MM/AAAA") : String(v));
  let lineas;
  if (a.tipo === "delimitado") {
    const q = (s) => (s.includes(a.delimitador) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    lineas = filas.map((r) => (r.length ? r.map((v) => q(txt(v))).join(a.delimitador) : ""));
  } else {
    lineas = filas.map((r) => (r.length ? a.anchos.map((c, i) => {
      if (c.ultima) return txt(r[i]); // la última columna no se corta
      const s = txt(r[i]).slice(0, c.alinear === "der" ? c.contenido || c.ancho : c.ancho);
      return c.alinear === "der" ? s.padStart(c.contenido || c.ancho).padEnd(c.ancho) : s.padEnd(c.ancho);
    }).join("").replace(/\s+$/, "") : ""));
  }
  const texto = lineas.join(a.eol || "\r\n") + (a.finalNL === false ? "" : a.eol || "\r\n");
  const cuerpo = a.codificacion === "utf-8" ? new TextEncoder().encode(texto) : aLatin1(texto);
  const bytes = a.bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...cuerpo]) : cuerpo;
  return { bytes, ext: a.ext || "txt", mime: a.ext === "csv" ? "text/csv" : "text/plain", faltanCodigos };
}

/** Resumen en castellano de lo que se entendió (para mostrarlo antes de guardar). */
export function describirFormato(f) {
  const a = f.archivo;
  const archivo = a.tipo === "xlsx" ? "Excel (.xlsx)" : a.tipo === "fijo" ? `texto de ancho fijo (.${a.ext})` : `texto separado por ${{ "\t": "tabulación", ";": "punto y coma", ",": "coma", "|": "barra" }[a.delimitador]} (.${a.ext})`;
  const imp = f.importe.excel ? "números de Excel" : `${f.importe.miles ? `miles con "${f.importe.miles}", ` : ""}decimales con "${f.importe.decimal}"${f.importe.dudoso ? " (no se vio en el ejemplo: revisalo)" : ""}`;
  return [
    `Archivo: ${archivo}${a.codificacion ? `, ${a.codificacion === "utf-8" ? "UTF-8" : "Windows/Latin-1"}` : ""}${f.titulos ? ", con títulos" : ", sin títulos"}`,
    `Cada asiento: ${f.estructura === "cabecera" ? "una fila de cabecera y después una fila por cuenta" : "una fila por cuenta, repitiendo los datos del asiento"}${a.separadorEnBlanco ? ", con una línea en blanco entre asientos" : ""}`,
    `Fecha: ${f.fecha.patron === "excel" ? "fecha de Excel" : f.fecha.patron}`,
    `Importes: ${imp}`,
    `Cuentas: ${f.cuenta.modo === "codigo" ? `por código${f.cuenta.separadores ? "" : " sin puntos"}` : f.cuenta.modo === "completo" ? "código y nombre" : "por nombre"}`,
    f.columnas.some((c) => c.rol === "asiento") ? `Numeración: ${f.asiento.reinicio === "fecha" ? "vuelve a 1 en cada fecha" : "correlativa"}${f.asiento.ancho ? `, con ${f.asiento.ancho} dígitos` : ""}` : "",
  ].filter(Boolean);
}
