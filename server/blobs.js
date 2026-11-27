// Almacenamiento de DOCUMENTOS (extractos PDF/imagen, mayores CSV) del estudio.
//
//   ALMACENAMIENTO=disco  → archivos en DATA_DIR/documentos y DATA_DIR/backups (el volumen del servidor)
//   ALMACENAMIENTO=s3     → un bucket S3-compatible: Cloudflare R2, AWS S3, MinIO…
//
// Si DOCS_CLAVE está definida (32 bytes en hex o base64), cada documento se cifra con
// AES-256-GCM ANTES de salir del proceso: ni el disco ni el proveedor del bucket ven el contenido.
// Sin clave, se guarda tal cual (R2 y S3 igual cifran en reposo del lado del proveedor).
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAGIA = Buffer.from("FGC1"); // formato: FGC1 | iv(12) | tag(16) | datos cifrados

function claveDesde(txt) {
  if (!txt) return null;
  const t = String(txt).trim();
  const k = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (k.length !== 32) throw new Error("DOCS_CLAVE debe tener 32 bytes (64 caracteres hex o base64). Generala con: openssl rand -hex 32");
  return k;
}
function cifrar(clave, datos) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave, iv);
  const enc = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), enc]);
}
function descifrar(clave, buf) {
  if (buf.subarray(0, 4).equals(MAGIA)) {
    if (!clave) throw new Error("El documento está cifrado y DOCS_CLAVE no está configurada.");
    const iv = buf.subarray(4, 16), tag = buf.subarray(16, 32);
    const d = crypto.createDecipheriv("aes-256-gcm", clave, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
  }
  return buf; // guardado sin cifrar (antes de configurar la clave)
}

// ---------------------------------------------------------------- disco
function driverDisco(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ruta = (k) => {
    const p = path.join(dir, ...String(k).split("/"));
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error("clave inválida");
    return p;
  };
  return {
    nombre: "disco",
    async put(k, buf) { const p = ruta(k); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + ".tmp", buf); fs.renameSync(p + ".tmp", p); },
    async get(k) { try { return fs.readFileSync(ruta(k)); } catch (e) { if (e.code === "ENOENT") return null; throw e; } },
    async del(k) { try { fs.unlinkSync(ruta(k)); } catch (e) { if (e.code !== "ENOENT") throw e; } },
  };
}

// ---------------------------------------------------------------- S3 / R2
// URL de estilo ruta (endpoint/bucket/clave): funciona igual con R2, S3 y MinIO.
//   R2:  S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  S3_REGION=auto
//   S3:  S3_ENDPOINT=https://s3.us-east-1.amazonaws.com             S3_REGION=us-east-1
function driverS3({ endpoint, region, bucket, accessKeyId, secretAccessKey, prefijo = "" }) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("ALMACENAMIENTO=s3 requiere S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY.");
  const { AwsClient } = require("aws4fetch");
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: region || "auto" });
  const base = String(endpoint).replace(/\/$/, "") + "/" + encodeURIComponent(bucket) + "/";
  const url = (k) => base + (prefijo ? prefijo.replace(/\/?$/, "/") : "") + String(k).split("/").map(encodeURIComponent).join("/");
  const pedir = async (metodo, k, body) => {
    const r = await aws.fetch(url(k), { method: metodo, body, headers: body ? { "content-type": "application/octet-stream" } : {} });
    return r;
  };
  return {
    nombre: "s3",
    async put(k, buf) { const r = await pedir("PUT", k, buf); if (!r.ok) throw new Error(`S3 PUT ${r.status}: ${(await r.text()).slice(0, 200)}`); },
    async get(k) { const r = await pedir("GET", k); if (r.status === 404) return null; if (!r.ok) throw new Error(`S3 GET ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    async del(k) { const r = await pedir("DELETE", k); if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${r.status}`); },
  };
}

/** Crea el almacén de documentos según la configuración. */
function crearBlobs({ almacenamiento = "disco", dataDir, s3 = {}, clave } = {}) {
  const k = claveDesde(clave);
  // Claves siempre con prefijo ("documentos/…", "backups/…"): en disco quedan en DATA_DIR/documentos y DATA_DIR/backups.
  const d = almacenamiento === "s3" ? driverS3(s3) : driverDisco(dataDir);
  return {
    tipo: d.nombre,
    cifrado: !!k,
    async guardar(key, datos) { await d.put(key, k ? cifrar(k, datos) : datos); },
    async leer(key) { const b = await d.get(key); return b == null ? null : descifrar(k, b); },
    async borrar(key) { await d.del(key); },
  };
}

module.exports = { crearBlobs, claveDesde, cifrar, descifrar };
