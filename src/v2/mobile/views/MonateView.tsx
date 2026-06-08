// Tab „Monate": vollständige Liste aller sichtbaren Monate mit Mini-Sparklines.
import type { JSX } from "react";
import type { CfpModel } from "../../domain/cfpModel";
import { Sparkline } from "../components/Sparkline";
import { splitMonthLabel, formatSignedCurrency, formatCurrency, formatMonthLabel } from "../cfpFormat";
import { statusColor } from "../components/primitives";
import { IconWarning } from "../components/icons";

export function MonateView({ model, onSelectMonth }: {
  model: CfpModel;
  onSelectMonth: (month: string) => void;
}): JSX.Element {
  const rows = model.rows;
  const closings = rows.map((row) => row.closing);
  const gapRow = model.firstNegativeVisibleMonth
    ? rows.find((row) => row.month === model.firstNegativeVisibleMonth)
    : null;

  return (
    <>
      {gapRow ? (
        <div className="cfp-banner">
          <span className="cfp-banner-icon"><IconWarning size={16} /></span>
          <div>
            <div className="cfp-banner-title">Erste Liquiditätslücke: {formatMonthLabel(gapRow.month)}</div>
            <div className="cfp-banner-sub cfp-num">Endsaldo fällt auf {formatSignedCurrency(gapRow.closing)}</div>
          </div>
        </div>
      ) : null}

      <div className="cfp-list">
        {rows.map((row, index) => {
          const { mon, year } = splitMonthLabel(row.month);
          const window = closings.slice(Math.max(0, index - 2), index + 1);
          const negative = row.net < 0;
          return (
            <button
              key={row.month}
              type="button"
              className={`cfp-listrow${negative ? " is-negative" : ""}`}
              onClick={() => onSelectMonth(row.month)}
            >
              <span className="cfp-listrow-month">{mon}<small>{year}</small></span>
              <span className="cfp-listrow-spark">
                <Sparkline values={window} variant="mini" width={120} height={28}
                  color={statusColor(row.robust, row.blockerCount)} />
              </span>
              <span className="cfp-listrow-vals">
                <span className={`cfp-listrow-net cfp-num ${negative ? "cfp-neg" : "cfp-pos"}`}>
                  {formatSignedCurrency(row.net)}
                </span>
                <span className="cfp-listrow-bal cfp-num">{formatCurrency(row.closing)}</span>
              </span>
              <span className="cfp-listrow-dot" style={{ background: statusColor(row.robust, row.blockerCount) }} />
            </button>
          );
        })}
      </div>
    </>
  );
}
