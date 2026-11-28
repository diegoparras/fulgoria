// Copias de la base: se hacen, se listan y se pueden restaurar (verificando que sean de Fulgoria).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { crearPersistencia } = require("../server/persistencia.js");

test("copia → cambios → restaurar vuelve a la copia y guarda la base anterior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fulgoria-copias-"));
  const opts = { dataDir: dir, almacenamiento: "disco", clave: "b".repeat(64), backupHoras: 0 };
  let p = crearPersistencia(opts);
  p.crearCliente("ana", { nombre: "Cliente de antes" });
  const copia = await p.backup();
  p.crearCliente("ana", { nombre: "Cliente de después" });
  assert.equal(p.clientes().length, 2);
  assert.deepEqual(await p.copias(), [copia.clave]);

  await assert.rejects(p.restaurar("backups/no-existe.sqlite"), /No encontré/);
  writeFileSync(join(dir, "basura.sqlite"), "no soy una base");
  await assert.rejects(p.restaurar(join(dir, "basura.sqlite")), /no es una base SQLite/);

  const r = await p.restaurar(copia.clave);
  assert.ok(existsSync(r.anterior));
  p = crearPersistencia(opts); // como al reiniciar el servidor
  assert.deepEqual(p.clientes().map((c) => c.nombre), ["Cliente de antes"]);
  p.cerrar();
});

test("una copia cifrada no se restaura con otra DOCS_CLAVE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fulgoria-copias-"));
  const p = crearPersistencia({ dataDir: dir, almacenamiento: "disco", clave: "c".repeat(64), backupHoras: 0 });
  const copia = await p.backup();
  p.cerrar();
  const otra = crearPersistencia({ dataDir: dir, almacenamiento: "disco", clave: "d".repeat(64), backupHoras: 0 });
  await assert.rejects(otra.restaurar(copia.clave));
  otra.cerrar();
});
