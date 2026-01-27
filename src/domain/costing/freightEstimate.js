import { calculateLineShippingEur } from "./shipping.js";
import { computeFreightPerUnitEur } from "../../utils/costing.js";

const VALID_FREIGHT_MODES = new Set(["TOTAL_EUR", "PER_UNIT_EUR", "AUTO_FROM_LANDED"]);

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    normalized = raw.replace(/,/g, "");
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function resolveProduct(productsBySku, sku) {
  if (!sku || !productsBySku) return null;
  const key = String(sku).trim().toLowerCase();
  if (productsBySku instanceof Map) {
    return productsBySku.get(key) || productsBySku.get(String(sku).trim()) || null;
  }
  return productsBySku[key] || productsBySku[String(sku).trim()] || null;
}

function resolveFreightMode(po) {
  const mode = po?.timeline?.freightInputMode;
  if (VALID_FREIGHT_MODES.has(mode)) return mode;
  return po?.freightMode === "per_unit" ? "PER_UNIT_EUR" : "TOTAL_EUR";
}

function resolveFxUsdPerEur(po) {
  const direct = toNumber(po?.timeline?.fxUsdPerEur);
  if (direct != null && direct > 0) return direct;
  const override = toNumber(po?.fxOverride);
  if (override != null && override > 0) return override;
  return null;
}

export function computeFreightEstimate(po, productsBySku) {
  const issues = new Set();
  const lines = [];
  const items = Array.isArray(po?.items) ? po.items : [];
  const fxUsdPerEur = resolveFxUsdPerEur(po);
  const fxOk = fxUsdPerEur != null && fxUsdPerEur > 0;
  if (!fxOk) issues.add("MISSING_FX");

  let autoTotal = 0;
  let missingLandedCount = 0;
  let negativeCount = 0;

  items.forEach((item) => {
    const sku = String(item?.sku || "").trim();
    const product = resolveProduct(productsBySku, sku);
    const landedUnitCostEur = toNumber(product?.landedUnitCostEur);
    const unitCostUsd = toNumber(item?.unitCostUsd ?? item?.stueckkostenUsd);
    const units = toNumber(item?.units);
    const lineIssues = [];
    let goodsPerUnitEur = null;
    let derived = null;

    if (!fxOk) {
      lineIssues.push("MISSING_FX");
    }
    if (landedUnitCostEur == null) {
      lineIssues.push("MISSING_LANDED_COST");
      missingLandedCount += 1;
    }
    if (fxOk && unitCostUsd != null && landedUnitCostEur != null) {
      const computed = computeFreightPerUnitEur({
        unitPriceUsd: unitCostUsd,
        landedCostEur: landedUnitCostEur,
        fxUsdPerEur,
      });
      goodsPerUnitEur = computed.goodsCostEur;
      if (computed.value != null) {
        if (computed.warning) {
          lineIssues.push("NEGATIVE_DERIVED_LOGISTICS");
          negativeCount += 1;
        }
        derived = round2(computed.value);
        autoTotal += calculateLineShippingEur({
          units,
          shippingPerUnitEur: derived,
        });
      }
    }

    lineIssues.forEach((issue) => issues.add(issue));
    lines.push({
      id: item?.id,
      sku,
      units,
      landedUnitCostEur,
      goodsPerUnitEur: goodsPerUnitEur != null ? round2(goodsPerUnitEur) : null,
      derivedLogisticsPerUnitEur: derived,
      issues: lineIssues,
    });
  });

  const autoFreightEur = round2(autoTotal);
  const totalUnits = items.reduce((sum, item) => sum + (toNumber(item?.units) || 0), 0);
  const manualMode = po?.freightMode === "per_unit" ? "PER_UNIT_EUR" : "TOTAL_EUR";
  const manualPerUnit = toNumber(po?.timeline?.freightPerUnitEur ?? po?.freightPerUnitEur) || 0;
  const manualTotal = toNumber(po?.timeline?.freightTotalEur ?? po?.freightEur) || 0;
  const manualFreightEur = manualMode === "PER_UNIT_EUR"
    ? round2(manualPerUnit * totalUnits)
    : round2(manualTotal);
  const includeFreight = po?.timeline?.includeFreight !== false;
  const mode = resolveFreightMode(po);
  const estimatedFreightEur = includeFreight && mode === "AUTO_FROM_LANDED"
    ? autoFreightEur
    : manualFreightEur;

  return {
    estimatedFreightEur,
    autoFreightEur,
    manualFreightEur,
    includeFreight,
    mode,
    issues: Array.from(issues),
    lines,
    missingLandedCount,
    negativeCount,
    fxUsdPerEur,
  };
}
