# Extracta

**Extraé datos de cualquier documento — local, exacto, tuyo.**

Marcá las columnas de un documento (extracto bancario, factura, recibo…) una sola vez, y de ahí
en más Extracta lee solo todos los documentos de ese tipo y te los da en datos limpios (CSV).
Empieza por extractos bancarios —donde la regla del saldo da una **certeza** que nadie más tiene—
y se generaliza a cualquier documento tabular.

Todo se procesa **en tu navegador**: el documento nunca sale de tu máquina. Lo que se comparte con
la comunidad es **la forma del documento** (geometría), **nunca los datos**.

Usa el estándar abierto **Extracta Template** (`.ext.json`).

## Principios

- **Todo corre en el navegador.** El PDF se abre, se lee y se procesa dentro de tu máquina.
  Nada se sube a ningún servidor, y no hay **ninguna** llamada externa (fuentes y librerías
  vendorizadas). La privacidad no es una promesa: es la arquitectura.
- **El sistema propone, vos disponés.** Si una columna quedó mal detectada, la corregís
  arrastrando barras sobre el documento y la tabla se rearma sola. Y antes de exportar podés
  abrir un **editor tipo planilla** (Excel-style) para retocar cualquier celda —con el saldo
  recalculando en vivo.
- **La cuenta no miente.** Una extracción se certifica sola con la regla del saldo:
  `saldo inicial + créditos − débitos == saldo final`. Sin votos, local.

## Qué hace

- Lee **PDFs digitales** y **escaneados/imágenes** (OCR local con Tesseract.js, también en el navegador).
- **Multipágina** y **multi-cuenta** (pesos + dólares en un mismo PDF → una tarjeta por cuenta).
- Detección automática de columnas (best-effort) + **marcado manual** por arrastre cuando hace falta.
- **Roles** por columna (fecha, descripción, débito/crédito/importe con signo, saldo, texto).
- **Formato libre** por columna (patrón de fecha y de número, estilo Excel) — WYSIWYG: lo que ves
  es lo que sale en el CSV.
- **Reglas de exclusión** por contenido (saltear headers repetidos, "TOTALES", etc.).
- **Campos propios** (Categoría, Conciliado…) que completás vos.
- **Plantillas reutilizables**: marcás un banco una vez, y la próxima lo reconoce solo
  (matching por anclas, sin datos). La plantilla guarda **dónde** está cada dato, nunca **qué** dice.
- Export a **CSV**, plantilla **`.ext.json` / `.ext.yaml`**, y handoff **"Enviar a Escriba"**
  (ecosistema) para anonimizar / convertir / chunk / audio.

## Estructura

```
src/                  lógica: PDF, OCR, extracción, plantilla, editor, UI
vendor/pdfjs/         PDF.js vendorizado (render + texto con coordenadas)
vendor/tesseract/     Tesseract.js vendorizado (OCR local)
vendor/fonts/         Inter Variable vendorizada (sin CDN)
styles/               sistema de diseño (claro/oscuro, ecosistema Escriba)
samples/              PDFs de prueba (sintéticos, datos ficticios)
tools/                generador del PDF de prueba + harness de tests
```

## Probar

Se abre con un servidor estático (hace falta por el worker de PDF.js):

```
python -m http.server 5599
```

y abrí `http://localhost:5599`, luego cargá `samples/banco-rio-cc.pdf` (o tocá "Ver un ejemplo").

## Producción (self-hosted)

Para deployar, Extracta trae un **server fino** (`server.js`, Node/Express) que solo sirve la app
estática y un **login opcional** desde el `.env`. El documento se sigue procesando 100% en el
navegador; el server nunca lo recibe, aplica CSP estricta + headers de seguridad, y jamás expone
`.env`, `server.js` ni los PDFs de `samples/private/`.

1. `cp .env.example .env` y completá:
   - `AUTH_USER`, `AUTH_PASSWORD` (hash bcrypt: `node server.js --hash 'tu-clave'`),
     `SESSION_SECRET` (`openssl rand -hex 32`), `COOKIE_SECURE=true` (detrás de HTTPS).
   - O `AUTH_ENABLED=false` para servir sin login (red privada / local).
2. **Local:** `npm install && npm start` → http://localhost:3000
3. **Docker:** `docker compose up --build`, o usá la imagen publicada en **GHCR**
   (`ghcr.io/<owner>/extracta:latest`, que el CI construye en cada push a `main` y en cada tag),
   y desplegala en **EasyPanel** poniendo las variables del `.env` en el panel.

## Licencia

Copyright 2026 Diego Parras. Licencia **Apache-2.0** — ver [LICENSE](LICENSE).
