// Aplica el tema guardado ANTES de pintar (anti-parpadeo). Externo (no inline) para una CSP estricta.
try { if (localStorage.getItem("extracta.theme") === "dark") document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}
