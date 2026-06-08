// Schlanke SVG-Sparkline für die Saldo-Kurve (Hero) und Mini-Trends (Listen).
import { useId, type JSX } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  variant?: "hero" | "mini";
  // Index des ersten negativen Saldos (Marker); -1/undefined = keiner
  firstNegativeIndex?: number;
  // Mini: Farbe explizit setzen (sonst aus Trend)
  color?: string;
}

function buildPath(points: Array<[number, number]>): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

export function Sparkline({
  values,
  width = 300,
  height = 64,
  variant = "hero",
  firstNegativeIndex = -1,
  color,
}: SparklineProps): JSX.Element {
  const gradId = useId();
  const data = values.length ? values : [0, 0];
  const padY = variant === "hero" ? 10 : 4;

  const rawMin = Math.min(...data, 0);
  const rawMax = Math.max(...data, 0);
  const span = rawMax - rawMin || 1;
  const x = (i: number) => (data.length === 1 ? width / 2 : (i / (data.length - 1)) * width);
  const y = (v: number) => height - padY - ((v - rawMin) / span) * (height - padY * 2);

  const points = data.map((v, i) => [x(i), y(v)] as [number, number]);
  const linePath = buildPath(points);
  const areaPath = `${linePath} L${width.toFixed(1)},${(height - padY).toFixed(1)} L0,${(height - padY).toFixed(1)} Z`;
  const zeroY = y(0);

  if (variant === "mini") {
    const stroke = color || (data[data.length - 1] >= data[0] ? "#16a34a" : "#e4585a");
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={linePath} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  const negPoint = firstNegativeIndex >= 0 && firstNegativeIndex < points.length ? points[firstNegativeIndex] : null;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Nulllinie */}
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="rgba(255,255,255,0.45)" strokeWidth={1} strokeDasharray="3 4" />
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {negPoint ? (
        <circle cx={negPoint[0]} cy={negPoint[1]} r={3.6} fill="#e4585a" stroke="#fff" strokeWidth={1.6} />
      ) : null}
    </svg>
  );
}
