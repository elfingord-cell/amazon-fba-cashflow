// Tab „Cashflow": Hero-Liquiditätskarte, KPI-Strip, Zeitrahl, Monatskarten.
import { useMemo, type JSX } from "react";
import type { CfpModel } from "../../domain/cfpModel";
import { HeroCard } from "../components/HeroCard";
import { MonthTimeline } from "../components/MonthTimeline";
import { MonthCard } from "../components/MonthCard";
import { formatCompactCurrency, formatSignedCurrency, formatMonthLabel } from "../cfpFormat";
import { IconInflow } from "../components/icons";

export function CashflowView({ model, onSelectMonth }: {
  model: CfpModel;
  onSelectMonth: (month: string) => void;
}): JSX.Element {
  const rows = model.rows;
  const futureRows = useMemo(() => rows.filter((row) => !row.isPast), [rows]);
  const timelineRows = futureRows.length ? futureRows : rows;

  const hero = useMemo(() => {
    const currentRow = rows.find((row) => row.isCurrent);
    const balance = currentRow ? currentRow.opening : (rows[0]?.opening ?? model.opening);
    const sparkValues = rows.map((row) => row.closing);
    const lastRow = rows[rows.length - 1];
    const firstNegIdx = model.firstNegativeVisibleMonth
      ? rows.findIndex((row) => row.month === model.firstNegativeVisibleMonth)
      : -1;
    const gapRow = model.firstNegativeVisibleMonth
      ? rows.find((row) => row.month === model.firstNegativeVisibleMonth)
      : null;
    return {
      balance,
      balanceMonthLabel: formatMonthLabel(model.currentMonth),
      sparkValues,
      firstNegativeIndex: firstNegIdx,
      endLabel: lastRow ? lastRow.label : "—",
      endValue: lastRow ? lastRow.closing : 0,
      lowValue: model.totals.minClosing,
      gap: gapRow ? { monthLabel: gapRow.label, value: gapRow.closing } : null,
    };
  }, [rows, model]);

  return (
    <>
      <div className="cfp-updated">Aktualisiert · gerade eben</div>

      <HeroCard {...hero} onGapClick={() => model.firstNegativeVisibleMonth && onSelectMonth(model.firstNegativeVisibleMonth)} />

      <div className="cfp-kpis">
        <div className="cfp-kpi">
          <span className="cfp-kpi-label"><IconInflow size={13} /> Eingänge</span>
          <span className="cfp-kpi-value cfp-num cfp-pos">{formatCompactCurrency(model.totals.inflow)}</span>
        </div>
        <div className="cfp-kpi">
          <span className="cfp-kpi-label">Ausgänge</span>
          <span className="cfp-kpi-value cfp-num cfp-neg">{formatCompactCurrency(model.totals.outflow)}</span>
        </div>
        <div className="cfp-kpi">
          <span className="cfp-kpi-label">Netto</span>
          <span className={`cfp-kpi-value cfp-num ${model.totals.net < 0 ? "cfp-neg" : "cfp-pos"}`}>
            {formatSignedCurrency(model.totals.net)}
          </span>
        </div>
      </div>

      <div className="cfp-section-head">
        <h2 className="cfp-section-title">Zeitrahl</h2>
        <span className="cfp-section-meta">Netto je Monat</span>
      </div>
      <MonthTimeline rows={timelineRows} onSelect={onSelectMonth} />

      <div className="cfp-section-head">
        <h2 className="cfp-section-title">Monate</h2>
        <span className="cfp-section-meta">{futureRows.length} kommende</span>
      </div>
      <div className="cfp-monthcards">
        {timelineRows.map((row) => (
          <MonthCard key={row.month} row={row} onClick={() => onSelectMonth(row.month)} />
        ))}
      </div>
    </>
  );
}
