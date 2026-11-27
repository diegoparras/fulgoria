// IA para bancos nuevos: privacidad del esqueleto, saneo en el servidor, proveedores (contra
// servidores falsos) y elección de la propuesta por la regla del saldo.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { esqueletoDePdf, elegirPropuesta, columnasDePropuesta } from "../src/ia.js";

const require = createRequire(import.meta.url);
const { crearIA, sanear } = require("../server/ia.js");

// Extracto sintético como ítems de PDF (coordenadas 0..1): Fecha | Concepto | Débito | Crédito | Saldo.
const X = { fecha: 0.06, desc: 0.18, deb: [0.60, 0.70], cre: [0.72, 0.82], saldo: [0.86, 0.96] };
function pagina() {
  const items = [];
  const push = (str, x, w, cy) => items.push({ str, x, w, cy, cx: x + w / 2, y: cy - 0.006, h: 0.012 });
  push("Banco de Prueba", 0.06, 0.2, 0.05);
  push("Titular: AGRO SUR DEL PLATA SA CUIT 30-71234567-1", 0.06, 0.5, 0.08);
  push("FECHA", 0.06, 0.06, 0.15); push("CONCEPTO", 0.18, 0.1, 0.15); push("DEBITO", 0.64, 0.06, 0.15); push("CREDITO", 0.76, 0.06, 0.15); push("SALDO", 0.9, 0.06, 0.15);
  push("SALDO ANTERIOR", 0.18, 0.15, 0.18); push("1.000,00", 0.90, 0.06, 0.18);
  const filas = [["02/06/2026", "TRANSFERENCIA DE JUAN PEREZ", null, "500,00", "1.500,00"], ["03/06/2026", "PAGO A LACTEOS VALLE VERDE", "200,00", null, "1.300,00"], ["05/06/2026", "COMISION MANTENIMIENTO", "50,00", null, "1.250,00"], ["08/06/2026", "DEPOSITO EFECTIVO", null, "1.000,00", "2.250,00"]];
  filas.forEach(([f, d, deb, cre, s], i) => {
    const cy = 0.21 + i * 0.03;
    push(f, X.fecha, 0.08, cy); push(d, X.desc, 0.3, cy);
    if (deb) push(deb, X.deb[1] - 0.05, 0.05, cy);
    if (cre) push(cre, X.cre[1] - 0.05, 0.05, cy);
    push(s, X.saldo[1] - 0.06, 0.06, cy);
  });
  push("SALDO FINAL", 0.18, 0.12, 0.35); push("2.250,00", 0.90, 0.06, 0.35);
  return [{ index: 1, W: 595, H: 842, items }];
}

test("esqueleto: posiciones y tipos, sin nombres, montos, CUIT ni fechas reales", () => {
  const e = esqueletoDePdf(pagina());
  const todo = e.lineas.join("\n");
  assert.match(todo, /rotulo\(DEBITO\)/);
  assert.match(todo, /importe\(9\.999,99\)/);
  assert.match(todo, /fecha\(99\/99\/9999\)/);
  assert.doesNotMatch(todo, /JUAN|PEREZ|AGRO|LACTEOS|Banco de Prueba|Titular/i);
  // Fuera de las coordenadas, ningún dígito salvo el 9 de los patrones.
  const sinCoordenadas = todo.replace(/\d\.\d{3}-\d\.\d{3}/g, "");
  assert.doesNotMatch(sinCoordenadas, /[0-8]/);
});

test("saneo en el servidor: lo que no es posición, tipo o patrón no sale", () => {
  const limpio = sanear({ lineas: [
    "0.060-0.140 fecha(02/06/2026) | 0.180-0.480 texto(JUAN PEREZ) | 0.650-0.700 importe(1.234,56)",
    "0.180-0.300 rotulo(Juan Perez) | 0.640-0.700 rotulo(DEBITO) | 0.900-0.960 rotulo_saldo(SALDO ANTERIOR + importe)",
    "cualquier cosa que no es una celda | 0.100-0.200 numero(30712345671)",
  ] });
  const t = limpio.join("\n");
  assert.doesNotMatch(t, /JUAN|PEREZ|Juan|2026|1\.234|30712345671/);
  assert.match(t, /0\.640-0\.700 rotulo\(DEBITO\)/);
  assert.match(t, /0\.180-0\.300 texto/);
  assert.match(t, /rotulo_saldo\(SALDO ANTERIOR \+ importe\)/);
});

test("la regla del saldo elige: entre una propuesta equivocada y una correcta, gana la que cierra", () => {
  const mal = { explicacion: "débito y crédito al revés", columnas: [
    { desde: 0, hasta: 0.16, rol: "fecha" }, { desde: 0.16, hasta: 0.58, rol: "descripcion" },
    { desde: 0.58, hasta: 0.71, rol: "credito" }, { desde: 0.71, hasta: 0.84, rol: "debito" }, { desde: 0.84, hasta: 1, rol: "saldo" }] };
  const bien = { explicacion: "débito, crédito y saldo", columnas: [
    { desde: 0, hasta: 0.16, rol: "fecha" }, { desde: 0.16, hasta: 0.58, rol: "descripcion" },
    { desde: 0.58, hasta: 0.71, rol: "debito" }, { desde: 0.71, hasta: 0.84, rol: "credito" }, { desde: 0.84, hasta: 1, rol: "saldo" }] };
  const e = elegirPropuesta(pagina(), [mal, bien]);
  assert.equal(e.indice, 1);
  assert.equal(e.verificado, true);
  assert.equal(elegirPropuesta(pagina(), [mal]).verificado, false);
  // Bandas desordenadas o encimadas se ordenan y recortan; roles inventados se descartan.
  const c = columnasDePropuesta({ columnas: [{ desde: 0.5, hasta: 0.9, rol: "saldo" }, { desde: 0, hasta: 0.6, rol: "fecha" }, { desde: 0.1, hasta: 0.2, rol: "inventado" }] });
  assert.deepEqual(c.map((x) => [x.role, x.from, x.to]), [["fecha", 0, 0.6], ["saldo", 0.6, 0.9]]);
});

const PROPUESTA = { propuestas: [{ explicacion: "x", columnas: [{ desde: 0, hasta: 0.2, rol: "fecha" }, { desde: 0.8, hasta: 1, rol: "saldo" }] }] };
const ESQ = { paginas: 1, lineas: ["0.060-0.120 fecha(99/99/9999) | 0.900-0.960 importe(9.999,99)", "0.060-0.120 fecha(99/99/9999) | 0.900-0.960 importe(9.999,99)", "0.640-0.700 rotulo(SALDO)"] };
function servidorFalso(responder) {
  const pedidos = [];
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => { pedidos.push({ url: req.url, headers: req.headers, body: JSON.parse(b || "{}") }); const [st, out] = responder(req, JSON.parse(b || "{}")); res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(out)); });
  }).listen(0);
  return { url: `http://127.0.0.1:${srv.address().port}`, pedidos, cerrar: () => { srv.closeAllConnections(); srv.close(); } };
}

test("proveedor compatible con OpenAI (GPT, OpenRouter, local): salida con esquema y degradación a json_object", async () => {
  let primera = true;
  const f = servidorFalso((req, body) => {
    if (primera && body.response_format?.type === "json_schema") { primera = false; return [400, { error: "sin json_schema" }]; }
    return [200, { choices: [{ message: { content: "Acá va:\n" + JSON.stringify(PROPUESTA) } }] }];
  });
  test.after(f.cerrar);
  const ia = crearIA({ proveedor: "local", modelo: "llama-test", url: f.url + "/v1" });
  const r = await ia.proponerColumnas(ESQ, "ana");
  assert.equal(r.propuestas[0].columnas[1].rol, "saldo");
  assert.equal(f.pedidos.length, 2);
  assert.equal(f.pedidos[0].url, "/v1/chat/completions");
  assert.equal(f.pedidos[0].body.response_format.json_schema.strict, true);
  assert.equal(f.pedidos[1].body.response_format.type, "json_object");
  assert.match(f.pedidos[0].body.messages[1].content, /L1: 0\.060-0\.120 fecha/);
  assert.throws(() => crearIA({ proveedor: "openai" }), /IA_MODELO/);
  assert.throws(() => crearIA({ proveedor: "openai", modelo: "x" }), /IA_API_KEY/);
});

test("proveedor Anthropic (SDK oficial): JSON Schema, esfuerzo, fallback del servidor y negativas", async () => {
  let rechazar = false;
  const f = servidorFalso(() => [200, {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: rechazar ? [] : [{ type: "text", text: JSON.stringify(PROPUESTA) }],
    stop_reason: rechazar ? "refusal" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
  }]);
  test.after(f.cerrar);
  const ia = crearIA({ proveedor: "anthropic", apiKey: "sk-test", url: f.url, maxPorHora: 2 });
  assert.equal(ia.modelo, "claude-opus-5-5");
  const r = await ia.proponerColumnas(ESQ, "bruno");
  assert.equal(r.propuestas.length, 1);
  const p = f.pedidos[0];
  assert.match(p.url, /^\/v1\/messages/);
  assert.match(p.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(p.body.fallbacks, "default");
  assert.equal(p.body.output_config.format.type, "json_schema");
  assert.equal(p.body.output_config.effort, "medium");
  assert.equal(p.body.thinking, undefined);
  rechazar = true;
  await assert.rejects(ia.proponerColumnas(ESQ, "bruno"), /declinó/);
  await assert.rejects(ia.proponerColumnas(ESQ, "bruno"), /máximo de 2 consultas/); // límite por hora
});
