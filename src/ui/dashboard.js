// UI: Dashboard – Balken + Topline + Tooltip, Y-Skala exakt ausgerichtet
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

export async function render(root) {
  const state = loadState();
  const { months, series, kpis } = computeSeries(state);

  // Skala (0 .. top) in runden 5k-Schritten, 6 Ticks inkl. 0
  const max = Math.max(1, ...series.map(r => Math.max(0, r.net)));
  const step = 5000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const steps = 5; // ergibt 6 Ticks inkl. 0
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));

  // Tooltip-HTML
  function tipHtml(m, row) {
    return `
      <div class="tip-title">${m}</div>
      <div class="tip-row"><span>Netto</span><b>${fmtEUR(row.net)}</b></div>
      <div class="tip-row"><span>Inflow</span><b>${fmtEUR(row.inflow)}</b></div>
      <div class="tip-row"><span>Extras</span><b>${fmtEUR(row.extras)}</b></div>
      <div class="tip-row"><span>Outflow</span><b>${fmtEUR(-Math.abs(row.out))}</b></div>
    `;
  }

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label">Opening heute</div><div class="kpi-value">${fmtEUR(kpis.opening || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Erster negativer Monat</div><div class="kpi-value">${kpis.firstNegativeMonth || "—"}</div></div>
      </div>

      <div class="vchart" style="--cols:${months.length}; --rows:${yTicks.length}">
        <div class="vchart-grid">
          ${yTicks.map(() => `<div class="yline"></div>`).join("")}
        </div>
        <div class="vchart-y">
          ${yTicks.slice().reverse().map(v => `<div class="ytick">${v >= 1000 ? Math.round(v/1000) + "k" : "0"}</div>`).join("")}
        </div>

        <div class="vchart-bars">
          ${series.map((r,i) => {
            const h = top ? Math.max(0, Math.min(100, (r.net / top) * 100)) : 0;
            const cls = r.net >= 0 ? "pos" : "neg";
            return `
              <div class="vbar-wrap">
                <div class="vbar ${cls}" style="--h:${h}" data-idx="${i}" aria-label="${months[i]}"></div>
              </div>`;
          }).join("")}
        </div>

        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>

        <div class="chart-tip" id="chart-tip" role="tooltip" hidden></div>
      </div>
    </section>
  `;

  // Tooltip Logik (Delegation)
  const tip = root.querySelector("#chart-tip");
  const barsWrap = root.querySelector(".vchart-bars");

  function showTip(ev) {
    const el = ev.target.closest(".vbar");
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    const row = series[i];
    tip.innerHTML = tipHtml(months[i], row);
    tip.hidden = false;

    // Position neben dem Balken
    const barRect = el.getBoundingClientRect();
    const hostRect = root.getBoundingClientRect();
    const left = Math.min(hostRect.width - 180, barRect.left - hostRect.left + 10);
    const topPos = Math.max(0, barRect.top - hostRect.top - 10);
    tip.style.transform = `translate(${left}px, ${topPos}px)`;
  }
  function hideTip() { tip.hidden = true; }

  barsWrap.addEventListener("pointerenter", showTip, true);
  barsWrap.addEventListener("pointermove", showTip, true);
  barsWrap.addEventListener("pointerleave", hideTip, true);

  // Live-Refresh, wenn sich der State ändert und wir auf dem Dashboard sind
  const off = addStateListener(() => {
    if (location.hash.replace("#", "") === "dashboard") render(root);
  });
}
