# Núcleo de conciliación (`src/core/`)

Motor de conciliación bancaria de Fulgoria: toma el **extracto** (lo que ya lee el extractor,
verificado con la regla del saldo) y el **mayor de la cuenta Banco** (de cualquier sistema
contable, en CSV), los empareja, explica cada partida pendiente y arma el papel de trabajo.

JS puro (ESM), sin DOM ni dependencias: corre igual en el navegador y en Node.

## Principios

- **Centavos enteros** en todo el núcleo (`cents`). Nada de coma flotante en las sumas.
- **Un solo signo** para los dos lados: `cents > 0` = entra plata a la cuenta, `< 0` = sale.
  En el extracto, crédito > 0; en el mayor de Banco, Debe > 0. Contrapartidas = mismo número.
- **Semáforo**: verde = probado sin ambigüedad (se confirma solo); amarillo = propuesta que
  necesita un clic; rojo = necesita a una persona. Nunca se pinta de verde algo que tenga una
  alternativa igual de buena.
- **Diferencia no explicada = 0** o la conciliación no está terminada. No existe "varios".
- **Cada decisión dice por qué** (`motivos` en cada emparejamiento, `motivo` en cada pendiente).
- **Evidencia**: cada movimiento sabe de dónde salió (página y altura en el PDF, fila del CSV).

## Flujo

```
extract() (PDF) ──fromExtract──▶ Mov[] banco ─┐
                                              ├─ reconcile() ─▶ matches, pendientes, ajustes,
parseLedgerCsv() (mayor) ───────▶ Mov[] libros┘                 bandeja, diferenciaNoExplicada
                                                                    │
                     papelSaldoASaldo() ─▶ papelToMarkdown / papelToCsv / asientosToCsv
                     arrastreSiguiente() ─▶ pendientes que pasan al período siguiente
```

## Módulos

| Archivo | Qué hace |
|---|---|
| `money.js` | centavos: parseo tolerante de planillas, formato es-AR |
| `dates.js` | fechas ISO, diferencias en días |
| `text.js` | normalización y similitud de descripciones |
| `entities.js` | CUIT (con dígito verificador), CBU, nº de cheque/ECHEQ, comprobante, VEP |
| `model.js` | `Mov` y conversión desde el resultado del extractor |
| `ledger.js` | lector de mayores: detecta columnas por encabezado, apertura, totales, control del saldo |
| `classify.js` | clasificador determinista del ruido bancario AR (ley 25.413, SIRCREB, percepciones, comisiones, IVA, intereses, VEP, tarjetas, MP…) con control de plausibilidad del 0,6% |
| `match.js` | cascada de emparejamiento: referencia → exacto (asignación global) → agrupado N:1/1:N → tolerancia |
| `reconcile.js` | pendientes por tipo, ecuación de cierre, apertura vs. arrastre, asientos propuestos, bandeja, continuidad entre extractos |
| `workpaper.js` | papel de trabajo saldo a saldo (Markdown/CSV) y asientos (CSV) |
| `config.js` | los "mandos" con sus valores por defecto; se pisan por capas (estudio → cliente → cuenta) |

## Los mandos (modo deportivo)

Todo lo que el motor decide sale de `config.js` y se puede pisar:

```js
import { resolveConfig } from "./src/core/index.js";
const cfg = resolveConfig(
  { cuentas: { banco: "1.1.02.001 Banco Galicia CC" } },         // estudio: plan de cuentas
  { cliente: { pagoACuenta25413: 100 } },                         // cliente MiPyME
  { match: { toleranciaCents: 100, ventanaDias: { despues: 10 } } } // esta cuenta
);
```

Reglas de clasificación propias del cliente: `reconcile({ ..., reglas: [{ tipo, grupo, re }] })`
(se evalúan antes que las de fábrica).

## Interfaz (`conciliar.html` + `src/conciliar.js`)

En la app: menú ⋮ → **Conciliar con el mayor** (o `/conciliar`). Todo corre en el navegador.

- **Automático**: soltás el extracto (PDF/imagen) y el mayor (CSV). Reusa las plantillas que
  guardó el Extractor; si no hay, auto-detecta. Muestra el estado general (semáforo, saldos,
  diferencia no explicada) y la **bandeja**: lo rojo y amarillo abierto, lo verde plegado.
  Acciones: *Pedir al cliente* (arma el mensaje con las partidas sin identificar), *Confirmar* /
  *No es esto* en las propuestas, *Descargar asientos*, *Ver en el extracto* (recorte del PDF
  con la fila marcada).
- **Deportivo**: lo mismo + panel de **mandos** en vivo (ventanas, tolerancia, agrupados,
  % pago a cuenta 25.413, plan de cuentas, fecha de cierre; se guardan en el navegador) +
  **mesa de conciliación** para emparejar a mano.
- **Columnas del mayor**: si no se reconocen (o para corregirlas), se indican a mano con vista
  previa en vivo ("los saldos cierran") y se guardan como **plantilla de mayor** del sistema
  contable; la próxima vez se reconoce sola. Se descarga/importa como JSON (soltándolo en la página).
- **Papel de trabajo** con exportes: Markdown, CSV, asientos CSV, JSON y *Pendientes para el mes
  siguiente* (un JSON que se suelta junto con los archivos del mes siguiente para el arrastre).

## Probar

```bash
npm test                                   # tests del extractor y del núcleo
cd tools && npm install && cd ..           # una vez (pdfjs para leer el PDF desde Node)
node tools/conciliar.mjs samples/banco-rio-cc.pdf samples/mayor-banco-rio-cc.csv
node tools/conciliar.mjs extracto.pdf mayor.csv --config mandos.json --out salida/
```

`samples/mayor-banco-rio-cc.csv` es un mayor sintético armado para el extracto de ejemplo, con
partidas conocidas: un depósito que agrupa dos cobranzas, un cheque pendiente, un depósito en
tránsito, cuatro gastos/impuestos sin registrar y un crédito que el cliente no registró.

## Dataset sintético y benchmark

`datasets/conciliacion-sintetica/` tiene 130 casos con la respuesta correcta (ver su README) y
`node tools/dataset/bench.mjs` mide el lector y el motor contra ellos (`RESULTADOS.md`). Lo que el
dataset encontró y se corrigió:

| | Antes | Después |
|---|---:|---:|
| Extractos leídos exactos (con plantilla) | 56% | 100% |
| Pares encontrados | 65,3% | 99,7% |
| Pares confirmados solos | 60,4% | 90,4% |
| Verdes incorrectos (con plantilla / sin plantilla) | 0 / 1 | 0 / 0 |
| Falsos ajustes (operaciones tomadas por gastos del banco) | 21 | 0 |

- Lector: rol **Signo (D/H)**; saldo inicial/final tomado de los rótulos cuando no hay saldo
  corrido; fechas sin año (DD/MM) con el año del encabezado (`docYear`).
- Motor: estrategias **consolidado** (asiento mensual = N líneas del banco), **neto** (venta bruta −
  arancel − IVA = acreditación), **ampliado** (importe exacto con fecha lejana, en amarillo),
  agrupados de hasta 8 partidas y desempate por nombre en importes repetidos.
- Regla nueva: si la lectura de un documento no está verificada, **nada se confirma solo**.
- Clasificador: el débito automático de un seguro ya no se toma por comisión del banco.

## Pendiente

- Persistencia por cliente / cuenta / período (hoy el arrastre se lleva con el JSON de pendientes).
- Traducciones de la pantalla de conciliación (hoy solo en español).
- Editor de reglas de clasificación propias en la interfaz (el motor ya las acepta).
- Lectura de XLSX (las plantillas de mayor ya existen; falta leer el archivo Excel).
- CSV "Dinero liberado" de Mercado Pago; liquidaciones de tarjetas (N:1 con aranceles).
- Exportación de asientos en el formato de importación de cada sistema.
- IA opcional para casos ambiguos, sobre filas ya anonimizadas, solo como sugerencia.
