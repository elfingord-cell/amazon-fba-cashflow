// src/data/storageLocal.js
// Local-first storage (namespace + debounce-free simple API)

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

const defaults = {
  settings: { startMonth: "2025-02", horizonMonths: 18 },
  openingEur: "5.000,00",
  payoutPct: 0.85,
  incomings: [ { month:"2025-02", revenueEur:"10.000,00", payoutPct:0.85 } ],
  outgoings: [ { month:"2025-03", label:"Fixkosten", amountEur:"2.000,00" } ],
  extras:    [ { month:"2025-04", label:"USt-Erstattung", amountEur:"1.500,00" } ],
  pos: [] // <— neu: Purchase Orders
};

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaults);
    const obj = JSON.parse(raw);
    return { ...structuredClone(defaults), ...obj };
  }catch{ return structuredClone(defaults); }
}

export function saveState(state){
  const { _computed, ...clean } = state || {};
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); }catch{}
}

// optional simple subscribe for live refresh
const listeners = new Set();
export function addStateListener(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }
// small helper any view can call after it saved:
export function notifyStateChanged(){ listeners.forEach(fn=>fn()); }
