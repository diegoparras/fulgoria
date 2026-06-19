<div align="center">

# 📄 Extracta

**Extraia dados de qualquer documento — local, exato, seu.**

Marque as colunas de um documento (extrato bancário, fatura, recibo…) uma única vez, e a partir
daí o Extracta lê sozinho todos os documentos desse tipo e devolve dados limpos (CSV). Começa
pelos extratos bancários —onde a **regra do saldo** dá uma certeza que ninguém mais tem— e se
generaliza para qualquer documento tabular. Tudo roda **no seu navegador**: o documento nunca sai
da sua máquina. Parte da família [**Escriba**](https://github.com/diegoparras/escriba).

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% navegador](https://img.shields.io/badge/processamento-100%25%20navegador-30d158.svg)

[English](../../README.md) · [Español](README.es.md) · [Français](README.fr.md) · **Português** · [Italiano](README.it.md) · [中文](README.zh.md) · [日本語](README.ja.md)

</div>

---

## ✨ Recursos

- **PDFs digitais** e **digitalizações/imagens** (OCR local com Tesseract.js, também no navegador).
- **Multipágina** e **multiconta** (reais + dólares num mesmo PDF → um cartão por conta).
- Detecção automática de colunas (best-effort) + **marcação manual** arrastando quando preciso.
- **Papéis** por coluna (data, descrição, débito/crédito/valor com sinal, saldo, texto).
- **Formato livre** por coluna (padrões de data e número, estilo Excel) — WYSIWYG.
- **Regras de exclusão** por conteúdo (pular cabeçalhos repetidos, "TOTAIS", etc.).
- **Editor estilo planilha** para corrigir qualquer célula antes de exportar — com o **saldo
  recalculando ao vivo** (localizar e substituir, adicionar/excluir linhas, colar do Excel,
  desfazer/refazer, preencher para baixo, categorização assistida, sinais de qualidade,
  saldo de abertura/fechamento editável).
- **Modelos reutilizáveis**: marque um banco uma vez e da próxima ele é reconhecido sozinho. O
  modelo guarda **onde** está cada dado, nunca **o que** ele diz.
- Exportação para **CSV**, modelo **`.ext.json` / `.ext.yaml`** e handoff **"Enviar ao Escriba"**.

## 🧭 Como funciona

1. **Abra** um PDF ou imagem (ou clique em "Ver um exemplo").
2. **Marque as colunas** sobre o documento: onde está cada dado. O sistema detecta sozinho;
   você ajusta arrastando.
3. **Exporte** os movimentos (CSV) ou o modelo. A **regra do saldo** confirma em verde que leu
   certo: `abertura + créditos − débitos == fechamento`. Sem votos, 100% local.

## 🔒 Privacidade por design

Tudo roda no seu navegador —o PDF é aberto, lido e processado dentro da sua máquina— e não há
**nenhuma chamada externa** (fontes e bibliotecas embutidas). Privacidade não é uma promessa: é a
arquitetura. O modelo que você compartilha guarda a **forma** do documento (geometria), nunca os
seus **dados**.

## 🧩 A família Escriba

O Extracta é um satélite independente do ecossistema **[Escriba](https://github.com/diegoparras/escriba)**
(junto com o **[Fisherboy](https://github.com/diegoparras/fisherboy)**). Depois de extrair um
documento, **"Enviar ao Escriba"** entrega o Markdown limpo ao seu Escriba local para anonimizar,
converter (JSON/YAML/TOON), fatiar para RAG ou transformar em áudio — e o documento continua sem
sair da sua máquina.

## 🚀 Começo rápido

Abra com um servidor estático (necessário pelo worker do PDF.js):

```bash
python -m http.server 5599
# → abra http://localhost:5599  e carregue samples/banco-rio-cc.pdf
```

## 🏗️ Produção (self-hosted)

O Extracta traz um **servidor leve** (`server.js`, Node/Express) que só serve o app estático e um
**login** opcional a partir do `.env`. O documento continua sendo processado 100% no navegador; o
servidor nunca o recebe, aplica CSP estrita + cabeçalhos de segurança, e nunca expõe `.env`,
`server.js` nem os PDFs em `samples/private/`.

```bash
cp .env.example .env
node server.js --hash 'sua-senha'   # → coloque o hash em AUTH_PASSWORD
openssl rand -hex 32                 # → coloque isto em SESSION_SECRET
npm install && npm start             # local → http://localhost:3000
# ou: docker compose up --build
```

Ou use a imagem publicada no **GHCR** (`ghcr.io/diegoparras/extracta:latest`, construída pela CI a
cada push em `main`) e implante no **EasyPanel** com as variáveis do `.env` no painel.

## 📜 Licença

Copyright 2026 Diego Parras. **Apache-2.0** — veja [LICENSE](../../LICENSE).
