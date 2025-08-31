
import { storage } from "./data/storageLocal.js";
import { computeMonthly } from "./domain/cashflow.js";
import { DashboardView } from "./ui/dashboard.js";
import { PlanView } from "./ui/plan.js";
import { InputsView } from "./ui/inputs.js";
import { ImportExportView } from "./ui/importExport.js";
import { NoopSyncAdapter } from "./sync/adapter.js";

const SLUG = "amazon_fba_cashflow_v1";
const appEl = document.getElementById("app");

// Debug (No-SW)
const debugToggle = document.getElementById("debug-toggle");
const debugPanel = document.getElementById("debug-panel");
const debugStatus = document.getElementById("debug-status");
document.getElementById("btn-sw-unregister")?.addEventListener("click", async () => {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(regs.map(r => r.unregister()));
    debugStatus.textContent = `Service Worker abgemeldet: ${regs.length}`;
  } else debugStatus.textContent = "Kein Service Worker API";
});
document.getElementById("btn-caches-clear")?.addEventListener("click", async () => {
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.allSettled(names.map(n => caches.delete(n)));
    debugStatus.textContent = `HTTP-Caches gelöscht: ${names.length}`;
  } else debugStatus.textContent = "Kein Cache API";
});
document.getElementById("btn-storage-clear")?.addEventListener("click", () => {
  localStorage.removeItem(SLUG);
  debugStatus.textContent = "App-Daten gelöscht (localStorage)";
});
debugToggle?.addEventListener("click", () => {
  const open = debugPanel.hasAttribute("hidden");
  debugPanel.toggleAttribute("hidden", !open);
  debugToggle.setAttribute("aria-expanded", String(open));
});

// State
const sync = new NoopSyncAdapter();
let state = storage.load();

function withRecompute(nextState = state) {
  const monthly = computeMonthly(nextState);
  return { ...nextState, _computed: { monthly } };
}
state = withRecompute(state);

function save(next) {
  storage.save(next);
  state = withRecompute(next);
  render();
}

// Router
const routes = {
  "#/dashboard": () => DashboardView(state, save),
  "#/plan": () => PlanView(state, save),
  "#/inputs": () => InputsView(state, save),
  "#/io": () => ImportExportView(state, save),
};
function render() {
  const route = routes[location.hash] ? location.hash : "#/dashboard";
  document.querySelectorAll("a[data-link]").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === route);
  });
  appEl.innerHTML = "";
  appEl.appendChild(routes[route]());
}
window.addEventListener("hashchange", render);
render();
