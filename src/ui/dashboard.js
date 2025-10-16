// UI: Dashboard – Monatsübersicht & detaillierte Monats-P/L-Analyse
import { loadState, addStateListener } from "../data/storageLocal.js";
import { computeSeries, fmtEUR } from "../domain/cashflow.js";

const fmtEUR0 = val =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(val || 0));

const fmtEUR2 = val =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val || 0));

const monthFormatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("de-DE");

const CATEGORY_ORDER = [
  "Sales × Payout",
  "Extras (In)",
  "Extras (Out)",
  "PO/FO-Zahlungen",
  "Importkosten",
  "Fixkosten",
  "Dividende & KapESt",
];

const MODE_OPTIONS = [
  { key: "planned", label: "Geplant" },
  { key: "paid", label: "Bezahlt" },
  { key: "all", label: "Geplant + Bezahlt" },
];

const CONTROL_PRESETS = [
  { key: "all", label: "Alle" },
  { key: "none", label: "Keine" },
  { key: "last3", label: "Letzte 3" },
  { key: "last6", label: "Letzte 6" },
  { key: "last12", label: "Letzte 12" },
];

const plState = {
  selectedMonths: null,
  mode: "planned",
  showScenario: false,
  search: "",
  categories: new Set(),
};

let plData = null;
let plEntryLookup = new Map();
let plExportRows = [];
let dashboardRoot = null;
let stateListenerOff = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMonthLabel(yyyymm) {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, 1);
  return monthFormatter.format(date);
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function ensureSelection(months) {
  const available = Array.isArray(months) ? months : [];
  const previous = Array.isArray(plState.selectedMonths)
    ? plState.selectedMonths.filter(m => available.includes(m))
    : [];
  if (previous.length) {
    plState.selectedMonths = previous;
    return;
  }
  const defaultCount = Math.min(12, available.length);
  plState.selectedMonths = available.slice(0, defaultCount || available.length || 0);
}

function fmtSigned(value) {
  const num = Number(value || 0);
  return fmtEUR2(num);
}

function iconForDirection(direction) {
  return direction === "out" ? "↓" : "↑";
}

function ensureGlobalTip() {
  let el = document.getElementById("global-chart-tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-chart-tip";
    el.className = "chart-tip";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function applyControlSelection(control, months) {
  switch (control) {
    case "all":
      return months.slice();
    case "none":
      return [];
    case "last3":
      return months.slice(-3);
    case "last6":
      return months.slice(-6);
    case "last12":
      return months.slice(-12);
    default:
      return plState.selectedMonths || [];
  }
}

function aggregateEntries(entries) {
  const result = new Map();
  for (const entry of entries) {
    const key = entry.group || "Sonstiges";
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(entry);
  }
  return result;
}

function computeRowAmounts(entry) {
  const baseline = entry.direction === "out" ? -entry.amount : entry.amount;
  const scenarioAmountRaw = entry.scenarioAmount != null ? entry.scenarioAmount : entry.amount;
  const scenario = entry.direction === "out" ? -scenarioAmountRaw : scenarioAmountRaw;
  const delta = scenario - baseline;
  return { baseline, scenario, delta };
}

function buildPLCards(data) {
  plEntryLookup = new Map();
  plExportRows = [];
  if (!data || !Array.isArray(data.months) || !Array.isArray(data.breakdown)) return "";
  const order = data.months;
  const selectedSet = new Set(plState.selectedMonths || []);
  const cards = [];
  for (const month of order) {
    if (!selectedSet.has(month)) continue;
    const row = data.breakdown.find(r => r.month === month);
    if (!row) continue;
    cards.push(buildMonthCard(row));
  }
  return cards.join("");
}

function buildMonthCard(row) {
  const entries = Array.isArray(row.entries) ? row.entries.slice() : [];
  let filtered = entries;
  if (plState.mode === "planned") filtered = filtered.filter(e => !e.paid);
  else if (plState.mode === "paid") filtered = filtered.filter(e => e.paid);

  if (plState.categories.size) {
    filtered = filtered.filter(e => plState.categories.has(e.group));
  }

  if (plState.search) {
    const needle = plState.search.toLowerCase();
    filtered = filtered.filter(e => (e.label || "").toLowerCase().includes(needle));
  }

  const grouped = aggregateEntries(filtered);
  const orderedGroups = CATEGORY_ORDER.concat([...grouped.keys()].filter(k => !CATEGORY_ORDER.includes(k)));

  let cardNet = 0;
  let cardScenario = 0;
  let salesSum = 0;

  const sections = [];
  let rowIndex = 0;

  for (const groupKey of orderedGroups) {
    const records = grouped.get(groupKey);
    if (!records || !records.length) continue;

    let groupBaseline = 0;
    let groupScenario = 0;

    const rows = records
      .map((entry, idx) => {
        const { baseline, scenario, delta } = computeRowAmounts(entry);
        groupBaseline += baseline;
        groupScenario += scenario;
        const entryKey = `${row.month}-${rowIndex++}-${entry.id || entry.label || "entry"}`;
        plEntryLookup.set(entryKey, {
          entry,
          month: row.month,
          monthLabel: formatMonthLabel(row.month),
          group: groupKey,
          baseline,
          scenario,
          delta,
          opening: row.opening,
          closing: row.closing,
        });
        plExportRows.push({
          key: entryKey,
          month: row.month,
          monthLabel: formatMonthLabel(row.month),
          group: groupKey,
          label: entry.label,
          date: entry.date,
          baseline,
          scenario,
          delta,
          status: entry.paid ? "Bezahlt" : "Geplant",
        });
        if (groupKey === "Sales × Payout") salesSum += baseline;
        return `
          <tr class="pl-row" data-entry-id="${escapeHtml(entryKey)}" tabindex="0">
            <td class="pl-row-cat" data-label="Kategorie">${escapeHtml(groupKey)}</td>
            <td class="pl-row-label" data-label="Label">
              <span class="pl-direction" aria-hidden="true">${iconForDirection(entry.direction)}</span>
              <span class="pl-label-text">${escapeHtml(entry.label || "")}</span>
              <span class="badge ${entry.paid ? "badge-paid" : "badge-plan"}">${entry.paid ? "Bezahlt" : "Geplant"}</span>
            </td>
            <td class="pl-row-date" data-label="Datum">${escapeHtml(formatDateLabel(entry.date))}</td>
            <td class="pl-row-amount" data-label="Betrag">${fmtSigned(baseline)}</td>
            ${plState.showScenario ? `<td class="pl-row-delta" data-label="Δ">${fmtSigned(delta)}</td>` : ""}
          </tr>
        `;
      })
      .join("");

    cardNet += groupBaseline;
    cardScenario += groupScenario;

    sections.push(`
      <details class="pl-group" open>
        <summary>
          <span class="pl-group-title">${escapeHtml(groupKey)}</span>
          <span class="pl-group-sum">${fmtSigned(groupBaseline)}</span>
          ${plState.showScenario ? `<span class="pl-group-delta">${fmtSigned(groupScenario - groupBaseline)}</span>` : ""}
        </summary>
        <div class="pl-group-body">
          <table class="pl-table" role="table">
            <thead>
              <tr>
                <th scope="col">Kategorie</th>
                <th scope="col">Label</th>
                <th scope="col">Datum</th>
                <th scope="col">Betrag</th>
                ${plState.showScenario ? "<th scope=\"col\">Δ</th>" : ""}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </details>
    `);
  }

  const closing = row.opening + cardNet;
  const scenarioNet = cardScenario;
  const scenarioDelta = scenarioNet - cardNet;

  return `
    <article class="pl-card" data-month="${escapeHtml(row.month)}">
      <header class="pl-card-header">
        <div>
          <h3>${escapeHtml(formatMonthLabel(row.month))}</h3>
          <p class="pl-card-sub">Saldo Monatsende: ${fmtSigned(closing)}</p>
        </div>
        <div class="pl-card-metrics">
          <div class="pl-metric">
            <span class="pl-metric-label">P/L gesamt</span>
            <span class="pl-metric-value">${fmtSigned(cardNet)}</span>
          </div>
          <div class="pl-metric">
            <span class="pl-metric-label">Sales × Payout</span>
            <span class="pl-metric-value">${fmtSigned(salesSum)}</span>
          </div>
          <div class="pl-metric">
            <span class="pl-metric-label">Netto-Cash</span>
            <span class="pl-metric-value">${fmtSigned(cardNet)}</span>
          </div>
          ${plState.showScenario ? `
            <div class="pl-metric">
              <span class="pl-metric-label">Δ Szenario</span>
              <span class="pl-metric-value">${fmtSigned(scenarioDelta)}</span>
            </div>
          ` : ""}
        </div>
      </header>
      <div class="pl-card-body">
        ${sections.join("") || '<p class="pl-empty">Keine Daten in diesem Monat.</p>'}
      </div>
    </article>
  `;
}

function buildMonthChips(months) {
  const selected = new Set(plState.selectedMonths || []);
  const chips = months
    .map(month => {
      const active = selected.has(month);
      return `<button type="button" class="chip ${active ? "active" : ""}" data-month="${escapeHtml(month)}" aria-pressed="${active}">${escapeHtml(month)}</button>`;
    })
    .join("");
  return chips;
}

function buildCategoryFilters() {
  const options = CATEGORY_ORDER;
  return options
    .map(key => {
      const checked = plState.categories.has(key);
      return `
        <label class="pl-cat">
          <input type="checkbox" class="pl-cat-checkbox" value="${escapeHtml(key)}" ${checked ? "checked" : ""} />
          <span>${escapeHtml(key)}</span>
        </label>
      `;
    })
    .join("");
}

function buildPLSectionHTML(data) {
  ensureSelection(data.months || []);
  const chips = buildMonthChips(data.months || []);
  const cards = buildPLCards(data);
  const selectionCount = plState.selectedMonths ? plState.selectedMonths.length : 0;
  return `
    <div class="pl-headline">
      <h2>Monats-P/L</h2>
      <p class="pl-lead">Wähle Monate aus, um Gewinn/Verlust und alle Positionen transparent einzusehen.</p>
    </div>
    <div class="pl-controls" role="group" aria-label="Monatsauswahl">
      <div class="pl-control-bar">
        <div class="pl-presets" aria-label="Schnellauswahl">
          ${CONTROL_PRESETS.map(preset => `<button type="button" class="chip secondary" data-control="${preset.key}">${preset.label}</button>`).join("")}
        </div>
        <div class="pl-selection-count">Ausgewählt: ${selectionCount} ${selectionCount === 1 ? "Monat" : "Monate"}</div>
      </div>
      <div class="pl-month-chips" role="listbox" aria-label="Monate wählen">
        ${chips}
      </div>
    </div>
    <div class="pl-toolbar">
      <div class="pl-modes" role="group" aria-label="Modus">
        ${MODE_OPTIONS.map(option => `<button type="button" class="pl-mode ${plState.mode === option.key ? "active" : ""}" data-mode="${option.key}">${option.label}</button>`).join("")}
      </div>
      <label class="pl-search">
        <span class="pl-search-label">Suche</span>
        <input type="search" id="pl-search" placeholder="Label durchsuchen" value="${escapeHtml(plState.search)}" />
      </label>
      <label class="pl-scenario">
        <input type="checkbox" id="pl-scenario-toggle" ${plState.showScenario ? "checked" : ""} />
        <span>Δ-Szenario anzeigen</span>
      </label>
      <button type="button" class="pl-export" id="pl-export">Export (CSV)</button>
    </div>
    <div class="pl-category-filter" aria-label="Kategorie-Filter">
      ${buildCategoryFilters()}
    </div>
    <div class="pl-cards">
      ${cards || '<div class="pl-empty">Keine Monate ausgewählt. Wähle oben mindestens einen Monat.</div>'}
    </div>
    <aside class="pl-drawer" data-pl-drawer role="dialog" aria-modal="true" hidden tabindex="-1">
      <div class="pl-drawer-inner">
        <button type="button" class="pl-drawer-close" aria-label="Details schließen">×</button>
        <div class="pl-drawer-content"></div>
      </div>
    </aside>
  `;
}

function attachPLHandlers(plRoot) {
  const monthsWrap = plRoot.querySelector(".pl-month-chips");
  if (monthsWrap) {
    monthsWrap.addEventListener("click", ev => {
      const btn = ev.target.closest(".chip[data-month]");
      if (!btn) return;
      const month = btn.getAttribute("data-month");
      const set = new Set(plState.selectedMonths || []);
      if (set.has(month)) set.delete(month); else set.add(month);
      const ordered = (plData?.months || []).filter(m => set.has(m));
      plState.selectedMonths = ordered;
      updatePLSection(plRoot);
    });
  }

  plRoot.querySelectorAll(".chip[data-control]").forEach(btn => {
    btn.addEventListener("click", () => {
      const control = btn.getAttribute("data-control");
      plState.selectedMonths = applyControlSelection(control, plData?.months || []);
      updatePLSection(plRoot);
    });
  });

  plRoot.querySelectorAll(".pl-mode").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");
      plState.mode = mode;
      updatePLSection(plRoot);
    });
  });

  const scenarioToggle = plRoot.querySelector("#pl-scenario-toggle");
  if (scenarioToggle) {
    scenarioToggle.addEventListener("change", () => {
      plState.showScenario = scenarioToggle.checked;
      updatePLSection(plRoot);
    });
  }

  const searchInput = plRoot.querySelector("#pl-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      plState.search = searchInput.value || "";
      updatePLSection(plRoot);
    });
  }

  plRoot.querySelectorAll(".pl-cat-checkbox").forEach(box => {
    box.addEventListener("change", () => {
      const value = box.value;
      if (box.checked) plState.categories.add(value);
      else plState.categories.delete(value);
      updatePLSection(plRoot);
    });
  });

  const exportBtn = plRoot.querySelector("#pl-export");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      exportPLCsv();
    });
  }

  const cards = plRoot.querySelector(".pl-cards");
  if (cards) {
    cards.addEventListener("click", ev => {
      const row = ev.target.closest(".pl-row");
      if (!row) return;
      const id = row.getAttribute("data-entry-id");
      showDrawer(id, plRoot);
    });
    cards.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const row = ev.target.closest(".pl-row");
      if (!row) return;
      ev.preventDefault();
      const id = row.getAttribute("data-entry-id");
      showDrawer(id, plRoot);
    });
  }

  const drawer = plRoot.querySelector("[data-pl-drawer]");
  if (drawer) {
    drawer.addEventListener("keydown", ev => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        hideDrawer(plRoot);
      }
    });
    const closeBtn = drawer.querySelector(".pl-drawer-close");
    if (closeBtn) closeBtn.addEventListener("click", () => hideDrawer(plRoot));
  }
}

function buildDrawerHtml(record) {
  if (!record) return "";
  const { entry, monthLabel, group, baseline, scenario, delta } = record;
  const rows = [
    { label: "Kategorie", value: group },
    { label: "Monat", value: monthLabel },
    { label: "Datum", value: formatDateLabel(entry.date) },
    { label: "Betrag", value: fmtSigned(baseline) },
  ];
  if (plState.showScenario) {
    rows.push({ label: "Szenario", value: fmtSigned(scenario) });
    rows.push({ label: "Δ", value: fmtSigned(delta) });
  }
  rows.push({ label: "Status", value: entry.paid ? "Bezahlt" : "Geplant" });
  if (entry.anchor) rows.push({ label: "Anchor", value: entry.anchor });
  if (entry.lagDays != null) rows.push({ label: "Lag (Tage)", value: String(entry.lagDays) });
  if (entry.lagMonths != null) rows.push({ label: "Lag (Monate)", value: String(entry.lagMonths) });
  if (entry.percent != null) rows.push({ label: "Satz", value: `${entry.percent}` });
  if (entry.sourceNumber) rows.push({ label: "Beleg", value: entry.sourceNumber });
  if (entry.source) rows.push({ label: "Quelle", value: entry.source.toUpperCase ? entry.source.toUpperCase() : entry.source });

  const targetTab = entry.sourceTab || "#dashboard";
  return `
    <h3>${escapeHtml(entry.label || "Detail")}</h3>
    <dl class="pl-drawer-list">
      ${rows
        .map(item => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(String(item.value ?? ""))}</dd></div>`)
        .join("")}
    </dl>
    <p class="pl-drawer-link"><a href="${escapeHtml(targetTab)}">Zur Quelle wechseln</a></p>
    ${entry.tooltip ? `<p class="pl-drawer-hint">${escapeHtml(entry.tooltip)}</p>` : ""}
  `;
}

function showDrawer(entryId, plRoot) {
  if (!entryId || !plRoot) return;
  const record = plEntryLookup.get(entryId);
  const drawer = plRoot.querySelector("[data-pl-drawer]");
  if (!record || !drawer) return;
  const content = drawer.querySelector(".pl-drawer-content");
  if (content) content.innerHTML = buildDrawerHtml(record);
  drawer.hidden = false;
  drawer.classList.add("open");
  drawer.focus();
}

function hideDrawer(plRoot) {
  const drawer = plRoot.querySelector("[data-pl-drawer]");
  if (!drawer) return;
  drawer.hidden = true;
  drawer.classList.remove("open");
}

function exportPLCsv() {
  if (!plExportRows.length) {
    alert("Keine Daten für den Export ausgewählt.");
    return;
  }
  const showScenario = plState.showScenario;
  const header = ["Monat", "Kategorie", "Label", "Datum", "Status", "Betrag"];
  if (showScenario) header.push("Szenario", "Δ");
  const lines = [header.join(";")];
  for (const row of plExportRows) {
    const base = [
      row.month,
      row.group,
      row.label,
      row.date ? formatDateLabel(row.date) : "",
      row.status,
      fmtSigned(row.baseline),
    ];
    if (showScenario) {
      base.push(fmtSigned(row.scenario));
      base.push(fmtSigned(row.delta));
    }
    lines.push(base.map(value => `"${String(value).replace(/"/g, '""')}"`).join(";"));
  }
  const payload = lines.join("\n");
  const months = plState.selectedMonths || [];
  const first = months[0] || "";
  const last = months[months.length - 1] || first;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `PL_${first}-${last}_${stamp}.csv`;
  const blob = new Blob([payload], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function updatePLSection(plRoot) {
  if (!plRoot || !plData) return;
  plRoot.innerHTML = buildPLSectionHTML(plData);
  attachPLHandlers(plRoot);
}

export async function render(root) {
  dashboardRoot = root;
  const state = loadState();
  const { months, series, kpis, breakdown } = computeSeries(state);
  plData = { months, breakdown };
  ensureSelection(months);

  const opening = Number(kpis.opening || 0);
  const closing = breakdown.map(b => b.closing);
  const monthOpening = breakdown.map(b => b.opening);
  const netTotals = series.map(r => Number(r.net?.total || 0));
  const closingValues = [opening, ...closing];
  const inflowTotals = series.map(r => Number(r.inflow?.total || 0));
  const outflowTotals = series.map(r => -Number(r.outflow?.total || 0));
  const netPaidTotals = series.map(r => Number(r.net?.paid || 0));
  const netOpenTotals = series.map(r => Number(r.net?.open || 0));

  const rawTop = Math.max(
    0,
    ...inflowTotals,
    ...netTotals.filter(v => v > 0),
    ...netPaidTotals.filter(v => v > 0),
    ...netOpenTotals.filter(v => v > 0),
    ...closingValues,
  );

  const rawBottom = Math.min(
    0,
    ...outflowTotals,
    ...netTotals.filter(v => v < 0),
    ...netPaidTotals.filter(v => v < 0),
    ...netOpenTotals.filter(v => v < 0),
    ...closingValues,
  );
  const paddedTop = rawTop === 0 ? 0 : rawTop * 1.1;
  const paddedBottom = rawBottom === 0 ? 0 : rawBottom * 1.1;
  const steps = 5;
  const range = (paddedTop - paddedBottom) / steps || 1;
  const niceStep = niceStepSize(range);
  const top = Math.max(niceStep, Math.ceil(paddedTop / niceStep) * niceStep);
  const bottom = rawBottom < 0 ? Math.floor(paddedBottom / niceStep) * niceStep : 0;
  const span = (top - bottom) || niceStep;
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => top - (span / steps) * i);

  const cols = months.length || 1;
  const X = i => ((i + 0.5) * 1000) / cols;
  const XPct = i => ((i + 0.5) * 100) / cols;
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
  const colWidth = 100 / cols;
  const edgeThreshold = colWidth * 0.75;
  const closingLabels = closing
    .map((v, i) => {
      const xp = XPct(i);
      const edgeClass = xp < edgeThreshold ? " edge-start" : xp > 100 - edgeThreshold ? " edge-end" : "";
      return `<div class="closing-label${edgeClass}" style="--x:${xp}; --y:${YPct(v)};">${fmtEUR0(v)}</div>`;
    })
    .join("");
  const netStrip = series
    .map(r => `<div class="net ${Number(r.net?.total || 0) >= 0 ? "pos" : "neg"}">${fmtEUR0(r.net?.total || 0)}</div>`)
    .join("");

  const BAR_TYPES = ["inflow", "outflow", "net"];

  function valuesFor(type, row) {
    if (type === "inflow") {
      return [
        { key: "paid", value: Number(row.inflow?.paid || 0) },
        { key: "open", value: Number(row.inflow?.open || 0) },
      ];
    }
    if (type === "outflow") {
      return [
        { key: "paid", value: -Number(row.outflow?.paid || 0) },
        { key: "open", value: -Number(row.outflow?.open || 0) },
      ];
    }
    return [
      { key: "paid", value: Number(row.net?.paid || 0) },
      { key: "open", value: Number(row.net?.open || 0) },
    ];
  }

  function stackSegments(values) {
    const segments = [];
    let posBase = 0;
    let negBase = 0;
    for (const seg of values) {
      const val = Number(seg.value || 0);
      if (!Number.isFinite(val) || val === 0) continue;
      if (val >= 0) {
        const start = posBase;
        posBase += val;
        segments.push({ ...seg, start, end: posBase });
      } else {
        const start = negBase;
        negBase += val;
        segments.push({ ...seg, start, end: negBase });
      }
    }
    return segments;
  }

  function fmtBarValue(type, value) {
    const numeric = Number(value || 0);
    if (type === "outflow") return fmtEUR(-numeric);
    return fmtEUR(numeric);
  }

  function ariaForBar(type, row, monthKey) {
    const prettyMonth = formatMonthLabel(monthKey);
    const target = type === "inflow" ? row.inflow : type === "outflow" ? row.outflow : row.net;
    if (!target) return prettyMonth;
    const label = type === "inflow" ? "Inflow" : type === "outflow" ? "Outflow" : "Netto";
    return `${prettyMonth}: ${label} gesamt ${fmtBarValue(type, target.total)} – bezahlt ${fmtBarValue(type, target.paid)} – offen ${fmtBarValue(type, target.open)}`;
  }

  function renderSegment(type, seg) {
    const yStart = Y(seg.start);
    const yEnd = Y(seg.end);
    const topPct = Math.min(yStart, yEnd) / 10;
    const heightPct = Math.abs(yStart - yEnd) / 10;
    if (heightPct <= 0.1) return "";
    const classes = `vbar-segment segment-${type}-${seg.key}`;
    return `<div class="${classes}" style="--seg-top:${topPct.toFixed(2)}; --seg-height:${heightPct.toFixed(2)}"></div>`;
  }

  function renderBar(type, row, monthIndex) {
    const stacked = stackSegments(valuesFor(type, row));
    if (!stacked.length) {
      return `<div class="vbar-wrap"><div class="vbar ${type} empty" aria-hidden="true"></div></div>`;
    }
    const aria = escapeHtml(ariaForBar(type, row, months[monthIndex]));
    const segmentsHtml = stacked.map(seg => renderSegment(type, seg)).join("");
    return `<div class="vbar-wrap"><div class="vbar ${type}" data-idx="${monthIndex}" data-type="${type}" tabindex="0" role="img" aria-label="${aria}">${segmentsHtml}</div></div>`;
  }

  function barTipHtml(type, monthKey, row, closingValue, openingValue) {
    const prettyMonth = formatMonthLabel(monthKey);
    const label = type === "inflow" ? "Inflow" : type === "outflow" ? "Outflow" : "Netto";
    const target = type === "inflow" ? row.inflow : type === "outflow" ? row.outflow : row.net;
    if (!target) return `<div class="tip-title">${prettyMonth}</div><div class="tip-row"><span>${label}</span><b>${fmtEUR(0)}</b></div>`;
    const totalDisplay = type === "outflow" ? -Number(target.total || 0) : Number(target.total || 0);
    const paidDisplay = type === "outflow" ? -Number(target.paid || 0) : Number(target.paid || 0);
    const openDisplay = type === "outflow" ? -Number(target.open || 0) : Number(target.open || 0);
    const denom = Math.abs(totalDisplay) || (Math.abs(paidDisplay) + Math.abs(openDisplay)) || 1;
    const paidPct = (Math.abs(paidDisplay) / denom) * 100;
    const openPct = (Math.abs(openDisplay) / denom) * 100;
    const extra =
      type === "net"
        ? `<div class="tip-row"><span>Monatsanfang</span><b>${fmtEUR(openingValue)}</b></div><div class="tip-row"><span>Kontostand Monatsende</span><b>${fmtEUR(closingValue)}</b></div>`
        : "";
    return `
      <div class="tip-title">${prettyMonth} – ${label}</div>
      <div class="tip-row"><span>Gesamt</span><b>${fmtEUR(totalDisplay)}</b></div>
      <div class="tip-row"><span>Bezahlt (${Math.round(paidPct)}%)</span><b>${fmtEUR(paidDisplay)}</b></div>
      <div class="tip-row"><span>Offen (${Math.round(openPct)}%)</span><b>${fmtEUR(openDisplay)}</b></div>
      ${extra}
    `;
  }

  const barGroupsHtml = series
    .map((row, i) => `<div class="vbar-group">${BAR_TYPES.map(type => renderBar(type, row, i)).join("")}</div>`)
    .join("");

  const legendHtml = `
    <div class="chart-legend" role="list">
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-inflow-paid"></span>Inflow bezahlt</span>
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-inflow-open"></span>Inflow offen</span>
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-outflow-paid"></span>Outflow bezahlt</span>
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-outflow-open"></span>Outflow offen</span>
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-net-paid"></span>Netto bezahlt</span>
      <span class="legend-item" role="listitem"><span class="legend-swatch swatch-net-open"></span>Netto offen</span>
    </div>
  `;

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <p class="dashboard-intro">Plane Ein-/Auszahlungen, POs/FOs und Importkosten – behalte deinen Kontostand pro Monat im Blick.</p>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label" title="Kontostand zu Beginn des Startmonats.">Opening heute</div><div class="kpi-value">${fmtEUR(opening)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Durchschnittliche Amazon-Auszahlungsquote über die sichtbaren Monate.">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Erster Monat, in dem der geplante Saldo unter den kritischen Puffer fällt.">Erster negativer Monat</div><div class="kpi-value">${kpis.firstNegativeMonth || "—"}</div></div>
      </div>

      <div class="vchart" style="--cols:${months.length}; --rows:${yTicks.length}; --zero:${zeroPct.toFixed(2)}">
        <div class="vchart-grid">${yTicks.map(() => "<div class=\"yline\"></div>").join("")}</div>
        <div class="vchart-y">${yTicks.map(v => `<div class="ytick">${fmtTick(v)}</div>`).join("")}</div>
        <div class="vchart-zero"></div>
        <div class="vchart-bars">
          ${barGroupsHtml}
        </div>
        <div class="vchart-lines" aria-hidden="true">
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <polyline class="line" points="${points}"></polyline>
            ${dots}
          </svg>
        </div>
        <div class="vchart-closing-labels" aria-hidden="true">${closingLabels}</div>
        <div class="vchart-x">${months.map(m => `<div class="xlabel">${m}</div>`).join("")}</div>
      </div>
      ${legendHtml}
      <div class="net-strip-label">Netto je Monat</div>
      <div class="net-strip" style="--cols:${months.length};">${netStrip}</div>
    </section>
    <section class="card pl-container" id="pl-root"></section>
  `;

  const tip = ensureGlobalTip();

  function showBarTip(el) {
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    const type = el.getAttribute("data-type");
    if (!Number.isFinite(i) || !type) return;
    const row = series[i];
    const eom = closing[i];
    const mos = monthOpening[i];
    tip.innerHTML = barTipHtml(type, months[i], row, eom, mos);
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
  function hideTip(force = false) {
    if (!force) {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains("vbar")) {
        return;
      }
    }
    tip.hidden = true;
  }

  const barsWrap = root.querySelector(".vchart-bars");
  if (barsWrap) {
    barsWrap.addEventListener("pointerenter", ev => {
      const el = ev.target.closest(".vbar");
      if (el) showBarTip(el);
    }, true);
    barsWrap.addEventListener("pointermove", ev => {
      const el = ev.target.closest(".vbar");
      if (el) showBarTip(el);
    }, true);
    barsWrap.addEventListener("pointerleave", () => hideTip(), true);
  }

  const barNodes = root.querySelectorAll(".vbar[data-type]");
  barNodes.forEach(node => {
    node.addEventListener("focus", () => showBarTip(node));
    node.addEventListener("blur", () => hideTip(true));
    node.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        showBarTip(node);
        ev.preventDefault();
      }
    });
  });

  const plRoot = root.querySelector("#pl-root");
  if (plRoot) updatePLSection(plRoot);

  if (!stateListenerOff) {
    stateListenerOff = addStateListener(() => {
      if (location.hash.replace("#", "") === "dashboard" && dashboardRoot) render(dashboardRoot);
    });
  }
}

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

function fmtTick(v) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

export default { render };
