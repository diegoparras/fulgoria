<div align="center">

# 📄 Fulgoria

**Extraé datos de cualquier documento — local, exacto, tuyo.**

Marcá las columnas de un documento (extracto bancario, factura, recibo…) una sola vez, y de ahí
en más Fulgoria lee solo todos los documentos de ese tipo y te los da en datos limpios (CSV).
Empieza por extractos bancarios —donde la **regla del saldo** da una certeza que nadie más
tiene— y se generaliza a cualquier documento tabular. Todo corre **en tu navegador**: el
documento nunca sale de tu máquina. Parte de la familia [**Escriba**](https://github.com/diegoparras/escriba).

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Ffulgoria-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/fulgoria/pkgs/container/fulgoria)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% navegador](https://img.shields.io/badge/proceso-100%25%20navegador-30d158.svg)

[English](../../README.md) · **Español** · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [中文](README.zh.md) · [日本語](README.ja.md)

</div>

---

## ✨ Características

- **PDFs digitales** y **escaneados/imágenes** (OCR local con Tesseract.js, también en el navegador).
- **Multipágina** y **multi-cuenta** (pesos + dólares en un mismo PDF → una tarjeta por cuenta).
- Detección automática de columnas (best-effort) + **marcado manual** por arrastre cuando hace falta.
- **Roles** por columna (fecha, descripción, débito/crédito/importe con signo, saldo, texto).
- **Formato libre** por columna (patrón de fecha y de número, estilo Excel) — WYSIWYG.
- **Reglas de exclusión** por contenido (saltear headers repetidos, "TOTALES", etc.).
- **Editor tipo planilla** para corregir cualquier celda antes de exportar — con el **saldo
  recalculando en vivo** (buscar y reemplazar, agregar/borrar filas, pegar desde Excel,
  deshacer/rehacer, fill-down, categorización asistida, flags de calidad, apertura/cierre editables).
- **Plantillas reutilizables**: marcás un banco una vez y la próxima lo reconoce solo. La
  plantilla guarda **dónde** está cada dato, nunca **qué** dice.
- Export a **CSV**, plantilla **`.ext.json` / `.ext.yaml`** y handoff **"Enviar a Escriba"**.

## 🧭 Cómo funciona

1. **Abrí** un PDF o imagen (o tocá "Ver un ejemplo").
2. **Marcá las columnas** sobre el documento: dónde está cada dato. El sistema autodetecta;
   vos ajustás arrastrando.
3. **Exportá** los movimientos (CSV) o la plantilla. La **regla del saldo** te confirma en verde
   que leyó bien: `apertura + créditos − débitos == cierre`. Sin votos, 100% local.

## 🔒 Privacidad por diseño

Todo corre en tu navegador —el PDF se abre, se lee y se procesa dentro de tu máquina— y no hay
**ni una sola llamada externa** (fuentes y librerías vendorizadas). La privacidad no es una
promesa: es la arquitectura. La plantilla que compartís guarda la **forma** del documento
(geometría), nunca sus **datos**.

## 🧩 La familia Escriba

Fulgoria es un satélite standalone del ecosistema **[Escriba](https://github.com/diegoparras/escriba)**
(junto con **[Fisherboy](https://github.com/diegoparras/fisherboy)**). Una vez extraído un
documento, **"Enviar a Escriba"** le pasa el Markdown limpio a tu Escriba local para anonimizar,
convertir (JSON/YAML/TOON), chunkear para RAG o convertir en audio — y el documento sigue sin
salir de tu máquina.

## 🚀 Probar

Se abre con un servidor estático (hace falta por el worker de PDF.js):

```bash
python -m http.server 5599
# → abrí http://localhost:5599  y cargá samples/banco-rio-cc.pdf
```

## 🏗️ Producción (self-hosted)

Fulgoria trae un **server fino** (`server.js`, Node/Express) que solo sirve la app estática y un
**login** opcional desde el `.env`. El documento se sigue procesando 100% en el navegador; el
server nunca lo recibe, aplica CSP estricta + headers de seguridad, y jamás expone `.env`,
`server.js` ni los PDFs de `samples/private/`.

```bash
cp .env.example .env
node server.js --hash 'tu-contraseña'   # → poné el hash en AUTH_PASSWORD
openssl rand -hex 32                     # → poné esto en SESSION_SECRET
npm install && npm start                 # local → http://localhost:3000
# o: docker compose up --build
```

O usá la imagen publicada en **GHCR** (`ghcr.io/diegoparras/fulgoria:latest`, que el CI construye
en cada push a `main`) y desplegala en **EasyPanel** con las variables del `.env` en el panel.

> 📖 **Guía de deploy completa** (Docker, EasyPanel, referencia de variables, checklist de producción):
> [DEPLOY.es.md](DEPLOY.es.md).

## 📜 Licencia

Copyright 2026 Diego Parras. **Apache-2.0** — ver [LICENSE](../../LICENSE).
