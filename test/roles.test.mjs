// Roles del modo estudio con login real (standalone) y la traducción de roles de Lockatus.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

Object.assign(process.env, {
  AUTH_ENABLED: "true", AUTH_MODE: "local", AUTH_USER: "admin", AUTH_PASSWORD: "clave-del-admin-123", SESSION_SECRET: "s".repeat(64),
  COOKIE_SECURE: "false", PERSISTENCIA: "on", DATA_DIR: mkdtempSync(join(tmpdir(), "fulgoria-roles-")), ALMACENAMIENTO: "disco",
  DOCS_CLAVE: "", BACKUP_HORAS: "0", REVISION_INDEPENDIENTE: "on",
});
const require = createRequire(import.meta.url);
const origLog = console.log; console.log = () => {};
const { app, persistencia } = require("../server.js");
console.log = origLog;
const { rolDesdeLockatus, parsearMapa, permisosDe } = require("../server/roles.js");
const srv = app.listen(0);
const RAIZ = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); persistencia.cerrar(); });

async function login(user, password) {
  const r = await fetch(RAIZ + "/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user, password }) });
  const c = (r.headers.get("set-cookie") || "").split(";")[0];
  return c.startsWith("fulgoria_auth=") ? c : null;
}
const como = (cookie) => async (metodo, ruta, body, headers = {}) => {
  const bin = Buffer.isBuffer(body);
  const r = await fetch(RAIZ + "/api/v1" + ruta, { method: metodo, headers: { cookie, ...(body && !bin ? { "content-type": "application/json" } : {}), ...headers }, body: body == null ? undefined : bin ? body : JSON.stringify(body) });
  return { status: r.status, body: (r.headers.get("content-type") || "").includes("json") ? await r.json() : null };
};

test("roles standalone: alta de usuarios, permisos por rol, revisión independiente y baja inmediata", async () => {
  assert.equal(await login("admin", "mal"), null);
  const admin = como(await login("admin", "clave-del-admin-123"));
  const est = (await admin("GET", "/estado")).body;
  assert.equal(est.rol, "admin");
  assert.equal(est.modoUsuarios, "local");

  // Alta de usuarios (solo admin)
  assert.equal((await admin("POST", "/usuarios", { usuario: "ana", password: "corta", rol: "preparador" })).status, 400);
  for (const [usuario, rol] of [["ana", "preparador"], ["bruno", "revisor"], ["carla", "lector"]]) {
    assert.equal((await admin("POST", "/usuarios", { usuario, nombre: usuario, password: `contraseña-de-${usuario}`, rol })).status, 201);
  }
  assert.equal((await admin("POST", "/usuarios", { usuario: "ana", password: "otra-contraseña-1", rol: "lector" })).status, 409);
  const ana = como(await login("ana", "contraseña-de-ana"));
  const bruno = como(await login("bruno", "contraseña-de-bruno"));
  const carla = como(await login("carla", "contraseña-de-carla"));
  assert.deepEqual((await carla("GET", "/estado")).body.permisos, ["leer"]);

  // Lector: mira, no toca.
  assert.equal((await carla("GET", "/clientes")).status, 200);
  assert.equal((await carla("POST", "/clientes", { nombre: "X" })).status, 403);
  assert.equal((await ana("GET", "/usuarios")).status, 403);
  assert.equal((await carla("POST", `/cuentas/${"0".repeat(8)}-0000-0000-0000-000000000000/periodos/2026-06/pedidos`, { items: [] })).status, 403); // un lector no crea links
  for (const quien of [ana, carla]) { assert.equal((await quien("GET", "/ia/config")).status, 403); assert.equal((await quien("PUT", "/ia/config", { modo: "ninguna" })).status, 403); }

  // Preparador: carga y prepara; no revisa.
  const cli = (await ana("POST", "/clientes", { nombre: "Agro Sur SA" })).body;
  const cta = (await ana("POST", `/clientes/${cli.id}/cuentas`, { nombre: "CC $" })).body;
  const PDF = readFileSync(new URL("../samples/banco-rio-cc.pdf", import.meta.url));
  const CSV = readFileSync(new URL("../samples/mayor-banco-rio-cc.csv", import.meta.url));
  const d1 = (await ana("POST", "/documentos", PDF, { "x-tipo": "extracto", "x-nombre": "e.pdf" })).body;
  const d2 = (await ana("POST", "/documentos", CSV, { "x-tipo": "mayor", "x-nombre": "m.csv" })).body;
  const P = `/cuentas/${cta.id}/periodos/2026-06`;
  let per = (await ana("PUT", P, { extractoDoc: d1.id, mayorDoc: d2.id, resumen: { diferenciaNoExplicada: 0 } })).body;
  per = (await ana("PUT", P, { version: per.version, accion: "preparar" })).body;
  assert.equal(per.preparo, "ana");
  const r1 = await ana("PUT", P, { version: per.version, accion: "revisar" });
  assert.equal(r1.status, 403);
  assert.match(r1.body.mensaje, /preparador/);
  assert.equal((await carla("PUT", P, { version: per.version, accion: "preparar" })).status, 403);

  // Revisor: revisa lo que preparó otra persona…
  per = (await bruno("PUT", P, { version: per.version, accion: "revisar" })).body;
  assert.equal(per.reviso, "bruno");
  per = (await bruno("PUT", P, { version: per.version, accion: "cerrar" })).body;
  assert.equal(per.estado, "cerrado");
  // …pero no lo que preparó él mismo (REVISION_INDEPENDIENTE=on).
  per = (await bruno("PUT", P, { version: per.version, accion: "reabrir" })).body;
  per = (await bruno("PUT", P, { version: per.version, accion: "preparar" })).body;
  const r2 = await bruno("PUT", P, { version: per.version, accion: "revisar" });
  assert.equal(r2.status, 403);
  assert.match(r2.body.mensaje, /otra persona/);

  // Cambios de rol y bajas: efecto inmediato, sin esperar a que venza la sesión.
  assert.equal((await admin("PATCH", "/usuarios/carla", { rol: "preparador" })).status, 200);
  assert.equal((await carla("GET", "/estado")).body.rol, "preparador");
  assert.equal((await admin("PATCH", "/usuarios/ana", { activo: false })).status, 200);
  assert.equal((await ana("GET", "/estado")).status, 401);
  assert.equal(await login("ana", "contraseña-de-ana"), null);
  const yo = await admin("PATCH", "/usuarios/admin", { activo: false });
  assert.equal(yo.status, 400); // nadie se quita el acceso a sí mismo
  assert.match(yo.body.mensaje, /vos mismo/);
  const ev = (await admin("GET", "/eventos?entidad=usuario")).body;
  assert.ok(ev.some((e) => e.accion === "editar" && e.entidadId === "ana"));
});

test("roles federados (Lockatus): traducción de nombres y mínimo privilegio", () => {
  const mapa = parsearMapa("contador=preparador, socio=revisor, sistemas=admin, raro=superusuario");
  assert.deepEqual(mapa, { contador: "preparador", socio: "revisor", sistemas: "admin" });
  assert.equal(rolDesdeLockatus("socio", mapa), "revisor");
  assert.equal(rolDesdeLockatus("Revisor", {}), "revisor");            // los nombres de Fulgoria valen tal cual
  assert.equal(rolDesdeLockatus(["contador", "socio"], mapa), "revisor"); // varios roles: gana el más alto
  assert.equal(rolDesdeLockatus("desconocido", mapa), "lector");       // sin mapeo: solo mira
  assert.equal(rolDesdeLockatus(undefined, mapa), "lector");
  assert.deepEqual(permisosDe("revisor"), ["leer", "editar", "preparar", "revisar"]);
});
