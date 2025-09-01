// FBA-CF-0013 — minimaler Hash-Router + aktive Tabs (keine externen Libs)

const ROUTES = ["dashboard", "plan", "eingaben", "export", "debug"];
const DEFAULT_ROUTE = "dashboard";
const appEl = document.getElementById("app");

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function getRouteFromHash() {
  const h = location.hash.replace(/^#/, "").trim();
  return ROUTES.includes(h) ? h : DEFAULT_ROUTE;
}

function setActiveNav(route) {
  $all(".topnav .navbtn").forEach(a => {
    const r = a.getAttribute("data-route");
    const active = r === route;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function renderRoute(route) {
  setActiveNav(route);
  try {
    let modPath = null;
    if (route === "dashboard") modPath = "./ui/dashboard.js";
    if (route === "plan")      modPath = "./ui/plan.js";
    if (route === "eingaben")  modPath = "./ui/eingaben.js";
    if (route === "export")    modPath = "./ui/export.js";
    if (route === "debug")     modPath = "./ui/debug.js";

    if (modPath) {
      const mod = await import(modPath);
      if (typeof mod.render === "function") {
        await mod.render(appEl);
        return;
      }
    }
    appEl.innerHTML = `<section class="card"><h2>${route}</h2><p class="muted">Kein View-Modul gefunden.</p></section>`;
  } catch (e) {
    console.error("Renderfehler:", e);
    appEl.innerHTML = `
      <section class="card">
        <h2>${route}</h2>
        <p class="muted">Fehler beim Laden der Ansicht.</p>
        <pre style="white-space:pre-wrap;background:#fff;padding:8px;border-radius:8px;border:1px solid #eee">${String(e)}</pre>
      </section>`;
  }
}

function goto(route) {
  if (!ROUTES.includes(route)) route = DEFAULT_ROUTE;
  if (getRouteFromHash() !== route) location.hash = "#" + route;
  else renderRoute(route);
}

function bindNav() {
  $all(".topnav .navbtn").forEach(a => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      goto(a.getAttribute("data-route") || DEFAULT_ROUTE);
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  bindNav();
  const r = getRouteFromHash();
  setActiveNav(r);
  renderRoute(r);
});
window.addEventListener("hashchange", () => renderRoute(getRouteFromHash()));
