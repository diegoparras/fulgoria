// Tests del almacén de documentos: cifrado y driver S3 (contra un S3 falso local que exige firma).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const { crearBlobs, cifrar, descifrar, claveDesde } = require("../server/blobs.js");

test("cifrado AES-256-GCM: ida y vuelta, y detecta manipulación", () => {
  const k = claveDesde("b".repeat(64));
  const datos = Buffer.from("extracto confidencial 1.234,56");
  const c = cifrar(k, datos);
  assert.equal(c.subarray(0, 4).toString(), "FGC1");
  assert.ok(!c.includes(datos));
  assert.ok(descifrar(k, c).equals(datos));
  c[c.length - 1] ^= 1;
  assert.throws(() => descifrar(k, c));
  assert.throws(() => claveDesde("corta"), /32 bytes/);
  assert.throws(() => descifrar(null, cifrar(k, datos)), /DOCS_CLAVE/);
});

test("driver S3 (R2/S3/MinIO): PUT/GET/DELETE firmados con SigV4, estilo ruta", async () => {
  const objetos = new Map(), vistos = [];
  const srv = createServer((req, res) => {
    const partes = [];
    req.on("data", (d) => partes.push(d));
    req.on("end", () => {
      vistos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization || "", sha: req.headers["x-amz-content-sha256"] });
      if (!/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/.test(req.headers.authorization || "")) { res.statusCode = 403; return res.end("firma"); }
      if (req.method === "PUT") { objetos.set(req.url, Buffer.concat(partes)); res.end(); }
      else if (req.method === "GET") { const o = objetos.get(req.url); if (!o) { res.statusCode = 404; return res.end(); } res.end(o); }
      else if (req.method === "DELETE") { objetos.delete(req.url); res.statusCode = 204; res.end(); }
    });
  }).listen(0);
  const endpoint = `http://127.0.0.1:${srv.address().port}`;
  const blobs = crearBlobs({ almacenamiento: "s3", s3: { endpoint, region: "auto", bucket: "estudio", accessKeyId: "AKIATEST", secretAccessKey: "secreto", prefijo: "fulgoria" }, clave: "c".repeat(64) });
  assert.equal(blobs.tipo, "s3");
  const datos = Buffer.from("%PDF-1.7 extracto");
  await blobs.guardar("documentos/2026-06/abc", datos);
  assert.ok([...objetos.keys()][0] === "/estudio/fulgoria/documentos/2026-06/abc");
  assert.ok(!objetos.get("/estudio/fulgoria/documentos/2026-06/abc").includes(datos)); // viaja y queda cifrado
  assert.ok((await blobs.leer("documentos/2026-06/abc")).equals(datos));
  assert.equal(await blobs.leer("documentos/2026-06/no-existe"), null);
  await blobs.borrar("documentos/2026-06/abc");
  assert.equal(objetos.size, 0);
  assert.ok(vistos.every((v) => v.auth.startsWith("AWS4-HMAC-SHA256")));
  srv.close();
  assert.throws(() => crearBlobs({ almacenamiento: "s3", s3: {} }), /S3_ENDPOINT/);
});
