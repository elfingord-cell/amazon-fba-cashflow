"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveShippingPerUnitEur = deriveShippingPerUnitEur;
exports.calculateLineShippingEur = calculateLineShippingEur;
const costing_js_1 = require("../../utils/costing.js");
function toNumber(value) {
    if (value == null || value === "")
        return null;
    const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    return Number.isFinite(num) ? num : null;
}
function deriveShippingPerUnitEur({ unitCostUsd, landedUnitCostEur, fxEurUsd }) {
    const derived = (0, costing_js_1.computeFreightPerUnitEur)({
        unitPriceUsd: unitCostUsd,
        landedCostEur: landedUnitCostEur,
        fxUsdPerEur: fxEurUsd,
    });
    return { value: derived.value, warning: derived.warning, goodsCostEur: derived.goodsCostEur };
}
function calculateLineShippingEur({ units, shippingPerUnitEur }) {
    const unitCount = toNumber(units) ?? 0;
    const perUnit = toNumber(shippingPerUnitEur);
    if (!Number.isFinite(unitCount) || !Number.isFinite(perUnit))
        return 0;
    const total = unitCount * perUnit;
    return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}
