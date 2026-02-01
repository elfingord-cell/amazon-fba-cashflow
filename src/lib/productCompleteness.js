import {
  resolveSupplierContext,
  resolveFxRate,
  resolveProductionLeadTimeDays,
  resolveTransportMode,
  resolveTransportLeadTimeDays,
  resolveUnitPriceUsd,
  resolveLogisticsPerUnitEur,
  toNumber,
} from "./productDefaults.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function hasForecastForSku(state, sku) {
  const key = normalizeText(sku);
  if (!key) return false;
  const manual = state?.forecast?.forecastManual?.[key];
  if (manual && Object.values(manual).some(val => Number.isFinite(Number(val)))) return true;
  const imported = state?.forecast?.forecastImport?.[key];
  if (imported && Object.values(imported).some(val => Number.isFinite(Number(val?.units ?? val)))) return true;
  if (Array.isArray(state?.forecast?.items)) {
    return state.forecast.items.some(item => normalizeText(item?.sku) === key);
  }
  return false;
}

function buildDefaultResolution(field, source) {
  if (!source) return null;
  if (source === "product") return null;
  if (source === "settings") return `${field}: settings.default`;
  if (source === "productSupplier") return `${field}: supplier-link`;
  if (source === "supplier") return `${field}: supplier.default`;
  if (source === "product") return `${field}: product`;
  if (source === "computed") return `${field}: computed`;
  return `${field}: ${source}`;
}

export function evaluateProductCompleteness(product, ctx = {}) {
  const state = ctx.state || {};
  const settings = ctx.settings || state.settings || {};
  const suppliers = ctx.suppliers || state.suppliers || [];
  const productSuppliers = ctx.productSuppliers || state.productSuppliers || [];
  const missingRequired = [];
  const missingWarnings = [];
  const resolvedUsingDefaults = [];
  const resolvedValues = {};

  const sku = normalizeText(product?.sku);
  if (!sku) missingRequired.push("SKU");
  const alias = normalizeText(product?.alias);
  if (!alias) missingRequired.push("Alias");
  const status = normalizeText(product?.status || "").toLowerCase();
  if (!status || status !== "active") missingRequired.push("Status");
  if (!normalizeText(product?.categoryId)) missingRequired.push("Kategorie");

  const { product: resolvedProduct, supplier, supplierId, productSupplier } = resolveSupplierContext(
    { products: [product].filter(Boolean), suppliers, productSuppliers, pos: state.pos || [], fos: state.fos || [] },
    sku,
    product?.supplierId,
  );

  const fxRate = resolveFxRate(resolvedProduct, settings);
  const fxLabel = buildDefaultResolution("fxRate", fxRate.source);
  if (fxLabel) resolvedUsingDefaults.push(fxLabel);
  const unitPrice = resolveUnitPriceUsd({ product: resolvedProduct, productSupplier });
  const landedCost = toNumber(resolvedProduct?.landedUnitCostEur);
  const costBasisOk = (landedCost != null && landedCost > 0)
    || (unitPrice.value != null && unitPrice.value > 0 && fxRate.value != null && fxRate.value > 0);
  if (!costBasisOk) missingRequired.push("Kostenbasis");

  const leadTime = resolveProductionLeadTimeDays({
    product: resolvedProduct,
    productSupplier,
    supplier,
    settings,
  });
  if (!leadTime.value) {
    missingWarnings.push("Produktionstage");
  } else {
    const label = buildDefaultResolution("productionLeadTimeDays", leadTime.source);
    if (label) resolvedUsingDefaults.push(label);
  }

  const transportMode = resolveTransportMode({ product: resolvedProduct, transportMode: resolvedProduct?.defaultTransportMode });
  const transportLeadTime = resolveTransportLeadTimeDays({
    settings,
    product: resolvedProduct,
    transportMode,
  });
  if (!transportLeadTime.value) {
    missingWarnings.push("Transport Lead Time");
  } else {
    const label = buildDefaultResolution("transportLeadTimeDays", transportLeadTime.source);
    if (label) resolvedUsingDefaults.push(label);
  }

  if (!supplierId && !productSupplier) {
    missingWarnings.push("Supplier");
  }

  if (state?.forecast?.settings?.useForecast) {
    if (!hasForecastForSku(state, sku)) {
      missingWarnings.push("Forecast");
    }
  }

  resolvedValues.fxRate = fxRate.value;
  resolvedValues.productionLeadTimeDays = leadTime.value;
  resolvedValues.transportMode = transportMode;
  resolvedValues.transportLeadTimeDays = transportLeadTime.value;
  resolvedValues.unitPriceUsd = unitPrice.value;
  const logistics = resolveLogisticsPerUnitEur({
    product: resolvedProduct,
    productSupplier,
    fxRate: fxRate.value,
    unitPriceUsd: unitPrice.value,
  });
  resolvedValues.logisticsPerUnitEur = logistics.value;
  if (logistics.source === "computed") {
    const label = buildDefaultResolution("logisticsPerUnitEur", logistics.source);
    if (label) resolvedUsingDefaults.push(label);
  }

  const statusValue = missingRequired.length
    ? "blocked"
    : (missingWarnings.length ? "warning" : "ready");

  return {
    status: statusValue,
    missingRequired,
    missingWarnings,
    resolvedUsingDefaults,
    resolvedValues,
  };
}
