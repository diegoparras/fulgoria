# Desplegar Fulgoria

> [English](../DEPLOY.md) · **Español** · [Français](DEPLOY.fr.md) · [Português](DEPLOY.pt.md) · [Italiano](DEPLOY.it.md) · [中文](DEPLOY.zh.md) · [日本語](DEPLOY.ja.md)

Fulgoria trae un **server fino** (`server.js`, Node/Express) que hace solo dos cosas: servir la app
estática y manejar un login opcional desde el `.env`. **El documento se procesa 100% en el navegador
y nunca llega al server** — no hay base de datos, ni cola, ni worker. El server es solo la puerta.

Cuatro formas de correrlo, de la más fácil a la más controlada: **(1)** local con Node, **(2)** Docker
/ Compose, **(3)** EasyPanel, y al final la **referencia de variables** y el **checklist de producción**.

---

## 0. Primero, los secretos

Para tener login (recomendado para cualquier cosa pública), poné esto en tu `.env`:

```bash
cp .env.example .env
```

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=tu-contraseña      # texto plano, como Escriba/Fisherboy
SESSION_SECRET=<pegá el de abajo>
COOKIE_SECURE=true               # true detrás de HTTPS; false solo para http:// local
```

El único valor que tenés que generar es `SESSION_SECRET` (firma la cookie de sesión):

```bash
openssl rand -hex 32
# Sin openssl en Windows? -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **¿Preferís no dejar la clave en claro?** Usá un hash bcrypt: corré `node server.js --hash 'tu-contraseña'` y pegá el `$2a$...` en `AUTH_PASSWORD` (el server lo detecta solo).
>
> **¿No querés login** (red privada / solo local)? Poné `AUTH_ENABLED=false` y salteá los secretos.

---

## 1. Local con Node

```bash
npm install
npm start            # → http://localhost:3000
```

Eso es todo. Node ≥ 18. Para cambiar el puerto, seteá `PORT` en el `.env`.

---

## 2. Docker / Compose

Con Docker Desktop (Windows/Mac) o cualquier host Docker:

```bash
cp .env.example .env          # completá AUTH_PASSWORD + SESSION_SECRET (o AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Imagen sola, a mano:

```bash
docker build -t fulgoria .
docker run -d --name fulgoria --env-file .env -p 3000:3000 fulgoria
```

O tirá la imagen ya construida (sin compilar) — el CI la publica en GHCR en cada push a `main`:

```bash
docker run -d --name fulgoria --env-file .env -p 3000:3000 ghcr.io/diegoparras/fulgoria:latest
```

```bash
docker logs -f fulgoria     # ver logs
docker rm -f fulgoria       # parar y borrar
```

> En Docker Desktop servís `http://localhost` plano, así que poné `COOKIE_SECURE=false` (si no, la
> cookie de login no se envía y no podés quedar logueado).

---

## 3. EasyPanel

EasyPanel puede **tirar la imagen ya construida** o **compilar desde el repo**. Tirar la imagen es lo más simple.

### Opción A — tirar la imagen (recomendado)

1. En EasyPanel: **Create → App → Docker Image**.
2. Imagen: `ghcr.io/diegoparras/fulgoria:latest`
   *(la publica GitHub Actions sola; si el package es privado, primero agregá una credencial de
   registry GHCR en EasyPanel, o hacé público el package).*
3. **Puerto:** contenedor `3000` → mapealo a tu dominio. EasyPanel termina el HTTPS por vos.
4. **Variables** (ver la [referencia](#referencia-de-variables)):
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=<your-password>
   SESSION_SECRET=<hex aleatorio>
   COOKIE_SECURE=true
   ```
5. Deploy. No hay nada más — sin Redis, sin worker. Sin modo estudio es stateless; con
   `PERSISTENCIA=on`, montá un volumen en `/data` (ver [Modo estudio](#4-modo-estudio-guardar-el-trabajo)).

### Opción B — compilar desde el código

1. **Create → App → GitHub repo**, apuntando a `diegoparras/fulgoria`.
2. Tipo de build: **Dockerfile** (el repo trae uno). Mismo puerto / variables que arriba.

> EasyPanel está detrás de HTTPS, así que dejá `COOKIE_SECURE=true`.

---

## 4. Modo estudio (guardar el trabajo)

Por defecto Fulgoria no guarda nada en el servidor. Con `PERSISTENCIA=on`, la pantalla **Conciliar**
trabaja por cliente → cuenta bancaria → mes y guarda los documentos (extractos y mayores), las
decisiones, los papeles de trabajo, lo que pasa al mes siguiente y el estado del mes (borrador →
preparado → revisado → cerrado), además de las plantillas del estudio y un registro de auditoría. El
procesamiento sigue en el navegador; el servidor guarda.

- **Metadatos** (clientes, cuentas, meses, auditoría): SQLite en `DATA_DIR/fulgoria.sqlite`.
- **Documentos**: en disco (`ALMACENAMIENTO=disco`, dentro de `DATA_DIR`) o en un bucket compatible
  con S3 (`ALMACENAMIENTO=s3`: Cloudflare R2, AWS S3, MinIO).
- **Cifrado**: con `DOCS_CLAVE` (32 bytes, `openssl rand -hex 32`) cada documento se cifra con
  AES‑256‑GCM *antes* de salir del proceso: ni el disco ni el proveedor del bucket ven el contenido.
  **Guardá bien la clave: sin ella los documentos guardados no se pueden leer.**
- **Copias**: cada `BACKUP_HORAS` la base se copia (`VACUUM INTO`) a `backups/` en el mismo
  almacenamiento (cifrada si hay clave). A demanda: `node server.js --backup`. Con bucket, agregá una
  regla de ciclo de vida que borre las copias viejas de `backups/`.

**EasyPanel**: *Mounts → Volume →* ruta `/data` (la imagen ya usa `DATA_DIR=/data`). Sin el volumen,
todo lo guardado se pierde en el próximo deploy — incluso con R2/S3, porque la base vive en `/data`.

**Cloudflare R2**: creá un bucket y un *R2 API token* con *Object Read & Write* sobre ese bucket, y:

```ini
PERSISTENCIA=on
ALMACENAMIENTO=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<access key del token>
S3_SECRET_ACCESS_KEY=<secret del token>
DOCS_CLAVE=<openssl rand -hex 32>
```

**AWS S3**: igual, con `S3_ENDPOINT=https://s3.<región>.amazonaws.com` y `S3_REGION=<región>`; un usuario
IAM limitado a `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre `arn:aws:s3:::<bucket>/*`.

**Roles.** En el modo estudio cada persona tiene un rol: `lector` (solo mira), `preparador` (carga
documentos, concilia y marca *preparado*), `revisor` (además revisa, cierra y reabre meses) y `admin`
(además administra usuarios). *Standalone*: el usuario del `.env` es admin y da de alta al resto desde
**Conciliar → Usuarios** (se guardan en la base del estudio con bcrypt; los cambios de rol y las bajas
rigen en el momento). *Federado con Lockatus*: el rol viene en el token del hub; los nombres se
traducen con `LOCKATUS_ROLES=contador=preparador,socio=revisor`; un rol desconocido entra como
`lector`. Con `REVISION_INDEPENDIENTE=on`, quien preparó un mes no puede revisarlo.

## 5. IA para bancos nuevos (opcional)

Cuando un extracto no se lee con una plantilla ni con la auto‑detección, la IA propone las columnas.
**Al modelo no le llega el extracto**: solo un esqueleto anónimo (posición y tipo de cada celda,
importes y fechas reducidos a su formato; ni nombres, ni montos, ni cuentas), que el servidor vuelve a
sanear. La regla del saldo decide: una propuesta se usa solo si los saldos cierran, y entonces queda
como plantilla del banco (la IA se usa una vez por banco, no por extracto).

**Desde la pantalla (recomendado).** En modo estudio, un admin abre **Conciliar → IA** y elige
**Sin IA**, **IA local** (Ollama, LM Studio, vLLM: nada sale del estudio) o **IA externa** (Claude,
OpenAI, Gemini u OpenRouter). Se guardan las dos configuraciones, así que cambiar no pierde la otra, y
lo que esté en el `.env` aparece precargado. Después el modelo (**Ver modelos** lista los
que habilita la clave), la clave de API, una URL opcional y una temperatura opcional; después
**Probar** y **Guardar**. La clave se guarda cifrada con `DOCS_CLAVE` y nunca vuelve al navegador
(solo sus últimos 4 caracteres). Lo elegido manda sobre el `.env` (**Sin IA** la apaga aunque el `.env`
tenga una); **Volver al .env** lo borra.

**Temperatura:** dejala vacía (recomendado). Hay modelos que no la aceptan (los de razonamiento de
OpenAI, como GPT‑6 Luna, y los Claude actuales): si el proveedor la rechaza, Fulgoria reintenta sin
ella y lo recuerda para ese modelo. Por lo mismo, a las APIs compatibles con OpenAI nunca se les manda
`max_tokens`.

**O desde el `.env`:**

```ini
IA_PROVEEDOR=anthropic            # anthropic | openai | gemini | openrouter | local
IA_MODELO=claude-opus-5-5         # por defecto con anthropic; obligatorio con los demás
IA_API_KEY=<clave>                # anthropic puede usar ANTHROPIC_API_KEY; local no necesita
IA_URL=                           # local: p. ej. http://ollama:11434/v1 (Ollama), LM Studio, vLLM
IA_TEMPERATURA=                   # opcional, 0 a 2; vacía = no se manda
IA_MAX_POR_HORA=30                # consultas por persona y por hora
```

Con Claude, el pedido usa salida estructurada (JSON Schema) y fallback del servidor si el modelo
declina. GPT, Gemini, OpenRouter y los modelos locales van por la API de chat compatible con OpenAI (salida
estructurada si el modelo la admite; si no, JSON simple).

---

## Referencia de variables

| Variable | Default | Qué hace |
|---|---|---|
| `PORT` | `3000` | Puerto en el que escucha el server. |
| `AUTH_ENABLED` | `true` | `false` sirve la app **sin login** (local / red privada). |
| `AUTH_USER` | — | Usuario del login. Requerido con `AUTH_ENABLED=true`. |
| `AUTH_PASSWORD` | — | La contraseña del login, en **texto plano** (como Escriba/Fisherboy). Opcional: un hash bcrypt (`node server.js --hash '…'`) si preferís no dejarla en claro. |
| `SESSION_SECRET` | — | Secreto que firma la cookie de sesión. Mismo valor en cada réplica. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | `12` | Cuánto dura una sesión iniciada. |
| `COOKIE_SECURE` | `true` | Envía la cookie solo por HTTPS. Poné `false` para `http://` local. |
| `ESCRIBA_URL` | — | Destino del botón **"Enviar a Escriba"**. Vacío → `/`. Poné la URL de tu Escriba (o un path interno si están en el mismo dominio). |
| `PERSISTENCIA` | `off` | `on` activa el modo estudio (guarda clientes, cuentas, meses y documentos). |
| `DATA_DIR` | `./data` (`/data` en la imagen) | Base y, con `disco`, documentos. Montá un volumen acá. |
| `ALMACENAMIENTO` | `disco` | `disco` o `s3` (R2 / S3 / MinIO) para los documentos. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIJO` | — | Datos del bucket con `ALMACENAMIENTO=s3`. |
| `DOCS_CLAVE` | — | Clave de 32 bytes (hex/base64) para cifrar los documentos con AES‑256‑GCM. Recomendada. |
| `BACKUP_HORAS` | `24` | Cada cuántas horas se copia la base. `0` lo desactiva. |
| `DOC_MAX_MB` | `25` | Tamaño máximo de un documento subido. |
| `REVISION_INDEPENDIENTE` | `off` | `on`: quien preparó un mes no puede revisarlo. |
| `LOCKATUS_ROLES` | — | Federado: traduce los roles de Lockatus a `lector`/`preparador`/`revisor`/`admin`. |
| `IA_PROVEEDOR`, `IA_MODELO`, `IA_API_KEY`, `IA_URL`, `IA_TEMPERATURA`, `IA_MAX_POR_HORA` | — | IA para bancos nuevos (sección 5). Un admin también la configura desde la pantalla. |

Lista completa con comentarios: [`.env.example`](../../.env.example).

---

## Pasar a producción

Antes de exponer Fulgoria a alguien que no seas vos:

- [ ] Seteá `AUTH_USER`, `AUTH_PASSWORD` (tu contraseña, o un hash bcrypt) y `SESSION_SECRET`.
- [ ] **No** dejes `AUTH_ENABLED=false` en algo accesible por otros.
- [ ] `COOKIE_SECURE=true` detrás de HTTPS (EasyPanel / tu reverse proxy termina el TLS).
- [ ] Mantené el `.env` fuera de git y de la imagen (ya lo está — `.gitignore` + `.dockerignore`).
- [ ] Guardá los secretos en un gestor de secretos / el panel de EasyPanel, no en un archivo commiteado.
- [ ] Sin modo estudio, el documento se procesa en el navegador y no se guarda, así que no hay datos
      del documento que proteger en el server — pero el login igual controla *quién* puede usar la app.
- [ ] Con `PERSISTENCIA=on`: volumen en `/data`, `DOCS_CLAVE` configurada y guardada en un lugar seguro
      (gestor de contraseñas), copias verificadas y un token del bucket limitado a ese bucket.
