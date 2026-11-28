// Lector mínimo de Excel (.xlsx, Office Open XML) sin dependencias: un .xlsx es un ZIP con XML
// adentro. Se descomprime con DecompressionStream (navegador y Node 18+) y se leen las hojas como
// filas de texto, igual que un CSV. No lee el formato viejo .xls (binario).
//
// Las celdas numéricas salen como texto canónico ("1234.56", sin separador de miles) y las fechas
// como "DD/MM/AAAA": así el resto de Fulgoria las lee igual que si vinieran de un CSV.

const td = new TextDecoder("utf-8");

async function inflar(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lee las entradas de un ZIP → Map(nombre → () => Promise<Uint8Array>). */
function leerZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("No es un archivo .xlsx válido (¿es un .xls viejo? Guardalo como .xlsx o CSV).");
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("El .xlsx está dañado.");
    const metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
    const largoNombre = dv.getUint16(p + 28, true), largoExtra = dv.getUint16(p + 30, true), largoComent = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = td.decode(u8.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, async () => {
      const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const datos = u8.subarray(ini, ini + comp);
      if (metodo === 0) return datos;
      if (metodo === 8) return inflar(datos);
      throw new Error(`Compresión ${metodo} no soportada en el .xlsx.`);
    });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return entradas;
}

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const desescapar = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
const attrs = (s) => { const o = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = desescapar(m[2]); return o; };
// Texto de un <si> o <is>: todos los <t> (también los de texto enriquecido), sin la fonética <rPh>.
const textoDe = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join("");

function colIndice(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Formatos de fecha: los predefinidos de Excel y los personalizados con d/m/y (sin contar texto
// entre comillas ni [colores]).
const FECHA_ID = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const esFormatoFecha = (codigo) => /[dmy]/i.test(String(codigo).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^General$/i.test(codigo);
const dos = (n) => String(n).padStart(2, "0");
function fechaDeSerie(serie, base1904) {
  const ms = Math.round((serie + (base1904 ? 1462 : 0)) * 86400000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
const numeroCanonico = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<{ hojas: Array<{ nombre: string, rows: string[][], tipos: string[][] }> }>}
 *   tipos: por celda "texto" | "numero" | "fecha" | "" (vacía), para respetarlos al escribir.
 */
export async function leerXlsx(buf) {
  const zip = leerZip(buf);
  const leer = async (n) => { const f = zip.get(n) || zip.get(n.replace(/^\//, "")); return f ? td.decode(await f()) : null; };
  const libro = await leer("xl/workbook.xml");
  if (!libro) throw new Error("No es un .xlsx de Excel (no encontré el libro adentro).");
  const base1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(libro);
  const rels = {};
  for (const m of ((await leer("xl/_rels/workbook.xml.rels")) || "").matchAll(/<Relationship\b([^>]*)\/?>/g)) { const a = attrs(m[1]); rels[a.Id] = a.Target; }
  const compartidos = [...((await leer("xl/sharedStrings.xml")) || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  // Estilos: qué índice de estilo (s="…") es una fecha.
  const estilos = (await leer("xl/styles.xml")) || "";
  const formatos = {};
  for (const m of estilos.matchAll(/<numFmt\b([^>]*)\/?>/g)) { const a = attrs(m[1]); formatos[a.numFmtId] = a.formatCode; }
  const xfs = (estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ""])[1];
  const esFecha = [...xfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => {
    const id = Number(attrs(m[1]).numFmtId || 0);
    return FECHA_ID.has(id) || (formatos[id] != null && esFormatoFecha(formatos[id]));
  });

  const hojas = [];
  for (const m of libro.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const destino = rels[a["r:id"]];
    if (!destino) continue;
    const ruta = destino.startsWith("/") ? destino.slice(1) : "xl/" + destino.replace(/^\.\//, "");
    const xml = await leer(ruta);
    if (!xml) continue;
    const rows = [], tiposF = [];
    for (const f of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const nFila = Number(attrs(f[1]).r || rows.length + 1) - 1;
      const fila = [], tipoFila = [];
      let col = 0;
      for (const c of (f[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(c[1]);
        if (ca.r) col = colIndice(ca.r);
        const cuerpo = c[2] || "";
        const v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [, null])[1];
        let val = "", tipo = "texto";
        if (ca.t === "s") val = compartidos[Number(v)] ?? "";
        else if (ca.t === "inlineStr") val = textoDe(cuerpo);
        else if (ca.t === "str" || ca.t === "e") val = v == null ? "" : desescapar(v);
        else if (ca.t === "b") val = v === "1" ? "VERDADERO" : "FALSO";
        else if (v != null && v !== "") {
          const n = Number(v);
          if (!Number.isFinite(n)) val = desescapar(v);
          else if (esFecha[Number(ca.s || 0)]) { val = fechaDeSerie(n, base1904); tipo = "fecha"; }
          else { val = numeroCanonico(n); tipo = "numero"; }
        }
        while (fila.length < col) { fila.push(""); tipoFila.push(""); }
        fila[col] = String(val).trim();
        tipoFila[col] = fila[col] ? tipo : "";
        col++;
      }
      while (rows.length < nFila) { rows.push([]); tiposF.push([]); }
      rows[nFila] = fila; tiposF[nFila] = tipoFila;
    }
    while (rows.length && !rows[rows.length - 1].some((c) => c)) { rows.pop(); tiposF.pop(); }
    const ancho = Math.max(0, ...rows.map((r) => r.length));
    const rellenar = (r) => { const x = [...r]; while (x.length < ancho) x.push(""); return x; };
    hojas.push({ nombre: a.name || `Hoja ${hojas.length + 1}`, rows: rows.map(rellenar), tipos: tiposF.map(rellenar) });
  }
  if (!hojas.length) throw new Error("El .xlsx no tiene hojas con datos.");
  return { hojas };
}
