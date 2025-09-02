// Local-first Storage für Amazon-FBA Cashflow (ohne Abhängigkeiten)
// - Beibehalt der bisherigen API (loadState/saveState/storage)
// - NEU: leichtes Eventing für Live-Refresh (addStateListener + notifyChange)

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

// --- Mini-Event-System ---
const EVT_NAME = "fba:state-changed";

/**
 * Registriert einen Listener, der bei jeder State-Änderung aufgerufen wird.
 * Rückgabe: Unsubscribe-Funktion.
 */
export function addStateListener(fn) {
  window.addEventListener(EVT_NAME, fn);
  return () => window.removeEventListener(EVT_NAME, fn);
}
function notifyChange() {
  try { window.dispatchEvent(new CustomEvent(EVT_NAME)); } catch {}
}

// --- Default-State (tolerant, kann von Views überschrieben/ergänzt werden) ---
const defaults = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
    openingBalance: "50.000,00",
  },
  incomings: [
    { month: "2025-02", revenueEur: "20.000,00", payoutRate: "0,85" },
    { month: "2025-03", revenueEur: "22.000,00", payoutRate: "0,85" },
  ],
  extras: [
    { month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" },
  ],
  outgoings: [
    { month: "2025-02", label: "Fixkosten", amountEur: "2.000,00" },
  ],
  // optionale Felder für künftige Inkremente:
  openingEur: undefined,
  monthlyAmazonEur: undefined,
  payoutPct: undefined,
};

// --- Kern-API ---
export const storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaults);
      const obj = JSON.parse(raw);
      // defensiv mergen, damit neue Felder Defaults erhalten
      return { ...structuredClone(defaults), ...obj };
    } catch {
      return structuredClone(defaults);
    }
  },
  save(state) {
    const { _computed, ...clean } = state || {};
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      notifyChange(); // <<< wichtig für Live-Refresh (Dashboard/Export/etc.)
    } catch {
      // stillschweigend ignorieren (Quota, Privacy, etc.)
    }
  },
};

// --- Kompatible Named-Exports ---
export function loadState() { return storage.load(); }
export function saveState(s) { return storage.save(s); }
