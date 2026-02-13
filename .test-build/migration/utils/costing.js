"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toEurFromUsd = toEurFromUsd;
exports.computeFreightPerUnitEur = computeFreightPerUnitEur;
function toNumber(value) {
    if (value == null || value === "")
        return null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    const raw = String(value).trim();
    if (!raw)
        return null;
    const hasComma = raw.includes(",");
    const normalized = hasComma ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
}
function toEurFromUsd(usd, fxUsdPerEur) {
    const usdValue = toNumber(usd);
    const fxRate = toNumber(fxUsdPerEur);
    if (usdValue == null || fxRate == null || fxRate <= 0)
        return null;
    return usdValue / fxRate;
}
function computeFreightPerUnitEur({ unitPriceUsd, landedCostEur, fxUsdPerEur }) {
    const missingFields = [];
    const unitUsd = toNumber(unitPriceUsd);
    const landedEur = toNumber(landedCostEur);
    const fxRate = toNumber(fxUsdPerEur);
    if (unitUsd == null || unitUsd <= 0)
        missingFields.push("unitPriceUsd");
    if (landedEur == null || landedEur <= 0)
        missingFields.push("landedCostEur");
    if (fxRate == null || fxRate <= 0)
        missingFields.push("fxUsdPerEur");
    if (missingFields.length) {
        return { value: null, warning: false, goodsCostEur: null, missingFields };
    }
    const goodsCostEur = toEurFromUsd(unitUsd, fxRate);
    if (goodsCostEur == null) {
        return { value: null, warning: false, goodsCostEur: null, missingFields: ["fxUsdPerEur"] };
    }
    const raw = landedEur - goodsCostEur;
    const warning = raw < 0;
    const value = Number.isFinite(raw) ? Math.max(0, raw) : null;
    return { value, warning, goodsCostEur, missingFields: [] };
}
