import { loadState } from "../data/storageLocal.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value, fallback){
  if (!value) return fallback ? new Date(fallback) : null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? (fallback ? new Date(fallback) : null) : d;
}

function addDays(date, days){
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function monthRange(startMonth, count){
  if (!startMonth || !count) return [];
  const [y, m] = String(startMonth).split("-").map(Number);
  if (!y || !m) return [];
  const start = new Date(y, m - 1, 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getTime());
    d.setMonth(d.getMonth() + i);
    return { label: d.toLocaleString("de-DE", { month: "short", year: "numeric" }), start: d };
  });
}

function determineStartMonth(state, entries){
  if (state?.settings?.startMonth) return state.settings.startMonth;
  const dates = entries
    .map(entry => entry?.orderDate)
    .filter(Boolean)
    .sort();
  if (dates.length) return dates[0].slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function determineHorizon(state){
  const h = Number(state?.settings?.horizonMonths);
  return Number.isFinite(h) && h > 0 ? h : 12;
}

function parseEuro(str){
  if (typeof str === "number") return str;
  if (!str) return 0;
  const cleaned = String(str).trim().replace(/\./g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parsePercent(str){
  if (typeof str === "number") return str;
  if (str == null || str === "") return 0;
  const num = Number(String(str).trim().replace(",", "."));
  return Number.isFinite(num) ? num : 0;
}

function fmtDate(date){
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtEUR(value){
  return Number(value || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function computeAnchors(entry){
  const order = parseDate(entry.orderDate, new Date());
  const prodDays = Number(entry.prodDays || 0);
  const transitDays = Number(entry.transitDays || 0);
  const prodDone = addDays(order, prodDays);
  const etd = addDays(prodDone, Number(entry.etdLagDays || 0));
  const eta = addDays(prodDone, transitDays);
  return {
    ORDER_DATE: order,
    PROD_DONE: prodDone,
    ETD: etd,
    ETA: eta,
  };
}

function dueDateForMilestone(anchors, milestone){
  if (!milestone) return anchors.ORDER_DATE;
  const base = anchors[milestone.anchor || "ORDER_DATE"] || anchors.ORDER_DATE;
  return addDays(base, Number(milestone.lagDays || 0));
}

function buildPhases(anchors){
  const phases = [];
  if (anchors.ORDER_DATE && anchors.PROD_DONE && anchors.PROD_DONE > anchors.ORDER_DATE){
    phases.push({ cls: "production", label: "Produktion", start: anchors.ORDER_DATE, end: anchors.PROD_DONE });
  }
  if (anchors.PROD_DONE && anchors.ETA && anchors.ETA > anchors.PROD_DONE){
    phases.push({ cls: "transit", label: "Transit", start: anchors.PROD_DONE, end: anchors.ETA });
  }
  return phases;
}

function sortEntries(entries){
  return entries.slice().sort((a, b) => {
    const da = parseDate(a.orderDate, new Date(8640000000000000));
    const db = parseDate(b.orderDate, new Date(8640000000000000));
    return da - db;
  });
}

function clampPercent(v){
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v * 10) / 10;
}

function renderTimelineRow(entry, timeline){
  const anchors = computeAnchors(entry);
  const phases = buildPhases(anchors);
  const goods = parseEuro(entry.goodsEur || entry.goodsValueEur || entry.goodsValueUsd);
  const milestones = Array.isArray(entry.milestones) ? entry.milestones : [];
  const pctSum = milestones.reduce((acc, m) => acc + parsePercent(m.percent || 0), 0);
  const pctRounded = Math.round(pctSum * 10) / 10;
  const warn = Math.abs(pctRounded - 100) > 0.1;

  function pos(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    const clamped = Math.min(Math.max(date.getTime(), timeline.startMs), timeline.endMs);
    const diffDays = (clamped - timeline.startMs) / MS_PER_DAY;
    return Math.max(0, Math.min(100, (diffDays / timeline.totalDays) * 100));
  }

  const phaseHtml = phases.map(phase => {
    const left = pos(phase.start);
    const width = Math.max(0.75, pos(phase.end) - left);
    return `<div class="plan-phase ${phase.cls}" style="left:${left}%;width:${width}%" title="${phase.label}"></div>`;
  }).join("");

  const markers = milestones.map(m => {
    const due = dueDateForMilestone(anchors, m);
    const left = pos(due);
    const pct = clampPercent(parsePercent(m.percent || 0));
    const amt = goods * (pct / 100);
    const title = `${m.label || "Milestone"} – ${fmtDate(due)} – ${fmtEUR(amt)}`;
    return `<div class="plan-marker" style="left:${left}%" title="${title}"><span></span></div>`;
  }).join("");

  const label = entry.type === "FO" ? (entry.foNo || "FO") : (entry.poNo || "PO");
  const subtitleParts = [
    `Order ${fmtDate(anchors.ORDER_DATE)}`,
    `ETA ${fmtDate(anchors.ETA)}`,
  ];
  if (goods > 0) subtitleParts.push(fmtEUR(goods));

  const warnClass = warn ? " warn" : "";
  const warnBadge = warn ? `<span class="plan-alert" title="Meilensteine summieren sich auf ${pctRounded}%">⚠︎</span>` : "";

  return `
    <div class="plan-row${warnClass}">
      <div class="plan-label">
        <div class="plan-title">${entry.type} · ${label} ${warnBadge}</div>
        <div class="plan-meta">${subtitleParts.join(" · ")}</div>
      </div>
      <div class="plan-track">
        ${phaseHtml}
        ${markers}
      </div>
    </div>
  `;
}

export async function render(root){
  const state = loadState();
  const pos = Array.isArray(state?.pos) ? state.pos.map(p => ({ ...p, type: "PO" })) : [];
  const fos = Array.isArray(state?.fos) ? state.fos.map(p => ({ ...p, type: "FO" })) : [];
  const entries = sortEntries([...pos, ...fos]);

  if (!entries.length){
    root.innerHTML = `
      <section class="card">
        <h2>Plan</h2>
        <p class="muted">Noch keine POs oder FOs erfasst. Lege zuerst Bestellungen in den entsprechenden Tabs an.</p>
      </section>
    `;
    return;
  }

  const startMonth = determineStartMonth(state, entries);
  const horizon = determineHorizon(state);
  const months = monthRange(startMonth, horizon);

  if (!months.length){
    root.innerHTML = `
      <section class="card">
        <h2>Plan</h2>
        <p class="muted">Zeitraum konnte nicht berechnet werden. Bitte Startmonat in den Settings prüfen.</p>
      </section>
    `;
    return;
  }

  const startDate = months[0].start;
  const endDate = new Date(startDate.getTime());
  endDate.setMonth(endDate.getMonth() + horizon);
  const timeline = {
    startMs: startDate.getTime(),
    endMs: endDate.getTime(),
    totalDays: Math.max(1, (endDate.getTime() - startDate.getTime()) / MS_PER_DAY)
  };

  const monthHeader = months.map(m => `<div class="plan-month">${m.label}</div>`).join("");
  const rows = entries.map(entry => renderTimelineRow(entry, timeline)).join("");

  root.innerHTML = `
    <section class="card plan-card">
      <h2>Plan</h2>
      <p class="muted">Zeitplan der aktiven Purchase & Forecast Orders. Phasen und Zahlungs-Meilensteine werden relativ zum ausgewählten Startmonat visualisiert.</p>
      <div class="plan-grid" style="--plan-cols:${months.length}">
        <div class="plan-months">
          <div class="plan-month head"></div>
          ${monthHeader}
        </div>
        <div class="plan-rows">
          ${rows}
        </div>
      </div>
      <div class="plan-legend">
        <span><span class="legend-box production"></span> Produktion</span>
        <span><span class="legend-box transit"></span> Transit</span>
        <span><span class="legend-dot"></span> Zahlung (Milestone)</span>
      </div>
      <p class="muted small">Hinweis: Reihen mit ⚠︎ markieren Meilenstein-Summen ≠ 100%.</p>
    </section>
  `;
}
