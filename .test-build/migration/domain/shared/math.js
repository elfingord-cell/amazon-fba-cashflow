"use strict";
// Zentrale Rundungs-Helfer. Einzige erlaubte round2-Implementierung im Repo
// (Guard: tests/v2/shared-helpers.guard.test.mjs). Drei Varianten, weil die
// Altimplementierungen sich im Verhalten bei ungültigem Input unterschieden —
// Call-Sites importieren die Variante, die ihrem bisherigen Vertrag entspricht.
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = round2;
exports.round2OrNull = round2OrNull;
exports.round2OrZero = round2OrZero;
function round2(value) {
    return Math.round(value * 100) / 100;
}
function round2OrNull(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return null;
    return Math.round(number * 100) / 100;
}
function round2OrZero(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return 0;
    return Math.round(number * 100) / 100;
}
