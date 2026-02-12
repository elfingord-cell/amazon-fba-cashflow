import { parseDeNumber } from "../../lib/dataHealth.js";

export function normalizeMonthKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const deMatch = raw.match(/^(\d{2})-(\d{4})$/);
  if (deMatch) return `${deMatch[2]}-${deMatch[1]}`;
  return null;
}

export function normalizeMonthInEntry<T extends Record<string, unknown>>(entry: T): { value: T; normalized: boolean } {
  const monthValue = normalizeMonthKey(entry.month);
  if (!monthValue || monthValue === entry.month) {
    return { value: entry, normalized: false };
  }
  return {
    value: {
      ...entry,
      month: monthValue,
    },
    normalized: true,
  };
}

export function stableHash(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function deterministicId(prefix: string, seedParts: Array<string | number | undefined | null>): string {
  const seed = seedParts.map((part) => String(part ?? "")).join("|");
  return `${prefix}-${stableHash(seed)}`;
}

export function parseDeNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function pushIssue(
  issues: Array<{
    code: string;
    severity: "error" | "warning" | "info";
    entityType: string;
    entityId?: string;
    message: string;
  }>,
  issue: {
    code: string;
    severity: "error" | "warning" | "info";
    entityType: string;
    entityId?: string;
    message: string;
  },
): void {
  issues.push(issue);
}
