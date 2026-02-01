import { computeFreightPerUnitEur } from "../utils/costing.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveProductBySku(products, sku) {
  const needle = normalizeSku(sku);
  if (!needle) return null;
  return (products || []).find(product => normalizeSku(product?.sku) === needle) || null;
}

function resolveSupplierById(suppliers, supplierId) {
  if (!supplierId) return null;
  const needle = String(supplierId || "").trim();
  return (suppliers || []).find(supplier => String(supplier?.id || "").trim() === needle) || null;
}

function findLatestSupplierForSku(records, sku) {
  const needle = normalizeSku(sku);
  if (!needle) return null;
  const sorted = (records || [])
    .filter(Boolean)
    .filter(rec => {
      const skuMatch = normalizeSku(rec?.sku) === needle;
      const itemMatch = Array.isArray(rec?.items)
        ? rec.items.some(item => normalizeSku(item?.sku) === needle)
        : false;
      return skuMatch || itemMatch;
    })
    .sort((a, b) => String(b.orderDate || b.createdAt || "").localeCompare(String(a.orderDate || a.createdAt || "")));
  const match = sorted.find(rec => rec?.supplierId || rec?.supplier);
  if (!match) return null;
  return String(match.supplierId || match.supplier || "").trim() || null;
}

function resolveProductSupplierLink(state, sku, supplierId) {
  const skuKey = normalizeSku(sku);
  if (!skuKey) return null;
  const entries = (state?.productSuppliers || []).filter(entry => normalizeSku(entry?.sku) === skuKey);
  if (!entries.length) return null;
  if (supplierId) {
    const direct = entries.find(entry => String(entry?.supplierId || "").trim() === String(supplierId).trim());
    if (direct) return direct;
  }
  const preferred = entries.find(entry => entry?.isPreferred);
  return preferred || entries[0] || null;
}

function resolveSupplierContext(state, sku, supplierId) {
  const product = resolveProductBySku(state?.products || [], sku);
  const explicitSupplier = supplierId || product?.supplierId;
  const fromLink = resolveProductSupplierLink(state, sku, explicitSupplier);
  const inferredSupplierId =
    explicitSupplier
    || fromLink?.supplierId
    || findLatestSupplierForSku([...(state?.pos || []), ...(state?.fos || [])], sku)
    || "";
  const supplier = resolveSupplierById(state?.suppliers || [], inferredSupplierId);
  return {
    product,
    supplier,
    supplierId: inferredSupplierId,
    productSupplier: fromLink,
  };
}

function resolveFxRate(product, settings) {
  const template = product?.template?.fields || product?.template || {};
  const candidate = toNumber(product?.fxOverride ?? product?.fxUsdPerEur ?? template.fxRate ?? settings?.fxRate);
  if (candidate != null && candidate > 0) {
    return { value: candidate, source: product?.fxOverride != null ? "product" : (product?.fxUsdPerEur != null || template.fxRate != null ? "product" : "settings") };
  }
  return { value: null, source: null };
}

function resolveProductionLeadTimeDays({ product, productSupplier, supplier, settings }) {
  const productValue = toNumber(product?.productionLeadTimeDays ?? product?.productionLeadTimeDaysDefault);
  if (productValue != null && productValue > 0) {
    return { value: productValue, source: "product" };
  }
  const linkValue = toNumber(productSupplier?.productionLeadTimeDays);
  if (linkValue != null && linkValue > 0) {
    return { value: linkValue, source: "productSupplier" };
  }
  const supplierValue = toNumber(supplier?.productionLeadTimeDaysDefault);
  if (supplierValue != null && supplierValue > 0) {
    return { value: supplierValue, source: "supplier" };
  }
  const settingsValue = toNumber(settings?.defaultProductionLeadTimeDays);
  if (settingsValue != null && settingsValue > 0) {
    return { value: settingsValue, source: "settings" };
  }
  return { value: null, source: null };
}

function resolveTransportMode({ product, transportMode }) {
  const template = product?.template?.fields || product?.template || {};
  const candidate = transportMode || template.transportMode || product?.defaultTransportMode || template.transport || "SEA";
  return String(candidate || "SEA").toUpperCase();
}

function resolveTransportLeadTimeDays({ settings, product, transportMode }) {
  const template = product?.template?.fields || product?.template || {};
  const overrideValue = toNumber(product?.transitDays ?? template.transitDays);
  if (overrideValue != null && overrideValue > 0) {
    return { value: overrideValue, source: "product" };
  }
  const leadTimes = settings?.transportLeadTimesDays || {};
  const candidate = toNumber(leadTimes[String(transportMode || "SEA").toLowerCase()]);
  if (candidate != null && candidate > 0) {
    return { value: candidate, source: "settings" };
  }
  return { value: null, source: null };
}

function resolveUnitPriceUsd({ product, productSupplier }) {
  const template = product?.template?.fields || product?.template || {};
  const supplierValue = toNumber(productSupplier?.unitPrice);
  if (supplierValue != null && supplierValue > 0) {
    return { value: supplierValue, source: "productSupplier" };
  }
  const productValue = toNumber(template.unitPriceUsd ?? product?.unitPriceUsd ?? product?.defaultUnitPrice ?? product?.unitPrice);
  if (productValue != null && productValue > 0) {
    return { value: productValue, source: "product" };
  }
  return { value: null, source: null };
}

function resolveCurrency({ product, productSupplier, supplier, settings }) {
  const template = product?.template?.fields || product?.template || {};
  const supplierCurrency = productSupplier?.currency || supplier?.currencyDefault || template.currency || settings?.defaultCurrency;
  const normalized = String(supplierCurrency || "EUR").trim().toUpperCase();
  return ["EUR", "USD", "CNY"].includes(normalized) ? normalized : "EUR";
}

function resolveLogisticsPerUnitEur({ product, productSupplier, fxRate, unitPriceUsd }) {
  const template = product?.template?.fields || product?.template || {};
  const stored = toNumber(product?.logisticsPerUnitEur ?? product?.freightPerUnitEur ?? template.freightEur ?? productSupplier?.logisticsPerUnitEur);
  if (stored != null && stored > 0) {
    return { value: stored, source: "product" };
  }
  const extraPerUnit = toNumber(template.extraPerUnitUsd) || 0;
  const landedCost = toNumber(product?.landedUnitCostEur);
  const estimated = computeFreightPerUnitEur({
    unitPriceUsd: unitPriceUsd != null ? unitPriceUsd + extraPerUnit : null,
    landedCostEur: landedCost,
    fxUsdPerEur: fxRate,
  });
  if (estimated.value != null) {
    return { value: estimated.value, source: "computed" };
  }
  return { value: null, source: null, missingFields: estimated.missingFields || [] };
}

function resolveDutyRatePct({ product, settings }) {
  const template = product?.template?.fields || product?.template || {};
  const candidate = toNumber(product?.dutyRatePct ?? template.dutyPct ?? settings?.dutyRatePct);
  return Number.isFinite(candidate) ? candidate : null;
}

function resolveEustRatePct({ product, settings }) {
  const template = product?.template?.fields || product?.template || {};
  const candidate = toNumber(product?.eustRatePct ?? template.vatImportPct ?? settings?.eustRatePct);
  return Number.isFinite(candidate) ? candidate : null;
}

function resolveDdp({ product, settings }) {
  const template = product?.template?.fields || product?.template || {};
  if (typeof template.ddp === "boolean") return template.ddp;
  if (typeof product?.ddp === "boolean") return product.ddp;
  if (typeof settings?.defaultDdp === "boolean") return settings.defaultDdp;
  return false;
}

function resolvePaymentTerms({ productSupplier, supplier }) {
  if (Array.isArray(productSupplier?.paymentTermsTemplate) && productSupplier.paymentTermsTemplate.length) {
    return { value: productSupplier.paymentTermsTemplate, source: "productSupplier" };
  }
  if (Array.isArray(supplier?.paymentTermsDefault) && supplier.paymentTermsDefault.length) {
    return { value: supplier.paymentTermsDefault, source: "supplier" };
  }
  return { value: null, source: null };
}

export {
  toNumber,
  resolveProductBySku,
  resolveSupplierContext,
  resolveFxRate,
  resolveProductionLeadTimeDays,
  resolveTransportMode,
  resolveTransportLeadTimeDays,
  resolveUnitPriceUsd,
  resolveCurrency,
  resolveLogisticsPerUnitEur,
  resolveDutyRatePct,
  resolveEustRatePct,
  resolveDdp,
  resolvePaymentTerms,
};
