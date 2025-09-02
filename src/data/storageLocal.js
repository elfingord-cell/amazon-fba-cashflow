// FBA-CF-0009 — storageLocal (local-first)
// - zentraler State (localStorage) + Listener
// - Migration: erzeugt incomings[] (monatsweise Umsatz/Payout), falls nicht vorhanden

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

// -------- Helpers --------
function monthSeq(startYm = "2025-02", n = 18) {
  const [y, m] = startYm.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(y, (m - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function parseDE(x) {
  return Number(String(x ?? 0).replace(/\./g, "").replace(",", ".")) || 0;
}
function fmtDE(num) {
  const n = Number(num) || 0;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// -------- Defaults --------
const defaults = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
  },
  openingEur: "2.000,00",
  // globale Felder (Altbestand) – werden migriert zu incomings[]
  monthlyAmazonEur: "22.500,00",
  payoutPct: 0.85,
  // Zielzustand:
  incomings: [
    // { month:"2025-02", revenueEur:"22.500,00", payoutPct:0.85 }
  ],
  extras: [
    { month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" },
    { month: "2025-05", label: "Einmaliger Zufluss", amountEur: "2.000,00" },
  ],
  outgoings: [
    { month: "2025-02", label: "Fixkosten", amountEur: "3.000,00" }
  ]
};

// -------- Load / Save / Listeners --------
const listeners = new Set();
function notify() { for (const fn of listeners) try { fn(); } catch {} }

export function addStateListener(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const base = structuredClone(defaults);
    const obj = raw ? JSON.parse(raw) : {};
    const merged = { ...base, ...obj };
    migrate(merged);
    return merged;
  } catch {
    const m = structuredClone(defaults);
    migrate(m);
    return m;
  }
}

export function saveState(state) {
  const { _computed, ...clean } = state || {};
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch {}
  notify();
}

export function exportState(state) {
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  const s = JSON.stringify(state, null, 2);
  const blob = new Blob([s], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fba-cf-export-${ts}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importStateFile(file, onOk) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const obj = JSON.parse(String(fr.result || "{}"));
      const merged = { ...structuredClone(defaults), ...obj };
      migrate(merged);
      saveState(merged);
      if (typeof onOk === "function") onOk(merged);
    } catch (e) {
      alert("Ungültige JSON-Datei.");
      console.error(e);
    }
  };
  fr.readAsText(file);
}

// -------- Migration: global → incomings --------
function migrate(s) {
  if (!Array.isArray(s.incomings) || s.incomings.length === 0) {
    const months = monthSeq(s?.settings?.startMonth, Number(s?.settings?.horizonMonths || 18));
    const rev = s.monthlyAmazonEur ?? "0,00";
    const pct = s.payoutPct ?? 0.85;
    s.incomings = months.map(m => ({ month: m, revenueEur: rev, payoutPct: pct }));
  } else {
    // Sanity: Format-Zahlen harmonisieren
    s.incomings = s.incomings.map(r => ({
      month: r.month,
      revenueEur: typeof r.revenueEur === "string" ? r.revenueEur : fmtDE(parseDE(r.revenueEur)),
      payoutPct: typeof r.payoutPct === "number" ? r.payoutPct : parseDE(r.payoutPct)
    }));
  }
  // Öffnungssaldo korrigieren
  if (typeof s.openingEur !== "string") s.openingEur = fmtDE(parseDE(s.openingEur));
  // Extras/Outgoings format
  s.extras = (s.extras || []).map(r => ({ ...r, amountEur: typeof r.amountEur === "string" ? r.amountEur : fmtDE(parseDE(r.amountEur)) }));
  s.outgoings = (s.outgoings || []).map(r => ({ ...r, amountEur: typeof r.amountEur === "string" ? r.amountEur : fmtDE(parseDE(r.amountEur)) }));
}
