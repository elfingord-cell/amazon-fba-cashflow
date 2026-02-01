import { loadAppState } from "../storage/store.js";
import {
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
} from "./productDefaults.js";

const DEFAULT_PAYMENT_TERMS = [
  { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
  { label: "Balance", percent: 70, triggerEvent: "ETD", offsetDays: 0 },
];

function normalizeIncoterm(value) {
  const upper = String(value || "").trim().toUpperCase();
  return upper || "EXW";
}

function normalizeMode(value) {
  const upper = String(value || "").trim().toUpperCase();
  return upper || "SEA";
}

function withDefault(value, fallback) {
  return value == null || value === "" ? fallback : value;
}

function normalizePrefillNumber(value) {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function mapSourceLabel(source) {
  if (!source) return null;
  if (source === "product") return "Produkt";
  if (source === "productSupplier") return "SKU↔Supplier";
  if (source === "supplier") return "Supplier Default";
  if (source === "settings") return "Settings Default";
  if (source === "computed") return "Berechnet";
  return source;
}

function buildResolvedUsingDefaults(label, source) {
  const mapped = mapSourceLabel(source);
  if (!mapped) return null;
  if (source === "product") return null;
  return `${label}: ${mapped}`;
}

export function buildPrefillForSku(skuId, options = {}, ctx = {}) {
  const state = ctx.state || loadAppState();
  const settings = state.settings || {};
  const { product, supplier, supplierId, productSupplier } = resolveSupplierContext(
    state,
    skuId,
    options.supplierId,
  );

  const transportMode = normalizeMode(withDefault(options.transportMode, resolveTransportMode({ product, transportMode: options.transportMode })));
  const incoterm = normalizeIncoterm(withDefault(options.incoterm, product?.defaultIncoterm || supplier?.incotermDefault || "EXW"));
  const transportSource = product?.template?.fields?.transportMode || product?.defaultTransportMode
    ? "product"
    : "settings";
  const incotermSource = product?.defaultIncoterm
    ? "product"
    : (supplier?.incotermDefault ? "supplier" : "settings");
  const currency = resolveCurrency({ product, productSupplier, supplier, settings });

  const fxRate = resolveFxRate(product, settings);
  const productionLead = resolveProductionLeadTimeDays({
    product,
    productSupplier,
    supplier,
    settings,
  });
  const transportLead = resolveTransportLeadTimeDays({
    settings,
    product,
    transportMode,
  });
  const unitPrice = resolveUnitPriceUsd({ product, productSupplier });
  const logistics = resolveLogisticsPerUnitEur({
    product,
    productSupplier,
    fxRate: fxRate.value,
    unitPriceUsd: unitPrice.value,
  });
  const dutyRatePct = resolveDutyRatePct({ product, settings });
  const eustRatePct = resolveEustRatePct({ product, settings });
  const ddp = resolveDdp({ product, settings });
  const paymentTerms = resolvePaymentTerms({ productSupplier, supplier });

  const resolvedUsingDefaults = [
    buildResolvedUsingDefaults("Production Lead Time", productionLead.source),
    buildResolvedUsingDefaults("Transit Lead Time", transportLead.source),
    buildResolvedUsingDefaults("FX", fxRate.source),
    buildResolvedUsingDefaults("Logistik / Stk. (EUR)", logistics.source),
  ].filter(Boolean);

  const paymentTermsValue = paymentTerms.value || DEFAULT_PAYMENT_TERMS;
  const paymentTermsSource = paymentTerms.source || "settings";

  const supplierSource = product?.supplierId
    ? "product"
    : (productSupplier?.supplierId ? "productSupplier" : (supplierId ? "history" : null));

  return {
    sku: product?.sku || skuId || "",
    mode: options.mode || "FO",
    supplierId: supplierId || "",
    transportMode,
    incoterm,
    currency,
    unitPrice: normalizePrefillNumber(unitPrice.value),
    logisticsPerUnitEur: normalizePrefillNumber(logistics.value),
    logisticsMissingFields: logistics.missingFields || [],
    dutyRatePct: normalizePrefillNumber(dutyRatePct),
    eustRatePct: normalizePrefillNumber(eustRatePct),
    fxRate: normalizePrefillNumber(fxRate.value),
    ddp,
    productionLeadTimeDays: normalizePrefillNumber(productionLead.value),
    logisticsLeadTimeDays: normalizePrefillNumber(transportLead.value),
    bufferDays: normalizePrefillNumber(settings.defaultBufferDays ?? 0),
    paymentTerms: paymentTermsValue,
    sources: {
      unitPrice: mapSourceLabel(unitPrice.source),
      logisticsPerUnitEur: mapSourceLabel(logistics.source),
      productionLeadTimeDays: mapSourceLabel(productionLead.source),
      logisticsLeadTimeDays: mapSourceLabel(transportLead.source),
      transportMode: mapSourceLabel(transportSource),
      incoterm: mapSourceLabel(incotermSource),
      fxRate: mapSourceLabel(fxRate.source),
      dutyRatePct: mapSourceLabel(product?.dutyRatePct != null ? "product" : (settings?.dutyRatePct != null ? "settings" : null)),
      eustRatePct: mapSourceLabel(product?.eustRatePct != null ? "product" : (settings?.eustRatePct != null ? "settings" : null)),
      paymentTerms: mapSourceLabel(paymentTermsSource),
      supplier: mapSourceLabel(supplierSource),
    },
    resolvedUsingDefaults,
    resolvedValues: {
      fxRate: fxRate.value,
      productionLeadTimeDays: productionLead.value,
      logisticsLeadTimeDays: transportLead.value,
      logisticsPerUnitEur: logistics.value,
      unitPrice: unitPrice.value,
      currency,
    },
  };
}

export { DEFAULT_PAYMENT_TERMS };
