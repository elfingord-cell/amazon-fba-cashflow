function toNumber(value) {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export function deriveShippingPerUnitEur({ unitCostUsd, landedUnitCostEur, fxEurUsd }) {
  const unitUsd = toNumber(unitCostUsd);
  const landedEur = toNumber(landedUnitCostEur);
  const fxRate = toNumber(fxEurUsd);
  if (unitUsd == null || landedEur == null || fxRate == null) {
    return { value: null, warning: false, goodsCostEur: null };
  }
  const goodsCostEur = unitUsd * fxRate;
  const raw = landedEur - goodsCostEur;
  const warning = raw < 0;
  const value = Number.isFinite(raw) ? Math.max(0, Math.round(raw * 100) / 100) : null;
  return { value, warning, goodsCostEur: Math.round(goodsCostEur * 100) / 100 };
}

export function calculateLineShippingEur({ units, shippingPerUnitEur }) {
  const unitCount = toNumber(units) ?? 0;
  const perUnit = toNumber(shippingPerUnitEur);
  if (!Number.isFinite(unitCount) || !Number.isFinite(perUnit)) return 0;
  const total = unitCount * perUnit;
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}
