<div align="center">

# 📄 Extracta

**Estrai dati da qualsiasi documento — locale, esatto, tuo.**

Segna le colonne di un documento (estratto conto, fattura, ricevuta…) una sola volta, e da lì in
poi Extracta legge da solo ogni documento di quel tipo e te lo restituisce in dati puliti (CSV).
Parte dagli estratti conto —dove la **regola del saldo** dà una certezza che nessun altro ha— e
si generalizza a qualsiasi documento tabellare. Tutto gira **nel tuo browser**: il documento non
lascia mai la tua macchina. Parte della famiglia [**Escriba**](https://github.com/diegoparras/escriba).

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% browser](https://img.shields.io/badge/elaborazione-100%25%20browser-30d158.svg)

[English](../../README.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · **Italiano** · [中文](README.zh.md) · [日本語](README.ja.md)

</div>

---

## ✨ Funzionalità

- **PDF digitali** e **scansioni/immagini** (OCR locale con Tesseract.js, anch'esso nel browser).
- **Multipagina** e **multi-conto** (euro + dollari in un unico PDF → una scheda per conto).
- Rilevamento automatico delle colonne (best-effort) + **marcatura manuale** trascinando quando serve.
- **Ruoli** per colonna (data, descrizione, dare/avere/importo con segno, saldo, testo).
- **Formato libero** per colonna (pattern di data e numero, stile Excel) — WYSIWYG.
- **Regole di esclusione** per contenuto (saltare intestazioni ripetute, "TOTALI", ecc.).
- **Editor in stile foglio di calcolo** per correggere qualsiasi cella prima di esportare — con il
  **saldo ricalcolato in tempo reale** (trova e sostituisci, aggiungi/elimina righe, incolla da
  Excel, annulla/ripeti, riempimento verso il basso, categorizzazione assistita, indicatori di
  qualità, saldo iniziale/finale modificabile).
- **Modelli riutilizzabili**: segna una banca una volta e la volta dopo viene riconosciuta da sola.
  Il modello memorizza **dove** si trova ogni dato, mai **cosa** dice.
- Esportazione in **CSV**, modello **`.ext.json` / `.ext.yaml`** e handoff **"Invia a Escriba"**.

## 🧭 Come funziona

1. **Apri** un PDF o un'immagine (o clicca "Vedi un esempio").
2. **Segna le colonne** sul documento: dove si trova ogni dato. Il sistema rileva da solo; tu
   rifinisci trascinando.
3. **Esporta** i movimenti (CSV) o il modello. La **regola del saldo** conferma in verde che ha
   letto correttamente: `apertura + accrediti − addebiti == chiusura`. Senza voti, 100% locale.

## 🔒 Privacy by design

Tutto gira nel tuo browser —il PDF viene aperto, letto ed elaborato dentro la tua macchina— e non
c'è **nessuna chiamata esterna** (font e librerie incorporate). La privacy non è una promessa: è
l'architettura. Il modello che condividi memorizza la **forma** del documento (geometria), mai i
suoi **dati**.

## 🧩 La famiglia Escriba

Extracta è un satellite autonomo dell'ecosistema **[Escriba](https://github.com/diegoparras/escriba)**
(insieme a **[Fisherboy](https://github.com/diegoparras/fisherboy)**). Una volta estratto un
documento, **"Invia a Escriba"** consegna il Markdown pulito al tuo Escriba locale per
anonimizzare, convertire (JSON/YAML/TOON), suddividere per il RAG o trasformare in audio — e il
documento continua a non lasciare la tua macchina.

## 🚀 Avvio rapido

Aprilo con un server statico (serve per il worker di PDF.js):

```bash
python -m http.server 5599
# → apri http://localhost:5599  e carica samples/banco-rio-cc.pdf
```

## 🏗️ Produzione (self-hosted)

Extracta include un **server leggero** (`server.js`, Node/Express) che serve solo l'app statica e un
**login** opzionale dal `.env`. Il documento viene comunque elaborato al 100% nel browser; il
server non lo riceve mai, applica una CSP rigorosa + header di sicurezza, e non espone mai `.env`,
`server.js` né i PDF in `samples/private/`.

```bash
cp .env.example .env
node server.js --hash 'la-tua-password'   # → metti l'hash in AUTH_PASSWORD
openssl rand -hex 32                       # → metti questo in SESSION_SECRET
npm install && npm start                   # locale → http://localhost:3000
# oppure: docker compose up --build
```

Oppure usa l'immagine pubblicata su **GHCR** (`ghcr.io/diegoparras/extracta:latest`, costruita dalla
CI ad ogni push su `main`) e distribuiscila su **EasyPanel** con le variabili del `.env` nel pannello.

## 📜 Licenza

Copyright 2026 Diego Parras. **Apache-2.0** — vedi [LICENSE](../../LICENSE).
