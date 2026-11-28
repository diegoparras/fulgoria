// API del estudio (/api/v1). Detrás de la misma puerta de login que el resto de la app.
// JSON en todas las respuestas; errores como { error, mensaje }.
"use strict";
const express = require("express");
const { ROLES, permisosDe, puede } = require("./roles.js");
const { validarConfig, normalizarAjuste, PROVEEDORES, EXTERNOS } = require("./ia.js");

const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[0-9a-f-]{36}$/i;
const TIPOS_DOC = new Set(["extracto", "mayor"]);
const TIPOS_PLANTILLA = new Set(["banco", "mayor"]);
// Tipos de documento que se aceptan y se devuelven; cualquier otro se guarda como binario. Nunca se
// devuelve el Content-Type que mandó quien subió el archivo (podría ser text/javascript o text/html).
const MIMES_DOC = new Set(["application/pdf", "text/csv", "text/plain", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/png", "image/jpeg", "image/webp", "image/tiff"]);
const mimeDoc = (v) => { const m = String(v || "").split(";")[0].trim().toLowerCase(); return MIMES_DOC.has(m) ? m : "application/octet-stream"; };
const esObjeto = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** Mandos: objeto de secciones con valores simples (número, texto corto, sí/no), nada más. */
function mandosValidos(m, prof = 0) {
  if (m === null) return true;
  if (!esObjeto(m) || prof > 3) return false;
  return Object.values(m).every((v) => (esObjeto(v) ? mandosValidos(v, prof + 1) : typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || (typeof v === "string" && v.length <= 2000) || (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 200))));
}

const txt = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

/**
 * @param p persistencia
 * @param {{ maxDocMB?: number, usuario?: (req) => ({u: string, rol: string}|null), modoUsuarios?: "local"|"lockatus"|"sin_login" }} o
 */
function crearApi(p, { maxDocMB = 25, usuario = () => ({ u: "local", rol: "admin" }), modoUsuarios = "sin_login", ia = null } = {}) {
  const r = express.Router();
  const quien = (req) => usuario(req) || { u: "?", rol: "lector" };
  const u = (req) => quien(req).u;
  const mal = (res, status, mensaje, extra = {}) => res.status(status).json({ error: status, mensaje, ...extra });
  const TXT_PERMISO = { editar: "cargar o modificar", preparar: "marcar como preparado", revisar: "revisar, cerrar o reabrir", administrar: "administrar usuarios y la IA" };
  const exige = (permiso) => (req, res, next) => (puede(quien(req).rol, permiso) ? next() : mal(res, 403, `Tu rol (${quien(req).rol}) no permite ${TXT_PERMISO[permiso] || permiso}.`));
  const idOk = (req, res, next) => { for (const k of ["id", "doc"]) if (req.params[k] && !ID_RE.test(req.params[k])) return mal(res, 400, "Identificador inválido."); next(); };

  r.get("/estado", (req, res) => {
    const q = quien(req);
    res.json({ persistencia: true, almacenamiento: p.almacenamiento, cifrado: p.cifrado, usuario: q.u, rol: q.rol, permisos: permisosDe(q.rol), modoUsuarios, maxDocMB });
  });

  // ---------------- clientes
  r.get("/clientes", (req, res) => res.json(p.clientes({ archivados: req.query.archivados === "1" })));
  r.post("/clientes", exige("editar"), express.json({ limit: "64kb" }), (req, res) => {
    const nombre = txt(req.body?.nombre);
    if (!nombre) return mal(res, 400, "Falta el nombre del cliente.");
    res.status(201).json(p.crearCliente(u(req), { nombre, cuit: txt(req.body.cuit, 20), notas: txt(req.body.notas, 2000) }));
  });
  r.patch("/clientes/:id", idOk, exige("editar"), express.json({ limit: "64kb" }), (req, res) => {
    const b = req.body || {};
    const c = p.editarCliente(u(req), req.params.id, { nombre: txt(b.nombre) ?? undefined, cuit: b.cuit === undefined ? undefined : txt(b.cuit, 20), notas: b.notas === undefined ? undefined : txt(b.notas, 2000), archivado: b.archivado });
    c ? res.json(c) : mal(res, 404, "No existe el cliente.");
  });

  // ---------------- cuentas
  r.get("/clientes/:id/cuentas", idOk, (req, res) => res.json(p.cuentas(req.params.id)));
  r.post("/clientes/:id/cuentas", idOk, exige("editar"), express.json({ limit: "256kb" }), (req, res) => {
    const b = req.body || {};
    const nombre = txt(b.nombre);
    if (!nombre) return mal(res, 400, "Falta el nombre de la cuenta (p. ej. \"Cuenta corriente en pesos\").");
    const moneda = b.moneda === "USD" ? "USD" : "ARS";
    const c = p.crearCuenta(u(req), req.params.id, { nombre, banco: txt(b.banco), moneda, cbu: txt(b.cbu, 30), mandos: mandosValidos(b.mandos ?? null) ? b.mandos ?? null : null });
    c ? res.status(201).json(c) : mal(res, 404, "No existe el cliente.");
  });
  r.patch("/cuentas/:id", idOk, exige("editar"), express.json({ limit: "256kb" }), (req, res) => {
    const b = req.body || {};
    if (b.mandos !== undefined && !mandosValidos(b.mandos)) return mal(res, 400, "Mandos inválidos.");
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
    // Permiso según lo que se pide: guardar contenido, preparar, o revisar/cerrar/reabrir.
    const permiso = b.accion === "preparar" ? "preparar" : ["revisar", "cerrar", "reabrir"].includes(b.accion) ? "revisar" : "editar";
    if (!puede(quien(req).rol, permiso)) return mal(res, 403, `Tu rol (${quien(req).rol}) no permite ${TXT_PERMISO[permiso]}.`);
    for (const k of ["extractoDoc", "mayorDoc"]) if (b[k] != null && (!ID_RE.test(b[k]) || !p.documento(b[k]))) return mal(res, 400, "Documento inexistente.");
    if (b.resumen != null && !esObjeto(b.resumen)) return mal(res, 400, "Resumen inválido.");
    if (b.pendientes != null && !Array.isArray(b.pendientes)) return mal(res, 400, "Pendientes inválidos.");
    const out = p.guardarPeriodo(u(req), req.params.id, req.params.periodo, b);
    if (out.error) return mal(res, out.error, out.msg, out.actual ? { actual: out.actual } : {});
    res.json(out.periodo);
  });

  // ---------------- pedidos al cliente (link para que conteste qué es cada movimiento)
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const itemsValidos = (items) => Array.isArray(items) && items.length >= 1 && items.length <= 200 && items.every((x) =>
    esObjeto(x) && typeof x.clave === "string" && x.clave.length <= 200 && FECHA_RE.test(String(x.fecha)) &&
    typeof x.descripcion === "string" && x.descripcion.length <= 300 && Number.isInteger(x.cents));
  r.get("/cuentas/:id/periodos/:periodo/pedidos", idOk, (req, res) => {
    if (!PERIODO_RE.test(req.params.periodo)) return mal(res, 400, "Período inválido (AAAA-MM).");
    res.json(p.pedidos(req.params.id, req.params.periodo));
  });
  r.post("/cuentas/:id/periodos/:periodo/pedidos", idOk, exige("editar"), express.json({ limit: "128kb" }), (req, res) => {
    if (!PERIODO_RE.test(req.params.periodo)) return mal(res, 400, "Período inválido (AAAA-MM).");
    const b = req.body || {};
    if (!itemsValidos(b.items)) return mal(res, 400, "Partidas inválidas.");
    const dias = Math.min(Math.max(Number(b.dias) || 30, 1), 90);
    const items = b.items.map((x) => ({ clave: x.clave, fecha: x.fecha, descripcion: x.descripcion, cents: x.cents }));
    const out = p.crearPedido(u(req), { cuentaId: req.params.id, periodo: req.params.periodo, items, dias });
    out ? res.status(201).json({ id: out.id, url: `/r/${out.token}`, vence: out.vence }) : mal(res, 404, "No existe la cuenta.");
  });
  r.delete("/pedidos/:id", idOk, exige("editar"), (req, res) => {
    const out = p.anularPedido(u(req), req.params.id);
    out ? res.json(out) : mal(res, 404, "No existe el pedido.");
  });

  // ---------------- documentos (el archivo va como cuerpo crudo)
  r.post("/documentos", exige("editar"), express.raw({ type: () => true, limit: `${maxDocMB}mb` }), async (req, res, next) => {
    try {
      const tipo = String(req.get("x-tipo") || "");
      if (!TIPOS_DOC.has(tipo)) return mal(res, 400, "x-tipo debe ser extracto o mayor.");
      if (!Buffer.isBuffer(req.body) || !req.body.length) return mal(res, 400, "Archivo vacío.");
      let nombre = "documento";
      try { nombre = decodeURIComponent(String(req.get("x-nombre") || "documento")).slice(0, 200); } catch {}
      const mime = mimeDoc(req.get("content-type"));
      res.status(201).json(await p.guardarDocumento(u(req), { tipo, nombre, mime, datos: req.body }));
    } catch (e) { next(e); }
  });
  r.get("/documentos/:doc", idOk, async (req, res, next) => {
    try {
      const d = await p.leerDocumento(req.params.doc);
      if (!d || !d.datos) return mal(res, 404, "No existe el documento.");
      res.setHeader("Content-Type", mimeDoc(d.meta.mime)); // también para lo guardado antes de este control
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
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
  r.put("/plantillas", exige("editar"), express.json({ limit: "1mb" }), (req, res) => {
    const b = req.body || {};
    if (!TIPOS_PLANTILLA.has(b.tipo)) return mal(res, 400, "tipo debe ser banco o mayor.");
    const nombre = txt(b.nombre, 120);
    if (!nombre || !b.plantilla || typeof b.plantilla !== "object") return mal(res, 400, "Faltan el nombre o la plantilla.");
    // Una plantilla describe FORMA, no datos: se rechaza algo que no lo sea.
    if (b.tipo === "mayor" && !b.plantilla.fulgoria_plantilla_mayor) return mal(res, 400, "No es una plantilla de mayor.");
    if (b.tipo === "banco" && !b.plantilla.geometry) return mal(res, 400, "No es una plantilla de banco.");
    res.json(p.guardarPlantilla(u(req), { tipo: b.tipo, nombre, plantilla: b.plantilla }));
  });
  r.delete("/plantillas/:id", idOk, exige("revisar"), (req, res) => (p.borrarPlantilla(u(req), req.params.id) ? res.status(204).end() : mal(res, 404, "No existe la plantilla.")));
  r.get("/eventos", (req, res) => res.json(p.eventos({ entidad: txt(req.query.entidad, 20), entidadId: txt(req.query.id, 40), limite: Number(req.query.limite) || 100 })));

  // ---------------- IA (solo admin): sin IA, IA local o IA externa. Se guardan las dos configuraciones
  // (local y externa) y se elige cuál está activa. La clave de API va cifrada con DOCS_CLAVE y nunca
  // vuelve al navegador: solo sus últimos 4 caracteres, para reconocerla.
  if (ia) {
    const MODOS = ["ninguna", "local", "externa"];
    const guardado = () => normalizarAjuste(p.ajuste("ia"));
    const vistaIA = () => {
      const g = guardado(), a = ia.actual, env = ia.env;
      const envLocal = env?.proveedor === "local" ? env : null, envExt = env && env.proveedor !== "local" ? env : null;
      const L = g?.local || (envLocal ? { modelo: envLocal.modelo, url: envLocal.url, temperatura: null, desdeEnv: true } : null);
      const E = g?.externa || (envExt ? { proveedor: envExt.proveedor, modelo: envExt.modelo, url: envExt.url, temperatura: null, desdeEnv: true } : null);
      return {
        modo: g ? g.modo : a.disponible ? (a.proveedor === "local" ? "local" : "externa") : "ninguna",
        origen: g ? "panel" : env ? "env" : "ninguno",
        enUso: a.disponible ? { proveedor: a.proveedor, modelo: a.modelo, origen: a.origen } : null,
        error: a.error || null,
        local: L && { modelo: L.modelo || "", url: L.url || "", temperatura: L.temperatura ?? null, desdeEnv: !!L.desdeEnv },
        externa: E && { proveedor: E.proveedor, modelo: E.modelo || "", url: E.url || "", temperatura: E.temperatura ?? null, desdeEnv: !!E.desdeEnv,
          clave: E.claveFin ? `…${E.claveFin}` : (E.desdeEnv || !E.claveCifrada) && ia.claveEnv(E.proveedor) ? "la del .env" : null },
        maxPorHora: g?.maxPorHora ?? 30,
        env,
        proveedores: Object.fromEntries(EXTERNOS.map((k) => [k, { nombre: PROVEEDORES[k].nombre, url: PROVEEDORES[k].url || "", modelo: PROVEEDORES[k].modelo || "" }])),
        urlLocal: PROVEEDORES.local.url,
        puedeGuardarClave: p.puedeGuardarSecretos,
      };
    };
    const err400 = (m) => Object.assign(new Error(m), { status: 400 });
    // Lo pedido (modo + su sección) → config validada + clave (la nueva, la guardada o la del .env).
    const armarIA = (b = {}) => {
      const modo = String(b.modo || "");
      if (!MODOS.includes(modo)) throw err400("Elegí: sin IA, IA local o IA externa.");
      const maxPorHora = b.maxPorHora;
      if (modo === "ninguna") return { modo, maxPorHora: 30 };
      const g = guardado();
      if (modo === "local") {
        const cfg = validarConfig({ ...(b.local || {}), proveedor: "local", maxPorHora });
        return { modo, cfg, apiKey: "" };
      }
      const prov = String(b.externa?.proveedor || "").toLowerCase();
      if (!EXTERNOS.includes(prov)) throw err400("Elegí el proveedor de la IA externa.");
      const cfg = validarConfig({ ...(b.externa || {}), proveedor: prov, maxPorHora });
      const nueva = typeof b.externa?.apiKey === "string" ? b.externa.apiKey.trim().slice(0, 500) : "";
      const previa = g?.externa?.proveedor === prov && g.externa.claveCifrada ? g.externa : null;
      const apiKey = nueva || (previa ? p.descifrarSecreto(previa.claveCifrada) : ia.claveEnv(prov));
      if (!apiKey) throw err400(`Falta la clave de API de ${PROVEEDORES[prov].nombre}.`);
      return { modo, cfg, apiKey, nueva, previa };
    };
    const conIA = (fn) => async (req, res) => {
      let x;
      try { x = armarIA(req.body); } catch (e) { return mal(res, e.status || 400, e.message); }
      try { res.json(await fn(x, req)); } catch (e) { mal(res, e.status && e.status < 500 ? e.status : 502, e.message); }
    };
    const sinSecciones = ({ proveedor, maxPorHora, ...resto }) => resto; // lo propio de cada sección
    r.get("/ia/config", exige("administrar"), (req, res) => res.json(vistaIA()));
    r.put("/ia/config", exige("administrar"), express.json({ limit: "16kb" }), conIA(async ({ modo, cfg, apiKey, nueva, previa }, req) => {
      const g = guardado() || { local: null, externa: null };
      const out = { modo, local: g.local, externa: g.externa, maxPorHora: cfg?.maxPorHora ?? g.maxPorHora ?? 30 };
      if (modo === "local") { ia.crear({ ...cfg, apiKey }); out.local = sinSecciones(cfg); }
      if (modo === "externa") {
        ia.crear({ ...cfg, apiKey });
        let claveCifrada = previa?.claveCifrada || null, claveFin = previa?.claveFin || null;
        if (nueva) {
          if (!p.puedeGuardarSecretos) { const e = new Error("Para guardar una clave de API hace falta DOCS_CLAVE en el servidor."); e.status = 409; throw e; }
          claveCifrada = p.cifrarSecreto(nueva); claveFin = nueva.slice(-4);
        }
        out.externa = { ...sinSecciones(cfg), proveedor: cfg.proveedor, claveCifrada, claveFin }; // sin clave guardada: usa la del .env
      }
      p.guardarAjuste(u(req), "ia", out);
      p.evento(u(req), "configurar", "ia", null, { modo, proveedor: cfg?.proveedor || null, modelo: cfg?.modelo || null, claveNueva: !!nueva });
      ia.recargar();
      return vistaIA();
    }));
    r.delete("/ia/config", exige("administrar"), (req, res) => {
      p.guardarAjuste(u(req), "ia", null);
      p.evento(u(req), "configurar", "ia", null, { volverA: ".env" });
      ia.recargar();
      res.json(vistaIA());
    });
    // Probar y listar modelos con lo que está en el formulario, antes de guardar.
    const conModelo = (req, res, next) => {
      const b = req.body || {}, k = b.modo === "local" ? "local" : "externa";
      req.body = { ...b, [k]: { ...(b[k] || {}), modelo: b[k]?.modelo || "-" } };
      next();
    };
    const instancia = ({ modo, cfg, apiKey }) => {
      if (modo === "ninguna") throw err400("Con \"sin IA\" no hay nada que probar.");
      return ia.crear({ ...cfg, apiKey });
    };
    r.post("/ia/probar", exige("administrar"), express.json({ limit: "16kb" }), conIA((x) => instancia(x).probar()));
    r.post("/ia/modelos", exige("administrar"), express.json({ limit: "16kb" }), conModelo, conIA(async (x) => {
      const m = await instancia(x).listarModelos();
      return { modelos: [...new Set(m)].sort().slice(0, 1000) };
    }));
  }

  // ---------------- usuarios (solo modo standalone: en federado los administra Lockatus)
  if (modoUsuarios === "local") {
    r.get("/usuarios", exige("administrar"), (req, res) => res.json({ roles: ROLES, usuarios: p.usuarios() }));
    r.post("/usuarios", exige("administrar"), express.json({ limit: "16kb" }), (req, res) => {
      const b = req.body || {};
      const out = p.crearUsuario(u(req), { usuario: String(b.usuario || "").trim(), nombre: txt(b.nombre, 120), password: b.password, rol: b.rol });
      out.error ? mal(res, out.error, out.msg) : res.status(201).json(out.usuario);
    });
    r.patch("/usuarios/:usuario", exige("administrar"), express.json({ limit: "16kb" }), (req, res) => {
      const b = req.body || {};
      if (req.params.usuario === u(req) && (b.activo === false || (b.rol && b.rol !== "admin"))) return mal(res, 400, "No podés quitarte el acceso ni el rol de admin a vos mismo.");
      const out = p.editarUsuario(u(req), req.params.usuario, { ...(b.nombre !== undefined && { nombre: txt(b.nombre, 120) }), ...(b.password !== undefined && { password: b.password }), ...(b.rol !== undefined && { rol: b.rol }), ...(b.activo !== undefined && { activo: !!b.activo }) });
      out.error ? mal(res, out.error, out.msg) : res.json(out.usuario);
    });
  }

  r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === "entity.too.large") return mal(res, 413, `El archivo supera el máximo de ${maxDocMB} MB.`);
    console.error("[fulgoria] api:", err.message);
    mal(res, 500, "Error interno. Revisá los registros del servidor.");
  });
  return r;
}

module.exports = { crearApi };
