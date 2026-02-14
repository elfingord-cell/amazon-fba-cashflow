import { deriveShippingPerUnitEur } from "../../domain/costing/shipping.js";
import {
  resolveMasterDataHierarchy,
  type HierarchySource,
  type ResolvedHierarchyField,
} from "./masterDataHierarchy";

type FieldSource = HierarchySource | "computed";

interface ResolvedField<T> {
  value: T | null;
  source: FieldSource;
  sourceLabel: string;
  hint: string;
  required?: boolean;
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
  if (source === "order_override") return "Diese PO/FO";
  if (source === "product") return "Produkt";
  if (source === "supplier") return "Lieferant";
  if (source === "settings") return "Settings";
  if (source === "computed") return "Berechnet";
  return "Fehlt";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function buildField<T>(source: ResolvedHierarchyField<T>, hint: string): ResolvedField<T> {
  return {
    value: source.value,
    source: source.source,
    sourceLabel: sourceLabel(source.source),
    hint,
    required: source.required,
  };
}

function fieldFromValue<T>(value: T | null, source: FieldSource, hint: string, required = false): ResolvedField<T> {
  return {
    value,
    source,
    sourceLabel: sourceLabel(source),
    hint,
    required,
  };
}

function pickPositive(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
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

  const hierarchy = resolveMasterDataHierarchy({
    state,
    product,
    sku: String(product.sku || ""),
    supplierId: input.supplierId || String(product.supplierId || ""),
    orderContext: "product",
  });

  const moqEffective = buildField(hierarchy.fields.moqUnits, "MOQ für Einkaufsplanung.");

  const safetyOverride = pickPositive(product.safetyStockDohOverride);
  const safetyDefault = pickPositive(settings.safetyStockDohDefault);
  const safetyDohEffective = safetyOverride != null
    ? fieldFromValue(safetyOverride, "product", "Produktspezifischer Safety-Wert.")
    : fieldFromValue(safetyDefault, safetyDefault != null ? "settings" : "missing", "Default aus Settings (Safety Stock DOH).");

  const coverageOverride = pickPositive(product.foCoverageDohOverride);
  const coverageDefault = pickPositive(settings.foCoverageDohDefault);
  const coverageDohEffective = coverageOverride != null
    ? fieldFromValue(coverageOverride, "product", "Produktspezifischer Coverage-Wert.")
    : fieldFromValue(coverageDefault, coverageDefault != null ? "settings" : "missing", "Default aus Settings (FO Coverage DOH).");

  const transportValue = String(template.transportMode || template.transport || "SEA").toUpperCase() || "SEA";
  const transportSource: FieldSource = template.transportMode || template.transport ? "product" : "settings";

  const logisticsSource = hierarchy.fields.logisticsPerUnitEur.value != null
    ? buildField(hierarchy.fields.logisticsPerUnitEur, "Logistik-/Importanteil je Einheit in EUR.")
    : fieldFromValue(null, "missing", "Logistik-/Importanteil je Einheit in EUR.");

  const shippingSuggestion = deriveShippingPerUnitEur({
    unitCostUsd: hierarchy.fields.unitPriceUsd.value,
    landedUnitCostEur: toNumber(product.landedUnitCostEur),
    fxEurUsd: hierarchy.fields.fxRate.value,
  });

  const logisticsPerUnitEur = logisticsSource.value != null
    ? logisticsSource
    : fieldFromValue(
      toNumber(shippingSuggestion.value),
      Number.isFinite(Number(shippingSuggestion.value)) ? "computed" : "missing",
      "Logistik-/Importanteil je Einheit in EUR.",
    );

  return {
    moqEffective,
    safetyDohEffective,
    coverageDohEffective,
    productionLeadDays: buildField(hierarchy.fields.productionLeadTimeDays, "Produktionszeit für Planung/Bestellung."),
    unitPriceUsd: buildField(hierarchy.fields.unitPriceUsd, "Stückpreis in USD für Kostenkalkulation."),
    fxRate: buildField(hierarchy.fields.fxRate, "FX in USD je EUR für Umrechnung."),
    logisticsPerUnitEur,
    transportMode: fieldFromValue(transportValue, transportSource, "Transportmodus für ETA/Lead-Time."),
    transitDays: buildField(hierarchy.fields.transitDays, "Transitzeit in Tagen für Planung."),
    currency: buildField(hierarchy.fields.currency, "Währung für Kostenwerte."),
    dutyPct: buildField(hierarchy.fields.dutyRatePct, "Zollsatz in Prozent."),
    eustPct: buildField(hierarchy.fields.eustRatePct, "EUSt-Satz in Prozent."),
    ddp: buildField(hierarchy.fields.ddp, "DDP = Importkosten in Lieferpreis enthalten."),
    shippingSuggestion: {
      value: toNumber(shippingSuggestion.value),
      goodsCostEur: toNumber(shippingSuggestion.goodsCostEur),
      warning: shippingSuggestion.warning === true,
    },
  };
}

export type { FieldSource, ProductFieldResolutionResult, ResolvedField };
