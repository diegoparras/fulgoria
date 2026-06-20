// Fulgoria — servidor FINO. Solo sirve la app estática + un login opcional desde el .env.
// El documento se procesa 100% en el navegador y NUNCA llega acá: el server solo es la puerta.
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

const PORT = Number(process.env.PORT || 3000);
const AUTH_ENABLED = String(process.env.AUTH_ENABLED ?? "true").toLowerCase() === "true";
const AUTH_USER = process.env.AUTH_USER || "";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ""; // hash bcrypt
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE ?? "true").toLowerCase() === "true";
const TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 3600 * 1000;
const COOKIE = "fulgoria_auth";
const ESCRIBA_URL = process.env.ESCRIBA_URL || ""; // destino de "Enviar a Escriba" (vacío → "/")

// index.html con el destino de Escriba inyectado en su <meta> (una sola lectura al arrancar).
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8").replace(
  '<meta name="fulgoria-escriba-url" content="" />',
  `<meta name="fulgoria-escriba-url" content="${escAttr(ESCRIBA_URL)}" />`,
);

if (AUTH_ENABLED && (!AUTH_USER || !AUTH_PASSWORD || !SESSION_SECRET)) {
  console.error("AUTH_ENABLED=true requiere AUTH_USER, AUTH_PASSWORD y SESSION_SECRET en el .env.");
  console.error("AUTH_PASSWORD puede ser tu contraseña en texto plano, o un hash bcrypt (node server.js --hash '…').");
  console.error("Generá el SESSION_SECRET con:  openssl rand -hex 32");
  process.exit(1);
}

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
const authed = (req) => !AUTH_ENABLED || !!verify(req.cookies[COOKIE]);

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
:root{--bg:#fafbfc;--panel:#fff;--ink:#16181d;--muted:#5f6b7a;--line:rgba(15,23,42,.12);--accent:#3b76d9}
@media(prefers-color-scheme:dark){:root{--bg:#090c11;--panel:#111720;--ink:#eaeef4;--muted:#8a95a4;--line:rgba(255,255,255,.11);--accent:#5aa2ff}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;padding:20px}
.card{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:30px 28px;
box-shadow:0 12px 40px rgba(15,23,42,.12);text-align:center}
.logo{display:flex;gap:10px;align-items:center;justify-content:center;font-weight:700;font-size:20px;letter-spacing:-.02em;margin-bottom:4px}
.logo svg{width:28px;height:28px}.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
label{display:block;text-align:left;font-size:12.5px;color:var(--muted);margin:12px 0 5px}
input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer}
button:hover{filter:brightness(1.06)}.err{color:#cf222e;font-size:13px;margin:14px 0 0}
</style></head><body><form class="card" method="post" action="/login" autocomplete="on">
<div class="logo"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="15" fill="#6c5cf0"/><path d="M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z" transform="translate(2,2) scale(2.5)" fill="#fff"/></svg>Fulgoria</div>
<p class="sub">Extraé datos de cualquier documento.</p>
<label for="u">Usuario</label><input id="u" name="user" autocomplete="username" required autofocus>
<label for="p">Contraseña</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Ingresar</button>${msg}</form></body></html>`;
}
app.get("/login", (req, res) => {
  if (authed(req)) return res.redirect("/");
  const e = req.query.e === "2" ? "Demasiados intentos. Esperá un minuto." : req.query.e ? "Usuario o contraseña incorrectos." : "";
  res.type("html").send(loginPage(e));
});
app.post("/login", (req, res) => {
  const ip = req.ip || "?";
  const f = fails.get(ip);
  if (f && f.count >= 8 && Date.now() - f.t < 60000) return res.redirect("/login?e=2");
  const ok = !!AUTH_USER && req.body.user === AUTH_USER && passwordOk(req.body.password);
  if (!ok) {
    fails.set(ip, { count: (f && Date.now() - f.t < 60000 ? f.count : 0) + 1, t: Date.now() });
    return res.redirect("/login?e=1");
  }
  fails.delete(ip);
  res.cookie(COOKIE, sign({ u: AUTH_USER, exp: Date.now() + TTL_MS }), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: TTL_MS });
  res.redirect("/");
});
app.get("/logout", (req, res) => { res.clearCookie(COOKIE); res.redirect("/login"); });
app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Puerta: todo lo de abajo requiere sesión (si AUTH_ENABLED) ---
app.use((req, res, next) => {
  if (authed(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth" });
  res.redirect("/login");
});

// --- Estáticos: WHITELIST explícita. Nunca se sirven .env, server.js, node_modules ni
//     samples/private (PII). Solo el ejemplo sintético es público. ---
const staticOpts = { index: false, redirect: false };
app.use("/src", express.static(path.join(__dirname, "src"), { ...staticOpts, maxAge: "1h" }));
app.use("/styles", express.static(path.join(__dirname, "styles"), { ...staticOpts, maxAge: "1h" }));
app.use("/vendor", express.static(path.join(__dirname, "vendor"), { ...staticOpts, maxAge: "7d" }));
app.get("/favicon.svg", (req, res) => res.sendFile(path.join(__dirname, "favicon.svg")));
app.get("/samples/banco-rio-cc.pdf", (req, res) => res.sendFile(path.join(__dirname, "samples", "banco-rio-cc.pdf")));
app.get("/", (req, res) => res.type("html").send(INDEX_HTML));
app.use((req, res) => res.status(404).send("No encontrado"));

app.listen(PORT, () => console.log(`Fulgoria escuchando en http://localhost:${PORT}  ·  login: ${AUTH_ENABLED ? "ON" : "OFF"}`));
