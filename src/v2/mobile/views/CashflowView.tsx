// Tab „Cashflow": Hero-Liquiditätskarte, Monats-Diagramm (Kontostand + Netto),
// Monatskarten. Ziel: Monat-für-Monat-Liquidität beurteilen.
import { useMemo, type JSX } from "react";
import type { CfpModel, CfpRange } from "../../domain/cfpModel";
import { HeroCard } from "../components/HeroCard";
import { CashflowChart } from "../components/CashflowChart";
import { MonthCard } from "../components/MonthCard";
import { formatMonthLabel, formatCurrency } from "../cfpFormat";
import { IconWarning, IconChevron } from "../components/icons";

// Liquiditäts-Ampel: grün ab Cash-Puffer, amber 0..Puffer, rot unter 0.
function ampelStatus(value: number | null, buffer: number): "ok" | "warn" | "bad" {
  if (value == null) return "ok";
  if (value < 0) return "bad";
  if (buffer > 0 && value < buffer) return "warn";
  return "ok";
}

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
      lowStatus: ampelStatus(model.totals.minClosing, model.cashBuffer),
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
        cashBuffer={model.cashBuffer}
        onSelectMonth={onSelectMonth}
      />

      {model.topOutflows.length ? (
        <>
          <div className="cfp-section-head">
            <h2 className="cfp-section-title">Größte Ausgaben</h2>
            <span className="cfp-section-meta">im Zeitraum</span>
          </div>
          <div className="cfp-list">
            {model.topOutflows.map((o, i) => (
              <button key={`${o.month}-${i}`} type="button" className="cfp-toprow" onClick={() => onSelectMonth(o.month)}>
                <span className="cfp-toprow-rank">{i + 1}</span>
                <span className="cfp-toprow-main">
                  <span className="cfp-toprow-label">{o.label}</span>
                  <span className="cfp-toprow-sub">{o.monthLabel}{o.sub ? ` · ${o.sub}` : ""}</span>
                </span>
                <span className="cfp-toprow-amount cfp-num cfp-neg">−{formatCurrency(o.amount)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

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
