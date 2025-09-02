// FBA-CF-0004g — Einheitliche Storage-Schicht
// - fester Key: amazon_fba_cashflow_v1
// - Kanonisierung: openingEur (Number) <-> settings.openingBalance (de-DE)
// - sofortiges Persistieren + Listener

export const STORAGE_KEY = "amazon_fba_cashflow_v1";

// Robuste Defaults (nur das Nötigste)
const DEFAULTS = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
    // de-DE formatiert
    openingBalance: "50.000,00",
  },
  // Zahlenspiegel (beide Perspektiven vorhanden)
  openingEur: 50000.0,

  // Platzhalter-Domänenfelder (werden evtl. von Views verwendet)
  monthlyAmazonEur: 0,
  payoutPct: 0.85,
  extras: [],     // [{month:"YYYY-MM"|date, label, amountEur: "1.234,56"|number}]
  outgoings: [],  // dito
};

// ---------- Helpers ----------
const parseDE = (x) => {
  if (x == null) return NaN;
  if (typeof x === "number") return x;
  const t = String(x).trim();
  if (!t) return NaN;
  return Number(t.replace(/\./g, "").replace(",", "."));
};
const fmtDE = (n) => {
  if (!isFinite(n)) return "0,00";
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Öffentliche Listener-API
const listeners = new Set();
export function addStateListener(fn) {
  if (typeof fn === "function") listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* View-Fehler nicht propagieren */ }
  }
}

// Defensive Deep-Clone
function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

// Kanonisierung: sorgt dafür, dass Zahl + String übereinstimmen
function canonicalize(rawIn) {
  const s = clone(rawIn) || {};
  s.settings = s.settings || {};

  // Ausgangswerte ermitteln
  let n = NaN;
  // 1) openingEur hat Vorrang, wenn valide Zahl
  if (typeof s.openingEur === "number" && isFinite(s.openingEur)) {
    n = s.openingEur;
  }
  // 2) sonst aus settings.openingBalance (de-DE) ableiten
  if (!isFinite(n) && s.settings.openingBalance != null) {
    const p = parseDE(s.settings.openingBalance);
    if (isFinite(p)) n = p;
  }
  // 3) fallback auf Default
  if (!isFinite(n)) n = parseDE(DEFAULTS.settings.openingBalance);

  // Beide Repräsentationen setzen
  s.openingEur = n;
  s.settings.openingBalance = fmtDE(n);

  // Standardfelder absichern
  if (typeof s.settings.startMonth !== "string") s.settings.startMonth = DEFAULTS.settings.startMonth;
  if (!Number.isFinite(s.settings.horizonMonths)) s.settings.horizonMonths = DEFAULTS.settings.horizonMonths;

  if (!Array.isArray(s.extras)) s.extras = [];
  if (!Array.isArray(s.outgoings)) s.outgoings = [];

  if (!Number.isFinite(s.monthlyAmazonEur)) s.monthlyAmazonEur = 0;
  if (!Number.isFinite(s.payoutPct)) s.payoutPct = 0.85;

  return s;
}

// Interner RAM-Cache (einmal beim ersten loadState() eingelesen)
let _state = null;

// Lesen aus localStorage (einmalig oder bei harter Neuinitialisierung)
function readFromLS() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return canonicalize(DEFAULTS);
    const obj = JSON.parse(raw);
    // Migration: falls altes Format wie {storage:{load/save}} o.Ä. -> ignorieren
    return canonicalize({ ...DEFAULTS, ...obj });
  } catch {
    return canonicalize(DEFAULTS);
  }
}

// Schreiben nach localStorage (atomar; ohne Throttle)
function writeToLS(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Speicher voll / privates Fenster: ignorieren, aber _state bleibt korrekt
  }
}

// ---------- Öffentliche API ----------

// Liefert einen **Clone** des aktuellen Zustands
export function loadState() {
  if (_state == null) {
    _state = readFromLS();
  }
  return clone(_state);
}

// Speichert **sofort** und benachrichtigt Listener
export function saveState(next) {
  // next kann Teilausschnitt oder kompletter State sein
  const merged = canonicalize({ ..._state ?? {}, ...clone(next) });
  _state = merged;
  writeToLS(merged);
  notify();
}

// Convenience: vollständiger Reset (z.B. für „Reset“-Button)
export function resetState() {
  _state = canonicalize(DEFAULTS);
  writeToLS(_state);
  notify();
}

// Für Ex/Import (Datei)
export function exportState() {
  // Export immer in kanonischer Form
  return canonicalize(loadState());
}
export function importState(obj) {
  const cand = canonicalize(obj || {});
  _state = cand;
  writeToLS(cand);
  notify();
}
