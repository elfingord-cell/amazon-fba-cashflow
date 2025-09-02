// FBA-CF-0006a — storageLocal: einheitliche API
// Exporte: loadState, saveState, exportState, importStateFile, addStateListener

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

const defaults = {
  openingEur: "50.000,00",
  monthlyAmazonEur: "22.500,00",
  payoutPct: "0,85",
  settings: { startMonth: "2025-02", horizonMonths: 18 },
  extras: [],
  outgoings: []
};

let listeners = [];

function mergeWithDefaults(x){
  const s = x && typeof x === "object" ? x : {};
  return {
    ...defaults,
    ...s,
    settings: { ...defaults.settings, ...(s.settings||{}) },
    extras: Array.isArray(s.extras) ? s.extras : [],
    outgoings: Array.isArray(s.outgoings) ? s.outgoings : []
  };
}

export function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return mergeWithDefaults({});
    const obj = JSON.parse(raw);
    return mergeWithDefaults(obj);
  } catch {
    return mergeWithDefaults({});
  }
}

export function saveState(state){
  const clean = mergeWithDefaults(state||{});
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch {}
  notify();
}

export function addStateListener(fn){
  if (typeof fn !== "function") return ()=>{};
  listeners.push(fn);
  return ()=>{ listeners = listeners.filter(f=>f!==fn); };
}

function notify(){
  try { const s = loadState(); listeners.forEach(f=>f(s)); } catch {}
}

export function exportState(state){
  const s = mergeWithDefaults(state||loadState());
  const blob = new Blob([JSON.stringify(s,null,2)], { type:"application/json" });
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"");
  a.href = URL.createObjectURL(blob);
  a.download = `fba-cf-export-${ts}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href), 500);
}

export function importStateFile(file, onOK){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result||"{}"));
      if (!obj || typeof obj !== "object") throw new Error("Kein JSON-Objekt");
      const merged = mergeWithDefaults(obj);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      notify();
      if (typeof onOK === "function") onOK(merged);
    } catch(e){
      alert("Ungültige JSON-Datei: " + (e?.message||e));
    }
  };
  reader.readAsText(file);
}
