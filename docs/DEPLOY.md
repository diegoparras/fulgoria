# Deploying Extracta

> **English** · [Español](i18n/DEPLOY.es.md) · [Français](i18n/DEPLOY.fr.md) · [Português](i18n/DEPLOY.pt.md) · [Italiano](i18n/DEPLOY.it.md) · [中文](i18n/DEPLOY.zh.md) · [日本語](i18n/DEPLOY.ja.md)

Extracta ships a **thin server** (`server.js`, Node/Express) that does only two things: serve the
static app and handle an optional login from the `.env`. **The document is processed 100% in the
browser and never reaches the server** — there is no database, no queue, no worker. The server is
just the door.

Four ways to run it, from easiest to most controlled:

1. [Quick local run](#0-secrets-first) (Node) — no Docker.
2. [Docker / Compose](#2-docker--compose) — any host.
3. [EasyPanel](#3-easypanel) — one‑click‑ish on your own server.
4. Then: [environment reference](#environment-reference) and the [production checklist](#going-to-production).

---

## 0. Secrets first

If you want a login (recommended for anything public), you need two values in your `.env`:

```bash
cp .env.example .env

# 1) bcrypt hash of your password → goes in AUTH_PASSWORD (never the plain password):
node server.js --hash 'your-password'

# 2) a random secret to sign the session cookie → goes in SESSION_SECRET:
openssl rand -hex 32
```

Then edit `.env`:

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=$2a$12$....................          # the hash from step 1
SESSION_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d... # the secret from step 2
COOKIE_SECURE=true        # true behind HTTPS; false only for local http://
```

> Don't want a login (private network / local only)? Set `AUTH_ENABLED=false` and skip the secrets.

---

## 1. Quick local run (Node)

```bash
npm install
npm start            # → http://localhost:3000
```

That's it. Node ≥ 18. To change the port, set `PORT` in the `.env`.

---

## 2. Docker / Compose

With Docker Desktop (Windows/Mac) or any Docker host:

```bash
cp .env.example .env          # fill AUTH_PASSWORD (hash) + SESSION_SECRET (or AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Single image, by hand:

```bash
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

Or pull the prebuilt image (no build) — published to GHCR by CI on every push to `main`:

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # follow logs
docker rm -f extracta       # stop & remove
```

> On Docker Desktop you serve plain `http://localhost`, so set `COOKIE_SECURE=false` (otherwise
> the login cookie isn't sent and you can't stay logged in).

---

## 3. EasyPanel

EasyPanel can **pull the prebuilt image** or **build from the repo**. Pulling is simplest.

### Option A — pull the image (recommended)

1. In EasyPanel: **Create → App → Docker Image**.
2. Image: `ghcr.io/diegoparras/extracta:latest`
   *(published automatically by GitHub Actions; for a private package, add a GHCR registry
   credential in EasyPanel first, or make the package public).*
3. **Port:** container `3000` → map to your domain. EasyPanel terminates HTTPS for you.
4. **Environment** (see the [reference](#environment-reference)):
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=$2a$12$....
   SESSION_SECRET=<random hex>
   COOKIE_SECURE=true
   ```
5. Deploy. There's nothing else — no Redis, no worker, no volumes. It's stateless.

### Option B — build from source

1. **Create → App → GitHub repo**, point it at `diegoparras/extracta`.
2. Build type: **Dockerfile** (the repo has one). Same port / env as above.

> EasyPanel sits behind HTTPS, so keep `COOKIE_SECURE=true`.

---

## Environment reference

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `AUTH_ENABLED` | `true` | `false` serves the app with **no login** (local / private network). |
| `AUTH_USER` | — | Username for the login. Required when `AUTH_ENABLED=true`. |
| `AUTH_PASSWORD` | — | The login password, **plain text** (like Escriba/Fisherboy). Optionally a bcrypt hash (`node server.js --hash '…'`) if you'd rather not store it in clear. |
| `SESSION_SECRET` | — | Secret that signs the session cookie. Use the same value on every replica. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | `12` | How long a login stays valid. |
| `COOKIE_SECURE` | `true` | Send the session cookie only over HTTPS. Set `false` for local `http://`. |
| `ESCRIBA_URL` | — | Destination of the **"Send to Escriba"** button. Empty → `/`. Set your Escriba's URL (or an internal path if same‑domain). |

Full list with comments: [`.env.example`](../.env.example).

---

## Going to production

Before exposing Extracta to anyone but you:

- [ ] Set `AUTH_USER`, `AUTH_PASSWORD` (a **bcrypt hash**, never plain text) and `SESSION_SECRET`.
- [ ] **Do not** leave `AUTH_ENABLED=false` on anything reachable by others.
- [ ] `COOKIE_SECURE=true` behind HTTPS (EasyPanel / your reverse proxy terminates TLS).
- [ ] Keep the `.env` out of git and out of the image (it already is — `.gitignore` + `.dockerignore`).
- [ ] Keep secrets in a secret manager / the EasyPanel panel, not in a committed file.
- [ ] Remember: the document is processed in the browser, so there's no document data to protect on
      the server — but the login still gates *who* can use the app.
