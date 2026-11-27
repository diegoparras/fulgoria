// API del estudio (/api/v1). Detrás de la misma puerta de login que el resto de la app.
// JSON en todas las respuestas; errores como { error, mensaje }.
"use strict";
const express = require("express");

const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[0-9a-f-]{36}$/i;
const TIPOS_DOC = new Set(["extracto", "mayor"]);
const TIPOS_PLANTILLA = new Set(["banco", "mayor"]);

const txt = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

function crearApi(p, { maxDocMB = 25, usuario = () => "local" } = {}) {
  const r = express.Router();
  const u = (req) => usuario(req);
  const mal = (res, status, mensaje, extra = {}) => res.status(status).json({ error: status, mensaje, ...extra });
  const idOk = (req, res, next) => { for (const k of ["id", "doc"]) if (req.params[k] && !ID_RE.test(req.params[k])) return mal(res, 400, "Identificador inválido."); next(); };

  r.get("/estado", (req, res) => res.json({ persistencia: true, almacenamiento: p.almacenamiento, cifrado: p.cifrado, usuario: u(req), maxDocMB }));

  // ---------------- clientes
  r.get("/clientes", (req, res) => res.json(p.clientes({ archivados: req.query.archivados === "1" })));
  r.post("/clientes", express.json({ limit: "64kb" }), (req, res) => {
    const nombre = txt(req.body?.nombre);
    if (!nombre) return mal(res, 400, "Falta el nombre del cliente.");
    res.status(201).json(p.crearCliente(u(req), { nombre, cuit: txt(req.body.cuit, 20), notas: txt(req.body.notas, 2000) }));
  });
  r.patch("/clientes/:id", idOk, express.json({ limit: "64kb" }), (req, res) => {
    const b = req.body || {};
    const c = p.editarCliente(u(req), req.params.id, { nombre: txt(b.nombre) ?? undefined, cuit: b.cuit === undefined ? undefined : txt(b.cuit, 20), notas: b.notas === undefined ? undefined : txt(b.notas, 2000), archivado: b.archivado });
    c ? res.json(c) : mal(res, 404, "No existe el cliente.");
  });

  // ---------------- cuentas
  r.get("/clientes/:id/cuentas", idOk, (req, res) => res.json(p.cuentas(req.params.id)));
  r.post("/clientes/:id/cuentas", idOk, express.json({ limit: "256kb" }), (req, res) => {
    const b = req.body || {};
    const nombre = txt(b.nombre);
    if (!nombre) return mal(res, 400, "Falta el nombre de la cuenta (p. ej. \"Cuenta corriente en pesos\").");
    const moneda = b.moneda === "USD" ? "USD" : "ARS";
    const c = p.crearCuenta(u(req), req.params.id, { nombre, banco: txt(b.banco), moneda, cbu: txt(b.cbu, 30), mandos: b.mandos || null });
    c ? res.status(201).json(c) : mal(res, 404, "No existe el cliente.");
  });
  r.patch("/cuentas/:id", idOk, express.json({ limit: "256kb" }), (req, res) => {
    const b = req.body || {};
    const c = p.editarCuenta(u(req), req.params.id, {
      ...(b.nombre !== undefined && { nombre: txt(b.nombre) }), ...(b.banco !== undefined && { banco: txt(b.banco) }),
      ...(b.moneda !== undefined && { moneda: b.moneda === "USD" ? "USD" : "ARS" }), ...(b.cbu !== undefined && { cbu: txt(b.cbu, 30) }),
      ...(b.mandos !== undefined && { mandos: b.mandos }),
    });
    c ? res.json(c) : mal(res, 404, "No existe la cuenta.");
  });

  // ---------------- períodos
  r.get("/cuentas/:id/periodos", idOk, (req, res) => res.json(p.periodos(req.params.id)));
  r.get("/cuentas/:id/periodos/:periodo", idOk, (req, res) => {
    if (!PERIODO_RE.test(req.params.periodo)) return mal(res, 400, "Período inválido (AAAA-MM).");
    if (!p.cuenta(req.params.id)) return mal(res, 404, "No existe la cuenta.");
    res.json(p.periodo(req.params.id, req.params.periodo));
  });
  r.put("/cuentas/:id/periodos/:periodo", idOk, express.json({ limit: "12mb" }), (req, res) => {
    if (!PERIODO_RE.test(req.params.periodo)) return mal(res, 400, "Período inválido (AAAA-MM).");
    const b = req.body || {};
    for (const k of ["extractoDoc", "mayorDoc"]) if (b[k] != null && (!ID_RE.test(b[k]) || !p.documento(b[k]))) return mal(res, 400, "Documento inexistente.");
    const out = p.guardarPeriodo(u(req), req.params.id, req.params.periodo, b);
    if (out.error) return mal(res, out.error, out.msg, out.actual ? { actual: out.actual } : {});
    res.json(out.periodo);
  });

  // ---------------- documentos (el archivo va como cuerpo crudo)
  r.post("/documentos", express.raw({ type: () => true, limit: `${maxDocMB}mb` }), async (req, res, next) => {
    try {
      const tipo = String(req.get("x-tipo") || "");
      if (!TIPOS_DOC.has(tipo)) return mal(res, 400, "x-tipo debe ser extracto o mayor.");
      if (!Buffer.isBuffer(req.body) || !req.body.length) return mal(res, 400, "Archivo vacío.");
      let nombre = "documento";
      try { nombre = decodeURIComponent(String(req.get("x-nombre") || "documento")).slice(0, 200); } catch {}
      const mime = String(req.get("content-type") || "application/octet-stream").slice(0, 100);
      res.status(201).json(await p.guardarDocumento(u(req), { tipo, nombre, mime, datos: req.body }));
    } catch (e) { next(e); }
  });
  r.get("/documentos/:doc", idOk, async (req, res, next) => {
    try {
      const d = await p.leerDocumento(req.params.doc);
      if (!d || !d.datos) return mal(res, 404, "No existe el documento.");
      res.setHeader("Content-Type", d.meta.mime || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(d.meta.nombre || "documento")}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(d.datos);
    } catch (e) { next(e); }
  });

  // ---------------- tablero, plantillas, auditoría
  r.get("/cartera", (req, res) => {
    const hasta = PERIODO_RE.test(String(req.query.hasta || "")) ? req.query.hasta : undefined;
    res.json(p.cartera({ hasta, n: Math.min(Math.max(Number(req.query.meses) || 6, 1), 24) }));
  });
  r.get("/plantillas", (req, res) => res.json(p.plantillas(TIPOS_PLANTILLA.has(req.query.tipo) ? req.query.tipo : null)));
  r.put("/plantillas", express.json({ limit: "1mb" }), (req, res) => {
    const b = req.body || {};
    if (!TIPOS_PLANTILLA.has(b.tipo)) return mal(res, 400, "tipo debe ser banco o mayor.");
    const nombre = txt(b.nombre, 120);
    if (!nombre || !b.plantilla || typeof b.plantilla !== "object") return mal(res, 400, "Faltan el nombre o la plantilla.");
    // Una plantilla describe FORMA, no datos: se rechaza algo que no lo sea.
    if (b.tipo === "mayor" && !b.plantilla.fulgoria_plantilla_mayor) return mal(res, 400, "No es una plantilla de mayor.");
    if (b.tipo === "banco" && !b.plantilla.geometry) return mal(res, 400, "No es una plantilla de banco.");
    res.json(p.guardarPlantilla(u(req), { tipo: b.tipo, nombre, plantilla: b.plantilla }));
  });
  r.delete("/plantillas/:id", idOk, (req, res) => (p.borrarPlantilla(u(req), req.params.id) ? res.status(204).end() : mal(res, 404, "No existe la plantilla.")));
  r.get("/eventos", (req, res) => res.json(p.eventos({ entidad: txt(req.query.entidad, 20), entidadId: txt(req.query.id, 40), limite: Number(req.query.limite) || 100 })));

  r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === "entity.too.large") return mal(res, 413, `El archivo supera el máximo de ${maxDocMB} MB.`);
    console.error("[fulgoria] api:", err.message);
    mal(res, 500, "Error interno. Revisá los registros del servidor.");
  });
  return r;
}

module.exports = { crearApi };
