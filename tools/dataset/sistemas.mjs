// Formatos de exportación del mayor de la cuenta Banco. Son ESTILOS genéricos que reproducen
// las variaciones reales (separador, formato de números y fechas, encabezados, Debe/Haber vs.
// importe con signo, saldo corrido o no, filas de transporte/subtotales, líneas de título
// antes del encabezado). No pretenden ser la exportación exacta de ningún sistema comercial.
import { fAR, fUS, fPlano, fDate } from "./lib.mjs";

const q = (s, sep) => (String(s).includes(sep) || /["\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const linea = (cells, sep) => cells.map((c) => q(c ?? "", sep)).join(sep);

export const SISTEMAS = {
  debe_haber_ar: {
    nombre: "Debe/Haber es-AR con saldo", rasgo: "Separador ;, números 1.234,56, fila Saldo anterior y Totales",
    write({ movs, apertura, meta }) {
      const sep = ";", out = [linea(["Fecha", "Asiento", "Comprobante", "Concepto", "Debe", "Haber", "Saldo"], sep)];
      let s = apertura;
      out.push(linea(["", "", "", "Saldo anterior", "", "", fAR(s)], sep));
      for (const m of movs) { s += m.cents; out.push(linea([fDate(m.fecha, "DD/MM/AAAA"), m.asiento, m.comp, m.desc, m.cents > 0 ? fAR(m.cents) : "", m.cents < 0 ? fAR(-m.cents) : "", fAR(s)], sep)); }
      out.push(linea(["", "", "", "Totales", "", "", fAR(s)], sep));
      return out.join("\n") + "\n";
    },
  },
  debitos_creditos_us: {
    nombre: "Débitos/Créditos con números US y títulos", rasgo: "Separador coma, números 1234.56, fechas ISO, líneas de empresa/cuenta/período antes del encabezado",
    write({ movs, apertura, meta }) {
      const sep = ",", out = [`Empresa: ${meta.titular}`, `Cuenta: 1.1.1.02 ${meta.banco}`, `Período: ${fDate(meta.desde, "DD/MM/AAAA")} al ${fDate(meta.hasta, "DD/MM/AAAA")}`, ""];
      out.push(linea(["Fecha", "Detalle", "Débitos", "Créditos", "Saldo"], sep));
      let s = apertura;
      out.push(linea(["", "Saldo inicial", "", "", fPlano(s)], sep));
      for (const m of movs) { s += m.cents; out.push(linea([fDate(m.fecha, "AAAA-MM-DD"), m.desc, m.cents > 0 ? fPlano(m.cents) : "", m.cents < 0 ? fPlano(-m.cents) : "", fPlano(s)], sep)); }
      return out.join("\n") + "\n";
    },
  },
  importe_signo_tab: {
    nombre: "Importe con signo, tabulado, sin saldo", rasgo: "Tabulador, una sola columna de importe con signo (Haber negativo), sin saldo corrido",
    write({ movs, apertura }) {
      const sep = "\t", out = [linea(["Fecha", "N° Asiento", "Leyenda", "Importe"], sep)];
      out.push(linea(["", "", "Saldo inicial", fUS(apertura)], sep));
      for (const m of movs) out.push(linea([fDate(m.fecha, "DD/MM/AAAA"), m.asiento, m.desc, fUS(m.cents)], sep));
      return out.join("\n") + "\n";
    },
  },
  parentesis_transporte: {
    nombre: "Importe con paréntesis y transporte", rasgo: "Fechas DD-MM-AA, $ y paréntesis para el Haber, fila Transporte y subtotales por página",
    write({ movs, apertura }) {
      const sep = ";", out = [linea(["Fecha", "Comprob.", "Descripción", "Importe", "Saldo"], sep)];
      let s = apertura;
      out.push(linea(["", "", "Transporte", "", fAR(s, { moneda: true, signo: "parentesis" })], sep));
      movs.forEach((m, i) => {
        s += m.cents;
        out.push(linea([fDate(m.fecha, "DD-MM-AA"), m.comp, m.desc, fAR(m.cents, { moneda: true, signo: "parentesis" }), fAR(s, { moneda: true, signo: "parentesis" })], sep));
        if ((i + 1) % 25 === 0 && i + 1 < movs.length) out.push(linea(["", "", "Subtotal página", "", fAR(s, { moneda: true, signo: "parentesis" })], sep));
      });
      out.push(linea(["", "", "Total general", "", fAR(s, { moneda: true, signo: "parentesis" })], sep));
      return out.join("\n") + "\n";
    },
  },
  planilla_cliente: {
    nombre: "Planilla del cliente (Excel guardado como CSV)", rasgo: "Encabezados en mayúsculas, INGRESOS/EGRESOS, fechas D/M/AAAA, descripción partida en dos filas",
    write({ movs, apertura, r }) {
      const sep = ";", out = [linea(["FECHA", "DESCRIPCION", "INGRESOS", "EGRESOS", "SALDO"], sep)];
      let s = apertura;
      out.push(linea(["", "SALDO INICIAL", "", "", fAR(s)], sep));
      for (const m of movs) {
        s += m.cents;
        const partir = r.chance(0.15) && m.desc.length > 24;
        const d1 = partir ? m.desc.slice(0, 24) : m.desc;
        out.push(linea([fDate(m.fecha, "D/M/AAAA"), d1, m.cents > 0 ? fAR(m.cents) : "", m.cents < 0 ? fAR(-m.cents) : "", fAR(s)], sep));
        if (partir) out.push(linea(["", m.desc.slice(24), "", "", ""], sep));
      }
      return out.join("\n") + "\n";
    },
  },
  comillas_coma: {
    nombre: "Coma con comillas y Debe/Haber", rasgo: "Separador coma, campos entre comillas con comas adentro, números es-AR entre comillas, sin saldo",
    write({ movs, apertura }) {
      const sep = ",", out = [linea(["Fecha", "Concepto", "Comprobante", "Debe", "Haber"], sep)];
      out.push(linea(["", "Saldo anterior", "", apertura >= 0 ? fAR(apertura) : "", apertura < 0 ? fAR(-apertura) : ""], sep));
      for (const m of movs) out.push(linea([fDate(m.fecha, "DD/MM/AAAA"), m.desc.replace(/ - /, ", "), m.comp, m.cents > 0 ? fAR(m.cents) : "", m.cents < 0 ? fAR(-m.cents) : ""], sep));
      return out.join("\n") + "\n";
    },
  },
};
