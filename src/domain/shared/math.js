// Zentrale Rundungs-Helfer. Einzige erlaubte round2-Implementierung im Repo
// (Guard: tests/v2/shared-helpers.guard.test.mjs). Drei Varianten, weil die
// Altimplementierungen sich im Verhalten bei ungültigem Input unterschieden —
// Call-Sites importieren die Variante, die ihrem bisherigen Vertrag entspricht.

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function round2OrNull(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

export function round2OrZero(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}
