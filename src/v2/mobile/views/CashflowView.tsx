// Tab „Cashflow": Hero-Liquiditätskarte, Monats-Diagramm (Kontostand + Netto),
// Monatskarten. Ziel: Monat-für-Monat-Liquidität beurteilen (z. B. „reicht der
// Kontostand für eine Dividende im Juli?").
import { useMemo, type JSX } from "react";
import type { CfpModel } from "../../domain/cfpModel";
import { HeroCard } from "../components/HeroCard";
import { CashflowChart } from "../components/CashflowChart";
import { MonthCard } from "../components/MonthCard";
import { formatMonthLabel } from "../cfpFormat";

export function CashflowView({ model, selectedMonth, onSelectMonth }: {
  model: CfpModel;
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
}): JSX.Element {
  const rows = model.rows;
  const futureRows = useMemo(() => rows.filter((row) => !row.isPast), [rows]);
  const cardRows = futureRows.length ? futureRows : rows;

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

      <div className="cfp-section-head">
        <h2 className="cfp-section-title">Kontostand & Cashflow</h2>
        <span className="cfp-section-meta">Monat für Monat · tippen für Details</span>
      </div>
      <CashflowChart
        rows={rows}
        selectedMonth={selectedMonth}
        currentMonth={model.currentMonth}
        onSelectMonth={onSelectMonth}
      />

      <div className="cfp-section-head">
        <h2 className="cfp-section-title">Monate</h2>
        <span className="cfp-section-meta">{cardRows.length}{futureRows.length ? " kommende" : ""}</span>
      </div>
      <div className="cfp-monthcards">
        {cardRows.map((row) => (
          <MonthCard key={row.month} row={row} onClick={() => onSelectMonth(row.month)} />
        ))}
      </div>
    </>
  );
}
