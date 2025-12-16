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

function detectMonthFromCell(cell) {
  if (!cell) return null;
  const trimmed = String(cell).trim().replace(/\s+/g, " ");
  const direct = normalizeMonthToken(trimmed);
  if (direct) return direct;
  const ymMatch = trimmed.match(/(\d{4})[-/.](\d{2})/);
  if (ymMatch) return `${ymMatch[1]}-${ymMatch[2]}`;
  const nameYear = trimmed.match(/([A-Za-zÄÖÜäöü\.]+)\s+(\d{4})/);
  if (nameYear) {
    const cleanedName = nameYear[1].replace(/\./g, "");
    const token = `${cleanedName} ${nameYear[2]}`;
    const norm = normalizeMonthToken(token);
    if (norm) return norm;
  }
  return null;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.length);
  if (!lines.length) return { records: [], warnings: [] };

  const firstNonEmpty = lines.find(line => line.trim().length) || '';
  const delimiter = firstNonEmpty.includes(';') ? ';' : ',';
  const rows = lines.map(line => line.split(delimiter).map(col => col));

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
      const qty = cleaned === '' || cleaned === '-' || cleaned === '—' ? 0 : Number.parseInt(cleaned, 10);
      if (!Number.isInteger(qty) || qty < 0) {
        warnings.push(`Ungültige Menge in Zeile ${r + 1}, Spalte ${headerRaw[col.idx] || col.idx} → als 0 übernommen.`);
      }
      records.push({ sku, alias, month: col.month, qty: Number.isInteger(qty) && qty >= 0 ? qty : 0, source: 'ventory' });
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

function renderTable(el, state) {
  const months = [];
  const horizon = Number(state.settings?.horizonMonths || 18);
  const start = state.settings?.startMonth || '2025-01';
  const [y0, m0] = start.split('-').map(Number);
  for (let i = 0; i < horizon; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const grouped = new Map();
  (state.forecast?.items || []).forEach(item => {
    const key = (item.sku || '').trim();
    if (!key) return;
    const row = grouped.get(key) || { sku: item.sku, alias: item.alias || '', values: {} };
    row.values[item.month] = item.qty ?? 0;
    grouped.set(key, row);
  });
  const table = document.createElement('div');
  table.className = 'table forecast-table';
  const header = document.createElement('div');
  header.className = 'table-row head';
  header.innerHTML = `<div class="cell sku">SKU</div><div class="cell alias">Alias</div>${months
    .map(m => `<div class="cell month">${m}</div>`)
    .join('')}`;
  table.appendChild(header);
  grouped.forEach(row => {
    const tr = document.createElement('div');
    tr.className = 'table-row';
    tr.innerHTML = `<div class="cell sku">${row.sku}</div><div class="cell alias">${row.alias || ''}</div>`;
    months.forEach(m => {
      const val = row.values[m] ?? '';
      const cell = document.createElement('div');
      cell.className = 'cell month';
      cell.innerHTML = `<input type="number" min="0" data-sku="${row.sku}" data-month="${m}" value="${val}">`;
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });
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
  return table;
}

function ensureForecastContainers(state) {
  if (!state.forecast || typeof state.forecast !== 'object') {
    state.forecast = { items: [], settings: { useForecast: false } };
  }
  if (!Array.isArray(state.forecast.items)) state.forecast.items = [];
  if (!state.forecast.settings || typeof state.forecast.settings !== 'object') {
    state.forecast.settings = { useForecast: false };
  }
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
  `;
  const tableHost = document.createElement('div');
  tableHost.className = 'forecast-table-wrap';
  tableHost.appendChild(renderTable(el, state));
  wrap.appendChild(tableHost);
  el.appendChild(wrap);

  wrap.querySelector('[data-forecast-toggle]').addEventListener('change', ev => {
    const st = loadState();
    ensureForecastContainers(st);
    st.forecast.settings.useForecast = ev.target.checked;
    saveState(st);
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
