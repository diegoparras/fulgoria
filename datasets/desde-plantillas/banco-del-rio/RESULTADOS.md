# Resultados del benchmark

Generado por `node tools/dataset/bench.mjs` sobre 20 casos (20 cuentas), leyendo cada extracto con la plantilla de su banco.
Este archivo se regenera: es la foto del estado actual del lector y del motor contra el dataset.

## Global

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total** | 20 | 100% | 100% | 99.7% | 90.4% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por escenario

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| basico | 2 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| ruido_fiscal | 2 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| cheques | 2 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| agrupados | 2 | 100% | 100% | 100% | 59.5% | **0** | 0 | 100% | 100% | 0 | 100% |
| repetidos | 2 | 100% | 100% | 100% | 92.6% | **0** | 0 | 100% | 100% | 0 | 100% |
| desfasaje | 2 | 100% | 100% | 100% | 78.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| consolidados | 2 | 100% | 100% | 100% | 88.6% | **0** | 0 | 100% | 100% | 0 | 100% |
| tarjetas_brutas | 2 | 100% | 100% | 100% | 58.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| errores | 2 | 100% | 100% | 91.7% | 83.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| volumen | 2 | 100% | 100% | 100% | 95% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por formato de banco

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| banco-del-rio | 20 | 100% | 100% | 99.7% | 90.4% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por formato de mayor

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| debitos_creditos_us | 3 | 100% | 100% | 100% | 88.4% | **0** | 0 | 100% | 100% | 0 | 100% |
| importe_signo_tab | 4 | 100% | 100% | 100% | 90.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| parentesis_transporte | 4 | 100% | 100% | 98.3% | 86.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| planilla_cliente | 4 | 100% | 100% | 99.6% | 91.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| comillas_coma | 3 | 100% | 100% | 100% | 92.5% | **0** | 0 | 100% | 100% | 0 | 100% |
| debe_haber_ar | 2 | 100% | 100% | 100% | 80% | **0** | 0 | 100% | 100% | 0 | 100% |

## Pares esperados que el motor no encontró, por tipo

| Tipo de par | Cantidad |
|---|---:|
| error_importe | 2 |

## Auto-detección de columnas (sin plantilla)

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total (auto)** | 20 | 100% | 100% | 99.7% | 90.4% | **0** | 0 | 100% | 100% | 0 | 100% |

## Cómo leer la tabla

- **Lectura extracto / mayor**: el lector obtuvo exactamente los mismos movimientos (fecha e importe) y los mismos saldos que el documento.
- **Pares encontrados**: emparejamientos correctos (en verde o en amarillo) sobre el total de emparejamientos esperados.
- **Pares confirmados solos**: los que quedaron en verde y estaban bien; el resto necesitó un clic o no se encontró.
- **Verdes incorrectos**: emparejamientos que el sistema confirmó solo y estaban mal. Tiene que ser 0.
- **Pendientes bien tipificados**: partidas sin pareja que quedaron con el tipo correcto (cheque pendiente, depósito en tránsito, ajuste bancario…).
- **Ajustes bien clasificados**: líneas de impuestos, gastos e intereses del banco reconocidas con el tipo correcto. **Falsos ajustes**: líneas operativas tomadas por gastos.
- **Diferencia 0**: la ecuación de cierre dio exacto al centavo.
