// Generador mínimo de PDF, sin dependencias (navegador y Node): páginas A4, texto en Helvetica y
// Helvetica-Bold (fuentes estándar de PDF, no hace falta incrustarlas), líneas y rectángulos.
// Alcanza para papeles de trabajo: tablas con importes alineados a la derecha y textos que se
// cortan en renglones. Codificación WinAnsi (tildes, ñ, ¿, º…).

// Anchos de Helvetica y Helvetica-Bold (AFM, milésimas de em) para los caracteres 32–126.
const ANCHO_R = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const ANCHO_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Caracteres fuera de ASCII: código WinAnsi y la letra "base" para el ancho.
const WINANSI = {
  "á": [0xe1, "a"], "é": [0xe9, "e"], "í": [0xed, "i"], "ó": [0xf3, "o"], "ú": [0xfa, "u"], "ü": [0xfc, "u"], "ñ": [0xf1, "n"],
  "Á": [0xc1, "A"], "É": [0xc9, "E"], "Í": [0xcd, "I"], "Ó": [0xd3, "O"], "Ú": [0xda, "U"], "Ü": [0xdc, "U"], "Ñ": [0xd1, "N"],
  "¿": [0xbf, "?"], "¡": [0xa1, "!"], "º": [0xba, "o"], "ª": [0xaa, "a"], "°": [0xb0, "o"], "·": [0xb7, "."],
  "—": [0x97, null, 1000], "–": [0x96, null, 556], "“": [0x93, null, 333], "”": [0x94, null, 333], "‘": [0x91, null, 222], "’": [0x92, null, 222],
  "…": [0x85, null, 1000], "•": [0x95, null, 350], "€": [0x80, null, 556], "−": [0x2d, "-"], "→": null, "✅": null, "❌": null, "📎": null,
};
function codificar(texto) {
  const out = [];
  for (const ch of String(texto)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) out.push(c);
    else if (WINANSI[ch]) out.push(WINANSI[ch][0]);
    else if (ch === "→") out.push(0x2d, 0x3e);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (WINANSI[ch] === null) continue;
    else out.push(0x3f);
  }
  return out;
}
/** Ancho de un texto en puntos. */
export function anchoTexto(texto, size, bold = false) {
  const tabla = bold ? ANCHO_B : ANCHO_R;
  let w = 0;
  for (const ch of String(texto)) {
    const c = ch.codePointAt(0), e = WINANSI[ch];
    if (c >= 32 && c <= 126) w += tabla[c - 32];
    else if (e && e[2]) w += e[2];
    else if (e && e[1]) w += tabla[e[1].charCodeAt(0) - 32];
    else if (e === null) w += 0;
    else w += 556;
  }
  return (w * size) / 1000;
}
/** Corta un texto en renglones que entran en `ancho` puntos. */
export function renglones(texto, ancho, size, bold = false) {
  const palabras = String(texto ?? "").replace(/\s+/g, " ").trim().split(" ");
  const out = [];
  let linea = "";
  for (const p of palabras) {
    const prueba = linea ? `${linea} ${p}` : p;
    if (anchoTexto(prueba, size, bold) <= ancho || !linea) {
      if (anchoTexto(prueba, size, bold) > ancho && !linea) { // una palabra sola más larga que el ancho: se corta
        let t = "";
        for (const ch of p) { if (anchoTexto(t + ch, size, bold) > ancho) { out.push(t); t = ch; } else t += ch; }
        linea = t;
      } else linea = prueba;
    } else { out.push(linea); linea = p; }
  }
  if (linea) out.push(linea);
  return out.length ? out : [""];
}

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const num = (n) => (Math.round(n * 100) / 100).toString();
const color = (c) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || "#000000"); return m ? m.slice(1).map((x) => num(parseInt(x, 16) / 255)).join(" ") : "0 0 0"; };

/**
 * Documento A4 (595 × 842 pt). Coordenadas con origen ARRIBA a la izquierda (y crece hacia abajo).
 */
export function crearPdf({ titulo = "", autor = "Fulgoria" } = {}) {
  const W = 595.28, H = 841.89;
  const paginas = [];
  let actual = null;
  const doc = {
    W, H,
    nuevaPagina() { actual = []; paginas.push(actual); return doc; },
    get paginas() { return paginas.length; },
    texto(x, y, str, { size = 10, bold = false, color: c = "#111111", alinear = "izq" } = {}) {
      if (!actual) doc.nuevaPagina();
      const w = anchoTexto(str, size, bold);
      const xx = alinear === "der" ? x - w : alinear === "centro" ? x - w / 2 : x;
      actual.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${color(c)} rg ${num(xx)} ${num(H - y)} Td <${hex(codificar(str))}> Tj ET`);
      return doc;
    },
    linea(x1, y1, x2, y2, { grosor = 0.5, color: c = "#999999" } = {}) {
      if (!actual) doc.nuevaPagina();
      actual.push(`${num(grosor)} w ${color(c)} RG ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S`);
      return doc;
    },
    rect(x, y, w, h, { relleno = "#eeeeee" } = {}) {
      if (!actual) doc.nuevaPagina();
      actual.push(`${color(relleno)} rg ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re f`);
      return doc;
    },
    /** Escribe en todas las páginas (pie con "página n de N", por ejemplo). */
    enCadaPagina(fn) { paginas.forEach((p, i) => { actual = p; fn(i + 1, paginas.length); }); return doc; },
    /** @returns {Uint8Array} */
    generar() {
      if (!paginas.length) doc.nuevaPagina();
      const objs = [];
      const agregar = (s) => { objs.push(s); return objs.length; };
      const catalogo = agregar(null), raiz = agregar(null);
      const f1 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      const f2 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids = [];
      for (const p of paginas) {
        const contenido = p.join("\n");
        const c = agregar(`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
        kids.push(agregar(`<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
      }
      objs[catalogo - 1] = `<< /Type /Catalog /Pages ${raiz} 0 R >>`;
      objs[raiz - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
      const info = agregar(`<< /Title <${hex([0xfe, 0xff, ...utf16(titulo)])}> /Author <${hex([0xfe, 0xff, ...utf16(autor)])}> /Producer (Fulgoria) >>`);
      // El contenido es ASCII (el texto va en hexadecimal), así que caracteres = bytes.
      let out = "%PDF-1.4\n%âãÏÓ\n";
      const offs = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    },
  };
  return doc;
}
function utf16(s) { const o = []; for (const ch of String(s)) { const c = ch.charCodeAt(0); o.push(c >> 8, c & 0xff); } return o; }
