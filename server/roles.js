// Roles del modo estudio. Cuatro niveles, cada uno incluye al anterior:
//
//   lector      ve todo (tablero, meses, papeles de trabajo); no cambia nada
//   preparador  + crea clientes y cuentas, sube documentos, concilia y marca "preparado"
//   revisor     + marca "revisado", cierra y reabre meses, borra plantillas
//   admin       + administra los usuarios (modo standalone)
//
// Standalone: el usuario del .env (AUTH_USER) es admin y da de alta al resto (se guardan en la
// base del estudio). Federado con Lockatus: el rol viene en el token; LOCKATUS_ROLES permite
// traducir nombres ("contador=preparador,socio=revisor"). Un rol desconocido es lector: si Lockatus
// dejó entrar a la persona pero no se sabe qué puede hacer, solo mira.
"use strict";

const ROLES = ["lector", "preparador", "revisor", "admin"];
const PERMISOS = {
  lector: ["leer"],
  preparador: ["leer", "editar", "preparar"],
  revisor: ["leer", "editar", "preparar", "revisar"],
  admin: ["leer", "editar", "preparar", "revisar", "administrar"],
};

const permisosDe = (rol) => PERMISOS[rol] || PERMISOS.lector;
const puede = (rol, permiso) => permisosDe(rol).includes(permiso);

/** "contador=preparador, socio=revisor" → { contador: "preparador", socio: "revisor" } */
function parsearMapa(txt) {
  const m = {};
  for (const par of String(txt || "").split(",")) {
    const [a, b] = par.split("=").map((s) => s && s.trim().toLowerCase());
    if (a && ROLES.includes(b)) m[a] = b;
  }
  return m;
}

/** Rol de Fulgoria para el rol que manda Lockatus (o una lista de roles: gana el más alto). */
function rolDesdeLockatus(rolLk, mapa = {}) {
  const lista = (Array.isArray(rolLk) ? rolLk : [rolLk]).filter(Boolean).map((r) => String(r).trim().toLowerCase());
  let mejor = "lector";
  for (const r of lista) {
    const f = mapa[r] || (ROLES.includes(r) ? r : null);
    if (f && ROLES.indexOf(f) > ROLES.indexOf(mejor)) mejor = f;
  }
  return mejor;
}

module.exports = { ROLES, PERMISOS, permisosDe, puede, parsearMapa, rolDesdeLockatus };
