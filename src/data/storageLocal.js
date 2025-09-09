// FBA-CF-0027 — Local Storage Layer (schlank, mit Listenern)
export const STORAGE_KEY = "amazon_fba_cashflow_v1";

const defaults = {
  settings: { startMonth: "2025-02", horizonMonths: 18, openingBalance: "50.000,00" },
  incomings: [ { month:"2025-02", revenueEur:"20.000,00", payoutPct:"100" } ],
  extras:    [ ],
  outgoings: [ ],
  pos:       [ ],
  fos:       [ ]
};

let _state = null;
const listeners = new Set();

export function loadState(){
  if (_state) return _state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? { ...structuredClone(defaults), ...JSON.parse(raw) } : structuredClone(defaults);
  } catch {
    _state = structuredClone(defaults);
  }
  return _state;
}

export function saveState(s){
  _state = s || _state || structuredClone(defaults);
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
