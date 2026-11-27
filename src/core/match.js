// Motor de emparejamiento banco ↔ libros. Cascada de estrategias, de la más segura a la más
// laxa; cada una trabaja solo sobre lo que las anteriores dejaron libre:
//
//   1. referencia  — comparten nº de cheque / comprobante / VEP y el importe es exacto
//   2. exacto      — mismo importe dentro de la ventana de fechas (asignación global)
//   3. agrupado    — 1 del banco = N del libro (depósito de varias cobranzas) o al revés
//   4. tolerancia  — importe casi igual (solo si el usuario fijó una tolerancia > 0)
//
// SEMÁFORO. Verde = probado sin ambigüedad: se confirma solo. Amarillo = propuesta razonable
// que necesita un clic. Nunca se pinta de verde algo que tenga una alternativa igual de buena:
// un emparejamiento verde equivocado es el peor error posible del producto.
import { daysBetween } from "./dates.js";
import { similarity } from "./text.js";
import { sharedEntities } from "./entities.js";
import { fmtCents } from "./money.js";

/**
 * @typedef {Object} Match
 * @property {string} id
 * @property {string[]} banco        ids del lado banco
 * @property {string[]} libros       ids del lado libros
 * @property {"referencia"|"exacto"|"agrupado"|"tolerancia"|"manual"} estrategia
 * @property {"verde"|"amarillo"} certeza
 * @property {number} puntaje        0..1
 * @property {number} diferenciaCents Σlibros − Σbanco (0 salvo en "tolerancia")
 * @property {string[]} motivos      explicación legible de por qué se emparejó
 */

const isChequeLike = (m) => !!m.entidades?.cheque || /CHEQ|\bCH\b|\bCHQ\b/i.test(m.descripcion || "");

/** Clave estable de un emparejamiento (para recordar decisiones del usuario). */
export function pairKey({ banco, libros }) {
  return [...banco].sort().join(",") + "|" + [...libros].sort().join(",");
}

/**
 * @param {import("./model.js").Mov[]} banco
 * @param {import("./model.js").Mov[]} libros
 * @param {ReturnType<import("./config.js").resolveConfig>} cfg
 * @param {{ manuales?: Array<{banco:string[], libros:string[]}>, rechazados?: Array<{banco:string[], libros:string[]}>,
 *           confirmados?: Array<{banco:string[], libros:string[]}> }} [decisiones]
 *   Decisiones del usuario: emparejamientos hechos a mano (van primero, en verde), propuestas
 *   rechazadas (el motor no las vuelve a ofrecer y busca otra) y propuestas confirmadas (pasan a verde).
 * @returns {{ matches: Match[], libresBanco: import("./model.js").Mov[], libresLibros: import("./model.js").Mov[] }}
 */
export function matchAll(banco, libros, cfg, decisiones = {}) {
  const mc = cfg.match;
  const freeB = new Map(banco.map((m) => [m.id, m]));
  const freeL = new Map(libros.map((m) => [m.id, m]));
  const matches = [];
  const rechazados = new Set((decisiones.rechazados || []).map(pairKey));
  const confirmados = new Set((decisiones.confirmados || []).map(pairKey));
  let seq = 0;
  // Devuelve false (y no empareja) si el usuario ya rechazó exactamente ese emparejamiento.
  const take = (bs, ls, props) => {
    if (props.estrategia !== "manual" && rechazados.has(pairKey({ banco: bs.map((m) => m.id), libros: ls.map((m) => m.id) }))) return false;
    bs.forEach((b) => freeB.delete(b.id));
    ls.forEach((l) => freeL.delete(l.id));
    const sb = bs.reduce((s, m) => s + m.cents, 0), sl = ls.reduce((s, m) => s + m.cents, 0);
    matches.push({ id: "M" + ++seq, banco: bs.map((m) => m.id), libros: ls.map((m) => m.id), diferenciaCents: sl - sb, ...props });
    return true;
  };

  // --- 0. Emparejamientos hechos a mano (modo deportivo): mandan sobre todo lo demás ---
  for (const d of decisiones.manuales || []) {
    const bs = d.banco.map((id) => freeB.get(id)), ls = d.libros.map((id) => freeL.get(id));
    if (!bs.length || !ls.length || bs.some((x) => !x) || ls.some((x) => !x)) continue; // ya no existen o ya usados
    take(bs, ls, { estrategia: "manual", certeza: "verde", puntaje: 1, motivos: ["emparejado a mano"] });
  }

  // Ventana de fechas del par. Más amplia hacia adelante para cheques y partidas del libro
  // arrastradas (el banco las debita semanas después), y hacia atrás para partidas del banco
  // arrastradas (el cliente las identifica y el libro las registra tarde).
  const win = (l, b) => ({
    antes: b && b.arrastre ? mc.ventanaReferenciaDias : mc.ventanaDias.antes,
    despues: isChequeLike(l) || l.arrastre ? mc.ventanaChequesDias : mc.ventanaDias.despues,
  });
  const inWin = (b, l, w = win(l, b)) => { const d = daysBetween(l.fecha, b.fecha); return d != null && d >= -w.antes && d <= w.despues; };

  // --- 1. Referencia compartida (cheque, comprobante, VEP) + importe exacto ---
  if (mc.estrategias.referencia) {
    const pairs = [];
    for (const b of freeB.values()) for (const l of freeL.values()) {
      if (b.cents !== l.cents) continue;
      const keys = sharedEntities(b.entidades, l.entidades).filter((k) => k !== "cuit" && k !== "cbu");
      if (!keys.length) continue;
      const d = daysBetween(l.fecha, b.fecha);
      if (d == null || Math.abs(d) > mc.ventanaReferenciaDias) continue;
      pairs.push({ b, l, keys, d });
    }
    const countB = countBy(pairs, (p) => p.b.id), countL = countBy(pairs, (p) => p.l.id);
    for (const p of pairs.sort((x, y) => Math.abs(x.d) - Math.abs(y.d))) {
      if (!freeB.has(p.b.id) || !freeL.has(p.l.id)) continue;
      const unico = countB.get(p.b.id) === 1 && countL.get(p.l.id) === 1;
      take([p.b], [p.l], {
        estrategia: "referencia", certeza: unico ? "verde" : "amarillo", puntaje: unico ? 1 : 0.8,
        motivos: [
          `comparten ${p.keys.map((k) => `${k} ${p.b.entidades[k]}`).join(", ")}`,
          "importe idéntico",
          diasTxt(p.d),
          ...(unico ? [] : ["hay más de un candidato con la misma referencia"]),
        ],
      });
    }
  }

  // --- 2. Importe exacto dentro de la ventana (asignación global por puntaje) ---
  if (mc.estrategias.exacto) {
    const pairs = [];
    const byAmount = groupBy([...freeL.values()], (l) => l.cents);
    for (const b of freeB.values()) {
      for (const l of byAmount.get(b.cents) || []) {
        if (!inWin(b, l)) continue;
        const d = daysBetween(l.fecha, b.fecha);
        const w = win(l, b);
        const sim = similarity(b.descripcion, l.descripcion);
        const cuit = sharedEntities(b.entidades, l.entidades).includes("cuit");
        const puntaje = round3(0.6 + 0.25 * (1 - Math.abs(d) / Math.max(1, w.despues + w.antes)) + 0.1 * sim + (cuit ? 0.05 : 0));
        pairs.push({ b, l, d, sim, cuit, puntaje });
      }
    }
    const countB = countBy(pairs, (p) => p.b.id), countL = countBy(pairs, (p) => p.l.id);
    for (const p of pairs.sort((x, y) => y.puntaje - x.puntaje || Math.abs(x.d) - Math.abs(y.d))) {
      if (!freeB.has(p.b.id) || !freeL.has(p.l.id)) continue;
      const nb = countB.get(p.b.id), nl = countL.get(p.l.id);
      const unico = nb === 1 && nl === 1;
      const verde = unico || (mc.intercambiablesVerde && p.b.cents === p.l.cents);
      const motivos = ["importe idéntico", diasTxt(p.d)];
      if (p.cuit) motivos.push(`mismo CUIT ${p.b.entidades.cuit}`);
      if (p.sim >= 0.3) motivos.push("descripciones parecidas");
      if (!unico) motivos.push(`hay ${Math.max(nb, nl)} movimientos con el mismo importe en la ventana: elegí el de fecha más cercana`);
      take([p.b], [p.l], { estrategia: "exacto", certeza: verde ? "verde" : "amarillo", puntaje: p.puntaje, motivos });
    }
  }

  // --- 3. Agrupados: 1 banco = N libros, y 1 libro = N banco ---
  if (mc.estrategias.agrupado) {
    const ag = mc.agrupado;
    const grupo = (uno, pool, ladoUno) => {
      const cands = pool
        .filter((x) => Math.sign(x.cents) === Math.sign(uno.cents) && Math.abs(x.cents) < Math.abs(uno.cents))
        .filter((x) => {
          // El banco registra el total DESPUÉS (o el mismo día) que las partidas del libro.
          const d = ladoUno === "banco" ? daysBetween(x.fecha, uno.fecha) : daysBetween(uno.fecha, x.fecha);
          return d != null && d >= -mc.ventanaDias.antes && d <= ag.ventanaDias;
        })
        .sort((a, b) => Math.abs(daysBetween(a.fecha, uno.fecha)) - Math.abs(daysBetween(b.fecha, uno.fecha)))
        .slice(0, ag.maxCandidatos);
      return subsetSums(cands, uno.cents, ag.maxItems, 3);
    };
    for (const b of [...freeB.values()].sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents))) {
      if (!freeB.has(b.id)) continue;
      const sols = grupo(b, [...freeL.values()], "banco");
      for (const ls of sols) {
        if (take([b], ls, {
          estrategia: "agrupado", certeza: "amarillo", puntaje: sols.length === 1 ? 0.75 : 0.6,
          motivos: [`el movimiento del banco (${fmtCents(b.cents)}) es la suma exacta de ${ls.length} registros del libro`,
            ...(sols.length > 1 ? ["hay otra combinación posible con el mismo total"] : [])],
        })) break;
      }
    }
    for (const l of [...freeL.values()].sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents))) {
      if (!freeL.has(l.id)) continue;
      const sols = grupo(l, [...freeB.values()], "libros");
      for (const bs of sols) {
        if (take(bs, [l], {
          estrategia: "agrupado", certeza: "amarillo", puntaje: sols.length === 1 ? 0.75 : 0.6,
          motivos: [`el registro del libro (${fmtCents(l.cents)}) es la suma exacta de ${bs.length} movimientos del banco`,
            ...(sols.length > 1 ? ["hay otra combinación posible con el mismo total"] : [])],
        })) break;
      }
    }
  }

  // --- 4. Tolerancia de importe (solo si se configuró) ---
  if (mc.estrategias.tolerancia && mc.toleranciaCents > 0) {
    const pairs = [];
    for (const b of freeB.values()) for (const l of freeL.values()) {
      const diff = l.cents - b.cents;
      if (diff === 0 || Math.abs(diff) > mc.toleranciaCents || Math.sign(b.cents) !== Math.sign(l.cents) || !inWin(b, l)) continue;
      pairs.push({ b, l, diff, d: daysBetween(l.fecha, b.fecha) });
    }
    for (const p of pairs.sort((x, y) => Math.abs(x.diff) - Math.abs(y.diff) || Math.abs(x.d) - Math.abs(y.d))) {
      if (!freeB.has(p.b.id) || !freeL.has(p.l.id)) continue;
      take([p.b], [p.l], {
        estrategia: "tolerancia", certeza: "amarillo", puntaje: 0.5,
        motivos: [`importe con diferencia de ${fmtCents(p.diff)} (libros − banco)`, diasTxt(p.d)],
      });
    }
  }

  // Propuestas que el usuario ya confirmó: pasan a verde.
  for (const m of matches) {
    if (m.certeza === "amarillo" && confirmados.has(pairKey(m))) { m.certeza = "verde"; m.confirmado = true; m.motivos = [...m.motivos, "confirmado por el usuario"]; }
  }
  return { matches, libresBanco: [...freeB.values()], libresLibros: [...freeL.values()] };
}

/**
 * Subconjuntos de `items` (tamaño 2..maxItems) cuya suma de cents es exactamente `target`.
 * Búsqueda acotada (corta a las `limit` soluciones y a un máximo de pasos) para que un
 * extracto grande no cuelgue la interfaz.
 */
export function subsetSums(items, target, maxItems, limit = 2) {
  const xs = [...items].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const sols = [];
  let steps = 0;
  const absT = Math.abs(target);
  const suffix = []; // suma de |cents| desde i en adelante (poda)
  for (let i = xs.length - 1, s = 0; i >= 0; i--) { s += Math.abs(xs[i].cents); suffix[i] = s; }
  const dfs = (start, acc, pick) => {
    if (sols.length >= limit || ++steps > 50000) return;
    if (acc === absT && pick.length >= 2) { sols.push([...pick]); return; }
    if (pick.length >= maxItems) return;
    for (let i = start; i < xs.length; i++) {
      const v = Math.abs(xs[i].cents);
      if (acc + v > absT) continue;
      if (acc + suffix[i] < absT) return; // ni sumando todo lo que queda llego
      pick.push(xs[i]); dfs(i + 1, acc + v, pick); pick.pop();
      if (sols.length >= limit) return;
    }
  };
  dfs(0, 0, []);
  return sols;
}

function countBy(arr, key) { const m = new Map(); for (const x of arr) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; }
function groupBy(arr, key) { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function round3(n) { return Math.round(n * 1000) / 1000; }
function diasTxt(d) { return d === 0 ? "misma fecha" : d > 0 ? `el banco lo registró ${d} día${d > 1 ? "s" : ""} después` : `el banco lo registró ${-d} día${d < -1 ? "s" : ""} antes`; }
