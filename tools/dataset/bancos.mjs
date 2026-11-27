// Formatos de extracto de bancos FICTICIOS. Cada uno reproduce un rasgo estructural que existe
// en extractos reales argentinos (no su marca ni su diseño): débito y crédito en columnas
// separadas, importe con signo, indicador D/H, sin saldo corrido, pesos y dólares en el mismo
// PDF, fechas sin año, comprobante numérico, descripciones en varias líneas y varias páginas.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fAR, fDate } from "./lib.mjs";

// ---------------------------------------------------------------- vocabularios
// Cómo nombra cada banco cada operación. Ninguna leyenda copia la de un banco real en particular.
const VOC_A = {
  trfRecibida: (q, c, ref) => `TRANSFERENCIA RECIBIDA\nDE ${q.toUpperCase()} CUIT ${c}${ref ? ` REF ${ref}` : ""}`,
  trfEnviada: (q) => `TRANSFERENCIA ENVIADA\nA ${q.toUpperCase()}`,
  cheque: (n) => `CHEQUE CAMARA NRO ${n}`,
  echeq: (n) => `ECHEQ PAGADO NRO ${n}`,
  depositoEfectivo: () => "DEPOSITO EN EFECTIVO",
  depositoCheques: () => "DEPOSITO DE CHEQUES",
  impDeb: () => "IMP.DEB.LEY 25413",
  impCred: () => "IMP.CRED.LEY 25413",
  sircreb: () => "RET. IIBB SIRCREB",
  comision: () => "COMISION MANT. CUENTA",
  ivaComision: () => "IVA 21% S/COMIS.",
  percepcionIVA: () => "PERCEP. IVA RG 2408",
  debitoAutomatico: (s) => `DEB. AUTOM. ${s.toUpperCase()}`,
  vep: (n) => `PAGO VEP ${n} AFIP`,
  tarjeta: (l) => `LIQUIDACION TARJETA VISA LOTE ${l}`,
  mercadoPago: () => "TRANSF DE MERCADOPAGO",
  sueldo: (p) => `TRANSF. SUELDO ${p.toUpperCase()}`,
  intereses: () => "INTERESES PLAZO FIJO",
  chequeRechazado: (n) => `CHEQUE RECHAZADO NRO ${n}`,
  comisionRechazo: () => "COMISION CHEQUE RECHAZADO",
};
const VOC_B = {
  trfRecibida: (q, c, ref) => `TRF INMEDIATA RECIB ${c.replace(/-/g, "")}${ref ? ` ${ref}` : ""}`,
  trfEnviada: (q, c) => `TRF INMEDIATA ENV ${c.replace(/-/g, "")}`,
  cheque: (n) => `CHQ PAGADO POR CAMARA ${n}`,
  echeq: (n) => `E-CHEQ DEBITADO ${n}`,
  depositoEfectivo: () => "DEP EFECTIVO CAJERO",
  depositoCheques: () => "DEP CHEQUES OTROS BANCOS",
  impDeb: () => "IMPUESTO DEBITOS LEY 25.413",
  impCred: () => "IMPUESTO CREDITOS LEY 25.413",
  sircreb: () => "SIRCREB RETENCION IIBB",
  comision: () => "CARGO MANTENIMIENTO PAQUETE",
  ivaComision: () => "I.V.A. TASA GENERAL",
  percepcionIVA: () => "PERCEPCION IVA",
  debitoAutomatico: (s) => `DEBITO AUTOMATICO ${s.toUpperCase()}`,
  vep: (n) => `PAGO ARCA VEP ${n}`,
  tarjeta: (l) => `ACRED PRISMA LIQ ${l}`,
  mercadoPago: () => "TRF RECIB MERCADO PAGO",
  sueldo: (p) => `ACRED HABERES ${p.toUpperCase()}`,
  intereses: () => "ACREDITACION INTERESES",
  chequeRechazado: (n) => `CHQ DEVUELTO ${n} SIN FONDOS`,
  comisionRechazo: () => "COMISION CHQ DEVUELTO",
};
const VOC_C = {
  trfRecibida: (q, c, ref) => `TRANSFERENCIA DE TERCEROS\n${q.toUpperCase()}${ref ? ` - ${ref}` : ""}`,
  trfEnviada: (q) => `TRANSFERENCIA A TERCEROS\n${q.toUpperCase()}`,
  cheque: (n) => `CHEQUE N ${n}`,
  echeq: (n) => `ECHEQ N ${n}`,
  depositoEfectivo: () => "DEPOSITO POR VENTANILLA",
  depositoCheques: () => "DEPOSITO CHEQUES 48 HS",
  impDeb: () => "IMP. S/DEB. BANCARIOS",
  impCred: () => "IMP. S/CRED. BANCARIOS",
  sircreb: () => "RETENCION ING. BRUTOS",
  comision: () => "COMISION SERVICIO DE CUENTA",
  ivaComision: () => "IVA BASE",
  percepcionIVA: () => "PERC. IVA",
  debitoAutomatico: (s) => `DEB AUT ${s.toUpperCase()}`,
  vep: (n) => `AFIP VEP NRO ${n}`,
  tarjeta: (l) => `LIQ. COMERCIO MASTERCARD ${l}`,
  mercadoPago: () => "TRANSFERENCIA DE TERCEROS\nMERCADOPAGO",
  sueldo: (p) => `PAGO DE HABERES\n${p.toUpperCase()}`,
  intereses: () => "INTERESES GANADOS",
  chequeRechazado: (n) => `RECHAZO CHEQUE N ${n}`,
  comisionRechazo: () => "COMISION RECHAZO CHEQUE",
};

// ---------------------------------------------------------------- formatos
// Coordenadas en puntos (A4 = 595 x 842). `banda` = [desde, hasta] en x para la plantilla.
// Las columnas de importe están alineadas a la derecha en `x`.
export const BANCOS = {
  plata: {
    nombre: "Banco del Plata Austral", rasgo: "Débito y crédito separados, saldo corrido, descripciones en dos líneas",
    voc: VOC_A, fecha: "DD/MM/AAAA",
    cols: [
      { k: "fecha", h: "FECHA", x: 40, banda: [0, 96], role: "fecha" },
      { k: "desc", h: "CONCEPTO", x: 100, banda: [96, 320], role: "descripcion" },
      { k: "deb", h: "DEBITO", x: 400, der: true, banda: [320, 405], role: "debito" },
      { k: "cre", h: "CREDITO", x: 478, der: true, banda: [405, 483], role: "credito" },
      { k: "saldo", h: "SALDO", x: 556, der: true, banda: [483, 595], role: "saldo" },
    ],
    apertura: "SALDO ANTERIOR", cierre: "SALDO FINAL",
  },
  federal: {
    nombre: "Banco Federal del Sur", rasgo: "Importe con signo en una sola columna, columna de referencia, fecha con año de dos dígitos",
    voc: VOC_B, fecha: "DD/MM/AA",
    cols: [
      { k: "fecha", h: "Fecha", x: 36, banda: [0, 82], role: "fecha" },
      { k: "desc", h: "Descripción", x: 84, banda: [82, 300], role: "descripcion" },
      { k: "ref", h: "Referencia", x: 304, banda: [300, 372], role: "texto" },
      { k: "imp", h: "Importe", x: 470, der: true, banda: [372, 476], role: "importe" },
      { k: "saldo", h: "Saldo", x: 560, der: true, banda: [476, 595], role: "saldo" },
    ],
    apertura: "SALDO ANTERIOR", cierre: "SALDO AL",
  },
  nativo: {
    nombre: "Banco Nativo Argentino", rasgo: "Importe sin signo con columna D/H (débito/haber)",
    voc: VOC_C, fecha: "DD/MM/AAAA",
    cols: [
      { k: "fecha", h: "FECHA", x: 40, banda: [0, 96], role: "fecha" },
      { k: "desc", h: "CONCEPTO", x: 100, banda: [96, 340], role: "descripcion" },
      { k: "impAbs", h: "IMPORTE", x: 440, der: true, banda: [340, 446], role: "importe" },
      { k: "dh", h: "D/H", x: 452, banda: [446, 470], role: "signo" },
      { k: "saldo", h: "SALDO", x: 556, der: true, banda: [470, 595], role: "saldo" },
    ],
    apertura: "SALDO ULTIMO EXTRACTO", cierre: "SALDO FINAL",
  },
  pampeana: {
    nombre: "Cooperativa de Crédito Pampeana", rasgo: "Sin saldo corrido: saldo inicial y final solo en el encabezado y el pie",
    voc: VOC_A, fecha: "DD/MM/AAAA", sinSaldo: true,
    cols: [
      { k: "fecha", h: "Fecha", x: 40, banda: [0, 96], role: "fecha" },
      { k: "desc", h: "Descripción", x: 100, banda: [96, 360], role: "descripcion" },
      { k: "deb", h: "Débitos", x: 450, der: true, banda: [360, 456], role: "debito" },
      { k: "cre", h: "Créditos", x: 545, der: true, banda: [456, 595], role: "credito" },
    ],
    apertura: "Saldo inicial", cierre: "Saldo final",
  },
  cuyano: {
    nombre: "Banco Cuyano de Inversión", rasgo: "Dos cuentas en el mismo PDF (pesos y dólares)",
    voc: VOC_B, fecha: "DD/MM/AAAA", dosCuentas: true,
    cols: [
      { k: "fecha", h: "FECHA", x: 40, banda: [0, 96], role: "fecha" },
      { k: "desc", h: "DESCRIPCION", x: 100, banda: [96, 320], role: "descripcion" },
      { k: "deb", h: "DEBITOS", x: 400, der: true, banda: [320, 405], role: "debito" },
      { k: "cre", h: "CREDITOS", x: 478, der: true, banda: [405, 483], role: "credito" },
      { k: "saldo", h: "SALDO", x: 556, der: true, banda: [483, 595], role: "saldo" },
    ],
    apertura: "SALDO ANTERIOR", cierre: "SALDO FINAL",
  },
  atlantico: {
    nombre: "Banco Atlántico", rasgo: "Fechas sin año, fecha valor, nº de comprobante, importes con $",
    voc: VOC_C, fecha: "DD/MM", moneda: true,
    cols: [
      { k: "fecha", h: "Fecha", x: 34, banda: [0, 64], role: "fecha" },
      { k: "fvalor", h: "F. valor", x: 66, banda: [64, 98], role: "texto" },
      { k: "desc", h: "Concepto", x: 100, banda: [98, 290], role: "descripcion" },
      { k: "comp", h: "Comprob.", x: 292, banda: [290, 334], role: "texto" },
      { k: "deb", h: "Débitos", x: 410, der: true, banda: [334, 416], role: "debito" },
      { k: "cre", h: "Créditos", x: 486, der: true, banda: [416, 492], role: "credito" },
      { k: "saldo", h: "Saldo", x: 562, der: true, banda: [492, 595], role: "saldo" },
    ],
    apertura: "Saldo anterior", cierre: "Saldo final",
  },
};

/** Columnas de plantilla de Fulgoria (normalizadas 0..1) para un formato de banco. */
export function plantillaColumnas(banco) {
  return banco.cols.map((c) => ({ from: c.banda[0] / 595, to: c.banda[1] / 595, role: c.role, label: c.h }));
}

// ---------------------------------------------------------------- render del PDF
/**
 * @param {object} banco formato (BANCOS[x])
 * @param {Array<{titulo:string, moneda:"ARS"|"USD", apertura:number, movs:Array<{fecha,cents,desc,ref?}>}>} cuentas
 * @param {{ titular:string, desde:string, hasta:string, cbu:string, nroCuenta:string }} meta
 */
export async function renderExtracto(banco, cuentas, meta, r) {
  const doc = await PDFDocument.create();
  // Metadatos fijos: el mismo caso tiene que dar el mismo PDF byte a byte (dataset reproducible).
  const fija = new Date(Date.UTC(2026, 10, 27));
  doc.setCreationDate(fija); doc.setModificationDate(fija);
  doc.setProducer("Fulgoria dataset sintético"); doc.setCreator("tools/dataset/gen.mjs");
  doc.setTitle(`Extracto sintético ${banco.nombre}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16), grey = rgb(0.45, 0.48, 0.52);
  const SZ = banco.cols.length > 6 ? 7.6 : 8.6;
  const pages = [];
  let page, y;
  const T = (s, x, yy, o = {}) => page.drawText(String(s), { x, y: yy, size: o.size || SZ, font: o.f || font, color: o.c || ink });
  const TR = (s, xr, yy, o = {}) => { const f = o.f || font; T(s, xr - f.widthOfTextAtSize(String(s), o.size || SZ), yy, o); };
  const money = (c) => fAR(c, { moneda: !!banco.moneda });

  const encabezado = (cuenta) => {
    page = doc.addPage([595, 842]); pages.push(page);
    T(banco.nombre, 40, 800, { f: bold, size: 15 });
    T(`Resumen de cuenta · Período ${fDate(meta.desde, "DD/MM/AAAA")} al ${fDate(meta.hasta, "DD/MM/AAAA")}`, 40, 783, { c: grey, size: 9 });
    T(`Titular: ${meta.titular}`, 40, 770, { c: grey, size: 9 });
    T(`${cuenta.titulo} Nº ${meta.nroCuenta} · CBU ${meta.cbu}`, 40, 757, { c: grey, size: 9 });
    y = 726;
  };
  const cabecera = () => {
    for (const c of banco.cols) (c.der ? TR : T)(c.h, c.x, y, { f: bold });
    page.drawLine({ start: { x: 34, y: y - 4 }, end: { x: 561, y: y - 4 }, thickness: 0.6, color: grey });
    y -= 18;
  };
  const salto = (cuenta, alto) => { if (y - alto < 70) { encabezado(cuenta); cabecera(); } };

  for (let ci = 0; ci < cuentas.length; ci++) {
    const cu = cuentas[ci];
    if (ci === 0) encabezado(cu);
    else { y -= 24; salto(cu, 80); T(`${cu.titulo} Nº ${meta.nroCuenta.replace(/.$/, "9")}`, 40, y, { f: bold, size: 10 }); y -= 22; }
    let saldo = cu.apertura;
    const mon = cu.moneda === "USD" ? "U$S" : "$";
    if (banco.sinSaldo) { T(`${banco.apertura} al ${fDate(meta.desde, "DD/MM/AAAA")}: ${mon} ${fAR(saldo)}`, 40, y, { f: bold }); y -= 22; }
    cabecera();
    if (!banco.sinSaldo) {
      const col = banco.cols.find((c) => c.k === "desc");
      T(`${banco.apertura}${banco.dosCuentas ? " " + mon : ""}`, col.x, y);
      TR(money(saldo), banco.cols.find((c) => c.k === "saldo").x, y);
      y -= 15;
    }
    for (const m of cu.movs) {
      const lines = m.desc.split("\n");
      salto(cu, 15 + (lines.length - 1) * 11);
      saldo += m.cents;
      const cell = {
        fecha: fDate(m.fecha, banco.fecha), fvalor: fDate(m.fecha, "DD/MM"), desc: lines[0],
        ref: m.ref || "", comp: String(r.int(100000, 999999)),
        deb: m.cents < 0 ? money(-m.cents) : "", cre: m.cents > 0 ? money(m.cents) : "",
        imp: fAR(m.cents), impAbs: fAR(Math.abs(m.cents)), dh: m.cents < 0 ? "D" : "H",
        saldo: money(saldo),
      };
      for (const c of banco.cols) if (cell[c.k]) (c.der ? TR : T)(cell[c.k], c.x, y);
      y -= 13;
      for (const extra of lines.slice(1)) { T(extra, banco.cols.find((c) => c.k === "desc").x, y, { c: grey, size: SZ - 0.8 }); y -= 11; }
      y -= 2;
    }
    y -= 4;
    page.drawLine({ start: { x: 34, y: y + 10 }, end: { x: 561, y: y + 10 }, thickness: 0.6, color: grey });
    if (banco.sinSaldo) T(`${banco.cierre} al ${fDate(meta.hasta, "DD/MM/AAAA")}: ${mon} ${fAR(saldo)}`, 40, y - 4, { f: bold });
    else {
      const lbl = banco.cierre === "SALDO AL" ? `SALDO AL ${fDate(meta.hasta, "DD/MM/AAAA")}` : banco.cierre;
      T(lbl, banco.cols.find((c) => c.k === "desc").x, y, { f: bold });
      TR(money(saldo), banco.cols.find((c) => c.k === "saldo").x, y, { f: bold });
    }
    y -= 20;
    cu.cierre = saldo;
  }
  pages.forEach((p, i) => {
    p.drawText("Documento sintético de prueba — banco, titular y datos ficticios — dataset de Fulgoria", { x: 40, y: 40, size: 7, font, color: grey });
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: 500, y: 40, size: 7, font, color: grey });
  });
  return { bytes: await doc.save({ useObjectStreams: false }), paginas: pages.length };
}
