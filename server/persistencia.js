// Persistencia del estudio: metadatos en SQLite (node:sqlite, sin dependencias nativas) y
// documentos en disco o en un bucket S3/R2 (ver blobs.js). Una instalación = un estudio.
//
// Lo que se guarda: clientes, cuentas bancarias, períodos (mes) de cada cuenta con sus documentos,
// decisiones del usuario, resultado de la conciliación, pendientes para el mes siguiente y estado
// (borrador → preparado → revisado → cerrado), plantillas compartidas y un registro de auditoría.
// El procesamiento (lectura del PDF, conciliación) sigue en el navegador: el servidor guarda.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// node:sqlite emite un aviso de "experimental" en Node 22; no aporta nada en los registros.
const _emit = process.emitWarning;
process.emitWarning = function (w, ...a) { if (String(w && w.message || w).includes("SQLite")) return; return _emit.call(process, w, ...a); };
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = _emit;

const { crearBlobs, claveDesde, cifrar, descifrar } = require("./blobs.js");
const { ROLES } = require("./roles.js");
const bcrypt = require("bcryptjs");

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, cuit TEXT, notas TEXT, archivado INTEGER NOT NULL DEFAULT 0,
  creado TEXT, actualizado TEXT);
CREATE TABLE IF NOT EXISTS cuentas (
  id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL, banco TEXT, moneda TEXT NOT NULL DEFAULT 'ARS', cbu TEXT, mandos TEXT,
  creado TEXT, actualizado TEXT);
CREATE TABLE IF NOT EXISTS documentos (
  id TEXT PRIMARY KEY, tipo TEXT, nombre TEXT, mime TEXT, bytes INTEGER, sha256 TEXT, clave TEXT,
  subido_por TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS periodos (
  id TEXT PRIMARY KEY, cuenta_id TEXT NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  periodo TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'borrador', version INTEGER NOT NULL DEFAULT 1,
  extracto_doc TEXT, mayor_doc TEXT, segmento INTEGER NOT NULL DEFAULT 0,
  decisiones TEXT, resumen TEXT, pendientes TEXT, resultado TEXT,
  preparo TEXT, preparo_en TEXT, reviso TEXT, reviso_en TEXT, cerro TEXT, cerro_en TEXT,
  actualizado TEXT, actualizado_por TEXT, UNIQUE (cuenta_id, periodo));
CREATE TABLE IF NOT EXISTS plantillas (
  id TEXT PRIMARY KEY, tipo TEXT NOT NULL, nombre TEXT NOT NULL, json TEXT NOT NULL,
  actualizado TEXT, actualizado_por TEXT, UNIQUE (tipo, nombre));
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, usuario TEXT, accion TEXT, entidad TEXT,
  entidad_id TEXT, detalle TEXT);
CREATE TABLE IF NOT EXISTS usuarios (
  usuario TEXT PRIMARY KEY, nombre TEXT, hash TEXT NOT NULL, rol TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT, actualizado TEXT);
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, cuenta_id TEXT NOT NULL, periodo TEXT NOT NULL,
  items TEXT NOT NULL, respuestas TEXT, creado TEXT, creado_por TEXT, vence TEXT, anulado INTEGER NOT NULL DEFAULT 0,
  respondido TEXT);
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY, valor TEXT, actualizado TEXT, por TEXT);
CREATE INDEX IF NOT EXISTS ix_cuentas_cliente ON cuentas(cliente_id);
CREATE INDEX IF NOT EXISTS ix_periodos_cuenta ON periodos(cuenta_id, periodo);
CREATE INDEX IF NOT EXISTS ix_eventos_entidad ON eventos(entidad, entidad_id);
`;

const ahora = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const J = (s) => (s == null ? null : JSON.parse(s));

/** Mes anterior de "AAAA-MM". */
function mesAnterior(p) { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; }
function meses(hasta, n) { const out = [hasta]; while (out.length < n) out.unshift(mesAnterior(out[0])); return out; }

function crearPersistencia({ dataDir, almacenamiento = "disco", s3 = {}, clave, backupHoras = 24, revisionIndependiente = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "fulgoria.sqlite"));
  db.exec(ESQUEMA);
  const blobs = crearBlobs({ almacenamiento, dataDir, s3, clave });
  const claveSecretos = claveDesde(clave); // la misma DOCS_CLAVE cifra las claves de API guardadas
  const q = (sql) => db.prepare(sql);

  const evento = (usuario, accion, entidad, entidadId, detalle) =>
    q("INSERT INTO eventos (fecha, usuario, accion, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ahora(), usuario, accion, entidad, entidadId, detalle == null ? null : JSON.stringify(detalle));

  const filaPeriodo = (r) => r && ({
    id: r.id, cuentaId: r.cuenta_id, periodo: r.periodo, estado: r.estado, version: r.version,
    extractoDoc: r.extracto_doc, mayorDoc: r.mayor_doc, segmento: r.segmento,
    decisiones: J(r.decisiones), resumen: J(r.resumen), pendientes: J(r.pendientes), resultado: J(r.resultado),
    preparo: r.preparo, preparoEn: r.preparo_en, reviso: r.reviso, revisoEn: r.reviso_en, cerro: r.cerro, cerroEn: r.cerro_en,
    actualizado: r.actualizado, actualizadoPor: r.actualizado_por,
  });

  const api = {
    almacenamiento: blobs.tipo, cifrado: blobs.cifrado, evento,

    // ---------------- ajustes del estudio (p. ej. la IA). Los secretos van cifrados con DOCS_CLAVE.
    ajuste(k) { const r = q("SELECT valor FROM ajustes WHERE clave = ?").get(k); return r ? J(r.valor) : null; },
    guardarAjuste(u, k, valor) {
      if (valor == null) q("DELETE FROM ajustes WHERE clave = ?").run(k);
      else q("INSERT INTO ajustes (clave, valor, actualizado, por) VALUES (?, ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado, por = excluded.por").run(k, JSON.stringify(valor), ahora(), u);
    },
    puedeGuardarSecretos: !!claveSecretos,
    cifrarSecreto(txt) {
      if (!claveSecretos) throw new Error("Para guardar una clave de API hace falta DOCS_CLAVE en el servidor.");
      return cifrar(claveSecretos, Buffer.from(String(txt), "utf8")).toString("base64");
    },
    descifrarSecreto(b64) { return b64 && claveSecretos ? descifrar(claveSecretos, Buffer.from(b64, "base64")).toString("utf8") : ""; },

    // ---------------- pedidos al cliente: un link (token) para que el cliente conteste qué es cada
    // movimiento. En la base queda solo el hash del token: el link no se puede reconstruir desde acá.
    crearPedido(u, { cuentaId, periodo, items, dias = 30 }) {
      if (!api.cuenta(cuentaId)) return null;
      const id = uid(), token = crypto.randomBytes(32).toString("base64url"), t = ahora();
      const vence = new Date(Date.now() + dias * 86400e3).toISOString();
      q("INSERT INTO pedidos (id, token_hash, cuenta_id, periodo, items, respuestas, creado, creado_por, vence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, hashToken(token), cuentaId, periodo, JSON.stringify(items), "{}", t, u, vence);
      evento(u, "crear", "pedido", id, { cuentaId, periodo, items: items.length });
      return { id, token, vence };
    },
    pedidos(cuentaId, periodo) {
      return q("SELECT * FROM pedidos WHERE cuenta_id = ? AND periodo = ? ORDER BY creado DESC").all(cuentaId, periodo).map(filaPedido);
    },
    /** Para el cliente (sin login): solo si el link existe, no venció y no se anuló. */
    pedidoPublico(token) {
      const r = q("SELECT * FROM pedidos WHERE token_hash = ?").get(hashToken(token));
      if (!r || r.anulado || r.vence < ahora()) return null;
      const cu = q("SELECT c.nombre AS cuenta, c.banco, k.nombre AS cliente FROM cuentas c JOIN clientes k ON k.id = c.cliente_id WHERE c.id = ?").get(r.cuenta_id) || {};
      const p = filaPedido(r);
      return { id: p.id, cliente: cu.cliente || "", cuenta: cu.cuenta || "", banco: cu.banco || "", periodo: p.periodo, items: p.items, respuestas: p.respuestas, vence: p.vence };
    },
    responderPedido(token, respuestas) {
      const r = q("SELECT * FROM pedidos WHERE token_hash = ?").get(hashToken(token));
      if (!r || r.anulado || r.vence < ahora()) return null;
      const claves = new Set(J(r.items).map((i) => i.clave)), actuales = J(r.respuestas) || {}, t = ahora();
      for (const [k, v] of Object.entries(respuestas || {})) {
        if (!claves.has(k)) continue;
        const texto = String(v ?? "").trim().slice(0, 2000);
        if (texto) actuales[k] = { texto, fecha: t }; else delete actuales[k];
      }
      q("UPDATE pedidos SET respuestas = ?, respondido = ? WHERE id = ?").run(JSON.stringify(actuales), t, r.id);
      evento("cliente", "responder", "pedido", r.id, { respuestas: Object.keys(actuales).length });
      return api.pedidoPublico(token);
    },
    anularPedido(u, id) {
      const r = q("SELECT * FROM pedidos WHERE id = ?").get(id);
      if (!r) return null;
      q("UPDATE pedidos SET anulado = 1 WHERE id = ?").run(id);
      evento(u, "anular", "pedido", id, null);
      return filaPedido({ ...r, anulado: 1 });
    },

    // ---------------- clientes y cuentas
    clientes({ archivados = false } = {}) {
      return q(`SELECT * FROM clientes ${archivados ? "" : "WHERE archivado = 0"} ORDER BY nombre COLLATE NOCASE`).all()
        .map((c) => ({ id: c.id, nombre: c.nombre, cuit: c.cuit, notas: c.notas, archivado: !!c.archivado }));
    },
    crearCliente(u, { nombre, cuit = null, notas = null }) {
      const id = uid(), t = ahora();
      q("INSERT INTO clientes (id, nombre, cuit, notas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?)").run(id, nombre, cuit, notas, t, t);
      evento(u, "crear", "cliente", id, { nombre });
      return { id, nombre, cuit, notas, archivado: false };
    },
    editarCliente(u, id, campos) {
      const c = q("SELECT * FROM clientes WHERE id = ?").get(id);
      if (!c) return null;
      const n = { nombre: campos.nombre ?? c.nombre, cuit: campos.cuit ?? c.cuit, notas: campos.notas ?? c.notas, archivado: campos.archivado == null ? c.archivado : campos.archivado ? 1 : 0 };
      q("UPDATE clientes SET nombre = ?, cuit = ?, notas = ?, archivado = ?, actualizado = ? WHERE id = ?").run(n.nombre, n.cuit, n.notas, n.archivado, ahora(), id);
      evento(u, "editar", "cliente", id, campos);
      return { id, ...n, archivado: !!n.archivado };
    },
    cuentas(clienteId) {
      return q("SELECT * FROM cuentas WHERE cliente_id = ? ORDER BY nombre COLLATE NOCASE").all(clienteId).map(filaCuenta);
    },
    cuenta(id) { return filaCuenta(q("SELECT * FROM cuentas WHERE id = ?").get(id)); },
    crearCuenta(u, clienteId, { nombre, banco = null, moneda = "ARS", cbu = null, mandos = null }) {
      if (!q("SELECT 1 FROM clientes WHERE id = ?").get(clienteId)) return null;
      const id = uid(), t = ahora();
      q("INSERT INTO cuentas (id, cliente_id, nombre, banco, moneda, cbu, mandos, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, clienteId, nombre, banco, moneda, cbu, mandos ? JSON.stringify(mandos) : null, t, t);
      evento(u, "crear", "cuenta", id, { clienteId, nombre, banco, moneda });
      return api.cuenta(id);
    },
    editarCuenta(u, id, campos) {
      const c = q("SELECT * FROM cuentas WHERE id = ?").get(id);
      if (!c) return null;
      q("UPDATE cuentas SET nombre = ?, banco = ?, moneda = ?, cbu = ?, mandos = ?, actualizado = ? WHERE id = ?").run(
        campos.nombre ?? c.nombre, campos.banco ?? c.banco, campos.moneda ?? c.moneda, campos.cbu ?? c.cbu,
        campos.mandos !== undefined ? JSON.stringify(campos.mandos) : c.mandos, ahora(), id);
      evento(u, "editar", "cuenta", id, Object.keys(campos));
      return api.cuenta(id);
    },

    // ---------------- documentos
    async guardarDocumento(u, { tipo, nombre, mime, datos }) {
      const sha = crypto.createHash("sha256").update(datos).digest("hex");
      const igual = q("SELECT * FROM documentos WHERE sha256 = ? AND tipo = ?").get(sha, tipo);
      if (igual) return filaDoc(igual); // el mismo archivo ya está guardado: no se duplica
      const id = uid(), t = ahora();
      const clave = `documentos/${t.slice(0, 7)}/${id}`;
      await blobs.guardar(clave, datos);
      q("INSERT INTO documentos (id, tipo, nombre, mime, bytes, sha256, clave, subido_por, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, tipo, nombre, mime, datos.length, sha, clave, u, t);
      evento(u, "subir", "documento", id, { tipo, nombre, bytes: datos.length });
      return filaDoc(q("SELECT * FROM documentos WHERE id = ?").get(id));
    },
    documento(id) { return filaDoc(q("SELECT * FROM documentos WHERE id = ?").get(id)); },
    async leerDocumento(id) {
      const d = q("SELECT * FROM documentos WHERE id = ?").get(id);
      if (!d) return null;
      return { meta: filaDoc(d), datos: await blobs.leer(d.clave) };
    },

    // ---------------- períodos
    periodos(cuentaId) {
      return q("SELECT * FROM periodos WHERE cuenta_id = ? ORDER BY periodo DESC").all(cuentaId).map((r) => {
        const p = filaPeriodo(r);
        return { periodo: p.periodo, estado: p.estado, resumen: p.resumen, preparo: p.preparo, reviso: p.reviso, actualizado: p.actualizado };
      });
    },
    /** Período con lo necesario para abrirlo, incluidos los pendientes del mes anterior (arrastre). */
    periodo(cuentaId, periodo) {
      const p = filaPeriodo(q("SELECT * FROM periodos WHERE cuenta_id = ? AND periodo = ?").get(cuentaId, periodo));
      const ant = filaPeriodo(q("SELECT * FROM periodos WHERE cuenta_id = ? AND periodo = ?").get(cuentaId, mesAnterior(periodo)));
      return {
        periodo: p || null, // null si todavía no se empezó
        anterior: ant ? { periodo: ant.periodo, estado: ant.estado, pendientes: ant.pendientes || [], saldos: ant.resumen?.saldos || null } : null,
      };
    },
    /**
     * Guarda un período. Control de concurrencia optimista (version). Transiciones de estado:
     * preparar → revisar → cerrar (solo con diferencia no explicada = 0) y reabrir. Un período
     * cerrado no se modifica. Si cambian los documentos o las decisiones de un período preparado o
     * revisado, vuelve a borrador (lo que se revisó ya no es lo que hay).
     */
    guardarPeriodo(u, cuentaId, periodo, body) {
      if (!q("SELECT 1 FROM cuentas WHERE id = ?").get(cuentaId)) return { error: 404, msg: "No existe la cuenta." };
      const fila = q("SELECT * FROM periodos WHERE cuenta_id = ? AND periodo = ?").get(cuentaId, periodo);
      const p = filaPeriodo(fila);
      if (p && body.version !== p.version) return { error: 409, msg: "Otra persona guardó cambios en este mes. Volvé a abrirlo.", actual: p };
      const accion = body.accion || null;
      if (p && p.estado === "cerrado" && accion !== "reabrir") return { error: 423, msg: "El mes está cerrado. Reabrilo para modificarlo." };

      const n = p ? { ...p } : { id: uid(), cuentaId, periodo, estado: "borrador", version: 0, segmento: 0 };
      const cambiaContenido = (k) => body[k] !== undefined && JSON.stringify(body[k]) !== JSON.stringify(n[k]);
      const contenidoCambio = ["extractoDoc", "mayorDoc", "segmento", "decisiones"].some(cambiaContenido);
      for (const k of ["extractoDoc", "mayorDoc", "segmento", "decisiones", "resumen", "pendientes", "resultado"]) if (body[k] !== undefined) n[k] = body[k];
      const t = ahora();
      if (contenidoCambio && (n.estado === "preparado" || n.estado === "revisado")) {
        n.estado = "borrador"; n.preparo = n.preparoEn = n.reviso = n.revisoEn = null;
        evento(u, "invalidar_revision", "periodo", n.id, { periodo });
      }
      const dif = n.resumen?.diferenciaNoExplicada;
      if (accion === "preparar") {
        if (!n.extractoDoc || !n.mayorDoc) return { error: 422, msg: "Faltan el extracto o el mayor." };
        n.estado = "preparado"; n.preparo = u; n.preparoEn = t;
      } else if (accion === "revisar") {
        if (n.estado !== "preparado") return { error: 422, msg: "Primero hay que marcarlo como preparado." };
        if (revisionIndependiente && n.preparo === u) return { error: 403, msg: "Lo tiene que revisar otra persona: vos lo preparaste." };
        n.estado = "revisado"; n.reviso = u; n.revisoEn = t;
      } else if (accion === "cerrar") {
        if (n.estado !== "revisado") return { error: 422, msg: "Solo se cierra un mes revisado." };
        if (dif !== 0) return { error: 422, msg: "No se puede cerrar con diferencia no explicada." };
        n.estado = "cerrado"; n.cerro = u; n.cerroEn = t;
      } else if (accion === "reabrir") {
        if (n.estado !== "cerrado") return { error: 422, msg: "El mes no está cerrado." };
        n.estado = "borrador"; n.preparo = n.preparoEn = n.reviso = n.revisoEn = n.cerro = n.cerroEn = null;
      } else if (accion) return { error: 400, msg: "Acción desconocida." };
      n.version = (n.version || 0) + 1;
      const s = (v) => (v == null ? null : JSON.stringify(v));
      q(`INSERT INTO periodos (id, cuenta_id, periodo, estado, version, extracto_doc, mayor_doc, segmento, decisiones, resumen, pendientes, resultado,
           preparo, preparo_en, reviso, reviso_en, cerro, cerro_en, actualizado, actualizado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (cuenta_id, periodo) DO UPDATE SET estado = excluded.estado, version = excluded.version,
           extracto_doc = excluded.extracto_doc, mayor_doc = excluded.mayor_doc, segmento = excluded.segmento,
           decisiones = excluded.decisiones, resumen = excluded.resumen, pendientes = excluded.pendientes, resultado = excluded.resultado,
           preparo = excluded.preparo, preparo_en = excluded.preparo_en, reviso = excluded.reviso, reviso_en = excluded.reviso_en,
           cerro = excluded.cerro, cerro_en = excluded.cerro_en, actualizado = excluded.actualizado, actualizado_por = excluded.actualizado_por`)
        .run(n.id, cuentaId, periodo, n.estado, n.version, n.extractoDoc ?? null, n.mayorDoc ?? null, n.segmento ?? 0,
          s(n.decisiones), s(n.resumen), s(n.pendientes), s(n.resultado),
          n.preparo ?? null, n.preparoEn ?? null, n.reviso ?? null, n.revisoEn ?? null, n.cerro ?? null, n.cerroEn ?? null, t, u);
      if (accion || !p || contenidoCambio) evento(u, accion || (p ? "editar" : "crear"), "periodo", n.id, { cuentaId, periodo, estado: n.estado });
      return { periodo: filaPeriodo(q("SELECT * FROM periodos WHERE id = ?").get(n.id)) };
    },

    // ---------------- tablero de cartera
    cartera({ hasta, n = 6 } = {}) {
      const ms = meses(hasta || ahora().slice(0, 7), n);
      const per = q("SELECT cuenta_id, periodo, estado, resumen FROM periodos WHERE periodo >= ? AND periodo <= ?").all(ms[0], ms[ms.length - 1]);
      const porCuenta = new Map();
      for (const r of per) {
        const res = J(r.resumen) || {};
        if (!porCuenta.has(r.cuenta_id)) porCuenta.set(r.cuenta_id, {});
        porCuenta.get(r.cuenta_id)[r.periodo] = { estado: r.estado, semaforo: ["verde", "amarillo", "rojo"].includes(res.estado) ? res.estado : null, diferencia: res.diferenciaNoExplicada ?? null, atencion: res.atencion ?? null };
      }
      return {
        meses: ms,
        clientes: api.clientes().map((c) => ({ ...c, cuentas: api.cuentas(c.id).map((cu) => ({ ...cu, periodos: porCuenta.get(cu.id) || {} })) })),
      };
    },

    // ---------------- plantillas compartidas (banco = Extractor, mayor = Conciliar)
    plantillas(tipo) {
      return q(`SELECT * FROM plantillas ${tipo ? "WHERE tipo = ?" : ""} ORDER BY nombre COLLATE NOCASE`).all(...(tipo ? [tipo] : []))
        .map((p) => ({ id: p.id, tipo: p.tipo, nombre: p.nombre, plantilla: J(p.json), actualizado: p.actualizado, actualizadoPor: p.actualizado_por }));
    },
    guardarPlantilla(u, { tipo, nombre, plantilla }) {
      const t = ahora(), ex = q("SELECT id FROM plantillas WHERE tipo = ? AND nombre = ?").get(tipo, nombre);
      const id = ex ? ex.id : uid();
      q(`INSERT INTO plantillas (id, tipo, nombre, json, actualizado, actualizado_por) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (tipo, nombre) DO UPDATE SET json = excluded.json, actualizado = excluded.actualizado, actualizado_por = excluded.actualizado_por`)
        .run(id, tipo, nombre, JSON.stringify(plantilla), t, u);
      evento(u, ex ? "editar" : "crear", "plantilla", id, { tipo, nombre });
      return { id, tipo, nombre };
    },
    borrarPlantilla(u, id) {
      const r = q("DELETE FROM plantillas WHERE id = ?").run(id);
      if (r.changes) evento(u, "borrar", "plantilla", id, null);
      return r.changes > 0;
    },

    // ---------------- usuarios (modo standalone; en federado los maneja Lockatus)
    usuarios() {
      return q("SELECT usuario, nombre, rol, activo, creado, actualizado FROM usuarios ORDER BY usuario").all()
        .map((x) => ({ usuario: x.usuario, nombre: x.nombre, rol: x.rol, activo: !!x.activo, creado: x.creado }));
    },
    usuario(usuario) {
      const x = q("SELECT usuario, nombre, rol, activo FROM usuarios WHERE usuario = ?").get(String(usuario || ""));
      return x && { usuario: x.usuario, nombre: x.nombre, rol: x.rol, activo: !!x.activo };
    },
    /** Usuario activo con esa contraseña → { usuario, rol }; si no, null. */
    verificarUsuario(usuario, password) {
      const x = q("SELECT * FROM usuarios WHERE usuario = ?").get(String(usuario || ""));
      if (!x || !x.activo || !bcrypt.compareSync(String(password || ""), x.hash)) return null;
      return { usuario: x.usuario, rol: x.rol };
    },
    crearUsuario(u, { usuario, nombre = null, password, rol }) {
      if (!/^[a-zA-Z0-9._@-]{2,60}$/.test(usuario || "")) return { error: 400, msg: "Usuario inválido (letras, números, punto, guion, arroba)." };
      if (!ROLES.includes(rol)) return { error: 400, msg: "Rol inválido." };
      if (String(password || "").length < 10) return { error: 400, msg: "La contraseña tiene que tener al menos 10 caracteres." };
      if (q("SELECT 1 FROM usuarios WHERE usuario = ?").get(usuario)) return { error: 409, msg: "Ese usuario ya existe." };
      const t = ahora();
      q("INSERT INTO usuarios (usuario, nombre, hash, rol, activo, creado, actualizado) VALUES (?, ?, ?, ?, 1, ?, ?)").run(usuario, nombre, bcrypt.hashSync(password, 12), rol, t, t);
      evento(u, "crear", "usuario", usuario, { rol });
      return { usuario: api.usuario(usuario) };
    },
    editarUsuario(u, usuario, { nombre, password, rol, activo }) {
      const x = q("SELECT * FROM usuarios WHERE usuario = ?").get(usuario);
      if (!x) return { error: 404, msg: "No existe el usuario." };
      if (rol !== undefined && !ROLES.includes(rol)) return { error: 400, msg: "Rol inválido." };
      if (password !== undefined && String(password).length < 10) return { error: 400, msg: "La contraseña tiene que tener al menos 10 caracteres." };
      q("UPDATE usuarios SET nombre = ?, hash = ?, rol = ?, activo = ?, actualizado = ? WHERE usuario = ?").run(
        nombre === undefined ? x.nombre : nombre, password === undefined ? x.hash : bcrypt.hashSync(password, 12),
        rol === undefined ? x.rol : rol, activo === undefined ? x.activo : activo ? 1 : 0, ahora(), usuario);
      evento(u, "editar", "usuario", usuario, { ...(rol !== undefined && { rol }), ...(activo !== undefined && { activo }), ...(password !== undefined && { password: "cambiada" }) });
      return { usuario: api.usuario(usuario) };
    },

    eventos({ entidad, entidadId, limite = 100 } = {}) {
      const where = entidad ? (entidadId ? "WHERE entidad = ? AND entidad_id = ?" : "WHERE entidad = ?") : "";
      const args = entidad ? (entidadId ? [entidad, entidadId] : [entidad]) : [];
      return q(`SELECT * FROM eventos ${where} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(limite, 1000))
        .map((e) => ({ fecha: e.fecha, usuario: e.usuario, accion: e.accion, entidad: e.entidad, entidadId: e.entidad_id, detalle: J(e.detalle) }));
    },

    // ---------------- copias de seguridad de la base (al mismo almacenamiento de los documentos)
    async backup() {
      const tmp = path.join(dataDir, `.backup-${Date.now()}.sqlite`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const datos = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      const clave = `backups/fulgoria-${ahora().replace(/[:.]/g, "-")}.sqlite`;
      await blobs.guardar(clave, datos);
      return { clave, bytes: datos.length };
    },
    async copias() { return (await blobs.listar("backups/")).filter((k) => k.endsWith(".sqlite")); },
    /**
     * Restaura una copia (clave "backups/…" del almacenamiento, o la ruta de un archivo .sqlite).
     * Verifica que sea una base de Fulgoria, guarda la actual como fulgoria.sqlite.antes-<fecha> y la
     * reemplaza. Deja esta instancia cerrada: hay que reiniciar el servidor.
     */
    async restaurar(origen) {
      const datos = String(origen).startsWith("backups/") ? await blobs.leer(origen) : fs.existsSync(origen) ? fs.readFileSync(origen) : null;
      if (!datos) throw new Error(`No encontré la copia ${origen}.`);
      if (datos.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") throw new Error("Eso no es una base SQLite (¿DOCS_CLAVE distinta de la que la cifró?).");
      const tmp = path.join(dataDir, `.restaurar-${Date.now()}.sqlite`);
      fs.writeFileSync(tmp, datos);
      try {
        const prueba = new DatabaseSync(tmp, { readOnly: true });
        const tablas = prueba.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
        const cuantos = tablas.includes("periodos") ? prueba.prepare("SELECT COUNT(*) AS n FROM periodos").get().n : null;
        prueba.close();
        if (!["clientes", "cuentas", "periodos"].every((t) => tablas.includes(t))) throw new Error("La copia no tiene las tablas de Fulgoria.");
        clearInterval(api._timer); db.close();
        const actual = path.join(dataDir, "fulgoria.sqlite"), antes = `${actual}.antes-${ahora().replace(/[:.]/g, "-")}`;
        for (const ext of ["-wal", "-shm"]) if (fs.existsSync(actual + ext)) fs.unlinkSync(actual + ext);
        fs.renameSync(actual, antes);
        fs.renameSync(tmp, actual);
        return { restaurada: origen, anterior: antes, meses: cuantos };
      } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    },
    cerrar() { clearInterval(api._timer); try { db.close(); } catch {} },
  };
  if (backupHoras > 0) {
    api._timer = setInterval(() => api.backup().then((b) => console.log(`[fulgoria] copia de la base: ${b.clave}`)).catch((e) => console.error("[fulgoria] copia de la base falló:", e.message)), backupHoras * 3600 * 1000);
    api._timer.unref();
  }
  return api;
}

const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
function filaPedido(r) {
  const items = JSON.parse(r.items), respuestas = JSON.parse(r.respuestas || "{}");
  return { id: r.id, cuentaId: r.cuenta_id, periodo: r.periodo, items, respuestas, creado: r.creado, creadoPor: r.creado_por,
    vence: r.vence, anulado: !!r.anulado, respondido: r.respondido, vencido: !r.anulado && r.vence < new Date().toISOString() };
}
function filaCuenta(c) {
  return c && { id: c.id, clienteId: c.cliente_id, nombre: c.nombre, banco: c.banco, moneda: c.moneda, cbu: c.cbu, mandos: J(c.mandos) };
}
function filaDoc(d) {
  return d && { id: d.id, tipo: d.tipo, nombre: d.nombre, mime: d.mime, bytes: d.bytes, sha256: d.sha256, subidoPor: d.subido_por, creado: d.creado };
}

module.exports = { crearPersistencia, mesAnterior, meses };
