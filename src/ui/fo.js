// src/ui/fo.js
// Forecast Orders (FO) Editor – analog zum PO-Editor

const STATE_KEY = 'amazon_fba_cashflow_v1';

// ---------- helpers ----------
function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}
function saveState(state) { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function ensureArray(v) { return Array.isArray(v) ? v : []; }

function parseEuro(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function formatEuro(num) {
  const f = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  return f.format(Number(num || 0));
}
function parsePercent(p) {
  if (p === '' || p === null || p === undefined) return 0;
  const n = Number(String(p).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + (days || 0));
  return d;
}
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function monthKeyFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function uuid() { return Math.random().toString(36).slice(2, 10); }

function calcAnchors(fo) {
  const od = fo.orderDate ? new Date(fo.orderDate) : new Date();
  const prodDone = addDays(od, Number(fo.prodDays || 0));
  const etd = prodDone; // simple convention
  const eta = addDays(etd, Number(fo.transitDays || 0));
  return { ORDER_DATE: od, PROD_DONE: prodDone, ETD: etd, ETA: eta };
}
function percentSumOk(milestones) {
  const total = milestones.reduce((acc, m) => acc + parsePercent(m.percent), 0);
  return Math.abs(total - 100) < 0.001; // Toleranz für 6,5% etc.
}

// ---------- view ----------
function renderList(container, state, selectedId) {
  const fos = ensureArray(state.fos);
  const rows = fos.map(fo => {
    const active = fo.id === selectedId ? ' class="row active"' : ' class="row"';
    const goods = formatEuro(parseEuro(fo.goodsEur));
    return `
      <div${active} data-id="${fo.id}">
        <div class="cell mono">${fo.foNo || '—'}</div>
        <div class="cell">${fo.orderDate || '—'}</div>
        <div class="cell">${goods}</div>
        <div class="cell">${Number(fo.prodDays || 0)} / ${Number(fo.transitDays || 0)}</div>
        <div class="cell">
          <button data-action="edit" data-id="${fo.id}">Bearbeiten</button>
          <button data-action="delete" data-id="${fo.id}" class="danger">Löschen</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Forecast Orders</h2>
        <div class="actions"><button id="fo-new">Neu</button></div>
      </div>
      <div class="table">
        <div class="row head">
          <div class="cell">FO-Nr.</div>
          <div class="cell">Bestelldatum</div>
          <div class="cell">Warenwert</div>
          <div class="cell">Prod/Transit (Tage)</div>
          <div class="cell">Aktionen</div>
        </div>
        ${rows || '<div class="row"><div class="cell" colspan="5">Keine Einträge</div></div>'}
      </div>
    </section>
  `;
}

function milestoneRow(m) {
  return `
    <div class="ms-row" data-msid="${m.id}">
      <input class="ms-label" type="text" placeholder="Label" value="${m.label || ''}" />
      <input class="ms-percent" type="text" inputmode="decimal" placeholder="%" value="${m.percent ?? ''}" />
      <select class="ms-anchor">
        <option value="ORDER_DATE"${m.anchor === 'ORDER_DATE' ? ' selected' : ''}>ORDER_DATE</option>
        <option value="PROD_DONE"${m.anchor === 'PROD_DONE' ? ' selected' : ''}>PROD_DONE</option>
        <option value="ETD"${m.anchor === 'ETD' ? ' selected' : ''}>ETD</option>
        <option value="ETA"${m.anchor === 'ETA' ? ' selected' : ''}>ETA</option>
      </select>
      <input class="ms-lag" type="number" step="1" value="${Number(m.lagDays || 0)}" />
      <button class="ms-del danger">×</button>
    </div>
  `;
}

function renderEditor(state, fo) {
  const milestones = ensureArray(fo.milestones);
  const anchors = calcAnchors(fo);
  const preview = milestones.map(m => {
    const base = anchors[m.anchor || 'ORDER_DATE'] || anchors.ORDER_DATE;
    const due = addDays(base, Number(m.lagDays || 0));
    const amount = parseEuro(fo.goodsEur) * (parsePercent(m.percent) / 100);
    return `
      <tr>
        <td>${m.label || ''}</td>
        <td>${String(m.percent || 0).toString().replace('.', ',')}%</td>
        <td>${m.anchor || 'ORDER_DATE'} + ${Number(m.lagDays || 0)}d</td>
        <td class="mono">${ymd(due)}</td>
        <td class="mono">${formatEuro(amount)}</td>
        <td class="mono">${monthKeyFromDate(due)}</td>
      </tr>
    `;
  }).join('');

  const sumPct = milestones.reduce((a, m) => a + parsePercent(m.percent), 0);
  const sumOk = Math.abs(sumPct - 100) < 0.001;

  return `
    <section class="panel">
      <h3>FO bearbeiten</h3>
      <div class="grid2">
        <label>FO-Nr.
          <input id="foNo" type="text" value="${fo.foNo || ''}" />
        </label>
        <label>Bestelldatum
          <input id="orderDate" type="date" value="${fo.orderDate || ''}" />
        </label>
        <label>Warenwert (EUR)
          <input id="goodsEur" inputmode="decimal" placeholder="8.000,00" value="${fo.goodsEur || ''}" />
        </label>
        <label>Transportart
          <select id="transport">
            <option value="sea"${fo.transport === 'sea' ? ' selected' : ''}>Sea</option>
            <option value="air"${fo.transport === 'air' ? ' selected' : ''}>Air</option>
            <option value="rail"${fo.transport === 'rail' ? ' selected' : ''}>Rail</option>
            <option value="express"${fo.transport === 'express' ? ' selected' : ''}>Express</option>
          </select>
        </label>
        <label>Produktion (Tage)
          <input id="prodDays" type="number" min="0" step="1" value="${Number(fo.prodDays || 0)}" />
        </label>
        <label>Transit (Tage)
          <input id="transitDays" type="number" min="0" step="1" value="${Number(fo.transitDays || 0)}" />
        </label>
      </div>

      <div class="milestones">
        <div class="milestones-head">
          <h4>Meilensteine <small>(Summe: <span id="sumPct">${String(sumPct).replace('.', ',')}</span>% ${sumOk ? '✅' : '❗'})</small></h4>
          <button id="ms-add">+ Meilenstein</button>
        </div>
        <div id="ms-list">
          ${milestones.map(m => milestoneRow(m)).join('')}
        </div>
      </div>

      <div class="preview">
        <h4>Vorschau Cash-Events</h4>
        <table class="wide">
          <thead>
            <tr><th>Label</th><th>%</th><th>Fälligkeit</th><th>Datum</th><th>Betrag</th><th>Monat</th></tr>
          </thead>
          <tbody>${preview || '<tr><td colspan="6">—</td></tr>'}</tbody>
        </table>
      </div>

      <div class="actions">
        <button id="fo-save" class="primary">Speichern</button>
        <button id="fo-cancel">Abbrechen</button>
      </div>
      ${sumOk ? '' : '<p class="warn">Die prozentuale Summe der Meilensteine muss <strong>100%</strong> ergeben.</p>'}
    </section>
  `;
}

function monthKeyFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

// ---------- main render ----------
export default function render(container) {
  const state = loadState();
  if (!state.fos) { state.fos = []; saveState(state); }

  let selectedId = (state._fo_ui && state._fo_ui.selectedId) || (state.fos[0]?.id) || null;

  function update() {
    const s = loadState();
    const listHtml = renderList(container, s, selectedId);
    const selected = ensureArray(s.fos).find(x => x.id === selectedId) || null;
    const editorHtml = selected ? renderEditor(s, selected) : '';
    container.innerHTML = `
      <div class="layout-two">
        <div>${listHtml}</div>
        <div>${editorHtml || '<section class="panel"><p>Wähle einen Eintrag oder lege einen neuen an.</p></section>'}</div>
      </div>
    `;
    bindList(container);
    bindEditor(container, selected);
  }

  function bindList(root) {
    const newBtn = root.querySelector('#fo-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      const s = loadState();
      const fo = {
        id: uuid(),
        foNo: '',
        orderDate: '',
        goodsEur: '',
        transport: 'sea',
        prodDays: 0,
        transitDays: 0,
        milestones: [
          { id: uuid(), label: 'Deposit', percent: 30, anchor: 'ORDER_DATE', lagDays: 0 },
          { id: uuid(), label: 'Balance', percent: 70, anchor: 'PROD_DONE', lagDays: 0 },
        ],
      };
      s.fos = ensureArray(s.fos);
      s.fos.push(fo);
      s._fo_ui = { selectedId: fo.id };
      saveState(s);
      window.dispatchEvent(new Event('state:changed'));
      selectedId = fo.id;
      update();
    });

    root.querySelectorAll('button[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedId = btn.getAttribute('data-id');
        const s = loadState();
        s._fo_ui = { selectedId };
        saveState(s);
        update();
      });
    });

    root.querySelectorAll('button[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const s = loadState();
        s.fos = ensureArray(s.fos).filter(x => x.id !== id);
        if (selectedId === id) selectedId = s.fos[0]?.id || null;
        saveState(s);
        window.dispatchEvent(new Event('state:changed'));
        update();
      });
    });
  }

  function bindEditor(root, fo) {
    if (!fo) return;

    const inputs = ['foNo', 'orderDate', 'goodsEur', 'transport', 'prodDays', 'transitDays'];
    inputs.forEach(id => {
      const el = root.querySelector('#' + id);
      if (el) el.addEventListener('input', () => {
        const s = loadState();
        const idx = ensureArray(s.fos).findIndex(x => x.id === fo.id);
        if (idx >= 0) {
          const rec = { ...s.fos[idx] };
          if (id === 'prodDays' || id === 'transitDays') rec[id] = Number(el.value || 0);
          else rec[id] = el.value;
          s.fos[idx] = rec;
          saveState(s);
          update(); // live preview
        }
      });
    });

    const msAdd = root.querySelector('#ms-add');
    if (msAdd) msAdd.addEventListener('click', () => {
      const s = loadState();
      const idx = ensureArray(s.fos).findIndex(x => x.id === fo.id);
      if (idx >= 0) {
        const rec = { ...s.fos[idx] };
        rec.milestones = ensureArray(rec.milestones);
        rec.milestones.push({ id: uuid(), label: '', percent: '', anchor: 'ORDER_DATE', lagDays: 0 });
        s.fos[idx] = rec;
        saveState(s);
        update();
      }
    });

    root.querySelectorAll('.ms-row').forEach(row => {
      const msid = row.getAttribute('data-msid');
      const on = (sel, ev, fn) => { const el = row.querySelector(sel); if (el) el.addEventListener(ev, fn); };

      on('.ms-label', 'input', e => updateMs(msid, { label: e.target.value }));
      on('.ms-percent', 'input', e => updateMs(msid, { percent: e.target.value }));
      on('.ms-anchor', 'change', e => updateMs(msid, { anchor: e.target.value }));
      on('.ms-lag', 'input', e => updateMs(msid, { lagDays: Number(e.target.value || 0) }));
      on('.ms-del', 'click', () => deleteMs(msid));
    });

    function updateMs(msid, patch) {
      const s = loadState();
      const idx = ensureArray(s.fos).findIndex(x => x.id === fo.id);
      if (idx < 0) return;
      const rec = { ...s.fos[idx] };
      rec.milestones = ensureArray(rec.milestones).map(m => (m.id === msid ? { ...m, ...patch } : m));
      s.fos[idx] = rec;
      saveState(s);
      update();
    }
    function deleteMs(msid) {
      const s = loadState();
      const idx = ensureArray(s.fos).findIndex(x => x.id === fo.id);
      if (idx < 0) return;
      const rec = { ...s.fos[idx] };
      rec.milestones = ensureArray(rec.milestones).filter(m => m.id !== msid);
      s.fos[idx] = rec;
      saveState(s);
      update();
    }

    const saveBtn = root.querySelector('#fo-save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const s = loadState();
      const idx = ensureArray(s.fos).findIndex(x => x.id === fo.id);
      if (idx < 0) return;
      const rec = { ...s.fos[idx] };

      // validations
      const ms = ensureArray(rec.milestones);
      if (!percentSumOk(ms)) { alert('Die Meilensteine summieren sich nicht auf 100%. Bitte anpassen.'); return; }
      if (!rec.orderDate) { alert('Bitte ein Bestelldatum setzen.'); return; }

      s.fos[idx] = rec;
      saveState(s);
      window.dispatchEvent(new Event('state:changed'));
      alert('FO gespeichert.');
      update();
    });

    const cancelBtn = root.querySelector('#fo-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { update(); });
  }

  update();
}
