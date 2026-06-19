<div align="center">

# 📄 Extracta

**あらゆる文書からデータを抽出 —— ローカルで、正確に、あなたのものに。**

文書（銀行明細、請求書、領収書…）の列を一度マークするだけで、以降 Extracta は同じ種類の文書を
自動で読み取り、きれいな構造化データ（CSV）として返します。**残高ルール**が他にはない確実性を
与える銀行明細から始まり、あらゆる表形式の文書へと一般化します。すべては**ブラウザ内**で動作し、
文書があなたのマシンから出ることはありません。[**Escriba**](https://github.com/diegoparras/escriba)
ファミリーの一員です。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% ブラウザ](https://img.shields.io/badge/処理-100%25%20ブラウザ-30d158.svg)

[English](../../README.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [中文](README.zh.md) · **日本語**

</div>

---

## ✨ 特長

- **デジタル PDF** と**スキャン／画像**（Tesseract.js によるローカル OCR、こちらもブラウザ内）。
- **複数ページ**および**複数口座**（1 つの PDF 内の現地通貨 + ドル → 口座ごとに 1 枚のカード）。
- 自動の列検出（ベストエフォート）+ 必要に応じてドラッグでの**手動マーク**。
- 列ごとの**ロール**（日付、摘要、借方／貸方／符号付き金額、残高、テキスト）。
- 列ごとの**自由なフォーマット**（日付と数値のパターン、Excel 風）—— WYSIWYG。
- 内容による**除外ルール**（繰り返しのヘッダー、「合計」などをスキップ）。
- エクスポート前に任意のセルを修正できる**表計算風エディター** —— **残高をリアルタイムで再計算**
  （検索置換、行の追加／削除、Excel から貼り付け、元に戻す／やり直し、下方向フィル、
  補助カテゴリ分け、品質フラグ、編集可能な期首／期末残高）。
- **再利用可能なテンプレート**：銀行を一度マークすれば、次回は自動的に認識されます。テンプレートは
  各データが**どこにある**かのみを保存し、それが**何であるか**は決して保存しません。
- **CSV**、テンプレート **`.ext.json` / `.ext.yaml`**、そして **「Escriba へ送信」** への受け渡し。

## 🧭 仕組み

1. PDF または画像を**開く**（または「サンプルを見る」をクリック）。
2. 文書上で**列をマーク**します：各データがどこにあるか。システムが自動検出し、あなたはドラッグで
   微調整します。
3. 取引（CSV）またはテンプレートを**エクスポート**します。**残高ルール**が正しく読めたことを緑色で
   確認します：`期首 + 貸方 − 借方 == 期末`。投票なし、完全にローカル。

## 🔒 設計によるプライバシー

すべてはブラウザ内で動作し —— PDF はあなたのマシン内で開かれ、読み取られ、処理されます ——
**外部へのリクエストは一切ありません**（フォントとライブラリは同梱）。プライバシーは約束ではなく、
アーキテクチャそのものです。共有するテンプレートは文書の**形**（ジオメトリ）を保存し、その
**データ**は決して保存しません。

## 🧩 Escriba ファミリー

Extracta は **[Escriba](https://github.com/diegoparras/escriba)** エコシステムの独立した衛星です
（**[Fisherboy](https://github.com/diegoparras/fisherboy)** と並ぶ存在）。文書を抽出したら、
**「Escriba へ送信」** がきれいな Markdown をローカルの Escriba に渡し、匿名化、変換
（JSON/YAML/TOON）、RAG 用のチャンク化、音声化を行います —— それでも文書はあなたのマシンから
出ません。

## 🚀 クイックスタート

静的サーバーで開きます（PDF.js のワーカーに必要です）：

```bash
python -m http.server 5599
# → http://localhost:5599 を開き、samples/banco-rio-cc.pdf を読み込む
```

## 🏗️ 本番（セルフホスト）

Extracta には、静的アプリと `.env` からの任意の**ログイン**だけを提供する**軽量サーバー**
（`server.js`、Node/Express）が同梱されています。文書は引き続き 100% ブラウザ内で処理され、
サーバーは決してそれを受け取らず、厳格な CSP + セキュリティヘッダーを適用し、`.env`、`server.js`、
`samples/private/` 内の PDF を一切公開しません。

```bash
cp .env.example .env
node server.js --hash 'あなたのパスワード'   # → ハッシュを AUTH_PASSWORD に設定
openssl rand -hex 32                          # → これを SESSION_SECRET に設定
npm install && npm start                      # ローカル → http://localhost:3000
# または: docker compose up --build
```

または **GHCR** に公開されたイメージ（`ghcr.io/diegoparras/extracta:latest`、`main` への push ごとに
CI がビルド）を使い、`.env` の変数をパネルに設定して **EasyPanel** にデプロイします。

## 📜 ライセンス

Copyright 2026 Diego Parras. **Apache-2.0** —— [LICENSE](../../LICENSE) を参照。
