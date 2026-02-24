export interface HybridClosingBalanceInputRow {
  month: string;
  net: number;
  actualClosing?: unknown;
}

export interface HybridClosingBalancePoint {
  month: string;
  opening: number;
  net: number;
  plannedClosing: number;
  closing: number;
  actualClosing: number | null;
  lockedActual: boolean;
}

export function readLockedActualClosing(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function buildHybridClosingBalanceSeries(input: {
  rows: HybridClosingBalanceInputRow[];
  initialOpening?: unknown;
}): HybridClosingBalancePoint[] {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) return [];

  const firstOpening = Number(input.initialOpening);
  let running = Number.isFinite(firstOpening) ? firstOpening : 0;

  return rows.map((row, index) => {
    const opening = index === 0 ? running : running;
    const netRaw = Number(row?.net);
    const net = Number.isFinite(netRaw) ? netRaw : 0;
    const actualClosing = readLockedActualClosing(row?.actualClosing);
    const plannedClosing = opening + net;
    const closing = actualClosing != null ? actualClosing : plannedClosing;
    running = closing;
    return {
      month: String(row?.month || ""),
      opening,
      net,
      plannedClosing,
      closing,
      actualClosing,
      lockedActual: actualClosing != null,
    };
  });
}
