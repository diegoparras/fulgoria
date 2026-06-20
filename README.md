<div align="center">

# 📄 Extracta

**Extract data from any document — local, exact, yours.**

Mark the columns of a document (bank statement, invoice, receipt…) once, and from then on
Extracta reads every document of that kind on its own and gives you clean structured data
(CSV). It starts with bank statements —where the **balance rule** gives a certainty no one
else has— and generalizes to any tabular document. Everything runs **in your browser**: the
document never leaves your machine. Part of the [**Escriba**](https://github.com/diegoparras/escriba) family.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% browser](https://img.shields.io/badge/processing-100%25%20browser-30d158.svg)

**English** · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Português](docs/i18n/README.pt.md) · [Italiano](docs/i18n/README.it.md) · [中文](docs/i18n/README.zh.md) · [日本語](docs/i18n/README.ja.md)

</div>

---

## ✨ Features

- **Digital PDFs and scans/images** (local OCR with Tesseract.js, also in the browser).
- **Multi-page** and **multi-account** (pesos + dollars in one PDF → one card per account).
- Automatic column detection (best-effort) + **manual marking** by dragging when needed.
- **Roles** per column (date, description, debit/credit/amount with sign, balance, text).
- **Free formatting** per column (date and number patterns, Excel-style) — WYSIWYG.
- **Exclusion rules** by content (skip repeated headers, "TOTALS", etc.).
- **Spreadsheet-style editor** to fix any cell before exporting — with the **balance
  recomputing live** (find & replace, add/delete rows, paste from Excel, undo/redo, fill-down,
  assisted categorization, quality flags, editable opening/closing).
- **Reusable templates**: mark a bank once and next time it's recognized automatically. The
  template stores **where** each datum is, never **what** it says.
- Export to **CSV**, template **`.ext.json` / `.ext.yaml`**, and a **"Send to Escriba"** handoff.

## 🧭 How it works

1. **Open** a PDF or image (or click "See an example").
2. **Mark the columns** over the document: where each datum lives. The system auto-detects;
   you fine-tune by dragging.
3. **Export** the movements (CSV) or the template. The **balance rule** confirms in green that
   it read correctly: `opening + credits − debits == closing`. No votes, fully local.

## 🔒 Privacy by design

Everything runs in your browser — the PDF is opened, read and processed inside your machine,
and there is **not a single external request** (fonts and libraries are vendored). Privacy
isn't a promise: it's the architecture. The template you share stores the document's
**shape** (geometry), never its **data**.

## 🧩 The Escriba family

Extracta is a standalone satellite of the **[Escriba](https://github.com/diegoparras/escriba)**
ecosystem (alongside **[Fisherboy](https://github.com/diegoparras/fisherboy)**). Once you've
extracted a document, **"Send to Escriba"** hands the clean Markdown to your local Escriba to
anonymize, convert (JSON/YAML/TOON), chunk for RAG, or turn into audio — and the document
still never leaves your machine.

## 🚀 Quick start

Open it with a static server (needed for the PDF.js worker):

```bash
python -m http.server 5599
# → open http://localhost:5599  and load samples/banco-rio-cc.pdf
```

## 🏗️ Production (self-hosted)

Extracta ships a **thin server** (`server.js`, Node/Express) that only serves the static app
and an optional **login** from `.env`. The document is still processed 100% in the browser;
the server never receives it, applies a strict CSP + security headers, and never exposes
`.env`, `server.js` or the PDFs in `samples/private/`.

```bash
cp .env.example .env
node server.js --hash 'your-password'   # → put the hash in AUTH_PASSWORD
openssl rand -hex 32                     # → put this in SESSION_SECRET
npm install && npm start                 # local → http://localhost:3000
# or: docker compose up --build
```

Or use the image published to **GHCR** (`ghcr.io/diegoparras/extracta:latest`, built by CI on
every push to `main`) and deploy it on **EasyPanel** with the `.env` variables set in the panel.

> 📖 **Full deploy guide** (Docker, EasyPanel, environment reference, production checklist):
> [docs/DEPLOY.md](docs/DEPLOY.md).

## 📜 License

Copyright 2026 Diego Parras. **Apache-2.0** — see [LICENSE](LICENSE).
