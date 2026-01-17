// UI: Dashboard – Monatsübersicht & detaillierte Monats-P/L-Analyse
import { loadState, addStateListener, setEventManualPaid, setEventsManualPaid, setAutoManualCheck } from "../data/storageLocal.js";
import { computeOutflowStack, computeSeries, fmtEUR } from "../domain/cashflow.js";
import { computeNiceTickStep, formatEUR, formatSignedEUR } from "./chartUtils.js";

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

const monthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});
const monthShortFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "short",
  year: "numeric",
});
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

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
  { key: "next3", label: "Nächste 3" },
  { key: "next6", label: "Nächste 6" },
  { key: "next12", label: "Nächste 12" },
];

const plState = {
  selectedMonths: null,
  allowEmptySelection: false,
  mode: "planned",
  showScenario: false,
  search: "",
  categories: new Set(),
  collapsedMonths: new Set(),
  autoManualCheck: false,
  defaultCollapseApplied: false,
  showAdvancedFilters: false,
  legend: {
    inflow: true,
    fixedCosts: true,
    poPaid: true,
    poOpen: true,
    otherExpenses: true,
    foPlanned: true,
  },
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

function formatMonthShortLabel(yyyymm) {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, 1);
  return monthShortFormatter.format(date);
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function ensureSelection(months) {
  const available = Array.isArray(months) ? months : [];
  pruneCollapsed(available);
  if (plState.allowEmptySelection && (!plState.selectedMonths || plState.selectedMonths.length === 0)) {
    plState.selectedMonths = [];
    return;
  }
  const previous = Array.isArray(plState.selectedMonths)
    ? plState.selectedMonths.filter(m => available.includes(m))
    : [];
  if (previous.length || plState.allowEmptySelection) {
    plState.selectedMonths = previous;
    return;
  }
  plState.allowEmptySelection = false;
  plState.selectedMonths = available.slice();
}

function fmtSigned(value) {
  const num = Number(value || 0);
  return fmtEUR2(num);
}

function fmtDelta(value, { invert = false, isPercent = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const val = invert ? -Number(value) : Number(value);
  if (isPercent) {
    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  }
  return `${val >= 0 ? "+" : ""}${fmtEUR(val)}`;
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

function currentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function sliceUpcomingMonths(months, count) {
  if (!Array.isArray(months) || !months.length) return [];
  const todayKey = currentMonthKey();
  const startIdx = months.findIndex(month => month >= todayKey);
  if (startIdx === -1) {
    const fallback = months.slice(-count);
    return fallback.length ? fallback : months.slice();
  }
  const upcoming = months.slice(startIdx, startIdx + count);
  if (upcoming.length === count) return upcoming;
  const missing = count - upcoming.length;
  const prior = months.slice(Math.max(0, startIdx - missing), startIdx);
  const combined = prior.concat(upcoming).slice(-count);
  if (combined.length) return combined;
  return months.slice();
}

function applyControlSelection(control, months) {
  if (!Array.isArray(months)) months = [];
  switch (control) {
    case "all":
      plState.allowEmptySelection = false;
      return months.slice();
    case "none":
      plState.allowEmptySelection = true;
      return [];
    case "next3":
      plState.allowEmptySelection = false;
      return sliceUpcomingMonths(months, 3);
    case "next6":
      plState.allowEmptySelection = false;
      return sliceUpcomingMonths(months, 6);
    case "next12":
      plState.allowEmptySelection = false;
      return sliceUpcomingMonths(months, 12);
    default:
      return plState.selectedMonths || [];
  }
}

function getCollapsedSet() {
  if (!plState.collapsedMonths) plState.collapsedMonths = new Set();
  return plState.collapsedMonths;
}

function pruneCollapsed(months) {
  const set = getCollapsedSet();
  if (!Array.isArray(months) || !months.length) {
    set.clear();
    return;
  }
  const allowed = new Set(months);
  for (const value of Array.from(set)) {
    if (!allowed.has(value)) set.delete(value);
  }
}

function toggleMonthCollapse(month) {
  if (!month) return;
  const set = getCollapsedSet();
  if (set.has(month)) set.delete(month);
  else set.add(month);
}

function focusMonthCard(month) {
  if (!month) return;
  const available = Array.isArray(plData?.months) ? plData.months : [];
  if (!available.includes(month)) return;
  const selection = new Set(plState.selectedMonths || []);
  selection.add(month);
  plState.selectedMonths = available.filter(m => selection.has(m));
  plState.allowEmptySelection = (plState.selectedMonths || []).length === 0;
  getCollapsedSet().delete(month);
}

function collapseAllMonths(months) {
  const set = getCollapsedSet();
  set.clear();
  if (!Array.isArray(months)) return;
  for (const month of months) {
    if (month) set.add(month);
  }
}

function expandAllMonths() {
  getCollapsedSet().clear();
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

function collectMonthEventIds(month, predicate) {
  const ids = [];
  if (!month) return ids;
  plEntryLookup.forEach(record => {
    if (!record || record.month !== month) return;
    if (typeof predicate === "function" && !predicate(record)) return;
    if (record.eventId) ids.push(record.eventId);
  });
  return ids;
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

  const sections = [];
  let rowIndex = 0;
  let paidSum = 0;
  let openSum = 0;

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
        const eventId = entry.statusId || entry.id || entryKey;
        const ariaLabel = entry.autoApplied ? "Automatisch bezahlt" : "Bezahlt";
        const tooltip = entry.autoTooltip ? ` title="${escapeHtml(entry.autoTooltip)}"` : "";
        const autoIcon = entry.autoTooltip
          ? `<span class="pl-auto-icon" aria-hidden="true">${entry.autoApplied ? "⏱" : "ⓘ"}</span>`
          : "";
        const statusCell = `
          <td class="pl-row-status" data-label="Bezahlt">
            <label class="pl-row-checkbox"${tooltip}>
              <input type="checkbox" data-event-id="${escapeHtml(eventId)}" ${entry.paid ? "checked" : ""} aria-label="${escapeHtml(ariaLabel)}" />
              ${autoIcon}
            </label>
          </td>`;
        const signedValue = baseline;
        if (entry.paid) paidSum += signedValue; else openSum += signedValue;
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
          eventId,
          autoTooltip: entry.autoTooltip,
          autoApplied: entry.autoApplied,
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
        return `
          <tr class="pl-row" data-entry-id="${escapeHtml(entryKey)}" tabindex="0">
            <td class="pl-row-cat" data-label="Kategorie">${escapeHtml(groupKey)}</td>
            <td class="pl-row-label" data-label="Label">
              <span class="pl-direction" aria-hidden="true">${iconForDirection(entry.direction)}</span>
              <span class="pl-label-text">${escapeHtml(entry.label || "")}</span>
              <span class="badge ${entry.paid ? "badge-paid" : "badge-plan"}">${entry.paid ? "Bezahlt" : "Geplant"}</span>
            </td>
            <td class="pl-row-date" data-label="Datum">${escapeHtml(formatDateLabel(entry.date))}</td>
            ${statusCell}
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
                <th scope="col">Bezahlt</th>
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
  const collapsedSet = getCollapsedSet();
  const collapsed = collapsedSet.has(row.month);
  const bodyId = `pl-body-${row.month.replace(/[^0-9A-Za-z]/g, "")}`;

  return `
    <article class="pl-card${collapsed ? " is-collapsed" : ""}" data-month="${escapeHtml(row.month)}">
      <header class="pl-card-header">
        <button type="button" class="pl-card-toggle" data-month="${escapeHtml(row.month)}" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="${escapeHtml(bodyId)}">
          <div class="pl-card-main">
            <div class="pl-card-info">
              <h3>${escapeHtml(formatMonthLabel(row.month))}</h3>
              <p class="pl-card-sub">Saldo Monatsende: ${fmtSigned(closing)}</p>
            </div>
            <div class="pl-card-metrics">
              <div class="pl-metric">
                <span class="pl-metric-label">P/L gesamt</span>
                <span class="pl-metric-value">${fmtSigned(cardNet)}</span>
              </div>
              ${plState.showScenario ? `
                <div class="pl-metric">
                  <span class="pl-metric-label">Δ Szenario</span>
                  <span class="pl-metric-value">${fmtSigned(scenarioDelta)}</span>
                </div>
              ` : ""}
              <div class="pl-metric">
                <span class="pl-metric-label">Offen</span>
                <span class="pl-metric-value">${fmtSigned(openSum)}</span>
              </div>
              <div class="pl-metric">
                <span class="pl-metric-label">Bezahlt</span>
                <span class="pl-metric-value">${fmtSigned(paidSum)}</span>
              </div>
            </div>
          </div>
          <span class="pl-card-chevron" aria-hidden="true">${collapsed ? "▶" : "▼"}</span>
        </button>
      </header>
      <div class="pl-card-body" id="${escapeHtml(bodyId)}" ${collapsed ? "hidden" : ""}>
        ${filtered.length ? `
          <div class="pl-card-actions">
            <button type="button" class="chip secondary" data-action="confirm-month" data-month="${escapeHtml(row.month)}">Alle offenen Zahlungen dieses Monats bestätigen</button>
          </div>
        ` : ""}
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
      const label = formatMonthShortLabel(month);
      return `<button type="button" class="chip ${active ? "active" : ""}" data-month="${escapeHtml(month)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
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
  const panelOpen = plState.showAdvancedFilters;
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
        <div class="pl-collapse-controls" role="group" aria-label="Monatsdetails">
          <button type="button" class="chip tertiary" data-collapse="expand">Alle öffnen</button>
          <button type="button" class="chip tertiary" data-collapse="collapse">Alle schließen</button>
        </div>
      </div>
      <div class="pl-month-chips" role="listbox" aria-label="Monate wählen">
        ${chips}
      </div>
    </div>
    <div class="pl-toolbar">
      <div class="pl-modes" role="group" aria-label="Modus">
        ${MODE_OPTIONS.map(option => `<button type="button" class="pl-mode ${plState.mode === option.key ? "active" : ""}" data-mode="${option.key}">${option.label}</button>`).join("")}
      </div>
      <button type="button" class="pl-filter-toggle" data-filter-toggle aria-expanded="${panelOpen}">Filter</button>
      <button type="button" class="pl-export" id="pl-export">Export (CSV)</button>
    </div>
    <section class="pl-filter-panel${panelOpen ? " open" : ""}" data-filter-panel${panelOpen ? "" : " hidden"}>
      <header class="pl-filter-head">
        <h3>Filter &amp; Optionen</h3>
        <button type="button" class="pl-filter-close" data-filter-toggle aria-label="Filter schließen">×</button>
      </header>
      <div class="pl-filter-grid">
        <label class="pl-search">
          <span class="pl-search-label">Suche</span>
          <input type="search" id="pl-search" placeholder="Label durchsuchen" value="${escapeHtml(plState.search)}" />
        </label>
        <label class="pl-scenario">
          <input type="checkbox" id="pl-scenario-toggle" ${plState.showScenario ? "checked" : ""} />
          <span>Δ-Szenario anzeigen</span>
        </label>
        <label class="pl-auto-manual">
          <input type="checkbox" id="pl-auto-manual" ${plState.autoManualCheck ? "checked" : ""} />
          <span>Automatische Zahlungen manuell prüfen</span>
        </label>
        <div class="pl-category-filter" aria-label="Kategorie-Filter">
          ${buildCategoryFilters()}
        </div>
      </div>
    </section>
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
      plState.allowEmptySelection = ordered.length === 0;
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

  plRoot.querySelectorAll("[data-filter-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      plState.showAdvancedFilters = !plState.showAdvancedFilters;
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

  const autoManualToggle = plRoot.querySelector("#pl-auto-manual");
  if (autoManualToggle) {
    autoManualToggle.addEventListener("change", () => {
      plState.autoManualCheck = autoManualToggle.checked;
      setAutoManualCheck(autoManualToggle.checked);
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

  plRoot.querySelectorAll(".pl-collapse-controls [data-collapse]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-collapse");
      const targetMonths = plState.selectedMonths || [];
      if (action === "collapse") collapseAllMonths(targetMonths);
      else expandAllMonths();
      updatePLSection(plRoot);
    });
  });

  const cards = plRoot.querySelector(".pl-cards");
  if (cards) {
    cards.addEventListener("click", ev => {
      const confirmBtn = ev.target.closest("[data-action='confirm-month']");
      if (confirmBtn) {
        ev.preventDefault();
        const month = confirmBtn.getAttribute("data-month");
        if (!month) return;
        if (!confirm("Möchten Sie wirklich alle offenen Zahlungen für diesen Monat als bezahlt markieren?")) return;
        const ids = collectMonthEventIds(month, record => record && record.entry && !record.entry.paid && !record.entry.auto);
        if (ids.length) setEventsManualPaid(ids, true);
        return;
      }
      const toggle = ev.target.closest(".pl-card-toggle");
      if (toggle) {
        ev.preventDefault();
        const month = toggle.getAttribute("data-month");
        toggleMonthCollapse(month);
        updatePLSection(plRoot);
        return;
      }
      if (ev.target.closest(".pl-row-checkbox")) return;
      const row = ev.target.closest(".pl-row");
      if (!row) return;
      const id = row.getAttribute("data-entry-id");
      showDrawer(id, plRoot);
    });
    cards.addEventListener("change", ev => {
      const checkbox = ev.target.closest(".pl-row-checkbox input[type='checkbox']");
      if (!checkbox) return;
      const row = checkbox.closest(".pl-row");
      if (!row) return;
      const entryId = row.getAttribute("data-entry-id");
      const record = plEntryLookup.get(entryId);
      if (!record || !record.eventId) return;
      setEventManualPaid(record.eventId, checkbox.checked);
    });
    cards.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const toggle = ev.target.closest(".pl-card-toggle");
      if (toggle) {
        ev.preventDefault();
        const month = toggle.getAttribute("data-month");
        toggleMonthCollapse(month);
        updatePLSection(plRoot);
        return;
      }
      if (ev.target.closest("[data-action='confirm-month']")) return;
      if (ev.target.closest(".pl-row-checkbox")) return;
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
  if (entry.autoTooltip) rows.push({ label: "Hinweis", value: entry.autoTooltip });
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
  try {
  dashboardRoot = root;
  const state = loadState();
  plState.autoManualCheck = state?.status?.autoManualCheck === true;
  const computed = computeSeries(state);
  const kpis = computed.kpis || {};
  const actuals = computed.actualComparisons || [];
  const actualKpis = kpis.actuals || {};
  const zipped = (computed.months || []).map((month, idx) => ({
    month,
    series: computed.series ? computed.series[idx] : null,
    breakdown: computed.breakdown ? computed.breakdown[idx] : null,
  }));
  zipped.sort((a, b) => a.month.localeCompare(b.month));
  const months = zipped.map(item => item.month);
  const series = zipped.map(item => {
    const base = item.series || {};
    return {
      ...base,
      outflowStack: computeOutflowStack(base.entries || []),
    };
  });
  const breakdown = zipped.map(item => item.breakdown || {});
  plData = { months, breakdown };
  ensureSelection(months);
  if (!plState.defaultCollapseApplied) {
    const collapsedSet = getCollapsedSet();
    collapsedSet.clear();
    const keepOpen = months.slice(-3);
    const keepSet = new Set(keepOpen);
    for (const month of months) {
      if (!keepSet.has(month)) collapsedSet.add(month);
    }
    plState.defaultCollapseApplied = true;
  }

  const opening = Number(kpis.opening || 0);
  const closing = breakdown.map(b => Number(b?.closing || 0));
  const firstNegativeIndex = closing.findIndex(value => value < 0);
  const actualClosingMap = new Map(actuals.map(row => [row.month, row.actualClosing]));
  const actualClosing = months.map(month => actualClosingMap.get(month));
  const hasActualClosing = actualClosing.some(value => Number.isFinite(value));

  const firstNegativeDisplay =
    firstNegativeIndex >= 0 ? formatMonthLabel(months[firstNegativeIndex]) : "Kein negativer Monat";

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <p class="dashboard-intro">Plane Ein-/Auszahlungen, POs/FOs und Importkosten – behalte deinen Kontostand pro Monat im Blick.</p>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label" title="Kontostand zu Beginn des Startmonats.">Opening heute</div><div class="kpi-value">${fmtEUR(opening)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Durchschnittliche Amazon-Auszahlungsquote über die sichtbaren Monate.">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Erster Monat, in dem der geplante Saldo unter den kritischen Puffer fällt.">Erster negativer Monat</div><div class="kpi-value">${firstNegativeDisplay}</div></div>
      </div>
      <div class="grid three">
        <div class="kpi">
          <div class="kpi-label" title="Ist-Kontostand zum Monatsende des letzten abgeschlossenen Monats.">Kontostand (Ist, letzter Monat)</div>
          <div class="kpi-value">${fmtEUR(actualKpis.lastClosing || 0)}</div>
          <div class="kpi-sub">${actualKpis.lastMonth ? formatMonthShortLabel(actualKpis.lastMonth) : "—"} · ${fmtDelta(actualKpis.closingDelta || 0)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label" title="Differenz zwischen geplantem und tatsächlichem Umsatz (Durchschnitt über alle Ist-Monate).">Umsatz Ist vs Plan (Ø)</div>
          <div class="kpi-value">${fmtDelta(actualKpis.avgRevenueDeltaPct, { isPercent: true })}</div>
          <div class="kpi-sub">${actualKpis.lastMonth ? `Letzter Monat: ${fmtDelta(actualKpis.revenueDeltaPct, { isPercent: true })}` : "—"}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label" title="Differenz zwischen geplanter und tatsächlicher Amazon-Auszahlung (Durchschnitt über alle Ist-Monate).">Amazon Auszahlung Ist vs Plan (Ø)</div>
          <div class="kpi-value">${fmtDelta(actualKpis.avgPayoutDeltaPct, { isPercent: true })}</div>
          <div class="kpi-sub">${actualKpis.lastMonth ? `Letzter Monat: ${fmtDelta(actualKpis.payoutDeltaPct, { isPercent: true })}` : "—"}</div>
        </div>
      </div>
      <div class="chart-stack">
        <div class="chart-block">
          <div class="chart-header">
            <h3>Cashflow pro Monat (Plan)</h3>
            <p class="muted">Einzahlungen positiv, Ausgaben negativ (gestapelt).</p>
          </div>
          <div class="chart-shell" id="cashflow-chart"></div>
        </div>
        <div class="chart-block">
          <div class="chart-header">
            <h3>Kontostand (Plan${hasActualClosing ? "/Ist" : ""})</h3>
            <p class="muted">Plan als Linie, Ist als gestrichelte Linie falls vorhanden.</p>
          </div>
          <div class="chart-shell" id="balance-chart"></div>
        </div>
      </div>
    </section>
    <section class="card">
      <h3>Soll-Ist-Abgleich (Ist-Monate)</h3>
      ${actuals.length ? `
        <table class="table">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Umsatz Plan</th>
              <th>Umsatz Ist</th>
              <th>Δ Umsatz</th>
              <th>Payout Plan</th>
              <th>Payout Ist</th>
              <th>Δ Payout</th>
              <th>Kontostand Plan</th>
              <th>Kontostand Ist</th>
              <th>Δ Kontostand</th>
            </tr>
          </thead>
          <tbody>
            ${actuals.map(row => `
              <tr>
                <td>${formatMonthShortLabel(row.month)}</td>
                <td>${fmtEUR(row.plannedRevenue || 0)}</td>
                <td>${fmtEUR(row.actualRevenue || 0)}</td>
                <td class="${(row.revenueDelta || 0) < 0 ? "neg" : "pos"}">${fmtDelta(row.revenueDelta)}</td>
                <td>${fmtEUR(row.plannedPayout || 0)}</td>
                <td>${fmtEUR(row.actualPayout || 0)}</td>
                <td class="${(row.payoutDelta || 0) < 0 ? "neg" : "pos"}">${fmtDelta(row.payoutDelta)}</td>
                <td>${row.plannedClosing != null ? fmtEUR(row.plannedClosing) : "—"}</td>
                <td>${row.actualClosing != null ? fmtEUR(row.actualClosing) : "—"}</td>
                <td class="${(row.closingDelta || 0) < 0 ? "neg" : "pos"}">${row.closingDelta != null ? fmtDelta(row.closingDelta) : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<p class="muted">Trage Ist-Werte im Tab <strong>Eingaben</strong> ein, um Plan/Ist-KPIs zu sehen.</p>`}
      <p class="muted">KPIs für den CFO: Tracke Abweichungen je Monat, erkenne Trends (Ø Delta) und nutze den Ist-Kontostand, um Puffer und Zahlungspläne anzupassen.</p>
    </section>
    <section class="card pl-container" id="pl-root"></section>
  `;

  const plRoot = root.querySelector("#pl-root");
  const cashflowChart = root.querySelector("#cashflow-chart");
  renderCashflowBarChart(cashflowChart, {
    months,
    series,
    legend: plState.legend,
    onLegendToggle: key => {
      const current = plState.legend[key] !== false;
      plState.legend[key] = current ? false : true;
      render(root);
    },
    onMonthSelect: monthKey => {
      focusMonthCard(monthKey);
      if (plRoot) updatePLSection(plRoot);
    },
  });

  const balanceChart = root.querySelector("#balance-chart");
  renderBalanceLineChart(balanceChart, {
    months,
    planValues: closing,
    actualValues: actualClosing,
    onMonthSelect: monthKey => {
      focusMonthCard(monthKey);
      if (plRoot) updatePLSection(plRoot);
    },
  });

  if (plRoot) updatePLSection(plRoot);

  if (!stateListenerOff) {
    stateListenerOff = addStateListener(() => {
      if (location.hash.replace("#", "") === "dashboard" && dashboardRoot) render(dashboardRoot);
    });
  }
  } catch (err) {
    console.error(err);
    const message = err?.message || String(err);
    root.innerHTML = `
      <section class="card">
        <h2>Dashboard</h2>
        <p class="muted">Beim Rendern ist ein Fehler aufgetreten.</p>
        <pre class="mono" style="white-space:pre-wrap">${escapeHtml(message)}</pre>
      </section>
    `;
  }
}

function getChartLayout(months) {
  const monthsCount = months.length || 0;
  const groupWidth = 56;
  const groupGap = 28;
  const innerGap = 6;
  const chartWidth = monthsCount
    ? groupWidth * monthsCount + groupGap * Math.max(0, monthsCount - 1)
    : groupWidth * 12 + groupGap * 11;
  const centers = months.map((_, idx) => idx * (groupWidth + groupGap) + groupWidth / 2);
  return { groupWidth, groupGap, innerGap, chartWidth, centers };
}

function buildTickScale({ min, max, symmetric = false }) {
  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  const step = computeNiceTickStep(maxAbs || 1);
  let top = 0;
  let bottom = 0;
  if (symmetric) {
    top = Math.ceil(maxAbs / step) * step || step;
    bottom = -top;
  } else {
    top = Math.ceil(max / step) * step;
    bottom = Math.floor(min / step) * step;
    if (top === bottom) {
      top += step;
      bottom -= step;
    }
  }
  const ticks = [];
  for (let v = top; v >= bottom - 1e-6; v -= step) ticks.push(v);
  return { top, bottom, step, ticks };
}

function buildXAxisLabels(months, groupWidth) {
  const viewport = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
  const maxXTicks = viewport && viewport < 900 ? 6 : 8;
  const step = Math.max(1, Math.ceil((months.length || 1) / maxXTicks));
  return months
    .map((monthKey, idx) => {
      const label = idx % step === 0 ? formatMonthShortLabel(monthKey) : "";
      return `<div class="xlabel" style="width:${groupWidth}px">${label ? escapeHtml(label) : "&nbsp;"}</div>`;
    })
    .join("");
}

function positionTip(tip, rect) {
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const width = tip.offsetWidth || 220;
  const height = tip.offsetHeight || 120;
  let left = rect.left + rect.width + 12;
  if (left + width + 8 > vw) left = Math.max(8, rect.left - width - 12);
  let topPx = rect.top - 8;
  if (topPx + height + 8 > vh) topPx = Math.max(8, vh - height - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${topPx}px`;
}

function renderCashflowBarChart(container, { months, series, legend, onLegendToggle, onMonthSelect }) {
  if (!container) return;
  const hasFo = series.some(row => (row?.outflowStack?.foPlanned || 0) > 0);
  const { groupWidth, groupGap, innerGap, chartWidth } = getChartLayout(months);
  const tip = ensureGlobalTip();

  function getOutflowSegments(row) {
    const stack = row?.outflowStack || computeOutflowStack(row?.entries || []);
    const segments = [];
    if (legend.poPaid !== false && stack.poPaid) {
      segments.push({ key: "poPaid", label: "PO bezahlt", value: -stack.poPaid, swatch: "swatch-po-paid" });
    }
    if (legend.poOpen !== false && stack.poOpen) {
      segments.push({ key: "poOpen", label: "PO offen", value: -stack.poOpen, swatch: "swatch-po-open" });
    }
    if (legend.otherExpenses !== false && stack.otherExpenses) {
      segments.push({ key: "otherExpenses", label: "Weitere Ausgaben", value: -stack.otherExpenses, swatch: "swatch-other-expenses" });
    }
    if (hasFo && legend.foPlanned !== false && stack.foPlanned) {
      segments.push({ key: "foPlanned", label: "FO geplant", value: -stack.foPlanned, swatch: "swatch-fo" });
    }
    if (legend.fixedCosts !== false && stack.fixedCosts) {
      segments.push({ key: "fixedCosts", label: "Fixkosten", value: -stack.fixedCosts, swatch: "swatch-fixcost" });
    }
    return segments;
  }

  let maxAbs = 0;
  const monthOutflows = series.map(row => {
    const segments = getOutflowSegments(row);
    const outflowTotal = segments.reduce((sum, seg) => sum + Math.abs(seg.value), 0);
    maxAbs = Math.max(maxAbs, outflowTotal);
    return { segments, outflowTotal };
  });
  const inflowTotals = series.map(row => {
    const val = legend.inflow === false ? 0 : Number(row?.inflow?.total || 0);
    maxAbs = Math.max(maxAbs, val);
    return val;
  });

  const { top, bottom, ticks } = buildTickScale({ min: -maxAbs, max: maxAbs, symmetric: true });
  const span = top - bottom || 1;
  const valueToY = value => ((top - value) / span) * 1000;
  const zeroPct = Math.max(0, Math.min(100, valueToY(0) / 10));

  function stackSegments(values) {
    const segments = [];
    let posBase = 0;
    let negBase = 0;
    values.forEach(seg => {
      const val = Number(seg.value || 0);
      if (!Number.isFinite(val) || val === 0) return;
      if (val >= 0) {
        const start = posBase;
        posBase += val;
        segments.push({ ...seg, start, end: posBase });
      } else {
        const start = negBase;
        negBase += val;
        segments.push({ ...seg, start, end: negBase });
      }
    });
    return segments;
  }

  function renderSegment(type, seg) {
    const yStart = valueToY(seg.start);
    const yEnd = valueToY(seg.end);
    const topPct = Math.min(yStart, yEnd) / 10;
    const heightPct = Math.abs(yStart - yEnd) / 10;
    if (heightPct <= 0.05) return "";
    const classes = `vbar-segment segment-${type}-${seg.key}`;
    return `<div class="${classes}" style="--seg-top:${topPct.toFixed(2)}; --seg-height:${heightPct.toFixed(2)}"></div>`;
  }

  function renderBar(type, monthIndex) {
    if (type === "inflow") {
      const value = inflowTotals[monthIndex];
      if (legend.inflow === false || !value) {
        return `<div class="vbar-wrap type-${type} empty" aria-hidden="true"></div>`;
      }
      const segments = stackSegments([{ key: "total", value }]);
      const aria = `${formatMonthLabel(months[monthIndex])}: Payout ${formatSignedEUR(value)}`;
      return `
        <div class="vbar-wrap type-${type}">
          <div class="vbar ${type}" data-idx="${monthIndex}" data-type="${type}" tabindex="0" role="img" aria-label="${escapeHtml(aria)}">
            ${segments.map(seg => renderSegment(type, seg)).join("")}
          </div>
        </div>
      `;
    }
    const outflowInfo = monthOutflows[monthIndex];
    if (!outflowInfo || !outflowInfo.segments.length) {
      return `<div class="vbar-wrap type-${type} empty" aria-hidden="true"></div>`;
    }
    const aria = `${formatMonthLabel(months[monthIndex])}: Ausgaben ${formatSignedEUR(-outflowInfo.outflowTotal)}`;
    const segments = stackSegments(outflowInfo.segments);
    return `
      <div class="vbar-wrap type-${type}">
        <div class="vbar ${type}" data-idx="${monthIndex}" data-type="${type}" tabindex="0" role="img" aria-label="${escapeHtml(aria)}">
          ${segments.map(seg => renderSegment(type, seg)).join("")}
        </div>
      </div>
    `;
  }

  const barGroupsHtml = months
    .map((_, i) => {
      const inflowBar = renderBar("inflow", i);
      const outflowBar = renderBar("outflow", i);
      return `<div class="vbar-group" style="width:${groupWidth}px; --inner-gap:${innerGap}px">${inflowBar}${outflowBar}</div>`;
    })
    .join("");

  const xLabelsHtml = buildXAxisLabels(months, groupWidth);

  const legendRows = [
    { key: "inflow", label: "Payout (Plan)", swatch: "swatch-inflow" },
    { key: "poPaid", label: "PO bezahlt", swatch: "swatch-po-paid" },
    { key: "poOpen", label: "PO offen", swatch: "swatch-po-open" },
    { key: "otherExpenses", label: "Weitere Ausgaben", swatch: "swatch-other-expenses" },
    ...(hasFo ? [{ key: "foPlanned", label: "FO geplant", swatch: "swatch-fo" }] : []),
    { key: "fixedCosts", label: "Fixkosten", swatch: "swatch-fixcost" },
  ];

  const legendHtml = `
    <div class="chart-legend" role="list">
      ${legendRows
        .map(row => `
          <button type="button" class="legend-button ${legend[row.key] === false ? "is-off" : ""}" data-legend="${row.key}" aria-pressed="${legend[row.key] !== false}">
            <span class="legend-swatch ${row.swatch}" aria-hidden="true"></span>
            <span class="legend-label">${row.label}</span>
          </button>
        `)
        .join("")}
    </div>
  `;

  container.innerHTML = `
    <div class="vchart cashflow-chart" style="--rows:${ticks.length}; --zero:${zeroPct.toFixed(2)}">
      <div class="vchart-y">${ticks.map(v => `<div class="ytick">${formatEUR(v)}</div>`).join("")}</div>
      <div class="vchart-stage" style="--chart-width:${chartWidth}px; --group-gap:${groupGap}px;">
        <div class="vchart-stage-inner">
          <div class="vchart-grid">${ticks.map(() => "<div class=\\"yline\\"></div>").join("")}</div>
          <div class="vchart-zero"></div>
          <div class="vchart-bars">${barGroupsHtml}</div>
        </div>
      </div>
      <div class="vchart-x">${xLabelsHtml}</div>
    </div>
    ${legendHtml}
  `;

  container.querySelectorAll(".legend-button").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-legend");
      if (!key || typeof onLegendToggle !== "function") return;
      onLegendToggle(key);
    });
  });

  function buildTooltip(index) {
    const monthKey = months[index];
    const rows = [];
    const inflowValue = inflowTotals[index] || 0;
    if (legend.inflow !== false && inflowValue) {
      rows.push({ label: "Payout (Plan)", value: inflowValue, swatch: "swatch-inflow" });
    }
    const outflowSegments = monthOutflows[index]?.segments || [];
    outflowSegments.forEach(seg => {
      rows.push({ label: seg.label, value: seg.value, swatch: seg.swatch });
    });
    const netValue = rows.reduce((sum, entry) => sum + entry.value, 0);
    const rowsHtml = rows.length
      ? rows
          .map(entry => `
            <div class="tip-row">
              <span><span class="tip-swatch ${entry.swatch}" aria-hidden="true"></span>${escapeHtml(entry.label)}</span>
              <b>${formatSignedEUR(entry.value)}</b>
            </div>
          `)
          .join("")
      : `<div class="tip-row"><span>Keine Daten</span><b>—</b></div>`;
    return `
      <div class="tip-title">${escapeHtml(formatMonthLabel(monthKey))}</div>
      ${rowsHtml}
      <div class="tip-divider"></div>
      <div class="tip-row total"><span>Netto</span><b>${formatSignedEUR(netValue)}</b></div>
    `;
  }

  function showTip(el) {
    const index = Number(el.getAttribute("data-idx"));
    if (!Number.isFinite(index)) return;
    tip.innerHTML = buildTooltip(index);
    tip.hidden = false;
    positionTip(tip, el.getBoundingClientRect());
  }

  function hideTip(force = false) {
    if (!force) {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains("vbar")) return;
    }
    tip.hidden = true;
  }

  const barsWrap = container.querySelector(".vchart-bars");
  if (barsWrap) {
    barsWrap.addEventListener("pointerenter", ev => {
      const el = ev.target.closest(".vbar");
      if (el) showTip(el);
    }, true);
    barsWrap.addEventListener("pointermove", ev => {
      const el = ev.target.closest(".vbar");
      if (el) showTip(el);
    }, true);
    barsWrap.addEventListener("pointerleave", () => hideTip(), true);
    barsWrap.addEventListener("click", ev => {
      const el = ev.target.closest(".vbar");
      if (!el) return;
      const idx = Number(el.getAttribute("data-idx"));
      const monthKey = months[idx];
      if (monthKey && typeof onMonthSelect === "function") {
        hideTip(true);
        onMonthSelect(monthKey);
      }
    });
  }

  container.querySelectorAll(".vbar").forEach(node => {
    node.addEventListener("focus", () => showTip(node));
    node.addEventListener("blur", () => hideTip(true));
    node.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const idx = Number(node.getAttribute("data-idx"));
      const monthKey = months[idx];
      if (monthKey && typeof onMonthSelect === "function") {
        hideTip(true);
        onMonthSelect(monthKey);
      }
      ev.preventDefault();
    });
  });
}

function renderBalanceLineChart(container, { months, planValues, actualValues, onMonthSelect }) {
  if (!container) return;
  const { groupWidth, groupGap, chartWidth, centers } = getChartLayout(months);
  const tip = ensureGlobalTip();
  const allValues = [];
  planValues.forEach(val => {
    if (Number.isFinite(val)) allValues.push(val);
  });
  actualValues.forEach(val => {
    if (Number.isFinite(val)) allValues.push(val);
  });
  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const maxVal = allValues.length ? Math.max(...allValues) : 0;
  const { top, bottom, ticks } = buildTickScale({ min: minVal, max: maxVal });
  const span = top - bottom || 1;
  const valueToY = value => ((top - value) / span) * 1000;
  const zeroPct = Math.max(0, Math.min(100, valueToY(0) / 10));

  function buildSegments(values) {
    const segments = [];
    let current = [];
    values.forEach((value, idx) => {
      if (!Number.isFinite(value)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push(`${(centers[idx] || 0)},${valueToY(value)}`);
    });
    if (current.length) segments.push(current);
    return segments;
  }

  const planSegments = buildSegments(planValues);
  const actualSegments = buildSegments(actualValues);
  const xLabelsHtml = buildXAxisLabels(months, groupWidth);

  const dots = months
    .map((monthKey, idx) => {
      const planValue = planValues[idx];
      const actualValue = actualValues[idx];
      const dotsHtml = [];
      if (Number.isFinite(planValue)) {
        dotsHtml.push(`
          <button type="button" class="line-dot plan" data-idx="${idx}" style="left:${centers[idx]}px; top:${(valueToY(planValue) / 10).toFixed(2)}%;" aria-label="${escapeHtml(formatMonthLabel(monthKey))}">
            <span class="sr-only">${escapeHtml(formatMonthLabel(monthKey))} Plan ${formatSignedEUR(planValue)}</span>
          </button>
        `);
      }
      if (Number.isFinite(actualValue)) {
        dotsHtml.push(`
          <button type="button" class="line-dot actual" data-idx="${idx}" style="left:${centers[idx]}px; top:${(valueToY(actualValue) / 10).toFixed(2)}%;" aria-label="${escapeHtml(formatMonthLabel(monthKey))}">
            <span class="sr-only">${escapeHtml(formatMonthLabel(monthKey))} Ist ${formatSignedEUR(actualValue)}</span>
          </button>
        `);
      }
      return dotsHtml.join("");
    })
    .join("");

  const legendHtml = `
    <div class="line-legend">
      <span class="legend-item"><span class="legend-swatch swatch-line-plan" aria-hidden="true"></span>Plan</span>
      ${actualValues.some(val => Number.isFinite(val))
        ? `<span class="legend-item"><span class="legend-swatch swatch-line-actual" aria-hidden="true"></span>Ist</span>`
        : ""}
    </div>
  `;

  container.innerHTML = `
    <div class="vchart line-chart" style="--rows:${ticks.length}; --zero:${zeroPct.toFixed(2)}">
      <div class="vchart-y">${ticks.map(v => `<div class="ytick">${formatEUR(v)}</div>`).join("")}</div>
      <div class="vchart-stage" style="--chart-width:${chartWidth}px; --group-gap:${groupGap}px;">
        <div class="vchart-stage-inner">
          <div class="vchart-grid">${ticks.map(() => "<div class=\\"yline\\"></div>").join("")}</div>
          <div class="vchart-zero"></div>
          <div class="vchart-lines">
            <svg viewBox="0 0 ${Math.max(chartWidth, 1)} 1000" preserveAspectRatio="none">
              ${planSegments.map(points => `<polyline class="line line-plan" points="${points.join(" ")}"></polyline>`).join("")}
              ${actualSegments.map(points => `<polyline class="line line-actual" points="${points.join(" ")}"></polyline>`).join("")}
            </svg>
          </div>
          <div class="line-dots">${dots}</div>
        </div>
      </div>
      <div class="vchart-x">${xLabelsHtml}</div>
    </div>
    ${legendHtml}
  `;

  function buildTooltip(index) {
    const monthKey = months[index];
    const rows = [];
    if (Number.isFinite(planValues[index])) {
      rows.push({ label: "Plan", value: planValues[index], swatch: "swatch-line-plan" });
    }
    if (Number.isFinite(actualValues[index])) {
      rows.push({ label: "Ist", value: actualValues[index], swatch: "swatch-line-actual" });
    }
    const rowsHtml = rows
      .map(entry => `
        <div class="tip-row">
          <span><span class="tip-swatch ${entry.swatch}" aria-hidden="true"></span>${escapeHtml(entry.label)}</span>
          <b>${formatSignedEUR(entry.value)}</b>
        </div>
      `)
      .join("");
    return `
      <div class="tip-title">${escapeHtml(formatMonthLabel(monthKey))}</div>
      ${rowsHtml || `<div class="tip-row"><span>Keine Daten</span><b>—</b></div>`}
    `;
  }

  function showTip(el) {
    const index = Number(el.getAttribute("data-idx"));
    if (!Number.isFinite(index)) return;
    tip.innerHTML = buildTooltip(index);
    tip.hidden = false;
    positionTip(tip, el.getBoundingClientRect());
  }

  function hideTip(force = false) {
    if (!force) {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains("line-dot")) return;
    }
    tip.hidden = true;
  }

  container.querySelectorAll(".line-dot").forEach(dot => {
    dot.addEventListener("pointerenter", () => showTip(dot));
    dot.addEventListener("pointermove", () => showTip(dot));
    dot.addEventListener("pointerleave", () => hideTip(), true);
    dot.addEventListener("focus", () => showTip(dot));
    dot.addEventListener("blur", () => hideTip(true));
    dot.addEventListener("click", () => {
      const idx = Number(dot.getAttribute("data-idx"));
      const monthKey = months[idx];
      if (monthKey && typeof onMonthSelect === "function") {
        hideTip(true);
        onMonthSelect(monthKey);
      }
    });
    dot.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const idx = Number(dot.getAttribute("data-idx"));
      const monthKey = months[idx];
      if (monthKey && typeof onMonthSelect === "function") {
        hideTip(true);
        onMonthSelect(monthKey);
      }
      ev.preventDefault();
    });
  });
}

export default { render };
