# Resultados del benchmark

Generado por `node tools/dataset/bench.mjs` sobre 148 casos (171 cuentas), leyendo cada extracto con la plantilla de su banco.
Este archivo se regenera: es la foto del estado actual del lector y del motor contra el dataset.

## Global

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total** | 171 | 100% | 100% | 98.9% | 90.1% | **0** | 9 | 99.7% | 100% | 0 | 100% |

## Por escenario

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| basico | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| ruido_fiscal | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| cheques | 14 | 100% | 100% | 100% | 100% | **0** | 0 | 100% | 100% | 0 | 100% |
| agrupados | 14 | 100% | 100% | 96.6% | 60.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| repetidos | 14 | 100% | 100% | 100% | 94.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| desfasaje | 14 | 100% | 100% | 100% | 80.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| consolidados | 14 | 100% | 100% | 100% | 82.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| tarjetas_brutas | 14 | 100% | 100% | 100% | 65.7% | **0** | 0 | 100% | 100% | 0 | 100% |
| errores | 14 | 100% | 100% | 96.9% | 89.4% | **0** | 0 | 100% | 100% | 0 | 100% |
| volumen | 14 | 100% | 100% | 100% | 95.5% | **0** | 0 | 100% | 100% | 0 | 100% |
| arrastre | 10 | 100% | 100% | 100% | 97.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| adversarial | 21 | 100% | 100% | 87.4% | 68.4% | **0** | 9 | 94.5% | 100% | 0 | 100% |

## Por formato de banco

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plata | 25 | 100% | 100% | 98.8% | 91% | **0** | 0 | 100% | 100% | 0 | 100% |
| federal | 25 | 100% | 100% | 98.9% | 90.2% | **0** | 0 | 100% | 100% | 0 | 100% |
| nativo | 25 | 100% | 100% | 98.7% | 89.3% | **0** | 4 | 99.2% | 100% | 0 | 100% |
| pampeana | 25 | 100% | 100% | 99% | 89.1% | **0** | 0 | 100% | 100% | 0 | 100% |
| cuyano | 46 | 100% | 100% | 99.2% | 90.8% | **0** | 0 | 100% | 100% | 0 | 100% |
| atlantico | 25 | 100% | 100% | 98.7% | 90.2% | **0** | 5 | 99% | 100% | 0 | 100% |

## Por formato de mayor

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| debitos_creditos_us | 28 | 100% | 100% | 99% | 88.6% | **0** | 2 | 99.6% | 100% | 0 | 100% |
| importe_signo_tab | 29 | 100% | 100% | 99% | 90.2% | **0** | 1 | 99.8% | 100% | 0 | 100% |
| parentesis_transporte | 28 | 100% | 100% | 98.9% | 90.3% | **0** | 2 | 99.6% | 100% | 0 | 100% |
| planilla_cliente | 27 | 100% | 100% | 98.9% | 90.9% | **0** | 1 | 99.8% | 100% | 0 | 100% |
| comillas_coma | 29 | 100% | 100% | 98.9% | 90.6% | **0** | 1 | 99.8% | 100% | 0 | 100% |
| debe_haber_ar | 30 | 100% | 100% | 98.6% | 90.1% | **0** | 2 | 99.6% | 100% | 0 | 100% |

## Pares esperados que el motor no encontró, por tipo

| Tipo de par | Cantidad |
|---|---:|
| error_importe | 41 |
| agrupado | 7 |

## Auto-detección de columnas (sin plantilla)

| | Cuentas | Lectura extracto | Lectura mayor | Pares encontrados | Pares confirmados solos | Verdes incorrectos | Amarillos incorrectos | Pendientes bien tipificados | Ajustes bien clasificados | Falsos ajustes | Diferencia 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Total (auto)** | 171 | 99.4% | 100% | 97% | 86.3% | **0** | 9 | 95.1% | 100% | 0 | 99.4% |

## Cómo leer la tabla

- **Lectura extracto / mayor**: el lector obtuvo exactamente los mismos movimientos (fecha e importe) y los mismos saldos que el documento.
- **Pares encontrados**: emparejamientos correctos (en verde o en amarillo) sobre el total de emparejamientos esperados.
- **Pares confirmados solos**: los que quedaron en verde y estaban bien; el resto necesitó un clic o no se encontró.
- **Verdes incorrectos**: emparejamientos que el sistema confirmó solo y estaban mal. Tiene que ser 0.
- **Pendientes bien tipificados**: partidas sin pareja que quedaron con el tipo correcto (cheque pendiente, depósito en tránsito, ajuste bancario…).
- **Ajustes bien clasificados**: líneas de impuestos, gastos e intereses del banco reconocidas con el tipo correcto. **Falsos ajustes**: líneas operativas tomadas por gastos.
- **Diferencia 0**: la ecuación de cierre dio exacto al centavo.
