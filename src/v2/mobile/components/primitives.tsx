// Kleine, geteilte UI-Primitive für die CFP-Mobile-App.
import type { JSX, ReactNode } from "react";

export function StatusPill({ robust, blockerCount, label }: {
  robust: boolean;
  blockerCount: number;
  label?: string;
}): JSX.Element {
  const kind = robust ? "is-robust" : blockerCount > 0 ? "is-blocker" : "is-warn";
  const text = label || (robust ? "Robust" : blockerCount > 0 ? "Blocker" : "Prüfen");
  return <span className={`cfp-statuspill ${kind}`}>{text}</span>;
}

export function statusColor(robust: boolean, blockerCount: number): string {
  if (robust) return "#16a34a";
  if (blockerCount > 0) return "#e4585a";
  return "#f59e0b";
}

export function SplitBar({ inflow, outflow }: { inflow: number; outflow: number }): JSX.Element {
  const total = Math.abs(inflow) + Math.abs(outflow) || 1;
  const inPct = (Math.abs(inflow) / total) * 100;
  return (
    <div className="cfp-splitbar" role="img" aria-label="Verhältnis Eingänge zu Ausgängen">
      <div className="cfp-splitbar-in" style={{ width: `${inPct}%` }} />
      <div className="cfp-splitbar-out" style={{ width: `${100 - inPct}%` }} />
    </div>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <div className="cfp-segment" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={`cfp-segment-opt${opt.value === value ? " is-active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, ariaLabel }: {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`cfp-toggle${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function BucketPill({ label, on, disabled, onClick }: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`cfp-pill${on ? " is-on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      {on ? "✓ " : ""}{label}
    </button>
  );
}
