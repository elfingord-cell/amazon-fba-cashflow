import { useMemo, useState } from "react";
import { Button, Card, Input, Select, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { OrdersGanttTimeline, type OrdersGanttGroup, type OrdersGanttItem } from "../../components/OrdersGanttTimeline";
import { safeTimelineSpanMs, timelineRangeFromIsoDates, toTimelineMs } from "../../components/ordersTimelineUtils";
import { buildCategoryOrderMap, compareCategoryLabels } from "../../domain/categoryOrder";
import {
  computeFoSchedule,
  computePoAggregateMetrics,
  computeScheduleFromOrderDate,
  normalizeFoStatus,
} from "../../domain/orderUtils";
import { useWorkspaceState } from "../../state/workspace";

const { Text } = Typography;

type SkuTypeFilter = "all" | "po" | "fo";
type SkuStatusFilter = "planning" | "all" | "closed";

interface LaneItemTemplate {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  className: string;
  tooltip: string;
  openTarget: {
    entity: "po" | "fo";
    poNo?: string;
    foId?: string;
  };
}

interface SkuBucket {
  sku: string;
  alias: string;
  supplierId: string;
  supplierName: string;
  categoryId: string | null;
  categoryLabel: string;
  poItems: LaneItemTemplate[];
  foItems: LaneItemTemplate[];
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

function compareBucketOrder(left: SkuBucket, right: SkuBucket, categoryOrderMap: Map<string, number>): number {
  const byCategory = compareCategoryLabels(left.categoryLabel, right.categoryLabel, categoryOrderMap);
  if (byCategory !== 0) return byCategory;
  const byAlias = String(left.alias || "").localeCompare(String(right.alias || ""), "de-DE", { sensitivity: "base" });
  if (byAlias !== 0) return byAlias;
  return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
}

export default function SkuTimelineView(): JSX.Element {
  const navigate = useNavigate();
  const { state } = useWorkspaceState();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<SkuTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<SkuStatusFilter>("planning");

  const stateObject = state as unknown as Record<string, unknown>;
  const categoryOrderMap = useMemo(() => buildCategoryOrderMap(stateObject), [state.productCategories]);

  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.productCategories) ? state.productCategories : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "");
      if (!id) return;
      map.set(id, String(row.name || "Ohne Kategorie"));
    });
    return map;
  }, [state.productCategories]);

  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.suppliers) ? state.suppliers : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "");
      if (!id) return;
      map.set(id, String(row.name || "—"));
    });
    return map;
  }, [state.suppliers]);

  const productBySku = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.products) ? state.products : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const sku = normalizeSku(row.sku);
      if (!sku) return;
      map.set(sku, row);
    });
    return map;
  }, [state.products]);

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

  const timelineData = useMemo(() => {
    const buckets = new Map<string, SkuBucket>();
    const timelineDates: string[] = [];

    const ensureBucket = (sku: string, supplierIdFallback = ""): SkuBucket => {
      if (buckets.has(sku)) return buckets.get(sku) as SkuBucket;
      const product = productBySku.get(sku) || {};
      const supplierId = String(product.supplierId || supplierIdFallback || "");
      const supplierName = supplierById.get(supplierId) || "—";
      const categoryIdRaw = String(product.categoryId || "");
      const categoryId = categoryIdRaw || null;
      const categoryLabel = categoryId ? (categoryById.get(categoryId) || "Ohne Kategorie") : "Ohne Kategorie";
      const alias = String(product.alias || sku);
      const next: SkuBucket = {
        sku,
        alias,
        supplierId,
        supplierName,
        categoryId,
        categoryLabel,
        poItems: [],
        foItems: [],
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
        if (orderIso) timelineDates.push(orderIso);
        if (etdIso) timelineDates.push(etdIso);
        if (etaIso) timelineDates.push(etaIso);
        const poNo = String(po.poNo || String(po.id || "").slice(-6).toUpperCase() || "PO");
        const supplierId = String(po.supplierId || "");
        const items = Array.isArray(po.items) && po.items.length
          ? po.items as Record<string, unknown>[]
          : [{ sku: po.sku, units: po.units }];

        items.forEach((item, itemIndex) => {
          const sku = normalizeSku(item?.sku || po.sku);
          if (!sku) return;
          const bucket = ensureBucket(sku, supplierId);
          const productionStart = orderMs ?? etdMs;
          const productionEnd = etdMs;
          if (productionStart != null && productionEnd != null) {
            const span = safeTimelineSpanMs({ startMs: productionStart, endMs: productionEnd });
            bucket.poItems.push({
              id: `po:${String(po.id || poNo)}:${sku}:${itemIndex}:production`,
              title: `${poNo} · Produktion`,
              startMs: span.startMs,
              endMs: span.endMs,
              className: "v2-orders-gantt-item v2-orders-gantt-item--po-production",
              tooltip: `${poNo}\n${bucket.alias} (${sku})\nProduktion ${orderIso || "—"} bis ${etdIso || "—"}`,
              openTarget: { entity: "po", poNo },
            });
          }
          if (etaMs != null) {
            const transitStart = etdMs ?? orderMs ?? etaMs;
            const span = safeTimelineSpanMs({ startMs: transitStart, endMs: etaMs });
            bucket.poItems.push({
              id: `po:${String(po.id || poNo)}:${sku}:${itemIndex}:transit`,
              title: `${poNo} · Transit`,
              startMs: span.startMs,
              endMs: span.endMs,
              className: "v2-orders-gantt-item v2-orders-gantt-item--po-transit",
              tooltip: `${poNo}\n${bucket.alias} (${sku})\nTransit ${etdIso || orderIso || "—"} bis ${etaIso || "—"}`,
              openTarget: { entity: "po", poNo },
            });
          }
          bucket.references.push(poNo);
        });
      });

    (Array.isArray(state.fos) ? state.fos : [])
      .map((entry) => entry as Record<string, unknown>)
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
        if (orderIso) timelineDates.push(orderIso);
        if (etdIso) timelineDates.push(etdIso);
        if (etaIso) timelineDates.push(etaIso);
        const sku = normalizeSku(fo.sku);
        if (!sku) return;
        const bucket = ensureBucket(sku, String(fo.supplierId || ""));
        const foId = String(fo.id || "");
        const foRef = `FO ${foId.slice(-6).toUpperCase() || "—"}`;
        const productionStart = orderMs ?? etdMs;
        const productionEnd = etdMs;
        if (productionStart != null && productionEnd != null) {
          const span = safeTimelineSpanMs({ startMs: productionStart, endMs: productionEnd });
          bucket.foItems.push({
            id: `fo:${foId}:${sku}:production`,
            title: `${foRef} · Produktion`,
            startMs: span.startMs,
            endMs: span.endMs,
            className: "v2-orders-gantt-item v2-orders-gantt-item--fo-production",
            tooltip: `${foRef}\n${bucket.alias} (${sku})\nProduktion ${orderIso || "—"} bis ${etdIso || "—"}`,
            openTarget: { entity: "fo", foId },
          });
        }
        if (etaMs != null) {
          const transitStart = etdMs ?? orderMs ?? etaMs;
          const span = safeTimelineSpanMs({ startMs: transitStart, endMs: etaMs });
          bucket.foItems.push({
            id: `fo:${foId}:${sku}:transit`,
            title: `${foRef} · Transit`,
            startMs: span.startMs,
            endMs: span.endMs,
            className: "v2-orders-gantt-item v2-orders-gantt-item--fo-transit",
            tooltip: `${foRef}\n${bucket.alias} (${sku})\nTransit ${etdIso || orderIso || "—"} bis ${etaIso || "—"}`,
            openTarget: { entity: "fo", foId },
          });
        }
        bucket.references.push(foRef);
      });

    const orderedBuckets = Array.from(buckets.values())
      .sort((a, b) => compareBucketOrder(a, b, categoryOrderMap));

    const groups: OrdersGanttGroup[] = [];
    const items: OrdersGanttItem[] = [];
    const targetByItemId = new Map<string, LaneItemTemplate["openTarget"]>();
    const needle = search.trim().toLowerCase();

    orderedBuckets.forEach((bucket) => {
      if (categoryFilter === "__uncat__" && bucket.categoryId) return;
      if (categoryFilter !== "all" && categoryFilter !== "__uncat__" && bucket.categoryId !== categoryFilter) return;
      if (supplierFilter !== "all" && bucket.supplierId !== supplierFilter) return;

      const showPoLane = typeFilter !== "fo";
      const showFoLane = typeFilter !== "po";
      const poItems = showPoLane ? bucket.poItems : [];
      const foItems = showFoLane ? bucket.foItems : [];
      if (!poItems.length && !foItems.length) return;

      const searchHaystack = [
        bucket.sku,
        bucket.alias,
        bucket.supplierName,
        bucket.categoryLabel,
        ...bucket.references,
      ].join(" ").toLowerCase();
      if (needle && !searchHaystack.includes(needle)) return;

      const lanes: Array<"po" | "fo"> = [];
      if (poItems.length) lanes.push("po");
      if (foItems.length) lanes.push("fo");

      lanes.forEach((lane, laneIndex) => {
        const groupId = `${bucket.sku}::${lane}`;
        const isPrimaryLane = laneIndex === 0;
        groups.push({
          id: groupId,
          title: (
            <div className="v2-orders-gantt-meta">
              <div className="v2-orders-gantt-topline">
                <Text strong>{bucket.alias} ({bucket.sku})</Text>
                <Tag className="v2-orders-gantt-lane-tag">{lane.toUpperCase()}</Tag>
              </div>
              {isPrimaryLane ? (
                <div className="v2-orders-gantt-subline">
                  {bucket.supplierName} · {bucket.categoryLabel}
                </div>
              ) : (
                <div className="v2-orders-gantt-subline">
                  Unterspur {lane.toUpperCase()}
                </div>
              )}
            </div>
          ),
        });

        const laneItems = lane === "po" ? poItems : foItems;
        laneItems.forEach((entry) => {
          items.push({
            id: entry.id,
            group: groupId,
            title: entry.title,
            startMs: entry.startMs,
            endMs: entry.endMs,
            className: entry.className,
            tooltip: entry.tooltip,
          });
          targetByItemId.set(entry.id, entry.openTarget);
        });
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
      <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
        <Tag>{timelineData.groups.length} Spuren</Tag>
        <Tag>{timelineData.items.length} Segmente</Tag>
        <Tag color="blue">SKU Sicht</Tag>
      </div>
      <OrdersGanttTimeline
        className="v2-orders-gantt--sku"
        groups={timelineData.groups}
        items={timelineData.items}
        visibleStartMs={timelineData.timelineWindow.visibleStartMs}
        visibleEndMs={timelineData.timelineWindow.visibleEndMs}
        sidebarHeaderLabel="SKU / Spur"
        sidebarWidth={340}
        lineHeight={66}
        emptyMessage="Keine SKU-Einträge für die aktuelle Suche/Filter."
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
          if (target.entity === "fo" && target.foId) {
            const params = new URLSearchParams();
            params.set("source", "orders_sku");
            params.set("foId", target.foId);
            navigate(`/v2/orders/fo?${params.toString()}`);
          }
        }}
      />
      <Space style={{ marginTop: 10 }} wrap>
        <Text type="secondary">Klick auf Segment öffnet den zugehörigen PO/FO Datensatz.</Text>
        <Button size="small" onClick={() => navigate("/v2/orders/po?view=timeline")}>
          PO Timeline öffnen
        </Button>
        <Button size="small" onClick={() => navigate("/v2/orders/fo?view=timeline")}>
          FO Timeline öffnen
        </Button>
      </Space>
    </Card>
  );
}
