# Distribuire Extracta

> [English](../DEPLOY.md) · [Español](DEPLOY.es.md) · [Français](DEPLOY.fr.md) · [Português](DEPLOY.pt.md) · **Italiano** · [中文](DEPLOY.zh.md) · [日本語](DEPLOY.ja.md)

Extracta include un **server leggero** (`server.js`, Node/Express) che fa solo due cose: servire
l'app statica e gestire un login opzionale dal `.env`. **Il documento viene elaborato al 100% nel
browser e non raggiunge mai il server** — niente database, niente coda, niente worker. Il server è
solo la porta.

Quattro modi per eseguirlo, dal più facile al più controllato: **(1)** locale con Node, **(2)** Docker
/ Compose, **(3)** EasyPanel, e infine la **referenza delle variabili** e la **checklist di produzione**.

---

## 0. Prima i segreti

Per un login (consigliato per qualsiasi cosa pubblica) servono due valori nel `.env`:

```bash
cp .env.example .env

# 1) hash bcrypt della tua password → va in AUTH_PASSWORD (mai la password in chiaro):
node server.js --hash 'la-tua-password'

# 2) un segreto casuale per firmare il cookie di sessione → va in SESSION_SECRET:
openssl rand -hex 32
```

Poi modifica il `.env`:

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=$2a$12$....................          # l'hash del passo 1
SESSION_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d... # il segreto del passo 2
COOKIE_SECURE=true        # true dietro HTTPS; false solo per http:// locale
```

> Niente login (rete privata / solo locale)? Imposta `AUTH_ENABLED=false` e salta i segreti.

---

## 1. Locale con Node

```bash
npm install
npm start            # → http://localhost:3000
```

Tutto qui. Node ≥ 18. Per cambiare la porta, imposta `PORT` nel `.env`.

---

## 2. Docker / Compose

Con Docker Desktop (Windows/Mac) o qualsiasi host Docker:

```bash
cp .env.example .env          # compila AUTH_PASSWORD (hash) + SESSION_SECRET (o AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Immagine singola, a mano:

```bash
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

Oppure scarica l'immagine già pronta (senza build) — pubblicata su GHCR dalla CI a ogni push su `main`:

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # seguire i log
docker rm -f extracta       # fermare e rimuovere
```

> Su Docker Desktop servi `http://localhost` semplice, quindi imposta `COOKIE_SECURE=false`
> (altrimenti il cookie di login non viene inviato e non resti autenticato).

---

## 3. EasyPanel

EasyPanel può **scaricare l'immagine già pronta** o **compilare dal repo**. Scaricare è il più semplice.

### Opzione A — scaricare l'immagine (consigliato)

1. In EasyPanel: **Create → App → Docker Image**.
2. Immagine: `ghcr.io/diegoparras/extracta:latest`
   *(pubblicata automaticamente da GitHub Actions; se il package è privato, aggiungi prima una
   credenziale del registry GHCR in EasyPanel, o rendi pubblico il package).*
3. **Porta:** container `3000` → mappala sul tuo dominio. EasyPanel termina l'HTTPS al posto tuo.
4. **Ambiente** (vedi la [referenza](#referenza-delle-variabili)):
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=$2a$12$....
   SESSION_SECRET=<hex casuale>
   COOKIE_SECURE=true
   ```
5. Distribuisci. Non c'è altro — niente Redis, niente worker, niente volumi. È stateless.

### Opzione B — compilare dai sorgenti

1. **Create → App → GitHub repo**, puntando a `diegoparras/extracta`.
2. Tipo di build: **Dockerfile** (il repo ne ha uno). Stessa porta / variabili di sopra.

> EasyPanel sta dietro HTTPS, quindi mantieni `COOKIE_SECURE=true`.

---

## Referenza delle variabili

| Variabile | Default | Cosa fa |
|---|---|---|
| `PORT` | `3000` | Porta su cui ascolta il server. |
| `AUTH_ENABLED` | `true` | `false` serve l'app **senza login** (locale / rete privata). |
| `AUTH_USER` | — | Nome utente del login. Obbligatorio con `AUTH_ENABLED=true`. |
| `AUTH_PASSWORD` | — | **Hash bcrypt** della password (non il testo in chiaro). Genera con `node server.js --hash '…'`. |
| `SESSION_SECRET` | — | Segreto che firma il cookie di sessione. Stesso valore su ogni replica. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | `12` | Per quanto resta valido un login. |
| `COOKIE_SECURE` | `true` | Invia il cookie solo su HTTPS. Imposta `false` per `http://` locale. |

Elenco completo con commenti: [`.env.example`](../../.env.example).

---

## Andare in produzione

Prima di esporre Extracta a qualcuno oltre a te:

- [ ] Imposta `AUTH_USER`, `AUTH_PASSWORD` (un **hash bcrypt**, mai in chiaro) e `SESSION_SECRET`.
- [ ] **Non** lasciare `AUTH_ENABLED=false` su qualcosa raggiungibile da altri.
- [ ] `COOKIE_SECURE=true` dietro HTTPS (EasyPanel / il tuo reverse proxy termina il TLS).
- [ ] Tieni il `.env` fuori da git e dall'immagine (lo è già — `.gitignore` + `.dockerignore`).
- [ ] Conserva i segreti in un secret manager / nel pannello EasyPanel, non in un file committato.
- [ ] Ricorda: il documento è elaborato nel browser, quindi non ci sono dati del documento da
      proteggere sul server — ma il login controlla comunque *chi* può usare l'app.
