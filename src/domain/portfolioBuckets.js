import { parseDeNumber } from "../lib/dataHealth.js";

export const PORTFOLIO_BUCKET = {
  CORE: "Kernportfolio",
  PLAN: "Planprodukte",
  IDEAS: "Ideenprodukte",
};

export const PORTFOLIO_BUCKET_VALUES = [
  PORTFOLIO_BUCKET.CORE,
  PORTFOLIO_BUCKET.PLAN,
  PORTFOLIO_BUCKET.IDEAS,
];

const PORTFOLIO_BUCKET_ALIASES = new Map([
  [PORTFOLIO_BUCKET.CORE.toLowerCase(), PORTFOLIO_BUCKET.CORE],
  [PORTFOLIO_BUCKET.PLAN.toLowerCase(), PORTFOLIO_BUCKET.PLAN],
  [PORTFOLIO_BUCKET.IDEAS.toLowerCase(), PORTFOLIO_BUCKET.IDEAS],
  ["core", PORTFOLIO_BUCKET.CORE],
  ["kern", PORTFOLIO_BUCKET.CORE],
  ["kernportfolio", PORTFOLIO_BUCKET.CORE],
  ["plan", PORTFOLIO_BUCKET.PLAN],
  ["planned", PORTFOLIO_BUCKET.PLAN],
  ["prelaunch", PORTFOLIO_BUCKET.PLAN],
  ["idea", PORTFOLIO_BUCKET.IDEAS],
  ["ideas", PORTFOLIO_BUCKET.IDEAS],
  ["idee", PORTFOLIO_BUCKET.IDEAS],
  ["ideen", PORTFOLIO_BUCKET.IDEAS],
]);

export const LAUNCH_COST_TYPE_VALUES = [
  "Tooling",
  "Samples",
  "Fotografie",
  "Zertifikat",
  "Packaging",
  "Launch-PPC",
  "Sonstiges",
];

function toIsoDate(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function toNumber(value) {
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

export function normalizePortfolioBucket(value, fallback = PORTFOLIO_BUCKET.CORE) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const normalized = PORTFOLIO_BUCKET_ALIASES.get(raw.toLowerCase());
  return normalized || fallback;
}

export function normalizeIncludeInForecast(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "yes" || raw === "ja") return true;
  if (raw === "false" || raw === "no" || raw === "nein") return false;
  return fallback;
}

export function normalizeLaunchCostType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Sonstiges";
  const match = LAUNCH_COST_TYPE_VALUES.find((entry) => entry.toLowerCase() === raw.toLowerCase());
  return match || "Sonstiges";
}

export function normalizeLaunchCostEntry(entry, fallbackId = "") {
  if (!entry || typeof entry !== "object") return null;
  const amount = toNumber(entry.amountEur ?? entry.amount ?? entry.value);
  const date = toIsoDate(entry.date ?? entry.month);
  if (!Number.isFinite(amount) || amount == null || amount <= 0 || !date) return null;
  const notes = entry.note != null ? String(entry.note).trim() : "";
  const currencyRaw = String(entry.currency || "EUR").trim().toUpperCase();
  const currency = currencyRaw === "USD" ? "USD" : "EUR";
  return {
    id: String(entry.id || fallbackId || ""),
    type: normalizeLaunchCostType(entry.type ?? entry.category),
    amountEur: amount,
    currency,
    date,
    note: notes,
  };
}

export function normalizeLaunchCosts(value, idPrefix = "lc") {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => normalizeLaunchCostEntry(entry, `${idPrefix}-${index + 1}`))
    .filter(Boolean);
}

export function normalizeSkuKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function collectPoSkuSet(state) {
  const set = new Set();
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  pos.forEach((order) => {
    const orderSku = normalizeSkuKey(order?.sku);
    if (orderSku) set.add(orderSku);
    const items = Array.isArray(order?.items) ? order.items : [];
    items.forEach((item) => {
      const sku = normalizeSkuKey(item?.sku);
      if (sku) set.add(sku);
    });
  });
  return set;
}

export function resolveEffectivePortfolioBucket(input) {
  const skuKey = normalizeSkuKey(input?.sku ?? input?.product?.sku);
  const poSkuSet = input?.poSkuSet instanceof Set ? input.poSkuSet : new Set();
  if (skuKey && poSkuSet.has(skuKey)) return PORTFOLIO_BUCKET.CORE;
  return normalizePortfolioBucket(
    input?.product?.portfolioBucket ?? input?.portfolioBucket,
    input?.fallbackBucket || PORTFOLIO_BUCKET.CORE,
  );
}

export function buildProductProfileIndex(state) {
  const map = new Map();
  const poSkuSet = collectPoSkuSet(state);
  const products = Array.isArray(state?.products) ? state.products : [];
  products.forEach((entry) => {
    const product = entry && typeof entry === "object" ? entry : {};
    const sku = String(product.sku || "").trim();
    const skuKey = normalizeSkuKey(sku);
    if (!skuKey) return;
    const bucket = normalizePortfolioBucket(product.portfolioBucket);
    const includeInForecast = normalizeIncludeInForecast(product.includeInForecast, true);
    const effectiveBucket = resolveEffectivePortfolioBucket({ product, poSkuSet, sku });
    map.set(skuKey, {
      sku,
      includeInForecast,
      portfolioBucket: bucket,
      effectivePortfolioBucket: effectiveBucket,
      poExists: poSkuSet.has(skuKey),
    });
  });
  return {
    map,
    poSkuSet,
  };
}

export function resolveProductProfile(input) {
  const state = input?.state || {};
  const product = input?.product && typeof input.product === "object" ? input.product : {};
  const sku = String(input?.sku || product.sku || "").trim();
  const poSkuSet = input?.poSkuSet instanceof Set ? input.poSkuSet : collectPoSkuSet(state);
  const includeInForecast = normalizeIncludeInForecast(product.includeInForecast, true);
  const portfolioBucket = normalizePortfolioBucket(product.portfolioBucket);
  const effectivePortfolioBucket = resolveEffectivePortfolioBucket({
    product,
    sku,
    poSkuSet,
  });
  return {
    sku,
    includeInForecast,
    portfolioBucket,
    effectivePortfolioBucket,
    poExists: poSkuSet.has(normalizeSkuKey(sku)),
  };
}

