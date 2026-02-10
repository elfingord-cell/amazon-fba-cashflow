import {
  resolveSupplierContext,
  resolveProductionLeadTimeDays,
  resolveTransportLeadTimeDays,
  resolveUnitPriceUsd,
  resolveTransportMode,
  toNumber,
} from "./productDefaults.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveCurrencyWithSource({ product, productSupplier, supplier, settings }) {
  const template = product?.template?.fields || product?.template || {};
  let source = null;
  let candidate = null;
  if (productSupplier?.currency) {
    source = "productSupplier";
    candidate = productSupplier.currency;
  } else if (supplier?.currencyDefault) {
    source = "supplier";
    candidate = supplier.currencyDefault;
  } else if (template.currency) {
    source = "template";
    candidate = template.currency;
  } else if (settings?.defaultCurrency) {
    source = "settings";
    candidate = settings.defaultCurrency;
  }
  const normalized = String(candidate || "EUR").trim().toUpperCase();
  const value = ["EUR", "USD", "CNY"].includes(normalized) ? normalized : "EUR";
  if (!source && value === "EUR") return { value, source: "fallback" };
  return { value, source };
}

function resolveDutyRateWithSource({ product, settings }) {
  const template = product?.template?.fields || product?.template || {};
  const productValue = toNumber(product?.dutyRatePct);
  if (productValue != null) return { value: productValue, source: "product" };
  const templateValue = toNumber(template.dutyPct);
  if (templateValue != null) return { value: templateValue, source: "template" };
  const settingsValue = toNumber(settings?.dutyRatePct);
  if (settingsValue != null) return { value: settingsValue, source: "settings" };
  return { value: null, source: null };
}

function resolveEustRateWithSource({ product, settings }) {
  const template = product?.template?.fields || product?.template || {};
  const productValue = toNumber(product?.eustRatePct);
  if (productValue != null) return { value: productValue, source: "product" };
  const templateValue = toNumber(template.vatImportPct);
  if (templateValue != null) return { value: templateValue, source: "template" };
  const settingsValue = toNumber(settings?.eustRatePct);
  if (settingsValue != null) return { value: settingsValue, source: "settings" };
  return { value: null, source: null };
}

function buildFieldStatus(fieldKey, label) {
  return { fieldKey, label };
}

export function evaluateProductCompleteness(product, ctx = {}) {
  const state = ctx.state || {};
  const settings = ctx.settings || state.settings || {};
  const suppliers = ctx.suppliers || state.suppliers || [];
  const productSuppliers = ctx.productSuppliers || state.productSuppliers || [];
  const pos = ctx.pos || state.pos || [];
  const fos = ctx.fos || state.fos || [];

  const blockingMissing = [];
  const defaulted = [];
  const suggestedMissing = [];

  const sku = normalizeText(product?.sku);
  if (!sku) blockingMissing.push(buildFieldStatus("sku", "SKU", {}));
  const alias = normalizeText(product?.alias);
  if (!alias) blockingMissing.push(buildFieldStatus("alias", "Alias", {}));
  if (!normalizeText(product?.categoryId)) {
    blockingMissing.push(buildFieldStatus("categoryId", "Kategorie", {}));
  }

  const { product: resolvedProduct, supplier, productSupplier } = resolveSupplierContext(
    { products: [product].filter(Boolean), suppliers, productSuppliers, pos, fos },
    sku,
    product?.supplierId,
  );

  const unitPrice = resolveUnitPriceUsd({ product: resolvedProduct, productSupplier });
  const currency = resolveCurrencyWithSource({ product: resolvedProduct, productSupplier, supplier, settings });
  const hasUnitPrice = unitPrice.value != null && unitPrice.value > 0;
  const hasCurrency = Boolean(currency.value);
  if (!hasUnitPrice || !hasCurrency) {
    blockingMissing.push(buildFieldStatus("unitPriceUsd", "Stückpreis (Währung)", {}));
  } else if (unitPrice.source !== "product" || !["product", "template"].includes(currency.source)) {
    defaulted.push({
      fieldKey: "unitPriceUsd",
      label: "Stückpreis (Währung)",
      value: { amount: unitPrice.value, currency: currency.value },
    });
  }

  const leadTime = resolveProductionLeadTimeDays({
    product: resolvedProduct,
    productSupplier,
    supplier,
    settings,
  });
  if (!leadTime.value) {
    blockingMissing.push(buildFieldStatus("productionLeadTimeDaysDefault", "Produktionszeit (Tage)", {}));
  } else if (leadTime.source !== "product") {
    defaulted.push({
      fieldKey: "productionLeadTimeDaysDefault",
      label: "Produktionszeit (Tage)",
      value: leadTime.value,
    });
  }

  const transportMode = resolveTransportMode({ product: resolvedProduct, transportMode: resolvedProduct?.defaultTransportMode });
  const transportLeadTime = resolveTransportLeadTimeDays({
    settings,
    product: resolvedProduct,
    transportMode,
  });
  if (!transportLeadTime.value) {
    blockingMissing.push(buildFieldStatus("transitDays", "Transit-Tage", {}));
  } else if (transportLeadTime.source !== "product") {
    defaulted.push({
      fieldKey: "transitDays",
      label: "Transit-Tage",
      value: transportLeadTime.value,
    });
  }

  const moqValue = toNumber(product?.moqOverrideUnits ?? product?.moqUnits);
  const moqDefault = toNumber(settings?.moqDefaultUnits);
  if (moqValue == null || moqValue <= 0) {
    if (moqDefault != null && moqDefault > 0) {
      defaulted.push({ fieldKey: "moqUnits", label: "MOQ", value: moqDefault });
    } else {
      blockingMissing.push(buildFieldStatus("moqUnits", "MOQ", {}));
    }
  }

  const dutyRate = resolveDutyRateWithSource({ product: resolvedProduct, settings });
  if (dutyRate.value == null) {
    blockingMissing.push(buildFieldStatus("dutyPct", "Zoll %", {}));
  } else if (dutyRate.source === "settings") {
    defaulted.push({ fieldKey: "dutyPct", label: "Zoll %", value: dutyRate.value });
  }

  const eustRate = resolveEustRateWithSource({ product: resolvedProduct, settings });
  if (eustRate.value == null) {
    blockingMissing.push(buildFieldStatus("vatImportPct", "EUSt %", {}));
  } else if (eustRate.source === "settings") {
    defaulted.push({ fieldKey: "vatImportPct", label: "EUSt %", value: eustRate.value });
  }

  const avgSellingPrice = toNumber(product?.avgSellingPriceGrossEUR);
  if (avgSellingPrice == null || avgSellingPrice <= 0) {
    blockingMissing.push(buildFieldStatus("avgSellingPriceGrossEUR", "Ø VK-Preis (Brutto)", {}));
  }
  const sellerboardMargin = toNumber(product?.sellerboardMarginPct);
  if (sellerboardMargin == null) {
    suggestedMissing.push(buildFieldStatus("sellerboardMarginPct", "Sellerboard Marge", {}));
  }
  const landedCost = toNumber(product?.landedUnitCostEur);
  if (landedCost == null) {
    suggestedMissing.push(buildFieldStatus("landedUnitCostEur", "Einstandspreis (EUR)", {}));
  }

  const statusValue = blockingMissing.length ? "blocked" : "ok";

  return {
    status: statusValue,
    blockingMissing,
    defaulted,
    suggestedMissing,
  };
}

export function getProductCompleteness(product, globalSettings = {}) {
  const ctx = globalSettings?.state ? globalSettings : { settings: globalSettings };
  return evaluateProductCompleteness(product, ctx);
}
