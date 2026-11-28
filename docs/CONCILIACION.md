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

En la app: botón **Conciliar** de la portada, o menú ⋮ → Secciones → **Conciliar** (desde cualquier pantalla), o `/conciliar`. Todo corre en el navegador.

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

## Modo estudio (persistencia)

Con `PERSISTENCIA=on` (ver `docs/DEPLOY.md`, sección 4) la pantalla Conciliar trabaja por **cliente →
cuenta → mes**: los documentos se suben al servidor del estudio o a su bucket R2/S3 (cifrados si hay
`DOCS_CLAVE`), todo se autoguarda, cada mes trae solo los pendientes del anterior y pasa por
**borrador → preparado → revisado → cerrado** (cerrar exige diferencia no explicada = 0 y deja el mes en
solo lectura; cambiar documentos o decisiones de un mes preparado lo vuelve a borrador). Hay
**tablero de cartera**, plantillas de banco y de mayor **compartidas por el estudio**, mandos por cuenta,
control de concurrencia (si dos personas editan el mismo mes, la segunda recibe lo último) y un
registro de auditoría. Código: `server/persistencia.js` (SQLite con `node:sqlite`), `server/blobs.js`
(disco / S3 con firma SigV4 vía `aws4fetch`, cifrado AES-256-GCM), `server/api.js` (`/api/v1`).

## Roles

`server/roles.js`: lector → preparador → revisor → admin. Standalone (usuarios en la base, el del
`.env` es admin) o federado con Lockatus (`LOCKATUS_ROLES`). La API controla cada acción
(`exige(permiso)`), la pantalla muestra solo lo que el rol puede hacer y `REVISION_INDEPENDIENTE=on`
impide revisar lo propio.

## IA para bancos nuevos

`src/ia.js` arma un esqueleto anónimo del PDF (posiciones y tipos de celda, importes y fechas como
patrón) y elige entre las propuestas del modelo con la regla del saldo (`evaluarColumnas`);
`server/ia.js` sanea el esqueleto otra vez y llama al proveedor: Claude con el SDK oficial (salida
estructurada, fallback del servidor) o GPT / OpenRouter / local por la API compatible con OpenAI. Una
propuesta que cierra queda guardada como plantilla del banco. Verificado sobre los 148 casos del
dataset: ninguna fuga de datos en el esqueleto y, con una propuesta correcta y una equivocada, la
regla del saldo eligió siempre la correcta.

## Dataset sintético y benchmark

`datasets/conciliacion-sintetica/` tiene 148 casos con la respuesta correcta (ver su README), entre
ellos un set **adversarial** de trampas, y `node tools/dataset/bench.mjs` mide el lector y el motor
contra ellos (`RESULTADOS.md`). Lo que el dataset encontró y se corrigió:

| | Antes | Después |
|---|---:|---:|
| Extractos leídos exactos, con plantilla | 56% | 100% |
| Extractos leídos exactos, sin plantilla (auto-detección) | 64% | 99,4% |
| Pares encontrados (sin contar el set adversarial) | 65,3% | 99,7% |
| Verdes incorrectos en el set adversarial | 62 | 0 |
| Verdes incorrectos en todo el dataset | 0 / 1 sin plantilla | 0 / 0 |
| Falsos ajustes (operaciones tomadas por gastos del banco) | 21 | 0 |

- Lector: rol **Signo (D/H)**; saldo inicial/final tomado de los rótulos cuando no hay saldo
  corrido; fechas sin año (DD/MM) con el año del encabezado (`docYear`).
- **Auto-detección verificada**: prueba varias lecturas de las columnas (con o sin saldo,
  débito/crédito o al revés, columna D/H, agrupando importes por solapamiento o por borde derecho) y
  la regla del saldo elige la que cierra. Los rótulos con importe ("Saldo inicial al…: $ …") ya no
  se confunden con celdas de importe.
- Motor: estrategias **consolidado** (asiento mensual = N líneas del banco), **neto** (venta bruta −
  arancel − IVA = acreditación), **ampliado** (importe exacto con fecha lejana, en amarillo),
  agrupados de hasta 8 partidas y desempate por nombre en importes repetidos.
- **Conflicto de identidad**: si cheque, VEP o CUIT no coinciden, el par no se confirma ni se
  propone; si solo no coincide el nombre de la contraparte (en transferencias y sueldos), se propone
  en amarillo con el motivo. El comprobante no cuenta como conflicto (factura vs. recibo de la misma
  cobranza). El motor sigue buscando la alternativa correcta (por ejemplo, el agrupado del mismo cliente).
- Regla: si la lectura de un documento no está verificada, **nada se confirma solo**.
- Clasificador: el débito automático de un seguro ya no se toma por comisión del banco.
- Entidades: número de cheque con palabras en el medio ("CHEQUE CAMARA NRO …"); todos los
  comprobantes que cita una operación, no solo el primero.

## Asientos para cada sistema contable

### El formato de tu sistema, aprendido de un ejemplo

En "Descargar asientos" → **Agregar el formato de mi sistema**, el contador sube un archivo de
importación de asientos que su sistema contable acepta (Excel, CSV, TXT con separadores o de ancho
fijo; uno o dos asientos alcanzan). Fulgoria (`src/core/formato-asientos.js`) deduce:

- el tipo de archivo, separador, codificación (UTF‑8 o Windows/Latin‑1), BOM y saltos de línea;
- si tiene títulos, y qué es cada columna: fecha, número de asiento, cuenta, Debe, Haber, importe
  con D/H aparte o pegado ("1980.00D"), importe con signo, concepto, detalle, valores fijos (los que
  se repiten en todas las filas de su tipo, como un circuito o una sucursal) y columnas opcionales;
- el formato de fecha (DD/MM/AAAA, AAAAMMDD, D/M/AA…), de importes (decimales, miles, cero vacío o
  "0,00", negativos), de cuenta (código con o sin puntos, nombre, o ambos) y la numeración
  (correlativa o por fecha, con ceros a la izquierda);
- si cada asiento lleva una fila de cabecera (fecha y concepto) seguida de las cuentas, o repite
  los datos en cada línea, y si hay una línea en blanco entre asientos.

El contador ve lo que se entendió, corrige cualquier columna, mira una **vista previa con los
asientos del mes** y le pone el nombre que quiera. El formato se guarda (y en modo estudio se
comparte con el estudio, como las plantillas) **sin ningún dato del ejemplo**: solo la forma, los
títulos y los valores fijos.

### Formatos ya armados

Además, dos formatos tomados de la **documentación oficial** del sistema:

| Sistema | Archivo | Dónde se importa | Fuente |
|---|---|---|---|
| Xubio | Excel: `FECHA, CONCEPTO, CIRCUITOCONTABLE, CUENTA, DEBE, HABER, ORGANIZACION, CENTRODECOSTO, DESCRIPCION`. Primera fila de cada asiento: fecha, concepto y circuito (`default`); siguientes: una cuenta (por **nombre**) con su debe o haber. | Contabilidad → Asientos Manuales → Acciones → Importar | [Ayuda de Xubio](https://ayuda.xubio.com/es-ar/como-importo-asientos-contables-manuales/) y su planilla modelo |
| Holistor | TXT, "archivo único de movimientos" con Debe y Haber separados: fecha (DD/MM/AAAA), número de asiento (orden dentro de la fecha), cuenta (**código**), debe, haber (coma decimal), concepto y leyenda; separados por tabulación, en Latin‑1. La primera vez se define ese diseño de registro en Holistor. | Útiles → Exportar/Importar → Importar | [Holistor: Importación de datos de Otros Sistemas – Requisitos](https://cms.holistor.com.ar/wp-content/uploads/2019/02/Importaci%C3%B3n-de-datos-de-Otros-Sistemas-%E2%80%93-Requisitos.pdf) |
| Cualquier otro | CSV: asiento, fecha, cuenta, debe, haber, concepto, origen. | — | — |

En el plan de cuentas (modo Deportivo) cada cuenta se puede escribir como **"código nombre"**
(`1.1.2.01 Banco Río`): Holistor toma el código y Xubio el nombre.

Para cualquier otro sistema (Tango, Colppy, Bejerman, Contabilium…) se usa el formato aprendido de
un ejemplo. Limitaciones: archivos con dos partes separadas (cabeceras y movimientos en archivos
distintos) y XML todavía no se aprenden.

## Pendiente

- IA también en el Extractor (hoy se ofrece en Conciliar) y para clasificar leyendas nuevas.
- Traducciones de la pantalla de conciliación (hoy solo en español).
- Editor de reglas de clasificación propias en la interfaz (el motor ya las acepta).
- Liquidaciones de tarjetas (N:1 con aranceles).
- Aprender formatos de asientos en XML o en dos archivos (cabeceras + movimientos).
- IA opcional para casos ambiguos, sobre filas ya anonimizadas, solo como sugerencia.
