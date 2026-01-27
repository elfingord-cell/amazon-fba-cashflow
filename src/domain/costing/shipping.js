import { computeFreightPerUnitEur } from "../../utils/costing.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export function deriveShippingPerUnitEur({ unitCostUsd, landedUnitCostEur, fxEurUsd }) {
  const derived = computeFreightPerUnitEur({
    unitPriceUsd: unitCostUsd,
    landedCostEur: landedUnitCostEur,
    fxUsdPerEur: fxEurUsd,
  });
  return { value: derived.value, warning: derived.warning, goodsCostEur: derived.goodsCostEur };
}

export function calculateLineShippingEur({ units, shippingPerUnitEur }) {
  const unitCount = toNumber(units) ?? 0;
  const perUnit = toNumber(shippingPerUnitEur);
  if (!Number.isFinite(unitCount) || !Number.isFinite(perUnit)) return 0;
  const total = unitCount * perUnit;
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}
