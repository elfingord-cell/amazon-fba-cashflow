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

function buildMissingField(fieldKey, label, reason) {
  return { fieldKey, label, reason };
}

export function getProductCompleteness(product, globalSettings = {}) {
  const ctx = globalSettings?.state ? globalSettings : { settings: globalSettings };
  const state = ctx.state || {};
  const settings = ctx.settings || state.settings || globalSettings || {};
  const suppliers = ctx.suppliers || state.suppliers || [];
  const productSuppliers = ctx.productSuppliers || state.productSuppliers || [];
  const pos = ctx.pos || state.pos || [];
  const fos = ctx.fos || state.fos || [];

  const missingRequired = [];
  const missingRecommended = [];

  const sku = normalizeText(product?.sku);
  if (!sku) missingRequired.push(buildMissingField("sku", "SKU", "SKU fehlt."));
  const alias = normalizeText(product?.alias);
  if (!alias) missingRequired.push(buildMissingField("alias", "Alias", "Alias fehlt."));
  const status = normalizeText(product?.status || "").toLowerCase();
  if (!status) {
    missingRequired.push(buildMissingField("status", "Status", "Status fehlt."));
  }
  if (!normalizeText(product?.categoryId)) {
    missingRequired.push(buildMissingField("categoryId", "Kategorie", "Kategorie fehlt."));
  }

  const resolvedMoq = toNumber(product?.moqUnits ?? settings?.moqDefaultUnits);
  if (!resolvedMoq || resolvedMoq <= 0) {
    missingRequired.push(buildMissingField("moqUnits", "MOQ", "MOQ fehlt."));
  }

  const { product: resolvedProduct, supplier, supplierId, productSupplier } = resolveSupplierContext(
    { products: [product].filter(Boolean), suppliers, productSuppliers, pos, fos },
    sku,
    product?.supplierId,
  );

  const fxRate = resolveFxRate(resolvedProduct, settings);
  const unitPrice = resolveUnitPriceUsd({ product: resolvedProduct, productSupplier });
  const landedCost = toNumber(resolvedProduct?.landedUnitCostEur);
  const costBasisOk = (landedCost != null && landedCost > 0)
    || (unitPrice.value != null && unitPrice.value > 0 && fxRate.value != null && fxRate.value > 0);
  if (!costBasisOk) {
    missingRequired.push(buildMissingField(
      "unitPriceUsd",
      "Stückpreis (Währung)",
      "Stückpreis oder FX-Kurs fehlt.",
    ));
  }
  const leadTime = resolveProductionLeadTimeDays({
    product: resolvedProduct,
    productSupplier,
    supplier,
    settings,
  });
  if (!leadTime.value) {
    missingRequired.push(buildMissingField(
      "productionLeadTimeDaysDefault",
      "Production Lead Time",
      "Produktionstage fehlen.",
    ));
  }

  const transportMode = resolveTransportMode({ product: resolvedProduct, transportMode: resolvedProduct?.defaultTransportMode });
  const transportLeadTime = resolveTransportLeadTimeDays({
    settings,
    product: resolvedProduct,
    transportMode,
  });
  if (!transportLeadTime.value) {
    missingRecommended.push(buildMissingField(
      "template.transitDays",
      "Transport Lead Time",
      "Transport Lead Time fehlt.",
    ));
  }

  if (!supplierId && !productSupplier) {
    missingRecommended.push(buildMissingField("supplierId", "Supplier", "Supplier fehlt."));
  }

  if (state?.forecast?.settings?.useForecast) {
    if (!hasForecastForSku(state, sku)) {
      missingRecommended.push(buildMissingField("forecast", "Forecast", "Forecast fehlt."));
    }
  }

  const statusValue = missingRequired.length
    ? "blocked"
    : (missingRecommended.length ? "warning" : "ok");

  return {
    status: statusValue,
    missingRequired,
    missingRecommended,
  };
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
