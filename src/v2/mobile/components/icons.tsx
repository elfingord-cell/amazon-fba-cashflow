// Kompakte Inline-SVG-Icons für die CFP-Mobile-App (Stroke-Stil, native Optik).
import type { JSX } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function svg(path: JSX.Element, size = 22): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {path}
    </svg>
  );
}

export const IconCashflow = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M3 17l5-5 4 3 7-8" /><path d="M16 7h5v5" /></>, size);

export const IconMonate = ({ size }: IconProps): JSX.Element =>
  svg(<><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 3v3M16 3v3" /></>, size);

export const IconRadar = ({ size }: IconProps): JSX.Element =>
  svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>, size);

export const IconMehr = ({ size }: IconProps): JSX.Element =>
  svg(<><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>, size);

export const IconBell = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>, size);

export const IconRefresh = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></>, size);

export const IconCalendar = ({ size }: IconProps): JSX.Element =>
  svg(<><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 3v3M16 3v3" /></>, size);

export const IconSliders = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M4 6h11M19 6h1M4 12h5M13 12h7M4 18h9M17 18h3" /><circle cx="16" cy="6" r="2" /><circle cx="11" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>, size);

export const IconChevron = ({ size }: IconProps): JSX.Element =>
  svg(<path d="M9 6l6 6-6 6" />, size);

export const IconChevronDown = ({ size }: IconProps): JSX.Element =>
  svg(<path d="M6 9l6 6 6-6" />, size);

export const IconWarning = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17.5v.2" /></>, size);

export const IconUser = ({ size }: IconProps): JSX.Element =>
  svg(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /></>, size);

// Kategorie-Icons für den Monats-Breakdown
export const IconInflow = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>, size);

export const IconSupplier = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>, size);

export const IconImport = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M3 16l1.5-5h15L21 16" /><path d="M3 16h18v3H3zM7 11V6h7l3 5" /></>, size);

export const IconFixcost = ({ size }: IconProps): JSX.Element =>
  svg(<><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M7 9V6a5 5 0 0 1 10 0v3" /></>, size);

export const IconTax = ({ size }: IconProps): JSX.Element =>
  svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h5M8 16h6" /></>, size);

export const IconDividend = ({ size }: IconProps): JSX.Element =>
  svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.2c0-1.2 1.1-2 2.5-2s2.5.8 2.5 1.9-1 1.6-2.5 1.9-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-1.9" /></>, size);

export const IconCalibration = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M3 17l5-5 4 3 7-8" /><circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" /></>, size);

export const IconBuffer = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M12 3l8 4v5c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V7z" /></>, size);

export const IconAmazon = ({ size }: IconProps): JSX.Element =>
  svg(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>, size);
