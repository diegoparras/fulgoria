# Extracta のデプロイ

> [English](../DEPLOY.md) · [Español](DEPLOY.es.md) · [Français](DEPLOY.fr.md) · [Português](DEPLOY.pt.md) · [Italiano](DEPLOY.it.md) · [中文](DEPLOY.zh.md) · **日本語**

Extracta には、静的アプリの配信と `.env` からの任意の**ログイン**処理だけを行う**軽量サーバー**
（`server.js`、Node/Express）が同梱されています。**文書は 100% ブラウザ内で処理され、サーバーには
決して届きません** —— データベースもキューもワーカーもありません。サーバーは単なる入口です。

実行方法は 4 通り、簡単な順に：**(1)** Node でローカル実行、**(2)** Docker / Compose、
**(3)** EasyPanel、そして最後に**環境変数リファレンス**と**本番チェックリスト**。

---

## 0. まずシークレット

ログインを使う場合（公開する用途では推奨）、`.env` に 2 つの値が必要です：

```bash
cp .env.example .env

# 1) パスワードの bcrypt ハッシュ → AUTH_PASSWORD に設定（平文パスワードは絶対に入れない）：
node server.js --hash 'あなたのパスワード'

# 2) セッション cookie に署名するランダムなシークレット → SESSION_SECRET に設定：
openssl rand -hex 32
```

次に `.env` を編集：

```ini
AUTH_ENABLED=true
AUTH_USER=diego
AUTH_PASSWORD=$2a$12$....................          # 手順 1 のハッシュ
SESSION_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d... # 手順 2 のシークレット
COOKIE_SECURE=true        # HTTPS の背後では true、ローカル http:// のときだけ false
```

> ログイン不要（プライベートネットワーク／ローカルのみ）？ `AUTH_ENABLED=false` にしてシークレットは省略。

---

## 1. Node でローカル実行

```bash
npm install
npm start            # → http://localhost:3000
```

これだけです。Node ≥ 18。ポートを変えるには `.env` で `PORT` を設定します。

---

## 2. Docker / Compose

Docker Desktop（Windows/Mac）または任意の Docker ホストで：

```bash
cp .env.example .env          # AUTH_PASSWORD（ハッシュ）+ SESSION_SECRET を記入（または AUTH_ENABLED=false）
docker compose up --build     # → http://localhost:3000
```

単一イメージを手動で：

```bash
docker build -t extracta .
docker run -d --name extracta --env-file .env -p 3000:3000 extracta
```

またはビルド済みイメージを取得（ビルド不要）—— `main` への push ごとに CI が GHCR へ公開：

```bash
docker run -d --name extracta --env-file .env -p 3000:3000 ghcr.io/diegoparras/extracta:latest
```

```bash
docker logs -f extracta     # ログを追う
docker rm -f extracta       # 停止して削除
```

> Docker Desktop では素の `http://localhost` で配信するため、`COOKIE_SECURE=false` にしてください
> （そうしないとログイン cookie が送信されず、ログイン状態を保てません）。

---

## 3. EasyPanel

EasyPanel は**ビルド済みイメージの取得**も**リポジトリからのビルド**も可能です。取得が最も簡単です。

### 方法 A —— イメージを取得（推奨）

1. EasyPanel で：**Create → App → Docker Image**。
2. イメージ：`ghcr.io/diegoparras/extracta:latest`
   *（GitHub Actions が自動公開。package が非公開なら、先に EasyPanel に GHCR レジストリの認証情報を
   追加するか、package を公開にしてください）。*
3. **ポート：** コンテナ `3000` → あなたのドメインにマッピング。HTTPS は EasyPanel が終端します。
4. **環境変数**（下記の環境変数リファレンス参照）：
   ```ini
   AUTH_ENABLED=true
   AUTH_USER=diego
   AUTH_PASSWORD=$2a$12$....
   SESSION_SECRET=<ランダムな hex>
   COOKIE_SECURE=true
   ```
5. デプロイ。これ以外は何もありません —— Redis もワーカーもボリュームもなし。ステートレスです。

### 方法 B —— ソースからビルド

1. **Create → App → GitHub repo** で `diegoparras/extracta` を指定。
2. ビルド種別：**Dockerfile**（リポジトリに同梱）。ポート／変数は上と同じ。

> EasyPanel は HTTPS の背後にあるため、`COOKIE_SECURE=true` のままにしてください。

---

## 環境変数リファレンス

| 変数 | 既定値 | 役割 |
|---|---|---|
| `PORT` | `3000` | サーバーが待ち受けるポート。 |
| `AUTH_ENABLED` | `true` | `false` でアプリを**ログインなし**で配信（ローカル／プライベートネットワーク）。 |
| `AUTH_USER` | — | ログインのユーザー名。`AUTH_ENABLED=true` のとき必須。 |
| `AUTH_PASSWORD` | — | ログインのパスワード。**平文**（Escriba/Fisherboy と同じ）。任意：bcrypt ハッシュ（`node server.js --hash '…'`）で平文保存を避けられます。 |
| `SESSION_SECRET` | — | セッション cookie に署名するシークレット。全レプリカで同じ値を使う。`openssl rand -hex 32`。 |
| `SESSION_TTL_HOURS` | `12` | ログインの有効時間。 |
| `COOKIE_SECURE` | `true` | cookie を HTTPS でのみ送信。ローカル `http://` では `false`。 |
| `ESCRIBA_URL` | — | **「Escriba へ送信」** ボタンの送信先。空 → `/`。あなたの Escriba の URL（同一ドメインなら内部パス）を設定。 |

コメント付きの全リスト：[`.env.example`](../../.env.example)。

---

## 本番に出す前に

Extracta をあなた以外に公開する前に：

- [ ] `AUTH_USER`、`AUTH_PASSWORD`（**bcrypt ハッシュ**、平文は不可）、`SESSION_SECRET` を設定。
- [ ] 他者がアクセスできる環境で `AUTH_ENABLED=false` を**残さない**。
- [ ] HTTPS の背後では `COOKIE_SECURE=true`（EasyPanel／リバースプロキシが TLS を終端）。
- [ ] `.env` を git とイメージから除外（すでに除外済み —— `.gitignore` + `.dockerignore`）。
- [ ] シークレットはコミットしたファイルではなく、シークレットマネージャー／EasyPanel パネルに保管。
- [ ] 念のため：文書はブラウザで処理されるため、サーバー上に守るべき文書データはありません ——
      それでもログインは*誰が*アプリを使えるかを制御します。
