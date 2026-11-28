// Núcleo de conciliación de Fulgoria. JS puro (ESM), sin DOM ni dependencias: corre igual en
// el navegador y en Node. Todo el dinero en centavos enteros; fechas en ISO.
export { toCents, fromCents, parseMoneyCents, fmtCents, sumCents } from "./money.js";
export { toISO, dayNum, daysBetween, fmtISO } from "./dates.js";
export { normText, tokens, similarity } from "./text.js";
export { extractEntities, sharedEntities } from "./entities.js";
export { makeMov, fromExtract } from "./model.js";
export { DEFAULTS, resolveConfig } from "./config.js";
export { RULES, GRUPOS_AJUSTABLES, classify, classifyAll } from "./classify.js";
export { parseCsv, detectSeparator } from "./csv.js";
export { detectLedgerColumns, parseLedgerCsv, parseLedgerRows, ROLES_MAYOR, adivinarFilaEncabezado, crearPlantillaMayor, ubicarPlantillaMayor, reconocerPlantillaMayor, parseLedgerConPlantilla } from "./ledger.js";
export { matchAll, subsetSums, pairKey, conflictoIdentidad } from "./match.js";
export { reconcile, arrastreSiguiente, continuidad, TIPOS_PENDIENTE } from "./reconcile.js";
export { papelSaldoASaldo, papelToMarkdown, papelToCsv, asientosToCsv, bandejaToText } from "./workpaper.js";
export { clasificarPlanilla, detectarColumnasExtracto, leerExtractoPlanilla, leerMercadoPago } from "./tabla.js";
export { leerXlsx } from "./xlsx.js";
