// UI: Dashboard – Balken + Kontostands-Linie + Tooltip, gemeinsame Y-Skala
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

export async function render(root) {
  const state = loadState();
  const { months, series, kpis } = computeSeries(state);

  // --- Closing-Serie (Kontostand am Monatsende) ---
  const opening = Number(kpis.opening || 0);
  const closing = [];
  let run = opening;
  for (let i = 0; i < series.length; i++) {
    run += Number(series[i]?.net || 0);
    closing.push(run);
  }

  // --- Gemeinsame Y-Skala (rund auf 5k) ---
  const step = 5000;
  const netMax = Math.max(1, ...series.map(r => Math.max(0, Number(r.net || 0))));
  const netTop = Math.max(step, Math.ceil(netMax / step) * step);
  const closeMax = Math.max(opening, ...closing);
  const closeTop = Math.max(step, Math.ceil(closeMax / step) * step);
  const top = Math.max(netTop, closeTop);           // beide Serien teilen sich diese Skala
  const steps = 5;                                   // 0..Top in 6 Ticks
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));

  // --- Tooltip-HTML ---
  function tipHtml(m, row, eom) {
    return `
      <div class="tip-title">${m}</div>
      <div class="tip-row"><span>Netto</span><b>${fmtEUR(row.net)}</b></div>
      <div class="tip-row"><span>Inflow</span><b>${fmtEUR(row.inflow)}</b></div>
      <div class="tip-row"><span>Extras</span><b>${fmtEUR(row.extras)}</b></div>
      <div class="tip-row"><span>Outflow</span><b>${fmtEUR(-Math.abs(row.out))}</b></div>
      <div class="tip-row"><span>Kontostand (EOM)</span><b>${fmtEUR(eom)}</b></div>
    `;
  }

  // --- SVG: Kontostands-Linie (Overlay) ---
  const cols = months.length;
  const X = i => ((i + 0.5) * 1000) / Math.max(1, cols); // Spaltenmitte
  const Y = v => 1000 - Math.max(0, Math.min(1000, (Number(v || 0) / top) * 1000));
  const points = closing.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const dots = closing
    .map((v, i) => `<circle class="dot" cx="${X(i)}" cy="${Y(v)}" r="10"></circle>`)
    .join("");

  // --- Render ---
  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label">Opening heute</div><div class="kpi-value">${fmtEUR(opening)}</div></div>
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
            const h = top ? Math.max(0, Math.min(100, (Number(r.net || 0) / top) * 100)) : 0;
            const cls = (Number(r.net || 0) >= 0) ? "pos" : "neg";
            return `
              <div class="vbar-wrap">
                <div class="vbar ${cls}" style="--h:${h}" data-idx="${i}" aria-label="${months[i]}"></div>
              </div>`;
          }).join("")}
        </div>

        <!-- Kontostands-Linie (SVG) -->
        <div class="vchart-lines">
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="line" points="${points}"></polyline>
            ${dots}
          </svg>
        </div>

        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>

        <div class="chart-tip" id="chart-tip" role="tooltip" hidden></div>
      </div>
    </section>
  `;

  // --- Tooltip Logik (über Balken, zeigt auch EOM) ---
  const tip = root.querySelector("#chart-tip");
  const barsWrap = root.querySelector(".vchart-bars");

  function showTip(ev) {
    const el = ev.target.closest(".vbar");
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    const row = series[i];
    const eom = closing[i];
    tip.innerHTML = tipHtml(months[i], row, eom);
    tip.hidden = false;

    // Position neben dem Balken
    const barRect = el.getBoundingClientRect();
    const hostRect = root.getBoundingClientRect();
    const left = Math.min(hostRect.width - 200, barRect.left - hostRect.left + 12);
    const topPx = Math.max(0, barRect.top - hostRect.top - 8);
    tip.style.transform = `translate(${left}px, ${topPx}px)`;
  }
  function hideTip() { tip.hidden = true; }

  barsWrap.addEventListener("pointerenter", showTip, true);
  barsWrap.addEventListener("pointermove", showTip, true);
  barsWrap.addEventListener("pointerleave", hideTip, true);

  // Live-Refresh
  const off = addStateListener(() => {
    if (location.hash.replace("#", "") === "dashboard") render(root);
  });
}
