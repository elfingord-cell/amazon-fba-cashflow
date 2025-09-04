// src/data/storageLocal.js
export const STORAGE_KEY = "amazon_fba_cashflow_v1";

const defaults = {
  settings: { startMonth:"2025-02", horizonMonths:18, openingBalance:"50.000,00" },
  openingEur: 2000,
  monthlyAmazonEur: 22500,
  payoutPct: 0.85,
  incomings: [],
  extras: [{ month:"2025-03", label:"USt-Erstattung", amountEur:"1.500,00" }],
  outgoings: [{ month:"2025-02", label:"Fixkosten", amountEur:"3.000,00" }],
  orders: { pos:[], fos:[] },
};

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaults);
    const obj = JSON.parse(raw);
    return deepMerge(structuredClone(defaults), obj);
  }catch{ return structuredClone(defaults); }
}

export function saveState(state){
  const { _computed, ...clean } = state || {};
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); }catch{}
}

export function addStateListener(fn){
  const h = (e)=>{ if (e.key===STORAGE_KEY) fn(); };
  window.addEventListener("storage", h);
  return ()=>window.removeEventListener("storage", h);
}

// simple deep merge (Objekte + Arrays ersetzen)
function deepMerge(base, add){
  for (const k of Object.keys(add||{})){
    if (Array.isArray(add[k])) base[k] = add[k];
    else if (add[k] && typeof add[k]==="object") base[k] = deepMerge(base[k]||{}, add[k]);
    else base[k] = add[k];
  }
  return base;
}
