// Hash-Router + aktive Tabs + LIVE-REFRESH bei State-Changes
import { addStateListener } from "./data/storageLocal.js";

const ROUTES = ["dashboard", "plan", "eingaben", "export", "debug"];
const DEFAULT_ROUTE = "dashboard";
const appEl = document.getElementById("app");

function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function getRoute() {
  const h = location.hash.replace(/^#/, "").trim();
  return ROUTES.includes(h) ? h : DEFAULT_ROUTE;
}
function markActive(route) {
  $all(".topnav .navbtn").forEach(a => {
    const r = a.getAttribute("data-route");
    const on = r === route;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
async function render(route) {
  markActive(route);
  const map = {
    dashboard: "./ui/dashboard.js",
    plan: "./ui/plan.js",
    eingaben: "./ui/eingaben.js",
    export: "./ui/export.js",
    debug: "./ui/debug.js",
  };
  try {
    const mod = await import(map[route]);
    if (mod && typeof mod.render === "function") {
      await mod.render(appEl);
      return;
    }
    appEl.innerHTML = `<section class="card"><h2>${route}</h2><p class="muted">Kein View-Modul gefunden.</p></section>`;
  } catch (e) {
    console.error(e);
    appEl.innerHTML = `
      <section class="card">
        <h2>${route}</h2>
        <p class="muted">Fehler beim Laden der Ansicht.</p>
        <pre style="white-space:pre-wrap;background:#fff;padding:8px;border:1px solid #eee;border-radius:8px">${String(e)}</pre>
      </section>`;
  }
}
function goto(route) {
  const r = ROUTES.includes(route) ? route : DEFAULT_ROUTE;
  if (getRoute() !== r) location.hash = "#" + r;
  else render(r);
}
function bindNav() {
  $all(".topnav .navbtn").forEach(a => {
    a.addEventListener("click", ev => {
      ev.preventDefault();
      goto(a.getAttribute("data-route") || DEFAULT_ROUTE);
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  bindNav();
  render(getRoute());

  // LIVE-REFRESH: wenn state sich ändert und wir gerade auf dem Dashboard sind → neu rendern
  addStateListener(() => {
    if (getRoute() === "dashboard") {
      render("dashboard");
    }
  });

  // Optional: bei Fenstergröße ändern Charts neu zeichnen, wenn Dashboard offen
  window.addEventListener("resize", () => {
    if (getRoute() === "dashboard") render("dashboard");
  });
});

window.addEventListener("hashchange", () => render(getRoute()));
