// src/main.js
import { addStateListener } from "./data/storageLocal.js";

const ROUTES = ["dashboard","plan","eingaben","export","pofo","debug"];
const DEFAULT_ROUTE = "dashboard";
const appEl = document.getElementById("app");

function $all(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function getRoute(){ const h = location.hash.replace(/^#/,"").trim(); return ROUTES.includes(h)?h:DEFAULT_ROUTE; }
function markActive(route){
  $all(".topnav .navbtn").forEach(a=>{
    const r = a.getAttribute("data-route");
    const on = r===route;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
  });
}
async function render(route){
  markActive(route);
  const map = {
    dashboard: "./ui/dashboard.js",
    plan: "./ui/plan.js",
    eingaben: "./ui/eingaben.js",
    export: "./ui/export.js",
    pofo: "./ui/pofos.js",
    debug: "./ui/debug.js",
  };
  try{
    const mod = await import(map[route]);
    if (mod?.render) return mod.render(appEl);
    appEl.innerHTML = `<section class="card"><h2>${route}</h2><p class="muted">Kein View-Modul gefunden.</p></section>`;
  }catch(e){
    appEl.innerHTML = `<section class="card"><h2>${route}</h2><p class="muted">Fehler beim Laden.</p><pre>${String(e)}</pre></section>`;
    console.error(e);
  }
}
function goto(route){ const r=ROUTES.includes(route)?route:DEFAULT_ROUTE; if (getRoute()!==r) location.hash="#"+r; else render(r); }
function bindNav(){
  $all(".topnav .navbtn").forEach(a=>{
    a.addEventListener("click", ev=>{ ev.preventDefault(); goto(a.getAttribute("data-route")||DEFAULT_ROUTE); });
  });
}

window.addEventListener("DOMContentLoaded", ()=>{
  bindNav(); render(getRoute());
  addStateListener(()=>{ if (getRoute()==="dashboard") render("dashboard"); });
  window.addEventListener("resize", ()=>{ if (getRoute()==="dashboard") render("dashboard"); });
});
window.addEventListener("hashchange", ()=>render(getRoute()));
