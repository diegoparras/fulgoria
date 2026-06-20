# Desplegar Extracta

> [English](../DEPLOY.md) · **Español** · [Français](DEPLOY.fr.md) · [Português](DEPLOY.pt.md) · [Italiano](DEPLOY.it.md) · [中文](DEPLOY.zh.md) · [日本語](DEPLOY.ja.md)

Extracta trae un **server fino** (`server.js`, Node/Express) que hace solo dos cosas: servir la app
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
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

O tirá la imagen ya construida (sin compilar) — el CI la publica en GHCR en cada push a `main`:

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # ver logs
docker rm -f extracta       # parar y borrar
```

> En Docker Desktop servís `http://localhost` plano, así que poné `COOKIE_SECURE=false` (si no, la
> cookie de login no se envía y no podés quedar logueado).

---

## 3. EasyPanel

EasyPanel puede **tirar la imagen ya construida** o **compilar desde el repo**. Tirar la imagen es lo más simple.

### Opción A — tirar la imagen (recomendado)

1. En EasyPanel: **Create → App → Docker Image**.
2. Imagen: `ghcr.io/diegoparras/extracta:latest`
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
5. Deploy. No hay nada más — sin Redis, sin worker, sin volúmenes. Es stateless.

### Opción B — compilar desde el código

1. **Create → App → GitHub repo**, apuntando a `diegoparras/extracta`.
2. Tipo de build: **Dockerfile** (el repo trae uno). Mismo puerto / variables que arriba.

> EasyPanel está detrás de HTTPS, así que dejá `COOKIE_SECURE=true`.

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

Lista completa con comentarios: [`.env.example`](../../.env.example).

---

## Pasar a producción

Antes de exponer Extracta a alguien que no seas vos:

- [ ] Seteá `AUTH_USER`, `AUTH_PASSWORD` (tu contraseña, o un hash bcrypt) y `SESSION_SECRET`.
- [ ] **No** dejes `AUTH_ENABLED=false` en algo accesible por otros.
- [ ] `COOKIE_SECURE=true` detrás de HTTPS (EasyPanel / tu reverse proxy termina el TLS).
- [ ] Mantené el `.env` fuera de git y de la imagen (ya lo está — `.gitignore` + `.dockerignore`).
- [ ] Guardá los secretos en un gestor de secretos / el panel de EasyPanel, no en un archivo commiteado.
- [ ] Recordá: el documento se procesa en el navegador, así que no hay datos del documento que proteger
      en el server — pero el login igual controla *quién* puede usar la app.
