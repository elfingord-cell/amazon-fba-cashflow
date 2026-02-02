export const DASHBOARD_RANGE_OPTIONS = [
  { value: "NEXT_6", label: "Nächste 6 Monate", count: 6 },
  { value: "NEXT_12", label: "Nächste 12 Monate", count: 12 },
  { value: "NEXT_24", label: "Nächste 24 Monate", count: 24 },
  { value: "ALL", label: "Alles", count: null },
];

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

export function getMonthlyBuckets(startMonth, endMonth) {
  if (!startMonth || !endMonth) return [];
  const startIndex = monthIndex(startMonth);
  const endIndex = monthIndex(endMonth);
  if (startIndex == null || endIndex == null) return [];
  if (endIndex < startIndex) return [];
  const months = [];
  for (let idx = startIndex; idx <= endIndex; idx += 1) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

export function getVisibleMonths(allMonths, range, nowMonth, options = DASHBOARD_RANGE_OPTIONS) {
  if (!Array.isArray(allMonths) || !allMonths.length) return [];
  const sortedMonths = allMonths.slice().sort();
  if (range === "ALL") return sortedMonths;
  const option = options.find(item => item.value === range);
  const count = option && Number.isFinite(option.count) ? option.count : 0;
  if (!count) return sortedMonths;
  const startIndex = sortedMonths.findIndex(month => month >= nowMonth);
  if (startIndex === -1) return [];
  if (range === "NEXT_6" && startIndex > 0) {
    return sortedMonths.slice(startIndex - 1, startIndex + count);
  }
  return sortedMonths.slice(startIndex, startIndex + count);
}
