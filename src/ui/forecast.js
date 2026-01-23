import { loadState, saveState, addStateListener } from '../data/storageLocal.js';

function parseNumberDE(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalised = cleaned;
  if (decimalIndex >= 0) {
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, '');
    normalised = `${integer}.${fraction}`;
  } else {
    normalised = cleaned.replace(/[.,]/g, '');
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

function formatNumberDE(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
  const monthPattern = /^\d{4}-\d{2}$/;
  const hasMonthCols = header.some(h => monthPattern.test(h));
  const records = [];
  if (hasMonthCols) {
    const monthCols = header.map((h, idx) => (monthPattern.test(h) ? { month: h, idx } : null)).filter(Boolean);
    const skuIdx = header.findIndex(h => h === 'sku');
    const aliasIdx = header.findIndex(h => h === 'alias' || h === 'produkt');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const sku = cols[skuIdx >= 0 ? skuIdx : 0]?.trim();
      if (!sku) continue;
      const alias = aliasIdx >= 0 ? cols[aliasIdx]?.trim() : '';
      monthCols.forEach(col => {
        const raw = cols[col.idx] || '';
        const qty = parseInt(String(raw).replace(/\D/g, ''), 10);
        if (Number.isNaN(qty)) return;
        records.push({ sku, alias, month: col.month, units: qty });
      });
    }
  } else {
    const skuIdx = header.findIndex(h => h === 'sku');
    const monthIdx = header.findIndex(h => h === 'monat' || h === 'month');
    const qtyIdx = header.findIndex(h => h === 'menge' || h === 'qty' || h === 'quantity');
    const priceIdx = header.findIndex(h => h === 'preis' || h === 'price' || h === 'priceeur');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const sku = cols[skuIdx >= 0 ? skuIdx : 0]?.trim();
      const monthRaw = cols[monthIdx >= 0 ? monthIdx : 1]?.trim();
      const qty = parseInt(cols[qtyIdx >= 0 ? qtyIdx : 2] || '0', 10);
      if (!sku || !monthRaw || Number.isNaN(qty)) continue;
      const price = priceIdx >= 0 ? parseNumberDE(cols[priceIdx]) : null;
      const ymMatch = monthRaw.match(/^(\d{4})[-/.](\d{2})/);
      const month = ymMatch ? `${ymMatch[1]}-${ymMatch[2]}` : monthRaw;
      records.push({ sku, month, units: qty, revenueEur: price });
    }
  }
  return records;
}

function readAsBinaryString(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsBinaryString(file);
  });
}

async function parseExcelFile(file) {
  const [{ default: XLSX }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm'),
  ]);

  // Versuche zuerst den Array-Pfad (schnell, modern), dann eine binäre
  // Repräsentation für ältere XLS-Dateien oder Browser, die arrayBuffer
  // nicht sauber an XLSX liefern.
  let workbook;
  let primaryError;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch (err) {
    primaryError = err;
  }

  if (!workbook) {
    try {
      const binary = await readAsBinaryString(file);
      workbook = XLSX.read(binary, { type: 'binary' });
    } catch (fallbackErr) {
      console.error('Excel-Import fehlgeschlagen', primaryError, fallbackErr);
      throw fallbackErr;
    }
  }

  if (!workbook?.SheetNames?.length) {
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

function parseVentoryMonth(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const match = text.match(/Erwartete Verkäufe\s+([A-Za-zÄÖÜäöüß\.]+)\s+(\d{4})/i);
  if (!match) return null;
  const monthRaw = match[1].replace('.', '').toLowerCase();
  const year = match[2];
  const monthMap = {
    jan: '01',
    februar: '02',
    feb: '02',
    märz: '03',
    maerz: '03',
    mrz: '03',
    marz: '03',
    apr: '04',
    mai: '05',
    jun: '06',
    juni: '06',
    jul: '07',
    juli: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    okt: '10',
    nov: '11',
    dez: '12',
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
    const sub = [row1?.[idx], row1?.[idx + 1], row1?.[idx + 2]].map(normalizeHeader);
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
  const row0 = rows?.[0] || [];
  const row1 = rows?.[1] || [];
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
        units: unitsVal == null ? null : Math.round(unitsVal),
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
    const units = item.units ?? item.qty ?? 0;
    row.values[item.month] = units;
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
    items.push({ sku, month, units: qty, qty, source: 'manual', updatedAt: new Date().toISOString() });
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
        <p class="text-muted">VentoryOne-Import, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <button class="btn secondary" type="button" data-ventory-import>VentoryOne Import</button>
        <label class="toggle">
          <input type="checkbox" ${state.forecast.settings.useForecast ? 'checked' : ''} data-forecast-toggle />
          <span>Umsatz aus Prognose übernehmen</span>
        </label>
      </div>
    </header>
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

  wrap.querySelector('[data-ventory-import]').addEventListener('click', () => {
    openVentoryImportModal(el);
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
    const st = loadState();
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
    const file = ev.target.files?.[0];
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
    if (parsed?.error) {
      alert(parsed.error);
      return;
    }
    renderPreview();
  });

  onlyActiveToggle.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    parsed = await parseFile(file);
    renderPreview();
  });

  importBtn.addEventListener('click', () => {
    if (!parsed?.records?.length) return;
    const mode = modal.querySelector('input[name="import-mode"]:checked')?.value || 'overwrite';
    const st = loadState();
    ensureForecastContainers(st);
    const products = Array.isArray(st.products) ? st.products : [];
    const skuSet = new Set(products.map(prod => String(prod.sku || '').trim()));
    const now = new Date().toISOString();
    const updates = new Map();
    const skippedUnknown = new Set();

    parsed.records.forEach(rec => {
      if (!skuSet.has(rec.sku)) {
        skippedUnknown.add(rec.sku);
        return;
      }
      const key = `${rec.sku}__${rec.month}`;
      const product = products.find(prod => String(prod.sku || '').trim() === rec.sku);
      updates.set(key, {
        sku: rec.sku,
        alias: product?.alias || rec.alias || '',
        month: rec.month,
        units: rec.units,
        qty: rec.units,
        revenueEur: rec.revenueEur,
        profitEur: rec.profitEur,
        source: 'ventoryone',
        importedAt: now,
        updatedAt: now,
      });
    });

    const nextItems = [];
    if (mode === 'overwrite') {
      st.forecast.items.forEach(item => {
        const key = `${item.sku}__${item.month}`;
        if (!updates.has(key)) nextItems.push(item);
      });
      updates.forEach(value => nextItems.push(value));
    } else {
      const itemMap = new Map(st.forecast.items.map(item => [`${item.sku}__${item.month}`, { ...item }]));
      updates.forEach((value, key) => {
        const existing = itemMap.get(key) || { sku: value.sku, month: value.month };
        const merged = {
          ...existing,
          alias: value.alias || existing.alias,
          units: value.units ?? existing.units,
          qty: value.units ?? existing.qty,
          revenueEur: value.revenueEur ?? existing.revenueEur,
          profitEur: value.profitEur ?? existing.profitEur,
          source: 'ventoryone',
          importedAt: value.importedAt,
          updatedAt: now,
        };
        itemMap.set(key, merged);
      });
      itemMap.forEach(item => nextItems.push(item));
    }

    st.forecast.items = nextItems;
    saveState(st);
    showToast(`Import erfolgreich: ${updates.size} Werte (${skippedUnknown.size} unbekannte SKUs übersprungen).`);
    closeModal();
    render(host);
  });
}

export default function mount(el) {
  render(el);
  const unsubscribe = addStateListener(() => render(el));
  return { cleanup() { unsubscribe(); } };
}
