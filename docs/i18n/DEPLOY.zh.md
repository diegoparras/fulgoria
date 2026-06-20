# 部署 Extracta

> [English](../DEPLOY.md) · [Español](DEPLOY.es.md) · [Français](DEPLOY.fr.md) · [Português](DEPLOY.pt.md) · [Italiano](DEPLOY.it.md) · **中文** · [日本語](DEPLOY.ja.md)

Extracta 自带一个**轻量服务器**（`server.js`，Node/Express），只做两件事：提供静态应用，以及处理来自
`.env` 的可选**登录**。**文档 100% 在浏览器中处理，永远不会到达服务器** —— 没有数据库、没有队列、
没有 worker。服务器只是那扇门。

四种运行方式，从最简单到最可控：**(1)** 用 Node 本地运行，**(2)** Docker / Compose，**(3)** EasyPanel，
最后是**环境变量参考**与**上线检查清单**。

---

## 0. 先准备密钥

如果需要登录（任何对外公开的场景都建议开启），你的 `.env` 里需要两个值：

```bash
cp .env.example .env

# 1) 你密码的 bcrypt 哈希 → 填入 AUTH_PASSWORD（绝不要填明文密码）：
node server.js --hash '你的密码'

# 2) 用于给会话 cookie 签名的随机密钥 → 填入 SESSION_SECRET：
openssl rand -hex 32
```

然后编辑 `.env`：

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=$2a$12$....................          # 第 1 步的哈希
SESSION_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d... # 第 2 步的密钥
COOKIE_SECURE=true        # HTTPS 后端用 true；仅本地 http:// 才用 false
```

> 不想要登录（私有网络／仅本地）？设置 `AUTH_ENABLED=false`，跳过密钥即可。

---

## 1. 用 Node 本地运行

```bash
npm install
npm start            # → http://localhost:3000
```

就这样。Node ≥ 18。要改端口，在 `.env` 里设置 `PORT`。

---

## 2. Docker / Compose

使用 Docker Desktop（Windows/Mac）或任意 Docker 主机：

```bash
cp .env.example .env          # 填写 AUTH_PASSWORD（哈希）+ SESSION_SECRET（或 AUTH_ENABLED=false）
docker compose up --build     # → http://localhost:3000
```

手动单镜像：

```bash
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

或者拉取预构建镜像（无需构建）—— CI 在每次推送到 `main` 时发布到 GHCR：

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # 跟踪日志
docker rm -f extracta       # 停止并删除
```

> 在 Docker Desktop 上你提供的是普通的 `http://localhost`，因此请设置 `COOKIE_SECURE=false`
> （否则登录 cookie 不会被发送，你无法保持登录状态）。

---

## 3. EasyPanel

EasyPanel 既可以**拉取预构建镜像**，也可以**从仓库构建**。拉取最简单。

### 方式 A —— 拉取镜像（推荐）

1. 在 EasyPanel 中：**Create → App → Docker Image**。
2. 镜像：`ghcr.io/diegoparras/extracta:latest`
   *（由 GitHub Actions 自动发布；若 package 为私有，请先在 EasyPanel 添加 GHCR 仓库凭据，或把
   package 设为公开）。*
3. **端口：** 容器 `3000` → 映射到你的域名。EasyPanel 会为你终结 HTTPS。
4. **环境变量**（见下方的环境变量参考）：
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=$2a$12$....
   SESSION_SECRET=<随机十六进制>
   COOKIE_SECURE=true
   ```
5. 部署。没有别的了 —— 无 Redis、无 worker、无卷。它是无状态的。

### 方式 B —— 从源码构建

1. **Create → App → GitHub repo**，指向 `diegoparras/extracta`。
2. 构建类型：**Dockerfile**（仓库自带）。端口／变量同上。

> EasyPanel 位于 HTTPS 之后，因此保持 `COOKIE_SECURE=true`。

---

## 环境变量参考

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `3000` | 服务器监听的端口。 |
| `AUTH_ENABLED` | `true` | `false` 时**不带登录**提供应用（本地／私有网络）。 |
| `AUTH_USER` | — | 登录用户名。`AUTH_ENABLED=true` 时必填。 |
| `AUTH_PASSWORD` | — | 密码的 **bcrypt 哈希**（非明文）。用 `node server.js --hash '…'` 生成。 |
| `SESSION_SECRET` | — | 给会话 cookie 签名的密钥。每个副本用同一个值。`openssl rand -hex 32`。 |
| `SESSION_TTL_HOURS` | `12` | 一次登录的有效时长。 |
| `COOKIE_SECURE` | `true` | 仅通过 HTTPS 发送 cookie。本地 `http://` 设为 `false`。 |
| `ESCRIBA_URL` | — | **"发送到 Escriba"** 按钮的目标。留空 → `/`。填入你的 Escriba 地址（同域时可用内部路径）。 |

带注释的完整列表：[`.env.example`](../../.env.example)。

---

## 上线前

在把 Extracta 开放给你以外的任何人之前：

- [ ] 设置 `AUTH_USER`、`AUTH_PASSWORD`（**bcrypt 哈希**，绝不用明文）和 `SESSION_SECRET`。
- [ ] **不要**在他人可访问的环境里保留 `AUTH_ENABLED=false`。
- [ ] HTTPS 后端使用 `COOKIE_SECURE=true`（EasyPanel／你的反向代理负责终结 TLS）。
- [ ] 让 `.env` 远离 git 和镜像（已经如此 —— `.gitignore` + `.dockerignore`）。
- [ ] 把密钥放进密钥管理器／EasyPanel 面板，而不是提交进仓库的文件。
- [ ] 记住：文档在浏览器中处理，所以服务器上没有文档数据需要保护 —— 但登录仍然控制*谁*能使用应用。
