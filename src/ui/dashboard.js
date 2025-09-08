// UI: Dashboard – Netto-Balken + Closing-Linie + Tooltips (mit sauberer Y-Skala & Headroom)
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

function $(sel, r = document) { return r.querySelector(sel); }
function $all(sel, r = document) { return [...r.querySelectorAll(sel)]; }

export async function render(root) {
  const state = loadState();
  const { months, series, kpis, closings } = computeSeries(state);

  // === Skala: 5k-Ticks + 10% Headroom ===
  const maxNet = Math.max(0, ...series.map(r => r.net));
  const maxClosing = Math.max(0, ...closings.map(c => c.closing));
  const rawMax = Math.max(1, maxNet, maxClosing) * 1.10;        // +10% Luft
  const STEP = 5000;
  const TOP = Math.ceil(rawMax / STEP) * STEP;                   // nach oben auf 5k runden
  const yTicks = [];
  for (let v = 0; v <= TOP; v += STEP) yTicks.push(v);           // 0, 5k, 10k, ...

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label">Opening heute</div><div class="kpi-value">${fmtEUR(kpis.opening || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Erster negativer Monat</div><div class="kpi-value">${kpis.firstNegativeMonth || "—"}</div></div>
      </div>

      <div class="vchart" style="--cols:${months.length}">
        <!-- horizontale Linien -->
        <div class="vchart-grid">
          ${yTicks.map(() => `<div class="yline"></div>`).join("")}
        </div>
        <!-- Y-Labels (exakt auf Linien) -->
        <div class="vchart-y">
          ${yTicks.slice().reverse().map(v => `<div class="ytick">${v >= 1000 ? Math.round(v/1000) + "k" : "0"}</div>`).join("")}
        </div>

        <!-- Balken (Netto je Monat) -->
        <div class="vchart-bars">
          ${series.map((r, i) => {
            const h = TOP ? Math.max(0, Math.min(100, (r.net / TOP) * 100)) : 0;
            const cls = r.net >= 0 ? "pos" : "neg";
            const data = {
              month: r.month,
              inflow: r.inflow,
              extras: r.extras,
              out: r.out,
              net: r.net,
              closing: closings[i]?.closing ?? 0
            };
            const ds = encodeURIComponent(JSON.stringify(data));
            return `
              <div class="vbar-wrap">
                <div class="vbar ${cls}" style="--h:${h}" data-row="${ds}" aria-label="${r.month}"></div>
              </div>`;
          }).join("")}
        </div>

        <!-- Closing-Linie -->
        <canvas class="linecanvas" aria-hidden="true"></canvas>

        <!-- X-Achse -->
        <div class="vchart-x">
          ${months.map(m => `<div class="xlabel">${m}</div>`).join("")}
        </div>

        <!-- Tooltip -->
        <div class="chart-tip" hidden></div>
      </div>
    </section>
  `;

  // === Linie zeichnen (Canvas) ===
  const canvas = $(".linecanvas", root);
  const barsArea = $(".vchart-bars", root);
  if (canvas && barsArea) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = barsArea.getBoundingClientRect();
    const cssW = Math.max(10, Math.floor(rect.width));
    const cssH = Math.max(10, Math.floor(rect.height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.position = "absolute";
    canvas.style.left = barsArea.style.left || "52px";
    canvas.style.right = barsArea.style.right || "12px";
    canvas.style.top = barsArea.style.top || "10px";
    canvas.style.height = barsArea.style.height || (cssH + "px");
    canvas.style.pointerEvents = "none";

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const n = months.length;
      const colW = cssW / n;
      const yScale = (v) => cssH - (TOP ? (v / TOP) * cssH : 0);

      // Linie
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1fb59c";
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = i * colW + colW / 2;
        const y = yScale(closings[i]?.closing || 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Punkte
      ctx.fillStyle = "#0f8f79";
      for (let i = 0; i < n; i++) {
        const x = i * colW + colW / 2;
        const y = yScale(closings[i]?.closing || 0);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // === Tooltips ===
  const tip = $(".chart-tip", root);
  function showTip(el, ev) {
    if (!tip) return;
    try {
      const data = JSON.parse(decodeURIComponent(el.getAttribute("data-row") || "%7B%7D"));
      tip.innerHTML = `
        <div><strong>${data.month}</strong></div>
        <div>Inflow: ${fmtEUR(data.inflow || 0)}</div>
        <div>Extras: ${fmtEUR(data.extras || 0)}</div>
        <div>Out: ${fmtEUR(data.out || 0)}</div>
        <div><strong>Netto: ${fmtEUR(data.net || 0)}</strong></div>
        <div>Closing: <strong>${fmtEUR(data.closing || 0)}</strong></div>
      `;
      tip.hidden = false;
      const parent = $(".vchart", root);
      const pr = parent.getBoundingClientRect();
      const x = (ev.clientX ?? 0) - pr.left + 12;
      const y = (ev.clientY ?? 0) - pr.top + 12;
      tip.style.left = Math.max(8, Math.min(x, pr.width - 180)) + "px";
      tip.style.top  = Math.max(8, Math.min(y, pr.height - 100)) + "px";
    } catch {}
  }
  function hideTip() { if (tip) tip.hidden = true; }

  $all(".vbar", root).forEach(el => {
    el.addEventListener("mouseenter", (ev) => showTip(el, ev));
    el.addEventListener("mousemove", (ev) => showTip(el, ev));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("touchstart", (ev) => showTip(el, ev.touches[0]), { passive: true });
    el.addEventListener("touchmove", (ev) => showTip(el, ev.touches[0]), { passive: true });
    el.addEventListener("touchend", hideTip, { passive: true });
  });

  // Live-Refresh
  const off = addStateListener(() => {
    if (location.hash.replace("#", "") === "dashboard") render(root);
  });

  // Bei Resize einmal neu zeichnen
  window.addEventListener("resize", () => {
    if (location.hash.replace("#", "") === "dashboard") render(root);
  }, { once: true });
}
