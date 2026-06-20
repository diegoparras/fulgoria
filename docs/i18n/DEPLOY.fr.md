# Déployer Extracta

> [English](../DEPLOY.md) · [Español](DEPLOY.es.md) · **Français** · [Português](DEPLOY.pt.md) · [Italiano](DEPLOY.it.md) · [中文](DEPLOY.zh.md) · [日本語](DEPLOY.ja.md)

Extracta inclut un **serveur léger** (`server.js`, Node/Express) qui ne fait que deux choses :
servir l'app statique et gérer un login optionnel depuis le `.env`. **Le document est traité à 100%
dans le navigateur et n'atteint jamais le serveur** — pas de base de données, pas de file, pas de
worker. Le serveur n'est que la porte.

Quatre façons de le lancer, de la plus simple à la plus contrôlée : **(1)** local avec Node,
**(2)** Docker / Compose, **(3)** EasyPanel, puis la **référence des variables** et la
**checklist de production**.

---

## 0. D'abord, les secrets

Pour un login (recommandé pour tout ce qui est public), mettez ceci dans votre `.env` :

```bash
cp .env.example .env
```

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=votre-mot-de-passe   # texte clair, comme Escriba/Fisherboy
SESSION_SECRET=<collez celui ci-dessous>
COOKIE_SECURE=true                 # true derrière HTTPS ; false seulement pour http:// local
```

La seule valeur à générer est `SESSION_SECRET` (il signe le cookie de session) :

```bash
openssl rand -hex 32
# Pas d'openssl sous Windows ? -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Vous préférez ne pas garder le mot de passe en clair ?** Utilisez un hash bcrypt : lancez `node server.js --hash 'votre-mot-de-passe'` et collez le `$2a$...` dans `AUTH_PASSWORD` (le serveur le détecte tout seul).
>
> **Pas de login** (réseau privé / local) ? Mettez `AUTH_ENABLED=false` et sautez les secrets.

---

## 1. Local avec Node

```bash
npm install
npm start            # → http://localhost:3000
```

C'est tout. Node ≥ 18. Pour changer le port, définissez `PORT` dans le `.env`.

---

## 2. Docker / Compose

Avec Docker Desktop (Windows/Mac) ou tout hôte Docker :

```bash
cp .env.example .env          # remplissez AUTH_PASSWORD + SESSION_SECRET (ou AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Image seule, à la main :

```bash
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

Ou tirez l'image préconstruite (sans build) — publiée sur GHCR par la CI à chaque push sur `main` :

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # suivre les logs
docker rm -f extracta       # arrêter et supprimer
```

> Sur Docker Desktop vous servez du `http://localhost` simple, donc mettez `COOKIE_SECURE=false`
> (sinon le cookie de login n'est pas envoyé et vous ne restez pas connecté).

---

## 3. EasyPanel

EasyPanel peut **tirer l'image préconstruite** ou **builder depuis le dépôt**. Tirer l'image est le plus simple.

### Option A — tirer l'image (recommandé)

1. Dans EasyPanel : **Create → App → Docker Image**.
2. Image : `ghcr.io/diegoparras/extracta:latest`
   *(publiée automatiquement par GitHub Actions ; si le package est privé, ajoutez d'abord un
   identifiant de registre GHCR dans EasyPanel, ou rendez le package public).*
3. **Port :** conteneur `3000` → mappez-le à votre domaine. EasyPanel termine le HTTPS pour vous.
4. **Environnement** (voir la [référence](#référence-des-variables)) :
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=<your-password>
   SESSION_SECRET=<hex aléatoire>
   COOKIE_SECURE=true
   ```
5. Déployez. Rien d'autre — pas de Redis, pas de worker, pas de volumes. C'est stateless.

### Option B — builder depuis les sources

1. **Create → App → GitHub repo**, pointez sur `diegoparras/extracta`.
2. Type de build : **Dockerfile** (le dépôt en a un). Mêmes port / variables que ci-dessus.

> EasyPanel est derrière HTTPS, donc gardez `COOKIE_SECURE=true`.

---

## Référence des variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur. |
| `AUTH_ENABLED` | `true` | `false` sert l'app **sans login** (local / réseau privé). |
| `AUTH_USER` | — | Nom d'utilisateur du login. Requis si `AUTH_ENABLED=true`. |
| `AUTH_PASSWORD` | — | Le mot de passe du login, en **texte clair** (comme Escriba/Fisherboy). Optionnel : un hash bcrypt (`node server.js --hash '…'`) pour ne pas le stocker en clair. |
| `SESSION_SECRET` | — | Secret qui signe le cookie de session. Même valeur sur chaque réplique. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | `12` | Durée de validité d'une session. |
| `COOKIE_SECURE` | `true` | N'envoie le cookie qu'en HTTPS. Mettez `false` pour du `http://` local. |
| `ESCRIBA_URL` | — | Destination du bouton **« Envoyer à Escriba »**. Vide → `/`. Mettez l'URL de votre Escriba (ou un chemin interne si même domaine). |

Liste complète commentée : [`.env.example`](../../.env.example).

---

## Passer en production

Avant d'exposer Extracta à quelqu'un d'autre que vous :

- [ ] Définissez `AUTH_USER`, `AUTH_PASSWORD` (votre mot de passe, ou un hash bcrypt) et `SESSION_SECRET`.
- [ ] **Ne laissez pas** `AUTH_ENABLED=false` sur quelque chose d'accessible aux autres.
- [ ] `COOKIE_SECURE=true` derrière HTTPS (EasyPanel / votre reverse proxy termine le TLS).
- [ ] Gardez le `.env` hors de git et de l'image (c'est déjà le cas — `.gitignore` + `.dockerignore`).
- [ ] Gardez les secrets dans un gestionnaire de secrets / le panneau EasyPanel, pas dans un fichier commité.
- [ ] Rappel : le document est traité dans le navigateur, donc aucune donnée de document à protéger
      sur le serveur — mais le login contrôle tout de même *qui* peut utiliser l'app.
