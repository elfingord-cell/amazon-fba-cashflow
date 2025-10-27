// FBA-CF-0027 — Local Storage Layer (schlank, mit Listenern)
export const STORAGE_KEY = "amazon_fba_cashflow_v1";

function parseEuro(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatEuro(value) {
  const num = Number(parseEuro(value));
  return Number.isFinite(num)
    ? num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
}

const defaults = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
    openingBalance: "50.000,00",
    fxRate: "1,08",
    fxFeePct: "0,5",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 14,
  },
  incomings: [ { month:"2025-02", revenueEur:"20.000,00", payoutPct:"100" } ],
  extras:    [ ],
  outgoings: [ ],
  dividends: [ ],
  pos:       [ ],
  fos:       [ ],
  fixcosts:  [ ],
  fixcostOverrides: {},
  status: {
    autoManualCheck: false,
    events: {},
  },
};

function ensureFixcostContainers(state) {
  if (!state) return;
  if (!Array.isArray(state.fixcosts)) state.fixcosts = [];
  if (!state.fixcostOverrides || typeof state.fixcostOverrides !== "object") {
    state.fixcostOverrides = {};
  }
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function migrateLegacyOutgoings(state) {
  if (!state) return;
  if (!Array.isArray(state.outgoings) || !state.outgoings.length) return;
  if (Array.isArray(state.fixcosts) && state.fixcosts.length) {
    state.outgoings = [];
    return;
  }

  const rows = state.outgoings.filter(row => row && row.month);
  if (!rows.length) {
    state.outgoings = [];
    return;
  }

  const months = rows
    .map(row => row.month)
    .filter(Boolean)
    .sort();
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  if (!firstMonth) {
    state.outgoings = [];
    return;
  }

  ensureFixcostContainers(state);

  const id = `fix-migration-${Date.now()}`;
  state.fixcosts.push({
    id,
    name: "Sonstige Fixkosten (Migration)",
    category: "Sonstiges",
    amount: "0,00",
    frequency: "monthly",
    intervalMonths: 1,
    anchor: "LAST",
    startMonth: firstMonth,
    endMonth: lastMonth,
    proration: { enabled: false, method: "none" },
    autoPaid: true,
    notes: "Automatisch aus bestehenden Monatswerten übernommen",
  });

  state.fixcostOverrides[id] = {};
  rows.forEach(row => {
    const month = row.month;
    if (!month) return;
    if (!state.fixcostOverrides[id][month]) state.fixcostOverrides[id][month] = {};
    const override = state.fixcostOverrides[id][month];
    const amount = formatEuro(Math.abs(parseEuro(row.amountEur ?? row.amount ?? 0)));
    override.amount = amount;
    if (row.date) {
      override.dueDate = row.date;
    }
    if (row.label) {
      override.note = row.label;
    }
  });

  state.outgoings = [];
}

function ensureStatusSection(state){
  const target = state || {};
  if (!target.status || typeof target.status !== "object") {
    target.status = { autoManualCheck: false, events: {} };
  }
  if (typeof target.status.autoManualCheck !== "boolean") {
    target.status.autoManualCheck = false;
  }
  if (!target.status.events || typeof target.status.events !== "object") {
    target.status.events = {};
  }
  return target.status;
}

let _state = null;
const listeners = new Set();

export function createEmptyState(){
  const clone = structuredClone(defaults);
  ensureStatusSection(clone);
  ensureFixcostContainers(clone);
  return clone;
}

export function loadState(){
  if (_state) return _state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? { ...structuredClone(defaults), ...JSON.parse(raw) } : structuredClone(defaults);
  } catch {
    _state = structuredClone(defaults);
  }
  ensureStatusSection(_state);
  ensureFixcostContainers(_state);
  migrateLegacyOutgoings(_state);
  return _state;
}

export function saveState(s){
  _state = s || _state || structuredClone(defaults);
  ensureStatusSection(_state);
  ensureFixcostContainers(_state);
  try {
    const { _computed, ...clean } = _state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  for (const fn of listeners) try { fn(_state); } catch {}
}

export function addStateListener(fn){
  listeners.add(fn);
  return ()=>listeners.delete(fn);
}

export function exportState(state){
  const payload = state || loadState();
  const fileName = `amazon-fba-cashflow-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importStateFile(file, cb){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result || '{}');
      ensureStatusSection(json);
      ensureFixcostContainers(json);
      migrateLegacyOutgoings(json);
      cb(json);
    } catch (err) {
      cb({ __error: err?.message || 'Ungültige JSON-Datei' });
    }
  };
  reader.onerror = () => {
    cb({ __error: reader.error?.message || 'Datei konnte nicht gelesen werden' });
  };
  reader.readAsText(file, 'utf-8');
}

export function getStatusSnapshot(){
  const state = loadState();
  return ensureStatusSection(state);
}

export function setAutoManualCheck(enabled){
  const state = loadState();
  const status = ensureStatusSection(state);
  const next = enabled === true;
  if (status.autoManualCheck === next) return;
  status.autoManualCheck = next;
  saveState(state);
}

export function setEventManualPaid(eventId, paid){
  if (!eventId) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  if (!map[eventId]) map[eventId] = {};
  const record = map[eventId];
  const next = typeof paid === "boolean" ? paid : Boolean(paid);
  if (record.manual === next) return;
  record.manual = next;
  saveState(state);
}

export function clearEventManualPaid(eventId){
  if (!eventId) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  if (!map[eventId] || typeof map[eventId].manual === "undefined") return;
  delete map[eventId].manual;
  if (!Object.keys(map[eventId]).length) delete map[eventId];
  saveState(state);
}

export function setEventsManualPaid(eventIds, paid){
  if (!Array.isArray(eventIds) || !eventIds.length) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  let changed = false;
  for (const id of eventIds) {
    if (!id) continue;
    if (!map[id]) map[id] = {};
    const record = map[id];
    const next = typeof paid === "boolean" ? paid : Boolean(paid);
    if (record.manual !== next) {
      record.manual = next;
      changed = true;
    }
  }
  if (changed) saveState(state);
}
