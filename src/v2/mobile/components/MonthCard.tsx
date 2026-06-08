// Monatskarte: Netto groß, Endsaldo, In/Out-Splitbar, Status-Pill.
import type { JSX } from "react";
import type { CfpMonthRow } from "../../domain/cfpModel";
import { formatSignedCurrency, formatCurrency } from "../cfpFormat";
import { SplitBar, StatusPill } from "./primitives";

export function MonthCard({ row, onClick }: { row: CfpMonthRow; onClick: () => void }): JSX.Element {
  const inflow = row.inflowSplit.total || row.inflow;
  const outflow = row.outflowSplit.total || row.outflow;
  return (
    <button type="button" className="cfp-monthcard" onClick={onClick}>
      <div className="cfp-monthcard-head">
        <div>
          <div className="cfp-monthcard-month">{row.label}</div>
          <div className="cfp-monthcard-bal cfp-num">Endsaldo {formatCurrency(row.closing)}</div>
        </div>
        <div>
          <div className="cfp-monthcard-netlabel">Netto</div>
          <div className={`cfp-monthcard-net cfp-num ${row.net < 0 ? "cfp-neg" : "cfp-pos"}`}>
            {formatSignedCurrency(row.net)}
          </div>
        </div>
      </div>
      <div>
        <SplitBar inflow={inflow} outflow={outflow} />
        <div className="cfp-splitbar-legend cfp-num">
          <span>▲ {formatCurrency(inflow)}</span>
          <span>▼ {formatCurrency(outflow)}</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <StatusPill robust={row.robust} blockerCount={row.blockerCount} />
      </div>
    </button>
  );
}
