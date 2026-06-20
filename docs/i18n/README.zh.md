<div align="center">

# 📄 Extracta

**从任何文档中提取数据 —— 本地、精确、属于你。**

只需标记一次文档（银行对账单、发票、收据……）的列，此后 Extracta 便会自行读取同类型的每一份
文档，并输出干净的结构化数据（CSV）。它从银行对账单起步 —— **余额规则**在这里提供了别人无法
给予的确定性 —— 并可推广到任何表格型文档。一切都在**你的浏览器中**运行：文档永不离开你的设备。
[**Escriba**](https://github.com/diegoparras/escriba) 生态的一员。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-3b76d9.svg)](../../LICENSE)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fdiegoparras%2Fextracta-2496ED?logo=docker&logoColor=white)](https://github.com/diegoparras/extracta/pkgs/container/extracta)
![Self-hosted](https://img.shields.io/badge/self--hosted-✓-3b76d9.svg)
![100% 浏览器](https://img.shields.io/badge/处理-100%25%20浏览器-30d158.svg)

[English](../../README.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · **中文** · [日本語](README.ja.md)

</div>

---

## ✨ 功能

- **数字 PDF** 与**扫描件/图片**（使用 Tesseract.js 的本地 OCR，同样在浏览器中运行）。
- **多页**与**多账户**（同一 PDF 中的本币 + 美元 → 每个账户一张卡片）。
- 自动列检测（尽力而为）+ 需要时通过拖拽**手动标记**。
- 每列的**角色**（日期、描述、借/贷/带符号金额、余额、文本）。
- 每列的**自由格式**（日期与数字模式，Excel 风格）—— 所见即所得。
- 按内容的**排除规则**（跳过重复表头、"合计"等）。
- **类电子表格编辑器**，在导出前修正任意单元格 —— 并**实时重算余额**（查找替换、增删行、
  从 Excel 粘贴、撤销/重做、向下填充、辅助分类、质量标记、可编辑的期初/期末余额）。
- **可复用模板**：标记一次某银行，下次便会被自动识别。模板只保存每个数据**在哪里**，
  而绝不保存它**是什么**。
- 导出为 **CSV**、模板 **`.ext.json` / `.ext.yaml`**，以及 **"发送到 Escriba"** 交接。

## 🧭 工作原理

1. **打开**一个 PDF 或图片（或点击"查看示例"）。
2. 在文档上**标记列**：每个数据在哪里。系统会自动检测；你通过拖拽来微调。
3. **导出**流水（CSV）或模板。**余额规则**会以绿色确认读取无误：
   `期初 + 贷方 − 借方 == 期末`。无需投票，完全本地。

## 🔒 隐私即架构

一切都在你的浏览器中运行 —— PDF 在你的设备内被打开、读取与处理 —— 并且**没有任何外部请求**
（字体与库均已内置）。隐私不是承诺，而是架构本身。你分享的模板保存的是文档的**形状**（几何），
绝不是它的**数据**。

## 🧩 Escriba 家族

Extracta 是 **[Escriba](https://github.com/diegoparras/escriba)** 生态中的一个独立卫星
（与 **[Fisherboy](https://github.com/diegoparras/fisherboy)** 并列）。提取完一份文档后，
**"发送到 Escriba"** 会把干净的 Markdown 交给你本地的 Escriba 进行匿名化、转换
（JSON/YAML/TOON）、为 RAG 切块或转为音频 —— 而文档依旧不会离开你的设备。

## 🚀 快速开始

用静态服务器打开（PDF.js 的 worker 需要它）：

```bash
python -m http.server 5599
# → 打开 http://localhost:5599 并加载 samples/banco-rio-cc.pdf
```

## 🏗️ 生产部署（自托管）

Extracta 自带一个**轻量服务器**（`server.js`，Node/Express），仅负责提供静态应用以及来自 `.env`
的可选**登录**。文档仍 100% 在浏览器中处理；服务器永远不会收到它，会应用严格的 CSP + 安全头，
并且绝不暴露 `.env`、`server.js` 或 `samples/private/` 中的 PDF。

```bash
cp .env.example .env
node server.js --hash '你的密码'    # → 把哈希填入 AUTH_PASSWORD
openssl rand -hex 32                # → 把它填入 SESSION_SECRET
npm install && npm start            # 本地 → http://localhost:3000
# 或：docker compose up --build
```

或使用发布到 **GHCR** 的镜像（`ghcr.io/diegoparras/extracta:latest`，由 CI 在每次推送到 `main`
时构建），并在 **EasyPanel** 上部署，把 `.env` 变量填入面板。

> 📖 **完整部署指南**（Docker、EasyPanel、环境变量参考、上线检查清单）：
> [DEPLOY.zh.md](DEPLOY.zh.md)。

## 📜 许可证

版权所有 2026 Diego Parras。**Apache-2.0** —— 见 [LICENSE](../../LICENSE)。
