
export function parseDE(s) {
  if (typeof s === "number") return s;
  s = String(s || "").trim();
  if (!s) return 0;
  const re = /^\s*-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+)(?:[.,]\d+)?\s*$/;
  if (!re.test(s)) return Number(s) || 0;
  const t = s.replace(/\./g, "").replace(",", ".");
  return Number(t);
}
export function fmtEUR(n) {
  return (n ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
export function yyyymmList(startYM, months) {
  const [y, m] = startYM.split("-").map(Number);
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(y, (m - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
export function endOfMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0);
}
