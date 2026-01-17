export function computeNiceTickStep(range) {
  const steps = [1000, 2000, 5000, 10000, 20000, 50000];
  if (!Number.isFinite(range) || range <= 0) return steps[0];
  for (const step of steps) {
    if (range / step <= 5) return step;
  }
  return steps[steps.length - 1];
}

export function formatEUR(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatSignedEUR(value) {
  const num = Number(value || 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${formatEUR(num)}`;
}
