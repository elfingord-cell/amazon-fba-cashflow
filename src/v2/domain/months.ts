import { addMonths, currentMonthKey, monthIndex, normalizeMonthKey } from "../../domain/shared/months.js";

export { addMonths, currentMonthKey, monthIndex, normalizeMonthKey };

export function monthRange(startMonth: string, months: number): string[] {
  const normalized = normalizeMonthKey(startMonth);
  const length = Number.isFinite(months) ? Math.max(0, Math.round(months)) : 0;
  if (!normalized || !length) return [];
  return Array.from({ length }, (_, index) => addMonths(normalized, index));
}

export function formatMonthLabel(month: string): string {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return "—";
  const [year, monthNumber] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthEndDate(month: string): Date | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  if (!year || !monthNumber) return null;
  return new Date(Date.UTC(year, monthNumber, 0));
}

export function formatMonthEndLabel(month: string, mode: "short" | "long" = "long"): string {
  const date = monthEndDate(month);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  if (mode === "short") {
    return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  }
  return `Ende ${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}`;
}
