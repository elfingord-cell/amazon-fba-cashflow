// Formatter für die CFP-Mobile-App (de-DE), identisch zur Desktop-Darstellung.

export function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatSignedCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  if (number < 0) return `−${formatCurrency(Math.abs(number))}`;
  return `+${formatCurrency(number)}`;
}

// Kompakte Geldangabe für enge Stellen (z. B. KPI-Strip): 691k, 1,1 Mio.
export function formatCompactCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  const abs = Math.abs(number);
  const sign = number < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mio. €`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000).toLocaleString("de-DE")}k €`;
  }
  return formatCurrency(number);
}

export function formatPercent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} %`;
}

export function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return number.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// "2026-08" -> "Aug 2026"
export { formatMonthLabel } from "../domain/months";

// "2026-08" -> { mon: "Aug", year: "'26" } für Chips/Listen
export function splitMonthLabel(monthKey: string): { mon: string; year: string } {
  const normalized = /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : "";
  if (!normalized) return { mon: "–", year: "" };
  const [year, monthNumber] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  const mon = date.toLocaleDateString("de-DE", { month: "short", timeZone: "UTC" }).replace(".", "");
  return { mon, year: `'${String(year).slice(-2)}` };
}

// ISO-Datum -> "12. Jun"
export function formatDayMonth(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" }).replace(".", "");
}
