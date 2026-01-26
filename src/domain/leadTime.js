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
  const mapping = (state?.productSuppliers || []).find(entry =>
    normalizeSku(entry?.sku) === normalizedSku && entry?.supplierId === supplierId
  ) || null;

  const mappingValue = pickLeadTime(mapping?.productionLeadTimeDays);
  if (mappingValue != null) {
    return { value: mappingValue, source: "SKU+Supplier" };
  }

  const supplierDefault = pickLeadTime(supplier?.productionLeadTimeDaysDefault);
  if (supplierDefault != null) {
    return { value: supplierDefault, source: "Supplier" };
  }

  const settingsDefault = pickLeadTime(state?.settings?.defaultProductionLeadTimeDays);
  if (settingsDefault != null) {
    return { value: settingsDefault, source: "Settings" };
  }

  return { value: null, source: "missing" };
}
