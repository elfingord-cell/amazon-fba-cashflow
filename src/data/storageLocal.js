// Local-first Storage für Amazon-FBA Cashflow
// Beibehalt der bestehenden API + Shim + Change-Events für Live-Refresh

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

// Mini-Eventing ohne Abhängigkeiten
const EVT_NAME = "fba:state-changed";
export function addStateListener(fn) {
  window.addEventListener(EVT_NAME, fn);
  return () => window.removeEventListener(EVT_NAME, fn);
}
function notifyChange() {
  // Event synchron feuern; leichtgewichtig
  try { window.dispatchEvent(new CustomEvent(EVT_NAME)); } catch {}
}

const defaults = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
    openingBalance: "50.000,00"
  },
  incomings: [
    { month: "2025-02", revenueEur: "20.000,00", payoutRate: "0,85" },
    { month: "2025-03", revenueEur: "22.000,00", payoutRate: "0,85" }
  ],
  extras: [
    { month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" }
  ],
  outgoings: [
    { month: "2025-02", label: "Fixkosten", amountEur: "2.000,00" }
  ]
};

export const storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaults);
      const obj = JSON.parse(raw);
      return { ...structuredClone(defaults), ...obj };
    } catch {
      return structuredClone(defaults);
    }
  },
  save(state) {
    const { _computed, ...clean } = state || {};
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      notifyChange(); // <<< NEU: Änderungen mitteilen
    } catch {
      // still schlucken
    }
  }
};

// Named-Export-Shim (Kompatibilität)
export function loadState()  { return storage.load(); }
export function saveState(s) { return storage.save(s); }
