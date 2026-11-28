// Escritor de .xlsx para el dataset sintético y los tests: el mismo de la app (src/core), como Buffer.
import { escribirXlsx as escribir } from "../../src/core/xlsx-escribir.js";

/** @param {Parameters<typeof escribir>[0]} hojas */
export const escribirXlsx = (hojas) => Buffer.from(escribir(hojas));
