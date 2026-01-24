export function computeNiceTickStep(range) {
  if (!Number.isFinite(range) || range <= 0) return 5000;
  return range >= 50000 ? 10000 : 5000;
}

export function getNiceTicks(min, max) {
  const minWithZero = Math.min(min, 0);
  const maxWithZero = Math.max(max, 0);
  const range = maxWithZero - minWithZero || 1;
  const step = computeNiceTickStep(range);
  const minTick = Math.floor(minWithZero / step) * step;
  const maxTick = Math.ceil(maxWithZero / step) * step;
  const ticks = [];
  for (let v = minTick; v <= maxTick + 1e-6; v += step) ticks.push(v);
  return { ticks, minTick, maxTick, step };
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
