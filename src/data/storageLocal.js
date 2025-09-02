// Local-first Storage (ohne Abhängigkeiten)
// API: loadState(), saveState(), storage, addStateListener()
// NEU: Kanonisierung openingEur <-> settings.openingBalance (de-DE)

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

// --- Mini-Event-System ---
const EVT_NAME = "fba:state-changed";
export function addStateListener(fn) {
  window.addEventListener(EVT_NAME, fn);
  return () => window.removeEventListener(EVT_NAME, fn);
}
function notifyChange() {
  try { window.dispatchEvent(new CustomEvent(EVT_NAME)); } catch {}
}

// --- Helpers de-DE ---
function parseDE(x) {
  if (x == null) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).trim();
  if (!s) return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
}
function fmtDE(n) {
  if (!isFinite(n)) return "0,00";
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Defaults (tolerant) ---
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
  // optionale numerische Spiegel-Felder:
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
      return { ...structuredClone(defaults), ...obj };
    } catch {
      return structuredClone(defaults);
    }
  },

  save(state) {
    // 1) _computed raus
    const { _computed, ...clean } = state || {};
    const next = structuredClone(clean);

    // 2) Kanonisierung Opening:
    //    - wenn settings.openingBalance vorhanden → openingEur aus de-DE ableiten
    //    - sonst, wenn openingEur existiert → openingBalance formatieren
    const s = next.settings || (next.settings = {});
    const hasStr = typeof s.openingBalance === "string" && s.openingBalance.trim() !== "";
    const hasNum = typeof next.openingEur === "number" && isFinite(next.openingEur);

    if (hasStr) {
      const parsed = parseDE(s.openingBalance);
      if (isFinite(parsed)) {
        next.openingEur = parsed;
      } else if (!hasNum) {
        // Fallback: falls der String unparsebar ist und kein openingEur vorhanden, setze 0
        next.openingEur = 0;
        s.openingBalance = fmtDE(0);
      }
    } else if (hasNum) {
      s.openingBalance = fmtDE(next.openingEur);
    } else {
      // gar nichts vorhanden → setze 0,00
      next.openingEur = 0;
      s.openingBalance = fmtDE(0);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      notifyChange();
    } catch {
      // stillschweigend ignorieren
    }
  },
};

// Named-Export-Shim
export function loadState() { return storage.load(); }
export function saveState(s) { return storage.save(s); }
