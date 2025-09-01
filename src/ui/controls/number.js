// FBA-CF-0002 — leichtgewichtige Zahleneingabe für de-DE ohne Cursor-Sprung
// Nutzung: attachNumberField(inputEl, { key, decimals, onNumber })
//
// Verhalten:
// - Beim Tippen bleibt der Rohtext erhalten (keine Formatierung/kein Re-Render).
// - Beim Blur wird hübsch formatiert (de-DE).
// - (.) und (,) werden akzeptiert; intern normalisieren wir auf Punkt, rechnen aber mit Zahl.
// - Speichern via onNumber(value) (value = Number oder null bei leer).

function formatDE(n, decimals = 2) {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function parseLooseDE(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === "") return null;
  // akzeptiere 1.234,56 oder 1234.56 oder -1,2
  const norm = s.replace(/\./g, "").replace(",", ".");
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

export function attachNumberField(input, { key, decimals = 2, onNumber } = {}) {
  if (!input) return;

  // Merker: roher Inhalt, um beim Fokus die Formatierung nicht zu erzwingen
  let raw = input.value || "";

  // Initial: wenn Wert wie Zahl aussieht → formatiert anzeigen
  const initNum = parseLooseDE(raw);
  if (initNum != null) {
    input.value = formatDE(initNum, decimals);
  }

  input.addEventListener("focus", () => {
    // beim Fokussieren Rohtext zeigen (lesbar editieren)
    raw = input.value;
    const v = parseLooseDE(raw);
    input.value = v != null ? String(v).replace(".", ",") : raw; // als de-Text
    // Cursor ans Ende
    setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
  });

  input.addEventListener("input", (e) => {
    // nur den Rohtext aktualisieren; NICHT formatieren
    raw = input.value;
    // optional Zwischenspeichern als Zahl (wenn parsebar)
    const n = parseLooseDE(raw);
    if (typeof onNumber === "function") onNumber(n);
  });

  input.addEventListener("blur", () => {
    const n = parseLooseDE(raw);
    input.value = n != null ? formatDE(n, decimals) : "";
    if (typeof onNumber === "function") onNumber(n);
  });
}
