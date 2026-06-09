import { daysBetween } from "../domain/shared/dates.js";
export { parseISODate, addDays, daysBetween } from "../domain/shared/dates.js";

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
