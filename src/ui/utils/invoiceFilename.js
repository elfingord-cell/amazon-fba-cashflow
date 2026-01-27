function sanitizeChunk(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function formatDateIso(input, fallback) {
  if (!input) return fallback;
  if (typeof input === "string") {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return match[0];
  }
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  return fallback;
}

function formatEurAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0-00";
  return numeric.toFixed(2).replace(/\./g, "-").replace(/,/g, "");
}

function parseUnits(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMainSku(po, products = []) {
  const items = Array.isArray(po?.items) ? po.items.filter(Boolean) : [];
  let selected = null;
  if (items.length === 1) {
    selected = items[0];
  } else if (items.length > 1) {
    selected = items.reduce((best, item) => {
      const units = parseUnits(item?.units);
      const bestUnits = parseUnits(best?.units);
      if (units > bestUnits) return item;
      return best || item;
    }, null);
  }

  let sku = selected?.sku || "";
  if (!sku) {
    const fallback = items.find(item => item?.sku || item?.alias);
    sku = fallback?.sku || fallback?.alias || "";
  }
  if (!sku) sku = po?.sku || "";
  if (!sku && po?.sku) {
    const match = products.find(product => String(product?.sku || "").toLowerCase() === String(po?.sku || "").toLowerCase());
    sku = match?.alias || match?.sku || "";
  }
  if (!sku && products.length) {
    const fallbackProduct = products.find(product => product?.alias || product?.sku);
    sku = fallbackProduct?.alias || fallbackProduct?.sku || "";
  }
  return sku || "SKU";
}

function normalizePaymentType(typeLabel, eventType) {
  const label = String(typeLabel || "").toLowerCase();
  const event = String(eventType || "").toLowerCase();
  if (event === "freight") return "Fracht";
  if (event === "eust") return "EUSt";
  if (event === "duty") return "Zoll";
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("shipping") || label.includes("fracht")) return "Fracht";
  if (label.includes("eust")) return "EUSt";
  if (label.includes("zoll") || label.includes("duty")) return "Zoll";
  if (label.includes("other") || label.includes("sonst")) return "Other";
  return "Other";
}

export function getSuggestedInvoiceFilename(po, payment, options = {}) {
  if (!po || !payment) return "";
  const fallbackDate = "YYYY-MM-DD";
  const paid = payment.status === "paid" || payment.status === "PAID" || payment.isPaid === true;
  const dateSource = paid ? payment.paidDate : payment.dueDate;
  const date = formatDateIso(dateSource, fallbackDate);
  const rawNumber = options.poNumber || po?.poNo || po?.poNumber || po?.id || "";
  const numberPart = String(rawNumber || "").trim().replace(/^PO/i, "");
  const poNumber = `PO${numberPart}`;
  const supplierRaw = po?.supplier || po?.supplierName || po?.supplierId || "";
  const supplier = sanitizeChunk(supplierRaw) || "Supplier";
  const mainSkuRaw = resolveMainSku(po, options.products || []);
  const mainSku = sanitizeChunk(mainSkuRaw) || "SKU";
  const paymentTypeRaw = normalizePaymentType(payment.typeLabel || payment.label, payment.eventType || payment.type);
  const paymentType = sanitizeChunk(paymentTypeRaw) || "Other";
  const amountRaw = paid ? payment.amountActualEur ?? payment.paidEurActual : payment.amountPlannedEur ?? payment.plannedEur;
  const amount = `${formatEurAmount(amountRaw)}EUR`;

  const buildFilename = (supplierValue, skuValue) => {
    const parts = [date, poNumber, supplierValue, skuValue, paymentType, amount];
    const base = parts.filter(Boolean).join("_");
    return `${base}.pdf`;
  };

  let filename = buildFilename(supplier, mainSku);
  if (filename.length > 120) {
    const shortSupplier = supplier.slice(0, 20);
    const shortSku = mainSku.slice(0, 25);
    filename = buildFilename(shortSupplier, shortSku);
  }
  return filename.replace(/[-_]{2,}/g, "-");
}
