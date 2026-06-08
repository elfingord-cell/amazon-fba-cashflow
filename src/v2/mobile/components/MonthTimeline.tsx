// Horizontal scrollbarer Monats-Zeitstrahl (Chips).
import type { JSX } from "react";
import type { CfpMonthRow } from "../../domain/cfpModel";
import { splitMonthLabel, formatCompactCurrency } from "../cfpFormat";
import { statusColor } from "./primitives";

export function MonthTimeline({ rows, onSelect }: {
  rows: CfpMonthRow[];
  onSelect: (month: string) => void;
}): JSX.Element {
  return (
    <div className="cfp-timeline">
      {rows.map((row) => {
        const { mon, year } = splitMonthLabel(row.month);
        const negative = row.net < 0;
        return (
          <button
            key={row.month}
            type="button"
            className={`cfp-chip${negative ? " is-negative" : ""}`}
            onClick={() => onSelect(row.month)}
          >
            <span className="cfp-chip-month">
              <span className="cfp-chip-dot" style={{ background: statusColor(row.robust, row.blockerCount) }} />
              {mon} {year}
            </span>
            <span className={`cfp-chip-net cfp-num ${negative ? "cfp-neg" : "cfp-pos"}`}>
              {formatCompactCurrency(row.net)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
