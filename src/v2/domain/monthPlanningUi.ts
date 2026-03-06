import { v2ChartPalette, v2SkuPlanningChartColors } from "../app/chartPalette";
import type { MonthReviewItem } from "./monthPlanning";
import { formatMonthLabel, normalizeMonthKey } from "./months";
import { buildForecastConflictSummary } from "./forecastConflictActions";

export type MonthPlanningActionId =
  | "open_specialist"
  | "open_sku_planning"
  | "convert_to_fo"
  | "accept_risk_1"
  | "accept_risk_2"
  | "resolve_forecast_conflict";

export interface MonthPlanningActionDefinition {
  id: MonthPlanningActionId;
  label: string;
  variant: "primary" | "default";
}

export interface MonthPlanningDateMeta {
  label: string;
  value: string | null;
  overdue: boolean;
}

export interface MonthPlanningActionSurface {
  typeLabel: string;
  problemStatement: string;
  specialistLabel: string;
  showSupplyVisual: boolean;
  actions: MonthPlanningActionDefinition[];
  dateMeta: MonthPlanningDateMeta;
}

export interface MonthPlanningInboundEvent {
  id: string;
  ref: string;
  units: number;
  arrivalDate: string | null;
  arrivalSource: string | null;
}

export interface MonthPlanningSupplyMonthRow {
  month: string;
  projectedUnits: number | null;
  inboundUnits: number | null;
  poCount: number;
  foCount: number;
  daysToOos: number | null;
  safetyUnits: number | null;
  poItems: MonthPlanningInboundEvent[];
  foItems: MonthPlanningInboundEvent[];
}

export interface MonthPlanningSupplyContext {
  firstUnderSafety: string | null;
  firstOos: string | null;
  monthRows: MonthPlanningSupplyMonthRow[];
  selectedMonth: string;
}

export interface MonthPlanningTimelineMarker {
  id: string;
  label: string;
  dateLabel: string;
  positionPct: number;
  tone: "critical" | "warning" | "good" | "info";
  lane: number;
}

export interface MonthPlanningTimelineSegment {
  key: string;
  label: string;
  positionPct: number;
}

export interface MonthPlanningSupplyVisualModel {
  chartOption: Record<string, unknown>;
  timeline: {
    startLabel: string;
    endLabel: string;
    markers: MonthPlanningTimelineMarker[];
    segments: MonthPlanningTimelineSegment[];
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null | undefined): Date | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  const date = parseIsoDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatUnits(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE");
}

function formatDeadlineDateMeta(item: MonthReviewItem, referenceDateIso = todayIso()): MonthPlanningDateMeta {
  const latestOrderDate = String(item.latestOrderDate || "").trim() || null;
  if (latestOrderDate) {
    const overdue = Boolean(item.isOverdue || latestOrderDate < referenceDateIso);
    return {
      label: overdue ? "Überfällig seit" : "Empfohlene Aktion bis",
      value: latestOrderDate,
      overdue,
    };
  }
  const etaDate = String(item.requiredArrivalDate || item.recommendedArrivalDate || "").trim() || null;
  if (etaDate) {
    return {
      label: "ETA-Ziel",
      value: etaDate,
      overdue: false,
    };
  }
  return {
    label: "Review-Monat",
    value: null,
    overdue: false,
  };
}

export function buildMonthPlanningActionSurface(
  item: MonthReviewItem,
  referenceDateIso = todayIso(),
): MonthPlanningActionSurface {
  const isOpen = item.status === "open";
  const defaultSurface = {
    specialistLabel: "Fachmodul öffnen",
    showSupplyVisual: false,
    dateMeta: formatDeadlineDateMeta(item, referenceDateIso),
  };

  if (item.type === "inventory_order_required") {
    return {
      ...defaultSurface,
      typeLabel: "Bestellpflicht",
      problemStatement: "Die SKU braucht im Review-Monat eine Bestellung, damit der spätere Bestandsbruch vermieden wird.",
      specialistLabel: "SKU Planung öffnen",
      showSupplyVisual: true,
      actions: [
        ...(isOpen && Number(item.suggestedUnits || 0) > 0 ? [{ id: "convert_to_fo", label: "Bestellung auslösen", variant: "primary" as const }] : []),
        ...(isOpen ? [
          { id: "accept_risk_1", label: "Risiko 1 Monat akzeptieren", variant: "default" as const },
          { id: "accept_risk_2", label: "Risiko 2 Monate akzeptieren", variant: "default" as const },
        ] : []),
        { id: "open_sku_planning", label: "SKU Planung öffnen", variant: "default" as const },
      ],
    };
  }

  if (item.type === "overdue_order_decision") {
    return {
      ...defaultSurface,
      typeLabel: "Überfällige Bestellpflicht",
      problemStatement: "Die empfohlene Bestellung wurde verpasst. Jetzt ist Nachsteuerung oder eine bewusste Risikoentscheidung nötig.",
      specialistLabel: "SKU Planung öffnen",
      showSupplyVisual: true,
      actions: [
        ...(isOpen && Number(item.suggestedUnits || 0) > 0 ? [{ id: "convert_to_fo", label: "Nachsteuerung starten", variant: "primary" as const }] : []),
        ...(isOpen ? [
          { id: "accept_risk_1", label: "Risiko 1 Monat akzeptieren", variant: "default" as const },
          { id: "accept_risk_2", label: "Risiko 2 Monate akzeptieren", variant: "default" as const },
        ] : []),
        { id: "open_sku_planning", label: "SKU Planung öffnen", variant: "default" as const },
      ],
    };
  }

  if (item.type === "inventory_risk_acceptance_required") {
    return {
      ...defaultSurface,
      typeLabel: item.status === "accepted" ? "Risiko akzeptiert" : "Bestandsrisiko",
      problemStatement: item.status === "accepted"
        ? "Die Risikoentscheidung ist bereits dokumentiert und bleibt hier transparent sichtbar."
        : "Für diese SKU besteht ein Bestandsrisiko. Entscheide, ob du das Risiko akzeptierst oder aktiv nachsteuerst.",
      specialistLabel: "SKU Planung öffnen",
      showSupplyVisual: true,
      actions: [
        ...(isOpen ? [
          { id: "accept_risk_1", label: "Risiko 1 Monat akzeptieren", variant: "primary" as const },
          { id: "accept_risk_2", label: "Risiko 2 Monate akzeptieren", variant: "default" as const },
        ] : []),
        ...(isOpen && Number(item.suggestedUnits || 0) > 0 ? [{ id: "convert_to_fo", label: "Bestellung auslösen", variant: "default" as const }] : []),
        { id: "open_sku_planning", label: "SKU Planung öffnen", variant: "default" as const },
      ],
    };
  }

  if (item.type === "forecast_conflict_relevant") {
    const isFoConflict = item.sourceKind === "fo_conflict" && Boolean(item.foId);
    return {
      ...defaultSurface,
      typeLabel: isFoConflict
        ? (item.isOverdue ? "Überfälliger Forecast-Konflikt" : "Forecast-Konflikt")
        : "Forecast-Blocker",
      problemStatement: isFoConflict
        ? "Bestehende FO passt nicht mehr zum Forecast."
        : "Für diese SKU fehlt ein belastbarer Forecast-Kontext im Review-Monat.",
      specialistLabel: "Forecast-Modul öffnen",
      showSupplyVisual: isFoConflict,
      actions: [
        ...(isOpen && isFoConflict ? [{ id: "resolve_forecast_conflict", label: "Konflikt lösen", variant: "primary" as const }] : []),
        {
          id: "open_specialist",
          label: "Forecast-Modul öffnen",
          variant: isOpen && isFoConflict ? "default" as const : "primary" as const,
        },
      ],
    };
  }

  if (item.type === "cash_in_missing") {
    return {
      ...defaultSurface,
      typeLabel: "Cash-in",
      problemStatement: "Für diesen Monat fehlt die Cash-in-Basis. Ohne sie kann der Monat nicht robust werden.",
      specialistLabel: "Cash-in Setup öffnen",
      actions: [{ id: "open_specialist", label: "Cash-in Setup öffnen", variant: "primary" }],
    };
  }

  if (item.type === "fixcost_missing") {
    return {
      ...defaultSurface,
      typeLabel: "Fixkosten",
      problemStatement: "Die Fixkostenbasis fehlt oder ist unvollständig und blockiert den Monatsabschluss.",
      specialistLabel: "Fixkosten öffnen",
      actions: [{ id: "open_specialist", label: "Fixkosten öffnen", variant: "primary" }],
    };
  }

  if (item.type === "vat_missing") {
    return {
      ...defaultSurface,
      typeLabel: "VAT",
      problemStatement: "Die VAT-/USt-Basis fehlt. Der Monat bleibt dadurch fachlich unvollständig.",
      specialistLabel: "USt Vorschau öffnen",
      actions: [{ id: "open_specialist", label: "USt Vorschau öffnen", variant: "primary" }],
    };
  }

  if (item.type === "revenue_input_missing") {
    return {
      ...defaultSurface,
      typeLabel: "Revenue",
      problemStatement: "Fehlende Revenue-Inputs verhindern eine saubere Bewertung des Monats.",
      specialistLabel: "Produktdaten öffnen",
      actions: [{ id: "open_specialist", label: "Produktdaten öffnen", variant: "primary" }],
    };
  }

  return {
    ...defaultSurface,
    typeLabel: "Stammdaten",
    problemStatement: "Fehlende Stammdaten blockieren den operativen oder finanziellen Review des Monats.",
    specialistLabel: "Stammdaten prüfen",
    actions: [{ id: "open_specialist", label: "Stammdaten prüfen", variant: "primary" }],
  };
}

function resolveSimulationDelta(item: MonthReviewItem, month: string): number {
  if (item.type === "inventory_order_required" || item.type === "overdue_order_decision" || item.type === "inventory_risk_acceptance_required") {
    const arrivalMonth = normalizeMonthKey(String(item.requiredArrivalDate || item.recommendedArrivalDate || "").slice(0, 7));
    if (!arrivalMonth || month < arrivalMonth) return 0;
    return Number.isFinite(Number(item.suggestedUnits)) ? Number(item.suggestedUnits) : 0;
  }
  if (item.type === "forecast_conflict_relevant") {
    const currentArrivalMonth = normalizeMonthKey(String(item.currentEtaDate || item.currentTargetDeliveryDate || "").slice(0, 7));
    const recommendedArrivalMonth = normalizeMonthKey(String(item.recommendedArrivalDate || item.requiredArrivalDate || "").slice(0, 7));
    const currentUnits = Number.isFinite(Number(item.currentUnits)) ? Number(item.currentUnits) : 0;
    const recommendedUnits = Number.isFinite(Number(item.suggestedUnits)) ? Number(item.suggestedUnits) : 0;
    let delta = 0;
    if (currentArrivalMonth && month >= currentArrivalMonth) delta -= currentUnits;
    if (recommendedArrivalMonth && month >= recommendedArrivalMonth) delta += recommendedUnits;
    return delta;
  }
  return 0;
}

function monthStartDate(month: string): Date | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  return new Date(`${normalized}-01T00:00:00.000Z`);
}

function monthEndDate(month: string): Date | null {
  const start = monthStartDate(month);
  if (!start) return null;
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
}

function buildTimelineDateRange(context: MonthPlanningSupplyContext): { startMs: number; endMs: number } | null {
  const firstMonth = context.monthRows[0]?.month || context.selectedMonth;
  const lastMonth = context.monthRows[context.monthRows.length - 1]?.month || context.selectedMonth;
  const monthStart = monthStartDate(firstMonth);
  const monthEnd = monthEndDate(lastMonth);
  const today = parseIsoDate(todayIso());
  const startCandidates = [monthStart, today].filter((entry): entry is Date => Boolean(entry)).map((entry) => entry.getTime());
  const endCandidates = [monthEnd, today].filter((entry): entry is Date => Boolean(entry)).map((entry) => entry.getTime());
  if (!startCandidates.length || !endCandidates.length) return null;
  const startMs = Math.min(...startCandidates);
  const endMs = Math.max(...endCandidates);
  return endMs > startMs ? { startMs, endMs } : { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

function toPositionPct(date: string, range: { startMs: number; endMs: number }): number {
  const parsed = parseIsoDate(date);
  if (!parsed) return 0;
  const ratio = (parsed.getTime() - range.startMs) / Math.max(1, range.endMs - range.startMs);
  return Math.max(0, Math.min(100, ratio * 100));
}

function buildTimelineMarkers(item: MonthReviewItem, context: MonthPlanningSupplyContext): MonthPlanningTimelineMarker[] {
  const rawMarkers: Array<{ id: string; label: string; date: string; tone: MonthPlanningTimelineMarker["tone"] }> = [];
  const today = todayIso();
  rawMarkers.push({ id: "today", label: "Heute", date: today, tone: "info" });

  const dateMeta = formatDeadlineDateMeta(item, today);
  if (dateMeta.value) {
    rawMarkers.push({
      id: "deadline",
      label: dateMeta.overdue ? "Überfällig" : "Bestellen bis",
      date: dateMeta.value,
      tone: dateMeta.overdue ? "critical" : "warning",
    });
  }

  if (item.requiredArrivalDate) {
    rawMarkers.push({
      id: "required-arrival",
      label: item.type === "forecast_conflict_relevant" ? "Required Arrival" : "ETA-Ziel",
      date: item.requiredArrivalDate,
      tone: "warning",
    });
  }

  if (item.type === "forecast_conflict_relevant") {
    const currentArrivalDate = String(item.currentEtaDate || item.currentTargetDeliveryDate || "").trim();
    if (currentArrivalDate) {
      rawMarkers.push({
        id: `conflict-fo:${item.foId || "current"}`,
        label: `Aktuelle FO ${item.foId || ""}`.trim(),
        date: currentArrivalDate,
        tone: "critical",
      });
    }
    const recommendedArrivalDate = String(item.recommendedArrivalDate || item.requiredArrivalDate || "").trim();
    if (recommendedArrivalDate) {
      rawMarkers.push({
        id: "recommended-arrival",
        label: "Empfohlene Ankunft",
        date: recommendedArrivalDate,
        tone: "good",
      });
    }
  }

  context.monthRows.forEach((row) => {
    row.poItems.forEach((entry) => {
      if (!entry.arrivalDate) return;
      rawMarkers.push({
        id: `po:${entry.id}:${entry.arrivalDate}`,
        label: `${entry.ref} · ${formatUnits(entry.units)} U`,
        date: entry.arrivalDate,
        tone: "info",
      });
    });
    row.foItems.forEach((entry) => {
      if (!entry.arrivalDate) return;
      rawMarkers.push({
        id: `fo:${entry.id}:${entry.arrivalDate}`,
        label: item.foId && entry.id === item.foId
          ? `Konflikt-FO ${entry.ref}`
          : `${entry.ref} · ${formatUnits(entry.units)} U`,
        date: entry.arrivalDate,
        tone: item.foId && entry.id === item.foId ? "critical" : "info",
      });
    });
  });

  const range = buildTimelineDateRange(context);
  if (!range) return [];

  return rawMarkers
    .slice()
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")))
    .map((entry, index) => ({
      id: entry.id,
      label: entry.label,
      dateLabel: formatDate(entry.date),
      positionPct: toPositionPct(entry.date, range),
      tone: entry.tone,
      lane: index % 3,
    }));
}

function buildTimelineSegments(context: MonthPlanningSupplyContext, markers: MonthPlanningTimelineMarker[]): {
  startLabel: string;
  endLabel: string;
  segments: MonthPlanningTimelineSegment[];
} {
  const firstMonth = context.monthRows[0]?.month || context.selectedMonth;
  const lastMonth = context.monthRows[context.monthRows.length - 1]?.month || context.selectedMonth;
  const resolvedRange = buildTimelineDateRange(context);
  const segments = context.monthRows.map((row) => {
    const start = monthStartDate(row.month);
    const positionPct = resolvedRange && start
      ? toPositionPct(start.toISOString().slice(0, 10), resolvedRange)
      : 0;
    return {
      key: row.month,
      label: formatMonthLabel(row.month),
      positionPct,
    };
  });
  return {
    startLabel: formatMonthLabel(firstMonth),
    endLabel: formatMonthLabel(lastMonth),
    segments,
  };
}

function buildChartOption(item: MonthReviewItem, context: MonthPlanningSupplyContext): Record<string, unknown> {
  const months = context.monthRows.map((entry) => entry.month);
  const baseSeries = context.monthRows.map((entry) => Number.isFinite(Number(entry.projectedUnits)) ? Number(entry.projectedUnits) : null);
  const safetySeries = context.monthRows.map((entry) => Number.isFinite(Number(entry.safetyUnits)) ? Number(entry.safetyUnits) : null);
  const simulatedSeries = context.monthRows.map((entry) => {
    if (!Number.isFinite(Number(entry.projectedUnits))) return null;
    return Number(entry.projectedUnits) + resolveSimulationDelta(item, entry.month);
  });
  const allValues = [...baseSeries, ...safetySeries, ...simulatedSeries]
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  const minValue = allValues.length ? Math.min(...allValues, 0) : 0;
  const maxValue = allValues.length ? Math.max(...allValues, 0) : 0;
  const yPadding = Math.max(20, Math.round((maxValue - minValue || 100) * 0.12));
  const markLineData = [
    { yAxis: 0, name: "OOS" },
    { xAxis: context.selectedMonth, name: "Review" },
    ...(context.firstUnderSafety ? [{ xAxis: context.firstUnderSafety, name: "Unter Safety" }] : []),
    ...(context.firstOos ? [{ xAxis: context.firstOos, name: "OOS ab" }] : []),
  ];
  return {
    animation: false,
    grid: {
      left: 52,
      right: 24,
      top: 34,
      bottom: 42,
    },
    legend: {
      top: 6,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: {
        formatter: (value: string) => formatMonthLabel(String(value || "")),
      },
    },
    yAxis: {
      type: "value",
      min: minValue - yPadding,
      max: maxValue + yPadding,
      name: "Units",
    },
    series: [
      {
        name: "Safety",
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1, type: "dashed", color: v2SkuPlanningChartColors.safetyLine },
        areaStyle: { color: v2SkuPlanningChartColors.safetyArea },
        data: safetySeries,
      },
      {
        name: "Aktuelle Projektion",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: v2SkuPlanningChartColors.baseInventory },
        itemStyle: { color: v2SkuPlanningChartColors.baseInventory },
        markLine: {
          symbol: "none",
          lineStyle: { type: "dotted", color: v2SkuPlanningChartColors.oosLine },
          label: { formatter: "{b}" },
          data: markLineData,
        },
        data: baseSeries,
      },
      {
        name: "Mit empfohlener Aktion",
        type: "line",
        smooth: true,
        symbol: "diamond",
        symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: v2ChartPalette.successDark },
        itemStyle: { color: v2ChartPalette.successDark },
        data: simulatedSeries,
      },
    ],
  };
}

export function buildMonthPlanningSupplyVisualModel(
  item: MonthReviewItem,
  context: MonthPlanningSupplyContext | null,
): MonthPlanningSupplyVisualModel | null {
  if (!context?.monthRows.length) return null;
  const markers = buildTimelineMarkers(item, context);
  const { startLabel, endLabel, segments } = buildTimelineSegments(context, markers);
  return {
    chartOption: buildChartOption(item, context),
    timeline: {
      startLabel,
      endLabel,
      markers,
      segments,
    },
  };
}

export function buildMonthPlanningConflictBadges(item: MonthReviewItem): string[] {
  if (item.type !== "forecast_conflict_relevant") return [];
  const summary = item.conflictSummary || buildForecastConflictSummary(item.conflictTypes);
  if (!summary) return [];
  return summary.split(",").map((entry) => entry.trim()).filter(Boolean);
}
