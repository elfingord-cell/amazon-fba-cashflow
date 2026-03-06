import { addMonths, normalizeMonthKey } from "./months";

export type ShortageIssueType = "stock_oos" | "stock_under_safety";

export interface ShortageAcceptanceOverride {
  sku: string;
  reason: ShortageIssueType;
  acceptedFromMonth: string;
  acceptedUntilMonth: string;
  durationMonths: number;
}

export interface PfoWorklistDecision {
  id: string;
  sku: string;
  issueType: ShortageIssueType;
  firstRiskMonth: string;
  orderMonth: string;
  decision: "fo_converted";
  decidedAt: string | null;
  source: string;
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSkuKey(value: unknown): string {
  return normalizeSku(value).toLowerCase();
}

export function normalizeShortageIssueType(value: unknown): ShortageIssueType | null {
  const text = String(value || "").trim().toLowerCase();
  if (text === "stock_oos") return "stock_oos";
  if (text === "stock_under_safety") return "stock_under_safety";
  return null;
}

export function buildShortageAcceptanceStorageKey(input: {
  sku: string;
  reason: ShortageIssueType;
  acceptedFromMonth: string;
}): string {
  return `${normalizeSkuKey(input.sku)}::${input.reason}::${input.acceptedFromMonth}`;
}

export function resolveShortageAcceptancesBySku(settings: Record<string, unknown>): Map<string, ShortageAcceptanceOverride[]> {
  const rawBySku = (settings.phantomFoShortageAcceptBySku && typeof settings.phantomFoShortageAcceptBySku === "object")
    ? settings.phantomFoShortageAcceptBySku as Record<string, unknown>
    : {};
  const map = new Map<string, ShortageAcceptanceOverride[]>();
  Object.entries(rawBySku).forEach(([key, raw]) => {
    if (!raw || typeof raw !== "object") return;
    const entry = raw as Record<string, unknown>;
    const keySku = String(key || "").includes("::") ? String(key).split("::")[0] : key;
    const sku = normalizeSku(entry.sku || keySku);
    const skuKey = normalizeSkuKey(sku);
    if (!sku || !skuKey) return;
    const reason = normalizeShortageIssueType(entry.reason || entry.issueType);
    if (!reason) return;
    const acceptedFromMonth = normalizeMonthKey(entry.acceptedFromMonth || entry.startMonth || entry.firstRiskMonth);
    if (!acceptedFromMonth) return;
    const durationMonths = Math.max(1, Math.round(Number(entry.durationMonths || 1)));
    const acceptedUntilMonth = normalizeMonthKey(entry.acceptedUntilMonth || entry.untilMonth)
      || addMonths(acceptedFromMonth, durationMonths - 1);
    if (!acceptedUntilMonth) return;
    const list = map.get(skuKey) || [];
    const duplicateIndex = list.findIndex((current) => (
      current.reason === reason
      && current.acceptedFromMonth === acceptedFromMonth
    ));
    const nextEntry: ShortageAcceptanceOverride = {
      sku,
      reason,
      acceptedFromMonth,
      acceptedUntilMonth,
      durationMonths,
    };
    if (duplicateIndex >= 0) list[duplicateIndex] = nextEntry;
    else list.push(nextEntry);
    list.sort((left, right) => {
      const byStart = left.acceptedFromMonth.localeCompare(right.acceptedFromMonth);
      if (byStart !== 0) return byStart;
      const byEnd = left.acceptedUntilMonth.localeCompare(right.acceptedUntilMonth);
      if (byEnd !== 0) return byEnd;
      return left.reason.localeCompare(right.reason);
    });
    map.set(skuKey, list);
  });
  return map;
}

export function resolveActiveShortageAcceptance(input: {
  acceptanceBySku: Map<string, ShortageAcceptanceOverride[]>;
  sku: string;
  month: string;
  issueType?: ShortageIssueType | null;
}): ShortageAcceptanceOverride | null {
  const skuKey = normalizeSkuKey(input.sku);
  const month = normalizeMonthKey(input.month);
  if (!skuKey || !month) return null;
  const acceptances = input.acceptanceBySku.get(skuKey) || [];
  return acceptances.find((acceptance) => {
    if (month < acceptance.acceptedFromMonth || month > acceptance.acceptedUntilMonth) return false;
    if (input.issueType && acceptance.reason !== input.issueType) return false;
    return true;
  }) || null;
}

export function hasActiveShortageAcceptance(input: {
  acceptanceBySku: Map<string, ShortageAcceptanceOverride[]>;
  sku: string;
  month: string;
  issueType: ShortageIssueType;
}): boolean {
  return Boolean(resolveActiveShortageAcceptance(input));
}

export function shortageAcceptActionLabel(issueType: ShortageIssueType): string {
  return issueType === "stock_oos" ? "OOS akzeptieren" : "Unter Safety akzeptieren";
}

export function shortageAcceptanceTagLabel(acceptance: ShortageAcceptanceOverride): string {
  const reasonText = acceptance.reason === "stock_oos" ? "OOS akzeptiert" : "Unter Safety akzeptiert";
  const duration = Math.max(1, Math.round(Number(acceptance.durationMonths || 1)));
  const durationText = duration === 1 ? "1 Monat" : `${duration} Monate`;
  return `${reasonText} (${durationText})`;
}

export function resolvePfoWorklistDecisionById(settings: Record<string, unknown>): Map<string, PfoWorklistDecision> {
  const rawById = (settings.phantomFoWorklistDecisionById && typeof settings.phantomFoWorklistDecisionById === "object")
    ? settings.phantomFoWorklistDecisionById as Record<string, unknown>
    : {};
  const map = new Map<string, PfoWorklistDecision>();
  Object.entries(rawById).forEach(([id, raw]) => {
    if (!raw || typeof raw !== "object") return;
    const entry = raw as Record<string, unknown>;
    const decision = String(entry.decision || "").trim();
    if (decision !== "fo_converted") return;
    const resolvedId = String(entry.id || id).trim();
    if (!resolvedId) return;
    const issueType = normalizeShortageIssueType(entry.issueType);
    if (!issueType) return;
    map.set(resolvedId, {
      id: resolvedId,
      sku: normalizeSku(entry.sku),
      issueType,
      firstRiskMonth: normalizeMonthKey(entry.firstRiskMonth) || "",
      orderMonth: normalizeMonthKey(entry.orderMonth) || "",
      decision: "fo_converted",
      decidedAt: entry.decidedAt ? String(entry.decidedAt) : null,
      source: String(entry.source || "").trim(),
    });
  });
  return map;
}
