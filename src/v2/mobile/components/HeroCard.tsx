// Hero-Liquiditätskarte: Kontostand (Monatsstart), Sparkline, Endsaldo/Tiefstand
// (mit Monat), und (falls vorhanden) der Liquiditätslücken-Chip.
import type { JSX } from "react";
import { Sparkline } from "./Sparkline";
import { IconCalendar, IconChevron, IconWarning } from "./icons";
import { formatCurrency, formatSignedCurrency } from "../cfpFormat";

export interface HeroCardProps {
  balance: number;
  balanceMonthLabel: string;
  sparkValues: number[];
  firstNegativeIndex: number;
  endLabel: string;
  endValue: number;
  lowValue: number | null;
  lowMonthLabel: string | null;
  gap: { monthLabel: string; value: number } | null;
  onGapClick: () => void;
}

export function HeroCard({
  balance,
  balanceMonthLabel,
  sparkValues,
  firstNegativeIndex,
  endLabel,
  endValue,
  lowValue,
  lowMonthLabel,
  gap,
  onGapClick,
}: HeroCardProps): JSX.Element {
  return (
    <div className="cfp-hero">
      <div className="cfp-hero-top">
        <span className="cfp-hero-label">Kontostand</span>
        <span className="cfp-hero-pill"><IconCalendar size={13} />{balanceMonthLabel}</span>
      </div>
      <div className="cfp-hero-balance cfp-num">{formatCurrency(balance)}</div>

      <div className="cfp-hero-spark">
        <Sparkline values={sparkValues} firstNegativeIndex={firstNegativeIndex} height={68} />
      </div>

      <div className="cfp-hero-foot">
        <div className="cfp-hero-foot-item">
          <span className="cfp-hero-foot-label">Endsaldo · {endLabel}</span>
          <span className="cfp-hero-foot-value cfp-num">{formatCurrency(endValue)}</span>
        </div>
        <div className="cfp-hero-foot-item">
          <span className="cfp-hero-foot-label">Tiefstand{lowMonthLabel ? ` · ${lowMonthLabel}` : ""}</span>
          <span className="cfp-hero-foot-value cfp-num">{lowValue == null ? "–" : formatCurrency(lowValue)}</span>
        </div>
      </div>

      {gap ? (
        <button type="button" className="cfp-hero-gap" onClick={onGapClick}>
          <span className="cfp-hero-gap-icon"><IconWarning size={18} /></span>
          <span className="cfp-hero-gap-main">
            <span className="cfp-hero-gap-title">Liquiditätslücke ab {gap.monthLabel}</span>
            <span className="cfp-hero-gap-sub cfp-num">Endsaldo {formatSignedCurrency(gap.value)} · jetzt prüfen</span>
          </span>
          <span className="cfp-hero-gap-chev"><IconChevron size={18} /></span>
        </button>
      ) : null}
    </div>
  );
}
