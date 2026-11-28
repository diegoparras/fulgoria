// Página del cliente (sin login): contesta a qué corresponde cada movimiento que el estudio no
// encontró registrado. Ve solo las partidas del pedido; puede volver y corregir hasta que venza.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = location.pathname.split("/").pop();
const API = `/api/publico/pedidos/${encodeURIComponent(token)}`;
const pesos = (c) => (Math.abs(c) / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const fecha = (iso) => { const [y, m, d] = String(iso).split("-"); return `${d}/${m}/${y}`; };
const mes = (p) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function aviso(texto) { $("app").innerHTML = `<div class="aviso">${esc(texto)}</div>`; }

function pintar(pd) {
  const cuenta = [pd.cuenta, pd.banco].filter(Boolean).join(" · ");
  $("app").innerHTML = `
    <h1>${pd.cliente ? esc(pd.cliente) + ": " : ""}¿a qué corresponden estos movimientos?</h1>
    <p class="sub">Estamos cerrando la conciliación bancaria${cuenta ? ` de <b>${esc(cuenta)}</b>` : ""} de <b>${esc(mes(pd.periodo))}</b> y no encontramos registrados estos movimientos. Contanos qué es cada uno (una cobranza de quién, un pago de qué, un préstamo…). Si tenés el comprobante, mandalo por el canal de siempre.</p>
    <form id="f">${pd.items.map((it, i) => {
      const r = pd.respuestas[it.clave];
      return `<div class="item">
        <div class="item-top"><div><div class="item-desc">${esc(it.descripcion)}</div><div class="item-meta">${esc(fecha(it.fecha))} · ${it.cents > 0 ? "entró a la cuenta" : "salió de la cuenta"}</div></div>
        <div class="importe ${it.cents > 0 ? "entra" : "sale"}">${it.cents > 0 ? "+" : "−"} ${esc(pesos(it.cents))}</div></div>
        <label for="r${i}">¿Qué es?</label><textarea id="r${i}" data-clave="${esc(it.clave)}" maxlength="2000" placeholder="Por ejemplo: cobranza de la factura 0001-123 de Juan Pérez">${esc(r?.texto || "")}</textarea>
        <div class="adjuntos" data-adj="${i}">${adjuntosHtml(r?.adjuntos)}</div>
        <label class="adjuntar">📎 Adjuntar comprobante (PDF o foto)<input type="file" data-subir="${i}" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden /></label>
      </div>`;
    }).join("")}
    <div class="acciones"><button type="submit" id="enviar">Enviar respuestas</button><span id="estado" class="estado"></span></div></form>
    <p class="pie">Podés volver a este link y cambiar las respuestas hasta el ${esc(new Date(pd.vence).toLocaleDateString("es-AR"))}. Lo que escribas y adjuntes lo ve solo tu estudio.</p>`;
  $("f").addEventListener("submit", enviar);
  items = pd.items;
  document.querySelectorAll("[data-subir]").forEach((inp) => inp.addEventListener("change", () => subir(+inp.dataset.subir, [...inp.files]).finally(() => { inp.value = ""; })));
  $("f").addEventListener("click", (e) => { const b = e.target.closest("[data-quitar]"); if (b) { e.preventDefault(); quitar(b.dataset.quitar); } });
}

let items = [];
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function adjuntosHtml(lista = []) {
  return lista.map((a) => `<div class="adj"><span>📄 ${esc(a.nombre)} <span class="item-meta">${esc(kb(a.bytes))}</span></span><button type="button" class="quitar" data-quitar="${esc(a.id)}">quitar</button></div>`).join("");
}
function repintarAdjuntos(pd) {
  items.forEach((it, i) => { const el = document.querySelector(`[data-adj="${i}"]`); if (el) el.innerHTML = adjuntosHtml(pd.respuestas[it.clave]?.adjuntos); });
}
async function subir(i, archivos) {
  const est = $("estado");
  for (const f of archivos) {
    if (f.size > 10 * 1024 * 1024) { est.className = "estado bad"; est.textContent = `${f.name}: pesa más de 10 MB.`; continue; }
    est.className = "estado"; est.textContent = `Subiendo ${f.name}…`;
    try {
      const r = await fetch(`${API}/adjuntos?clave=${encodeURIComponent(items[i].clave)}`, { method: "POST", headers: { "content-type": f.type || "application/octet-stream", "x-nombre": encodeURIComponent(f.name) }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.mensaje || `error ${r.status}`);
      repintarAdjuntos(j);
      est.className = "estado ok"; est.textContent = `${f.name}: listo, tu estudio ya lo ve.`;
    } catch (err) { est.className = "estado bad"; est.textContent = `${f.name}: no se pudo subir (${err.message}).`; }
  }
}
async function quitar(id) {
  try {
    const r = await fetch(`${API}/adjuntos/${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.mensaje || `error ${r.status}`);
    repintarAdjuntos(j);
  } catch (err) { $("estado").className = "estado bad"; $("estado").textContent = "No se pudo quitar: " + err.message; }
}

async function enviar(e) {
  e.preventDefault();
  const respuestas = {};
  document.querySelectorAll("textarea[data-clave]").forEach((t) => { respuestas[t.dataset.clave] = t.value; });
  const est = $("estado"), btn = $("enviar");
  btn.disabled = true; est.className = "estado"; est.textContent = "Enviando…";
  try {
    const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ respuestas }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.mensaje || `error ${r.status}`);
    const n = Object.values(j.respuestas).filter((x) => x.texto).length;
    est.className = "estado ok";
    est.textContent = `¡Gracias! Tu estudio ya ve ${n === 1 ? "la respuesta" : `las ${n} respuestas`}.`;
  } catch (err) { est.className = "estado bad"; est.textContent = "No se pudo enviar: " + err.message; }
  btn.disabled = false;
}

(async () => {
  try {
    const r = await fetch(API);
    const j = await r.json();
    if (!r.ok) return aviso(j.mensaje || "Este link no existe o venció.");
    pintar(j);
  } catch { aviso("No pude conectarme. Probá de nuevo en un rato."); }
})();
