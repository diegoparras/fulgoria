// Casos de ejemplo en planilla (Excel/CSV) para Conciliar: un extracto bancario exportado a Excel,
// un reporte de Mercado Pago, y sus mayores. Deterministas; escriben en datasets/planillas/.
//   node tools/dataset/planillas.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { escribirXlsx } from "./xlsx-escribir.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "datasets", "planillas");
const f = (iso) => ({ fecha: iso });

// 1) Extracto del "Banco del Río" exportado a Excel + mayor en Excel (Debe/Haber, con asiento).
const banco = [
  ["Banco del Río S.A. — Resumen de cuenta corriente en pesos"], ["Titular: FERRETERIA EL TORNILLO SRL · CBU 0000000000000000000000"], [],
  ["Fecha", "Concepto", "Nro. operación", "Débito", "Crédito", "Saldo"],
  [f("2026-06-01"), "SALDO ANTERIOR", "", null, null, 250000],
  [f("2026-06-02"), "TRANSF RECIBIDA CUIT 30712345671 CONSTRUCTORA SUR", "88120", null, 180000, 430000],
  [f("2026-06-03"), "PAGO CHEQUE 00012345", "88121", 95000, null, 335000],
  [f("2026-06-05"), "IMP LEY 25413 S/DEB", "88122", 570, null, 334430],
  [f("2026-06-05"), "IMP LEY 25413 S/CRED", "88123", 1080, null, 333350],
  [f("2026-06-10"), "COMISION MANTENIMIENTO CTA", "88124", 4500, null, 328850],
  [f("2026-06-10"), "IVA 21% COMISION", "88125", 945, null, 327905],
  [f("2026-06-15"), "DEPOSITO EFECTIVO", "88126", null, 60000, 387905],
];
const mayorBanco = [
  ["MAYOR DE CUENTA 1.1.02 BANCO DEL RIO CTA CTE"], ["Período: 06/2026"],
  ["Fecha", "Asiento", "Comprobante", "Concepto", "Debe", "Haber", "Saldo"],
  ["", "", "", "Saldo anterior", null, null, 250000],
  [f("2026-06-02"), 101, "RC 0001-00000456", "Cobranza Constructora Sur", 180000, null, 430000],
  [f("2026-06-03"), 102, "OP 0001-00000099", "Pago proveedor ch 12345", null, 95000, 335000],
  [f("2026-06-14"), 103, "RC 0001-00000457", "Depósito ventas de contado", 60000, null, 395000],
  [f("2026-06-29"), 104, "OP 0001-00000100", "Pago Lácteos del Valle cheque 12346", null, 40000, 355000],
];

// 2) Reporte de liberaciones de Mercado Pago + mayor de la cuenta "Mercado Pago".
const mp = [
  ["DATE", "SOURCE_ID", "EXTERNAL_REFERENCE", "RECORD_TYPE", "DESCRIPTION", "NET_CREDIT_AMOUNT", "NET_DEBIT_AMOUNT", "GROSS_AMOUNT", "MP_FEE_AMOUNT", "FINANCING_FEE_AMOUNT", "SHIPPING_FEE_AMOUNT", "TAXES_AMOUNT", "PAYMENT_METHOD", "BALANCE_AMOUNT"],
  ["2026-06-01T00:00:00.000-03:00", "", "", "initial_available_balance", "", 15000, 0, "", "", "", "", "", "", 15000],
  ["2026-06-04T11:20:00.000-03:00", "71000000001", "VENTA-1001", "release", "payment", 47580, 0, 50000, 2420, 0, 0, 0, "master", 62580],
  ["2026-06-04T11:20:00.000-03:00", "71000000002", "", "release", "tax_payment_iibb", 0, 750, "", "", "", "", "", "account_money", 61830],
  ["2026-06-09T16:05:00.000-03:00", "71000000003", "VENTA-1002", "release", "payment", 28548, 0, 30000, 1452, 0, 0, 0, "visa", 90378],
  ["2026-06-12T09:00:00.000-03:00", "pre_payout_5501", "", "available_balance", "", 90378, 0, "", "", "", "", "", "", ""],
  ["2026-06-12T09:00:00.000-03:00", "5501", "", "release", "payout", 0, 80000, "", "", "", "", "", "", 10378],
  ["2026-06-30T23:59:00.000-03:00", "71000000004", "", "release", "asset_management_gain", 112, 0, "", "", "", "", "", "", 10490],
  ["", "", "", "total", "", 76240, 80750, "", "", "", "", "", "", ""],
];
const mayorMP = [
  ["Mayor - Cuenta 1.1.05 MERCADO PAGO"],
  ["Fecha", "Asiento", "Concepto", "Debe", "Haber", "Saldo"],
  ["", "", "Saldo anterior", null, null, 15000],
  [f("2026-06-04"), 210, "Cobro venta 1001 (neto de comisión)", 47580, null, 62580],
  [f("2026-06-09"), 211, "Cobro venta 1002 (neto de comisión)", 28548, null, 91128],
  [f("2026-06-12"), 212, "Transferencia a Banco del Río", null, 80000, 11128],
];

// 3) Planilla ambigua (solo Débito/Crédito, sin título): CSV de un extracto.
const ambiguaCsv = ["Fecha;Detalle;Débitos;Créditos;Saldo", "01/06/2026;SALDO ANTERIOR;;;1.000,00", "02/06/2026;TRANSFERENCIA RECIBIDA;;500,00;1.500,00", "03/06/2026;COMISION;50,00;;1.450,00"].join("\n");

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "extracto-banco-del-rio.xlsx"), escribirXlsx([{ nombre: "Movimientos", filas: banco }]));
writeFileSync(join(OUT, "mayor-banco-del-rio.xlsx"), escribirXlsx([{ nombre: "Mayor", filas: mayorBanco }]));
writeFileSync(join(OUT, "mercadopago-liberaciones.xlsx"), escribirXlsx([{ nombre: "release_report", filas: mp }]));
writeFileSync(join(OUT, "mayor-mercadopago.xlsx"), escribirXlsx([{ nombre: "Mayor", filas: mayorMP }]));
writeFileSync(join(OUT, "extracto-ambiguo.csv"), ambiguaCsv);
writeFileSync(join(OUT, "README.md"), `# Planillas de ejemplo

Casos sintéticos (ningún dato es real) para probar Conciliar con planillas:

| Archivo | Qué es |
|---|---|
| \`extracto-banco-del-rio.xlsx\` | Extracto bancario exportado a Excel (título del banco, Débito/Crédito, saldo corrido). |
| \`mayor-banco-del-rio.xlsx\` | Mayor de la cuenta Banco en Excel (Debe/Haber, asiento). Quedan pendientes el depósito del 15/06 (en tránsito), el cheque 12346 (no cobrado), impuestos y comisiones. |
| \`mercadopago-liberaciones.xlsx\` | Reporte de liberaciones de Mercado Pago (columnas RECORD_TYPE, NET_CREDIT_AMOUNT…). |
| \`mayor-mercadopago.xlsx\` | Mayor de la cuenta Mercado Pago. Faltan asentar la percepción de IIBB y los rendimientos. |
| \`extracto-ambiguo.csv\` | Planilla con solo "Débitos / Créditos" (podría ser extracto o mayor): Fulgoria la lee de las dos maneras y se queda con la que hace cerrar los saldos. |

Se regeneran con \`node tools/dataset/planillas.mjs\`.
`);
console.log("Planillas de ejemplo en", OUT);
