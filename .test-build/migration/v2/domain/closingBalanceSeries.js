"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLockedActualClosing = readLockedActualClosing;
exports.buildHybridClosingBalanceSeries = buildHybridClosingBalanceSeries;
function readLockedActualClosing(value) {
    if (value == null)
        return null;
    if (typeof value === "string" && value.trim() === "")
        return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return null;
    return parsed;
}
function buildHybridClosingBalanceSeries(input) {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (!rows.length)
        return [];
    const firstOpening = Number(input.initialOpening);
    let running = Number.isFinite(firstOpening) ? firstOpening : 0;
    return rows.map((row, index) => {
        const opening = index === 0 ? running : running;
        const netRaw = Number(row?.net);
        const net = Number.isFinite(netRaw) ? netRaw : 0;
        const actualClosing = readLockedActualClosing(row?.actualClosing);
        const plannedClosing = opening + net;
        const closing = actualClosing != null ? actualClosing : plannedClosing;
        running = closing;
        return {
            month: String(row?.month || ""),
            opening,
            net,
            plannedClosing,
            closing,
            actualClosing,
            lockedActual: actualClosing != null,
        };
    });
}
