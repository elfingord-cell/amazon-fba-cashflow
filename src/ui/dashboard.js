// UI: Dashboard – Balken + Kontostands-Linie + globaler Tooltip, gemeinsame Y-Skala + Baseline
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

  // --- Gemeinsame Y-Skala mit +10% Luft ---
  const step = 5000;
  const netMax = Math.max(1, ...series.map(r => Math.max(0, Number(r.net || 0))));
  const closeMax = Math.max(opening, ...closing);
  const rawTop = Math.max(netMax, closeMax);
  const padded = rawTop * 1.10; // 10% Headroom
  const top = Math.max(step, Math.ceil(padded / step) * step);

  const steps = 5; // 0..Top in 6 Ticks
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));

  // --- SVG-Mapping ---
  const cols = months.length || 1;
  const X = i => ((i + 0.5) * 1000) / cols;                       // Spaltenmitte (0..1000)
  const Y = v => 1000 - Math.max(0, Math.min(1000, (Number(v || 0) / top) * 1000));
  const points = closing.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const dots = closing.map((v, i) => `<circle class="dot" cx="${X(i)}" cy="${Y(v)}" r="10"></circle>`).join("");

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
        <!-- Raster (dahinter) -->
        <div class="vchart-grid">
          ${yTicks.map(() => `<div class="yline"></div>`).join("")}
        </div>

        <!-- Y-Achse (Labels) -->
        <div class="vchart-y">
          ${yTicks.slice().reverse().map(v => `<div class="ytick">${v >= 1000 ? Math.round(v/1000) + "k" : "0"}</div>`).join("")}
        </div>

        <!-- Baseline (0-Linie, durchgezogen) -->
        <div class="vchart-zero"></div>

        <!-- Balken -->
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

        <!-- Kontostands-Linie (oberste Ebene) -->
        <div class="vchart-lines" aria-hidden="true">
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <polyline class="line" points="${points}"></polyline>
            ${dots}
          </svg>
        </div>

        <!-- X-Achse -->
        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>
    </section>
  `;

  // --- Globaler Tooltip an <body> (nicht clipbar) ---
  function ensureGlobalTip(){
    let el = document.getElementById("global-chart-tip");
    if (!el){
      el = document.createElement("div");
      el.id = "global-chart-tip";
      el.className = "chart-tip";
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }
  const tip = ensureGlobalTip();

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

  let signalRow;
  const barsWrap = root.querySelector(".vchart-bars");

  function showTip(ev) {
    const el = ev.target.closest(".vbar");
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    signalRow = series[i];
    const eom = closing[i];

    tip.innerHTML = tipHtml(months[i], signalRow, eom);
    tip.hidden = false;

    const br = el.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    const width = tip.offsetWidth || 220;
    const height = tip.offsetHeight || 120;

    let left = br.left + br.width + 12;
    if (left + width + 8 > vw) left = Math.max(8, br.left - width - 12);

    let topPx = br.top - 8;
    if (topPx + height + 8 > vh) topPx = Math.max(8, vh - height - 8);

    tip.style.left = `${left}px`;
    tip.style.top = `${topPx}px`;
  }
  function hideTip(){ tip.hidden = true; }

  barsWrap.addEventListener("pointerenter", showTip, true);
  barsWrap.addEventListener("pointermove", showTip, true);
  barsWrap.addEventListener("pointerleave", hideTip, true);

  // Live-Refresh
  const off = addStateListener(() => {
    if (location.hash.replace("#","") === "dashboard") render(root);
  });
}
