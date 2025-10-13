// UI: Dashboard – Balken + Kontostands-Linie + globaler Tooltip, gemeinsame Y-Skala + Baseline
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

function niceStepSize(range) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
}

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
  const monthOpening = series.map((_, idx) => (idx === 0 ? opening : closing[idx - 1]));

  // --- Gemeinsame Y-Skala (positiv & negativ) ---
  const netValues = series.map(r => Number(r.net || 0));
  const closingValues = [opening, ...closing];
  const rawTop = Math.max(0, ...netValues, ...closingValues);
  const rawBottom = Math.min(0, ...netValues, ...closingValues);
  const paddedTop = rawTop === 0 ? 0 : rawTop * 1.1;
  const paddedBottom = rawBottom === 0 ? 0 : rawBottom * 1.1;

  const steps = 5;
  const niceStep = niceStepSize((paddedTop - paddedBottom) / steps || 1);
  const top = Math.max(niceStep, Math.ceil(paddedTop / niceStep) * niceStep);
  const bottom = rawBottom < 0 ? Math.floor(paddedBottom / niceStep) * niceStep : 0;
  const span = (top - bottom) || niceStep;

  const yTicks = Array.from({ length: steps + 1 }, (_, i) => top - (span / steps) * i);

  const fmtTick = v => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
    if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
    return `${Math.round(v)}`;
  };

  // --- SVG-Mapping ---
  const cols = months.length || 1;
  const X = i => ((i + 0.5) * 1000) / cols; // Spaltenmitte (0..1000)
  const XPct = i => ((i + 0.5) * 100) / cols; // Spaltenmitte (0..100%)
  const Y = v => {
    const val = Number(v || 0);
    const norm = (top - val) / span;
    const clamped = Math.max(0, Math.min(1, norm));
    return clamped * 1000;
  };
  const YPct = v => (Y(v) / 1000) * 100;
  const zeroPct = Math.max(0, Math.min(100, Y(0) / 10));
  const points = closing.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const dots = closing.map((v, i) => `<circle class="dot" cx="${X(i)}" cy="${Y(v)}" r="7"></circle>`).join("");
  const closingLabels = closing
    .map((v, i) => `
      <div class="closing-label" style="--x:${XPct(i)}; --y:${YPct(v)};">${fmtEUR(v)}</div>
    `)
    .join("");
  const netStrip = series
    .map(r => `<div class="net ${Number(r.net || 0) >= 0 ? "pos" : "neg"}">${fmtEUR(r.net || 0)}</div>`)
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

      <div class="vchart" style="--cols:${months.length}; --rows:${yTicks.length}; --zero:${zeroPct.toFixed(2)}">
        <!-- Raster (dahinter) -->
        <div class="vchart-grid">
          ${yTicks.map(() => `<div class="yline"></div>`).join("")}
        </div>

        <!-- Y-Achse (Labels) -->
        <div class="vchart-y">
          ${yTicks.map(v => `<div class="ytick">${fmtTick(v)}</div>`).join("")}
        </div>

        <!-- Baseline (0-Linie, durchgezogen) -->
        <div class="vchart-zero"></div>

        <!-- Balken -->
        <div class="vchart-bars">
          ${series.map((r,i) => {
            const val = Number(r.net || 0);
            const valuePct = Math.max(0, Math.min(100, Y(val) / 10));
            const topPct = Math.min(zeroPct, valuePct);
            const heightPct = Math.abs(zeroPct - valuePct);
            const cls = val >= 0 ? "pos" : "neg";
            return `
              <div class="vbar-wrap">
                <div class="vbar ${cls}" style="--top:${topPct.toFixed(2)}; --height:${heightPct.toFixed(2)}" data-idx="${i}" aria-label="${months[i]}"></div>
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

        <div class="vchart-closing-labels" aria-hidden="true">
          ${closingLabels}
        </div>

        <!-- X-Achse -->
        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>

      <div class="net-strip-label">Netto je Monat</div>
      <div class="net-strip" style="--cols:${months.length};">
        ${netStrip}
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

  function tipHtml(m, row, eom, monthStart) {
    const extras = (row.itemsIn || [])
      .filter(item => item && item.kind === "extra")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const inflow = Number(row.inflow || 0);
    const outflow = Number(row.outflow || 0);
    const baseInflow = inflow - extras;

    return `
      <div class="tip-title">${m}</div>
      <div class="tip-row"><span>Monatsanfang</span><b>${fmtEUR(monthStart)}</b></div>
      <div class="tip-row"><span>+ Inflow</span><b>${fmtEUR(baseInflow)}</b></div>
      <div class="tip-row"><span>+ Extras</span><b>${fmtEUR(extras)}</b></div>
      <div class="tip-row"><span>− Outflow</span><b>${fmtEUR(outflow)}</b></div>
      <div class="tip-row total"><span>= Netto</span><b>${fmtEUR(row.net)}</b></div>
      <div class="tip-row"><span>Kontostand (Monatsende)</span><b>${fmtEUR(eom)}</b></div>
    `;
  }

  const barsWrap = root.querySelector(".vchart-bars");

  function showTip(ev) {
    const el = ev.target.closest(".vbar");
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    const row = series[i];
    const eom = closing[i];
    const mos = monthOpening[i];

    tip.innerHTML = tipHtml(months[i], row, eom, mos);
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

  if (barsWrap) {
    barsWrap.addEventListener("pointerenter", showTip, true);
    barsWrap.addEventListener("pointermove", showTip, true);
    barsWrap.addEventListener("pointerleave", hideTip, true);
  }

  // Live-Refresh
  const off = addStateListener(() => {
    if (location.hash.replace("#","") === "dashboard") render(root);
  });
}
