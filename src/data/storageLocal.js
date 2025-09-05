// src/data/storageLocal.js
export const STORAGE_KEY = "amazon_fba_cashflow_v1";

const defaults = {
  settings: { startMonth: "2025-02", horizonMonths: 18, openingBalance: "50.000,00" },
  openingEur: 2000,
  monthlyAmazonEur: 22500,
  payoutPct: 0.85,
  incomings: [],
  extras: [{ month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" }],
  outgoings: [{ month: "2025-02", label: "Fixkosten", amountEur: "3.000,00" }],
  orders: { pos: [], fos: [] }, // <-- PO/FO
};

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaults);
    const obj = JSON.parse(raw);
    return deepMerge(structuredClone(defaults), obj);
  }catch{
    return structuredClone(defaults);
  }
}

export function saveState(state){
  const { _computed, ...clean } = state || {};
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); }catch{}
}

export function addStateListener(fn){
  const h = (e)=>{ if (e.key===STORAGE_KEY) fn(); };
  window.addEventListener("storage", h);
  return ()=> window.removeEventListener("storage", h);
}

/* === Export/Import API (für Export-Tab) === */
export function exportState(state, filename){
  const data = state ?? loadState();
  const pretty = JSON.stringify(data, null, 2);
  const blob = new Blob([pretty], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  a.download = filename || `fba-cf-export-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1200);
}

export async function importStateFile(file){
  const text = await file.text();
  const obj = JSON.parse(text);
  // sanft mit defaults mergen (nie kaputt importieren)
  const merged = deepMerge(structuredClone(defaults), obj);
  saveState(merged);
  return merged;
}

/* === util: simple deep-merge === */
function deepMerge(base, add){
  for (const k of Object.keys(add||{})){
    if (Array.isArray(add[k])) base[k] = add[k];
    else if (add[k] && typeof add[k]==="object") base[k] = deepMerge(base[k]||{}, add[k]);
    else base[k] = add[k];
  }
  return base;
}
