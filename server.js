// Fulgoria — servidor. Sirve la app estática + un login opcional desde el .env.
// El documento se PROCESA 100% en el navegador. Con PERSISTENCIA=on, además guarda el trabajo del
// estudio (clientes, cuentas, meses, documentos) en su propio servidor o en su bucket S3/R2
// (ver server/persistencia.js); con PERSISTENCIA=off (default) no guarda nada, como siempre.
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// --- CLI: generar el hash bcrypt para AUTH_PASSWORD ---
//   node server.js --hash 'tu-contraseña'
if (process.argv[2] === "--hash") {
  const pw = process.argv[3];
  if (!pw) { console.error("Uso: node server.js --hash '<contraseña>'"); process.exit(1); }
  console.log(bcrypt.hashSync(pw, 12));
  process.exit(0);
}

// Lo primero que se ve en los registros al levantar (EasyPanel): version y que cambia, leido del
// CHANGELOG.md. Va antes de validar el .env para que salga aunque falte configuracion. Nunca
// rompe el arranque: sin CHANGELOG dice "Sin notas para esta version".
const nov = require("./novedades.js");
const APP_VERSION = (() => {
  try { return require("./package.json").version || ""; } catch { return ""; }
})();
try {
  for (const l of nov.cartelArranque(APP_VERSION, nov.todas())) console.log(`[fulgoria] ${l}`);
} catch {}

const PORT = Number(process.env.PORT || 3000);
const AUTH_ENABLED = String(process.env.AUTH_ENABLED ?? "true").toLowerCase() === "true";
const AUTH_USER = process.env.AUTH_USER || "";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ""; // hash bcrypt
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE ?? "true").toLowerCase() === "true";
const TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 3600 * 1000;
const COOKIE = "fulgoria_auth";
const ESCRIBA_URL = process.env.ESCRIBA_URL || ""; // destino de "Enviar a Escriba" (vacío → "/")

// --- Persistencia del estudio (opcional) ---
const PERSISTENCIA = String(process.env.PERSISTENCIA || "off").toLowerCase() === "on";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));

// --- Federación opcional con Lockatus (el hub de identidad de la suite). Flag: local | federado.
//     Default `local` → todo sigue exactamente como hoy (login propio del .env). ---
const AUTH_MODE = String(process.env.AUTH_MODE || "local").toLowerCase();
const LK_ISSUER = String(process.env.LOCKATUS_ISSUER || "").replace(/\/$/, "");
const LK_CLIENT = process.env.LOCKATUS_CLIENT_ID || "fulgoria";
const LK_REDIRECT = process.env.LOCKATUS_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const OIDC_COOKIE = "fulgoria_oidc"; // cookie de transacción (verifier/state/nonce) durante el login

// La versión real de la app (APP_VERSION, de package.json, arriba) se inyecta en el <meta>
// para el "Acerca de".

// Las páginas (index.html y conciliar.html) con el destino de Escriba y la versión inyectados en sus
// <meta> (una sola lectura al arrancar). La versión la muestra el "Acerca de" del header compartido.
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pagina = (archivo) => fs.readFileSync(path.join(__dirname, archivo), "utf8")
  .replace(
    '<meta name="fulgoria-escriba-url" content="" />',
    `<meta name="fulgoria-escriba-url" content="${escAttr(ESCRIBA_URL)}" />`,
  )
  .replace(
    '<meta name="fulgoria-version" content="" />',
    `<meta name="fulgoria-version" content="${escAttr(APP_VERSION)}" />`,
  )
  // Cada versión pide sus estilos y scripts con su número (?v=1.3.1): un navegador o un proxy que
  // guardó el CSS de la versión anterior no puede mezclarlo con la página nueva.
  .replace(/(href="styles\/[\w.-]+\.css|src="src\/[\w.-]+\.js)"/g, `$1?v=${encodeURIComponent(APP_VERSION)}"`);
const INDEX_HTML = pagina("index.html");
const CONCILIAR_HTML = pagina("conciliar.html");

if (AUTH_ENABLED && AUTH_MODE === "federado" && (!SESSION_SECRET || !LK_ISSUER)) {
  console.error("AUTH_MODE=federado requiere SESSION_SECRET y LOCKATUS_ISSUER en el .env.");
  process.exit(1);
}
if (AUTH_ENABLED && AUTH_MODE !== "federado" && (!AUTH_USER || !AUTH_PASSWORD || !SESSION_SECRET)) {
  console.error("AUTH_ENABLED=true requiere AUTH_USER, AUTH_PASSWORD y SESSION_SECRET en el .env.");
  console.error("AUTH_PASSWORD puede ser tu contraseña en texto plano, o un hash bcrypt (node server.js --hash '…').");
  console.error("Generá el SESSION_SECRET con:  openssl rand -hex 32");
  process.exit(1);
}

// Cliente de Lockatus solo en modo federado (carga perezosa, sin deps nuevas).
const lk = AUTH_ENABLED && AUTH_MODE === "federado"
  ? require("./lockatus.js").createLockatus({ issuer: LK_ISSUER, clientId: LK_CLIENT, redirectUri: LK_REDIRECT })
  : null;

// AUTH_PASSWORD admite texto plano (como Escriba/Fisherboy) O un hash bcrypt (opcional, más seguro
// si el .env se filtra). Auto-detección por el prefijo del hash.
const PASS_IS_HASH = /^\$2[aby]\$/.test(AUTH_PASSWORD);
function passwordOk(input) {
  const p = String(input || "");
  if (PASS_IS_HASH) return bcrypt.compareSync(p, AUTH_PASSWORD);
  // Comparación en tiempo constante (hasheo ambos a 32 bytes para no filtrar el largo).
  const h = (s) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(p), h(AUTH_PASSWORD));
}

const app = express();
app.disable("x-powered-by");
let persistencia = null; // modo estudio (PERSISTENCIA=on)
if (PERSISTENCIA) {
  const { crearPersistencia } = require("./server/persistencia.js");
  persistencia = crearPersistencia({
    dataDir: DATA_DIR,
    almacenamiento: String(process.env.ALMACENAMIENTO || "disco").toLowerCase(),
    s3: { endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "auto", bucket: process.env.S3_BUCKET, accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, prefijo: process.env.S3_PREFIJO || "" },
    clave: process.env.DOCS_CLAVE || "",
    backupHoras: Number(process.env.BACKUP_HORAS ?? 24),
    revisionIndependiente: String(process.env.REVISION_INDEPENDIENTE || "off").toLowerCase() === "on",
  });
}
// --- IA para bancos nuevos (opcional). Recibe solo el esqueleto anónimo del extracto (posiciones y
//     tipos de celda, nunca datos) y propone columnas; la regla del saldo decide en el navegador.
//     La configura un admin desde Conciliar → IA (queda en la base, con la clave cifrada) o, si no,
//     el .env (IA_PROVEEDOR…). Ver server/ia.js. ---
const { crearIA, normalizarAjuste } = require("./server/ia.js");
const IA_ENV = {
  proveedor: process.env.IA_PROVEEDOR, modelo: process.env.IA_MODELO,
  apiKey: process.env.IA_API_KEY || (String(process.env.IA_PROVEEDOR || "").toLowerCase() === "anthropic" ? process.env.ANTHROPIC_API_KEY : ""),
  url: process.env.IA_URL, temperatura: process.env.IA_TEMPERATURA || null, maxPorHora: Number(process.env.IA_MAX_POR_HORA || 30),
};
function iaSegura(cfg, origen) {
  try { return Object.assign(crearIA(cfg), { origen }); }
  catch (e) { console.error(`[fulgoria] IA mal configurada (${origen}): ${e.message}`); return { disponible: false, origen, error: e.message }; }
}
const gestorIA = {
  actual: { disponible: false, origen: "ninguno" },
  env: IA_ENV.proveedor ? { proveedor: String(IA_ENV.proveedor).toLowerCase(), modelo: IA_ENV.modelo || null, url: IA_ENV.url || "", conClave: !!IA_ENV.apiKey } : null,
  crear: (cfg) => crearIA(cfg),
  /** La clave del .env sirve si el proveedor elegido es el mismo del .env. */
  claveEnv: (prov) => (String(IA_ENV.proveedor || "").toLowerCase() === prov ? IA_ENV.apiKey || "" : ""),
  recargar() {
    const g = normalizarAjuste(persistencia && persistencia.ajuste("ia"));
    if (g && g.modo === "ninguna") this.actual = { disponible: false, origen: "panel", apagada: true };
    else if (g && g.modo === "local" && g.local) this.actual = iaSegura({ ...g.local, proveedor: "local", maxPorHora: g.maxPorHora }, "panel");
    else if (g && g.modo === "externa" && g.externa) {
      let apiKey = "";
      try { apiKey = g.externa.claveCifrada ? persistencia.descifrarSecreto(g.externa.claveCifrada) : this.claveEnv(g.externa.proveedor); } catch { console.error("[fulgoria] no pude descifrar la clave de la IA (¿cambió DOCS_CLAVE?)"); }
      this.actual = iaSegura({ ...g.externa, apiKey, maxPorHora: g.maxPorHora }, "panel");
    } else this.actual = IA_ENV.proveedor ? iaSegura(IA_ENV, "env") : { disponible: false, origen: "ninguno" };
    if (this.actual.disponible) console.log(`[fulgoria] IA para bancos nuevos: ${this.actual.proveedor} · ${this.actual.modelo} (${this.actual.origen === "panel" ? "configurada desde la pantalla" : ".env"})`);
    else if (this.actual.apagada) console.log("[fulgoria] IA para bancos nuevos: apagada desde la pantalla");
    return this.actual;
  },
};
gestorIA.recargar();

app.set("trust proxy", 1); // detrás del reverse proxy de EasyPanel (termina TLS)
app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

// --- Cookie de sesión firmada, SIN estado (no hay store; sobrevive reinicios) ---
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return data + "." + sig;
}
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  const a = Buffer.from(sig), e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try { const p = JSON.parse(Buffer.from(data, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
// Identidad de la sesión: { u, rol }. Standalone: el usuario del .env es admin y los demás salen de
// la base del estudio (se relee en cada pedido: desactivar a alguien o cambiarle el rol tiene efecto
// inmediato). Federado: el rol viene de Lockatus (ver server/roles.js). Sin login: "local", admin.
const { rolDesdeLockatus, parsearMapa } = require("./server/roles.js");
const MAPA_LK = parsearMapa(process.env.LOCKATUS_ROLES || "");
function identidad(req) {
  if (!AUTH_ENABLED) return { u: "local", rol: "admin" };
  const p = verify(req.cookies[COOKIE]);
  if (!p || !p.u) return null;
  if (AUTH_MODE === "federado") return { u: p.u, rol: rolDesdeLockatus(p.role, MAPA_LK) };
  if (p.u === AUTH_USER) return { u: p.u, rol: "admin" };
  const x = persistencia && persistencia.usuario(p.u);
  return x && x.activo ? { u: x.usuario, rol: x.rol } : null;
}
const authed = (req) => !!identidad(req);

// --- Headers de seguridad + CSP. Permite lo que la app necesita (workers/wasm de PDF.js y
//     Tesseract, data:/blob: para canvas/chevron) y nada más. Todo same-origin: sin CDN. ---
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",   // Tesseract usa WebAssembly; PDF.js sin eval
  "style-src 'self' 'unsafe-inline'",        // hay style="" inline en el HTML
  "img-src 'self' data: blob:",
  "font-src 'self'",                          // Inter vendorizada
  "worker-src 'self' blob:",                  // workers de PDF.js / Tesseract
  "connect-src 'self' blob: data:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

// --- Login (form POST clásico → sin JS inline, CSP-friendly) ---
const fails = new Map(); // anti fuerza-bruta simple por IP
function loginPage(err) {
  const msg = err ? `<p class="err">${err}</p>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fulgoria — Ingresar</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>
:root{--bg:#fafbfc;--panel:#fff;--ink:#16181d;--muted:#5f6b7a;--line:rgba(15,23,42,.12);--accent:#3b76d9;--on-accent:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#090c11;--panel:#111720;--ink:#eaeef4;--muted:#8a95a4;--line:rgba(255,255,255,.11);--accent:#6f9eea;--on-accent:#07101b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;padding:20px}
.card{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:30px 28px;
box-shadow:0 12px 40px rgba(15,23,42,.12);text-align:center}
.logo{display:flex;gap:10px;align-items:center;justify-content:center;font-weight:700;font-size:20px;letter-spacing:-.02em;margin-bottom:4px}
.logo svg{width:28px;height:28px}.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
label{display:block;text-align:left;font-size:12.5px;color:var(--muted);margin:12px 0 5px}
input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;font-size:15px;cursor:pointer}
button:hover{filter:brightness(1.06)}.err{color:#cf222e;font-size:13px;margin:14px 0 0}
.pwrap{position:relative;display:flex;align-items:center}.pwrap>input{flex:1 1 auto;padding-right:38px}
.ptog{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:30px;height:30px;display:grid;place-items:center;background:none;border:0;border-radius:7px;color:var(--muted);cursor:pointer}
.ptog:hover{color:var(--ink)}.ptog svg{width:17px;height:17px}
</style></head><body><form class="card" method="post" action="/login" autocomplete="on">
<div class="logo"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="15" fill="#3b76d9"/><path d="M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z" transform="translate(2,2) scale(2.5)" fill="#fff"/></svg>Fulgoria</div>
<p class="sub">Extraé datos de cualquier documento.</p>
<label for="u">Usuario</label><input id="u" name="user" autocomplete="username" required autofocus>
<label for="p">Contraseña</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Ingresar</button>${msg}</form><script src="/login-eye.js"></script></body></html>`;
}
// Ojito mostrar/ocultar para el campo de contraseña del login. Externo (no inline) porque el
// CSP del login es script-src 'self' sin 'unsafe-inline'. Se sirve ANTES de la puerta de auth.
const LOGIN_EYE_JS = `(function(){var i=document.getElementById('p');if(!i)return;
var EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
var OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.4 13.4 0 0 0 2 11s3.6 7 10 7a9.1 9.1 0 0 0 5.4-1.6"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
var w=document.createElement('span');w.className='pwrap';i.parentNode.insertBefore(w,i);w.appendChild(i);
var b=document.createElement('button');b.type='button';b.className='ptog';b.tabIndex=-1;b.setAttribute('aria-label','Mostrar u ocultar la contraseña');b.innerHTML=EYE;
b.addEventListener('click',function(){var s=i.type==='password';i.type=s?'text':'password';b.innerHTML=s?OFF:EYE;i.focus();});w.appendChild(b);})();`;
app.get("/login", (req, res) => {
  if (authed(req)) return res.redirect("/");
  if (AUTH_MODE === "federado") {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("base64url"), nonce = crypto.randomBytes(16).toString("base64url");
    res.cookie(OIDC_COOKIE, sign({ verifier, state, nonce, exp: Date.now() + 600000 }), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: 600000 });
    return res.redirect(lk.authorizeUrl({ state, nonce, challenge }));
  }
  const e = req.query.e === "2" ? "Demasiados intentos. Esperá un minuto." : req.query.e ? "Usuario o contraseña incorrectos." : "";
  res.type("html").send(loginPage(e));
});

// Vuelta de Lockatus (federado): canjea el código, verifica los tokens (RS256/JWKS) y siembra la
// MISMA cookie de sesión que usa el login propio → el resto del gate de Fulgoria no cambia.
app.get("/callback", async (req, res) => {
  if (AUTH_MODE !== "federado") return res.redirect("/login");
  try {
    if (req.query.error) return res.status(403).type("html").send(`<p>Acceso denegado por Lockatus: ${String(req.query.error).replace(/[<>&"]/g, "")}</p>`);
    const tx = verify(req.cookies[OIDC_COOKIE]);
    if (!tx || !req.query.code || req.query.state !== tx.state) return res.redirect("/login?e=1");
    const tok = await lk.exchange({ code: String(req.query.code), verifier: tx.verifier });
    await lk.verifyJwt(tok.id_token, { audience: LK_CLIENT, nonce: tx.nonce });
    const ac = await lk.verifyJwt(tok.access_token, { audience: LK_CLIENT });
    res.clearCookie(OIDC_COOKIE);
    res.cookie(COOKIE, sign({ u: ac.email, role: ac.role, exp: Date.now() + TTL_MS }), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: TTL_MS });
    res.redirect("/");
  } catch { res.redirect("/login?e=1"); }
});
app.post("/login", (req, res) => {
  const ip = req.ip || "?";
  const f = fails.get(ip);
  if (f && f.count >= 8 && Date.now() - f.t < 60000) return res.redirect("/login?e=2");
  // El usuario del .env (admin) o, con el modo estudio, un usuario dado de alta en la base.
  const ok = (!!AUTH_USER && req.body.user === AUTH_USER && passwordOk(req.body.password))
    || (!!persistencia && !!persistencia.verificarUsuario(req.body.user, req.body.password));
  if (!ok) {
    fails.set(ip, { count: (f && Date.now() - f.t < 60000 ? f.count : 0) + 1, t: Date.now() });
    return res.redirect("/login?e=1");
  }
  fails.delete(ip);
  res.cookie(COOKIE, sign({ u: String(req.body.user), exp: Date.now() + TTL_MS }), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: TTL_MS });
  res.redirect("/");
});
app.get("/logout", (req, res) => {
  // clearCookie DEBE repetir las mismas opciones que res.cookie() o el navegador no borra la cookie.
  const opts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/" };
  res.clearCookie(COOKIE, opts);
  res.clearCookie(OIDC_COOKIE, opts);
  res.redirect("/login");
});
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Script del ojito del login: ungated (la página de login no tiene sesión todavía).
app.get("/login-eye.js", (req, res) => res.type("application/javascript").send(LOGIN_EYE_JS));

// --- CSRF: un pedido que cambia algo en /api tiene que venir de esta misma página. Los navegadores
//     mandan Origin (y Sec-Fetch-Site) en esos pedidos; si vienen de otro sitio, se rechazan. Además
//     de la cookie sameSite=lax: cubre subdominios "hermanos" y navegadores viejos. ---
const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
function mismoOrigen(req) {
  if (req.get("sec-fetch-site") === "cross-site") return false;
  const o = req.get("origin");
  if (!o) return true; // sin Origin: no es un navegador (curl, scripts) o es un GET de navegación
  if (o === "null") return false;
  try { return new URL(o).host === req.get("host"); } catch { return false; }
}
app.use("/api", (req, res, next) => {
  if (SEGUROS.has(req.method) || mismoOrigen(req)) return next();
  res.status(403).json({ error: 403, mensaje: "Pedido de otro sitio rechazado." });
});

// --- Pedido al cliente (modo estudio): el cliente entra SIN login con un link de un solo uso por
//     pedido (token de 256 bits; en la base queda solo su hash), ve solo las partidas que le
//     preguntaron y contesta. Vence y se puede anular. Antes de la puerta de auth. ---
if (persistencia) {
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const envios = new Map(); // IP → marcas de tiempo (límite de respuestas por hora)
  const sinIndexar = (res) => { res.setHeader("X-Robots-Tag", "noindex, nofollow"); res.setHeader("Cache-Control", "no-store"); };
  const noExiste = (res) => res.status(404).json({ error: 404, mensaje: "Este link no existe, venció o el estudio lo anuló. Pedile uno nuevo a tu contador." });
  app.get("/r/:token", (req, res) => { sinIndexar(res); res.sendFile(path.join(__dirname, "cliente.html")); });
  app.get("/publico/cliente.js", (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(__dirname, "src", "cliente.js")); });
  app.get("/api/publico/pedidos/:token", (req, res) => {
    sinIndexar(res);
    const pd = TOKEN_RE.test(req.params.token) && persistencia.pedidoPublico(req.params.token);
    pd ? res.json(pd) : noExiste(res);
  });
  const limite = (req, res) => {
    const ip = req.ip || "?", ahora = Date.now(), l = (envios.get(ip) || []).filter((t) => ahora - t < 3600e3);
    if (l.length >= 60) { res.status(429).json({ error: 429, mensaje: "Demasiados envíos seguidos: probá en un rato." }); return false; }
    l.push(ahora); envios.set(ip, l); return true;
  };
  // Comprobantes: solo PDF o imágenes, reconocidos por su contenido (no por lo que diga el navegador).
  const tipoReal = (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" ? "application/pdf"
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg"
    : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : null;
  const MAX_COMPROBANTE_MB = Math.min(Number(process.env.DOC_MAX_MB || 25), 10);
  app.post("/api/publico/pedidos/:token/adjuntos", express.raw({ type: () => true, limit: `${MAX_COMPROBANTE_MB}mb` }), async (req, res, next) => {
    sinIndexar(res);
    if (!limite(req, res)) return;
    try {
      if (!TOKEN_RE.test(req.params.token)) return noExiste(res);
      const datos = req.body;
      if (!Buffer.isBuffer(datos) || !datos.length) return res.status(400).json({ error: 400, mensaje: "El archivo llegó vacío." });
      const mime = tipoReal(datos);
      if (!mime) return res.status(400).json({ error: 400, mensaje: "Solo se pueden adjuntar PDF o fotos (JPG, PNG, WEBP)." });
      let nombre = "comprobante";
      try { nombre = decodeURIComponent(String(req.get("x-nombre") || "comprobante")).replace(/[\x00-\x1f]/g, "").slice(0, 120) || "comprobante"; } catch {}
      const out = await persistencia.adjuntarComprobante(req.params.token, String(req.query.clave || ""), { nombre, mime, datos });
      if (out.error === 404) return noExiste(res);
      if (out.error) return res.status(out.error).json({ error: out.error, mensaje: out.msg });
      res.status(201).json(out.pedido);
    } catch (e) { next(e); }
  });
  app.delete("/api/publico/pedidos/:token/adjuntos/:doc", async (req, res, next) => {
    sinIndexar(res);
    if (!limite(req, res)) return;
    try {
      if (!TOKEN_RE.test(req.params.token) || !/^[0-9a-f-]{36}$/i.test(req.params.doc)) return noExiste(res);
      const out = await persistencia.quitarComprobante(req.params.token, req.params.doc);
      out.error ? noExiste(res) : res.json(out.pedido);
    } catch (e) { next(e); }
  });
  app.post("/api/publico/pedidos/:token", express.json({ limit: "64kb" }), (req, res) => {
    sinIndexar(res);
    if (!limite(req, res)) return;
    const r = req.body?.respuestas;
    if (!r || typeof r !== "object" || Array.isArray(r)) return res.status(400).json({ error: 400, mensaje: "Respuestas inválidas." });
    const pd = TOKEN_RE.test(req.params.token) && persistencia.responderPedido(req.params.token, r);
    pd ? res.json(pd) : noExiste(res);
  });
}

// --- Puerta: todo lo de abajo requiere sesión (si AUTH_ENABLED) ---
app.use((req, res, next) => {
  if (authed(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth" });
  res.redirect("/login");
});

// GET /api/novedades?desde=X.Y.Z  -> que cambio desde la ultima version vista (CHANGELOG).
// ?todas=1 -> historial hasta la version instalada. Detras de la misma puerta que el resto.
app.get("/api/novedades", (req, res) => {
  const d = String(req.query.desde || "");
  const vista = /^\d+\.\d+\.\d+$/.test(d) ? d : null;
  const versiones = req.query.todas === "1"
    ? nov.todas().filter((x) => nov.comparar(x.version, APP_VERSION) <= 0)
    : nov.desde(nov.todas(), vista, APP_VERSION);
  res.json({ ok: true, version: APP_VERSION, versiones });
});

// --- API del estudio (/api/v1): solo con PERSISTENCIA=on. Sin ella, /api/v1/estado avisa que el
//     modo es local (la app funciona igual, sin guardar nada en el servidor). ---
if (persistencia) {
  const { crearApi } = require("./server/api.js");
  const modoUsuarios = !AUTH_ENABLED ? "sin_login" : AUTH_MODE === "federado" ? "lockatus" : "local";
  app.use("/api/v1", crearApi(persistencia, { maxDocMB: Number(process.env.DOC_MAX_MB || 25), usuario: identidad, modoUsuarios, ia: gestorIA }));
  console.log(`[fulgoria] persistencia ON · base ${path.join(DATA_DIR, "fulgoria.sqlite")} · documentos en ${persistencia.almacenamiento}${persistencia.cifrado ? " (cifrados)" : ""}`);
} else {
  app.get("/api/v1/estado", (req, res) => res.json({ persistencia: false }));
}


app.get("/api/ia/estado", (req, res) => { const ia = gestorIA.actual; res.json(ia.disponible ? { disponible: true, proveedor: ia.proveedor, modelo: ia.modelo } : { disponible: false }); });
app.post("/api/ia/columnas", express.json({ limit: "256kb" }), async (req, res) => {
  const ia = gestorIA.actual;
  if (!ia.disponible) return res.status(404).json({ error: 404, mensaje: "La IA no está configurada." });
  const yo = identidad(req) || { u: "?", rol: "lector" };
  if (persistencia && !["preparador", "revisor", "admin"].includes(yo.rol)) return res.status(403).json({ error: 403, mensaje: "Tu rol no permite usar la IA." });
  try { res.json(await ia.proponerColumnas(req.body?.esqueleto, yo.u)); }
  catch (e) { res.status(e.status || 502).json({ error: e.status || 502, mensaje: e.message }); }
});

// --- Estáticos: WHITELIST explícita. Nunca se sirven .env, server.js, node_modules ni
//     samples/private (PII). Solo el ejemplo sintético es público. ---
const staticOpts = { index: false, redirect: false };
// El código de la app se revalida siempre (ETag → 304 si no cambió): así, después de un deploy,
// nadie queda con el JS viejo y la página nueva (botones que no aparecen, etc.).
const revalidar = { ...staticOpts, etag: true, lastModified: true, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") };
app.use("/src", express.static(path.join(__dirname, "src"), revalidar));
app.use("/styles", express.static(path.join(__dirname, "styles"), revalidar));
app.use("/vendor", express.static(path.join(__dirname, "vendor"), { ...staticOpts, maxAge: "7d" }));
app.get("/favicon.svg", (req, res) => res.sendFile(path.join(__dirname, "favicon.svg")));
app.get("/samples/banco-rio-cc.pdf", (req, res) => res.sendFile(path.join(__dirname, "samples", "banco-rio-cc.pdf")));
app.get("/", (req, res) => res.type("html").send(INDEX_HTML));
// Conciliación (extracto ↔ mayor). Igual que el extractor: todo se procesa en el navegador.
app.get(["/conciliar", "/conciliar.html"], (req, res) => res.type("html").send(CONCILIAR_HTML));
app.get("/samples/mayor-banco-rio-cc.csv", (req, res) => res.type("text/csv").sendFile(path.join(__dirname, "samples", "mayor-banco-rio-cc.csv")));
app.use((req, res) => res.status(404).send("No encontrado"));

if (require.main === module) {
  // CLI: copia de seguridad de la base a demanda →  node server.js --backup
  if (process.argv[2] === "--copias") {
    if (!persistencia) { console.error("PERSISTENCIA=off: no hay copias."); process.exit(1); }
    persistencia.copias().then((l) => { console.log(l.length ? l.join("\n") : "No hay copias todavía."); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
  } else if (process.argv[2] === "--restaurar") {
    // node server.js --restaurar backups/fulgoria-….sqlite   (o la ruta de un archivo .sqlite)
    if (!persistencia) { console.error("PERSISTENCIA=off: no hay base que restaurar."); process.exit(1); }
    if (!process.argv[3]) { console.error("Uso: node server.js --restaurar <copia>   (las copias: node server.js --copias)"); process.exit(1); }
    persistencia.restaurar(process.argv[3]).then((r) => {
      console.log(`Restaurada ${r.restaurada} (${r.meses ?? "?"} meses guardados). La base anterior quedó en ${r.anterior}.`);
      console.log("Reiniciá el servidor (en EasyPanel: Restart) para que la use.");
      process.exit(0);
    }).catch((e) => { console.error(e.message); process.exit(1); });
  } else if (process.argv[2] === "--backup") {
    if (!persistencia) { console.error("PERSISTENCIA=off: no hay base que copiar."); process.exit(1); }
    persistencia.backup().then((b) => { console.log(`Copia guardada: ${b.clave} (${b.bytes} bytes)`); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    app.listen(PORT, () => console.log(`Fulgoria escuchando en http://localhost:${PORT}  ·  login: ${AUTH_ENABLED ? "ON" : "OFF"}  ·  persistencia: ${PERSISTENCIA ? "ON" : "OFF"}`));
  }
}
module.exports = { app, persistencia };
