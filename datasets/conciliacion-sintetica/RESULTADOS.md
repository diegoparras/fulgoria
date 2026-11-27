# Resultados del benchmark

Generado por `node tools/dataset/bench.mjs` sobre 130 casos (150 cuentas), leyendo cada extracto con la plantilla de su banco.
Este archivo se regenera: es la foto del estado actual del lector y del motor contra el dataset.

## Global

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total** | 150 | 100% | 100% | 99.7% | 90.4% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por escenario

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| basico | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| ruido_fiscal | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| cheques | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| agrupados | 14 | 100% | 100% | 96.6% | 60.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| repetidos | 14 | 100% | 100% | 100% | 72.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| desfasaje | 14 | 100% | 100% | 100% | 79.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| consolidados | 14 | 100% | 100% | 100% | 82.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| tarjetas_brutas | 14 | 100% | 100% | 100% | 65.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| errores | 14 | 100% | 100% | 96.9% | 89.4% | **0** | 0 | 100% | 100% | 0 | 100% |
| volumen | 14 | 100% | 100% | 100% | 95.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| arrastre | 10 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por formato de banco

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plata | 22 | 100% | 100% | 99.6% | 91.9% | **0** | 0 | 100% | 100% | 0 | 100% |
| federal | 22 | 100% | 100% | 99.7% | 88.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| nativo | 22 | 100% | 100% | 99.5% | 90.4% | **0** | 0 | 100% | 100% | 0 | 100% |
| pampeana | 22 | 100% | 100% | 99.9% | 90.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| cuyano | 40 | 100% | 100% | 100% | 90.3% | **0** | 0 | 100% | 100% | 0 | 100% |
| atlantico | 22 | 100% | 100% | 99.6% | 91.5% | **0** | 0 | 100% | 100% | 0 | 100% |

## Por formato de mayor

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| debitos_creditos_us | 24 | 100% | 100% | 99.8% | 88.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| importe_signo_tab | 26 | 100% | 100% | 99.8% | 91.2% | **0** | 0 | 100% | 100% | 0 | 100% |
| parentesis_transporte | 25 | 100% | 100% | 99.7% | 90.8% | **0** | 0 | 100% | 100% | 0 | 100% |
| planilla_cliente | 24 | 100% | 100% | 99.7% | 91% | **0** | 0 | 100% | 100% | 0 | 100% |
| comillas_coma | 25 | 100% | 100% | 99.7% | 90.8% | **0** | 0 | 100% | 100% | 0 | 100% |
| debe_haber_ar | 26 | 100% | 100% | 99.4% | 90.1% | **0** | 0 | 100% | 100% | 0 | 100% |

## Pares esperados que el motor no encontró, por tipo

| Tipo de par | Cantidad |
|---|---:|
| agrupado | 7 |
| error_importe | 5 |

## Auto-detección de columnas (sin plantilla)

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total (auto)** | 150 | 64% | 100% | 60% | 54% | **0** | 1 | 60.7% | 100% | 0 | 76% |

## Cómo leer la tabla

- **Lectura extracto / mayor**: el lector obtuvo exactamente los mismos movimientos (fecha e importe) y los mismos saldos que el documento.
- **Pares encontrados**: emparejamientos correctos (en verde o en amarillo) sobre el total de emparejamientos esperados.
- **Pares confirmados solos**: los que quedaron en verde y estaban bien; el resto necesitó un clic o no se encontró.
- **Verdes incorrectos**: emparejamientos que el sistema confirmó solo y estaban mal. Tiene que ser 0.
- **Pendientes bien tipificados**: partidas sin pareja que quedaron con el tipo correcto (cheque pendiente, depósito en tránsito, ajuste bancario…).
- **Ajustes bien clasificados**: líneas de impuestos, gastos e intereses del banco reconocidas con el tipo correcto. **Falsos ajustes**: líneas operativas tomadas por gastos.
- **Diferencia 0**: la ecuación de cierre dio exacto al centavo.
