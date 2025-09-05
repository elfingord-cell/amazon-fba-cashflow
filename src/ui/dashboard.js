// UI: Dashboard – liest nur die normalisierte Domain-Logik
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

export async function render(root) {
  const state = loadState();
  const { months, series, kpis } = computeSeries(state);

  // Skala auf runde 5k-Schritte
  const max = Math.max(1, ...series.map(r => Math.max(0, r.net)));
  const step = 5000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const steps = 5;
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label">Opening heute</div><div class="kpi-value">${fmtEUR(kpis.opening || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Erster negativer Monat</div><div class="kpi-value">${kpis.firstNegativeMonth || "—"}</div></div>
      </div>

      <div class="vchart" style="--cols:${months.length}">
        <div class="vchart-grid">
          ${yTicks.map(() => `<div class="yline"></div>`).join("")}
        </div>
        <div class="vchart-y">
          ${yTicks.slice().reverse().map(v => `<div class="ytick">${v >= 1000 ? Math.round(v/1000) + "k" : "0"}</div>`).join("")}
        </div>
        <div class="vchart-bars">
          ${series.map(r => {
            const h = top ? Math.max(0, Math.min(100, (r.net / top) * 100)) : 0;
            const cls = r.net >= 0 ? "pos" : "neg";
            return `<div class="vbar-wrap"><div class="vbar ${cls}" style="--h:${h}"></div></div>`;
          }).join("")}
        </div>
        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>
    </section>
  `;

  // Live-Refresh, wenn sich der State ändert und wir auf dem Dashboard sind
  const off = addStateListener(() => {
    if (location.hash.replace("#", "") === "dashboard") render(root);
  });
}
