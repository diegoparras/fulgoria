// IA para bancos nuevos (servidor). Recibe el ESQUELETO anónimo del extracto que arma el navegador
// (src/ia.js), lo vuelve a sanear acá por las dudas y le pide al modelo configurado hasta tres
// lecturas posibles de las columnas. El navegador prueba cada una con la regla del saldo.
//
//   IA_PROVEEDOR = anthropic | openai | openrouter | local      (vacío = sin IA)
//   IA_MODELO    = modelo (anthropic: claude-opus-5-5 por defecto; los demás: obligatorio)
//   IA_API_KEY   = clave del proveedor (anthropic: también sirve ANTHROPIC_API_KEY; local: no hace falta)
//   IA_URL       = URL base (openai: https://api.openai.com/v1 · openrouter: https://openrouter.ai/api/v1
//                  · local: http://localhost:11434/v1 para Ollama, o la de LM Studio / vLLM)
"use strict";

const ROLES = ["fecha", "descripcion", "importe", "debito", "credito", "saldo", "signo", "texto", "ignorar"];

const ESQUEMA = {
  type: "object", additionalProperties: false, required: ["propuestas"],
  properties: {
    propuestas: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["explicacion", "columnas"],
        properties: {
          explicacion: { type: "string" },
          columnas: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["desde", "hasta", "rol"],
              properties: { desde: { type: "number" }, hasta: { type: "number" }, rol: { type: "string", enum: ROLES } },
            },
          },
        },
      },
    },
  },
};

const SISTEMA = `Ayudás a leer extractos bancarios argentinos en PDF. No ves el extracto: ves su esqueleto.
Cada línea del esqueleto es una línea del PDF y cada celda dice dónde está (x desde-hasta, en fracción
del ancho de la página, de 0 a 1) y qué es: fecha(patrón), importe(patrón: 9 = dígito), texto, numero,
signo(D/H), rotulo(palabra del encabezado) o rotulo_saldo (línea de saldo anterior / final).

Tu tarea: decir qué banda horizontal ocupa cada columna de la tabla de movimientos y qué rol cumple.
Roles: fecha · descripcion (el concepto, suele ser la columna de texto más ancha) · importe (una sola
columna con signo) · debito y credito (columnas separadas) · saldo (saldo corrido, suele ser la última)
· signo (columna D/H, DB/CR que da el sentido de un importe sin signo) · texto (otros datos: comprobante,
referencia, fecha valor) · ignorar.

Reglas:
- Los importes van alineados a la derecha: la banda de una columna de importes tiene que abarcar desde
  donde empieza el importe más largo hasta su borde derecho, sin pisar la columna vecina.
- Las bandas no se superponen y van de izquierda a derecha. Pueden dejar huecos.
- Si una línea de importes es ambigua (¿la última columna es saldo o créditos? ¿débito/crédito o al
  revés?), devolvé hasta 3 propuestas, de la más a la menos probable. Una sola si no hay dudas.
- En "explicacion", una oración breve con el criterio.
- Respondé solo con el JSON pedido.`;

// ---------------------------------------------------------------- saneo del esqueleto
const ROTULO = /^(FECHA|F\.?\s*VALOR|FEC\.?|CONCEPTO|DETALLE|DESCRIPCI[OÓ]N|REFERENCIA|REF\.?|COMPROB(ANTE)?\.?|N[ROº°]*\.?|NUMERO|N[UÚ]MERO|D[EÉ]BITOS?|CR[EÉ]DITOS?|IMPORTE|MONTO|SALDO|SALDOS|D\/H|DB\/CR|ORIGEN|SUCURSAL|SUC\.?|CAUSAL|MOVIMIENTO|MOVIMIENTOS|C[OÓ]DIGO|COD\.?|CARGOS?|ABONOS?|DEPOSITOS?|EXTRACCIONES|RETIROS|OPERACI[OÓ]N|PAGINA|P[AÁ]GINA|DE|TOTAL(ES)?|SALDO\s+(ANTERIOR|INICIAL|FINAL|ACTUAL|AL)|SALDO\s+[UÚ]LTIMO\s+EXTRACTO|TRANSPORTE)$/i;
const CELDA = /^(\d\.\d{3})-(\d\.\d{3}) (fecha|importe|signo|numero|rotulo|rotulo_saldo|texto)(?:\((.*)\))?$/;
/** Deja pasar solo posiciones, tipos y patrones: cualquier cosa que parezca un dato se descarta. */
function sanear(esqueleto) {
  const lineas = Array.isArray(esqueleto?.lineas) ? esqueleto.lineas.slice(0, 120) : [];
  return lineas.map((l) => String(l).slice(0, 800).split(" | ").slice(0, 20).map((c) => {
    const m = c.match(CELDA);
    if (!m) return null;
    const [, a, b, t, x] = m;
    let extra = "";
    if (x != null) {
      if ((t === "fecha" || t === "importe") && /^[9.,\-/()$\sUSD]*$/i.test(x)) extra = x;
      else if (t === "numero" && /^\d{1,2} dígitos$/.test(x)) extra = x;
      else if (t === "signo" && /^(D|H|DB|CR|C|DEB|CRED)$/.test(x)) extra = x;
      else if (t === "rotulo" && ROTULO.test(x)) extra = x;
      else if (t === "rotulo_saldo" && /^SALDO (ANTERIOR|INICIAL|FINAL|AL|ACTUAL)( \+ importe)?$/.test(x)) extra = x;
      else if (t === "rotulo" || t === "rotulo_saldo") return `${a}-${b} texto`;
    }
    return `${a}-${b} ${t}${extra ? `(${extra})` : ""}`;
  }).filter(Boolean).join(" | ")).filter(Boolean);
}

function validar(salida) {
  if (!salida || !Array.isArray(salida.propuestas)) throw new Error("El modelo no devolvió propuestas.");
  return { propuestas: salida.propuestas.slice(0, 3).map((p) => ({
    explicacion: String(p.explicacion || "").slice(0, 400),
    columnas: (Array.isArray(p.columnas) ? p.columnas : []).slice(0, 12).filter((c) => ROLES.includes(c.rol)).map((c) => ({ desde: Number(c.desde), hasta: Number(c.hasta), rol: c.rol })),
  })) };
}
function primerJson(txt) {
  const s = String(txt || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("La respuesta del modelo no es JSON.");
  return JSON.parse(s.slice(a, b + 1));
}

// ---------------------------------------------------------------- proveedores
// Claude: SDK oficial de Anthropic, salida estructurada (JSON Schema) y fallback del servidor si el
// modelo declina (solo en los modelos que lo admiten).
const CON_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);
function proveedorAnthropic({ modelo, apiKey, url }) {
  const { Anthropic } = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, ...(url ? { baseURL: url } : {}) });
  return async (texto) => {
    const fallback = CON_FALLBACK.has(modelo) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
    let r;
    try {
      r = await client.beta.messages.create({
        model: modelo, max_tokens: 16000, system: SISTEMA,
        output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
        messages: [{ role: "user", content: texto }],
        ...fallback,
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error("La clave de Anthropic no es válida (IA_API_KEY).");
      if (e instanceof Anthropic.RateLimitError) throw new Error("Anthropic está limitando los pedidos: probá en un rato.");
      if (e instanceof Anthropic.APIError) throw new Error(`Anthropic respondió ${e.status}: ${e.message}`);
      throw e;
    }
    if (r.stop_reason === "refusal") throw new Error("El modelo declinó el pedido.");
    if (r.stop_reason === "max_tokens") throw new Error("La respuesta del modelo quedó cortada.");
    return JSON.parse(r.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  };
}
// GPT, OpenRouter y modelos locales (Ollama, LM Studio, vLLM): API de chat compatible con OpenAI.
function proveedorCompatible({ modelo, apiKey, url }) {
  const base = String(url).replace(/\/$/, "");
  return async (texto) => {
    const pedir = (response_format) => fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: modelo, messages: [{ role: "system", content: SISTEMA }, { role: "user", content: texto }], response_format }),
    });
    let r = await pedir({ type: "json_schema", json_schema: { name: "columnas", strict: true, schema: ESQUEMA } });
    if (r.status === 400 || r.status === 422) r = await pedir({ type: "json_object" }); // modelo sin salida estructurada
    if (!r.ok) throw new Error(`El proveedor respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return primerJson(j?.choices?.[0]?.message?.content);
  };
}

const URL_POR_DEFECTO = { openai: "https://api.openai.com/v1", openrouter: "https://openrouter.ai/api/v1", local: "http://localhost:11434/v1" };

function crearIA({ proveedor, modelo, apiKey, url, maxPorHora = 30 } = {}) {
  const p = String(proveedor || "").toLowerCase();
  if (!p) return { disponible: false };
  if (!["anthropic", "openai", "openrouter", "local"].includes(p)) throw new Error(`IA_PROVEEDOR desconocido: ${proveedor}`);
  const m = modelo || (p === "anthropic" ? "claude-opus-5-5" : "");
  if (!m) throw new Error(`IA_PROVEEDOR=${p} requiere IA_MODELO.`);
  if (p !== "local" && !apiKey) throw new Error(`IA_PROVEEDOR=${p} requiere IA_API_KEY.`);
  const llamar = p === "anthropic" ? proveedorAnthropic({ modelo: m, apiKey, url }) : proveedorCompatible({ modelo: m, apiKey, url: url || URL_POR_DEFECTO[p] });
  const usos = new Map(); // usuario → marcas de tiempo (límite por hora: cada pedido cuesta)
  return {
    disponible: true, proveedor: p, modelo: m,
    async proponerColumnas(esqueleto, usuario = "?") {
      const ahora = Date.now(), lista = (usos.get(usuario) || []).filter((t) => ahora - t < 3600e3);
      if (lista.length >= maxPorHora) { const e = new Error(`Llegaste al máximo de ${maxPorHora} consultas a la IA por hora.`); e.status = 429; throw e; }
      lista.push(ahora); usos.set(usuario, lista);
      const lineas = sanear(esqueleto);
      if (lineas.length < 3) { const e = new Error("El esqueleto del extracto llegó vacío."); e.status = 400; throw e; }
      const texto = `Esqueleto del extracto (${Number(esqueleto.paginas) || 1} páginas; se muestran ${lineas.length} líneas):\n` + lineas.map((l, i) => `L${i + 1}: ${l}`).join("\n");
      return validar(await llamar(texto));
    },
  };
}

module.exports = { crearIA, sanear, ESQUEMA, SISTEMA };
