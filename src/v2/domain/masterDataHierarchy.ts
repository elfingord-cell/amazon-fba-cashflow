import { parseDeNumber } from "../../lib/dataHealth.js";
import { resolveSupplierContext } from "../../lib/productDefaults.js";

export type HierarchySource = "order_override" | "product" | "supplier" | "settings" | "missing";

export type HierarchyOrderContext = "fo" | "po" | "product";

export interface ResolvedHierarchyField<T> {
  value: T | null;
  source: HierarchySource;
  label: string;
  required: boolean;
  blocking: boolean;
  reason: string;
  canReset: boolean;
  canAdopt: boolean;
}

export interface MasterDataResolvedFields {
  unitPriceUsd: ResolvedHierarchyField<number>;
  avgSellingPriceGrossEur: ResolvedHierarchyField<number>;
  marginPct: ResolvedHierarchyField<number>;
  moqUnits: ResolvedHierarchyField<number>;
  productionLeadTimeDays: ResolvedHierarchyField<number>;
  transitDays: ResolvedHierarchyField<number>;
  logisticsPerUnitEur: ResolvedHierarchyField<number>;
  dutyRatePct: ResolvedHierarchyField<number>;
  eustRatePct: ResolvedHierarchyField<number>;
  ddp: ResolvedHierarchyField<boolean>;
  incoterm: ResolvedHierarchyField<string>;
  currency: ResolvedHierarchyField<string>;
  fxRate: ResolvedHierarchyField<number>;
}

export interface MasterDataResolutionResult {
  sku: string;
  supplierId: string;
  product: Record<string, unknown> | null;
  supplier: Record<string, unknown> | null;
  productSupplier: Record<string, unknown> | null;
  fields: MasterDataResolvedFields;
}

export type AdoptableProductField =
  | "unitPriceUsd"
  | "productionLeadTimeDays"
  | "transitDays"
  | "dutyRatePct"
  | "eustRatePct"
  | "ddp";

interface ResolveMasterDataInput {
  state: Record<string, unknown>;
  product?: Record<string, unknown> | null;
  sku?: string | null;
  supplierId?: string | null;
  orderOverrides?: Record<string, unknown> | null;
  orderContext?: HierarchyOrderContext;
  transportMode?: string | null;
}

interface SourceCandidate<T> {
  source: Exclude<HierarchySource, "missing" | "order_override">;
  value: T | null;
}

const CURRENCIES = new Set(["EUR", "USD", "CNY"]);
const INCOTERMS = new Set(["EXW", "FOB", "DDP", "FCA", "DAP", "CIF"]);

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Number(parsed);
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  const numeric = Number(parsed);
  return numeric > 0 ? numeric : null;
}

function asPercent(value: unknown): number | null {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  const numeric = Number(parsed);
  if (numeric < 0) return null;
  return numeric;
}

function asBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function asCurrency(value: unknown): string | null {
  const upper = normalizeText(value).toUpperCase();
  if (!upper) return null;
  if (!CURRENCIES.has(upper)) return null;
  return upper;
}

function asIncoterm(value: unknown): string | null {
  const upper = normalizeText(value).toUpperCase();
  if (!upper) return null;
  if (!INCOTERMS.has(upper)) return null;
  return upper;
}

function sourceLabel(source: HierarchySource, orderContext: HierarchyOrderContext): string {
  if (source === "order_override") return orderContext === "fo" ? "Diese FO" : orderContext === "po" ? "Diese PO" : "Produkt";
  if (source === "product") return "Produkt";
  if (source === "supplier") return "Lieferant";
  if (source === "settings") return "Settings";
  return "Fehlt";
}

function isEqualValue(left: unknown, right: unknown): boolean {
  if (typeof left === "number" || typeof right === "number") {
    const a = asNumber(left);
    const b = asNumber(right);
    if (a == null || b == null) return false;
    return Math.abs(a - b) < 0.00001;
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    const a = asBool(left);
    const b = asBool(right);
    return a != null && b != null && a === b;
  }
  return normalizeText(left) === normalizeText(right);
}

function firstValid<T>(candidates: Array<SourceCandidate<T>>, validator: (value: T | null) => boolean): SourceCandidate<T> | null {
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (validator(candidate.value)) return candidate;
  }
  return null;
}

function resolveHierarchyField<T>(input: {
  orderContext: HierarchyOrderContext;
  required: boolean;
  reason: string;
  orderOverrideRaw?: unknown;
  parse: (value: unknown) => T | null;
  isValid: (value: T | null) => boolean;
  candidates: Array<SourceCandidate<T>>;
}): ResolvedHierarchyField<T> {
  const base = firstValid(input.candidates, input.isValid);
  const override = input.parse(input.orderOverrideRaw);
  const hasOverride = input.isValid(override) && (!base || !isEqualValue(override, base.value));

  if (hasOverride) {
    return {
      value: override,
      source: "order_override",
      label: sourceLabel("order_override", input.orderContext),
      required: input.required,
      blocking: false,
      reason: input.reason,
      canReset: true,
      canAdopt: input.orderContext === "fo" || input.orderContext === "po",
    };
  }

  if (base) {
    return {
      value: base.value,
      source: base.source,
      label: sourceLabel(base.source, input.orderContext),
      required: input.required,
      blocking: false,
      reason: input.reason,
      canReset: false,
      canAdopt: false,
    };
  }

  return {
    value: null,
    source: "missing",
    label: sourceLabel("missing", input.orderContext),
    required: input.required,
    blocking: input.required,
    reason: input.reason,
    canReset: false,
    canAdopt: false,
  };
}

function templateFields(product: Record<string, unknown> | null): Record<string, unknown> {
  const source = (product?.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (source.fields && typeof source.fields === "object")
    ? source.fields as Record<string, unknown>
    : source;
  return fields || {};
}

function findProductBySku(state: Record<string, unknown>, sku: string): Record<string, unknown> | null {
  const needle = normalizeText(sku).toLowerCase();
  if (!needle) return null;
  const products = Array.isArray(state.products) ? state.products as Record<string, unknown>[] : [];
  return products.find((entry) => normalizeText(entry?.sku).toLowerCase() === needle) || null;
}

function resolveTransportMode(template: Record<string, unknown>, orderOverrides: Record<string, unknown>): string {
  const override = normalizeText(orderOverrides.transportMode || orderOverrides.transport || "").toUpperCase();
  if (override) return override;
  const productMode = normalizeText(template.transportMode || template.transport || "").toUpperCase();
  if (productMode) return productMode;
  return "SEA";
}

export function resolveMasterDataHierarchy(input: ResolveMasterDataInput): MasterDataResolutionResult {
  const state = input.state || {};
  const orderContext = input.orderContext || "product";
  const orderOverrides = (input.orderOverrides && typeof input.orderOverrides === "object")
    ? input.orderOverrides as Record<string, unknown>
    : {};

  const seedSku = normalizeText(input.sku || input.product?.sku);
  const resolvedProduct = (input.product && typeof input.product === "object")
    ? input.product as Record<string, unknown>
    : findProductBySku(state, seedSku);
  const sku = normalizeText(seedSku || resolvedProduct?.sku);

  const supplierContext = resolveSupplierContext(
    state,
    sku,
    normalizeText(input.supplierId || orderOverrides.supplierId || resolvedProduct?.supplierId),
  ) as {
    supplier?: Record<string, unknown> | null;
    supplierId?: string | null;
    productSupplier?: Record<string, unknown> | null;
  };

  const product = resolvedProduct || null;
  const supplier = supplierContext.supplier || null;
  const productSupplier = supplierContext.productSupplier || null;
  const supplierId = normalizeText(input.supplierId || orderOverrides.supplierId || supplierContext.supplierId || product?.supplierId);

  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const template = templateFields(product);
  const transportMode = resolveTransportMode(template, orderOverrides);
  const settingsTransport = (settings.transportLeadTimesDays && typeof settings.transportLeadTimesDays === "object")
    ? settings.transportLeadTimesDays as Record<string, unknown>
    : {};

  const unitPriceUsd = resolveHierarchyField<number>({
    orderContext,
    required: true,
    reason: "EK Preis USD fehlt.",
    orderOverrideRaw: orderOverrides.unitPrice ?? orderOverrides.unitCostUsd,
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(template.unitPriceUsd ?? product?.unitPriceUsd ?? product?.unitPrice) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.unitPrice ?? supplier?.unitPriceDefault) },
    ],
  });

  const avgSellingPriceGrossEur = resolveHierarchyField<number>({
    orderContext,
    required: true,
    reason: "VK Preis Brutto fehlt.",
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(product?.avgSellingPriceGrossEUR) },
    ],
  });

  const marginPct = resolveHierarchyField<number>({
    orderContext,
    required: true,
    reason: "Marge muss > 0 sein.",
    parse: asPercent,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPercent(product?.sellerboardMarginPct) },
    ],
  });

  const moqUnits = resolveHierarchyField<number>({
    orderContext,
    required: true,
    reason: "MOQ fehlt.",
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(product?.moqOverrideUnits ?? product?.moqUnits) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.minOrderQty ?? supplier?.moqDefaultUnits ?? supplier?.minOrderQty) },
      { source: "settings", value: asPositiveNumber(settings.moqDefaultUnits) },
    ],
  });

  const productionLeadTimeDays = resolveHierarchyField<number>({
    orderContext,
    required: true,
    reason: "Production Lead Time fehlt.",
    orderOverrideRaw: orderOverrides.productionLeadTimeDays ?? orderOverrides.prodDays,
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(product?.productionLeadTimeDaysDefault ?? template.productionDays) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.productionLeadTimeDays ?? supplier?.productionLeadTimeDaysDefault) },
      { source: "settings", value: asPositiveNumber(settings.defaultProductionLeadTimeDays) },
    ],
  });

  const transitDays = resolveHierarchyField<number>({
    orderContext,
    required: false,
    reason: "Transit Lead Time fehlt.",
    orderOverrideRaw: orderOverrides.logisticsLeadTimeDays ?? orderOverrides.transitDays,
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(template.transitDays ?? product?.transitDays) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.transitDays ?? supplier?.transitDaysDefault) },
      { source: "settings", value: asPositiveNumber(settingsTransport[transportMode.toLowerCase()]) },
      { source: "settings", value: asPositiveNumber(settingsTransport.sea) },
    ],
  });

  const logisticsPerUnitEur = resolveHierarchyField<number>({
    orderContext,
    required: false,
    reason: "Logistik pro Einheit fehlt.",
    orderOverrideRaw: orderOverrides.logisticsPerUnitEur ?? orderOverrides.freightPerUnitEur,
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(product?.logisticsPerUnitEur ?? product?.freightPerUnitEur ?? template.freightEur) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.logisticsPerUnitEur) },
    ],
  });

  const dutyRatePct = resolveHierarchyField<number>({
    orderContext,
    required: false,
    reason: "Zollsatz fehlt.",
    orderOverrideRaw: orderOverrides.dutyRatePct,
    parse: asPercent,
    isValid: (value) => Number.isFinite(value as number) && Number(value) >= 0,
    candidates: [
      { source: "product", value: asPercent(product?.dutyRatePct ?? template.dutyPct) },
      { source: "supplier", value: asPercent(productSupplier?.dutyRatePct ?? supplier?.dutyRatePct) },
      { source: "settings", value: asPercent(settings.dutyRatePct) },
    ],
  });

  const eustRatePct = resolveHierarchyField<number>({
    orderContext,
    required: false,
    reason: "EUSt Satz fehlt.",
    orderOverrideRaw: orderOverrides.eustRatePct,
    parse: asPercent,
    isValid: (value) => Number.isFinite(value as number) && Number(value) >= 0,
    candidates: [
      { source: "product", value: asPercent(product?.eustRatePct ?? template.vatImportPct) },
      { source: "supplier", value: asPercent(productSupplier?.eustRatePct ?? supplier?.eustRatePct) },
      { source: "settings", value: asPercent(settings.eustRatePct) },
    ],
  });

  const ddp = resolveHierarchyField<boolean>({
    orderContext,
    required: false,
    reason: "DDP Flag fehlt.",
    orderOverrideRaw: orderOverrides.ddp,
    parse: asBool,
    isValid: (value) => value === true || value === false,
    candidates: [
      { source: "product", value: asBool(template.ddp ?? product?.ddp) },
      { source: "supplier", value: asBool(productSupplier?.ddp ?? supplier?.defaultDdp) },
      { source: "settings", value: asBool(settings.defaultDdp) },
    ],
  });

  const incoterm = resolveHierarchyField<string>({
    orderContext,
    required: false,
    reason: "Incoterm fehlt.",
    orderOverrideRaw: orderOverrides.incoterm,
    parse: asIncoterm,
    isValid: (value) => Boolean(value),
    candidates: [
      { source: "product", value: asIncoterm(product?.defaultIncoterm ?? template.incoterm) },
      { source: "supplier", value: asIncoterm(productSupplier?.incoterm ?? supplier?.incotermDefault) },
      { source: "settings", value: asIncoterm(settings.defaultIncoterm) },
    ],
  });

  const currency = resolveHierarchyField<string>({
    orderContext,
    required: false,
    reason: "Währung fehlt.",
    orderOverrideRaw: orderOverrides.currency,
    parse: asCurrency,
    isValid: (value) => Boolean(value),
    candidates: [
      { source: "product", value: asCurrency(template.currency ?? product?.currency) },
      { source: "supplier", value: asCurrency(productSupplier?.currency ?? supplier?.currencyDefault) },
      { source: "settings", value: asCurrency(settings.defaultCurrency) },
    ],
  });

  const fxRate = resolveHierarchyField<number>({
    orderContext,
    required: false,
    reason: "FX Rate fehlt.",
    orderOverrideRaw: orderOverrides.fxRate ?? orderOverrides.fxOverride,
    parse: asPositiveNumber,
    isValid: (value) => Number.isFinite(value as number) && Number(value) > 0,
    candidates: [
      { source: "product", value: asPositiveNumber(template.fxRate ?? product?.fxRate ?? product?.fxUsdPerEur) },
      { source: "supplier", value: asPositiveNumber(productSupplier?.fxRate ?? supplier?.fxRateDefault) },
      { source: "settings", value: asPositiveNumber(settings.fxRate) },
    ],
  });

  return {
    sku,
    supplierId,
    product,
    supplier,
    productSupplier,
    fields: {
      unitPriceUsd,
      avgSellingPriceGrossEur,
      marginPct,
      moqUnits,
      productionLeadTimeDays,
      transitDays,
      logisticsPerUnitEur,
      dutyRatePct,
      eustRatePct,
      ddp,
      incoterm,
      currency,
      fxRate,
    },
  };
}

export function applyAdoptedFieldToProduct(input: {
  product: Record<string, unknown>;
  field: AdoptableProductField;
  value: unknown;
}): Record<string, unknown> {
  const product = { ...(input.product || {}) };
  const templateSource = (product.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const templateFields = (templateSource.fields && typeof templateSource.fields === "object")
    ? { ...(templateSource.fields as Record<string, unknown>) }
    : { ...templateSource };

  const numeric = asNumber(input.value);
  const bool = asBool(input.value);

  if (input.field === "unitPriceUsd") {
    if (numeric == null || numeric <= 0) return product;
    templateFields.unitPriceUsd = numeric;
  }
  if (input.field === "productionLeadTimeDays") {
    if (numeric == null || numeric <= 0) return product;
    product.productionLeadTimeDaysDefault = Math.round(numeric);
  }
  if (input.field === "transitDays") {
    if (numeric == null || numeric <= 0) return product;
    templateFields.transitDays = Math.round(numeric);
  }
  if (input.field === "dutyRatePct") {
    if (numeric == null || numeric < 0) return product;
    templateFields.dutyPct = numeric;
    product.dutyRatePct = numeric;
  }
  if (input.field === "eustRatePct") {
    if (numeric == null || numeric < 0) return product;
    templateFields.vatImportPct = numeric;
    product.eustRatePct = numeric;
  }
  if (input.field === "ddp") {
    if (bool == null) return product;
    templateFields.ddp = bool;
    product.ddp = bool;
  }

  product.template = {
    ...templateSource,
    scope: "SKU",
    name: String((templateSource.name as string) || "Standard (SKU)"),
    fields: templateFields,
  };

  return product;
}

export function sourceChipClass(source: HierarchySource, required = false): string {
  if (source === "supplier") return "v2-source-chip v2-source-chip--supplier";
  if (source === "settings") return "v2-source-chip v2-source-chip--settings";
  if (source === "missing" && required) return "v2-source-chip v2-source-chip--missing";
  if (source === "order_override") return "v2-source-chip v2-source-chip--override";
  return "v2-source-chip";
}

export function isBlockScope(status: unknown): boolean {
  const normalized = normalizeText(status).toLowerCase();
  return !normalized || normalized === "active" || normalized === "aktiv" || normalized === "prelaunch" || normalized === "not_launched" || normalized === "planned";
}
