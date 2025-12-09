import { loadState, saveState, addStateListener } from '../data/storageLocal.js';

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
        const qty = parseInt(raw.replace(/\D/g, ''), 10);
        if (Number.isNaN(qty)) return;
        records.push({ sku, alias, month: col.month, qty });
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
      const price = priceIdx >= 0 ? parseNumberDE(cols[priceIdx]) : 0;
      const ymMatch = monthRaw.match(/^(\d{4})[-/.](\d{2})/);
      const month = ymMatch ? `${ymMatch[1]}-${ymMatch[2]}` : monthRaw;
      records.push({ sku, month, qty, priceEur: price });
    }
  }
  return records;
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
      <input type="file" accept=".csv,.xlsx" data-forecast-file />
      <p class="text-muted small">Bitte Ventory-Export als CSV oder XLSX hochladen.</p>
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

  wrap.querySelector('[data-forecast-file]').addEventListener('change', ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      alert('Bitte als CSV exportieren und erneut hochladen.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result || '';
      const records = parseCsv(String(text));
      if (!records.length) {
        alert('Keine gültigen Zeilen gefunden.');
        return;
      }
      const st = loadState();
      ensureForecastContainers(st);
      const map = new Map();
      records.forEach(rec => {
        const key = `${rec.sku}__${rec.month}`;
        const next = { sku: rec.sku, alias: rec.alias, month: rec.month, qty: Number(rec.qty || 0) || 0, priceEur: rec.priceEur || 0, source: 'ventory', importId: Date.now() };
        map.set(key, next);
      });
      const existing = st.forecast.items.filter(it => !map.has(`${it.sku}__${it.month}`));
      st.forecast.items = [...existing, ...map.values()];
      saveState(st);
      render(el);
    };
    reader.readAsText(file, 'utf-8');
  });
}

export default function mount(el) {
  render(el);
  const unsubscribe = addStateListener(() => render(el));
  return { cleanup() { unsubscribe(); } };
}
