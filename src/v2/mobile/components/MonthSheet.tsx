// Monats-Detail-Bottom-Sheet: Kopf, Liquiditäts-/Blocker-Hinweise, „Puffer ab hier",
// aufklappbarer Breakdown (mit Fälligkeit + bezahlt/geplant), CTA.
import { useMemo, useState, type JSX } from "react";
import type { CfpMonthRow } from "../../domain/cfpModel";
import { buildCashflowWaterfall } from "../../domain/cashflowWaterfall";
import { buildMonthBreakdown, type BreakdownGroup } from "../monthBreakdown";
import { formatCurrency, formatSignedCurrency, formatPercent, formatDayMonth } from "../cfpFormat";
import { StatusPill } from "./primitives";
import {
  IconChevron, IconChevronDown, IconWarning,
  IconInflow, IconSupplier, IconImport, IconFixcost, IconTax, IconDividend,
} from "./icons";

function fmtAmount(value: number, direction: "in" | "out"): string {
  const adds = direction === "in" ? value >= 0 : value < 0;
  return `${adds ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
}

function wfStepValue(step: { kind: string; outValue?: number; amount?: number }): string {
  if (step.kind === "start" || step.kind === "end") {
    return formatCurrency(Number(step.outValue ?? step.amount ?? 0));
  }
  const amt = Number(step.amount ?? 0);
  return `${amt >= 0 ? "+" : "−"}${formatCurrency(Math.abs(amt))}`;
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

function itemMeta(item: { date?: string; paid?: boolean }): string {
  const parts: string[] = [];
  if (item.date) parts.push(formatDayMonth(item.date));
  if (item.paid === true) parts.push("bezahlt");
  else if (item.paid === false) parts.push("geplant");
  return parts.join(" · ");
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
          {group.items.map((item, idx) => {
            const meta = itemMeta(item);
            return (
              <div className="cfp-bd-item" key={`${item.label}-${idx}`}>
                <span className="cfp-bd-item-label">
                  {item.label}{item.sub ? ` · ${item.sub}` : ""}
                  {meta ? <span className="cfp-bd-item-meta">{meta}</span> : null}
                </span>
                <span className="cfp-bd-item-amount">{fmtAmount(item.amount, direction)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function MonthSheet({ row, bucketScope, cashBuffer, onClose, onNavigate }: {
  row: CfpMonthRow;
  bucketScope: string[];
  cashBuffer: number;
  onClose: () => void;
  onNavigate: (route: string) => void;
}): JSX.Element {
  const [closing, setClosing] = useState(false);
  const breakdown = useMemo(() => buildMonthBreakdown(row, new Set(bucketScope)), [row, bucketScope]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["amazon"]));
  const [wfOpen, setWfOpen] = useState(false);
  const [divAmount, setDivAmount] = useState(0);

  const waterfall = useMemo(() => buildCashflowWaterfall({ entries: row.entries }, row.cashIn), [row]);
  const monatsplanungRoute = `/v2/monatsplanung?month=${encodeURIComponent(row.month)}`;
  const coverageGap = row.activeSkus > 0 && row.coverageRatio > 0 && row.coverageRatio < 1;
  const hasDataBlockers = row.blockers.length > 0 || coverageGap;

  // Dividenden-/Ausschüttungs-Simulator: Betrag senkt den Tiefststand ab diesem Monat.
  const simMax = Math.max(20000, Math.ceil((Math.max(0, row.minClosingFromHere) + 10000) / 5000) * 5000);
  const newLow = row.minClosingFromHere - divAmount;
  const simStatus: "ok" | "warn" | "bad" = newLow < 0 ? "bad" : (cashBuffer > 0 && newLow < cashBuffer ? "warn" : "ok");
  const verdict = simStatus === "bad" ? "reißt ins Minus" : simStatus === "warn" ? "knapp — unter Cash-Puffer" : "tragbar";

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
            <span>Tiefststand ab hier <strong className={row.minClosingFromHere < 0 ? "cfp-neg" : ""}>{formatCurrency(row.minClosingFromHere)}</strong></span>
          </div>
        </div>

        <div className="cfp-sheet-body">
          {/* Liquidität (Cash) — getrennt vom Daten-/Bestands-Thema */}
          {row.closing < 0 ? (
            <div className="cfp-liqbox">
              <IconWarning size={16} />
              <div>
                <div className="cfp-liqbox-title">Liquidität: Endsaldo negativ</div>
                <div className="cfp-liqbox-sub cfp-num">{formatSignedCurrency(row.closing)} — Zahlung vorziehen/schieben oder Cash-in prüfen.</div>
              </div>
            </div>
          ) : null}

          {/* Bestand / Forecast / Daten — pro Blocker antippbar (Deep-Link) */}
          {hasDataBlockers ? (
            <div className="cfp-blockerbox">
              <div className="cfp-blockerbox-title"><IconWarning size={16} /> Zu prüfen · Bestand / Forecast / Daten</div>
              <div className="cfp-blocker-list">
                {row.blockers.slice(0, 6).map((blocker) => (
                  <button
                    key={blocker.id}
                    type="button"
                    className="cfp-blocker-row"
                    onClick={() => onNavigate(blocker.route || monatsplanungRoute)}
                  >
                    <span className="cfp-blocker-cat">{blocker.category}</span>
                    <span className="cfp-blocker-msg">{blocker.message}</span>
                    <IconChevron size={15} />
                  </button>
                ))}
                {row.blockers.length > 6 ? (
                  <button type="button" className="cfp-blocker-note cfp-blocker-more" onClick={() => onNavigate(monatsplanungRoute)}>
                    +{row.blockers.length - 6} weitere · in Monatsplanung →
                  </button>
                ) : null}
                {coverageGap ? (
                  <div className="cfp-blocker-note cfp-num">Deckung nur {formatPercent(row.coverageRatio * 100)}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Dividenden-/Ausschüttungs-Simulator (Was-wäre-wenn) */}
          <div className="cfp-sim">
            <div className="cfp-sim-head">Was-wäre-wenn · Ausschüttung in {row.label}</div>
            <input
              type="range"
              min={0}
              max={simMax}
              step={1000}
              value={divAmount}
              onChange={(e) => setDivAmount(Number(e.target.value))}
              className="cfp-sim-range"
              aria-label="Ausschüttungsbetrag"
            />
            <div className="cfp-sim-result cfp-num">
              <span className="cfp-sim-amount">{formatCurrency(divAmount)}</span>
              <span className="cfp-sim-arrow">→</span>
              <span className="cfp-sim-low"><span className={`cfp-amp-dot is-${simStatus}`} />Tiefst. ab hier {formatCurrency(newLow)}</span>
            </div>
            {divAmount > 0 ? <div className={`cfp-sim-verdict is-${simStatus}`}>{verdict}</div> : null}
          </div>

          <button
            type="button"
            className={`cfp-cta${row.robust && row.closing >= 0 ? " is-mint" : ""}`}
            onClick={() => onNavigate(monatsplanungRoute)}
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

          {waterfall.length ? (
            <div className="cfp-wf">
              <button type="button" className={`cfp-wf-toggle${wfOpen ? " is-open" : ""}`} onClick={() => setWfOpen((v) => !v)}>
                Wie entsteht der Netto-Wert? <IconChevronDown size={16} />
              </button>
              {wfOpen ? (
                <div className="cfp-wf-steps">
                  {waterfall.map((step, i) => (
                    <div className="cfp-wf-step" key={`${step.key}-${i}`}>
                      <div className="cfp-wf-step-row">
                        <span className="cfp-wf-step-label">{step.label}</span>
                        <span className="cfp-wf-step-value cfp-num">{wfStepValue(step)}</span>
                      </div>
                      {step.explain ? <div className="cfp-wf-step-explain">{step.explain}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
