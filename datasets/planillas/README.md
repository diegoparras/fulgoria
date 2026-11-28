# Planillas de ejemplo

Casos sintéticos (ningún dato es real) para probar Conciliar con planillas:

| Archivo | Qué es |
|---|---|
| `extracto-banco-del-rio.xlsx` | Extracto bancario exportado a Excel (título del banco, Débito/Crédito, saldo corrido). |
| `mayor-banco-del-rio.xlsx` | Mayor de la cuenta Banco en Excel (Debe/Haber, asiento). Quedan pendientes el depósito del 15/06 (en tránsito), el cheque 12346 (no cobrado), impuestos y comisiones. |
| `mercadopago-liberaciones.xlsx` | Reporte de liberaciones de Mercado Pago (columnas RECORD_TYPE, NET_CREDIT_AMOUNT…). |
| `mayor-mercadopago.xlsx` | Mayor de la cuenta Mercado Pago. Faltan asentar la percepción de IIBB y los rendimientos. |
| `tarjetas-extracto.xlsx`, `tarjetas-mayor.xlsx`, `tarjetas-liquidaciones.xlsx` | Ventas con tarjeta: el banco acredita netos (Visa sola; dos liquidaciones de Mastercard juntas) que el mayor del banco no tiene; la planilla de liquidaciones de la procesadora los explica y Fulgoria propone los asientos. |
| `extracto-ambiguo.csv` | Planilla con solo "Débitos / Créditos" (podría ser extracto o mayor): Fulgoria la lee de las dos maneras y se queda con la que hace cerrar los saldos. |

Se regeneran con `node tools/dataset/planillas.mjs`.
