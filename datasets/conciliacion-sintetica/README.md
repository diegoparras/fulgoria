# Dataset sintético de conciliación bancaria

130 casos de conciliación bancaria con **la respuesta correcta incluida**: un extracto en PDF, el
mayor de la cuenta Banco en CSV y un `esperado.json` que dice qué empareja con qué, qué queda
pendiente y de qué tipo. Pensado para medir y mejorar cualquier herramienta de conciliación
(Fulgoria u otra) contra los problemas reales de los estudios contables argentinos.

**Todo es ficticio**: bancos, titulares, empresas, personas, CUIT, CBU y números de cuenta. Los
CUIT se generan al azar con dígito verificador válido para que los detectores funcionen; no
corresponden a nadie en particular. Cada PDF lo dice en el pie: *Documento sintético de prueba*.

- 130 casos · 150 cuentas (los extractos con pesos y dólares traen dos) · ~9.400 líneas de
  extracto · ~4.700 registros de mayor · ~7 MB.
- Reproducible: `node tools/dataset/gen.mjs` regenera exactamente los mismos archivos.
- Licencia: Apache-2.0, como el resto del repositorio. Usalo, copialo, mejoralo.

## Estructura

```
datasets/conciliacion-sintetica/
  README.md            este archivo
  casos.json           índice: id, escenario, banco, formato de mayor, cantidades
  RESULTADOS.md        resultados actuales de Fulgoria contra el dataset (se regenera)
  resultados.json      lo mismo, en datos
  plantillas/          plantillas de Fulgoria por banco (se cargan en el Extractor)
  casos/<id>/
    extracto.pdf       el resumen del banco (PDF digital, una o varias páginas)
    mayor.csv          el mayor de la cuenta Banco (mayor-ars.csv + mayor-usd.csv si hay dos cuentas)
    plantilla.json     dónde está cada columna del extracto (coordenadas 0..1 y rol)
    esperado.json      la respuesta correcta
    pendientes-anterior.json   (solo casos "arrastre", mes 2) lo que quedó pendiente del mes anterior
```

## La respuesta esperada (`esperado.json`)

Importes en **centavos enteros**, con un solo signo para los dos lados: positivo = entra plata a la
cuenta (crédito en el extracto, Debe en el mayor), negativo = sale. Fechas ISO.

```jsonc
{
  "id": "027-cheques-federal", "escenario": "cheques", "banco": "federal", "sistema": "planilla_cliente",
  "periodo": { "desde": "2026-10-01", "hasta": "2026-10-31" },
  "cuentas": [{
    "segmento": 0,                     // orden de la cuenta dentro del PDF
    "moneda": "ARS", "mayor": "mayor.csv",
    "saldos": { "bancoApertura": 1288839087, "bancoCierre": 1777468511, "librosApertura": 1288839087, "librosCierre": 469423291 },
    "banco":  [{ "id": "B1", "fecha": "2026-10-05", "cents": 41100000, "descripcion": "DEP CHEQUES OTROS BANCOS", "tipo": "deposito" }, …],
    "libros": [{ "id": "L1", "fecha": "2026-10-01", "cents": -179876000, "descripcion": "Cheque N° 00087558 a …", "comprobante": "CH 00087558", "asiento": 198 }, …],
    "pares":  [{ "banco": ["B30"], "libros": ["L10"], "tipo": "referencia" }, …],
    "pendientes": [{ "id": "L19", "lado": "libros", "tipo": "cheque_pendiente" }, …],
    "diferenciaNoExplicada": 0
  }]
}
```

- `banco` y `libros` están **en el orden del documento**: `B1` es la primera línea del extracto
  (sin contar el saldo anterior) y `L1` el primer registro del mayor.
- `tipo` de cada línea del banco: `transferencia`, `cheque`, `deposito`, `impuesto_25413`,
  `retencion_iibb`, `comision`, `iva_comision`, `percepcion_iva`, `debito_automatico`, `vep_arca`,
  `tarjeta_liquidacion`, `mercadopago`, `sueldos`, `interes_ganado`.
- `pares[].tipo`: `uno_a_uno`, `referencia` (comparten nº de cheque, comprobante o VEP), `agrupado`
  (un depósito = varias cobranzas), `consolidado` (un asiento mensual = muchas líneas del banco),
  `bruto_neto` (venta bruta − arancel − IVA = acreditación), `error_importe` (el libro tiene un
  importe mal tipeado: es la misma operación, pero no debería emparejarse sola), `arrastre`.
- `pendientes[].tipo`: `ajuste_bancario` (impuestos, gastos e intereses del banco que hay que
  asentar), `credito_no_identificado`, `debito_no_identificado`, `cheque_pendiente`,
  `egreso_pendiente`, `deposito_transito`, `ingreso_no_acreditado`.
- Los ajustes del impuesto ley 25.413 se esperan con 33% como pago a cuenta (`cliente.pagoACuenta25413`).

## Escenarios

Cada escenario × 6 formatos de banco × 2 variantes; *arrastre* son 5 pares de meses seguidos.

| Escenario | Qué prueba |
|---|---|
| `basico` | Pocos movimientos, casi todos 1 a 1; gastos bancarios sin registrar; un cheque pendiente y un depósito en tránsito |
| `ruido_fiscal` | Impuesto ley 25.413 en cada movimiento, SIRCREB en cada acreditación, comisión con IVA y percepción, intereses |
| `cheques` | Cheques y ECHEQ que se debitan días después, varios pendientes al cierre (algunos viejos) y un cheque de tercero rechazado |
| `agrupados` | Depósitos que juntan cobranzas y retiros de Mercado Pago que juntan hasta 9 ventas; liquidaciones de tarjeta netas |
| `repetidos` | Sueldos idénticos el mismo día, alquileres y cuotas iguales: la ambigüedad que nunca debe confirmarse sola sin un dato que la resuelva |
| `desfasaje` | El libro registra hasta 15 días antes o después que el banco |
| `consolidados` | El cliente asienta los gastos e impuestos del banco en un solo asiento mensual por concepto |
| `tarjetas_brutas` | El libro registra la venta con tarjeta en bruto y aparte arancel e IVA; el banco acredita el neto |
| `errores` | Importe transpuesto, registro duplicado, crédito y débito que el cliente no registró, ingreso registrado que nunca llegó |
| `volumen` | 400 a 560 líneas del extracto en hasta 17 páginas |
| `arrastre` | Mes 1 deja cheques, depósitos y un crédito sin identificar; el mes 2 trae `pendientes-anterior.json` y los resuelve |

## Formatos de extracto (bancos ficticios)

Cada uno reproduce un **rasgo estructural** que existe en extractos argentinos reales, no la marca
ni el diseño de ningún banco.

| Formato | Rasgo |
|---|---|
| `plata` | Débito y crédito en columnas separadas, saldo corrido, descripciones en dos líneas |
| `federal` | Importe con signo en una sola columna, columna de referencia, año de dos dígitos, cierre "SALDO AL dd/mm/aaaa" |
| `nativo` | Importe siempre positivo y columna **D/H** que da el sentido |
| `pampeana` | **Sin saldo corrido**: saldo inicial y final solo en el encabezado y el pie |
| `cuyano` | **Dos cuentas en el mismo PDF** (pesos y dólares), con un mayor para cada una |
| `atlantico` | **Fechas sin año** (DD/MM), fecha valor, nº de comprobante, importes con `$` |

## Formatos de mayor

Estilos genéricos con las variaciones que aparecen al exportar de distintos sistemas o planillas;
no son la exportación exacta de ningún producto comercial.

| Formato | Rasgo |
|---|---|
| `debe_haber_ar` | `;`, `1.234,56`, Debe/Haber/Saldo, filas *Saldo anterior* y *Totales* |
| `debitos_creditos_us` | `,`, `1234.56`, fechas ISO, título con empresa, cuenta y período antes del encabezado |
| `importe_signo_tab` | Tabulado, un solo importe con signo, sin saldo corrido |
| `parentesis_transporte` | `DD-MM-AA`, `$` y paréntesis para el Haber, fila *Transporte* y subtotales por página |
| `planilla_cliente` | Mayúsculas, INGRESOS/EGRESOS, `D/M/AAAA`, algunas descripciones partidas en dos filas |
| `comillas_coma` | `,` con campos entre comillas que tienen comas adentro, Debe/Haber sin saldo |

## Regenerar y medir

```bash
cd tools && npm install && cd ..
node tools/dataset/gen.mjs            # regenera los 130 casos (mismas semillas = mismos archivos)
node tools/dataset/bench.mjs          # mide Fulgoria y reescribe RESULTADOS.md
node tools/dataset/bench.mjs --auto   # además mide la lectura sin plantilla (auto-detección)
node tools/dataset/bench.mjs --detalle 027   # qué falló en los casos que contienen "027"
```

Para medir **otra herramienta**: leé `extracto.pdf` y el mayor con ella y compará su resultado
contra `esperado.json`. El criterio que usa `bench.mjs`:

- un par es correcto si coincide con uno de `pares` (o con uno equivalente: mismas fechas e importes);
- un **verde incorrecto** es un par que la herramienta confirmó sin intervención humana y no está
  en `pares`. Es el error que más importa: tiene que ser 0;
- los pendientes se comparan como multiconjunto de (lado, tipo, importe).

## Lo que este dataset todavía no cubre

- Extractos **escaneados o fotografiados** (OCR) y PDF con capa de texto rota.
- Mayores en **XLSX** (solo CSV) y en formatos de importación propietarios.
- Extractos que mezclan formatos dentro del mismo PDF o cambian de diseño a mitad de año.
- Liquidaciones de tarjeta con cuotas y contracargos; reportes CSV de Mercado Pago.
- Multimoneda con diferencia de cambio en el libro.
- Que los formatos se parezcan a los reales lo suficiente: es una aproximación. Si tenés acceso a
  extractos reales, las plantillas y los rasgos que falten se pueden agregar en
  `tools/dataset/bancos.mjs` y `tools/dataset/sistemas.mjs` sin subir ningún dato.

## Agregar casos

- Un escenario nuevo: una función en `tools/dataset/escenarios.mjs` que escribe los dos lados y
  declara la respuesta con `c.par(...)` y `c.pendB/pendL(...)`.
- Un formato de banco: un objeto en `BANCOS` (`tools/dataset/bancos.mjs`) con sus columnas,
  rótulos y vocabulario.
- Un formato de mayor: un `write()` en `SISTEMAS` (`tools/dataset/sistemas.mjs`).
