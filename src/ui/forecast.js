import { loadState, saveState, addStateListener } from '../data/storageLocal.js';
import { parseForecastJsonPayload, formatEuroDE, normalizeMonthToken } from '../domain/forecastImport.js';

function parseNumberDE(value) {
  if (value == null) return 0;
  const cleaned = String(value).trim().replace(/€/g, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatNumberDE(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatQty(value) {
  return `${formatNumberDE(value)} Stk`;
}

function formatEuroWithSymbol(value) {
  return `${formatEuroDE(value)} €`;
}

function detectMonthFromCell(cell) {
  if (!cell) return null;
  const trimmed = String(cell).trim().replace(/\s+/g, " ");
  const direct = normalizeMonthToken(trimmed);
  if (direct) return direct;
  const ymMatch = trimmed.match(/(\d{4})[-/.](\d{2})/);
  if (ymMatch) return `${ymMatch[1]}-${ymMatch[2]}`;
  const nameYearLoose = trimmed.match(/([A-Za-zÄÖÜäöü\.]{2,})[^0-9]{0,5}(\d{4})/);
  if (nameYearLoose) {
    const cleanedName = nameYearLoose[1].replace(/[^A-Za-zÄÖÜäöü]/g, "");
    const token = `${cleanedName} ${nameYearLoose[2]}`;
    const norm = normalizeMonthToken(token);
    if (norm) return norm;
  }
  return null;
}

function calcRevenueFromGross(qty, priceGross, showGross, vatRate) {
  if (priceGross == null) return null;
  const base = Number(priceGross) || 0;
  const effective = showGross ? base : base / (1 + vatRate);
  return qty * effective;
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.length);
  if (!lines.length) return { records: [], warnings: [] };

  const firstNonEmpty = lines.find(line => line.trim().length) || '';
  const delimiter = firstNonEmpty.includes(';') ? ';' : ',';
  const rows = lines.map(line => parseCsvLine(line, delimiter));

  const headerIdx = rows.findIndex(r => r.some(cell => String(cell || '').trim().toLowerCase() === 'sku'));
  if (headerIdx === -1) throw new Error("Spalte ‘SKU’ nicht gefunden. Bitte Datei prüfen oder Spalten im Wizard zuordnen.");

  const headerRaw = rows[headerIdx].map(h => String(h ?? '').trim());
  const headerLower = headerRaw.map(h => h.toLowerCase());
  const maxCols = Math.max(...rows.map(r => r.length));

  const monthByCol = Array(maxCols).fill(null);
  let currentMonth = null;
  for (let r = 0; r <= headerIdx; r++) {
    const line = rows[r];
    for (let c = 0; c < maxCols; c++) {
      const token = line[c] ?? '';
      const month = detectMonthFromCell(token);
      if (month) {
        currentMonth = month;
        monthByCol[c] = month;
      } else if (currentMonth && !monthByCol[c]) {
        monthByCol[c] = currentMonth;
      }
    }
  }

  const skuIdx = headerLower.findIndex(h => h === 'sku');
  const aliasIdx = headerLower.findIndex(h => h === 'alias' || h === 'produkt' || h === 'produktname');

  const qtyCols = [];
  for (let c = 0; c < maxCols; c++) {
    const label = (headerLower[c] || '').trim();
    const month = monthByCol[c];
    const isQty = ['einheiten', 'qty', 'menge', 'units'].some(key => label.includes(key));
    if (month && isQty) {
      qtyCols.push({ idx: c, month });
    }
  }

  if (!qtyCols.length) {
    throw new Error('Keine Monats-Spalten erkannt (Ventory). Gültig: YYYY-MM, YYYY/MM, MM-YYYY, MMM YYYY.');
  }

  const warnings = [];
  const records = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cols = rows[r].length ? rows[r] : [];
    const sku = (cols[skuIdx] || '').trim();
    if (!sku) continue;
    const alias = aliasIdx >= 0 ? (cols[aliasIdx] || '').trim() : '';
    qtyCols.forEach(col => {
      const raw = (cols[col.idx] || '').toString().trim();
      const cleaned = raw.replace(/[\s€]/g, '');
      const qtyVal = cleaned === '' || cleaned === '-' || cleaned === '—' ? 0 : parseNumberDE(cleaned);
      const valid = Number.isFinite(qtyVal) && qtyVal >= 0;
      if (!valid) {
        warnings.push(`Ungültige Menge in Zeile ${r + 1}, Spalte ${headerRaw[col.idx] || col.idx} → als 0 übernommen.`);
      }
      records.push({ sku, alias, month: col.month, qty: valid ? qtyVal : 0, source: 'ventory' });
    });
  }
  return { records, warnings };
}

const XLSX_CANDIDATES = [
  'https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
];

async function loadXlsxModule() {
  let lastError;
  for (const url of XLSX_CANDIDATES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const mod = await import(/* @vite-ignore */ url);
      return mod?.default ? mod : { default: mod };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('XLSX-Modul konnte nicht geladen werden');
}

async function parseExcelFile(file) {
  const [{ default: XLSX }, cpexcel] = await Promise.all([
    loadXlsxModule(),
    import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/cpexcel.full.mjs').catch(() => null),
  ]);

  if (cpexcel?.default && typeof XLSX.set_cptable === 'function') {
    XLSX.set_cptable(cpexcel.default);
  }

  let workbook;
  let primaryError;
  let compatibilityTried = false;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', dense: true, cellDates: true });
  } catch (err) {
    primaryError = err;
  }

  if (!workbook) {
    compatibilityTried = true;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
      workbook = XLSX.read(binary, { type: 'binary', dense: true, cellDates: true });
    } catch (manualErr) {
      console.error('Excel-Import fehlgeschlagen', primaryError, manualErr);
      throw new Error('Format .xls erkannt. Erster Leseversuch fehlgeschlagen – Kompatibilitätsmodus wird versucht …');
    }
  }

  if (!workbook?.SheetNames?.length) {
    throw new Error('Keine Tabellenblätter gefunden');
  }

  let sheetName = workbook.SheetNames[0];
  const skuSheet = workbook.SheetNames.find(name => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, blankrows: false });
    const headerLower = (rows[0] || []).map(cell => String(cell || '').trim().toLowerCase());
    return headerLower.includes('sku');
  });
  if (skuSheet) sheetName = skuSheet;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (!rows.length) throw new Error('Keine Daten im Arbeitsblatt gefunden.');

  const headerRaw = rows[0].map(cell => String(cell ?? '').trim());
  const headerLower = headerRaw.map(h => h.toLowerCase());
  const skuIdx = headerLower.findIndex(h => h === 'sku');
  if (skuIdx === -1) throw new Error("Spalte ‘SKU’ nicht gefunden. Bitte Datei prüfen oder Spalten im Wizard zuordnen.");

  const monthCols = headerLower
    .map((h, idx) => {
      if (/^\d{4}[-/]\d{2}$/.test(h)) {
        const [y, m] = h.split(/[-/]/);
        return { month: `${y}-${m}`, idx };
      }
      const asNumber = Number(headerRaw[idx]);
      if (Number.isFinite(asNumber) && asNumber > 0 && String(headerRaw[idx]).length <= 5) {
        const base = new Date(Date.UTC(1899, 11, 30));
        const dt = new Date(base.getTime() + (asNumber - 1) * 24 * 60 * 60 * 1000);
        const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
        return { month: ym, idx };
      }
      return null;
    })
    .filter(Boolean);

  if (!monthCols.length) throw new Error('Keine Monatsspalten erkannt. Erlaubt: YYYY-MM oder Excel-Datum.');

  const aliasIdx = headerLower.findIndex(h => h === 'alias' || h === 'produktname');
  const warnings = [];
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const sku = (row[skuIdx] || '').toString().trim();
    if (!sku) continue;
    const alias = aliasIdx >= 0 ? (row[aliasIdx] || '').toString().trim() : '';
    monthCols.forEach(col => {
      const raw = row[col.idx];
      const cleaned = raw == null ? '' : raw.toString().trim();
      const qty = cleaned === '' || cleaned === '-' || cleaned === '—' ? 0 : Number.parseInt(cleaned, 10);
      if (!Number.isInteger(qty) || qty < 0) {
        warnings.push(`Ungültige Menge in Zeile ${i + 1}, Spalte ${headerRaw[col.idx]} → als 0 übernommen.`);
        records.push({ sku, alias, month: col.month, qty: 0, source: 'ventory' });
        return;
      }
      records.push({ sku, alias, month: col.month, qty, source: 'ventory' });
    });
  }

  if (compatibilityTried && !records.length) {
    throw new Error('Excel-Datei konnte nicht gelesen werden');
  }

  return { records, warnings };
}

function parseVentoryJsonContent(obj) {
  return parseForecastJsonPayload(obj);
}

function stripBom(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\uFEFF/, '');
}

async function parseJsonFile(file) {
  let text = '';
  try {
    text = await file.text();
  } catch (err) {
    console.error('JSON-Text konnte nicht gelesen werden', err);
  }

  const tryParse = raw => {
    try {
      return JSON.parse(stripBom(raw));
    } catch (err) {
      return null;
    }
  };

  let json = tryParse(text);
  if (!json) {
    try {
      const buffer = await file.arrayBuffer();
      const decoded = new TextDecoder('windows-1252', { fatal: false }).decode(buffer);
      json = tryParse(decoded);
    } catch (err) {
      console.error('JSON-Fallback-Decode fehlgeschlagen', err);
    }
  }

  if (!json) {
    // Datei trägt evtl. die Endung .json, enthält aber XLS-Daten – versuche Excel-Parser.
    try {
      return await parseExcelFile(file);
    } catch (excelErr) {
      console.error('Excel-Fallback nach JSON-Fehler gescheitert', excelErr);
      throw new Error('JSON konnte nicht gelesen werden. Prüfe Datei oder Format.');
    }
  }

  try {
    return parseVentoryJsonContent(json);
  } catch (err) {
    // Wenn der Inhalt strukturell kein JSON im erwarteten Format ist, versuche Excel als letzten Ausweg.
    try {
      return await parseExcelFile(file);
    } catch (excelErr) {
      console.error('Excel-Fallback nach Parserfehler gescheitert', err, excelErr);
      throw err;
    }
  }
}

function monthSeries(state) {
  const months = [];
  const horizon = Number(state.settings?.horizonMonths || 18);
  const start = state.settings?.startMonth || '2025-01';
  const [y0, m0] = start.split('-').map(Number);
  for (let i = 0; i < horizon; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

function resolvePrice(state, sku, month) {
  if (!sku) return null;
  const defaults = state.forecast?.prices?.defaults || {};
  const byMonth = state.forecast?.prices?.byMonth || {};
  if (byMonth[sku] && byMonth[sku][month] != null) {
    const v = Number(byMonth[sku][month]);
    return Number.isFinite(v) ? v : null;
  }
  if (defaults[sku] != null) {
    const v = Number(defaults[sku]);
    return Number.isFinite(v) ? v : null;
  }
  const fallback = (state.forecast?.items || []).find(it => it?.sku === sku && it?.month === month && it.priceEur != null);
  if (fallback) {
    const v = Number(fallback.priceEur);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

const forecastUiPrefs = {
  search: '',
  year: 'all',
  showAlias: true,
  hideZero: false,
  heatmap: false,
  mode: 'units',
};

function renderTable(el, state, months) {
  const grouped = new Map();
  const manualMap = new Map((state.forecast?.manualSkus || []).map(entry => [entry.sku, entry.alias || '']));
  (state.forecast?.items || []).forEach(item => {
    const key = (item.sku || '').trim();
    if (!key) return;
    const row = grouped.get(key) || { sku: item.sku, alias: item.alias || manualMap.get(key) || '', values: {}, isManual: false };
    row.values[item.month] = item.qty ?? 0;
    if (item.source === 'manual' || manualMap.has(key)) row.isManual = true;
    grouped.set(key, row);
  });

  manualMap.forEach((alias, sku) => {
    if (!grouped.has(sku)) {
      grouped.set(sku, { sku, alias, values: {}, isManual: true });
    } else {
      const row = grouped.get(sku);
      row.alias = row.alias || alias;
      row.isManual = true;
    }
  });

  const filterTerm = forecastUiPrefs.search.trim().toLowerCase();
  const rows = Array.from(grouped.values()).filter(row => {
    if (!filterTerm) return true;
    return row.sku.toLowerCase().includes(filterTerm) || (row.alias || '').toLowerCase().includes(filterTerm);
  });

  const tbodyRows = rows.filter(row => {
    if (row.isManual) return true;
    if (!forecastUiPrefs.hideZero) return true;
    return months.some(m => (row.values[m] ?? 0) !== 0);
  });

  const mode = forecastUiPrefs.mode || 'units';
  const gross = Boolean(state.forecast?.settings?.grossRevenue);
  const vatRate = Number(state.forecast?.prices?.vatRate ?? state.forecast?.settings?.priceVatRate ?? 0.19) || 0;

  const table = document.createElement('div');
  table.className = `forecast-grid ${forecastUiPrefs.heatmap ? 'heatmap' : ''} ${mode}`;
  table.style.setProperty('--fg-months', months.length);

  // Header rows with year grouping
  const header = document.createElement('div');
  header.className = 'fg-head';
  const years = Array.from(new Set(months.map(m => m.split('-')[0])));
  const topRow = document.createElement('div');
  topRow.className = 'fg-row fg-top';
  const nameTop = document.createElement('div');
  nameTop.className = 'fg-cell fg-sku fg-sticky fg-group';
  nameTop.textContent = 'SKU';
  topRow.appendChild(nameTop);
  years.forEach(yr => {
    const monthsInYear = months.filter(m => m.startsWith(yr));
    const group = document.createElement('div');
    group.className = 'fg-cell fg-year';
    group.style.gridColumn = `span ${monthsInYear.length}`;
    group.textContent = yr;
    topRow.appendChild(group);
  });
  const sumTop = document.createElement('div');
  sumTop.className = 'fg-cell fg-sum fg-sticky-right';
  sumTop.textContent = 'Summe';
  topRow.appendChild(sumTop);
  header.appendChild(topRow);

  const monthRow = document.createElement('div');
  monthRow.className = 'fg-row fg-months';
  const skuLabel = document.createElement('div');
  skuLabel.className = 'fg-cell fg-sku fg-sticky';
  skuLabel.textContent = forecastUiPrefs.showAlias ? 'SKU / Alias' : 'SKU';
  monthRow.appendChild(skuLabel);
  months.forEach(m => {
    const cell = document.createElement('div');
    cell.className = 'fg-cell fg-month';
    cell.textContent = m.replace('-', '.');
    monthRow.appendChild(cell);
  });
  const sumLabel = document.createElement('div');
  sumLabel.className = 'fg-cell fg-sum fg-sticky-right';
  sumLabel.textContent = 'Σ';
  monthRow.appendChild(sumLabel);
  header.appendChild(monthRow);
  table.appendChild(header);

  const body = document.createElement('div');
  body.className = 'fg-body';

  const inputs = [];
  const maxHeat = Math.max(
    1,
    ...tbodyRows.flatMap(row => months.map(m => {
      const qty = Number(row.values[m] || 0);
      const price = resolvePrice(state, row.sku, m);
      const rev = calcRevenueFromGross(qty, price, gross, vatRate) || 0;
      return mode === 'revenue' ? rev : qty;
    })),
  );

  let missingPrices = 0;
  const manualRows = tbodyRows.filter(r => r.isManual);
  const importRows = tbodyRows.filter(r => !r.isManual);

  const renderSection = (rowsToRender, label, sectionClass) => {
    if (!rowsToRender.length) return { qty: 0, rev: 0, cols: {} };
    const sectionHead = document.createElement('div');
    sectionHead.className = `fg-section ${sectionClass || ''}`;
    sectionHead.textContent = label;
    body.appendChild(sectionHead);
    let idxOffset = inputs.length;
    let qtySum = 0;
    let revSum = 0;
    const colTotals = {};
    months.forEach(m => { colTotals[m] = { qty: 0, rev: 0 }; });

    rowsToRender.forEach((row, rowIdx) => {
      const tr = document.createElement('div');
      tr.className = 'fg-row fg-data';
      if (row.isManual) tr.classList.add('fg-manual');
      const skuCell = document.createElement('div');
      const defaultPrice = state.forecast?.prices?.defaults?.[row.sku];
      skuCell.className = 'fg-cell fg-sku fg-sticky';
      skuCell.innerHTML = `<div class="fg-sku-code">${row.sku}</div>${
        forecastUiPrefs.showAlias && row.alias ? `<div class="fg-alias">${row.alias}</div>` : ''
      }<button type="button" class="fg-price-chip" data-price-default="${row.sku}">${defaultPrice != null ? `${formatEuroDE(defaultPrice)} €` : 'Preis pflegen'}</button>`;
      tr.appendChild(skuCell);
      let rowQtySum = 0;
      let rowRevSum = 0;
      months.forEach((m, colIdx) => {
        const val = Number(row.values[m] || 0);
        rowQtySum += val;
        const price = resolvePrice(state, row.sku, m);
        const revenue = calcRevenueFromGross(val, price, gross, vatRate);
        if (revenue != null) rowRevSum += revenue;
        const cell = document.createElement('div');
        cell.className = 'fg-cell fg-month-cell';
        if (forecastUiPrefs.heatmap) {
          const metric = mode === 'revenue' ? (revenue || 0) : val;
          const level = Math.min(1, metric / maxHeat);
          cell.style.setProperty('--heat', level);
        }
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '0';
        input.value = val || '';
        input.dataset.sku = row.sku;
        input.dataset.month = m;
        input.dataset.row = String(rowIdx + idxOffset);
        input.dataset.col = String(colIdx);
        if (mode === 'units' || mode === 'split') {
          cell.appendChild(input);
          inputs.push(input);
        } else {
          input.tabIndex = -1;
          input.classList.add('fg-hidden');
          cell.appendChild(input);
        }

        if (mode === 'revenue' || mode === 'split') {
          const priceResolved = price == null ? 'Preis fehlt' : `${formatEuroDE(price)} €`;
          const revenueText = revenue == null ? '—' : formatEuroWithSymbol(revenue);
          const view = document.createElement('div');
          view.className = `fg-revenue ${revenue == null ? 'missing-price' : ''}`;
          view.innerHTML = `${mode === 'split' ? `<div class=\"fg-qty-val\">${formatQty(val)}</div>` : ''}<div class=\"fg-rev-val\">${revenueText}</div>`;
          cell.appendChild(view);
          const priceBtn = document.createElement('button');
          priceBtn.type = 'button';
          priceBtn.className = 'fg-price-btn';
          priceBtn.setAttribute('data-price-edit', row.sku);
          priceBtn.setAttribute('data-price-month', m);
          priceBtn.title = price == null ? 'Preis fehlt – klicken zum Pflegen' : `Preis: ${priceResolved}`;
          priceBtn.textContent = '€';
          cell.appendChild(priceBtn);
          if (price == null && val > 0) missingPrices += 1;
        }

        tr.appendChild(cell);
        colTotals[m].qty += val;
        colTotals[m].rev += revenue || 0;
      });
      const sumCell = document.createElement('div');
      sumCell.className = 'fg-cell fg-sum fg-sticky-right';
      if (mode === 'split') {
        sumCell.innerHTML = `<div class="fg-sum-qty">${formatQty(rowQtySum)}</div><div class="fg-sum-rev">${formatEuroWithSymbol(rowRevSum)}</div>`;
      } else if (mode === 'revenue') {
        sumCell.textContent = formatEuroWithSymbol(rowRevSum);
      } else {
        sumCell.textContent = formatQty(rowQtySum);
      }
      tr.appendChild(sumCell);
      body.appendChild(tr);
      qtySum += rowQtySum;
      revSum += rowRevSum;
    });

    const sectionTotal = document.createElement('div');
    sectionTotal.className = 'fg-row fg-total fg-section-total';
    const labelCell = document.createElement('div');
    labelCell.className = 'fg-cell fg-sku fg-sticky';
    labelCell.textContent = `${label} Summe`;
    sectionTotal.appendChild(labelCell);
    months.forEach(m => {
      const cell = document.createElement('div');
      cell.className = 'fg-cell fg-month fg-total-cell';
      if (mode === 'revenue') {
        cell.textContent = formatEuroWithSymbol(colTotals[m].rev);
      } else if (mode === 'split') {
        cell.innerHTML = `<div class="fg-sum-qty">${formatQty(colTotals[m].qty)}</div><div class="fg-sum-rev">${formatEuroWithSymbol(colTotals[m].rev)}</div>`;
      } else {
        cell.textContent = formatQty(colTotals[m].qty);
      }
      sectionTotal.appendChild(cell);
    });
    const totalCell = document.createElement('div');
    totalCell.className = 'fg-cell fg-sum fg-sticky-right';
    if (mode === 'split') {
      totalCell.innerHTML = `<div class="fg-sum-qty">${formatQty(qtySum)}</div><div class="fg-sum-rev">${formatEuroWithSymbol(revSum)}</div>`;
    } else if (mode === 'revenue') {
      totalCell.textContent = formatEuroWithSymbol(revSum);
    } else {
      totalCell.textContent = formatQty(qtySum);
    }
    sectionTotal.appendChild(totalCell);
    body.appendChild(sectionTotal);
    return { qty: qtySum, rev: revSum, cols: colTotals };
  };

  const importTotals = renderSection(importRows, 'Importierte Produkte');
  const manualTotals = renderSection(manualRows, 'Manuell hinzugefügt', 'fg-manual-head');

  table.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'fg-footer';
  const totalRow = document.createElement('div');
  totalRow.className = 'fg-row fg-total';
  const totalLabel = document.createElement('div');
  totalLabel.className = 'fg-cell fg-sku fg-sticky';
  totalLabel.textContent = 'Gesamt';
  totalRow.appendChild(totalLabel);
  let grandQty = 0;
  let grandRev = 0;
  months.forEach(m => {
    const colQty = (importTotals.cols?.[m]?.qty || 0) + (manualTotals.cols?.[m]?.qty || 0);
    const colRev = (importTotals.cols?.[m]?.rev || 0) + (manualTotals.cols?.[m]?.rev || 0);
    grandQty += colQty;
    grandRev += colRev;
    const cell = document.createElement('div');
    cell.className = 'fg-cell fg-month fg-total-cell';
    if (mode === 'revenue') {
      cell.textContent = formatEuroWithSymbol(colRev);
    } else if (mode === 'split') {
      cell.innerHTML = `<div class="fg-sum-qty">${formatQty(colQty)}</div><div class="fg-sum-rev">${formatEuroWithSymbol(colRev)}</div>`;
    } else {
      cell.textContent = formatQty(colQty);
    }
    totalRow.appendChild(cell);
  });
  const grandCell = document.createElement('div');
  grandCell.className = 'fg-cell fg-sum fg-sticky-right';
  if (mode === 'split') {
    grandCell.innerHTML = `<div class="fg-sum-qty">${formatQty(grandQty)}</div><div class="fg-sum-rev">${formatEuroWithSymbol(grandRev)}</div>`;
  } else if (mode === 'revenue') {
    grandCell.textContent = formatEuroWithSymbol(grandRev);
  } else {
    grandCell.textContent = formatQty(grandQty);
  }
  totalRow.appendChild(grandCell);
  footer.appendChild(totalRow);
  table.appendChild(footer);

  if ((mode === 'revenue' || mode === 'split') && missingPrices > 0) {
    const warn = document.createElement('div');
    warn.className = 'fg-price-warning';
    warn.textContent = `Preise fehlen für ${missingPrices} Zellen – bitte Preise pflegen.`;
    table.insertBefore(warn, header);
  }

  table.addEventListener('change', ev => {
    const input = ev.target.closest('input[data-sku]');
    if (!input) return;
    const sku = input.getAttribute('data-sku');
    const month = input.getAttribute('data-month');
    const qty = Number(input.value || 0) || 0;
    const st = loadState();
    ensureForecastContainers(st);
    const items = st.forecast.items.filter(it => !(it.sku === sku && it.month === month));
    items.push({ sku, month, qty, source: 'ventory' });
    st.forecast.items = items;
    saveState(st);
    render(el);
  });

  table.addEventListener('keydown', ev => {
    const input = ev.target.closest('input[data-row]');
    if (!input) return;
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    let next;
    if (ev.key === 'ArrowRight') next = inputs.find(i => Number(i.dataset.row) === row && Number(i.dataset.col) === col + 1);
    if (ev.key === 'ArrowLeft') next = inputs.find(i => Number(i.dataset.row) === row && Number(i.dataset.col) === col - 1);
    if (ev.key === 'ArrowDown') next = inputs.find(i => Number(i.dataset.row) === row + 1 && Number(i.dataset.col) === col);
    if (ev.key === 'ArrowUp') next = inputs.find(i => Number(i.dataset.row) === row - 1 && Number(i.dataset.col) === col);
    if (next) {
      ev.preventDefault();
      next.focus();
      next.select();
    }
  });

  const handlePriceUpdate = (sku, month, value) => {
    const parsed = parseNumberDE(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const st = loadState();
    ensureForecastContainers(st);
    if (month) {
      if (!st.forecast.prices.byMonth[sku]) st.forecast.prices.byMonth[sku] = {};
      st.forecast.prices.byMonth[sku][month] = parsed;
    } else {
      st.forecast.prices.defaults[sku] = parsed;
    }
    saveState(st);
    render(el);
  };

  table.addEventListener('click', ev => {
    const defBtn = ev.target.closest('[data-price-default]');
    if (defBtn) {
      const sku = defBtn.getAttribute('data-price-default');
      const current = resolvePrice(state, sku, months[0]) ?? state.forecast?.prices?.defaults?.[sku] ?? '';
      const next = prompt('Bruttopreis je Stück (EUR, inkl. USt)', current ? formatEuroDE(current) : '');
      if (next !== null) handlePriceUpdate(sku, null, next);
      return;
    }
    const editBtn = ev.target.closest('[data-price-edit]');
    if (editBtn) {
      const sku = editBtn.getAttribute('data-price-edit');
      const month = editBtn.getAttribute('data-price-month');
      const current = resolvePrice(state, sku, month);
      const next = prompt(`Bruttopreis für ${sku} – ${month.replace('-', '.')} (EUR, inkl. USt)`, current ? formatEuroDE(current) : '');
      if (next !== null) handlePriceUpdate(sku, month, next);
    }
  });

  const scroller = document.createElement('div');
  scroller.className = 'forecast-scroll';
  scroller.appendChild(table);
  return scroller;
}

function ensureForecastContainers(state) {
  if (!state.forecast || typeof state.forecast !== 'object') {
    state.forecast = { items: [], settings: { useForecast: false } };
  }
  if (!Array.isArray(state.forecast.items)) state.forecast.items = [];
  if (!state.forecast.settings || typeof state.forecast.settings !== 'object') {
    state.forecast.settings = { useForecast: false };
  }
  if (state.forecast.settings.grossRevenue == null) state.forecast.settings.grossRevenue = true;
  if (!state.forecast.prices || typeof state.forecast.prices !== 'object') {
    state.forecast.prices = { defaults: {}, byMonth: {}, vatRate: 0.19 };
  }
  if (!state.forecast.prices.defaults) state.forecast.prices.defaults = {};
  if (!state.forecast.prices.byMonth) state.forecast.prices.byMonth = {};
  if (!Array.isArray(state.forecast.manualSkus)) state.forecast.manualSkus = [];
}

function render(el) {
  const state = loadState();
  ensureForecastContainers(state);
  el.innerHTML = '';
  const wrap = document.createElement('section');
  wrap.className = 'panel';
  wrap.innerHTML = `
    <header class="panel__header">
      <div>
        <p class="eyebrow">Werkzeuge</p>
        <h1>Absatzprognose (Ventory)</h1>
        <p class="text-muted">CSV-Upload, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <label class="toggle">
          <input type="checkbox" ${state.forecast.settings.useForecast ? 'checked' : ''} data-forecast-toggle />
          <span>Umsatz aus Prognose übernehmen</span>
        </label>
      </div>
    </header>
    <div class="uploader">
      <input type="file" accept=".csv,.xls,.xlsx,.json" data-forecast-file />
      <p class="text-muted small">Bitte Ventory-Export als CSV, XLS, XLSX oder JSON hochladen.</p>
    </div>
    <div class="forecast-toolbar">
      <input type="search" placeholder="SKU oder Alias suchen" value="${forecastUiPrefs.search}" data-forecast-search />
      <label class="toggle">
        <input type="checkbox" ${forecastUiPrefs.hideZero ? 'checked' : ''} data-forecast-hidezero />
        <span>Nur Monate ≠ 0</span>
      </label>
      <label class="toggle">
        <input type="checkbox" ${forecastUiPrefs.showAlias ? 'checked' : ''} data-forecast-showalias />
        <span>Alias anzeigen</span>
      </label>
      <label class="toggle">
        <input type="checkbox" ${forecastUiPrefs.heatmap ? 'checked' : ''} data-forecast-heatmap />
        <span>Heatmap</span>
      </label>
      <div class="segmented" role="group" aria-label="Ansicht wählen">
        ${['units','revenue','split'].map(mode => `
          <button type="button" data-forecast-mode="${mode}" class="${forecastUiPrefs.mode === mode ? 'active' : ''}">
            ${mode === 'units' ? 'Absätze' : mode === 'revenue' ? 'Umsatz' : 'Split'}
          </button>
        `).join('')}
      </div>
      <label class="toggle">
        <input type="checkbox" ${state.forecast.settings.grossRevenue ? 'checked' : ''} data-forecast-gross />
        <span>Brutto anzeigen</span>
      </label>
      <label class="select-inline">
        <span>Jahr</span>
        <select data-forecast-year>
          <option value="all" ${forecastUiPrefs.year === 'all' ? 'selected' : ''}>Alle</option>
          ${Array.from(new Set(monthSeries(state).map(m => m.split('-')[0]))).map(yr => `
            <option value="${yr}" ${forecastUiPrefs.year === yr ? 'selected' : ''}>${yr}</option>
          `).join('')}
        </select>
      </label>
      <button type="button" class="btn" data-forecast-addmanual>Produkt manuell hinzufügen</button>
    </div>
  `;
  const monthsAll = monthSeries(state);
  const months = forecastUiPrefs.year === 'all' ? monthsAll : monthsAll.filter(m => m.startsWith(forecastUiPrefs.year));
  const tableHost = document.createElement('div');
  tableHost.className = 'forecast-table-wrap';
  tableHost.appendChild(renderTable(el, state, months));
  wrap.appendChild(tableHost);
  el.appendChild(wrap);

  wrap.querySelector('[data-forecast-toggle]').addEventListener('change', ev => {
    const st = loadState();
    ensureForecastContainers(st);
    st.forecast.settings.useForecast = ev.target.checked;
    saveState(st);
  });

  wrap.querySelector('[data-forecast-search]').addEventListener('input', ev => {
    forecastUiPrefs.search = ev.target.value || '';
    render(el);
  });

  wrap.querySelector('[data-forecast-hidezero]').addEventListener('change', ev => {
    forecastUiPrefs.hideZero = ev.target.checked;
    render(el);
  });

  wrap.querySelector('[data-forecast-showalias]').addEventListener('change', ev => {
    forecastUiPrefs.showAlias = ev.target.checked;
    render(el);
  });

  wrap.querySelector('[data-forecast-heatmap]').addEventListener('change', ev => {
    forecastUiPrefs.heatmap = ev.target.checked;
    render(el);
  });

  wrap.querySelectorAll('[data-forecast-mode]').forEach(btn => {
    btn.addEventListener('click', ev => {
      forecastUiPrefs.mode = ev.currentTarget.getAttribute('data-forecast-mode');
      render(el);
    });
  });

  wrap.querySelector('[data-forecast-gross]').addEventListener('change', ev => {
    const st = loadState();
    ensureForecastContainers(st);
    st.forecast.settings.grossRevenue = ev.target.checked;
    saveState(st);
    render(el);
  });

  wrap.querySelector('[data-forecast-year]').addEventListener('change', ev => {
    forecastUiPrefs.year = ev.target.value || 'all';
    render(el);
  });

  wrap.querySelector('[data-forecast-addmanual]').addEventListener('click', () => {
    const sku = prompt('Neue SKU (Pflicht)');
    if (!sku || !sku.trim()) return;
    const alias = prompt('Alias / Produktname (optional)') || '';
    const normalizedSku = sku.trim();
    const st = loadState();
    ensureForecastContainers(st);
    const existing = st.forecast.manualSkus.find(entry => entry.sku === normalizedSku);
    if (existing) {
      existing.alias = alias.trim() || existing.alias;
    } else {
      st.forecast.manualSkus.push({ sku: normalizedSku, alias: alias.trim() });
    }
    if (!st.forecast.items.some(it => it.sku === normalizedSku)) {
      const seedMonth = months[0] || normalizeMonthToken(st.settings?.startMonth) || '2025-01';
      st.forecast.items.push({ sku: normalizedSku, alias: alias.trim(), month: seedMonth, qty: 0, source: 'manual' });
    }
    saveState(st);
    render(el);
  });

  wrap.querySelector('[data-forecast-file]').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    let parsed = { records: [], warnings: [] };
    const importId = Date.now();
    try {
      if (lower.endsWith('.csv')) {
        const text = await file.text();
        parsed = parseCsv(String(text));
      } else if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
        parsed = await parseExcelFile(file);
      } else if (lower.endsWith('.json')) {
        parsed = await parseJsonFile(file);
      } else {
        alert('Bitte CSV, XLS, XLSX oder JSON hochladen.');
        return;
      }
    } catch (err) {
      console.error(err);
      const msg = err?.message || 'Datei konnte nicht gelesen werden. Bitte erneut versuchen.';
      alert(msg);
      return;
    }
    if (parsed.type === 'app-export') {
      if (!parsed.incomings?.length) {
        alert('Keine gültigen Zeilen gefunden.');
        return;
      }
      const st = loadState();
      ensureForecastContainers(st);
      st.incomings = parsed.incomings.map(row => ({
        month: row.month,
        revenueEur: formatEuroDE(row.revenueEur),
        payoutPct: row.payoutPct,
      }));
      if (parsed.settings?.startMonth) st.settings.startMonth = parsed.settings.startMonth;
      if (parsed.settings?.horizonMonths) st.settings.horizonMonths = parsed.settings.horizonMonths;
      saveState(st);
      const warnText = parsed.warnings?.length ? `\n${parsed.warnings.join('\n')}` : '';
      alert(`Umsätze aus JSON übernommen (${st.incomings.length} Monate).${warnText}`);
      render(el);
      return;
    }

    if (!parsed.records?.length) {
      alert('Keine gültigen Zeilen gefunden.');
      return;
    }
    const st = loadState();
    ensureForecastContainers(st);
    const map = new Map();
    parsed.records.forEach(rec => {
      const key = `${rec.sku}__${rec.month}`;
      const next = {
        sku: rec.sku,
        alias: rec.alias,
        month: rec.month,
        qty: Number(rec.qty || 0) || 0,
        priceEur: rec.priceEur ?? 0,
        source: rec.source || 'ventory',
        importId: rec.importId || importId,
      };
      map.set(key, next);
      if (rec.priceEur != null) {
        if (!st.forecast.prices.byMonth[rec.sku]) st.forecast.prices.byMonth[rec.sku] = {};
        st.forecast.prices.byMonth[rec.sku][rec.month] = Number(rec.priceEur) || 0;
      }
    });
    const existing = st.forecast.items.filter(it => !map.has(`${it.sku}__${it.month}`));
    st.forecast.items = [...existing, ...map.values()];
    saveState(st);
    if (parsed.warnings?.length) {
      alert(parsed.warnings.slice(0, 5).join('\n'));
    }
    alert(`Import abgeschlossen: ${map.size} Monatswerte.`);
    render(el);
  });
}

export default function mount(el) {
  render(el);
  const unsubscribe = addStateListener(() => render(el));
  return { cleanup() { unsubscribe(); } };
}
