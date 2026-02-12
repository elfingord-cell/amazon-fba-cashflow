import type { CSSProperties } from "react";
import { useMemo } from "react";
import { Alert, Card, Typography } from "antd";
import { formatMonthLabel, monthRange, normalizeMonthKey } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Title } = Typography;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PlanEntry {
  id: string;
  type: "PO" | "FO";
  poNo: string;
  foNo: string;
  orderDate: string;
  prodDays: number;
  transitDays: number;
  etdLagDays: number;
  goodsValue: number;
  milestones: Array<Record<string, unknown>>;
}

interface PlanAnchorMap {
  ORDER_DATE: Date;
  PROD_DONE: Date;
  ETD: Date;
  ETA: Date;
}

interface PlanRow {
  id: string;
  type: "PO" | "FO";
  label: string;
  warn: boolean;
  warnText: string;
  subtitle: string;
  phases: Array<{
    key: string;
    cls: "production" | "transit";
    label: string;
    left: number;
    width: number;
  }>;
  markers: Array<{
    key: string;
    left: number;
    title: string;
  }>;
}

interface TimelineMeta {
  startMs: number;
  endMs: number;
  totalDays: number;
}

function parseDate(value: unknown, fallback?: Date): Date | null {
  if (!value) return fallback ? new Date(fallback) : null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return fallback ? new Date(fallback) : null;
  return date;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + Number(days || 0));
  return out;
}

function parseEuro(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "")
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function parsePercent(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const number = Number(String(value || "").trim().replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 10) / 10;
}

function fmtDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtEur(value: number): string {
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function readPlanEntries(state: Record<string, unknown>): PlanEntry[] {
  const pos = (Array.isArray(state.pos) ? state.pos : []).map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>;
    return {
      id: String(row.id || `po-${index}`),
      type: "PO" as const,
      poNo: String(row.poNo || ""),
      foNo: "",
      orderDate: String(row.orderDate || ""),
      prodDays: Number(row.prodDays || 0) || 0,
      transitDays: Number(row.transitDays || 0) || 0,
      etdLagDays: Number(row.etdLagDays || 0) || 0,
      goodsValue: parseEuro(row.goodsEur ?? row.goodsValueEur ?? row.goodsValueUsd),
      milestones: Array.isArray(row.milestones) ? (row.milestones as Array<Record<string, unknown>>) : [],
    };
  });
  const fos = (Array.isArray(state.fos) ? state.fos : []).map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>;
    return {
      id: String(row.id || `fo-${index}`),
      type: "FO" as const,
      poNo: String(row.convertedPoNo || ""),
      foNo: String(row.foNo || row.foNumber || ""),
      orderDate: String(row.orderDate || ""),
      prodDays: Number(row.prodDays || 0) || 0,
      transitDays: Number(row.transitDays || 0) || 0,
      etdLagDays: Number(row.etdLagDays || 0) || 0,
      goodsValue: parseEuro(row.goodsEur ?? row.goodsValueEur ?? row.goodsValueUsd),
      milestones: Array.isArray(row.milestones) ? (row.milestones as Array<Record<string, unknown>>) : [],
    };
  });
  return [...pos, ...fos].sort((left, right) => {
    const leftDate = parseDate(left.orderDate, new Date(8640000000000000));
    const rightDate = parseDate(right.orderDate, new Date(8640000000000000));
    return (leftDate?.getTime() || 0) - (rightDate?.getTime() || 0);
  });
}

function determineStartMonth(state: Record<string, unknown>, entries: PlanEntry[]): string {
  const settings = (state.settings || {}) as Record<string, unknown>;
  const explicit = normalizeMonthKey(settings.startMonth);
  if (explicit) return explicit;
  const firstOrder = entries
    .map((entry) => entry.orderDate)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()[0];
  if (firstOrder) return firstOrder.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function determineHorizon(state: Record<string, unknown>): number {
  const settings = (state.settings || {}) as Record<string, unknown>;
  const horizon = Number(settings.horizonMonths || 0);
  if (!Number.isFinite(horizon) || horizon <= 0) return 12;
  return Math.round(horizon);
}

function computeAnchors(entry: PlanEntry): PlanAnchorMap {
  const order = parseDate(entry.orderDate, new Date()) || new Date();
  const prodDone = addDays(order, entry.prodDays);
  const etd = addDays(prodDone, entry.etdLagDays);
  const eta = addDays(prodDone, entry.transitDays);
  return {
    ORDER_DATE: order,
    PROD_DONE: prodDone,
    ETD: etd,
    ETA: eta,
  };
}

function dueDateForMilestone(anchors: PlanAnchorMap, milestone: Record<string, unknown>): Date {
  const anchorKey = String(milestone.anchor || "ORDER_DATE") as keyof PlanAnchorMap;
  const base = anchors[anchorKey] || anchors.ORDER_DATE;
  return addDays(base, Number(milestone.lagDays || 0) || 0);
}

function toPercentPosition(date: Date, timeline: TimelineMeta): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
  const clamped = Math.min(Math.max(date.getTime(), timeline.startMs), timeline.endMs);
  const diffDays = (clamped - timeline.startMs) / MS_PER_DAY;
  return Math.max(0, Math.min(100, (diffDays / timeline.totalDays) * 100));
}

function buildPlanRows(entries: PlanEntry[], timeline: TimelineMeta): PlanRow[] {
  return entries.map((entry) => {
    const anchors = computeAnchors(entry);
    const phaseRows: PlanRow["phases"] = [];
    if (anchors.PROD_DONE > anchors.ORDER_DATE) {
      const left = toPercentPosition(anchors.ORDER_DATE, timeline);
      const width = Math.max(0.75, toPercentPosition(anchors.PROD_DONE, timeline) - left);
      phaseRows.push({
        key: `${entry.id}-production`,
        cls: "production",
        label: "Produktion",
        left,
        width,
      });
    }
    if (anchors.ETA > anchors.PROD_DONE) {
      const left = toPercentPosition(anchors.PROD_DONE, timeline);
      const width = Math.max(0.75, toPercentPosition(anchors.ETA, timeline) - left);
      phaseRows.push({
        key: `${entry.id}-transit`,
        cls: "transit",
        label: "Transit",
        left,
        width,
      });
    }

    const pctSum = entry.milestones.reduce((sum, milestone) => sum + parsePercent(milestone.percent), 0);
    const roundedPctSum = Math.round(pctSum * 10) / 10;
    const warn = Math.abs(roundedPctSum - 100) > 0.1;
    const markers = entry.milestones.map((milestone, index) => {
      const dueDate = dueDateForMilestone(anchors, milestone);
      const left = toPercentPosition(dueDate, timeline);
      const percent = clampPercent(parsePercent(milestone.percent));
      const amount = entry.goodsValue * (percent / 100);
      const title = `${String(milestone.label || "Milestone")} - ${fmtDate(dueDate)} - ${fmtEur(amount)}`;
      return {
        key: `${entry.id}-${String(milestone.id || index)}`,
        left,
        title,
      };
    });

    const label = entry.type === "FO" ? (entry.foNo || "FO") : (entry.poNo || "PO");
    const subtitleParts = [
      `Order ${fmtDate(anchors.ORDER_DATE)}`,
      `ETA ${fmtDate(anchors.ETA)}`,
    ];
    if (entry.goodsValue > 0) subtitleParts.push(fmtEur(entry.goodsValue));

    return {
      id: entry.id,
      type: entry.type,
      label,
      warn,
      warnText: `Meilensteine summieren sich auf ${roundedPctSum}%`,
      subtitle: subtitleParts.join(" | "),
      phases: phaseRows,
      markers,
    };
  });
}

export default function PlanModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;

  const entries = useMemo(() => readPlanEntries(stateObject), [state]);
  const startMonth = useMemo(() => determineStartMonth(stateObject, entries), [entries, state]);
  const horizon = useMemo(() => determineHorizon(stateObject), [state]);
  const months = useMemo(() => monthRange(startMonth, horizon), [horizon, startMonth]);

  const timeline = useMemo<TimelineMeta | null>(() => {
    if (!months.length) return null;
    const first = `${months[0]}-01`;
    const startDate = parseDate(first, new Date());
    if (!startDate) return null;
    const endDate = new Date(startDate.getTime());
    endDate.setMonth(endDate.getMonth() + horizon);
    return {
      startMs: startDate.getTime(),
      endMs: endDate.getTime(),
      totalDays: Math.max(1, (endDate.getTime() - startDate.getTime()) / MS_PER_DAY),
    };
  }, [horizon, months]);

  const rows = useMemo(
    () => (timeline ? buildPlanRows(entries, timeline) : []),
    [entries, timeline],
  );

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Plan (V2 Native)</Title>
        <Paragraph>
          Zeitplan der aktiven Purchase und Forecast Orders mit Produktions-/Transitphasen und Payment-Milestones.
        </Paragraph>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      {!entries.length ? (
        <Card>
          <Alert
            type="info"
            showIcon
            message="Noch keine POs oder FOs erfasst."
            description="Lege zuerst Bestellungen in den entsprechenden Modulen an."
          />
        </Card>
      ) : null}

      {entries.length > 0 && !timeline ? (
        <Card>
          <Alert
            type="warning"
            showIcon
            message="Zeitraum konnte nicht berechnet werden."
            description="Bitte pruefe Startmonat/Horizont in den Settings."
          />
        </Card>
      ) : null}

      {timeline ? (
        <Card className="plan-card">
          <Title level={4}>Plan</Title>
          <Paragraph>
            Start: <strong>{startMonth}</strong> | Horizont: <strong>{horizon}</strong> Monate | Eintraege: <strong>{rows.length}</strong>
          </Paragraph>
          <div
            className="plan-grid"
            style={{ "--plan-cols": months.length } as CSSProperties}
          >
            <div className="plan-months">
              <div className="plan-month head" />
              {months.map((month) => (
                <div className="plan-month" key={month}>
                  {formatMonthLabel(month)}
                </div>
              ))}
            </div>
            <div className="plan-rows">
              {rows.map((row) => (
                <div className={`plan-row${row.warn ? " warn" : ""}`} key={row.id}>
                  <div className="plan-label">
                    <div className="plan-title">
                      {row.type} | {row.label}
                      {row.warn ? <span className="plan-alert" title={row.warnText}>!</span> : null}
                    </div>
                    <div className="plan-meta">{row.subtitle}</div>
                  </div>
                  <div className="plan-track">
                    {row.phases.map((phase) => (
                      <div
                        key={phase.key}
                        className={`plan-phase ${phase.cls}`}
                        style={{ left: `${phase.left}%`, width: `${phase.width}%` }}
                        title={phase.label}
                      />
                    ))}
                    {row.markers.map((marker) => (
                      <div
                        key={marker.key}
                        className="plan-marker"
                        style={{ left: `${marker.left}%` }}
                        title={marker.title}
                      >
                        <span />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="plan-legend">
            <span><span className="legend-box production" /> Produktion</span>
            <span><span className="legend-box transit" /> Transit</span>
            <span><span className="legend-dot" /> Zahlung (Milestone)</span>
          </div>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Reihen mit ! markieren Milestone-Summen ungleich 100%.
          </Paragraph>
        </Card>
      ) : null}
    </div>
  );
}
