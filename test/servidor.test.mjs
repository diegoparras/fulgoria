// Tests de la persistencia del estudio a través de la API real (server.js con PERSISTENCIA=on).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA = mkdtempSync(join(tmpdir(), "fulgoria-test-"));
Object.assign(process.env, {
  AUTH_ENABLED: "false", PERSISTENCIA: "on", DATA_DIR: DATA, ALMACENAMIENTO: "disco",
  DOCS_CLAVE: "a".repeat(64), BACKUP_HORAS: "0",
});
const require = createRequire(import.meta.url);
const origLog = console.log; console.log = () => {}; // el cartel de arranque no aporta en los tests
const { app, persistencia } = require("../server.js");
console.log = origLog;
const srv = app.listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/api/v1`;
test.after(() => { srv.close(); persistencia.cerrar(); });

const api = async (metodo, ruta, body, headers = {}) => {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: body && !Buffer.isBuffer(body) ? { "content-type": "application/json", ...headers } : headers,
    body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const t = r.headers.get("content-type") || "";
  return { status: r.status, body: t.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const PDF = readFileSync(new URL("../samples/banco-rio-cc.pdf", import.meta.url));
const CSV = readFileSync(new URL("../samples/mayor-banco-rio-cc.csv", import.meta.url));

test("estado de la persistencia", async () => {
  const r = await api("GET", "/estado");
  assert.equal(r.body.persistencia, true);
  assert.equal(r.body.almacenamiento, "disco");
  assert.equal(r.body.cifrado, true);
  assert.equal(r.body.usuario, "local");
});

test("circuito completo: cliente, cuenta, documentos, mes, estados, arrastre y tablero", async () => {
  // Cliente y cuenta
  assert.equal((await api("POST", "/clientes", {})).status, 400);
  const cli = (await api("POST", "/clientes", { nombre: "Ferretería El Tornillo SRL", cuit: "30-71234567-1" })).body;
  const cta = (await api("POST", `/clientes/${cli.id}/cuentas`, { nombre: "Cuenta corriente en pesos", banco: "Banco del Río" })).body;
  assert.equal(cta.moneda, "ARS");
  assert.equal((await api("GET", `/clientes/${cli.id}/cuentas`)).body.length, 1);

  // Documentos: se guardan cifrados en disco y se devuelven tal cual; el mismo archivo no se duplica.
  const ext = (await api("POST", "/documentos", PDF, { "x-tipo": "extracto", "x-nombre": encodeURIComponent("Extracto junio.pdf"), "content-type": "application/pdf" })).body;
  const may = (await api("POST", "/documentos", CSV, { "x-tipo": "mayor", "x-nombre": "mayor.csv", "content-type": "text/csv" })).body;
  assert.equal(ext.nombre, "Extracto junio.pdf");
  assert.equal((await api("POST", "/documentos", PDF, { "x-tipo": "extracto", "x-nombre": "otro.pdf" })).body.id, ext.id);
  const bajado = await api("GET", `/documentos/${ext.id}`);
  assert.ok(bajado.body.equals(PDF));
  const enDisco = readdirSync(join(DATA, "documentos", ext.creado.slice(0, 7))).map((f) => readFileSync(join(DATA, "documentos", ext.creado.slice(0, 7), f)));
  assert.ok(enDisco.every((b) => b.subarray(0, 4).toString() === "FGC1" && !b.includes(PDF.subarray(0, 64))));

  // Mes nuevo
  const P = `/cuentas/${cta.id}/periodos/2026-06`;
  assert.equal((await api("GET", P)).body.periodo, null);
  const resumen = { estado: "rojo", diferenciaNoExplicada: 0, atencion: 1, saldos: { bancoCierre: 2159315, librosCierre: 1700425 } };
  const pendientes = [{ id: "L12", lado: "libros", fecha: "2026-06-26", cents: -300000, descripcion: "Cheque N° 4521" }];
  let per = (await api("PUT", P, { extractoDoc: ext.id, mayorDoc: may.id, decisiones: { confirmados: [] }, resumen, pendientes })).body;
  assert.equal(per.version, 1);
  assert.equal(per.estado, "borrador");

  // Concurrencia: guardar con una versión vieja → 409 con lo actual.
  const viejo = await api("PUT", P, { version: 0, decisiones: {} });
  assert.equal(viejo.status, 409);
  assert.equal(viejo.body.actual.version, 1);

  // Preparó → revisó → cerrar.
  per = (await api("PUT", P, { version: per.version, accion: "preparar" })).body;
  assert.equal(per.estado, "preparado");
  assert.equal(per.preparo, "local");
  assert.equal((await api("PUT", P, { version: per.version, accion: "cerrar" })).status, 422); // falta revisar
  // Cambiar las decisiones invalida la preparación.
  per = (await api("PUT", P, { version: per.version, decisiones: { confirmados: [{ banco: ["B4"], libros: ["L4", "L5"] }] } })).body;
  assert.equal(per.estado, "borrador");
  assert.equal(per.preparo, null);
  per = (await api("PUT", P, { version: per.version, accion: "preparar" })).body;
  per = (await api("PUT", P, { version: per.version, accion: "revisar" })).body;
  assert.equal(per.estado, "revisado");
  // Con diferencia no explicada no se cierra.
  const conDif = await api("PUT", P, { version: per.version, resumen: { ...resumen, diferenciaNoExplicada: 100 }, accion: "cerrar" });
  assert.equal(conDif.status, 422);
  per = (await api("PUT", P, { version: per.version, accion: "cerrar" })).body;
  assert.equal(per.estado, "cerrado");
  // Cerrado: no se modifica; se puede reabrir.
  assert.equal((await api("PUT", P, { version: per.version, decisiones: {} })).status, 423);
  per = (await api("PUT", P, { version: per.version, accion: "reabrir" })).body;
  assert.equal(per.estado, "borrador");
  per = (await api("PUT", P, { version: per.version, accion: "preparar" })).body;
  per = (await api("PUT", P, { version: per.version, accion: "revisar" })).body;
  per = (await api("PUT", P, { version: per.version, accion: "cerrar" })).body;

  // Arrastre: julio recibe los pendientes de junio.
  const jul = (await api("GET", `/cuentas/${cta.id}/periodos/2026-07`)).body;
  assert.equal(jul.periodo, null);
  assert.equal(jul.anterior.periodo, "2026-06");
  assert.equal(jul.anterior.estado, "cerrado");
  assert.deepEqual(jul.anterior.pendientes, pendientes);

  // Tablero de cartera
  const cart = (await api("GET", "/cartera?hasta=2026-07&meses=3")).body;
  assert.deepEqual(cart.meses, ["2026-05", "2026-06", "2026-07"]);
  const fila = cart.clientes.find((c) => c.id === cli.id).cuentas[0];
  assert.equal(fila.periodos["2026-06"].estado, "cerrado");
  assert.equal(fila.periodos["2026-06"].diferencia, 0);

  // Auditoría
  const ev = (await api("GET", `/eventos?entidad=periodo&id=${per.id}`)).body;
  assert.ok(["crear", "preparar", "invalidar_revision", "revisar", "cerrar", "reabrir"].every((a) => ev.some((e) => e.accion === a)));

  // Copia de seguridad de la base (cifrada, en el mismo almacenamiento).
  const bk = await persistencia.backup();
  assert.ok(statSync(join(DATA, ...bk.clave.split("/"))).size > 0);
});

test("plantillas compartidas del estudio: solo forma, nunca datos", async () => {
  const tplMayor = { fulgoria_plantilla_mayor: 1, sistema: "Sistema XYZ", mapeo: { fecha: "Fec.", debe: "Cargo", haber: "Abono" } };
  assert.equal((await api("PUT", "/plantillas", { tipo: "mayor", nombre: "Sistema XYZ", plantilla: { cualquier: "cosa" } })).status, 400);
  const g = (await api("PUT", "/plantillas", { tipo: "mayor", nombre: "Sistema XYZ", plantilla: tplMayor })).body;
  await api("PUT", "/plantillas", { tipo: "mayor", nombre: "Sistema XYZ", plantilla: { ...tplMayor, ignorar: ["Total hoja"] } }); // actualiza
  const lista = (await api("GET", "/plantillas?tipo=mayor")).body;
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].plantilla.ignorar, ["Total hoja"]);
  assert.equal((await api("DELETE", `/plantillas/${g.id}`)).status, 204);
  assert.equal((await api("GET", "/plantillas")).body.length, 0);
});

test("validaciones de entrada", async () => {
  assert.equal((await api("GET", "/cuentas/no-es-un-id/periodos")).status, 400);
  assert.equal((await api("GET", "/cuentas/00000000-0000-0000-0000-000000000000/periodos/2026-13")).status, 400);
  assert.equal((await api("POST", "/documentos", Buffer.from("x"), { "x-tipo": "otro" })).status, 400);
  assert.equal((await api("PUT", "/cuentas/00000000-0000-0000-0000-000000000000/periodos/2026-06", { extractoDoc: "00000000-0000-0000-0000-000000000000" })).status, 400);
});

test("seguridad: el Content-Type del documento no lo elige quien lo sube; datos del mes con forma inválida", async () => {
  const js = Buffer.from("fetch('/api/v1/usuarios',{method:'POST'})");
  const d = (await api("POST", "/documentos", js, { "x-tipo": "extracto", "x-nombre": "x.js", "content-type": "text/javascript" })).body;
  const r = await fetch(`${BASE}/documentos/${d.id}`);
  assert.equal(r.headers.get("content-type"), "application/octet-stream");
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  const pdf = await fetch(`${BASE}/documentos/${(await api("POST", "/documentos", PDF, { "x-tipo": "extracto", "content-type": "application/pdf; charset=binary" })).body.id}`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");

  const cli = (await api("POST", "/clientes", { nombre: "Cliente de prueba de seguridad" })).body;
  const cta = (await api("POST", `/clientes/${cli.id}/cuentas`, { nombre: "Caja de ahorro" })).body;
  assert.equal((await api("PATCH", `/cuentas/${cta.id}`, { mandos: "<img>" })).status, 400);
  assert.equal((await api("PATCH", `/cuentas/${cta.id}`, { mandos: { match: { ventana: { a: { b: { c: 1 } } } } } })).status, 400);
  assert.equal((await api("PUT", `/cuentas/${cta.id}/periodos/2026-03`, { resumen: "x" })).status, 400);
  assert.equal((await api("PUT", `/cuentas/${cta.id}/periodos/2026-03`, { pendientes: { a: 1 } })).status, 400);
  // Un "semáforo" que no es un color no llega al tablero.
  assert.equal((await api("PUT", `/cuentas/${cta.id}/periodos/2026-03`, { resumen: { estado: 'x"><iframe srcdoc="">' } })).status, 200);
  const cart = (await api("GET", "/cartera?hasta=2026-03&meses=1")).body;
  const fila = cart.clientes.find((c) => c.id === cli.id).cuentas[0].periodos["2026-03"];
  assert.equal(fila.semaforo, null);
});

test("IA desde la pantalla: sin IA / local / externa, solo admin, clave cifrada que no vuelve", async () => {
  const { createServer } = await import("node:http");
  const vistos = [];
  const prov = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    vistos.push({ url: req.url, auth: req.headers.authorization || null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url.endsWith("/models") ? { data: [{ id: "modelo-a" }] } : { choices: [{ message: { content: JSON.stringify({ propuestas: [{ explicacion: "x", columnas: [{ desde: 0, hasta: 0.2, rol: "fecha" }] }] }) } }] }));
  }); }).listen(0);
  test.after(() => { prov.closeAllConnections(); prov.close(); });
  const URLP = `http://127.0.0.1:${prov.address().port}/v1`;
  const estadoIA = async () => (await fetch(BASE.replace("/api/v1", "") + "/api/ia/estado")).json();

  const v0 = (await api("GET", "/ia/config")).body;
  assert.equal(v0.modo, "ninguna");
  assert.ok(v0.proveedores.gemini && v0.proveedores.openai && !v0.proveedores.local);
  assert.equal((await api("PUT", "/ia/config", { modo: "otra" })).status, 400);
  assert.equal((await api("PUT", "/ia/config", { modo: "externa", externa: { proveedor: "openai", modelo: "gpt-6-luna" } })).status, 400); // falta la clave
  assert.equal((await api("PUT", "/ia/config", { modo: "externa", externa: { proveedor: "local", modelo: "x" } })).status, 400); // local no es externa
  assert.equal((await api("PUT", "/ia/config", { modo: "local", local: { modelo: "m", temperatura: 7 } })).status, 400);

  // IA local: sin clave; listar modelos, probar y guardar.
  assert.deepEqual((await api("POST", "/ia/modelos", { modo: "local", local: { url: URLP } })).body.modelos, ["modelo-a"]);
  assert.equal((await api("POST", "/ia/probar", { modo: "local", local: { modelo: "modelo-a", url: URLP } })).body.propuestas, 1);
  let g = await api("PUT", "/ia/config", { modo: "local", local: { modelo: "modelo-a", url: URLP } });
  assert.equal(g.status, 200);
  assert.deepEqual(await estadoIA(), { disponible: true, proveedor: "local", modelo: "modelo-a" });

  // IA externa: la clave se guarda cifrada y no vuelve; la config local se conserva.
  g = await api("PUT", "/ia/config", { modo: "externa", externa: { proveedor: "openai", modelo: "modelo-a", url: URLP, apiKey: "sk-secreta-1234" } });
  assert.equal(g.status, 200);
  assert.equal(g.body.externa.clave, "…1234");
  assert.equal(g.body.local.modelo, "modelo-a");
  assert.ok(!JSON.stringify(g.body).includes("sk-secreta"));
  const enBase = JSON.stringify(persistencia.ajuste("ia"));
  assert.ok(!enBase.includes("sk-secreta") && enBase.includes("claveCifrada"));
  assert.deepEqual(await estadoIA(), { disponible: true, proveedor: "openai", modelo: "modelo-a" });
  // Cambiar el modelo sin reenviar la clave la mantiene; cambiar de proveedor la exige.
  assert.equal((await api("PUT", "/ia/config", { modo: "externa", externa: { proveedor: "openai", modelo: "otro", url: URLP } })).status, 200);
  assert.equal((await api("PUT", "/ia/config", { modo: "externa", externa: { proveedor: "gemini", modelo: "gemini-x" } })).status, 400);
  vistos.length = 0;
  await api("POST", "/ia/probar", { modo: "externa", externa: { proveedor: "openai", modelo: "otro", url: URLP } });
  assert.equal(vistos[0].auth, "Bearer sk-secreta-1234"); // usó la guardada

  // Volver a local sin reescribirla, y apagar.
  assert.equal((await api("PUT", "/ia/config", { modo: "local", local: { modelo: "modelo-a", url: URLP } })).body.externa.clave, "…1234");
  g = await api("PUT", "/ia/config", { modo: "ninguna" });
  assert.equal(g.body.modo, "ninguna");
  assert.equal(g.body.enUso, null);
  assert.deepEqual(await estadoIA(), { disponible: false });
  // Volver al .env (en el test no hay IA en el .env).
  assert.equal((await api("DELETE", "/ia/config")).body.origen, "ninguno");
});

test("el código de la app se revalida siempre (después de un deploy nadie queda con el JS viejo)", async () => {
  const r = await fetch(BASE.replace("/api/v1", "") + "/src/conciliar.js");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  const etag = r.headers.get("etag");
  assert.ok(etag);
  // (con http y no con fetch: fetch agrega "cache-control: no-cache" a los pedidos condicionales)
  const { get } = await import("node:http");
  const status = await new Promise((ok) => get(BASE.replace("/api/v1", "") + "/src/conciliar.js", { headers: { "if-none-match": etag } }, (res) => { res.resume(); ok(res.statusCode); }));
  assert.equal(status, 304);
});

test("todas las páginas arman el mismo header (src/header.js) y llevan la versión para el Acerca de", async () => {
  const raiz = BASE.replace("/api/v1", "");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const ruta of ["/", "/conciliar", "/conciliar.html"]) {
    const html = await (await fetch(raiz + ruta)).text();
    assert.match(html, /<header class="topbar" data-topbar data-pagina="(inicio|conciliar)">/, ruta);
    assert.ok(html.includes(`<script src="src/header.js?v=${version}"></script>`), ruta);
    assert.ok(html.includes(`<meta name="fulgoria-version" content="${version}" />`), ruta);
    // Estilos y scripts piden su versión: un CSS guardado de la versión anterior no se mezcla.
    assert.ok(html.includes(`<link rel="stylesheet" href="styles/app.css?v=${version}" />`), ruta);
    assert.doesNotMatch(html, /(href="styles\/|src="src\/)[\w.-]+\.(css|js)"/, ruta);
  }
  const js = await fetch(raiz + "/src/header.js");
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("cache-control"), "no-cache");
});

test("CSRF: un pedido que cambia algo desde otro sitio se rechaza; desde la misma página pasa", async () => {
  const host = new URL(BASE).host;
  const post = (headers) => fetch(BASE + "/clientes", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ nombre: "Cliente CSRF" }) });
  assert.equal((await post({ origin: "https://otro-sitio.example" })).status, 403);
  assert.equal((await post({ origin: "null" })).status, 403);
  assert.equal((await post({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ origin: `http://${host}`, "sec-fetch-site": "same-origin" })).status, 201);
  assert.equal((await fetch(BASE + "/clientes", { headers: { origin: "https://otro-sitio.example" } })).status, 200); // leer no cambia nada
});

test("pedido al cliente: link sin login, solo sus partidas, respuestas que vuelven, anular y vencer", async () => {
  const RAIZ = BASE.replace("/api/v1", "");
  const cli = (await api("POST", "/clientes", { nombre: "Cliente con pedido" })).body;
  const cta = (await api("POST", `/clientes/${cli.id}/cuentas`, { nombre: "Cuenta corriente", banco: "Banco del Río" })).body;
  const items = [
    { clave: "2026-06-02|150000|TRANSF RECIBIDA", fecha: "2026-06-02", descripcion: "TRANSF RECIBIDA <b>X</b>", cents: 150000 },
    { clave: "2026-06-09|-4500|DEBITO AUTOMATICO", fecha: "2026-06-09", descripcion: "DEBITO AUTOMATICO", cents: -4500 },
  ];
  assert.equal((await api("POST", `/cuentas/${cta.id}/periodos/2026-06/pedidos`, { items: [{ clave: "x" }] })).status, 400);
  const nuevo = await api("POST", `/cuentas/${cta.id}/periodos/2026-06/pedidos`, { items });
  assert.equal(nuevo.status, 201);
  const token = nuevo.body.url.split("/").pop();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  // En la base no queda el token, solo su hash.
  assert.ok(!JSON.stringify(persistencia.pedidos(cta.id, "2026-06")).includes(token));

  // El cliente: la página y los datos, sin sesión; solo nombre, cuenta, mes y sus partidas.
  const pagina = await fetch(`${RAIZ}/r/${token}`);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get("x-robots-tag"), /noindex/);
  const ver = await (await fetch(`${RAIZ}/api/publico/pedidos/${token}`)).json();
  assert.equal(ver.cliente, "Cliente con pedido");
  assert.equal(ver.items.length, 2);
  assert.deepEqual(Object.keys(ver).sort(), ["banco", "cliente", "cuenta", "id", "items", "periodo", "respuestas", "vence"]);
  assert.equal((await fetch(`${RAIZ}/api/publico/pedidos/${"a".repeat(43)}`)).status, 404);
  assert.equal((await fetch(`${RAIZ}/api/publico/pedidos/corto`)).status, 404);

  // Responde (las claves que no son del pedido se ignoran), corrige y borra.
  const responder = (respuestas, headers = {}) => fetch(`${RAIZ}/api/publico/pedidos/${token}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ respuestas }) });
  let r = await (await responder({ [items[0].clave]: "Cobranza factura 0001-77 de Juan Pérez", inventada: "x" })).json();
  assert.deepEqual(Object.keys(r.respuestas), [items[0].clave]);
  r = await (await responder({ [items[0].clave]: "Cobranza factura 0001-78", [items[1].clave]: "Seguro del auto" })).json();
  assert.equal(r.respuestas[items[0].clave].texto, "Cobranza factura 0001-78");
  assert.equal((await responder({ [items[1].clave]: "" }).then((x) => x.json())).respuestas[items[1].clave], undefined);
  assert.equal((await responder({}, { origin: "https://otro-sitio.example" })).status, 403); // CSRF también acá
  // El estudio ve las respuestas.
  const delEstudio = (await api("GET", `/cuentas/${cta.id}/periodos/2026-06/pedidos`)).body;
  assert.equal(delEstudio[0].respuestas[items[0].clave].texto, "Cobranza factura 0001-78");

  // Anulado: el link deja de funcionar.
  assert.equal((await api("DELETE", `/pedidos/${nuevo.body.id}`)).status, 200);
  assert.equal((await fetch(`${RAIZ}/api/publico/pedidos/${token}`)).status, 404);
  assert.equal((await responder({ [items[0].clave]: "tarde" })).status, 404);
  // Vencido: igual.
  const otro = (await api("POST", `/cuentas/${cta.id}/periodos/2026-06/pedidos`, { items, dias: 1 })).body;
  const t2 = otro.url.split("/").pop();
  assert.equal((await fetch(`${RAIZ}/api/publico/pedidos/${t2}`)).status, 200);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(DATA, "fulgoria.sqlite"));
  db.prepare("UPDATE pedidos SET vence = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", otro.id);
  db.close();
  assert.equal((await fetch(`${RAIZ}/api/publico/pedidos/${t2}`)).status, 404);
});

test("formatos de asientos compartidos: solo se acepta algo con forma de formato", async () => {
  assert.equal((await api("PUT", "/plantillas", { tipo: "asientos", nombre: "X", plantilla: { cualquier: "cosa" } })).status, 400);
  const fmt = { fulgoria_formato_asientos: 1, nombre: "Sistema del estudio", archivo: { tipo: "delimitado", delimitador: ";", ext: "csv" }, titulos: null, columnas: [{ rol: "fecha" }, { rol: "cuenta" }, { rol: "importeConSigno" }], estructura: "linea", fecha: { patron: "DD/MM/AAAA" }, importe: { decimal: ",", miles: "", decimales: 2 }, signo: { debe: "D", haber: "H" }, asiento: { reinicio: "nunca", desde: 1 }, cuenta: { modo: "codigo" } };
  assert.equal((await api("PUT", "/plantillas", { tipo: "asientos", nombre: fmt.nombre, plantilla: fmt })).status, 200);
  assert.ok((await api("GET", "/plantillas?tipo=asientos")).body.some((p) => p.nombre === "Sistema del estudio"));
});

test("comprobantes del cliente: solo PDF o fotos reales, límites, el estudio los ve y el cliente los puede quitar", async () => {
  const RAIZ = BASE.replace("/api/v1", "");
  const cli = (await api("POST", "/clientes", { nombre: "Cliente con comprobantes" })).body;
  const cta = (await api("POST", `/clientes/${cli.id}/cuentas`, { nombre: "Caja de ahorro" })).body;
  const items = [{ clave: "2026-06-11|23500|TRANSF GOMEZ", fecha: "2026-06-11", descripcion: "TRANSF GOMEZ", cents: 23500 }];
  const token = (await api("POST", `/cuentas/${cta.id}/periodos/2026-06/pedidos`, { items })).body.url.split("/").pop();
  const subir = (datos, clave = items[0].clave, tipo = "application/pdf") => fetch(`${RAIZ}/api/publico/pedidos/${token}/adjuntos?clave=${encodeURIComponent(clave)}`, { method: "POST", headers: { "content-type": tipo, "x-nombre": encodeURIComponent("Factura B 0003-123.pdf") }, body: datos });
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 32), Buffer.from("%%EOF")]);
  // Un HTML que dice ser PDF no pasa (se mira el contenido, no el tipo que manda el navegador).
  assert.equal((await subir(Buffer.from("<html><script>alert(1)</script></html>"))).status, 400);
  assert.equal((await subir(pdf, "no-es-del-pedido")).status, 400);
  const r = await subir(pdf);
  assert.equal(r.status, 201);
  const pd = await r.json();
  const adj = pd.respuestas[items[0].clave].adjuntos;
  assert.equal(adj.length, 1);
  assert.equal(adj[0].mime, "application/pdf");
  // Contestar el texto no borra el adjunto.
  await fetch(`${RAIZ}/api/publico/pedidos/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ respuestas: { [items[0].clave]: "Pago de María Gómez" } }) });
  const delEstudio = (await api("GET", `/cuentas/${cta.id}/periodos/2026-06/pedidos`)).body[0].respuestas[items[0].clave];
  assert.equal(delEstudio.texto, "Pago de María Gómez");
  assert.equal(delEstudio.adjuntos.length, 1);
  // El estudio lo baja (cifrado en disco, se devuelve como PDF y en sandbox).
  const bajado = await fetch(`${BASE}/documentos/${adj[0].id}`);
  assert.equal(bajado.headers.get("content-type"), "application/pdf");
  assert.ok(Buffer.from(await bajado.arrayBuffer()).equals(pdf));
  // Una foto JPG real también entra; hasta 5 por movimiento.
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
  for (let i = 0; i < 4; i++) assert.equal((await subir(Buffer.concat([jpg, Buffer.from([i])]), items[0].clave, "image/jpeg")).status, 201);
  assert.equal((await subir(Buffer.concat([jpg, Buffer.from([9])]), items[0].clave, "image/jpeg")).status, 400);
  // El cliente quita el PDF: desaparece y el archivo se borra.
  const q = await fetch(`${RAIZ}/api/publico/pedidos/${token}/adjuntos/${adj[0].id}`, { method: "DELETE" });
  assert.equal(q.status, 200);
  assert.ok(!(await q.json()).respuestas[items[0].clave].adjuntos.some((a) => a.id === adj[0].id));
  assert.equal((await fetch(`${BASE}/documentos/${adj[0].id}`)).status, 404);
  // Con el link anulado no se puede subir.
  const pid = (await api("GET", `/cuentas/${cta.id}/periodos/2026-06/pedidos`)).body[0].id;
  await api("DELETE", `/pedidos/${pid}`);
  assert.equal((await subir(pdf)).status, 404);
});

test("reglas del estudio compartidas: solo se aceptan con forma de regla", async () => {
  assert.equal((await api("PUT", "/plantillas", { tipo: "regla", nombre: "x", plantilla: { texto: "x" } })).status, 400);
  assert.equal((await api("PUT", "/plantillas", { tipo: "regla", nombre: "x", plantilla: { fulgoria_regla: 1, texto: "y".repeat(81), tipo: "comision" } })).status, 400);
  const r = { fulgoria_regla: 1, texto: "DB AUT SEGURO", tipo: "cuenta_propia", signo: -1, cuenta: "5.2.10 Seguros" };
  assert.equal((await api("PUT", "/plantillas", { tipo: "regla", nombre: "DB AUT SEGURO (débitos)", plantilla: r })).status, 200);
  const lista = (await api("GET", "/plantillas?tipo=regla")).body;
  assert.deepEqual(lista.map((x) => x.plantilla.cuenta), ["5.2.10 Seguros"]);
  assert.equal((await api("DELETE", `/plantillas/${lista[0].id}`)).status, 204);
});
