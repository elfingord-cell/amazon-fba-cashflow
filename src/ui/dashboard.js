export async function render(root) {
  root.innerHTML = `
    <section class="grid two">
      <div class="card">
        <div class="kpi">Min. Closing (18M) <span class="muted">Beispiel</span></div>
        <h1>—</h1>
      </div>
      <div class="card">
        <div class="kpi">Opening heute</div>
        <h1>—</h1>
      </div>
    </section>
    <section class="card">
      <h3>Closing-Saldo (Linie)</h3>
      <canvas class="chart" id="chart-line"></canvas>
    </section>
    <section class="card">
      <h3>Netto (Balken)</h3>
      <canvas class="chart" id="chart-bars"></canvas>
    </section>
  `;

  const line = root.querySelector("#chart-line");
  const bars = root.querySelector("#chart-bars");
  drawLine(line, [50, 70, 80, 90, 92, 95]);
  drawBars(bars, [-5, 20, 3, 2, 2, 2]);

  function drawLine(canvas, data){
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.clientWidth, H = canvas.height = canvas.clientHeight;
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle = "#3BC2A7"; ctx.lineWidth = 2;
    const max = Math.max(...data), min = Math.min(...data);
    const xStep = W / (data.length - 1 || 1);
    ctx.beginPath();
    data.forEach((v,i)=>{
      const x = i * xStep;
      const y = H - ((v - min) / (max - min || 1)) * (H - 12) - 6;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
  }
  function drawBars(canvas, data){
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.clientWidth, H = canvas.height = canvas.clientHeight;
    ctx.clearRect(0,0,W,H);
    const max = Math.max(0, ...data), min = Math.min(0, ...data);
    const zeroY = H - ((0 - min)/(max - min || 1)) * (H - 12) - 6;
    const barW = Math.max(8, (W - 24) / data.length - 6);
    data.forEach((v,i)=>{
      const x = 12 + i * (barW + 6);
      const y = H - ((v - min)/(max - min || 1)) * (H - 12) - 6;
      const h = zeroY - y;
      ctx.fillStyle = v >= 0 ? "#2BAE66" : "#E45858";
      ctx.fillRect(x, h>=0? y: zeroY, barW, Math.abs(h));
    });
    ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
  }
}
