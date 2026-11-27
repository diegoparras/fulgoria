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
5. Deploy. There's nothing else — no Redis, no worker. Without studio mode it's stateless; with
   `PERSISTENCIA=on`, mount a volume on `/data` (see [Studio mode](#4-studio-mode-saving-the-work)).

### Option B — build from source

1. **Create → App → GitHub repo**, point it at `diegoparras/fulgoria`.
2. Build type: **Dockerfile** (the repo has one). Same port / env as above.

> EasyPanel sits behind HTTPS, so keep `COOKIE_SECURE=true`.

---

## 4. Studio mode (saving the work)

By default Fulgoria saves nothing on the server. With `PERSISTENCIA=on`, the **Reconcile** screen
works per client → bank account → month and saves documents (statements, ledgers), decisions,
work papers, items carried to the next month and the month's status (draft → prepared → reviewed
→ closed), plus studio‑wide templates and an audit log. Processing still happens in the browser;
the server stores.

- **Metadata** (clients, accounts, months, audit): SQLite at `DATA_DIR/fulgoria.sqlite`.
- **Documents**: on disk (`ALMACENAMIENTO=disco`, under `DATA_DIR`) or in an S3‑compatible bucket
  (`ALMACENAMIENTO=s3`: Cloudflare R2, AWS S3, MinIO).
- **Encryption**: with `DOCS_CLAVE` (32 bytes, `openssl rand -hex 32`) every document is encrypted
  with AES‑256‑GCM *before* leaving the process — neither the disk nor the bucket provider sees the
  content. **Keep the key safe: without it the stored documents cannot be read.**
- **Backups**: every `BACKUP_HORAS` the database is copied (`VACUUM INTO`) to `backups/` in the same
  storage (encrypted too if there's a key). On demand: `node server.js --backup`. With a bucket, add a
  lifecycle rule to expire old `backups/` objects.

**EasyPanel**: *Mounts → Volume →* mount path `/data` (the image sets `DATA_DIR=/data`). Without the
volume, everything saved is lost on the next deploy — even with R2/S3, because the database lives in
`/data`.

**Cloudflare R2**: create a bucket and an *R2 API token* with *Object Read & Write* on that bucket, then:

```ini
PERSISTENCIA=on
ALMACENAMIENTO=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<token access key>
S3_SECRET_ACCESS_KEY=<token secret>
DOCS_CLAVE=<openssl rand -hex 32>
```

**AWS S3**: same, with `S3_ENDPOINT=https://s3.<region>.amazonaws.com` and `S3_REGION=<region>`; an IAM
user limited to `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`.

**Roles.** In studio mode each person has a role: `lector` (read‑only), `preparador` (loads
documents, reconciles, marks *prepared*), `revisor` (also reviews, closes and reopens months) and
`admin` (also manages users). *Standalone*: the `.env` user is admin and adds the others from
**Reconcile → Users** (stored in the studio database, bcrypt‑hashed; role changes and deactivations
apply immediately). *Federated with Lockatus*: the role comes from the hub's token; map names with
`LOCKATUS_ROLES=contador=preparador,socio=revisor`; unknown roles get `lector`. With
`REVISION_INDEPENDIENTE=on`, whoever prepared a month cannot review it.

## 5. AI for new banks (optional)

When a bank statement can't be read with a template or auto‑detection, the AI proposes the column
layout. **The model never receives the statement**: only an anonymous skeleton (each cell's position
and type, amounts and dates reduced to their format — no names, amounts or account numbers), sanitized
again on the server. The balance rule decides: a proposal is used only if the balances close, and it
is then saved as the bank's template (the AI is used once per bank, not once per statement).

```ini
IA_PROVEEDOR=anthropic            # anthropic | openai | openrouter | local
IA_MODELO=claude-opus-5-5         # default for anthropic; required for the others
IA_API_KEY=<key>                  # anthropic may use ANTHROPIC_API_KEY; local needs none
IA_URL=                           # local: e.g. http://ollama:11434/v1 (Ollama), LM Studio, vLLM
IA_MAX_POR_HORA=30                # queries per person per hour
```

With Claude, the request uses structured outputs (JSON Schema) and server‑side fallback if the model
declines. GPT / OpenRouter / local models go through the OpenAI‑compatible chat API (structured
output when supported, plain JSON otherwise).

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
| `PERSISTENCIA` | `off` | `on` enables studio mode (saves clients, accounts, months and documents). |
| `DATA_DIR` | `./data` (`/data` in the image) | Database and, with `disco`, documents. Mount a volume here. |
| `ALMACENAMIENTO` | `disco` | `disco` or `s3` (R2 / S3 / MinIO) for documents. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIJO` | — | Bucket settings for `ALMACENAMIENTO=s3`. |
| `DOCS_CLAVE` | — | 32‑byte key (hex/base64) to encrypt documents with AES‑256‑GCM. Recommended. |
| `BACKUP_HORAS` | `24` | Database backup interval (hours). `0` disables. |
| `DOC_MAX_MB` | `25` | Maximum size of an uploaded document. |
| `REVISION_INDEPENDIENTE` | `off` | `on`: whoever prepared a month cannot review it. |
| `LOCKATUS_ROLES` | — | Federated: map Lockatus role names to `lector`/`preparador`/`revisor`/`admin`. |
| `IA_PROVEEDOR`, `IA_MODELO`, `IA_API_KEY`, `IA_URL`, `IA_MAX_POR_HORA` | — | AI for new banks (see section 5). |

Full list with comments: [`.env.example`](../.env.example).

---

## Going to production

Before exposing Fulgoria to anyone but you:

- [ ] Set `AUTH_USER`, `AUTH_PASSWORD` (your password, or a bcrypt hash) and `SESSION_SECRET`.
- [ ] **Do not** leave `AUTH_ENABLED=false` on anything reachable by others.
- [ ] `COOKIE_SECURE=true` behind HTTPS (EasyPanel / your reverse proxy terminates TLS).
- [ ] Keep the `.env` out of git and out of the image (it already is — `.gitignore` + `.dockerignore`).
- [ ] Keep secrets in a secret manager / the EasyPanel panel, not in a committed file.
- [ ] Without studio mode the document is processed in the browser and never stored, so there's no
      document data to protect on the server — but the login still gates *who* can use the app.
- [ ] With `PERSISTENCIA=on`: a volume on `/data`, `DOCS_CLAVE` set and stored somewhere safe
      (password manager), backups checked, and a bucket token limited to that bucket.
