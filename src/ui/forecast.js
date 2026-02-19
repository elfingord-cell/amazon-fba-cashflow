import { addStateListener } from '../data/storageLocal.js';
import { loadAppState, commitAppState, getViewState, setViewState } from "../storage/store.js";
import { parseVentoryCsv } from "./forecastCsv.js";

const CSV_IMPORT_LABEL = "VentoryOne Forecast importieren (CSV)";
const FORECAST_VIEW_KEY = "forecast_view_v1";

const defaultView = {
  search: "",
  range: "next12",
  onlyActive: true,
  onlyWithForecast: false,
  view: "units",
  collapsed: {},
};

const forecastView = (() => {
  const raw = getViewState(FORECAST_VIEW_KEY, {});
  return {
    ...defaultView,
    ...raw,
    collapsed: (raw && raw.collapsed) || {},
  };
})();

forecastView.scrollLeft = Number(forecastView.scrollLeft || 0);

function persistView() {
  setViewState(FORECAST_VIEW_KEY, {
    search: forecastView.search,
    range: forecastView.range,
    onlyActive: forecastView.onlyActive,
    onlyWithForecast: forecastView.onlyWithForecast,
    view: forecastView.view,
    collapsed: forecastView.collapsed,
  });
}

function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

async function parseExcelFile(file) {
  const [{ default: XLSX }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm'),
  ]);

  // Versuche zuerst den Array-Pfad (schnell, modern), dann eine binäre
  // Repräsentation für ältere XLS-Dateien.
  let workbook;
  let primaryError;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch (err) {
    primaryError = err;
  }

  if (!workbook) {
    try {
      const buffer = await file.arrayBuffer();
      const binary = arrayBufferToBinaryString(buffer);
      workbook = XLSX.read(binary, { type: 'binary', cellDates: true });
    } catch (fallbackErr) {
      console.error('Excel-Import fehlgeschlagen', primaryError, fallbackErr);
      throw fallbackErr;
    }
  }

  if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
    throw new Error('Keine Tabellenblätter gefunden');
  }
  const sheet = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: null });
  return rows;
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberDE(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalised = cleaned;
  if (decimalIndex >= 0) {
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalised = `${integer}.${fraction}`;
  } else {
    normalised = cleaned.replace(/[.,]/g, "");
  }
  const num = Number(normalised);
  return Number.isFinite(num) ? num : null;
}

function formatForecastValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value) {
  if (value == null || !Number.isFinite(Number(value))) return "0,00";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUnits(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function formatEur0(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const rounded = Math.round(Number(value));
  return `${rounded.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
}

function monthColumnClass(index) {
  return `month-col ${index % 2 === 1 ? "month-col-alt" : ""}`.trim();
}

function getViewLabel(view) {
  if (view === "revenue") return "Umsatz";
  if (view === "profit") return "Gewinn";
  return "Absatz";
}

function formatDisplayValue(view, value) {
  return view === "units" ? formatUnits(value) : formatEur0(value);
}

function sumNumeric(values) {
  const nums = values.filter(value => Number.isFinite(value));
  return nums.length ? nums.reduce((acc, val) => acc + val, 0) : null;
}

function getMonthlyTotals(state, products, months, view) {
  return months.map(month => {
    const values = products.map(product => {
      const sku = String(product?.sku || "").trim();
      if (!sku) return null;
      const units = getEffectiveValue(state, sku, month);
      return getDerivedValue(view, units, product);
    });
    return sumNumeric(values);
  });
}

function isProductActive(product) {
  if (!product) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function buildCategoryGroups(products, categories = []) {
  const categoryMap = new Map();
  products.forEach(product => {
    const key = product.categoryId ? String(product.categoryId) : "";
    if (!categoryMap.has(key)) categoryMap.set(key, []);
    categoryMap.get(key).push(product);
  });
  const sortedCategories = categories
    .slice()
    .sort((a, b) => {
      const aSort = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
      const bSort = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
      return aSort - bSort || String(a.name || "").localeCompare(String(b.name || ""));
    });
  const groups = sortedCategories.map(category => ({
    id: String(category.id),
    name: category.name || "Ohne Kategorie",
    items: categoryMap.get(String(category.id)) || [],
  }));
  const uncategorized = categoryMap.get("") || [];
  if (uncategorized.length) {
    groups.push({ id: "uncategorized", name: "Ohne Kategorie", items: uncategorized });
  }
  return groups.filter(group => group.items.length);
}

function getMonthBuckets(start, horizon) {
  const months = [];
  const [y0, m0] = String(start || "2025-01").split("-").map(Number);
  for (let i = 0; i < horizon; i += 1) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

function applyRange(months, range) {
  if (range === "all") return months;
  const count = Number(String(range).replace("next", "")) || months.length;
  return months.slice(0, count);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getRangeOptions(months) {
  const options = [];
  [12, 18, 24].forEach(count => {
    if (months.length >= count) {
      options.push({ value: `next${count}`, label: `Nächste ${count}` });
    }
  });
  options.push({ value: "all", label: "Alle" });
  return options;
}

function getImportValue(state, sku, month) {
  const forecast = state && state.forecast;
  const importMap = forecast && forecast.forecastImport;
  if (!importMap) return null;
  const skuMap = importMap[sku];
  if (!skuMap) return null;
  return skuMap[month] || null;
}

function getManualValue(state, sku, month) {
  const forecast = state && state.forecast;
  const manualMap = forecast && forecast.forecastManual;
  if (!manualMap) return null;
  const skuMap = manualMap[sku];
  if (!skuMap || typeof skuMap !== "object") return null;
  const value = skuMap[month];
  return typeof value === "undefined" ? null : value;
}

function getEffectiveValue(state, sku, month) {
  const manual = getManualValue(state, sku, month);
  if (manual != null) return manual;
  const imported = getImportValue(state, sku, month);
  if (!imported || typeof imported !== "object") return null;
  return typeof imported.units === "undefined" ? null : imported.units;
}

function getDerivedValue(view, units, product) {
  if (units == null || !Number.isFinite(Number(units))) return null;
  const qty = Number(units);
  if (view === "units") return qty;
  const price = parseNumberDE(product && product.avgSellingPriceGrossEUR);
  if (!Number.isFinite(price)) return null;
  const revenue = qty * price;
  if (view === "revenue") return revenue;
  const margin = parseNumberDE(product && product.sellerboardMarginPct);
  if (!Number.isFinite(margin)) return null;
  return revenue * (margin / 100);
}

function getForecastRevenueByMonth(state, months) {
  const revenueByMonth = new Map();
  const products = Array.isArray(state?.products) ? state.products : [];
  months.forEach(month => revenueByMonth.set(month, 0));
  products.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (!sku) return;
    months.forEach(month => {
      const units = getEffectiveValue(state, sku, month);
      const revenue = getDerivedValue("revenue", units, product);
      if (!Number.isFinite(revenue)) return;
      revenueByMonth.set(month, (revenueByMonth.get(month) || 0) + revenue);
    });
  });
  return revenueByMonth;
}

function parseVentoryMonth(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const match = text.match(/Erwartete Verkäufe\s+([A-Za-zÄÖÜäöüß\.]+)\s+(\d{4})/i);
  if (!match) return null;
  const monthRaw = match[1].replace('.', '').toLowerCase();
  const year = match[2];
  const monthMap = {
    jan: '01',
    januar: '01',
    februar: '02',
    feb: '02',
    märz: '03',
    maerz: '03',
    mrz: '03',
    marz: '03',
    apr: '04',
    april: '04',
    mai: '05',
    jun: '06',
    juni: '06',
    jul: '07',
    juli: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    okt: '10',
    oktober: '10',
    nov: '11',
    november: '11',
    dez: '12',
    dezember: '12',
  };
  const monthKey = monthMap[monthRaw];
  if (!monthKey) return null;
  return `${year}-${monthKey}`;
}

function detectMonthBlocks(row0, row1) {
  const blocks = [];
  const warnings = [];
  (row0 || []).forEach((cell, idx) => {
    if (!cell) return;
    if (!String(cell).includes('Erwartete Verkäufe')) return;
    const monthKey = parseVentoryMonth(cell);
    if (!monthKey) {
      warnings.push(`Monat konnte nicht erkannt werden: "${cell}"`);
      return;
    }
    const sub = [
      row1 ? row1[idx] : null,
      row1 ? row1[idx + 1] : null,
      row1 ? row1[idx + 2] : null,
    ].map(normalizeHeader);
    const expected = ['einheiten', 'umsatz [€]', 'gewinn [€]'];
    if (!sub.every((val, subIdx) => val === normalizeHeader(expected[subIdx]))) {
      warnings.push(`Subheader ab Spalte ${idx + 1} abweichend (${sub.filter(Boolean).join(' / ') || 'leer'}).`);
    }
    blocks.push({ monthKey, startCol: idx });
  });
  return { blocks, warnings };
}

function findColumnIndex(row1, candidates) {
  if (!row1) return -1;
  const normalized = row1.map(cell => normalizeHeader(cell));
  return normalized.findIndex(cell => candidates.some(candidate => cell.includes(candidate)));
}

function parseVentoryRows(rows) {
  const row0 = (rows && rows[0]) || [];
  const row1 = (rows && rows[1]) || [];
  const { blocks, warnings } = detectMonthBlocks(row0, row1);
  const statusCol = findColumnIndex(row1, ['status']);
  const aliasCol = findColumnIndex(row1, ['variation', 'alias', 'produkt', 'name']);
  const records = [];
  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const sku = String(row[0] || '').trim();
    if (!sku) break;
    const status = statusCol >= 0 ? String(row[statusCol] || '').trim() : '';
    const alias = aliasCol >= 0 ? String(row[aliasCol] || '').trim() : '';
    blocks.forEach(block => {
      const unitsVal = parseNumberDE(row[block.startCol]);
      const revenueVal = parseNumberDE(row[block.startCol + 1]);
      const profitVal = parseNumberDE(row[block.startCol + 2]);
      if (unitsVal == null && revenueVal == null && profitVal == null) return;
      records.push({
        sku,
        alias,
        status,
        month: block.monthKey,
        units: unitsVal,
        revenueEur: revenueVal,
        profitEur: profitVal,
      });
    });
  }
  return { records, warnings, months: blocks.map(block => block.monthKey) };
}

function showToast(message) {
  let toast = document.getElementById('forecast-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'forecast-toast';
    toast.className = 'po-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2200);
}

function escapeSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function renderMonthlyTotalsTable(months, monthlyTotals, view) {
  const table = document.createElement("table");
  table.className = "table-compact ui-table-standard forecast-tree-table forecast-month-totals-table";
  table.dataset.uiTable = "true";
  table.dataset.stickyCols = "1";
  table.dataset.stickyOwner = "manual";

  const tbody = document.createElement("tbody");
  const row = document.createElement("tr");
  row.className = "forecast-month-totals-row row-summary";
  row.innerHTML = `
    <td class="tree-cell tree-summary tree-level-0 forecast-month-totals-label">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Monatssumme (${getViewLabel(view)})</span>
    </td>
    ${months.map((month, idx) => `<td class="forecast-cell forecast-total num ${monthColumnClass(idx)}" data-month="${month}">${formatDisplayValue(view, monthlyTotals[idx])}</td>`).join("")}
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
  `;
  tbody.appendChild(row);
  table.appendChild(tbody);
  return table;
}

function renderTable(el, state, months, monthsAll, groups, view) {
  const currentMonth = currentMonthKey();
  const currentYear = Number(currentMonth.split("-")[0]);
  const table = document.createElement("table");
  table.className = "table-compact ui-table-standard forecast-tree-table";
  table.dataset.uiTable = "true";
  table.dataset.stickyCols = "1";
  table.dataset.stickyOwner = "manual";

  const totalsHeaders = `
    <th class="forecast-total">Summe (Auswahl)</th>
    <th class="forecast-total">Summe (Jahr)</th>
    <th class="forecast-total">Summe (Gesamt)</th>
  `;

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = `
    <th class="tree-header">Kategorie / Produkt</th>
    ${months.map((month, idx) => `<th class="${monthColumnClass(idx)}">${month}</th>`).join("")}
    ${totalsHeaders.replaceAll('forecast-total', 'forecast-total num')}
  `;
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  const groupedProducts = groups.flatMap(group => group.items);
  const overallTotals = getMonthlyTotals(state, groupedProducts, months, view);
  const overallTotalsAll = getMonthlyTotals(state, groupedProducts, monthsAll, view);

  const overallRow = document.createElement("tr");
  overallRow.className = "forecast-category-row forecast-overall-row row-summary";
  overallRow.innerHTML = `
    <td class="tree-cell tree-summary tree-level-0">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Gesamt</span>
    </td>
    ${months.map((month, idx) => `<td class="forecast-cell forecast-total num ${monthColumnClass(idx)}">${formatDisplayValue(view, overallTotals[idx])}</td>`).join("")}
    ${(() => {
      const sumRange = sumNumeric(overallTotals.filter(Number.isFinite));
      const sumAll = sumNumeric(overallTotalsAll.filter(Number.isFinite));
      const yearValues = monthsAll
        .map((month, idx) => ({ month, value: overallTotalsAll[idx] }))
        .filter(entry => Number.isFinite(entry.value) && Number(entry.month.split("-")[0]) === currentYear && entry.month >= currentMonth)
        .map(entry => entry.value);
      const sumYear = sumNumeric(yearValues);
      return `
        <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumRange)}</td>
        <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumYear)}</td>
        <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumAll)}</td>
      `;
    })()}
  `;
  tbody.appendChild(overallRow);

  groups.forEach(group => {
    const isCollapsed = Boolean(forecastView.collapsed[group.id]);
    const categoryTotals = months.map(month => {
      const values = group.items.map(product => {
        const sku = String(product.sku || "").trim();
        const units = getEffectiveValue(state, sku, month);
        return getDerivedValue(view, units, product);
      });
      return sumNumeric(values);
    });
    const categoryTotalsAll = monthsAll.map(month => {
      const values = group.items.map(product => {
        const sku = String(product.sku || "").trim();
        const units = getEffectiveValue(state, sku, month);
        return getDerivedValue(view, units, product);
      });
      return sumNumeric(values);
    });
    const categoryRow = document.createElement("tr");
    categoryRow.className = "forecast-category-row row-section";
    const categorySumRange = sumNumeric(categoryTotals.filter(Number.isFinite));
    const categorySumAll = sumNumeric(categoryTotalsAll.filter(Number.isFinite));
    const categoryYearValues = monthsAll
      .map((month, idx) => ({ month, value: categoryTotalsAll[idx] }))
      .filter(entry => Number.isFinite(entry.value) && Number(entry.month.split("-")[0]) === currentYear && entry.month >= currentMonth)
      .map(entry => entry.value);
    const categoryYearSum = sumNumeric(categoryYearValues);
    categoryRow.innerHTML = `
      <td class="tree-cell tree-level-0">
        <button type="button" class="tree-toggle" data-category="${group.id}">
          ${isCollapsed ? "▶" : "▼"}
        </button>
        <span class="tree-label">${group.name}</span>
        <span class="forecast-count muted">${group.items.length}</span>
      </td>
      ${months.map((month, idx) => `<td class="forecast-cell forecast-total num ${monthColumnClass(idx)}">${formatDisplayValue(view, categoryTotals[idx])}</td>`).join("")}
      <td class="forecast-cell forecast-total num">${formatDisplayValue(view, categorySumRange)}</td>
      <td class="forecast-cell forecast-total num">${formatDisplayValue(view, categoryYearSum)}</td>
      <td class="forecast-cell forecast-total num">${formatDisplayValue(view, categorySumAll)}</td>
    `;
    tbody.appendChild(categoryRow);

    if (!isCollapsed) {
      group.items.forEach(product => {
        const sku = String(product.sku || "").trim();
        const alias = product.alias || sku;
        const row = document.createElement("tr");
        row.className = "forecast-product-row row-detail";
        row.setAttribute("data-sku", sku);
        const productValues = months.map(month => {
          const units = getEffectiveValue(state, sku, month);
          return getDerivedValue(view, units, product);
        });
        const productValuesAll = monthsAll.map(month => {
          const units = getEffectiveValue(state, sku, month);
          return getDerivedValue(view, units, product);
        });
        const sumRange = sumNumeric(productValues.filter(Number.isFinite));
        const sumAll = sumNumeric(productValuesAll.filter(Number.isFinite));
        const yearValues = monthsAll
          .map((month, idx) => ({ month, value: productValuesAll[idx] }))
          .filter(entry => Number.isFinite(entry.value) && Number(entry.month.split("-")[0]) === currentYear && entry.month >= currentMonth)
          .map(entry => entry.value);
        const sumYear = sumNumeric(yearValues);
        row.innerHTML = `
          <td class="tree-cell tree-level-1 forecast-product-cell">
            <span class="tree-spacer" aria-hidden="true"></span>
            <span class="coverage-sku-block">
              <span class="tree-label">${alias}</span>
              <span class="forecast-sku muted">${sku}</span>
            </span>
          </td>
          ${months.map((month, idx) => {
            const manual = getManualValue(state, sku, month);
            const imported = getImportValue(state, sku, month);
            const units = getEffectiveValue(state, sku, month);
            const derived = productValues[idx];
            const value = formatDisplayValue(view, derived);
            const manualFlag = manual != null ? "forecast-manual" : "";
            const hint = manual != null ? "Manuell" : (imported ? "Import" : "");
            const missingInput = derived == null && units != null && view !== "units";
            const title = missingInput ? "Produktdaten fehlen" : hint;
            return `
              <td class="forecast-cell num ${manualFlag} ${monthColumnClass(idx)}" data-sku="${sku}" data-month="${month}" title="${title}">
                <span class="forecast-value">${value}</span>
                ${manual != null ? `<span class="forecast-manual-dot" aria-hidden="true"></span>` : ""}
              </td>
            `;
          }).join("")}
          <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumRange)}</td>
          <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumYear)}</td>
          <td class="forecast-cell forecast-total num">${formatDisplayValue(view, sumAll)}</td>
        `;
        tbody.appendChild(row);
      });
    }
  });

  table.appendChild(tbody);

  let activeInput = null;

  function closeEditor({ commit }) {
    if (!activeInput) return;
    const cell = activeInput.closest("td");
    const sku = cell && cell.dataset ? cell.dataset.sku : null;
    const month = cell && cell.dataset ? cell.dataset.month : null;
    const raw = activeInput.value;
    activeInput.removeEventListener("keydown", onKeydown);
    activeInput.removeEventListener("blur", onBlur);
    activeInput = null;
    if (commit && sku && month) {
      const value = parseNumberDE(raw);
      const st = loadAppState();
      ensureForecastContainers(st);
      if (!st.forecast.forecastManual[sku]) st.forecast.forecastManual[sku] = {};
      if (raw.trim() === "" || value == null) {
        if (st.forecast.forecastManual[sku]) {
          delete st.forecast.forecastManual[sku][month];
          if (!Object.keys(st.forecast.forecastManual[sku]).length) delete st.forecast.forecastManual[sku];
        }
      } else {
        st.forecast.forecastManual[sku][month] = value;
      }
      commitAppState(st);
      render(el);
      return;
    }
    render(el);
  }

  function onKeydown(ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      closeEditor({ commit: true });
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeEditor({ commit: false });
    }
  }

  function onBlur() {
    closeEditor({ commit: true });
  }

  tbody.addEventListener("click", ev => {
    if (forecastView.view !== "units") return;
    const cell = ev.target.closest("td[data-sku]");
    if (!cell || activeInput) return;
    const sku = cell.dataset.sku;
    const month = cell.dataset.month;
    if (!sku || !month) return;
    const current = getEffectiveValue(state, sku, month);
    cell.innerHTML = `<input class="forecast-input" type="text" inputmode="decimal" value="${current != null ? current : ""}" />`;
    activeInput = cell.querySelector("input");
    activeInput.addEventListener("keydown", onKeydown);
    activeInput.addEventListener("blur", onBlur);
    activeInput.focus();
    activeInput.select();
  });

  tbody.addEventListener("click", ev => {
    const toggle = ev.target.closest("[data-category]");
    if (!toggle) return;
    const categoryId = toggle.getAttribute("data-category");
    if (!categoryId) return;
    forecastView.collapsed[categoryId] = !forecastView.collapsed[categoryId];
    persistView();
    render(el);
  });

  return table;
}

function ensureForecastContainers(state) {
  if (!state.forecast || typeof state.forecast !== 'object') {
    state.forecast = {
      items: [],
      settings: { useForecast: false },
      forecastImport: {},
      forecastManual: {},
      lastImportAt: null,
      importSource: null,
    };
  }
  if (!Array.isArray(state.forecast.items)) state.forecast.items = [];
  if (!state.forecast.settings || typeof state.forecast.settings !== 'object') {
    state.forecast.settings = { useForecast: false };
  }
  if (!state.forecast.forecastImport || typeof state.forecast.forecastImport !== 'object') {
    state.forecast.forecastImport = {};
  }
  if (!state.forecast.forecastManual || typeof state.forecast.forecastManual !== 'object') {
    state.forecast.forecastManual = {};
  }
  if (state.forecast.lastImportAt === undefined) state.forecast.lastImportAt = null;
  if (state.forecast.importSource === undefined) state.forecast.importSource = null;
}

function render(el) {
  const state = loadAppState();
  ensureForecastContainers(state);
  el.innerHTML = '';
  const products = Array.isArray(state.products) ? state.products : [];
  const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
  const routeQuery = window.__routeQuery || {};
  const routeSku = String(routeQuery.sku || "").trim();
  const routeMonth = String(routeQuery.month || "").trim();
  if (routeSku) {
    forecastView.search = "";
    forecastView.onlyActive = false;
    forecastView.onlyWithForecast = false;
    const matched = products.find(product => String(product?.sku || "").trim() === routeSku);
    if (matched?.categoryId != null) {
      forecastView.collapsed[String(matched.categoryId)] = false;
    }
  }
  const monthsAll = getMonthBuckets(
    (state.settings && state.settings.startMonth) || "2025-01",
    Number((state.settings && state.settings.horizonMonths) || 18)
  );
  const rangeOptions = getRangeOptions(monthsAll);
  if (routeMonth && !applyRange(monthsAll, forecastView.range).includes(routeMonth)) {
    forecastView.range = "all";
  }
  if (!rangeOptions.some(option => option.value === forecastView.range)) {
    forecastView.range = rangeOptions[0] ? rangeOptions[0].value : "all";
  }
  const months = applyRange(monthsAll, forecastView.range);
  const searchTerm = forecastView.search.trim().toLowerCase();
  const filteredProducts = products.filter(product => {
    if (forecastView.onlyActive && !isProductActive(product)) return false;
    if (searchTerm) {
      const category = categories.find(cat => String(cat.id) === String(product.categoryId));
      const values = [
        product.alias,
        product.sku,
        ...(product.tags || []),
        category ? category.name : null,
      ]
        .filter(Boolean)
        .map(val => String(val).toLowerCase());
      if (!values.some(val => val.includes(searchTerm))) return false;
    }
    if (forecastView.onlyWithForecast) {
      const sku = String(product.sku || "").trim();
      const hasForecast = months.some(month => {
        const value = getEffectiveValue(state, sku, month);
        return Number.isFinite(Number(value)) && Number(value) > 0;
      });
      if (!hasForecast) return false;
    }
    return true;
  });
  const groups = buildCategoryGroups(filteredProducts, categories);
  const wrap = document.createElement('section');
  wrap.className = 'card ui-page-shell forecast-page';
  wrap.innerHTML = `
    <header class="panel__header ui-page-head">
      <div>
        <p class="eyebrow">Werkzeuge</p>
        <h1>Absatzprognose (Ventory)</h1>
        <p class="text-muted">VentoryOne-Import, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <button class="btn secondary" type="button" data-ventory-csv>${CSV_IMPORT_LABEL}</button>
        <button class="btn" type="button" data-forecast-save>Änderungen speichern</button>
      </div>
    </header>
    <div class="forecast-toolbar">
      <div class="forecast-toolbar-row">
        <label class="field">
          <span>Suche</span>
          <input type="search" data-forecast-search value="${forecastView.search}" placeholder="SKU, Alias, Tag, Kategorie" />
        </label>
        <label class="field">
          <span>Monatsbereich</span>
          <select data-forecast-range>
            ${rangeOptions.map(option => `<option value="${option.value}" ${option.value === forecastView.range ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <div class="forecast-view-toggle" role="group" aria-label="Forecast-Ansicht">
          <button class="btn ${forecastView.view === "units" ? "secondary" : "ghost"}" type="button" data-forecast-view="units">Absatz</button>
          <button class="btn ${forecastView.view === "revenue" ? "secondary" : "ghost"}" type="button" data-forecast-view="revenue">Umsatz</button>
          <button class="btn ${forecastView.view === "profit" ? "secondary" : "ghost"}" type="button" data-forecast-view="profit">Gewinn</button>
        </div>
        <label class="toggle">
          <input type="checkbox" ${forecastView.onlyActive ? "checked" : ""} data-only-active />
          <span>Nur aktive Produkte</span>
        </label>
        <label class="toggle">
          <input type="checkbox" ${forecastView.onlyWithForecast ? "checked" : ""} data-only-forecast />
          <span>Nur Produkte mit Forecast</span>
        </label>
      </div>
      <div class="forecast-toolbar-row">
        <button class="btn secondary" type="button" data-expand="expand">Alles auf</button>
        <button class="btn secondary" type="button" data-expand="collapse">Alles zu</button>
        <button class="btn" type="button" data-forecast-transfer>Umsatz übertragen</button>
        <label class="toggle">
          <input type="checkbox" ${state.forecast.settings.useForecast ? "checked" : ""} data-forecast-toggle />
          <span>Umsatz aus Prognose übernehmen</span>
        </label>
      </div>
    </div>
  `;
  const tableHost = document.createElement('div');
  tableHost.className = 'forecast-table-wrap ui-table-shell ui-scroll-host';
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "12px";
    empty.textContent = "Keine Produkte gefunden.";
    tableHost.appendChild(empty);
  } else {
    const monthTotals = getMonthlyTotals(state, filteredProducts, months, forecastView.view);
    const monthTotalsTable = renderMonthlyTotalsTable(months, monthTotals, forecastView.view);
    tableHost.appendChild(monthTotalsTable);
    const table = renderTable(el, state, months, monthsAll, groups, forecastView.view);
    tableHost.appendChild(table);
    tableHost.scrollLeft = forecastView.scrollLeft || 0;
    tableHost.addEventListener("scroll", () => {
      forecastView.scrollLeft = tableHost.scrollLeft;
    }, { passive: true });
  }
  wrap.appendChild(tableHost);
  el.appendChild(wrap);

  wrap.querySelector('[data-forecast-toggle]').addEventListener('change', ev => {
    const st = loadAppState();
    ensureForecastContainers(st);
    st.forecast.settings.useForecast = ev.target.checked;
    commitAppState(st);
  });

  wrap.querySelector('[data-ventory-csv]').addEventListener('click', () => {
    openVentoryCsvImportModal(el);
  });

  wrap.querySelector('[data-forecast-transfer]').addEventListener('click', () => {
    openForecastTransferModal(el, monthsAll, months);
  });

  wrap.querySelector('[data-forecast-save]').addEventListener('click', () => {
    const st = loadAppState();
    commitAppState(st);
    showToast("Änderungen gespeichert.");
  });

  wrap.querySelector('[data-forecast-search]').addEventListener('input', ev => {
    forecastView.search = ev.target.value;
    persistView();
    render(el);
  });

  wrap.querySelector('[data-forecast-range]').addEventListener('change', ev => {
    forecastView.range = ev.target.value;
    persistView();
    render(el);
  });

  wrap.querySelectorAll('[data-forecast-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextView = btn.getAttribute('data-forecast-view');
      if (!nextView || nextView === forecastView.view) return;
      forecastView.view = nextView;
      persistView();
      render(el);
    });
  });

  wrap.querySelector('[data-only-active]').addEventListener('change', ev => {
    forecastView.onlyActive = ev.target.checked;
    persistView();
    render(el);
  });

  wrap.querySelector('[data-only-forecast]').addEventListener('change', ev => {
    forecastView.onlyWithForecast = ev.target.checked;
    persistView();
    render(el);
  });

  wrap.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-expand');
      if (action === "collapse") {
        const next = {};
        groups.forEach(group => { next[group.id] = true; });
        forecastView.collapsed = next;
      } else {
        forecastView.collapsed = {};
      }
      persistView();
      render(el);
    });
  });

  function focusFromRoute() {
    if (!routeSku) return;
    const skuSelector = escapeSelector(routeSku);
    const monthSelector = routeMonth ? `[data-month="${escapeSelector(routeMonth)}"]` : "";
    const cell = el.querySelector(`td[data-sku="${skuSelector}"]${monthSelector}`);
    const row = cell ? cell.closest("tr") : el.querySelector(`tr[data-sku="${skuSelector}"]`);
    if (row) row.classList.add("row-focus");
    if (cell) {
      cell.classList.add("cell-focus");
      cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } else if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.__routeQuery = {};
  }

  focusFromRoute();
}

function openForecastTransferModal(host, monthsAll, defaultMonths) {
  const state = loadAppState();
  ensureForecastContainers(state);
  const revenueByMonth = getForecastRevenueByMonth(state, monthsAll);
  const monthEntries = monthsAll.map(month => ({
    month,
    revenue: Number(revenueByMonth.get(month) || 0),
  }));
  const defaultSelection = new Set(
    (defaultMonths || [])
      .filter(month => (revenueByMonth.get(month) || 0) > 0)
  );

  const overlay = document.createElement("div");
  overlay.className = "po-modal-backdrop";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "po-modal";
  modal.innerHTML = `
    <header class="po-modal-header">
      <h3>Umsatz übertragen</h3>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
    <div class="po-modal-body">
      <p class="muted">Wähle die Monate aus, deren Prognose-Umsatz in den Tab <strong>Eingaben</strong> übertragen werden soll.</p>
      <div class="forecast-transfer-actions">
        <button class="btn secondary" type="button" data-select-all>Alle mit Umsatz</button>
        <button class="btn secondary" type="button" data-clear>Auswahl leeren</button>
      </div>
      <div class="forecast-transfer-list">
        ${monthEntries.map(entry => {
          const isDisabled = !Number.isFinite(entry.revenue) || entry.revenue <= 0;
          const isChecked = defaultSelection.has(entry.month);
          return `
            <label class="forecast-transfer-row ${isDisabled ? "is-disabled" : ""}">
              <input type="checkbox" data-month="${entry.month}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""} />
              <span>${entry.month}</span>
              <span class="muted">${formatCurrency(entry.revenue)} €</span>
            </label>
          `;
        }).join("")}
      </div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-transfer disabled>Übertragen</button>
    </footer>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) closeModal();
  });
  modal.querySelector("[data-close]").addEventListener("click", closeModal);
  modal.querySelector("[data-cancel]").addEventListener("click", closeModal);

  const transferBtn = modal.querySelector("[data-transfer]");
  const monthCheckboxes = Array.from(modal.querySelectorAll('input[data-month]'));

  function updateTransferState() {
    const checked = monthCheckboxes.some(input => input.checked);
    transferBtn.disabled = !checked;
  }

  modal.querySelector("[data-select-all]").addEventListener("click", () => {
    monthCheckboxes.forEach(input => {
      if (!input.disabled) input.checked = true;
    });
    updateTransferState();
  });

  modal.querySelector("[data-clear]").addEventListener("click", () => {
    monthCheckboxes.forEach(input => { input.checked = false; });
    updateTransferState();
  });

  monthCheckboxes.forEach(input => {
    input.addEventListener("change", updateTransferState);
  });

  updateTransferState();

  transferBtn.addEventListener("click", () => {
    const selectedMonths = monthCheckboxes
      .filter(input => input.checked)
      .map(input => input.getAttribute("data-month"))
      .filter(Boolean);
    if (!selectedMonths.length) return;
    const st = loadAppState();
    ensureForecastContainers(st);
    if (!Array.isArray(st.incomings)) st.incomings = [];
    const lastPayoutRow = st.incomings.slice().reverse().find(row => row?.payoutPct != null && String(row.payoutPct).trim() !== "");
    const defaultPayout = lastPayoutRow?.payoutPct ?? "0";
    const updated = [];
    selectedMonths.forEach(month => {
      const revenue = Number(revenueByMonth.get(month) || 0);
      const formatted = formatCurrency(revenue);
      const idx = st.incomings.findIndex(row => row?.month === month);
      if (idx >= 0) {
        const row = st.incomings[idx];
        row.revenueEur = formatted;
        if (!row.payoutPct) row.payoutPct = defaultPayout;
        row.source = "forecast";
      } else {
        st.incomings.push({
          month,
          revenueEur: formatted,
          payoutPct: defaultPayout,
          source: "forecast",
        });
      }
      updated.push(month);
    });
    st.incomings.sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));
    commitAppState(st);
    showToast(`Umsatz übertragen: ${updated.length} Monat${updated.length === 1 ? "" : "e"}.`);
    closeModal();
    render(host);
  });
}

function openVentoryImportModal(host) {
  const overlay = document.createElement('div');
  overlay.className = 'po-modal-backdrop';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const modal = document.createElement('div');
  modal.className = 'po-modal';
  modal.innerHTML = `
    <header class="po-modal-header">
      <h3>VentoryOne Import</h3>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
    <div class="po-modal-body">
      <div class="form-grid">
        <label class="field">
          <span>Datei (.xls/.xlsx)</span>
          <input type="file" accept=".xls,.xlsx" data-file />
        </label>
        <label class="toggle">
          <input type="checkbox" data-only-active checked />
          <span>Nur aktive SKUs (Status = Aktiviert)</span>
        </label>
        <div class="field">
          <span>Import-Modus</span>
          <label class="radio">
            <input type="radio" name="import-mode" value="overwrite" checked />
            <span>Overwrite</span>
          </label>
          <label class="radio">
            <input type="radio" name="import-mode" value="merge" />
            <span>Merge</span>
          </label>
        </div>
      </div>
      <div class="panel preview-panel" data-preview hidden>
        <h4>Preview</h4>
        <div class="preview-stats" data-preview-stats></div>
        <div class="preview-warnings" data-preview-warnings></div>
        <div class="preview-unknown" data-preview-unknown></div>
      </div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-import disabled>Importieren</button>
    </footer>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', ev => {
    if (ev.target === overlay) closeModal();
  });
  modal.querySelector('[data-close]').addEventListener('click', closeModal);
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

  const fileInput = modal.querySelector('[data-file]');
  const previewPanel = modal.querySelector('[data-preview]');
  const previewStats = modal.querySelector('[data-preview-stats]');
  const previewWarnings = modal.querySelector('[data-preview-warnings]');
  const previewUnknown = modal.querySelector('[data-preview-unknown]');
  const importBtn = modal.querySelector('[data-import]');
  const onlyActiveToggle = modal.querySelector('[data-only-active]');

  let parsed = null;

  function renderPreview() {
    if (!parsed) return;
    const { preview } = parsed;
    previewPanel.hidden = false;
    previewStats.innerHTML = `
      <p>SKUs erkannt: <strong>${preview.skuCount}</strong></p>
      <p>Monate erkannt: <strong>${preview.monthCount}</strong></p>
      <p>Forecast-Zellen: <strong>${preview.cellCount}</strong></p>
    `;
    previewWarnings.innerHTML = preview.warnings.length
      ? `<p class="text-muted">Hinweise:</p><ul>${preview.warnings.map(w => `<li>${w}</li>`).join('')}</ul>`
      : '';
    previewUnknown.innerHTML = preview.unknownSkus.length
      ? `<p class="text-muted">Unbekannte SKUs:</p><ul>${preview.unknownSkus.map(sku => `<li>${sku}</li>`).join('')}</ul>`
      : '';
    importBtn.disabled = !preview.valid;
  }

  async function parseFile(file) {
    const rows = await parseExcelFile(file);
    const { records, warnings, months } = parseVentoryRows(rows);
    if (!records.length) return { error: 'Keine gültigen Zeilen gefunden.' };
    const st = loadAppState();
    const products = Array.isArray(st.products) ? st.products : [];
    const skuSet = new Set(products.map(prod => String(prod.sku || '').trim()));
    const unknownSkus = [...new Set(records.map(rec => rec.sku).filter(sku => !skuSet.has(sku)))];
    const onlyActive = onlyActiveToggle.checked;
    const normalizedRecords = records.filter(rec => {
      if (!onlyActive) return true;
      const status = String(rec.status || '').trim().toLowerCase();
      return status === 'aktiviert' || status === 'aktiv';
    });
    const importableCount = normalizedRecords.filter(rec => skuSet.has(rec.sku)).length;
    const preview = {
      skuCount: new Set(normalizedRecords.map(rec => rec.sku)).size,
      monthCount: new Set(normalizedRecords.map(rec => rec.month)).size,
      cellCount: normalizedRecords.length,
      unknownSkus,
      warnings,
      valid: importableCount > 0,
    };
    return { records: normalizedRecords, preview };
  }

  fileInput.addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    parsed = null;
    importBtn.disabled = true;
    previewPanel.hidden = true;
    try {
      parsed = await parseFile(file);
    } catch (err) {
      console.error(err);
      alert('Datei konnte nicht gelesen werden. Bitte erneut versuchen.');
      return;
    }
    if (parsed && parsed.error) {
      alert(parsed.error);
      return;
    }
    renderPreview();
  });

  onlyActiveToggle.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    parsed = await parseFile(file);
    renderPreview();
  });

  importBtn.addEventListener('click', () => {
    if (!parsed || !parsed.records || !parsed.records.length) return;
    const mode = (modal.querySelector('input[name="import-mode"]:checked') || {}).value || 'overwrite';
    const st = loadAppState();
    ensureForecastContainers(st);
    const products = Array.isArray(st.products) ? st.products : [];
    const skuSet = new Set(products.map(prod => String(prod.sku || '').trim()));
    const now = new Date().toISOString();
    const skippedUnknown = new Set();
    const updates = [];

    parsed.records.forEach(rec => {
      if (!skuSet.has(rec.sku)) {
        skippedUnknown.add(rec.sku);
        return;
      }
      updates.push(rec);
    });

    if (mode === "overwrite") {
      updates.forEach(rec => {
        if (!st.forecast.forecastImport[rec.sku]) st.forecast.forecastImport[rec.sku] = {};
        st.forecast.forecastImport[rec.sku][rec.month] = {
          units: rec.units,
          revenueEur: rec.revenueEur,
          profitEur: rec.profitEur,
        };
      });
    } else {
      updates.forEach(rec => {
        if (!st.forecast.forecastImport[rec.sku]) st.forecast.forecastImport[rec.sku] = {};
        if (!st.forecast.forecastImport[rec.sku][rec.month]) {
          st.forecast.forecastImport[rec.sku][rec.month] = {
            units: rec.units,
            revenueEur: rec.revenueEur,
            profitEur: rec.profitEur,
          };
        }
      });
    }

    st.forecast.lastImportAt = now;
    st.forecast.importSource = "ventoryone";
    commitAppState(st);
    showToast(`Import erfolgreich: ${updates.length} Werte (${skippedUnknown.size} unbekannte SKUs übersprungen).`);
    closeModal();
    render(host);
  });
}

function openVentoryCsvImportModal(host) {
  const overlay = document.createElement("div");
  overlay.className = "po-modal-backdrop";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "po-modal";
  modal.innerHTML = `
    <header class="po-modal-header">
      <h3>${CSV_IMPORT_LABEL}</h3>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
    <div class="po-modal-body">
      <div class="form-grid">
        <label class="field">
          <span>Datei (.csv)</span>
          <input type="file" accept=".csv" data-file />
        </label>
        <label class="toggle">
          <input type="checkbox" data-overwrite checked />
          <span>Overwrite existing forecast values</span>
        </label>
      </div>
      <div class="panel preview-panel" data-summary hidden></div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-import disabled>Importieren</button>
    </footer>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) closeModal();
  });
  modal.querySelector("[data-close]").addEventListener("click", closeModal);
  modal.querySelector("[data-cancel]").addEventListener("click", closeModal);

  const fileInput = modal.querySelector("[data-file]");
  const overwriteToggle = modal.querySelector("[data-overwrite]");
  const importBtn = modal.querySelector("[data-import]");
  const summaryPanel = modal.querySelector("[data-summary]");

  let parsed = null;

  function renderSummary(summary) {
    summaryPanel.hidden = false;
    summaryPanel.innerHTML = `
      <h4>Import Summary</h4>
      <p>SKUs: <strong>${summary.skuCount}</strong></p>
      <p>Monate: <strong>${summary.monthCount}</strong></p>
      <p>Datensätze: <strong>${summary.recordCount}</strong></p>
      <p>Ignorierte Zeilen (Gesamt): <strong>${summary.ignoredTotal}</strong></p>
      ${summary.unknownSkus.length
        ? `<p class="text-muted">Unbekannte SKUs:</p><ul>${summary.unknownSkus.map(sku => `<li>${sku}</li>`).join("")}</ul>`
        : ""}
      ${summary.warnings.length
        ? `<p class="text-muted">Hinweise:</p><ul>${summary.warnings.map(msg => `<li>${msg}</li>`).join("")}</ul>`
        : ""}
    `;
  }

  fileInput.addEventListener("change", async ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    parsed = null;
    importBtn.disabled = true;
    summaryPanel.hidden = true;
    try {
      const text = await file.text();
      const result = parseVentoryCsv(text);
      if (result.error) {
        alert(result.error);
        return;
      }
      parsed = result;
      importBtn.disabled = !result.records.length;
    } catch (err) {
      console.error(err);
      alert("Datei konnte nicht gelesen werden. Bitte erneut versuchen.");
    }
  });

  importBtn.addEventListener("click", () => {
    if (!parsed || !parsed.records || !parsed.records.length) return;
    const st = loadAppState();
    ensureForecastContainers(st);
    const products = Array.isArray(st.products) ? st.products : [];
    const skuSet = new Set(products.map(prod => String(prod.sku || "").trim()));
    const now = new Date().toISOString();
    const overwriting = overwriteToggle.checked;
    const unknownSkus = new Set();
    const updates = [];

    parsed.records.forEach(rec => {
      if (!skuSet.has(rec.sku)) {
        unknownSkus.add(rec.sku);
        return;
      }
      updates.push(rec);
    });

    if (overwriting) {
      updates.forEach(rec => {
        if (!st.forecast.forecastImport[rec.sku]) st.forecast.forecastImport[rec.sku] = {};
        st.forecast.forecastImport[rec.sku][rec.month] = {
          units: rec.units,
          revenueEur: rec.revenueEur,
          profitEur: rec.profitEur,
        };
      });
    } else {
      updates.forEach(rec => {
        if (!st.forecast.forecastImport[rec.sku]) st.forecast.forecastImport[rec.sku] = {};
        if (!st.forecast.forecastImport[rec.sku][rec.month]) {
          st.forecast.forecastImport[rec.sku][rec.month] = {
            units: rec.units,
            revenueEur: rec.revenueEur,
            profitEur: rec.profitEur,
          };
        }
      });
    }

    st.forecast.lastImportAt = now;
    st.forecast.importSource = "ventoryone";
    commitAppState(st);

    const summary = {
      skuCount: new Set(parsed.records.map(rec => rec.sku)).size,
      monthCount: new Set(parsed.records.map(rec => rec.month)).size,
      recordCount: parsed.records.length,
      ignoredTotal: parsed.ignoredTotal || 0,
      unknownSkus: Array.from(unknownSkus),
      warnings: parsed.warnings || [],
    };
    renderSummary(summary);
    showToast(`Import erfolgreich: ${updates.length} Datensätze.`);
    render(host);
  });
}

export default function mount(el) {
  render(el);
  const unsubscribe = addStateListener(() => render(el));
  return { cleanup() { unsubscribe(); } };
}
