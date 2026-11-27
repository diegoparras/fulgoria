// IA para bancos nuevos (servidor). Recibe el ESQUELETO anónimo del extracto que arma el navegador
// (src/ia.js), lo vuelve a sanear acá por las dudas y le pide al modelo configurado hasta tres
// lecturas posibles de las columnas. El navegador prueba cada una con la regla del saldo.
//
//   IA_PROVEEDOR = anthropic | openai | gemini | openrouter | local   (vacío = sin IA)
//   (o desde la pantalla, por un admin: queda en la base y manda sobre el .env)
//   IA_MODELO    = modelo (anthropic: claude-opus-5-5 por defecto; los demás: obligatorio)
//   IA_API_KEY   = clave del proveedor (anthropic: también sirve ANTHROPIC_API_KEY; local: no hace falta)
//   IA_TEMPERATURA = opcional (0 a 2); si el modelo no la acepta se reintenta sin ella
//   IA_URL       = URL base (openai: https://api.openai.com/v1 · gemini: …/v1beta/openai · openrouter: https://openrouter.ai/api/v1
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
// Parámetros opcionales: la temperatura solo se manda si el admin la fijó, y si el modelo la rechaza
// (los de razonamiento de OpenAI, los Claude actuales, etc.) se reintenta sin ella y se recuerda
// para ese modelo. Tampoco se manda max_tokens a las APIs compatibles con OpenAI: varios modelos
// nuevos lo rechazan (piden max_completion_tokens) y la respuesta es corta de todos modos.
const rechazaTemperatura = (txt) => /temperature/i.test(String(txt || ""));

// Claude: SDK oficial de Anthropic, salida estructurada (JSON Schema) y fallback del servidor si el
// modelo declina (solo en los modelos que lo admiten).
const CON_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);
function proveedorAnthropic({ modelo, apiKey, url, temperatura }) {
  const { Anthropic } = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, ...(url ? { baseURL: url } : {}) });
  let conTemperatura = temperatura != null;
  const traducir = (e) => {
    if (e instanceof Anthropic.AuthenticationError) return new Error("La clave de Anthropic no es válida.");
    if (e instanceof Anthropic.RateLimitError) return new Error("Anthropic está limitando los pedidos: probá en un rato.");
    if (e instanceof Anthropic.APIError) return new Error(`Anthropic respondió ${e.status}: ${e.message}`);
    return e;
  };
  const llamar = async (texto) => {
    const fallback = CON_FALLBACK.has(modelo) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
    let r;
    for (;;) {
      try {
        r = await client.beta.messages.create({
          model: modelo, max_tokens: 16000, system: SISTEMA,
          output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
          messages: [{ role: "user", content: texto }],
          ...(conTemperatura ? { temperature: temperatura } : {}),
          ...fallback,
        });
        break;
      } catch (e) {
        if (conTemperatura && e instanceof Anthropic.BadRequestError && rechazaTemperatura(e.message)) { conTemperatura = false; continue; }
        throw traducir(e);
      }
    }
    if (r.stop_reason === "refusal") throw new Error("El modelo declinó el pedido.");
    if (r.stop_reason === "max_tokens") throw new Error("La respuesta del modelo quedó cortada.");
    return JSON.parse(r.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  };
  llamar.modelos = async () => {
    try { const out = []; for await (const m of client.models.list()) out.push(m.id); return out; }
    catch (e) { throw traducir(e); }
  };
  return llamar;
}

// GPT, Gemini, OpenRouter y modelos locales (Ollama, LM Studio, vLLM): API de chat compatible con
// OpenAI. Si el modelo no admite salida con esquema se pasa a json_object, y si tampoco, a texto
// libre (se toma el primer JSON de la respuesta).
function proveedorCompatible({ modelo, apiKey, url, temperatura, nombre = "El proveedor" }) {
  const base = String(url).replace(/\/$/, "");
  const headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  let conTemperatura = temperatura != null;
  const llamar = async (texto) => {
    let formato = { type: "json_schema", json_schema: { name: "columnas", strict: true, schema: ESQUEMA } };
    for (let intento = 0; ; intento++) {
      const r = await fetch(base + "/chat/completions", {
        method: "POST", headers,
        body: JSON.stringify({
          model: modelo, messages: [{ role: "system", content: SISTEMA }, { role: "user", content: texto }],
          ...(formato ? { response_format: formato } : {}),
          ...(conTemperatura ? { temperature: temperatura } : {}),
        }),
      });
      if (r.ok) { const j = await r.json(); return primerJson(j?.choices?.[0]?.message?.content); }
      const cuerpo = (await r.text()).slice(0, 400);
      if ((r.status === 400 || r.status === 422) && intento < 4) {
        if (conTemperatura && rechazaTemperatura(cuerpo)) { conTemperatura = false; continue; }
        if (formato?.type === "json_schema") { formato = { type: "json_object" }; continue; }
        if (formato) { formato = null; continue; }
      }
      if (r.status === 401 || r.status === 403) throw new Error(`${nombre} rechazó la clave de API (${r.status}).`);
      throw new Error(`${nombre} respondió ${r.status}: ${cuerpo.slice(0, 200)}`);
    }
  };
  llamar.modelos = async () => {
    const r = await fetch(base + "/models", { headers });
    if (!r.ok) throw new Error(`${nombre} respondió ${r.status} al listar modelos.`);
    const j = await r.json();
    return (Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : []).map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean);
  };
  return llamar;
}

const PROVEEDORES = {
  anthropic: { nombre: "Claude (Anthropic)", modelo: "claude-opus-5-5", clave: true },
  openai: { nombre: "OpenAI", url: "https://api.openai.com/v1", clave: true },
  gemini: { nombre: "Gemini (Google)", url: "https://generativelanguage.googleapis.com/v1beta/openai", clave: true },
  openrouter: { nombre: "OpenRouter", url: "https://openrouter.ai/api/v1", clave: true },
  local: { nombre: "Modelo local (Ollama, LM Studio, vLLM)", url: "http://localhost:11434/v1", clave: false },
};
const URL_POR_DEFECTO = Object.fromEntries(Object.entries(PROVEEDORES).filter(([, v]) => v.url).map(([k, v]) => [k, v.url]));

// Un esqueleto mínimo para probar la conexión (no es de ningún extracto).
const ESQUELETO_PRUEBA = { paginas: 1, lineas: [
  "0.060-0.120 rotulo(FECHA) | 0.180-0.300 rotulo(CONCEPTO) | 0.640-0.700 rotulo(DEBITO) | 0.760-0.820 rotulo(CREDITO) | 0.900-0.960 rotulo(SALDO)",
  "0.060-0.140 fecha(99/99/9999) | 0.180-0.480 texto | 0.740-0.820 importe(9.999,99) | 0.880-0.960 importe(9.999,99)",
  "0.060-0.140 fecha(99/99/9999) | 0.180-0.480 texto | 0.650-0.700 importe(999,99) | 0.880-0.960 importe(9.999,99)",
] };

/** Normaliza lo que manda el admin (o el .env). Lanza un Error con un mensaje para mostrar. */
function validarConfig(c = {}) {
  const proveedor = String(c.proveedor || "").toLowerCase();
  if (!PROVEEDORES[proveedor]) throw new Error(`Proveedor desconocido: ${c.proveedor}. Opciones: ${Object.keys(PROVEEDORES).join(", ")}.`);
  const modelo = String(c.modelo || PROVEEDORES[proveedor].modelo || "").trim().slice(0, 200);
  if (!modelo) throw new Error("Falta el modelo.");
  const url = String(c.url || "").trim();
  if (url && (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 500)) throw new Error("La URL tiene que empezar con http:// o https://.");
  let temperatura = c.temperatura === "" || c.temperatura == null ? null : Number(c.temperatura);
  if (temperatura != null && !(Number.isFinite(temperatura) && temperatura >= 0 && temperatura <= 2)) throw new Error("La temperatura va de 0 a 2 (o vacía para no mandarla).");
  const maxPorHora = c.maxPorHora == null || c.maxPorHora === "" ? 30 : Number(c.maxPorHora);
  if (!(Number.isInteger(maxPorHora) && maxPorHora >= 1 && maxPorHora <= 1000)) throw new Error("Consultas por hora: un número entero de 1 a 1000.");
  return { proveedor, modelo, url, temperatura, maxPorHora };
}

function crearIA({ proveedor, modelo, apiKey, url, temperatura = null, maxPorHora = 30 } = {}) {
  const p = String(proveedor || "").toLowerCase();
  if (!p) return { disponible: false };
  if (!PROVEEDORES[p]) throw new Error(`IA_PROVEEDOR desconocido: ${proveedor}`);
  const m = modelo || PROVEEDORES[p].modelo || "";
  if (!m) throw new Error(`IA_PROVEEDOR=${p} requiere IA_MODELO.`);
  if (PROVEEDORES[p].clave && !apiKey) throw new Error(`IA_PROVEEDOR=${p} requiere IA_API_KEY.`);
  const t = temperatura == null || temperatura === "" ? null : Number(temperatura);
  const llamar = p === "anthropic"
    ? proveedorAnthropic({ modelo: m, apiKey, url, temperatura: t })
    : proveedorCompatible({ modelo: m, apiKey, url: url || URL_POR_DEFECTO[p], temperatura: t, nombre: PROVEEDORES[p].nombre });
  const usos = new Map(); // usuario → marcas de tiempo (límite por hora: cada pedido cuesta)
  const consultar = async (esqueleto) => {
    const lineas = sanear(esqueleto);
    if (lineas.length < 3) { const e = new Error("El esqueleto del extracto llegó vacío."); e.status = 400; throw e; }
    const texto = `Esqueleto del extracto (${Number(esqueleto.paginas) || 1} páginas; se muestran ${lineas.length} líneas):\n` + lineas.map((l, i) => `L${i + 1}: ${l}`).join("\n");
    return validar(await llamar(texto));
  };
  return {
    disponible: true, proveedor: p, modelo: m, temperatura: t,
    async proponerColumnas(esqueleto, usuario = "?") {
      const ahora = Date.now(), lista = (usos.get(usuario) || []).filter((x) => ahora - x < 3600e3);
      if (lista.length >= maxPorHora) { const e = new Error(`Llegaste al máximo de ${maxPorHora} consultas a la IA por hora.`); e.status = 429; throw e; }
      lista.push(ahora); usos.set(usuario, lista);
      return consultar(esqueleto);
    },
    /** Prueba real de punta a punta con un esqueleto de ejemplo (para el admin). */
    async probar() { const t0 = Date.now(); const r = await consultar(ESQUELETO_PRUEBA); return { ms: Date.now() - t0, propuestas: r.propuestas.length }; },
    listarModelos: () => llamar.modelos(),
  };
}

module.exports = { crearIA, sanear, validarConfig, PROVEEDORES, ESQUEMA, SISTEMA };
