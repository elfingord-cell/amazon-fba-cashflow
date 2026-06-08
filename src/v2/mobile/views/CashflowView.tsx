// Tab „Cashflow": Hero-Liquiditätskarte, Monats-Diagramm (Kontostand + Netto),
// Monatskarten. Ziel: Monat-für-Monat-Liquidität beurteilen.
import { useMemo, type JSX } from "react";
import type { CfpModel, CfpRange } from "../../domain/cfpModel";
import { HeroCard } from "../components/HeroCard";
import { CashflowChart } from "../components/CashflowChart";
import { MonthCard } from "../components/MonthCard";
import { formatMonthLabel, formatSignedCurrency } from "../cfpFormat";
import { IconWarning, IconChevron } from "../components/icons";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `vor ${h} Std`;
  return new Date(iso).toLocaleDateString("de-DE");
}

export function CashflowView({ model, selectedMonth, lastSavedAt, onSelectMonth, onSetRange }: {
  model: CfpModel;
  selectedMonth: string | null;
  lastSavedAt: string | null;
  onSelectMonth: (month: string) => void;
  onSetRange: (range: CfpRange) => void;
}): JSX.Element {
  const rows = model.rows;
  const futureRows = useMemo(() => rows.filter((row) => !row.isPast), [rows]);
  const cardRows = futureRows.length ? futureRows : rows;

  // Liquiditätslücke, die im aktuellen Zeitfenster NICHT sichtbar ist (Modell kennt
  // sie über den vollen Horizont) — sonst suggeriert ein 6-Monats-Blick fälschlich „alles grün".
  const hiddenGapMonth = useMemo(() => {
    if (!model.firstNegativeMonth) return null;
    if (model.firstNegativeVisibleMonth) return null;
    if (rows.some((row) => row.month === model.firstNegativeMonth)) return null;
    return model.firstNegativeMonth;
  }, [model.firstNegativeMonth, model.firstNegativeVisibleMonth, rows]);

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
      lowMonthLabel: model.minClosingMonth ? formatMonthLabel(model.minClosingMonth) : null,
      gap: gapRow ? { monthLabel: gapRow.label, value: gapRow.closing } : null,
    };
  }, [rows, model]);

  const updatedLabel = lastSavedAt ? `Aktualisiert · ${relativeTime(lastSavedAt)}` : "Live · synchronisiert";

  return (
    <>
      <div className="cfp-updated">{updatedLabel}</div>

      <HeroCard {...hero} onGapClick={() => model.firstNegativeVisibleMonth && onSelectMonth(model.firstNegativeVisibleMonth)} />

      {hiddenGapMonth ? (
        <button type="button" className="cfp-hiddengap" onClick={() => onSetRange("all")}>
          <span className="cfp-hiddengap-icon"><IconWarning size={16} /></span>
          <span className="cfp-hiddengap-main">
            <span className="cfp-hiddengap-title">Liquiditätslücke ab {formatMonthLabel(hiddenGapMonth)}</span>
            <span className="cfp-hiddengap-sub">außerhalb der Ansicht — ganzen Zeitraum zeigen</span>
          </span>
          <span className="cfp-hiddengap-chev"><IconChevron size={16} /></span>
        </button>
      ) : null}

      <div className="cfp-section-head">
        <h2 className="cfp-section-title">Kontostand & Cashflow</h2>
        <span className="cfp-section-meta">Monat für Monat · tippen für Details</span>
      </div>
      <CashflowChart
        rows={rows}
        selectedMonth={selectedMonth}
        currentMonth={model.currentMonth}
        minClosingMonth={model.minClosingMonth}
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
