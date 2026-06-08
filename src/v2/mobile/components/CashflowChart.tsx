// Monat-für-Monat-Diagramm (Mobile-Variante des Desktop-Charts):
// Netto-Balken je Monat (grün/rot, oben) + Kontostand-Linie (unten), antippbar.
// Beantwortet „reicht der Kontostand in Monat X für eine Ausgabe?".
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { CfpMonthRow } from "../../domain/cfpModel";
import { formatCompactCurrency, formatCurrency, splitMonthLabel } from "../cfpFormat";

const H = 244;
const PAD_L = 8;
const PAD_R = 8;
// Balken-Band (Netto je Monat) oben, Linien-Band (Kontostand) unten.
const BAR_TOP = 14;
const BAR_BOTTOM = 96;
const BAR_BASE = (BAR_TOP + BAR_BOTTOM) / 2;
const LINE_TOP = 120;
const LINE_BOTTOM = 212;
const LABEL_Y = 230;

function niceColor(positive: boolean): string {
  return positive ? "#16a34a" : "#e4585a";
}

export function CashflowChart({ rows, selectedMonth, currentMonth, onSelectMonth }: {
  rows: CfpMonthRow[];
  selectedMonth: string | null;
  currentMonth: string;
  onSelectMonth: (month: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const n = rows.length;
    const plotW = Math.max(1, width - PAD_L - PAD_R);
    const step = n > 0 ? plotW / n : plotW;
    const barW = Math.min(step * 0.56, 20);

    const nets = rows.map((r) => r.net);
    const maxAbsNet = Math.max(1, ...nets.map((v) => Math.abs(v)));
    const barHalf = (BAR_BOTTOM - BAR_TOP) / 2 - 2;

    const closings = rows.map((r) => r.closing);
    const cMin = Math.min(...closings, 0);
    const cMaxRaw = Math.max(...closings, 0);
    const cMax = cMaxRaw;
    const span = (cMax - cMin) || 1;
    const yLine = (v: number) => LINE_BOTTOM - ((v - cMin) / span) * (LINE_BOTTOM - LINE_TOP);

    const cx = (i: number) => PAD_L + step * (i + 0.5);
    const zeroLineY = cMin < 0 && cMax > 0 ? yLine(0) : null;

    const labelEvery = Math.max(1, Math.ceil(n / 6));
    const minIdx = closings.indexOf(Math.min(...closings));

    const linePts = rows.map((r, i) => [cx(i), yLine(r.closing)] as [number, number]);
    const linePath = linePts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = linePts.length
      ? `${linePath} L${linePts[linePts.length - 1][0].toFixed(1)},${LINE_BOTTOM} L${linePts[0][0].toFixed(1)},${LINE_BOTTOM} Z`
      : "";

    return { n, step, barW, cx, yLine, maxAbsNet, barHalf, zeroLineY, labelEvery, minIdx, linePath, areaPath, linePts };
  }, [rows, width]);

  return (
    <div ref={ref} className="cfp-chartcard">
      <div className="cfp-chart-legend">
        <span><i className="cfp-chip-dot" style={{ background: "var(--cfp-pos)" }} /> Netto / Monat</span>
        <span><i className="cfp-chart-legend-line" /> Kontostand</span>
      </div>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Kontostand und Netto je Monat">
        {/* Balken-Baseline */}
        <line x1={PAD_L} y1={BAR_BASE} x2={width - PAD_R} y2={BAR_BASE} stroke="rgba(15,27,45,0.1)" strokeWidth={1} />
        {/* Kontostand-Nulllinie (falls im Bereich) */}
        {geo.zeroLineY != null ? (
          <line x1={PAD_L} y1={geo.zeroLineY} x2={width - PAD_R} y2={geo.zeroLineY} stroke="rgba(228,88,90,0.5)" strokeWidth={1} strokeDasharray="3 4" />
        ) : null}

        {/* Netto-Balken */}
        {rows.map((r, i) => {
          const h = (Math.abs(r.net) / geo.maxAbsNet) * geo.barHalf;
          const x = geo.cx(i) - geo.barW / 2;
          const y = r.net >= 0 ? BAR_BASE - h : BAR_BASE;
          const isSel = r.month === selectedMonth;
          return (
            <rect key={`bar-${r.month}`} x={x} y={y} width={geo.barW} height={Math.max(1, h)} rx={2}
              fill={niceColor(r.net >= 0)} opacity={isSel ? 1 : 0.85} />
          );
        })}

        {/* Kontostand-Fläche + Linie */}
        <path d={geo.areaPath} fill="rgba(31,157,134,0.12)" />
        <path d={geo.linePath} fill="none" stroke="#0f766e" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Tiefstand-Marker + Punkte */}
        {geo.linePts.map(([x, y], i) => {
          const isSel = rows[i].month === selectedMonth;
          const isMin = i === geo.minIdx;
          if (!isSel && !isMin) return null;
          return <circle key={`pt-${i}`} cx={x} cy={y} r={isSel ? 4 : 3.2}
            fill={isMin ? "#e4585a" : "#0f766e"} stroke="#fff" strokeWidth={1.6} />;
        })}

        {/* Auswahl-Hervorhebung + Tap-Targets + Labels */}
        {rows.map((r, i) => {
          const x0 = PAD_L + geo.step * i;
          const isSel = r.month === selectedMonth;
          const isCurrent = r.month === currentMonth;
          const showLabel = i % geo.labelEvery === 0 || isCurrent;
          const { mon, year } = splitMonthLabel(r.month);
          return (
            <g key={`col-${r.month}`}>
              {isSel ? <rect x={x0} y={BAR_TOP - 4} width={geo.step} height={LINE_BOTTOM - BAR_TOP + 8} fill="rgba(15,27,45,0.05)" rx={4} /> : null}
              <rect x={x0} y={0} width={geo.step} height={LABEL_Y} fill="transparent" style={{ cursor: "pointer" }}
                onClick={() => onSelectMonth(r.month)} />
              {showLabel ? (
                <text x={geo.cx(i)} y={LABEL_Y} textAnchor="middle"
                  fontSize={geo.n > 13 ? 9 : 10} fontWeight={isCurrent ? 700 : 500}
                  fill={isCurrent ? "#0f1b2d" : "#6b7a85"}>
                  {mon}{geo.n <= 9 ? ` ${year}` : ""}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Kontextzeile: aktueller / niedrigster Kontostand */}
      <div className="cfp-chart-foot cfp-num">
        <span>Kontostand jetzt <strong>{formatCurrency(rows.find((r) => r.month === currentMonth)?.opening ?? rows[0]?.opening ?? 0)}</strong></span>
        <span>Tiefstand <strong className={(Math.min(...rows.map((r) => r.closing)) < 0) ? "cfp-neg" : ""}>
          {formatCompactCurrency(Math.min(...rows.map((r) => r.closing)))}</strong></span>
      </div>
    </div>
  );
}
