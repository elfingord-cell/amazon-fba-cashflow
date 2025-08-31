
import { fmtEUR } from "../domain/helpers.js";

export function DashboardView(state) {
  const el = document.createElement("section");
  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="kpi">${fmtEUR(minClosing(state))}</div>
        <div class="muted">Min. Closing (über ${state.settings.horizonMonths} Monate)</div>
      </div>
      <div class="card">
        <div class="kpi">${fmtEUR(state._computed.monthly[0]?.opening ?? 0)}</div>
        <div class="muted">Opening heute</div>
      </div>
    </div>
    <div class="card">
      <h3>Closing-Saldo (Linie)</h3>
      <canvas class="chart" id="cloChart" width="900" height="180" aria-label="Closing-Saldo über Zeit" role="img"></canvas>
    </div>
    <div class="card">
      <h3>Netto (Balken)</h3>
      <canvas class="chart" id="netChart" width="900" height="180" aria-label="Netto über Zeit" role="img"></canvas>
    </div>
  `;
  requestAnimationFrame(() => {
    drawLine(document.getElementById("cloChart"), state._computed.monthly.map(r => r.closing));
    drawBars(document.getElementById("netChart"), state._computed.monthly.map(r => r.net));
  });
  return el;
}

function minClosing(state){ return Math.min(...state._computed.monthly.map(r=>r.closing)); }

function drawLine(canvas, values){
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, pad = 10;
  ctx.clearRect(0,0,w,h);
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  ctx.strokeStyle = "#6dc5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = pad + (w-2*pad) * (i/(values.length-1||1));
    const y = h - pad - (h-2*pad)*((v-min)/span);
    i? ctx.lineTo(x,y): ctx.moveTo(x,y);
  });
  ctx.stroke();
}

function drawBars(canvas, values){
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, pad = 10;
  ctx.clearRect(0,0,w,h);
  const maxAbs = Math.max(1, ...values.map(v=>Math.abs(v)));
  const bw = (w-2*pad)/values.length;
  values.forEach((v,i)=>{
    const x = pad + i*bw + 2;
    const y0 = h/2, y = v>=0 ? y0 - (h/2 - pad)*(v/maxAbs) : y0;
    const bh = Math.max(2, Math.abs((h/2 - pad)*(v/maxAbs)));
    ctx.fillStyle = v>=0 ? "#35c27c" : "#ff7a7a";
    ctx.fillRect(x, y, Math.max(2, bw-4), bh);
  });
}
