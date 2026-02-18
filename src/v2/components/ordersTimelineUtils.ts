import { monthRange, normalizeMonthKey } from "../domain/months";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OrdersTimelineWindow {
  startMonth: string;
  horizonMonths: number;
  months: string[];
  visibleStartMs: number;
  visibleEndMs: number;
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function timelineRangeFromIsoDates(input: {
  state: Record<string, unknown>;
  dates: Array<string | null | undefined>;
  fallbackHorizon?: number;
}): OrdersTimelineWindow {
  const settings = (input.state.settings || {}) as Record<string, unknown>;
  const explicitStartMonth = normalizeMonthKey(settings.startMonth);
  const firstDate = input.dates
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .sort()[0];
  const startMonth = explicitStartMonth || firstDate?.slice(0, 7) || new Date().toISOString().slice(0, 7);

  const fallbackHorizon = Number.isFinite(Number(input.fallbackHorizon)) ? Number(input.fallbackHorizon) : 12;
  const configuredHorizon = Number(settings.horizonMonths || 0);
  const horizonMonths = Number.isFinite(configuredHorizon) && configuredHorizon > 0
    ? Math.round(configuredHorizon)
    : Math.max(1, Math.round(fallbackHorizon));

  const months = monthRange(startMonth, horizonMonths);
  const startDate = parseIsoDate(`${startMonth}-01`) || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const endDate = new Date(startDate.getTime());
  endDate.setUTCMonth(endDate.getUTCMonth() + horizonMonths);

  return {
    startMonth,
    horizonMonths,
    months,
    visibleStartMs: startDate.getTime(),
    visibleEndMs: endDate.getTime(),
  };
}

export function safeTimelineSpanMs(input: {
  startMs: number;
  endMs: number;
  fallbackMs?: number;
}): { startMs: number; endMs: number } {
  const fallbackMs = Number.isFinite(Number(input.fallbackMs)) ? Number(input.fallbackMs) : MS_PER_DAY;
  const startMs = Number.isFinite(input.startMs) ? input.startMs : Date.now();
  const rawEndMs = Number.isFinite(input.endMs) ? input.endMs : startMs + fallbackMs;
  const endMs = rawEndMs > startMs ? rawEndMs : startMs + fallbackMs;
  return { startMs, endMs };
}

export function toTimelineMs(value: unknown): number | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  return date.getTime();
}
