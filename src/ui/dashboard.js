// FBA-CF-0005 — Reaktives Dashboard (local-first, ohne Libs)
// - Liest state via loadState()
// - Reagiert auf Änderungen via addStateListener()
// - Aggregiert je Monat: (Sales*payout + Extras) – Ausgaben
// - Zeigt KPIs + einfache Monatsbalken (grün/rot)

import { loadState, addStateListener } from "../data/storageLocal.js";
import { fmtEUR } from "../domain/metrics.js";

export async function render(root) {
  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div id="kpis" class="grid three" style="gap:12px"></div>
      <div class="row" style="align-items:center;margin-top:8px;margin-bottom:6px">
        <h3 style="margin:0">Monatsübersicht</h3>
        <div class="muted" id="range" style="margin-left:8px"></div>
        <div style="flex:1"></div>
        <small class="muted">grün = Netto+</small>
        <small class="muted" style="margin-left:8px">rot = Netto−</small>
      </div>
      <div id="bars"></div>
    </section>
  `;

  const elKPIs = root.querySelector("#kpis");
  const elRange = root.querySelector("#range");
  const elBars = root.querySelector("#bars");

  const off = addStateListener(redraw);
  await redraw();

  // Cleanup beim Tab-Wechsel
  root._cleanup = () => { try { off && off(); } catch {} };

  async function redraw() {
    const s = loadState();

    const startMonth = s?.settings?.startMonth || "2025-02";
    const horizon = Number(s?.settings?.horizonMonths || 18);
    const opening = Number(s?.openingEur || 0);

    const monthlySales = Number(s?.monthlyAmazonEur || 0);
    const payoutPct = Number(s?.payoutPct ?? 0.85);

    const extras = Array.isArray(s?.extras) ? s.extras : [];
    const outs = Array.isArray(s?.outgoings) ? s.outgoings : [];

    const months = buildMonths(startMonth, horizon); // ["YYYY-MM", ...]
    const perMonth = aggregate(months, monthlySales, payoutPct, extras, outs);

    // KPIs
    const sumExtras = perMonth.reduce((a, m) => a + m.extras, 0);
    const sumOuts = perMonth.reduce((a, m) => a + m.out, 0);
    const avgNet = perMonth.reduce((a, m) => a + m.net, 0) / (months.length || 1);
    const firstNeg = findFirstNegative(opening, perMonth);

    elKPIs.innerHTML = `
      ${kpi("Opening", fmtEUR(opening))}
      ${kpi("Extras (Σ)", fmtEUR(sumExtras))}
      ${kpi("Ausgaben (Σ)", fmtEUR(sumOuts))}
      ${kpi("Ø Netto/Monat", fmtEUR(avgNet))}
      ${kpi("Erster negativer Monat", firstNeg || "—")}
      ${kpi("Sales × Payout", fmtEUR(monthlySales * payoutPct))}
    `;

    // Range
    elRange.textContent = `${months[0] || "—"} … ${months[months.length - 1] || "—"}`;

    // Bars rendern
    const maxAbs = Math.max(1, ...perMonth.map(m => Math.abs(m.net)));
    elBars.innerHTML = `
      <div class="bars">
        ${perMonth.map(m => barRow(m, maxAbs)).join("")}
      </div>
    `;
    attachTooltips(elBars, perMonth);
  }
}

// ---------- helpers ----------
function kpi(label, value) {
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
    </div>
  `;
}

function buildMonths(startYYYYMM, n) {
  const [y0, m0] = String(startYYYYMM || "").split("-").map(Number);
  if (!y0 || !m0) return [];
  const out = [];
  for (let i = 0; i < Math.max(0, Number(n || 0)); i++) {
    const d = new Date(y0, (m0 - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Agg: inflow = sales*payout + extras; outflow = outs; net = inflow - outflow
function aggregate(months, monthlySales, payout, extras, outs) {
  const idx = new Map(months.map((m, i) => [m, i]));
  const rows = months.map(m => ({ month: m, inflow: monthlySales * payout, extras: 0, out: 0, net: 0 }));

  const toNum = (x) => {
    if (x == null) return 0;
    if (typeof x === "number") return x;
    return Number(String(x).replace(/\./g, "").replace(",", ".")) || 0;
  };
  const toMonth = (r) => {
    // erlaubt r.month ("YYYY-MM") oder r.date (ISO)
    if (r?.month && /^\d{4}-\d{2}$/.test(r.month)) return r.month;
    if (r?.date) {
      const d = new Date(r.date);
      if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return null;
  };

  for (const e of extras || []) {
    const m = toMonth(e); if (!m || !idx.has(m)) continue;
    rows[idx.get(m)].extras += toNum(e.amountEur);
  }
  for (const o of outs || []) {
    const m = toMonth(o); if (!m || !idx.has(m)) continue;
    rows[idx.get(m)].out += Math.abs(toNum(o.amountEur)); // Outflow positiv, später abziehen
  }
  for (const r of rows) {
    const inflow = (r.inflow || 0) + (r.extras || 0);
    const out = (r.out || 0);
    r.net = inflow - out;
  }
  return rows;
}

function findFirstNegative(opening, rows) {
  let bal = Number(opening || 0);
  for (const r of rows) {
    bal += r.net || 0;
    if (bal < 0) return r.month;
  }
  return null;
}

function barRow(m, maxAbs) {
  const pct = Math.min(100, Math.round((Math.abs(m.net) / maxAbs) * 100));
  const isPos = (m.net || 0) >= 0;
  const cls = isPos ? "bar bar-pos" : "bar bar-neg";
  return `
    <div class="bar-row" data-month="${escapeHtml(m.month)}" data-net="${String(m.net)}"
         data-inflow="${String(m.inflow)}" data-extras="${String(m.extras)}" data-out="${String(m.out)}">
      <div class="bar-label">${escapeHtml(m.month)}</div>
      <div class="${cls}" style="--w:${pct}%"></div>
      <div class="bar-val">${escapeHtml(fmtEUR(m.net || 0))}</div>
    </div>
  `;
}

function attachTooltips(container, rows) {
  // einfacher Tooltip via title-Attribut
  const map = new Map(rows.map(r => [r.month, r]));
  container.querySelectorAll(".bar-row").forEach(el => {
    const m = el.getAttribute("data-month");
    const r = map.get(m);
    if (!r) return;
    const txt = [
      `${m}`,
      `Inflow (Sales×Payout): ${fmtEUR(r.inflow || 0)}`,
      `Extras: ${fmtEUR(r.extras || 0)}`,
      `Outflows: ${fmtEUR(r.out || 0)}`,
      `Netto: ${fmtEUR(r.net || 0)}`
    ].join("\n");
    el.setAttribute("title", txt);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
