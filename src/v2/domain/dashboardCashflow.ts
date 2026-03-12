import { PORTFOLIO_BUCKET, PORTFOLIO_BUCKET_VALUES } from "../../domain/portfolioBuckets.js";
import { buildHybridClosingBalanceSeries } from "./closingBalanceSeries";

export interface DashboardCashflowEntry {
  id?: string;
  direction?: "in" | "out" | string;
  amount?: number;
  label?: string;
  tooltip?: string;
  date?: string;
  kind?: string;
  group?: string;
  source?: "po" | "fo" | "sales" | "fixcosts" | "extras" | "dividends" | "vat" | string;
  portfolioBucket?: string | null;
  sourceNumber?: string;
  sourceId?: string;
  paid?: boolean;
  provisional?: boolean;
  meta?: Record<string, unknown>;
}

export interface DashboardCashflowBreakdownRow {
  month: string;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  net: number;
  plannedClosing?: number;
  actualClosing?: number | null;
  hasActualClosing?: boolean;
  entries?: DashboardCashflowEntry[];
}

export interface DashboardScopedBreakdownRow extends DashboardCashflowBreakdownRow {
  hasActualClosing: boolean;
}

export interface DashboardMonthAggregation {
  entries: DashboardCashflowEntry[];
  inflow: {
    amazon: number;
    amazonCore: number;
    amazonPlanned: number;
    amazonNew: number;
    other: number;
    total: number;
  };
  outflow: {
    fixcost: number;
    po: number;
    fo: number;
    phantomFo: number;
    other: number;
    total: number;
  };
  totals: {
    cashIn: number;
    cashOut: number;
    net: number;
  };
}

export function resolveDashboardEntryBucket(entry: DashboardCashflowEntry): string | null {
  const direct = typeof entry.portfolioBucket === "string" ? entry.portfolioBucket : null;
  if (direct) return direct;
  const meta = (entry.meta && typeof entry.meta === "object") ? entry.meta as Record<string, unknown> : {};
  return typeof meta.portfolioBucket === "string" ? String(meta.portfolioBucket) : null;
}

export function isDashboardEntryInBucketScope(entry: DashboardCashflowEntry, bucketScope: Set<string>): boolean {
  const bucket = resolveDashboardEntryBucket(entry);
  if (!bucket) return true;
  if (!PORTFOLIO_BUCKET_VALUES.includes(bucket)) return true;
  return bucketScope.has(bucket);
}

export function isDashboardPhantomFoEntry(
  entryRaw: DashboardCashflowEntry,
  provisionalFoIds?: Set<string>,
): boolean {
  const source = String(entryRaw.source || "").toLowerCase();
  if (source !== "fo") return false;
  const sourceId = String(entryRaw.sourceId || "").trim();
  const meta = (entryRaw.meta && typeof entryRaw.meta === "object")
    ? entryRaw.meta as Record<string, unknown>
    : {};
  return entryRaw.provisional === true
    || meta.phantom === true
    || (sourceId ? provisionalFoIds?.has(sourceId) === true : false);
}

export function aggregateDashboardMonthEntries(
  entries: DashboardCashflowEntry[],
  options?: {
    bucketScope?: Set<string>;
    includePhantomFo?: boolean;
    provisionalFoIds?: Set<string>;
  },
): DashboardMonthAggregation {
  const bucketScope = options?.bucketScope;
  const includePhantomFo = options?.includePhantomFo !== false;
  const provisionalFoIds = options?.provisionalFoIds;
  const filteredEntries = (Array.isArray(entries) ? entries : [])
    .filter((entryRaw) => !!entryRaw && typeof entryRaw === "object")
    .filter((entryRaw) => !bucketScope || isDashboardEntryInBucketScope(entryRaw, bucketScope))
    .filter((entryRaw) => includePhantomFo || !isDashboardPhantomFoEntry(entryRaw, provisionalFoIds));

  const inflow = {
    amazon: 0,
    amazonCore: 0,
    amazonPlanned: 0,
    amazonNew: 0,
    other: 0,
    total: 0,
  };
  const outflow = {
    fixcost: 0,
    po: 0,
    fo: 0,
    phantomFo: 0,
    other: 0,
    total: 0,
  };

  filteredEntries.forEach((entry) => {
    const direction = String(entry.direction || "").toLowerCase();
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) return;

    if (direction === "in") {
      const source = String(entry.source || "").toLowerCase();
      const kind = String(entry.kind || "").toLowerCase();
      const isAmazon = source === "sales" || source === "sales-plan" || kind === "sales-payout";
      if (isAmazon) {
        const bucket = resolveDashboardEntryBucket(entry);
        if (bucket === PORTFOLIO_BUCKET.PLAN) {
          inflow.amazonPlanned += amount;
        } else if (bucket === PORTFOLIO_BUCKET.IDEAS) {
          inflow.amazonNew += amount;
        } else {
          inflow.amazonCore += amount;
        }
        inflow.amazon += amount;
      } else {
        inflow.other += amount;
      }
      inflow.total += amount;
      return;
    }

    if (direction !== "out") return;

    const source = String(entry.source || "").toLowerCase();
    const group = String(entry.group || "").toLowerCase();
    if (source === "po") {
      outflow.po += amount;
    } else if (source === "fo") {
      const isPhantom = isDashboardPhantomFoEntry(entry, provisionalFoIds);
      if (isPhantom) outflow.phantomFo += amount;
      else outflow.fo += amount;
    } else if (source === "fixcosts" || group === "fixkosten") {
      outflow.fixcost += amount;
    } else {
      outflow.other += amount;
    }
    outflow.total += amount;
  });

  return {
    entries: filteredEntries,
    inflow,
    outflow,
    totals: {
      cashIn: inflow.total,
      cashOut: outflow.total,
      net: inflow.total - outflow.total,
    },
  };
}

export function applyDashboardBucketScopeToBreakdown(
  rows: DashboardCashflowBreakdownRow[],
  bucketScope: Set<string>,
  options?: {
    includePhantomFo?: boolean;
    provisionalFoIds?: Set<string>;
  },
): DashboardScopedBreakdownRow[] {
  if (!rows.length) return [];

  const scopedRows = rows.map((row) => {
    const monthAggregation = aggregateDashboardMonthEntries(
      Array.isArray(row.entries) ? row.entries : [],
      {
        bucketScope,
        includePhantomFo: options?.includePhantomFo,
        provisionalFoIds: options?.provisionalFoIds,
      },
    );
    return {
      ...row,
      inflow: monthAggregation.totals.cashIn,
      outflow: monthAggregation.totals.cashOut,
      net: monthAggregation.totals.net,
      entries: monthAggregation.entries,
    };
  });

  const firstOpening = Number(rows[0]?.opening || 0);
  const closingSeries = buildHybridClosingBalanceSeries({
    rows: scopedRows.map((row) => ({
      month: row.month,
      net: row.net,
      actualClosing: row.actualClosing,
    })),
    initialOpening: firstOpening,
  });

  return scopedRows.map((row, index) => {
    const derived = closingSeries[index];
    return {
      ...row,
      opening: Number(derived?.opening ?? row.opening ?? 0),
      closing: Number(derived?.closing ?? row.closing ?? 0),
      hasActualClosing: derived?.lockedActual === true,
    };
  });
}
