<div align="center">

# 📄 Extracta

**Extrayez les données de n'importe quel document — local, exact, à vous.**

Marquez les colonnes d'un document (relevé bancaire, facture, reçu…) une seule fois, et dès
lors Extracta lit tout seul chaque document de ce type et vous le rend en données propres (CSV).
Il commence par les relevés bancaires —où la **règle du solde** offre une certitude que
personne d'autre n'a— et se généralise à tout document tabulaire. Tout s'exécute **dans votre
navigateur** : le document ne quitte jamais votre machine. Membre de la famille
[**Escriba**](https://github.com/diegoparras/escriba).

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% navigateur](https://img.shields.io/badge/traitement-100%25%20navigateur-30d158.svg)

[English](../../README.md) · [Español](README.es.md) · **Français** · [Português](README.pt.md) · [Italiano](README.it.md) · [中文](README.zh.md) · [日本語](README.ja.md)

</div>

---

## ✨ Fonctionnalités

- **PDF numériques** et **scans/images** (OCR local avec Tesseract.js, lui aussi dans le navigateur).
- **Multi-pages** et **multi-comptes** (pesos + dollars dans un même PDF → une carte par compte).
- Détection automatique des colonnes (best-effort) + **marquage manuel** par glisser quand il le faut.
- **Rôles** par colonne (date, description, débit/crédit/montant signé, solde, texte).
- **Format libre** par colonne (motifs de date et de nombre, style Excel) — WYSIWYG.
- **Règles d'exclusion** par contenu (sauter les en-têtes répétés, « TOTAUX », etc.).
- **Éditeur type tableur** pour corriger n'importe quelle cellule avant l'export — avec le
  **solde recalculé en direct** (rechercher-remplacer, ajouter/supprimer des lignes, coller depuis
  Excel, annuler/rétablir, recopie vers le bas, catégorisation assistée, indicateurs de qualité,
  solde d'ouverture/clôture éditable).
- **Modèles réutilisables** : marquez une banque une fois et la prochaine fois elle est reconnue
  toute seule. Le modèle stocke **où** se trouve chaque donnée, jamais **ce qu'**elle dit.
- Export en **CSV**, modèle **`.ext.json` / `.ext.yaml`** et transfert **« Envoyer à Escriba »**.

## 🧭 Comment ça marche

1. **Ouvrez** un PDF ou une image (ou cliquez « Voir un exemple »).
2. **Marquez les colonnes** sur le document : où se trouve chaque donnée. Le système détecte
   automatiquement ; vous affinez en glissant.
3. **Exportez** les mouvements (CSV) ou le modèle. La **règle du solde** confirme en vert que la
   lecture est correcte : `ouverture + crédits − débits == clôture`. Sans votes, 100% local.

## 🔒 Confidentialité par conception

Tout s'exécute dans votre navigateur —le PDF est ouvert, lu et traité dans votre machine— et il
n'y a **aucune requête externe** (polices et bibliothèques intégrées). La confidentialité n'est
pas une promesse : c'est l'architecture. Le modèle que vous partagez stocke la **forme** du
document (géométrie), jamais ses **données**.

## 🧩 La famille Escriba

Extracta est un satellite autonome de l'écosystème **[Escriba](https://github.com/diegoparras/escriba)**
(aux côtés de **[Fisherboy](https://github.com/diegoparras/fisherboy)**). Une fois un document
extrait, **« Envoyer à Escriba »** transmet le Markdown propre à votre Escriba local pour
l'anonymiser, le convertir (JSON/YAML/TOON), le découper pour le RAG ou le transformer en audio —
et le document ne quitte toujours pas votre machine.

## 🚀 Démarrage rapide

Ouvrez-le avec un serveur statique (nécessaire pour le worker de PDF.js) :

```bash
python -m http.server 5599
# → ouvrez http://localhost:5599  et chargez samples/banco-rio-cc.pdf
```

## 🏗️ Production (auto-hébergé)

Extracta inclut un **serveur léger** (`server.js`, Node/Express) qui ne fait que servir l'app
statique et un **login** optionnel depuis le `.env`. Le document est toujours traité à 100% dans
le navigateur ; le serveur ne le reçoit jamais, applique une CSP stricte + en-têtes de sécurité,
et n'expose jamais `.env`, `server.js` ni les PDF de `samples/private/`.

```bash
cp .env.example .env
node server.js --hash 'votre-mot-de-passe'   # → mettez le hash dans AUTH_PASSWORD
openssl rand -hex 32                          # → mettez ceci dans SESSION_SECRET
npm install && npm start                      # local → http://localhost:3000
# ou : docker compose up --build
```

Ou utilisez l'image publiée sur **GHCR** (`ghcr.io/diegoparras/extracta:latest`, construite par la
CI à chaque push sur `main`) et déployez-la sur **EasyPanel** avec les variables du `.env` dans le panneau.

> 📖 **Guide de déploiement complet** (Docker, EasyPanel, référence des variables, checklist de production) :
> [DEPLOY.fr.md](DEPLOY.fr.md).

## 📜 Licence

Copyright 2026 Diego Parras. **Apache-2.0** — voir [LICENSE](../../LICENSE).
