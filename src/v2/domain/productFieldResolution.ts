import { deriveShippingPerUnitEur } from "../../domain/costing/shipping.js";
import {
  resolveCurrency,
  resolveDdp,
  resolveFxRate,
  resolveLogisticsPerUnitEur,
  resolveProductionLeadTimeDays,
  resolveSupplierContext,
  resolveTransportMode,
  resolveTransportLeadTimeDays,
  resolveUnitPriceUsd,
  toNumber,
} from "../../lib/productDefaults.js";

type FieldSource =
  | "product_override"
  | "product_base"
  | "supplier_default"
  | "settings_default"
  | "computed"
  | "none";

interface ResolvedField<T> {
  value: T | null;
  source: FieldSource;
  sourceLabel: string;
  hint: string;
}

interface ProductFieldResolutionResult {
  moqEffective: ResolvedField<number>;
  safetyDohEffective: ResolvedField<number>;
  coverageDohEffective: ResolvedField<number>;
  productionLeadDays: ResolvedField<number>;
  unitPriceUsd: ResolvedField<number>;
  fxRate: ResolvedField<number>;
  logisticsPerUnitEur: ResolvedField<number>;
  transportMode: ResolvedField<string>;
  transitDays: ResolvedField<number>;
  currency: ResolvedField<string>;
  dutyPct: ResolvedField<number>;
  eustPct: ResolvedField<number>;
  ddp: ResolvedField<boolean>;
  shippingSuggestion: {
    value: number | null;
    goodsCostEur: number | null;
    warning: boolean;
  };
}

function sourceLabel(source: FieldSource): string {
  if (source === "product_override") return "Produkt-Override";
  if (source === "product_base") return "Produkt";
  if (source === "supplier_default") return "Supplier Default";
  if (source === "settings_default") return "Settings Default";
  if (source === "computed") return "Berechnet";
  return "Keine Quelle";
}

function buildField<T>(value: T | null, source: FieldSource, hint: string): ResolvedField<T> {
  return {
    value,
    source,
    sourceLabel: sourceLabel(source),
    hint,
  };
}

function toFieldSource(
  source: unknown,
  options: {
    override: boolean;
  } = { override: false },
): FieldSource {
  if (options.override) return "product_override";
  if (source === "product") return "product_base";
  if (source === "productSupplier" || source === "supplier") return "supplier_default";
  if (source === "settings") return "settings_default";
  if (source === "computed") return "computed";
  return "none";
}

function asUpper(value: unknown, fallback: string): string {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function normalizeBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function templateFields(product: Record<string, unknown>): Record<string, unknown> {
  const template = (product.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function pickNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

export function resolveProductFieldResolution(input: {
  product: Record<string, unknown>;
  state: Record<string, unknown>;
  supplierId?: string | null;
}): ProductFieldResolutionResult {
  const product = input.product || {};
  const state = input.state || {};
  const settings = (state.settings || {}) as Record<string, unknown>;
  const template = templateFields(product);
  const sku = String(product.sku || "").trim();

  const { supplier, productSupplier } = resolveSupplierContext(
    state,
    sku,
    input.supplierId || String(product.supplierId || ""),
  );

  const moqOverride = pickNumber(product.moqOverrideUnits);
  const moqBase = pickNumber(product.moqUnits);
  const moqDefault = pickNumber(settings.moqDefaultUnits);
  const moqEffective = moqOverride != null
    ? buildField(moqOverride, "product_override", "Produktspezifisches MOQ.")
    : (moqBase != null
      ? buildField(moqBase, "product_base", "Produktwert ohne Override.")
      : buildField(moqDefault, moqDefault != null ? "settings_default" : "none", "Default aus Settings (MOQ)."));

  const safetyOverride = pickNumber(product.safetyStockDohOverride);
  const safetyDefault = pickNumber(settings.safetyStockDohDefault);
  const safetyDohEffective = safetyOverride != null
    ? buildField(safetyOverride, "product_override", "Produktspezifischer Safety-Wert.")
    : buildField(
      safetyDefault,
      safetyDefault != null ? "settings_default" : "none",
      "Default aus Settings (Safety Stock DOH).",
    );

  const coverageOverride = pickNumber(product.foCoverageDohOverride);
  const coverageDefault = pickNumber(settings.foCoverageDohDefault);
  const coverageDohEffective = coverageOverride != null
    ? buildField(coverageOverride, "product_override", "Produktspezifischer Coverage-Wert.")
    : buildField(
      coverageDefault,
      coverageDefault != null ? "settings_default" : "none",
      "Default aus Settings (FO Coverage DOH).",
    );

  const productionLead = resolveProductionLeadTimeDays({
    product,
    productSupplier,
    supplier,
    settings,
  });
  const productionLeadDays = buildField(
    pickNumber(productionLead.value),
    toFieldSource(productionLead.source, { override: pickNumber(product.productionLeadTimeDaysDefault) != null }),
    "Produktionszeit fuer Planung/Bestellung.",
  );

  const unitPrice = resolveUnitPriceUsd({ product, productSupplier });
  const unitPriceUsd = buildField(
    pickNumber(unitPrice.value),
    toFieldSource(unitPrice.source),
    "Stueckpreis in USD fuer Kostenkalkulation.",
  );

  const fx = resolveFxRate(product, settings);
  const fxRate = buildField(
    pickNumber(fx.value),
    toFieldSource(fx.source),
    "FX in USD je EUR fuer Umrechnung.",
  );

  const logistics = resolveLogisticsPerUnitEur({
    product,
    productSupplier,
    fxRate: fx.value,
    unitPriceUsd: unitPrice.value,
  });
  const logisticsPerUnitEur = buildField(
    pickNumber(logistics.value),
    toFieldSource(logistics.source, {
      override: pickNumber(product.logisticsPerUnitEur ?? product.freightPerUnitEur) != null,
    }),
    "Logistik-/Importanteil je Einheit in EUR.",
  );

  const transport = asUpper(resolveTransportMode({ product, transportMode: template.transportMode }), "SEA");
  const transportSource = template.transportMode || template.transport
    ? "product"
    : "settings";
  const transportMode = buildField(
    transport,
    toFieldSource(transportSource),
    "Transportmodus fuer ETA/Lead-Time.",
  );

  const transit = resolveTransportLeadTimeDays({
    settings,
    product,
    transportMode: transport,
  });
  const transitDays = buildField(
    pickNumber(transit.value),
    toFieldSource(transit.source),
    "Transitzeit in Tagen fuer Planung.",
  );

  const currencyValue = asUpper(
    resolveCurrency({ product, productSupplier, supplier, settings }),
    asUpper(settings.defaultCurrency, "EUR"),
  );
  const currencySource = template.currency
    ? "product"
    : (supplier?.currencyDefault ? "supplier" : "settings");
  const currency = buildField(
    currencyValue,
    toFieldSource(currencySource),
    "Waehrung fuer Kostenwerte.",
  );

  const dutyValue = pickNumber(product.dutyRatePct ?? template.dutyPct ?? settings.dutyRatePct);
  const dutySource = pickNumber(product.dutyRatePct) != null
    ? "product"
    : (pickNumber(template.dutyPct) != null ? "product" : "settings");
  const dutyPct = buildField(
    dutyValue,
    dutyValue != null ? toFieldSource(dutySource) : "none",
    "Zollsatz in Prozent.",
  );

  const eustValue = pickNumber(product.eustRatePct ?? template.vatImportPct ?? settings.eustRatePct);
  const eustSource = pickNumber(product.eustRatePct) != null
    ? "product"
    : (pickNumber(template.vatImportPct) != null ? "product" : "settings");
  const eustPct = buildField(
    eustValue,
    eustValue != null ? toFieldSource(eustSource) : "none",
    "EUSt-Satz in Prozent.",
  );

  const ddpValue = normalizeBool(resolveDdp({ product, settings }));
  const ddpSource = typeof template.ddp === "boolean"
    ? "product"
    : (typeof settings.defaultDdp === "boolean" ? "settings" : "none");
  const ddp = buildField(
    ddpValue,
    toFieldSource(ddpSource),
    "DDP = Importkosten in Lieferpreis enthalten.",
  );

  const shippingSuggestion = deriveShippingPerUnitEur({
    unitCostUsd: unitPrice.value,
    landedUnitCostEur: pickNumber(product.landedUnitCostEur),
    fxEurUsd: fx.value,
  });

  return {
    moqEffective,
    safetyDohEffective,
    coverageDohEffective,
    productionLeadDays,
    unitPriceUsd,
    fxRate,
    logisticsPerUnitEur,
    transportMode,
    transitDays,
    currency,
    dutyPct,
    eustPct,
    ddp,
    shippingSuggestion: {
      value: pickNumber(shippingSuggestion.value),
      goodsCostEur: pickNumber(shippingSuggestion.goodsCostEur),
      warning: shippingSuggestion.warning === true,
    },
  };
}

export type { FieldSource, ProductFieldResolutionResult, ResolvedField };
