// Monats-Detail-Bottom-Sheet: Kopf, Blocker-Box, aufklappbarer Breakdown, CTA.
import { useMemo, useState, type JSX } from "react";
import type { CfpMonthRow } from "../../domain/cfpModel";
import { buildMonthBreakdown, type BreakdownGroup } from "../monthBreakdown";
import { formatCurrency, formatSignedCurrency, formatPercent } from "../cfpFormat";
import { StatusPill } from "./primitives";
import {
  IconChevron, IconChevronDown, IconWarning,
  IconInflow, IconSupplier, IconImport, IconFixcost, IconTax, IconDividend,
} from "./icons";

// Vorzeichenrichtige Darstellung: Eingänge addieren (+), Ausgänge entziehen (−);
// eine negative Ausgaben-Summe (z. B. Steuer-Erstattung) wird als Gutschrift (+) gezeigt.
function fmtAmount(value: number, direction: "in" | "out"): string {
  const adds = direction === "in" ? value >= 0 : value < 0;
  return `${adds ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
}

function groupIcon(key: string): JSX.Element {
  switch (key) {
    case "amazon": return <IconInflow size={15} />;
    case "import": return <IconImport size={15} />;
    case "fix": return <IconFixcost size={15} />;
    case "tax": return <IconTax size={15} />;
    case "dividend": return <IconDividend size={15} />;
    case "supplier": return <IconSupplier size={15} />;
    default: return <IconSupplier size={15} />;
  }
}

function buildBlockerReasons(row: CfpMonthRow): string[] {
  const reasons: string[] = [];
  if (row.closing < 0) reasons.push(`Endsaldo negativ (${formatSignedCurrency(row.closing)})`);
  row.blockers.slice(0, 3).forEach((blocker) => {
    if (blocker.message) reasons.push(blocker.message);
  });
  if (row.coverageRatio > 0 && row.coverageRatio < 1) {
    reasons.push(`Deckung nur ${formatPercent(row.coverageRatio * 100)}`);
  }
  // Duplikate entfernen, Reihenfolge erhalten
  return Array.from(new Set(reasons));
}

function GroupBlock({ group, direction, open, onToggle }: {
  group: BreakdownGroup;
  direction: "in" | "out";
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const expandable = group.items.length > 1;
  return (
    <div>
      <button type="button" className={`cfp-bd-row${open ? " is-open" : ""}`} onClick={onToggle} disabled={!expandable}>
        <span className={`cfp-bd-row-icon${direction === "out" ? " is-out" : ""}`}>{groupIcon(group.key)}</span>
        <span className="cfp-bd-row-main">
          <span className="cfp-bd-row-label">{group.label}</span>
          {expandable ? <span className="cfp-bd-row-sub">{group.items.length} Positionen</span> : null}
        </span>
        <span className={`cfp-bd-row-amount ${direction === "in" ? "cfp-pos" : "cfp-neg"}`}>
          {fmtAmount(group.total, direction)}
        </span>
        {expandable ? <span className="cfp-bd-row-chev"><IconChevronDown size={16} /></span> : null}
      </button>
      {open && expandable ? (
        <div className="cfp-bd-items">
          {group.items.map((item, idx) => (
            <div className="cfp-bd-item" key={`${item.label}-${idx}`}>
              <span className="cfp-bd-item-label">{item.label}{item.sub ? ` · ${item.sub}` : ""}</span>
              <span className="cfp-bd-item-amount">{fmtAmount(item.amount, direction)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MonthSheet({ row, bucketScope, onClose, onNavigate }: {
  row: CfpMonthRow;
  bucketScope: string[];
  onClose: () => void;
  onNavigate: (month: string) => void;
}): JSX.Element {
  const [closing, setClosing] = useState(false);
  const breakdown = useMemo(() => buildMonthBreakdown(row, new Set(bucketScope)), [row, bucketScope]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["amazon"]));
  const reasons = useMemo(() => buildBlockerReasons(row), [row]);

  function toggle(key: string): void {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleClose(): void {
    setClosing(true);
    window.setTimeout(onClose, 230);
  }

  return (
    <>
      <div className="cfp-sheet-backdrop" onClick={handleClose} />
      <div className={`cfp-sheet${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={`Monats-Detail ${row.label}`}>
        <div className="cfp-sheet-handle" />
        <div className="cfp-sheet-head">
          <div className="cfp-sheet-head-row">
            <div>
              <div className="cfp-sheet-title">{row.label}</div>
              <div style={{ marginTop: 4 }}>
                <StatusPill robust={row.robust} blockerCount={row.blockerCount} />
              </div>
            </div>
            <div className="cfp-sheet-endsaldo">
              <div className="cfp-sheet-endsaldo-label">Endsaldo</div>
              <div className={`cfp-sheet-endsaldo-value cfp-num ${row.closing < 0 ? "cfp-neg" : ""}`}>
                {formatCurrency(row.closing)}
              </div>
            </div>
          </div>
          <div className="cfp-sheet-meta cfp-num">
            <span>Startsaldo <strong>{formatCurrency(row.opening)}</strong></span>
            {row.activeSkus > 0 ? <span>Deckung <strong>{formatPercent(row.coverageRatio * 100)}</strong></span> : null}
          </div>
        </div>

        <div className="cfp-sheet-body">
          {reasons.length ? (
            <div className="cfp-blockerbox">
              <div className="cfp-blockerbox-title"><IconWarning size={16} /> Blocker · Deckung gefährdet</div>
              <ul className="cfp-blockerbox-list">
                {reasons.map((reason, idx) => <li key={idx}>{reason}</li>)}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            className={`cfp-cta${row.robust ? " is-mint" : ""}`}
            onClick={() => onNavigate(row.month)}
          >
            Zur Monatsplanung <IconChevron size={16} />
          </button>

          {breakdown.inflows.length ? (
            <div className="cfp-bd-group">
              <div className="cfp-bd-group-head">
                <span>Eingänge</span>
                <span className="cfp-bd-group-total cfp-pos cfp-num">{fmtAmount(breakdown.inflowTotal, "in")}</span>
              </div>
              {breakdown.inflows.map((group) => (
                <GroupBlock key={group.key} group={group} direction="in"
                  open={openGroups.has(group.key)} onToggle={() => toggle(group.key)} />
              ))}
            </div>
          ) : null}

          {breakdown.outflows.length ? (
            <div className="cfp-bd-group">
              <div className="cfp-bd-group-head">
                <span>Ausgänge</span>
                <span className="cfp-bd-group-total cfp-neg cfp-num">{fmtAmount(breakdown.outflowTotal, "out")}</span>
              </div>
              {breakdown.outflows.map((group) => (
                <GroupBlock key={group.key} group={group} direction="out"
                  open={openGroups.has(group.key)} onToggle={() => toggle(group.key)} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
