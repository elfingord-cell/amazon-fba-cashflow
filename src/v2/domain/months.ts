export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function normalizeMonthKey(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const mmYYYY = raw.match(/^(\d{2})-(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
  return null;
}

export function monthIndex(month: string): number | null {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + (monthNumber - 1);
}

export function addMonths(month: string, offset: number): string {
  const index = monthIndex(month);
  if (index == null) return month;
  const next = index + offset;
  const year = Math.floor(next / 12);
  const monthNumber = (next % 12) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

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
  return date.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}
