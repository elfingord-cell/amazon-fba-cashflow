const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseISODate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
  return copy;
}

export function daysBetween(start, end) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / MILLIS_PER_DAY);
}

export function overlapDays(startA, endA, startB, endB) {
  if (!(startA instanceof Date) || !(endA instanceof Date)) return 0;
  if (!(startB instanceof Date) || !(endB instanceof Date)) return 0;
  if (Number.isNaN(startA.getTime()) || Number.isNaN(endA.getTime())) return 0;
  if (Number.isNaN(startB.getTime()) || Number.isNaN(endB.getTime())) return 0;
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  if (end < start) return 0;
  const delta = daysBetween(start, end);
  return delta == null ? 0 : delta + 1;
}
