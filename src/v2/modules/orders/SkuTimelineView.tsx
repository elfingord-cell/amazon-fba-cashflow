import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Button, Card, DatePicker, Input, Segmented, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import {
  OrdersGanttTimeline,
  type OrdersGanttGroup,
  type OrdersGanttItem,
} from "../../components/OrdersGanttTimeline";
import {
  safeTimelineSpanMs,
  timelineRangeFromIsoDates,
  toTimelineMs,
} from "../../components/ordersTimelineUtils";
import { buildCategoryOrderMap, compareCategoryLabels } from "../../domain/categoryOrder";
import {
  computeFoSchedule,
  computePoAggregateMetrics,
  computeScheduleFromOrderDate,
  normalizeFoStatus,
} from "../../domain/orderUtils";
import {
  buildPhantomFoSuggestions,
  resolvePlanningMonthsFromState,
  type PhantomFoSuggestion,
} from "../../domain/phantomFo";
import { formatMonthLabel } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";

const { Text } = Typography;
const { RangePicker } = DatePicker;

type SkuTypeFilter = "all" | "po" | "fo";
type SkuStatusFilter = "planning" | "all" | "closed";
type TimeRangePreset = "3m" | "6m" | "12m" | "18m" | "custom";
type TimelineEntityLabel = "PO" | "FO";
type TimelinePhaseLabel = "Production" | "Transit";
type ReferencePlacement = "left" | "right" | "below";

const TIME_RANGE_PRESET_MONTHS: Record<Exclude<TimeRangePreset, "custom">, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
};

const UNKNOWN_LABEL = "-";

interface SkuTooltipData {
  type: TimelineEntityLabel;
  identifier: string;
  phase: TimelinePhaseLabel;
  units: number | null;
  startDate: string;
  endDate: string;
  supplier: string | null;
  destination: string | null;
  referenceLabel: string;
  showReferenceLabel: boolean;
  isPhantom?: boolean;
  phantomReason?: string | null;
}

interface PhantomOpenTargetMeta {
  id: string;
  sku: string;
  month: string;
  suggestedUnits: number;
  requiredArrivalDate: string | null;
  recommendedOrderDate: string | null;
  firstRiskMonth: string | null;
  orderMonth: string | null;
  leadTimeDays: number | null;
}

interface SkuTimelineItem {
  id: string;
  startMs: number;
  endMs: number;
  className: string;
  tooltipData: SkuTooltipData;
  openTarget: {
    entity: "po" | "fo";
    poNo?: string;
    foId?: string;
    phantomMeta?: PhantomOpenTargetMeta | null;
  };
}

interface SkuBucket {
  sku: string;
  alias: string;
  supplierId: string;
  supplierName: string;
  categoryId: string | null;
  categoryLabel: string;
  items: SkuTimelineItem[];
  references: string[];
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeStatusForPo(entry: Record<string, unknown>): "planning" | "closed" {
  const archived = entry.archived === true;
  const cancelled = String(entry.status || "").trim().toUpperCase() === "CANCELLED";
  return archived || cancelled ? "closed" : "planning";
}

function normalizeStatusForFo(entry: Record<string, unknown>): "planning" | "closed" {
  const status = normalizeFoStatus(entry.status);
  if (status === "DRAFT" || status === "ACTIVE") return "planning";
  return "closed";
}

function compareBucketOrder(
  left: SkuBucket,
  right: SkuBucket,
  categoryOrderMap: Map<string, number>,
): number {
  const byCategory = compareCategoryLabels(left.categoryLabel, right.categoryLabel, categoryOrderMap);
  if (byCategory !== 0) return byCategory;
  const byAlias = String(left.alias || "").localeCompare(String(right.alias || ""), "de-DE", {
    sensitivity: "base",
  });
  if (byAlias !== 0) return byAlias;
  return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
}

function parseUnits(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function formatUnits(units: number | null): string {
  if (!Number.isFinite(units as number)) return UNKNOWN_LABEL;
  return `${Number(units).toLocaleString("de-DE", { maximumFractionDigits: 0 })} Stk`;
}

function formatIsoDate(value: string): string {
  if (!value) return UNKNOWN_LABEL;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return value;
  return parsed.format("DD.MM.YYYY");
}

function resolveDestination(entry: Record<string, unknown>): string | null {
  const candidates = [
    entry.destination,
    entry.destinationName,
    entry.targetWarehouse,
    entry.warehouse,
    entry.warehouseName,
    entry.fulfillmentCenter,
    entry.portTo,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return null;
}

function formatReference(prefix: TimelineEntityLabel, raw: string): string {
  const compact = String(raw || "").trim().replace(/\s+/g, "");
  if (!compact) return prefix;
  const upper = compact.toUpperCase();
  return upper.startsWith(prefix) ? upper : `${prefix}${compact}`;
}

function estimateReferenceWidth(referenceLabel: string): number {
  const text = String(referenceLabel || "");
  if (!text) return 38;
  return Math.max(38, Math.round(text.length * 6.4 + 12));
}

function computeItemRadius(input: any): number {
  const dimensions = (input?.itemContext?.dimensions || {}) as { width?: number; height?: number };
  const width = Number(dimensions.width || 0);
  const height = Number(dimensions.height || 0);
  const radius = Math.min(Math.max(0, height / 2), Math.max(0, width / 2 - 1), 10);
  if (!Number.isFinite(radius)) return 0;
  return Math.max(0, radius);
}

function resolveReferencePlacement(input: any, referenceLabel: string): ReferencePlacement {
  const dimensions = (input?.itemContext?.dimensions || {}) as { width?: number; left?: number };
  const width = Number(dimensions.width || 0);
  const left = Number(dimensions.left || 0);
  const labelWidth = estimateReferenceWidth(referenceLabel);
  const timelineState = typeof input?.timelineContext?.getTimelineState === "function"
    ? input.timelineContext.getTimelineState()
    : null;
  const timelineWidth = Number(timelineState?.timelineWidth || 0);
  if (timelineWidth <= 0) return "right";
  const spaceRight = Math.max(0, timelineWidth - (left + width));
  const spaceLeft = Math.max(0, left);
  if (spaceRight >= labelWidth + 6) return "right";
  if (spaceLeft >= labelWidth + 6) return "left";
  return "right";
}

function applyReferenceLabelToLatestSegment(segments: SkuTimelineItem[]): SkuTimelineItem[] {
  if (!segments.length) return segments;
  let latestIndex = 0;
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].endMs >= segments[latestIndex].endMs) {
      latestIndex = index;
    }
  }
  return segments.map((segment, index) => ({
    ...segment,
    tooltipData: {
      ...segment.tooltipData,
      showReferenceLabel: index === latestIndex,
    },
  }));
}

function tooltipValue(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text || UNKNOWN_LABEL;
}

function tooltipContent(meta: Partial<SkuTooltipData>): JSX.Element {
  const rows = [
    { key: "Typ", value: tooltipValue(meta.type) },
    { key: "Nummer", value: tooltipValue(meta.identifier) },
    { key: "Phase", value: tooltipValue(meta.phase) },
    { key: "Menge", value: formatUnits(meta.units ?? null) },
    {
      key: "Zeitraum",
      value: `${formatIsoDate(String(meta.startDate || ""))} - ${formatIsoDate(String(meta.endDate || ""))}`,
    },
    { key: "Supplier", value: tooltipValue(meta.supplier) },
  ];
  if (meta.destination) {
    rows.push({ key: "Ziel", value: tooltipValue(meta.destination) });
  }
  if (meta.isPhantom) {
    rows.push({ key: "Hinweis", value: tooltipValue(meta.phantomReason || "Phantom FO (vorbehaltlich)") });
  }
  return (
    <div className="v2-orders-gantt-tooltip">
      {rows.map((row) => (
        <div className="v2-orders-gantt-tooltip-row" key={row.key}>
          <span className="v2-orders-gantt-tooltip-key">{row.key}</span>
          <span className="v2-orders-gantt-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SkuTimelineView(): JSX.Element {
  const navigate = useNavigate();
  const { state } = useWorkspaceState();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<SkuTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<SkuStatusFilter>("planning");
  const [rangePreset, setRangePreset] = useState<TimeRangePreset>("12m");
  const [phantomTargetMonth, setPhantomTargetMonth] = useState<string>("");
  const [customRange, setCustomRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const stateObject = state as unknown as Record<string, unknown>;
  const categoryOrderMap = useMemo(
    () => buildCategoryOrderMap(stateObject),
    [state.productCategories],
  );

  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.productCategories) ? state.productCategories : [])
      .forEach((entry) => {
        const row = entry as Record<string, unknown>;
        const id = String(row.id || "");
        if (!id) return;
        map.set(id, String(row.name || "Ohne Kategorie"));
      });
    return map;
  }, [state.productCategories]);

  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.suppliers) ? state.suppliers : [])
      .forEach((entry) => {
        const row = entry as Record<string, unknown>;
        const id = String(row.id || "");
        if (!id) return;
        map.set(id, String(row.name || UNKNOWN_LABEL));
      });
    return map;
  }, [state.suppliers]);

  const productBySku = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.products) ? state.products : [])
      .forEach((entry) => {
        const row = entry as Record<string, unknown>;
        const sku = normalizeSku(row.sku);
        if (!sku) return;
        map.set(sku, row);
      });
    return map;
  }, [state.products]);

  const planningMonths = useMemo(
    () => resolvePlanningMonthsFromState(stateObject, 18),
    [state.settings],
  );
  const resolvedPhantomTargetMonth = useMemo(() => {
    if (phantomTargetMonth && planningMonths.includes(phantomTargetMonth)) return phantomTargetMonth;
    return planningMonths[planningMonths.length - 1] || "";
  }, [phantomTargetMonth, planningMonths]);

  useEffect(() => {
    if (!planningMonths.length) {
      setPhantomTargetMonth("");
      return;
    }
    setPhantomTargetMonth((current) => (
      current && planningMonths.includes(current)
        ? current
        : planningMonths[planningMonths.length - 1]
    ));
  }, [planningMonths]);

  const phantomFoSuggestions = useMemo<PhantomFoSuggestion[]>(
    () => buildPhantomFoSuggestions({
      state: stateObject,
      months: planningMonths,
      targetMonth: resolvedPhantomTargetMonth || null,
    }),
    [planningMonths, resolvedPhantomTargetMonth, stateObject],
  );
  const phantomFoById = useMemo(
    () => new Map(phantomFoSuggestions.map((entry) => [entry.id, entry])),
    [phantomFoSuggestions],
  );

  const categoryOptions = useMemo(() => {
    const options = (Array.isArray(state.productCategories) ? state.productCategories : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        value: String(entry.id || ""),
        label: String(entry.name || "Ohne Kategorie"),
      }))
      .filter((entry) => entry.value)
      .sort((a, b) => compareCategoryLabels(a.label, b.label, categoryOrderMap));
    return [
      { value: "all", label: "Kategorie: Alle" },
      ...options,
      { value: "__uncat__", label: "Ohne Kategorie" },
    ];
  }, [categoryOrderMap, state.productCategories]);

  const supplierOptions = useMemo(() => {
    const options = Array.from(supplierById.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "de-DE", { sensitivity: "base" }));
    return [{ value: "all", label: "Supplier: Alle" }, ...options];
  }, [supplierById]);

  const skuItemRenderer = useCallback((input: any): JSX.Element => {
    const item = (input?.item || {}) as { className?: unknown; meta?: unknown };
    const meta = (item.meta && typeof item.meta === "object")
      ? item.meta as Partial<SkuTooltipData>
      : {};
    const referenceLabel = String(meta.referenceLabel || "");
    const showReferenceLabel = meta.showReferenceLabel === true && Boolean(referenceLabel);
    const referencePlacement = showReferenceLabel ? resolveReferencePlacement(input, referenceLabel) : "right";
    const dynamicRadius = computeItemRadius(input);
    const rootProps = input.getItemProps({
      className: `${String(item.className || "")} v2-orders-gantt-pill v2-orders-gantt-pill--minimal`.trim(),
      style: {
        borderRadius: `${dynamicRadius}px`,
      } as CSSProperties,
    });
    return (
      <Tooltip
        title={tooltipContent(meta)}
        placement="top"
        mouseEnterDelay={0.12}
        overlayClassName="v2-orders-gantt-tooltip-overlay"
      >
        <div {...rootProps}>
          {showReferenceLabel ? (
            <span className={`v2-orders-gantt-ref v2-orders-gantt-ref--${referencePlacement}`}>
              {referenceLabel}
            </span>
          ) : null}
        </div>
      </Tooltip>
    );
  }, []);

  const timelineData = useMemo(() => {
    const buckets = new Map<string, SkuBucket>();
    const timelineDates: string[] = [];

    const ensureBucket = (sku: string, supplierIdFallback = ""): SkuBucket => {
      if (buckets.has(sku)) return buckets.get(sku) as SkuBucket;
      const product = productBySku.get(sku) || {};
      const supplierId = String(product.supplierId || supplierIdFallback || "");
      const supplierName = supplierById.get(supplierId) || UNKNOWN_LABEL;
      const categoryIdRaw = String(product.categoryId || "");
      const categoryId = categoryIdRaw || null;
      const categoryLabel = categoryId
        ? (categoryById.get(categoryId) || "Ohne Kategorie")
        : "Ohne Kategorie";
      const alias = String(product.alias || sku);
      const next: SkuBucket = {
        sku,
        alias,
        supplierId,
        supplierName,
        categoryId,
        categoryLabel,
        items: [],
        references: [],
      };
      buckets.set(sku, next);
      return next;
    };

    (Array.isArray(state.pos) ? state.pos : [])
      .map((entry) => entry as Record<string, unknown>)
      .forEach((po) => {
        const poStatus = normalizeStatusForPo(po);
        if (statusFilter === "planning" && poStatus !== "planning") return;
        if (statusFilter === "closed" && poStatus !== "closed") return;

        const aggregate = computePoAggregateMetrics({
          items: po.items,
          orderDate: po.orderDate,
          fxRate: Number((state.settings as Record<string, unknown> | undefined)?.fxRate || 0),
          fallback: po,
        });
        const schedule = computeScheduleFromOrderDate({
          orderDate: po.orderDate,
          productionLeadTimeDays: aggregate.prodDays || po.prodDays,
          logisticsLeadTimeDays: aggregate.transitDays || po.transitDays,
          bufferDays: 0,
        });

        const orderIso = String(po.orderDate || "");
        const etdIso = String(po.etdManual || schedule.etdDate || "");
        const etaIso = String(po.etaManual || schedule.etaDate || "");
        const orderMs = toTimelineMs(orderIso);
        const etdMs = toTimelineMs(etdIso);
        const etaMs = toTimelineMs(etaIso);
        const destination = resolveDestination(po);

        if (orderIso) timelineDates.push(orderIso);
        if (etdIso) timelineDates.push(etdIso);
        if (etaIso) timelineDates.push(etaIso);

        const poNo = String(po.poNo || String(po.id || "").slice(-6).toUpperCase() || "PO");
        const poRef = formatReference("PO", poNo);
        const supplierId = String(po.supplierId || "");
        const poItems = Array.isArray(po.items) && po.items.length
          ? (po.items as Record<string, unknown>[])
          : [{ sku: po.sku, units: po.units }];

        poItems.forEach((item, itemIndex) => {
          const sku = normalizeSku(item?.sku || po.sku);
          if (!sku) return;

          const bucket = ensureBucket(sku, supplierId);
          const units = parseUnits(item?.units ?? item?.qty ?? item?.quantity ?? po.units);
          const supplier = bucket.supplierName !== UNKNOWN_LABEL ? bucket.supplierName : null;
          const orderSegments: SkuTimelineItem[] = [];
          const productionStart = orderMs ?? etdMs;
          const productionEnd = etdMs;
          if (productionStart != null && productionEnd != null) {
            const span = safeTimelineSpanMs({ startMs: productionStart, endMs: productionEnd });
            orderSegments.push({
              id: `po:${String(po.id || poNo)}:${sku}:${itemIndex}:production`,
              startMs: span.startMs,
              endMs: span.endMs,
              className: "v2-orders-gantt-item v2-orders-gantt-item--po-production",
              tooltipData: {
                type: "PO",
                identifier: poRef,
                phase: "Production",
                units,
                startDate: orderIso || etdIso,
                endDate: etdIso || orderIso,
                supplier,
                destination,
                referenceLabel: poRef,
                showReferenceLabel: false,
              },
              openTarget: { entity: "po", poNo },
            });
          }
          if (etaMs != null) {
            const transitStart = etdMs ?? orderMs ?? etaMs;
            const span = safeTimelineSpanMs({ startMs: transitStart, endMs: etaMs });
            orderSegments.push({
              id: `po:${String(po.id || poNo)}:${sku}:${itemIndex}:transit`,
              startMs: span.startMs,
              endMs: span.endMs,
              className: "v2-orders-gantt-item v2-orders-gantt-item--po-transit",
              tooltipData: {
                type: "PO",
                identifier: poRef,
                phase: "Transit",
                units,
                startDate: etdIso || orderIso || etaIso,
                endDate: etaIso || etdIso || orderIso,
                supplier,
                destination,
                referenceLabel: poRef,
                showReferenceLabel: false,
              },
              openTarget: { entity: "po", poNo },
            });
          }
          applyReferenceLabelToLatestSegment(orderSegments).forEach((segment) => {
            bucket.items.push(segment);
          });

          bucket.references.push(poRef);
        });
      });

    const foTimelineRows = [
      ...(Array.isArray(state.fos) ? state.fos : []).map((entry) => entry as Record<string, unknown>),
      ...phantomFoSuggestions.map((entry) => entry.foRecord),
    ];

    foTimelineRows
      .forEach((fo) => {
        const foStatus = normalizeStatusForFo(fo);
        if (statusFilter === "planning" && foStatus !== "planning") return;
        if (statusFilter === "closed" && foStatus !== "closed") return;

        const scheduleFromTarget = computeFoSchedule({
          targetDeliveryDate: fo.targetDeliveryDate || fo.deliveryDate || fo.etaDate,
          productionLeadTimeDays: fo.productionLeadTimeDays,
          logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
          bufferDays: fo.bufferDays,
        });
        const orderIso = String(fo.orderDate || scheduleFromTarget.orderDate || "");
        const etdIso = String(fo.etdDate || scheduleFromTarget.etdDate || "");
        const etaIso = String(fo.etaDate || scheduleFromTarget.etaDate || fo.targetDeliveryDate || "");
        const orderMs = toTimelineMs(orderIso);
        const etdMs = toTimelineMs(etdIso);
        const etaMs = toTimelineMs(etaIso);
        const destination = resolveDestination(fo);
        const units = parseUnits(fo.units ?? fo.qty ?? fo.quantity);

        if (orderIso) timelineDates.push(orderIso);
        if (etdIso) timelineDates.push(etdIso);
        if (etaIso) timelineDates.push(etaIso);

        const sku = normalizeSku(fo.sku);
        if (!sku) return;

        const bucket = ensureBucket(sku, String(fo.supplierId || ""));
        const foId = String(fo.id || "");
        const foDisplayRaw = String(fo.foNo || fo.foNumber || foId.slice(-6).toUpperCase() || UNKNOWN_LABEL);
        const foRef = formatReference("FO", foDisplayRaw);
        const phantomSuggestion = foId ? (phantomFoById.get(foId) || null) : null;
        const isPhantom = Boolean(fo.phantom === true || phantomSuggestion);
        const phantomMeta: PhantomOpenTargetMeta | null = isPhantom ? {
          id: String(phantomSuggestion?.id || foId),
          sku,
          month: String(phantomSuggestion?.firstRiskMonth || ""),
          suggestedUnits: Math.max(0, Math.round(Number(phantomSuggestion?.suggestedUnits || fo.units || 0))),
          requiredArrivalDate: String(
            phantomSuggestion?.requiredArrivalDate
            || fo.targetDeliveryDate
            || fo.etaDate
            || "",
          ) || null,
          recommendedOrderDate: String(
            phantomSuggestion?.recommendedOrderDate
            || phantomSuggestion?.latestOrderDate
            || fo.orderDate
            || "",
          ) || null,
          firstRiskMonth: String(phantomSuggestion?.firstRiskMonth || "") || null,
          orderMonth: String(phantomSuggestion?.orderMonth || "") || null,
          leadTimeDays: Number.isFinite(Number(phantomSuggestion?.leadTimeDays))
            ? Math.max(0, Math.round(Number(phantomSuggestion?.leadTimeDays)))
            : null,
        } : null;
        const supplier = bucket.supplierName !== UNKNOWN_LABEL ? bucket.supplierName : null;
        const foSegments: SkuTimelineItem[] = [];
        const productionStart = orderMs ?? etdMs;
        const productionEnd = etdMs;
        if (productionStart != null && productionEnd != null) {
          const span = safeTimelineSpanMs({ startMs: productionStart, endMs: productionEnd });
          foSegments.push({
            id: `fo:${foId}:${sku}:production`,
            startMs: span.startMs,
            endMs: span.endMs,
            className: [
              "v2-orders-gantt-item",
              "v2-orders-gantt-item--fo-production",
              isPhantom ? "v2-orders-gantt-item--fo-phantom" : "",
            ].join(" ").trim(),
            tooltipData: {
              type: "FO",
              identifier: foRef,
              phase: "Production",
              units,
              startDate: orderIso || etdIso,
              endDate: etdIso || orderIso,
              supplier,
              destination,
              referenceLabel: foRef,
              showReferenceLabel: false,
              isPhantom,
              phantomReason: String(phantomSuggestion?.foRecord?.phantomMeta && typeof phantomSuggestion.foRecord.phantomMeta === "object"
                ? (phantomSuggestion.foRecord.phantomMeta as Record<string, unknown>).reason
                : (fo.phantomMeta && typeof fo.phantomMeta === "object"
                  ? (fo.phantomMeta as Record<string, unknown>).reason
                  : "")) || null,
            },
            openTarget: { entity: "fo", foId, phantomMeta },
          });
        }
        if (etaMs != null) {
          const transitStart = etdMs ?? orderMs ?? etaMs;
          const span = safeTimelineSpanMs({ startMs: transitStart, endMs: etaMs });
          foSegments.push({
            id: `fo:${foId}:${sku}:transit`,
            startMs: span.startMs,
            endMs: span.endMs,
            className: [
              "v2-orders-gantt-item",
              "v2-orders-gantt-item--fo-transit",
              isPhantom ? "v2-orders-gantt-item--fo-phantom" : "",
            ].join(" ").trim(),
            tooltipData: {
              type: "FO",
              identifier: foRef,
              phase: "Transit",
              units,
              startDate: etdIso || orderIso || etaIso,
              endDate: etaIso || etdIso || orderIso,
              supplier,
              destination,
              referenceLabel: foRef,
              showReferenceLabel: false,
              isPhantom,
              phantomReason: String(phantomSuggestion?.foRecord?.phantomMeta && typeof phantomSuggestion.foRecord.phantomMeta === "object"
                ? (phantomSuggestion.foRecord.phantomMeta as Record<string, unknown>).reason
                : (fo.phantomMeta && typeof fo.phantomMeta === "object"
                  ? (fo.phantomMeta as Record<string, unknown>).reason
                  : "")) || null,
            },
            openTarget: { entity: "fo", foId, phantomMeta },
          });
        }
        applyReferenceLabelToLatestSegment(foSegments).forEach((segment) => {
          bucket.items.push(segment);
        });

        bucket.references.push(foRef);
      });

    const orderedBuckets = Array.from(buckets.values())
      .sort((a, b) => compareBucketOrder(a, b, categoryOrderMap));

    const groups: OrdersGanttGroup[] = [];
    const items: OrdersGanttItem[] = [];
    const targetByItemId = new Map<string, SkuTimelineItem["openTarget"]>();
    const needle = search.trim().toLowerCase();

    orderedBuckets.forEach((bucket) => {
      if (categoryFilter === "__uncat__" && bucket.categoryId) return;
      if (categoryFilter !== "all" && categoryFilter !== "__uncat__" && bucket.categoryId !== categoryFilter) return;
      if (supplierFilter !== "all" && bucket.supplierId !== supplierFilter) return;

      const filteredItems = bucket.items
        .filter((entry) => typeFilter === "all" || entry.openTarget.entity === typeFilter);
      if (!filteredItems.length) return;

      const searchHaystack = [
        bucket.sku,
        bucket.alias,
        bucket.supplierName,
        bucket.categoryLabel,
        ...bucket.references,
      ].join(" ").toLowerCase();
      if (needle && !searchHaystack.includes(needle)) return;

      groups.push({
        id: bucket.sku,
        title: (
          <div className="v2-orders-gantt-meta v2-orders-gantt-meta--sku">
            <div className="v2-orders-gantt-topline">
              <Text strong className="v2-orders-gantt-sku-title">{bucket.alias}</Text>
              <Tag className="v2-orders-gantt-lane-tag">{bucket.sku}</Tag>
            </div>
            <div className="v2-orders-gantt-subline">
              {bucket.supplierName} · {bucket.categoryLabel}
            </div>
          </div>
        ),
      });

      filteredItems.forEach((entry) => {
        items.push({
          id: entry.id,
          group: bucket.sku,
          startMs: entry.startMs,
          endMs: entry.endMs,
          className: entry.className,
          meta: entry.tooltipData as Record<string, unknown>,
        });
        targetByItemId.set(entry.id, entry.openTarget);
      });
    });

    return {
      groups,
      items,
      targetByItemId,
      timelineWindow: timelineRangeFromIsoDates({
        state: stateObject,
        dates: timelineDates,
        fallbackHorizon: 12,
      }),
    };
  }, [
    categoryById,
    categoryFilter,
    categoryOrderMap,
    phantomFoById,
    phantomFoSuggestions,
    productBySku,
    search,
    state.fos,
    state.pos,
    state.settings,
    stateObject,
    statusFilter,
    supplierById,
    supplierFilter,
    typeFilter,
  ]);

  const resolvedTimelineWindow = useMemo(() => {
    const baseWindow = timelineData.timelineWindow;
    if (rangePreset === "custom") {
      const startMs = customRange?.[0]?.startOf("day").valueOf();
      const endMs = customRange?.[1]?.endOf("day").valueOf();
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && Number(endMs) > Number(startMs)) {
        return {
          visibleStartMs: Number(startMs),
          visibleEndMs: Number(endMs),
        };
      }
      return baseWindow;
    }
    const startMs = dayjs(baseWindow.visibleStartMs).startOf("month").valueOf();
    const months = TIME_RANGE_PRESET_MONTHS[rangePreset];
    const endMs = dayjs(startMs).add(months, "month").endOf("day").valueOf();
    return {
      visibleStartMs: startMs,
      visibleEndMs: endMs,
    };
  }, [customRange, rangePreset, timelineData.timelineWindow]);

  return (
    <Card>
      <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
        <Input
          placeholder="Suche SKU, Alias, PO/FO, Supplier"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: 320, maxWidth: "100%" }}
        />
        <Select
          value={categoryFilter}
          options={categoryOptions}
          onChange={(value) => setCategoryFilter(String(value || "all"))}
          style={{ width: 220, maxWidth: "100%" }}
        />
        <Select
          value={supplierFilter}
          options={supplierOptions}
          onChange={(value) => setSupplierFilter(String(value || "all"))}
          style={{ width: 220, maxWidth: "100%" }}
        />
        <Select
          value={typeFilter}
          onChange={(value) => setTypeFilter(String(value || "all") as SkuTypeFilter)}
          options={[
            { value: "all", label: "Typ: PO + FO" },
            { value: "po", label: "Typ: nur PO" },
            { value: "fo", label: "Typ: nur FO" },
          ]}
          style={{ width: 170 }}
        />
        <Select
          value={statusFilter}
          onChange={(value) => setStatusFilter(String(value || "planning") as SkuStatusFilter)}
          options={[
            { value: "planning", label: "Status: Planungsrelevant" },
            { value: "all", label: "Status: Alle" },
            { value: "closed", label: "Status: Abgeschlossen" },
          ]}
          style={{ width: 220 }}
        />
      </div>

      <div className="v2-toolbar-row v2-orders-gantt-range-row" style={{ marginBottom: 10 }}>
        <Text type="secondary">Zeitraum:</Text>
        <Segmented
          value={rangePreset}
          options={[
            { value: "3m", label: "3M" },
            { value: "6m", label: "6M" },
            { value: "12m", label: "12M" },
            { value: "18m", label: "18M" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(value) => {
            const nextPreset = String(value || "12m") as TimeRangePreset;
            setRangePreset(nextPreset);
            if (nextPreset === "custom" && !customRange) {
              setCustomRange([
                dayjs(timelineData.timelineWindow.visibleStartMs),
                dayjs(timelineData.timelineWindow.visibleEndMs),
              ]);
            }
          }}
        />
        <Text type="secondary">PFO bis:</Text>
        <Select
          value={resolvedPhantomTargetMonth || undefined}
          onChange={(value) => setPhantomTargetMonth(String(value || ""))}
          options={planningMonths.map((month) => ({ value: month, label: formatMonthLabel(month) }))}
          style={{ width: 170, maxWidth: "100%" }}
          disabled={!planningMonths.length}
        />
        {rangePreset === "custom" ? (
          <RangePicker
            className="v2-orders-gantt-range-picker"
            value={customRange || undefined}
            format="DD.MM.YYYY"
            allowClear
            onChange={(value) => {
              if (!value) {
                setCustomRange(null);
                return;
              }
              setCustomRange(value as [Dayjs | null, Dayjs | null]);
            }}
          />
        ) : null}
      </div>

      <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
        <Tag>{timelineData.groups.length} SKUs</Tag>
        <Tag>{timelineData.items.length} Segmente</Tag>
        {phantomFoSuggestions.length ? <Tag color="gold">Phantom FO: {phantomFoSuggestions.length}</Tag> : null}
        {resolvedPhantomTargetMonth ? <Tag color="gold">PFO bis: {formatMonthLabel(resolvedPhantomTargetMonth)}</Tag> : null}
        <Tag color="green">SKU Timeline</Tag>
      </div>

      <div className="v2-orders-gantt-legend" style={{ marginBottom: 10 }}>
        <span><span className="v2-orders-gantt-legend-box v2-orders-gantt-legend-box--po-production" /> PO Produktion</span>
        <span><span className="v2-orders-gantt-legend-box v2-orders-gantt-legend-box--po-transit" /> PO Transit</span>
        <span><span className="v2-orders-gantt-legend-box v2-orders-gantt-legend-box--fo-production" /> FO Produktion</span>
        <span><span className="v2-orders-gantt-legend-box v2-orders-gantt-legend-box--fo-transit" /> FO Transit</span>
        <span><span className="v2-orders-gantt-legend-box v2-orders-gantt-legend-box--fo-phantom" /> Phantom FO (vorbehaltlich)</span>
      </div>

      <OrdersGanttTimeline
        className="v2-orders-gantt--sku"
        groups={timelineData.groups}
        items={timelineData.items}
        visibleStartMs={resolvedTimelineWindow.visibleStartMs}
        visibleEndMs={resolvedTimelineWindow.visibleEndMs}
        sidebarHeaderLabel="SKU"
        sidebarWidth={500}
        lineHeight={66}
        itemHeightRatio={0.58}
        stackItems
        showTodayMarker={false}
        emptyMessage="Keine SKU-Eintraege fuer die aktuelle Suche/Filter."
        itemRenderer={skuItemRenderer}
        onItemSelect={(itemId) => {
          const target = timelineData.targetByItemId.get(itemId);
          if (!target) return;
          if (target.entity === "po" && target.poNo) {
            const params = new URLSearchParams();
            params.set("source", "fo_convert");
            params.set("poNo", target.poNo);
            navigate(`/v2/orders/po?${params.toString()}`);
            return;
          }
          if (target.entity === "fo" && target.phantomMeta) {
            const params = new URLSearchParams();
            params.set("source", "phantom_fo");
            params.set("phantomId", target.phantomMeta.id);
            params.set("sku", target.phantomMeta.sku);
            params.set("month", target.phantomMeta.month);
            params.set("suggestedUnits", String(Math.max(0, Math.round(Number(target.phantomMeta.suggestedUnits || 0)))));
            if (target.phantomMeta.requiredArrivalDate) params.set("requiredArrivalDate", target.phantomMeta.requiredArrivalDate);
            if (target.phantomMeta.recommendedOrderDate) params.set("recommendedOrderDate", target.phantomMeta.recommendedOrderDate);
            if (target.phantomMeta.firstRiskMonth) params.set("firstRiskMonth", target.phantomMeta.firstRiskMonth);
            if (target.phantomMeta.orderMonth) params.set("orderMonth", target.phantomMeta.orderMonth);
            if (Number.isFinite(Number(target.phantomMeta.leadTimeDays))) {
              params.set("leadTimeDays", String(Math.max(0, Math.round(Number(target.phantomMeta.leadTimeDays || 0)))));
            }
            params.set("returnTo", "/v2/orders/sku");
            navigate(`/v2/orders/fo?${params.toString()}`);
            return;
          }
          if (target.entity === "fo" && target.foId) {
            const params = new URLSearchParams();
            params.set("source", "orders_sku");
            params.set("foId", target.foId);
            navigate(`/v2/orders/fo?${params.toString()}`);
          }
        }}
      />

      <Space style={{ marginTop: 10 }} wrap>
        <Text type="secondary">Klick auf ein Segment oeffnet den Datensatz; Phantom-FOs öffnen den vorausgefüllten FO-Entwurf.</Text>
        <Button size="small" onClick={() => navigate("/v2/orders/po?view=timeline")}>
          PO Timeline oeffnen
        </Button>
        <Button size="small" onClick={() => navigate("/v2/orders/fo?view=timeline")}>
          FO Timeline oeffnen
        </Button>
      </Space>
    </Card>
  );
}
