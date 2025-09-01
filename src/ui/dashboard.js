// FBA-CF-0003 — Dashboard liest Eingaben, zeigt KPIs und Charts
import { loadState, saveState } from "../data/storageLocal.js";
import { buildSeries, fmtEUR } from "../domain/metrics.js";

export async function render(root) {
  const state = loadState();
  const s = buildSeries(state);

  root.innerHTML = `
    <section class="grid two">
      <div class="card">
        <div class="kpi">Opening heute</div>
        <h1>${fmtEUR(s.opening)}</h1>
        <div class="muted">Start: ${s.start}, Horizont: ${s.horizon} Monate</div>
      </div>
      <div class="card">
        <div class="kpi">Min. Closing (Zeitraum)</div>
        <h1>${fmtEUR(Math.min(...s.closing))}</h1>
        <div class="muted">Berechnet aus Umsatz × Payout ± Extras − Ausgaben</div>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <h3>Closing-Saldo (Linie)</h3>
        <div style="flex:1"></div>
        <button class="btn" id="btn-testdata">Testdaten laden</button>
      </div>
      <canvas class="chart" id="chart-line" aria-label="Closing über Zeit" role="img"></canvas>
    </section>

    <section class="card">
      <h3>Netto je Monat (Balken)</h3>
      <canvas class="chart" id="chart-bars" aria-label="Monatlicher Netto-Cashflow" role="img"></canvas>
      <div class="muted" style="margin-top:6px">Grün = positiv, Rot = negativ</div>
    </section>
  `;

  // Charts
  drawLine($("#chart-line", root), s.months, s.closing);
  drawBars($("#chart-bars", root), s.months, s.net);

  // Testdaten laden
  $("#btn-testdata", root).addEventListener("click", () => {
    const st = loadState();
    const next = {
      ...st,
      openingEur: 50000.25,
      monthlyAmazonEur: 22500,
      payoutPct: 0.85
    };
    saveState(next);
    // neu aufbauen
    render(root);
  });

  // --- Helpers ---
  function $(sel, el = document) { return el.querySelector(sel); }

  function drawLine(canvas, labels, data) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.clientWidth || 600;
    const H = canvas.height = canvas.clientHeight || 220;
    ctx.clearRect(0,0,W,H);

    const max = Math.max(...data), min = Math.min(...data);
    const pad = 10;
    const innerW = W - pad*2, innerH = H - pad*2;
    const xStep = innerW / (labels.length - 1 || 1);
    const toY = v => pad + innerH - ((v - min) / (max - min || 1)) * innerH;

    // Achse
    ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();

    // Linie
    ctx.strokeStyle = "#3BC2A7"; ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v,i)=>{
      const x = pad + i * xStep;
      const y = toY(v);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  function drawBars(canvas, labels, data) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.clientWidth || 600;
    const H = canvas.height = canvas.clientHeight || 220;
    ctx.clearRect(0,0,W,H);

    const max = Math.max(0, ...data), min = Math.min(0, ...data);
    const pad = 10;
    const innerW = W - pad*2, innerH = H - pad*2;
    const zeroY = pad + innerH - ((0 - min) / (max - min || 1)) * innerH;

    const gap = 6;
    const barW = Math.max(8, (innerW - (labels.length - 1) * gap) / labels.length);

    labels.forEach((_, i) => {
      const v = data[i];
      const x = pad + i * (barW + gap);
      const y = pad + innerH - ((v - min) / (max - min || 1)) * innerH;
      const h = zeroY - y;
      ctx.fillStyle = v >= 0 ? "#2BAE66" : "#E45858";
      ctx.fillRect(x, h >= 0 ? y : zeroY, barW, Math.abs(h));
    });

    // Nulllinie
    ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(W - pad, zeroY); ctx.stroke();
  }
}
