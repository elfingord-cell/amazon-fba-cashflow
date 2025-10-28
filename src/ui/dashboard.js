// UI: Dashboard – Monatsübersicht & detaillierte Monats-P/L-Analyse
import { loadState, addStateListener, setEventManualPaid, setEventsManualPaid, setAutoManualCheck } from "../data/storageLocal.js";
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
    inflowPaid: true,
    inflowOpen: true,
    outflowPaid: true,
    outflowOpen: true,
    netLine: true,
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
  dashboardRoot = root;
  const state = loadState();
  plState.autoManualCheck = state?.status?.autoManualCheck === true;
  const computed = computeSeries(state);
  const kpis = computed.kpis || {};
  const zipped = (computed.months || []).map((month, idx) => ({
    month,
    series: computed.series ? computed.series[idx] : null,
    breakdown: computed.breakdown ? computed.breakdown[idx] : null,
  }));
  zipped.sort((a, b) => a.month.localeCompare(b.month));
  const months = zipped.map(item => item.month);
  const series = zipped.map(item => item.series || {});
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
  const monthOpening = breakdown.map(b => Number(b?.opening || 0));
  const closing = breakdown.map(b => Number(b?.closing || 0));
  const firstNegativeIndex = closing.findIndex(value => value < 0);
  const legend = plState.legend || {};
  const showInflowPaid = legend.inflowPaid !== false;
  const showInflowOpen = legend.inflowOpen !== false;
  const showOutflowPaid = legend.outflowPaid !== false;
  const showOutflowOpen = legend.outflowOpen !== false;
  const showNetLine = legend.netLine !== false;

  const inflowPaidTotals = showInflowPaid ? series.map(r => Number(r.inflow?.paid || 0)) : [];
  const inflowOpenTotals = showInflowOpen ? series.map(r => Number(r.inflow?.open || 0)) : [];
  const outflowPaidTotals = showOutflowPaid ? series.map(r => Number(r.outflow?.paid || 0)) : [];
  const outflowOpenTotals = showOutflowOpen ? series.map(r => Number(r.outflow?.open || 0)) : [];
  const netLineValues = showNetLine ? closing : [];

  const topCandidates = [
    0,
    ...inflowPaidTotals,
    ...inflowOpenTotals,
    ...outflowPaidTotals,
    ...outflowOpenTotals,
  ];
  if (showNetLine) {
    topCandidates.push(...netLineValues.filter(v => v > 0));
    topCandidates.push(opening);
  }
  const rawTop = Math.max(...topCandidates);

  const bottomCandidates = [0];
  if (showNetLine) {
    bottomCandidates.push(...netLineValues.filter(v => v < 0));
    bottomCandidates.push(opening);
  }
  const rawBottom = Math.min(...bottomCandidates);
  const headroomFactor = 1.2;
  const paddedTop = rawTop === 0 ? 0 : rawTop * headroomFactor;
  const paddedBottom = rawBottom === 0 ? 0 : rawBottom * headroomFactor;
  const steps = 5;
  const range = (paddedTop - paddedBottom) / steps || 1;
  const niceStep = niceStepSize(range);
  const top = Math.max(niceStep, Math.ceil(paddedTop / niceStep) * niceStep);
  const bottom = rawBottom < 0 ? Math.floor(paddedBottom / niceStep) * niceStep : 0;
  const span = (top - bottom) || niceStep;
  const yTicks = Array.from({ length: steps + 1 }, (_, i) => top - (span / steps) * i);

  const monthsCount = months.length || 0;
  const groupWidth = 56;
  const groupGap = 28;
  const innerGap = 6;
  const chartWidth = monthsCount
    ? groupWidth * monthsCount + groupGap * Math.max(0, monthsCount - 1)
    : groupWidth * 18 + groupGap * 17;
  const centers = months.map((_, idx) => idx * (groupWidth + groupGap) + groupWidth / 2);
  const X = px => {
    const safeWidth = chartWidth || 1;
    return (px / safeWidth) * 1000;
  };
  const Y = v => {
    const val = Number(v || 0);
    const norm = (top - val) / span;
    const clamped = Math.max(0, Math.min(1, norm));
    return clamped * 1000;
  };
  const zeroPct = Math.max(0, Math.min(100, Y(0) / 10));

  const points = showNetLine
    ? netLineValues.map((v, i) => `${X(centers[i] || 0)},${Y(v)}`).join(" ")
    : "";
  const dots = showNetLine
    ? netLineValues
        .map((v, i) => `<circle class="dot" data-idx="${i}" cx="${X(centers[i] || 0)}" cy="${Y(v)}" r="6"></circle>`)
        .join("")
    : "";
  const netStrip = series
    .map((row, idx) => {
      const monthKey = months[idx] || "";
      const monthLabel = formatMonthShortLabel(monthKey);
      const value = Number(row?.net?.total || 0);
      const display = `${monthLabel} · ${fmtEUR0(value)}`;
      const ariaLabel = `${formatMonthLabel(monthKey)} – Netto ${fmtEUR(value)}`;
      return `<button type="button" class="net ${value >= 0 ? "pos" : "neg"}" data-month="${escapeHtml(monthKey)}" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(display)}</button>`;
    })
    .join("");

  function valuesFor(type, row) {
    if (type === "inflow") {
      if (!row.inflow) return [];
      const segments = [];
      if (plState.legend.inflowPaid !== false) {
        segments.push({ key: "paid", value: Number(row.inflow?.paid || 0) });
      }
      if (plState.legend.inflowOpen !== false) {
        segments.push({ key: "open", value: Number(row.inflow?.open || 0) });
      }
      return segments;
    }
    if (type === "outflow") {
      if (!row.outflow) return [];
      const segments = [];
      if (plState.legend.outflowPaid !== false) {
        segments.push({ key: "paid", value: Number(row.outflow?.paid || 0) });
      }
      if (plState.legend.outflowOpen !== false) {
        segments.push({ key: "open", value: Number(row.outflow?.open || 0) });
      }
      return segments;
    }
    return [];
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
    const target = type === "inflow" ? row.inflow : row.outflow;
    if (!target) return prettyMonth;
    const label = type === "inflow" ? "Inflow" : "Outflow";
    return `${prettyMonth}: ${label} gesamt ${fmtBarValue(type, target.total)} – bezahlt ${fmtBarValue(type, target.paid)} – offen ${fmtBarValue(type, target.open)}`;
  }

  function renderSegment(type, seg) {
    const yStart = Y(seg.start);
    const yEnd = Y(seg.end);
    const topPct = Math.min(yStart, yEnd) / 10;
    const heightPct = Math.abs(yStart - yEnd) / 10;
    if (heightPct <= 0.05) return "";
    const classes = `vbar-segment segment-${type}-${seg.key}`;
    return `<div class="${classes}" style="--seg-top:${topPct.toFixed(2)}; --seg-height:${heightPct.toFixed(2)}"></div>`;
  }

  function renderBar(type, row, monthIndex) {
    const stacked = stackSegments(valuesFor(type, row));
    const totalValue = type === "inflow"
      ? Number(row.inflow?.total || 0)
      : Number(row.outflow?.total || 0);
    const orientation = totalValue >= 0 ? "pos" : "neg";
    if (!stacked.length) {
      return `<div class="vbar-wrap type-${type} ${orientation} empty" aria-hidden="true"></div>`;
    }
    const aria = escapeHtml(ariaForBar(type, row, months[monthIndex]));
    const segmentsHtml = stacked.map(seg => renderSegment(type, seg)).join("");
    return `<div class="vbar-wrap type-${type} ${orientation}"><div class="vbar ${type}" data-idx="${monthIndex}" data-type="${type}" tabindex="0" role="img" aria-label="${aria}">${segmentsHtml}</div></div>`;
  }

  function monthTipHtml(monthKey, row, closingValue, openingValue) {
    const prettyMonth = formatMonthLabel(monthKey);
    const inflowPaid = Number(row?.inflow?.paid || 0);
    const inflowOpen = Number(row?.inflow?.open || 0);
    const outflowPaid = Number(row?.outflow?.paid || 0);
    const outflowOpen = Number(row?.outflow?.open || 0);
    const netPaid = Number(row?.net?.paid || 0);
    const netOpen = Number(row?.net?.open || 0);
    const formatSection = (title, paidValue, openValue, options = {}) => {
      const totalValue = paidValue + openValue;
      const paidLabel = escapeHtml(options.paidLabel || "bezahlt");
      const openLabel = escapeHtml(options.openLabel || "offen");
      const swatchPaid = options.swatchPaid ? `<span class="tip-swatch ${options.swatchPaid}" aria-hidden="true"></span>` : "";
      const swatchOpen = options.swatchOpen ? `<span class="tip-swatch ${options.swatchOpen}" aria-hidden="true"></span>` : "";
      return `
        <div class="tip-section">
          <div class="tip-subtitle">${escapeHtml(title)}</div>
          <div class="tip-row">
            <span>${swatchPaid}${paidLabel}</span>
            <b>${fmtEUR(options.negative ? -paidValue : paidValue)}</b>
          </div>
          <div class="tip-row">
            <span>${swatchOpen}${openLabel}</span>
            <b>${fmtEUR(options.negative ? -openValue : openValue)}</b>
          </div>
          <div class="tip-row total">
            <span>Gesamt</span>
            <b>${fmtEUR(options.negative ? -(totalValue) : totalValue)}</b>
          </div>
        </div>
      `;
    };
    const inflowSection = formatSection("Inflow", inflowPaid, inflowOpen, {
      swatchPaid: "swatch-inflow-paid",
      swatchOpen: "swatch-inflow-open",
    });
    const outflowSection = formatSection("Outflow", outflowPaid, outflowOpen, {
      swatchPaid: "swatch-outflow-paid",
      swatchOpen: "swatch-outflow-open",
      negative: true,
    });
    const netSection = formatSection("Netto", netPaid, netOpen, {
      swatchPaid: "swatch-net-paid",
      swatchOpen: "swatch-net-open",
    });
    const balanceSection = `
      <div class="tip-divider"></div>
      <div class="tip-row">
        <span>Monatsanfang</span>
        <b>${fmtEUR(openingValue)}</b>
      </div>
      <div class="tip-row">
        <span>Kontostand Monatsende</span>
        <b>${fmtEUR(closingValue)}</b>
      </div>
    `;
    return `
      <div class="tip-title">${prettyMonth}</div>
      ${inflowSection}
      ${outflowSection}
      ${netSection}
      ${balanceSection}
    `;
  }

  const barGroupsHtml = series
    .map((row, i) => {
      const inflowBar = renderBar("inflow", row, i);
      const outflowBar = renderBar("outflow", row, i);
      return `<div class="vbar-group" style="width:${groupWidth}px; --inner-gap:${innerGap}px" data-month="${escapeHtml(months[i] || "")}">${inflowBar}${outflowBar}</div>`;
    })
    .join("");

  const viewport = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
  const maxXTicks = viewport && viewport < 900 ? 6 : 8;
  const step = Math.max(1, Math.ceil((months.length || 1) / maxXTicks));
  const xLabelsHtml = months
    .map((monthKey, idx) => {
      const label = idx % step === 0 ? formatMonthShortLabel(monthKey) : "";
      return `<div class="xlabel" style="width:${groupWidth}px">${label ? escapeHtml(label) : "&nbsp;"}</div>`;
    })
    .join("");

  const legendRows = [
    { key: "inflowPaid", label: "Inflow bezahlt", swatch: "swatch-inflow-paid" },
    { key: "inflowOpen", label: "Inflow offen", swatch: "swatch-inflow-open" },
    { key: "outflowPaid", label: "Outflow bezahlt", swatch: "swatch-outflow-paid" },
    { key: "outflowOpen", label: "Outflow offen", swatch: "swatch-outflow-open" },
    { key: "netLine", label: "Netto Linie", swatch: "swatch-net-line" },
  ];

  const legendHtml = `
    <div class="chart-legend" role="list">
      ${legendRows
        .map(row => `
          <button type="button" class="legend-button ${plState.legend[row.key] === false ? "is-off" : ""}" data-legend="${row.key}" aria-pressed="${plState.legend[row.key] !== false}">
            <span class="legend-swatch ${row.swatch}" aria-hidden="true"></span>
            <span class="legend-label">${row.label}</span>
          </button>
        `)
        .join("")}
    </div>
  `;

  const firstNegativeDisplay =
    firstNegativeIndex >= 0 ? formatMonthLabel(months[firstNegativeIndex]) : "—";

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <p class="dashboard-intro">Plane Ein-/Auszahlungen, POs/FOs und Importkosten – behalte deinen Kontostand pro Monat im Blick.</p>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label" title="Kontostand zu Beginn des Startmonats.">Opening heute</div><div class="kpi-value">${fmtEUR(opening)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Durchschnittliche Amazon-Auszahlungsquote über die sichtbaren Monate.">Sales × Payout (Monat ∅)</div><div class="kpi-value">${fmtEUR(kpis.salesPayoutAvg || 0)}</div></div>
        <div class="kpi"><div class="kpi-label" title="Erster Monat, in dem der geplante Saldo unter den kritischen Puffer fällt.">Erster negativer Monat</div><div class="kpi-value">${firstNegativeDisplay}</div></div>
      </div>
      <div class="vchart" style="--rows:${yTicks.length}; --zero:${zeroPct.toFixed(2)}">
        <div class="vchart-y">${yTicks.map(v => `<div class="ytick">${fmtTick(v)}</div>`).join("")}</div>
        <div class="vchart-stage" style="--chart-width:${chartWidth}px; --group-gap:${groupGap}px;">
          <div class="vchart-stage-inner">
            <div class="vchart-grid">${yTicks.map(() => "<div class=\"yline\"></div>").join("")}</div>
            <div class="vchart-zero"></div>
            <div class="vchart-bars">
              ${barGroupsHtml}
            </div>
            <div class="vchart-lines" aria-hidden="true">
              <svg viewBox="0 0 ${Math.max(chartWidth, 1)} 1000" preserveAspectRatio="none">
                ${showNetLine ? `<polyline class="line" points="${points}"></polyline>${dots}` : ""}
              </svg>
            </div>
          </div>
          <div class="vchart-x">${xLabelsHtml}</div>
        </div>
      </div>
      ${legendHtml}
      <div class="net-strip-label">Netto je Monat</div>
      <div class="net-strip">${netStrip}</div>
    </section>
    <section class="card pl-container" id="pl-root"></section>
  `;

  const plRoot = root.querySelector("#pl-root");

  root.querySelectorAll('.legend-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-legend');
      if (!type) return;
      const current = plState.legend[type] !== false;
      plState.legend[type] = current ? false : true;
      render(root);
    });
  });

  const tip = ensureGlobalTip();
  const dotNodes = Array.from(root.querySelectorAll(".vchart-lines .dot"));

  function showBarTip(el) {
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    if (!Number.isFinite(i)) return;
    const row = series[i];
    const eom = closing[i];
    const mos = monthOpening[i];
    tip.innerHTML = monthTipHtml(months[i], row, eom, mos);
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
    if (dotNodes.length) {
      dotNodes.forEach((dot, idx) => {
        dot.classList.toggle("is-active", idx === i);
      });
    }
  }

  function hideTip(force = false) {
    if (!force) {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains("vbar")) {
        return;
      }
    }
    if (dotNodes.length) {
      dotNodes.forEach(dot => dot.classList.remove("is-active"));
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
    barsWrap.addEventListener("click", ev => {
      const el = ev.target.closest(".vbar");
      if (!el) return;
      const idx = Number(el.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      const monthKey = months[idx];
      hideTip(true);
      focusMonthCard(monthKey);
      if (plRoot) updatePLSection(plRoot);
    });
  }

  const barNodes = root.querySelectorAll(".vbar[data-type]");
  barNodes.forEach(node => {
    node.addEventListener("focus", () => showBarTip(node));
    node.addEventListener("blur", () => hideTip(true));
    node.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        showBarTip(node);
        const idx = Number(node.getAttribute("data-idx"));
        if (Number.isFinite(idx)) {
          hideTip(true);
          focusMonthCard(months[idx]);
          if (plRoot) updatePLSection(plRoot);
        }
        ev.preventDefault();
      }
    });
  });

  const netStripNode = root.querySelector(".net-strip");
  if (netStripNode) {
    netStripNode.addEventListener("click", ev => {
      const btn = ev.target.closest("button[data-month]");
      if (!btn) return;
      const monthKey = btn.getAttribute("data-month");
      hideTip(true);
      focusMonthCard(monthKey);
      if (plRoot) updatePLSection(plRoot);
    });
  }

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
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(v || 0));
}

export default { render };
