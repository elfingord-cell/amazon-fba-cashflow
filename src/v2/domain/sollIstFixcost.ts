import { monthIndex } from "./months";

export type FixcostCaptureStatus = "offen" | "erfasst";

export interface PlannedFixcostRowLike {
  group?: string;
  amount?: number;
}

export interface FixcostComparisonRow {
  month: string;
  planned: number;
  actual: number | null;
  status: FixcostCaptureStatus;
  delta: number | null;
  deltaPct: number | null;
}

export interface FixcostComparisonSnapshot {
  selectedMonth: string;
  currentMonth: FixcostComparisonRow | null;
  ytd: {
    months: string[];
    planned: number;
    actual: number;
    delta: number;
    deltaPct: number | null;
    capturedMonthCount: number;
    openMonthCount: number;
  };
  rows: FixcostComparisonRow[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function sameNullableNumber(left: number | null, right: number | null): boolean {
  if (left == null && right == null) return true;
  return left === right;
}

function buildDeltaPct(planned: number, delta: number | null): number | null {
  if (delta == null) return null;
  if (!Number.isFinite(planned) || planned === 0) return null;
  return round2((delta / planned) * 100);
}

function sortMonths(months: string[]): string[] {
  return Array.from(new Set(months.filter(Boolean))).sort((left, right) => {
    const leftIndex = monthIndex(left);
    const rightIndex = monthIndex(right);
    if (leftIndex == null && rightIndex == null) return left.localeCompare(right);
    if (leftIndex == null) return -1;
    if (rightIndex == null) return 1;
    return leftIndex - rightIndex;
  });
}

export function readFixcostActualValue(entry: Record<string, unknown> | null | undefined): number | null {
  return toFiniteOrNull(entry?.realFixkostenEUR);
}

export function normalizeFixcostActualInputValue(value: unknown): number | null {
  return toFiniteOrNull(value);
}

export function hasFixcostActualValue(value: unknown): boolean {
  return toFiniteOrNull(value) != null;
}

export function sameFixcostActualValue(left: number | null, right: number | null): boolean {
  return sameNullableNumber(left, right);
}

export function buildPlannedFixcostByMonth(
  rowsByMonth: Map<string, PlannedFixcostRowLike[]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  rowsByMonth.forEach((rows, month) => {
    const planned = (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
      if (String(row?.group || "") !== "fixcost") return sum;
      const amount = Math.abs(Number(row?.amount || 0));
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    out[month] = round2(planned);
  });
  return out;
}

export function buildFixcostComparisonRows(input: {
  months: string[];
  plannedByMonth: Record<string, number>;
  monthlyActuals: Record<string, Record<string, unknown>>;
}): FixcostComparisonRow[] {
  return sortMonths(input.months).map((month) => {
    const planned = round2(Number(input.plannedByMonth[month] || 0));
    const actual = readFixcostActualValue(input.monthlyActuals[month]);
    const delta = actual == null ? null : round2(planned - actual);
    return {
      month,
      planned,
      actual,
      status: actual == null ? "offen" : "erfasst",
      delta,
      deltaPct: buildDeltaPct(planned, delta),
    };
  });
}

export function buildFixcostComparisonSnapshot(input: {
  months: string[];
  plannedByMonth: Record<string, number>;
  monthlyActuals: Record<string, Record<string, unknown>>;
  selectedMonth: string;
}): FixcostComparisonSnapshot {
  const rows = buildFixcostComparisonRows(input);
  const fallbackMonth = rows.length ? rows[rows.length - 1].month : "";
  const selectedMonth = rows.some((row) => row.month === input.selectedMonth)
    ? input.selectedMonth
    : fallbackMonth;
  const currentMonth = rows.find((row) => row.month === selectedMonth) || null;
  const selectedMonthIndex = monthIndex(selectedMonth);
  const selectedYear = selectedMonthIndex == null ? null : Math.floor(selectedMonthIndex / 12);
  const ytdRows = rows.filter((row) => {
    const index = monthIndex(row.month);
    if (index == null || selectedMonthIndex == null || selectedYear == null) return false;
    return Math.floor(index / 12) === selectedYear && index <= selectedMonthIndex;
  });

  const planned = round2(ytdRows.reduce((sum, row) => sum + row.planned, 0));
  const actual = round2(ytdRows.reduce((sum, row) => sum + (row.actual ?? 0), 0));
  const delta = round2(planned - actual);

  return {
    selectedMonth,
    currentMonth,
    ytd: {
      months: ytdRows.map((row) => row.month),
      planned,
      actual,
      delta,
      deltaPct: buildDeltaPct(planned, delta),
      capturedMonthCount: ytdRows.filter((row) => row.status === "erfasst").length,
      openMonthCount: ytdRows.filter((row) => row.status === "offen").length,
    },
    rows,
  };
}
