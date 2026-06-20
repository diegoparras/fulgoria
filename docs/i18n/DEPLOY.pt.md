# Implantar o Fulgoria

> [English](../DEPLOY.md) · [Español](DEPLOY.es.md) · [Français](DEPLOY.fr.md) · **Português** · [Italiano](DEPLOY.it.md) · [中文](DEPLOY.zh.md) · [日本語](DEPLOY.ja.md)

O Fulgoria traz um **servidor leve** (`server.js`, Node/Express) que faz apenas duas coisas: servir
o app estático e tratar um login opcional a partir do `.env`. **O documento é processado 100% no
navegador e nunca chega ao servidor** — não há banco de dados, fila nem worker. O servidor é só a porta.

Quatro formas de rodar, da mais fácil à mais controlada: **(1)** local com Node, **(2)** Docker /
Compose, **(3)** EasyPanel, e por fim a **referência de variáveis** e o **checklist de produção**.

---

## 0. Primeiro, os segredos

Para ter login (recomendado para qualquer coisa pública), coloque isto no seu `.env`:

```bash
cp .env.example .env
```

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=sua-senha          # texto puro, como Escriba/Fisherboy
SESSION_SECRET=<cole o de baixo>
COOKIE_SECURE=true               # true atrás de HTTPS; false só para http:// local
```

O único valor que você precisa gerar é `SESSION_SECRET` (assina o cookie de sessão):

```bash
openssl rand -hex 32
# Sem openssl no Windows? -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Prefere não deixar a senha em claro?** Use um hash bcrypt: rode `node server.js --hash 'sua-senha'` e cole o `$2a$...` em `AUTH_PASSWORD` (o servidor detecta sozinho).
>
> **Não quer login** (rede privada / só local)? Defina `AUTH_ENABLED=false` e pule os segredos.

---

## 1. Local com Node

```bash
npm install
npm start            # → http://localhost:3000
```

É isso. Node ≥ 18. Para mudar a porta, defina `PORT` no `.env`.

---

## 2. Docker / Compose

Com Docker Desktop (Windows/Mac) ou qualquer host Docker:

```bash
cp .env.example .env          # preencha AUTH_PASSWORD + SESSION_SECRET (ou AUTH_ENABLED=false)
docker compose up --build     # → http://localhost:3000
```

Imagem sozinha, na mão:

```bash
docker build -t fulgoria .
docker run -d --name fulgoria --env-file .env -p 3000:3000 fulgoria
```

Ou puxe a imagem pré-construída (sem build) — publicada no GHCR pela CI a cada push em `main`:

```bash
docker run -d --name fulgoria --env-file .env -p 3000:3000 ghcr.io/diegoparras/fulgoria:latest
```

```bash
docker logs -f fulgoria     # acompanhar logs
docker rm -f fulgoria       # parar e remover
```

> No Docker Desktop você serve `http://localhost` puro, então defina `COOKIE_SECURE=false` (senão o
> cookie de login não é enviado e você não consegue ficar logado).

---

## 3. EasyPanel

O EasyPanel pode **puxar a imagem pré-construída** ou **buildar a partir do repo**. Puxar é o mais simples.

### Opção A — puxar a imagem (recomendado)

1. No EasyPanel: **Create → App → Docker Image**.
2. Imagem: `ghcr.io/diegoparras/fulgoria:latest`
   *(publicada automaticamente pelo GitHub Actions; se o package for privado, adicione antes uma
   credencial de registry GHCR no EasyPanel, ou torne o package público).*
3. **Porta:** contêiner `3000` → mapeie para o seu domínio. O EasyPanel encerra o HTTPS por você.
4. **Ambiente** (veja a [referência](#referência-de-variáveis)):
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=<your-password>
   SESSION_SECRET=<hex aleatório>
   COOKIE_SECURE=true
   ```
5. Implante. Não há mais nada — sem Redis, sem worker, sem volumes. É stateless.

### Opção B — buildar do código

1. **Create → App → GitHub repo**, apontando para `diegoparras/fulgoria`.
2. Tipo de build: **Dockerfile** (o repo tem um). Mesma porta / variáveis acima.

> O EasyPanel fica atrás de HTTPS, então mantenha `COOKIE_SECURE=true`.

---

## Referência de variáveis

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta em que o servidor escuta. |
| `AUTH_ENABLED` | `true` | `false` serve o app **sem login** (local / rede privada). |
| `AUTH_USER` | — | Usuário do login. Obrigatório com `AUTH_ENABLED=true`. |
| `AUTH_PASSWORD` | — | A senha do login, em **texto puro** (como Escriba/Fisherboy). Opcional: um hash bcrypt (`node server.js --hash '…'`) para não deixá-la em claro. |
| `SESSION_SECRET` | — | Segredo que assina o cookie de sessão. Mesmo valor em cada réplica. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | `12` | Quanto tempo um login permanece válido. |
| `COOKIE_SECURE` | `true` | Envia o cookie só por HTTPS. Defina `false` para `http://` local. |
| `ESCRIBA_URL` | — | Destino do botão **"Enviar ao Escriba"**. Vazio → `/`. Defina a URL do seu Escriba (ou um caminho interno se mesmo domínio). |

Lista completa com comentários: [`.env.example`](../../.env.example).

---

## Indo para produção

Antes de expor o Fulgoria a alguém além de você:

- [ ] Defina `AUTH_USER`, `AUTH_PASSWORD` (sua senha, ou um hash bcrypt) e `SESSION_SECRET`.
- [ ] **Não** deixe `AUTH_ENABLED=false` em algo acessível por outros.
- [ ] `COOKIE_SECURE=true` atrás de HTTPS (EasyPanel / seu reverse proxy encerra o TLS).
- [ ] Mantenha o `.env` fora do git e da imagem (já está — `.gitignore` + `.dockerignore`).
- [ ] Guarde os segredos num gerenciador de segredos / no painel do EasyPanel, não num arquivo commitado.
- [ ] Lembre: o documento é processado no navegador, então não há dados de documento a proteger no
      servidor — mas o login ainda controla *quem* pode usar o app.
