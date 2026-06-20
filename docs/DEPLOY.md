# Deploying Fulgoria

> **English** · [Español](i18n/DEPLOY.es.md) · [Français](i18n/DEPLOY.fr.md) · [Português](i18n/DEPLOY.pt.md) · [Italiano](i18n/DEPLOY.it.md) · [中文](i18n/DEPLOY.zh.md) · [日本語](i18n/DEPLOY.ja.md)

Fulgoria ships a **thin server** (`server.js`, Node/Express) that does only two things: serve the
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

If you want a login (recommended for anything public), set these in your `.env`:

```bash
cp .env.example .env
```

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=your-password     # plain text, like Escriba/Fisherboy
SESSION_SECRET=<paste from below>
COOKIE_SECURE=true              # true behind HTTPS; false only for local http://
```

`SESSION_SECRET` is the one value you must generate — it signs the session cookie:

```bash
openssl rand -hex 32
# No openssl on Windows? -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Prefer not to store the password in clear?** Use a bcrypt hash instead: run `node server.js --hash 'your-password'` and paste the `$2a$...` into `AUTH_PASSWORD` (the server auto-detects it).
>
> **Don't want a login** (private network / local only)? Set `AUTH_ENABLED=false` and skip the secrets.

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
cp .env.example .env          # fill AUTH_PASSWORD + SESSION_SECRET (or AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Single image, by hand:

```bash
docker build -t fulgoria .
docker run -d --name fulgoria --env-file .env -p 3000:3000 fulgoria
```

Or pull the prebuilt image (no build) — published to GHCR by CI on every push to `main`:

```bash
docker run -d --name fulgoria --env-file .env -p 3000:3000 ghcr.io/diegoparras/fulgoria:latest
```

```bash
docker logs -f fulgoria     # follow logs
docker rm -f fulgoria       # stop & remove
```

> On Docker Desktop you serve plain `http://localhost`, so set `COOKIE_SECURE=false` (otherwise
> the login cookie isn't sent and you can't stay logged in).

---

## 3. EasyPanel

EasyPanel can **pull the prebuilt image** or **build from the repo**. Pulling is simplest.

### Option A — pull the image (recommended)

1. In EasyPanel: **Create → App → Docker Image**.
2. Image: `ghcr.io/diegoparras/fulgoria:latest`
   *(published automatically by GitHub Actions; for a private package, add a GHCR registry
   credential in EasyPanel first, or make the package public).*
3. **Port:** container `3000` → map to your domain. EasyPanel terminates HTTPS for you.
4. **Environment** (see the [reference](#environment-reference)):
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=<your-password>
   SESSION_SECRET=<random hex>
   COOKIE_SECURE=true
   ```
5. Deploy. There's nothing else — no Redis, no worker, no volumes. It's stateless.

### Option B — build from source

1. **Create → App → GitHub repo**, point it at `diegoparras/fulgoria`.
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

Before exposing Fulgoria to anyone but you:

- [ ] Set `AUTH_USER`, `AUTH_PASSWORD` (your password, or a bcrypt hash) and `SESSION_SECRET`.
- [ ] **Do not** leave `AUTH_ENABLED=false` on anything reachable by others.
- [ ] `COOKIE_SECURE=true` behind HTTPS (EasyPanel / your reverse proxy terminates TLS).
- [ ] Keep the `.env` out of git and out of the image (it already is — `.gitignore` + `.dockerignore`).
- [ ] Keep secrets in a secret manager / the EasyPanel panel, not in a committed file.
- [ ] Remember: the document is processed in the browser, so there's no document data to protect on
      the server — but the login still gates *who* can use the app.
