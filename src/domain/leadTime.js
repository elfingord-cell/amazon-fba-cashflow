function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function pickLeadTime(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function resolveProductionLeadTimeDays({ sku, supplierId, state }) {
  const normalizedSku = normalizeSku(sku);
  const supplier = (state?.suppliers || []).find(item => item.id === supplierId) || null;
  const product = (state?.products || []).find(item => normalizeSku(item.sku) === normalizedSku) || null;
  const mapping = (state?.productSuppliers || []).find(entry =>
    normalizeSku(entry?.sku) === normalizedSku && entry?.supplierId === supplierId
  ) || null;

  const overrideFromSupplier = supplier?.skuOverrides || {};
  const overrideEntry = overrideFromSupplier[sku] || overrideFromSupplier[normalizedSku] || null;
  const overrideValue = pickLeadTime(overrideEntry?.productionLeadTimeDays);
  if (overrideValue != null) {
    return { value: overrideValue, source: "Supplier×SKU" };
  }

  const mappingValue = pickLeadTime(mapping?.productionLeadTimeDays);
  if (mappingValue != null) {
    return { value: mappingValue, source: "Supplier×SKU" };
  }

  const supplierDefault = pickLeadTime(supplier?.productionLeadTimeDaysDefault);
  if (supplierDefault != null) {
    return { value: supplierDefault, source: "Supplier Default" };
  }

  const productDefault = pickLeadTime(product?.productionLeadTimeDaysDefault);
  if (productDefault != null) {
    return { value: productDefault, source: "Product Default" };
  }

  return { value: null, source: "missing" };
}
