function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseUnits(value) {
  if (value == null || value === "") return 0;
  const cleaned = String(value).trim().replace(/\s+/g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function buildSupplierLabelMap(state, products = null) {
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const productList = Array.isArray(products) ? products : (Array.isArray(state.products) ? state.products : []);
  const aliasBySku = new Map(productList.map(prod => [normalizeKey(prod.sku), prod.alias || prod.sku]));
  const supplierKeyIndex = new Map();

  suppliers.forEach(supplier => {
    const idKey = normalizeKey(supplier.id);
    const nameKey = normalizeKey(supplier.name);
    if (idKey) supplierKeyIndex.set(idKey, supplier.id);
    if (nameKey) supplierKeyIndex.set(nameKey, supplier.id);
  });

  const totals = new Map();

  (state.pos || []).forEach(po => {
    const supplierKey = normalizeKey(po.supplierId || po.supplier);
    const supplierId = supplierKey ? supplierKeyIndex.get(supplierKey) : null;
    if (!supplierId) return;
    const addUnits = (sku, units) => {
      const skuKey = normalizeKey(sku);
      if (!skuKey) return;
      const bucket = totals.get(supplierId) || new Map();
      bucket.set(skuKey, (bucket.get(skuKey) || 0) + parseUnits(units));
      totals.set(supplierId, bucket);
    };
    if (Array.isArray(po.items) && po.items.length) {
      po.items.forEach(item => addUnits(item?.sku, item?.units));
    } else {
      addUnits(po.sku, po.units);
    }
  });

  const labelMap = new Map();
  suppliers.forEach(supplier => {
    const company = supplier.company_name ? String(supplier.company_name).trim() : "";
    const topMap = totals.get(supplier.id);
    let topAlias = "noch keine PO";
    if (topMap && topMap.size) {
      let bestSku = "";
      let bestUnits = -1;
      topMap.forEach((units, sku) => {
        if (units > bestUnits) {
          bestUnits = units;
          bestSku = sku;
        }
      });
      if (bestSku) {
        topAlias = aliasBySku.get(bestSku) || bestSku;
      }
    }
    const name = supplier.name || "—";
    const companyLabel = company || "—";
    labelMap.set(supplier.id, `${name} – ${companyLabel} (${topAlias})`);
  });

  return labelMap;
}
