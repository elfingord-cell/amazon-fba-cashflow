import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import {
  computeInventoryProjection,
  getProjectionSafetyClass,
} from "../../../domain/inventoryProjection.js";
import {
  buildShortageAcceptanceStorageKey,
  type ShortageIssueType,
} from "../../domain/pfoShared";
import {
  buildMonthPlanningResult,
  isMonthPlanningReadOnly,
  type MonthReviewItem,
} from "../../domain/monthPlanning";
import {
  buildMonthPlanningActionSurface,
  buildMonthPlanningConflictBadges,
  buildMonthPlanningSupplyVisualModel,
  type MonthPlanningActionId,
  type MonthPlanningInboundEvent,
  type MonthPlanningSupplyContext,
  type MonthPlanningSupplyMonthRow,
} from "../../domain/monthPlanningUi";
import { currentMonthKey, formatMonthLabel, monthIndex, monthRange, normalizeMonthKey } from "../../domain/months";
import { resolvePlanningMonthsFromState } from "../../domain/phantomFo";
import {
  createForecastConflictDraft,
  ignoreForecastConflict,
  updateForecastConflictFo,
} from "../../domain/forecastConflictActions";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface ProjectionCellData {
  endAvailable?: number | null;
  safetyUnits?: number | null;
  safetyDays?: number | null;
  daysToOos?: number | null;
  doh?: number | null;
}

interface InboundDetailCell {
  totalUnits?: number;
  poItems?: MonthPlanningInboundEvent[];
  foItems?: MonthPlanningInboundEvent[];
}

function normalizeMonthSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return normalizeMonthKey(params.get("month"));
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDate(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatUnits(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE");
}

function statusTagColor(item: MonthReviewItem): string {
  if (item.status === "accepted") return "gold";
  if (item.status === "converted") return "green";
  if (item.isOverdue) return "red";
  if (item.type === "forecast_conflict_relevant") return "volcano";
  return "blue";
}

function statusTagLabel(item: MonthReviewItem): string {
  if (item.status === "accepted") return "Akzeptiert";
  if (item.status === "converted") return "In FO";
  if (item.isOverdue) return "Überfällig";
  if (item.type === "inventory_order_required") return "Bestellen";
  if (item.type === "inventory_risk_acceptance_required") return "Risiko prüfen";
  if (item.type === "cash_in_missing") return "Cash-in";
  if (item.type === "fixcost_missing") return "Fixkosten";
  if (item.type === "vat_missing") return "VAT";
  if (item.type === "revenue_input_missing") return "Revenue";
  if (item.type === "master_data_blocking") return "Stammdaten";
  return "Forecast";
}

function buildMonthLocation(pathname: string, month: string): string {
  return `${pathname}?month=${encodeURIComponent(month)}`;
}

function buildSpecialistRoute(item: MonthReviewItem, month: string, returnTo: string): string {
  const params = new URLSearchParams();
  params.set("month", month);
  params.set("source", "monatsplanung");
  params.set("returnTo", returnTo);
  if (item.sku) params.set("sku", item.sku);
  if (item.type === "cash_in_missing") return `/v2/abschluss/eingaben?${params.toString()}`;
  if (item.type === "fixcost_missing") return `/v2/abschluss/fixkosten?${params.toString()}`;
  if (item.type === "vat_missing") return `/v2/abschluss/ust?${params.toString()}`;
  if (item.type === "revenue_input_missing" || item.type === "master_data_blocking") return `/v2/products?${params.toString()}`;
  if (item.type === "forecast_conflict_relevant") {
    params.set("panel", "conflicts");
    if (item.foId) params.set("foId", item.foId);
    return `/v2/forecast?${params.toString()}`;
  }
  return `/v2/sku-planung?${params.toString()}`;
}

function resolveRiskIssueType(item: MonthReviewItem | null): ShortageIssueType | null {
  if (!item) return null;
  if (item.issueType === "stock_oos") return "stock_oos";
  if (item.issueType === "stock_under_safety") return "stock_under_safety";
  return null;
}

function normalizeInboundEvents(items: unknown): MonthPlanningInboundEvent[] {
  if (!Array.isArray(items)) return [];
  return items.map((entry, index) => {
    const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    return {
      id: String(row.id || `inbound-${index}`),
      ref: String(row.ref || row.id || "—"),
      units: Number.isFinite(Number(row.units)) ? Math.round(Number(row.units)) : 0,
      arrivalDate: String(row.arrivalDate || "").trim() || null,
      arrivalSource: String(row.arrivalSource || "").trim() || null,
    };
  }).filter((entry) => entry.units > 0);
}

function isMutatingAction(actionId: MonthPlanningActionId): boolean {
  return actionId === "convert_to_fo"
    || actionId === "accept_risk_1"
    || actionId === "accept_risk_2"
    || actionId === "resolve_forecast_conflict";
}

export default function MonthPlanningPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, error, saveWith } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;
  const requestedMonth = normalizeMonthSearch(location.search);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictActionLoading, setConflictActionLoading] = useState(false);

  const planningMonths = useMemo(() => {
    const baseMonths = resolvePlanningMonthsFromState(stateObject, 18);
    const unique = new Set(baseMonths);
    if (requestedMonth) unique.add(requestedMonth);
    if (!unique.size) unique.add(currentMonthKey());
    return Array.from(unique).sort((left, right) => {
      const leftIndex = monthIndex(left) ?? 0;
      const rightIndex = monthIndex(right) ?? 0;
      return leftIndex - rightIndex;
    });
  }, [requestedMonth, stateObject]);

  const selectedMonth = useMemo(() => {
    if (requestedMonth && planningMonths.includes(requestedMonth)) return requestedMonth;
    return planningMonths[0] || currentMonthKey();
  }, [planningMonths, requestedMonth]);

  useEffect(() => {
    if (!selectedMonth || selectedMonth === requestedMonth) return;
    navigate(buildMonthLocation(location.pathname, selectedMonth), { replace: true });
  }, [location.pathname, navigate, requestedMonth, selectedMonth]);

  const planning = useMemo(() => buildMonthPlanningResult({
    state: stateObject,
    months: planningMonths,
  }), [planningMonths, stateObject]);

  const selectedMonthData = planning.monthMap.get(selectedMonth) || null;
  const readOnly = useMemo(
    () => (selectedMonthData ? isMonthPlanningReadOnly(stateObject, selectedMonthData.month) : false),
    [selectedMonthData, stateObject],
  );

  useEffect(() => {
    if (!selectedMonthData?.reviewItems.length) {
      setSelectedItemId("");
      return;
    }
    if (!selectedItemId || !selectedMonthData.reviewItems.some((entry) => entry.id === selectedItemId)) {
      setSelectedItemId(selectedMonthData.reviewItems[0].id);
    }
  }, [selectedItemId, selectedMonthData]);

  const selectedItem = selectedMonthData?.reviewItems.find((entry) => entry.id === selectedItemId) || null;
  const selectedActionSurface = useMemo(
    () => (selectedItem ? buildMonthPlanningActionSurface(selectedItem) : null),
    [selectedItem],
  );
  const selectedConflictBadges = useMemo(
    () => (selectedItem ? buildMonthPlanningConflictBadges(selectedItem) : []),
    [selectedItem],
  );
  const conflictModalItem = selectedItem
    && selectedItem.type === "forecast_conflict_relevant"
    && selectedItem.sourceKind === "fo_conflict"
    && selectedItem.foId
      ? selectedItem
      : null;

  useEffect(() => {
    if (!conflictModalItem) setConflictModalOpen(false);
  }, [conflictModalItem]);

  const returnTo = useMemo(
    () => buildMonthLocation("/v2/monatsplanung", selectedMonth),
    [selectedMonth],
  );

  const projectionMonths = useMemo(() => {
    const anchor = selectedMonthData?.month || currentMonthKey();
    const start = monthIndex(anchor) != null && monthIndex(anchor)! < (monthIndex(currentMonthKey()) ?? 0)
      ? anchor
      : currentMonthKey();
    return monthRange(start, 12);
  }, [selectedMonthData]);

  const inventoryProjection = useMemo(() => computeInventoryProjection({
    state: stateObject,
    months: projectionMonths,
    products: Array.isArray(stateObject.products) ? stateObject.products : [],
    projectionMode: "units",
  }) as {
    perSkuMonth: Map<string, Map<string, ProjectionCellData>>;
    inboundDetailsMap: Map<string, Map<string, InboundDetailCell>>;
  }, [projectionMonths, stateObject]);

  const selectedInventoryContext = useMemo<MonthPlanningSupplyContext | null>(() => {
    if (!selectedItem?.sku || !selectedActionSurface?.showSupplyVisual) return null;
    const skuMonths = inventoryProjection.perSkuMonth.get(selectedItem.sku) || new Map<string, ProjectionCellData>();
    const inboundMonths = inventoryProjection.inboundDetailsMap.get(selectedItem.sku) || new Map<string, InboundDetailCell>();
    let firstUnderSafety: string | null = null;
    let firstOos: string | null = null;

    projectionMonths.forEach((month) => {
      const data = skuMonths.get(month);
      const riskClass = getProjectionSafetyClass({
        projectionMode: "units",
        endAvailable: data?.endAvailable,
        safetyUnits: data?.safetyUnits,
        doh: data?.doh,
        safetyDays: data?.safetyDays,
        daysToOos: data?.daysToOos,
      });
      if (!firstUnderSafety && (riskClass === "safety-low" || riskClass === "safety-negative")) {
        firstUnderSafety = month;
      }
      if (!firstOos && riskClass === "safety-negative") {
        firstOos = month;
      }
    });

    const visibleMonths = projectionMonths.filter((month) => month >= selectedMonth).slice(0, 6);
    const monthRows: MonthPlanningSupplyMonthRow[] = visibleMonths.map((month) => {
      const data = skuMonths.get(month);
      const inbound = inboundMonths.get(month);
      const poItems = normalizeInboundEvents(inbound?.poItems);
      const foItems = normalizeInboundEvents(inbound?.foItems);
      return {
        month,
        projectedUnits: data?.endAvailable ?? null,
        inboundUnits: inbound?.totalUnits ?? null,
        poCount: poItems.length,
        foCount: foItems.length,
        daysToOos: data?.daysToOos ?? null,
        safetyUnits: data?.safetyUnits ?? null,
        poItems,
        foItems,
      };
    });

    return {
      firstUnderSafety,
      firstOos,
      monthRows,
      selectedMonth,
    };
  }, [inventoryProjection.inboundDetailsMap, inventoryProjection.perSkuMonth, projectionMonths, selectedActionSurface, selectedItem, selectedMonth]);

  const supplyVisualModel = useMemo(
    () => (selectedItem ? buildMonthPlanningSupplyVisualModel(selectedItem, selectedInventoryContext) : null),
    [selectedInventoryContext, selectedItem],
  );

  const handleMonthChange = useCallback((month: string) => {
    navigate(buildMonthLocation(location.pathname, month));
  }, [location.pathname, navigate]);

  const openSpecialist = useCallback((item: MonthReviewItem) => {
    navigate(buildSpecialistRoute(item, selectedMonth, returnTo));
  }, [navigate, returnTo, selectedMonth]);

  const convertToFo = useCallback((item: MonthReviewItem) => {
    if (!item.sku || item.status !== "open") return;
    const params = new URLSearchParams();
    params.set("source", "phantom_fo");
    params.set("decisionSource", "inventory_pfo_worklist");
    params.set("phantomId", item.id);
    params.set("sku", item.sku);
    params.set("month", item.impactMonth || selectedMonth);
    params.set("issueType", resolveRiskIssueType(item) || "stock_under_safety");
    params.set("firstRiskMonth", item.impactMonth || selectedMonth);
    params.set("orderMonth", selectedMonth);
    params.set("suggestedUnits", String(Math.max(0, Math.round(Number(item.suggestedUnits || 0)))));
    if (item.requiredArrivalDate) params.set("requiredArrivalDate", item.requiredArrivalDate);
    if (item.recommendedOrderDate) params.set("recommendedOrderDate", item.recommendedOrderDate);
    params.set("returnTo", returnTo);
    params.set("returnSku", item.sku);
    navigate(`/v2/orders/fo?${params.toString()}`);
  }, [navigate, returnTo, selectedMonth]);

  const acceptRisk = useCallback(async (item: MonthReviewItem, durationMonths: 1 | 2) => {
    const sku = String(item.sku || "").trim();
    const issueType = resolveRiskIssueType(item);
    const firstRiskMonth = normalizeMonthKey(item.impactMonth);
    if (!sku || !issueType || !firstRiskMonth) return;
    const todayMonth = currentMonthKey();
    const acceptedFromMonth = firstRiskMonth < todayMonth ? todayMonth : firstRiskMonth;
    const acceptedUntilMonth = durationMonths === 2
      ? monthRange(acceptedFromMonth, 2)[1] || acceptedFromMonth
      : acceptedFromMonth;
    const acceptanceKey = buildShortageAcceptanceStorageKey({
      sku,
      reason: issueType,
      acceptedFromMonth,
    });
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      if (!next.settings || typeof next.settings !== "object") {
        next.settings = {};
      }
      const nextSettings = next.settings as Record<string, unknown>;
      const existing = (nextSettings.phantomFoShortageAcceptBySku && typeof nextSettings.phantomFoShortageAcceptBySku === "object")
        ? nextSettings.phantomFoShortageAcceptBySku as Record<string, unknown>
        : {};
      const previous = (existing[acceptanceKey] && typeof existing[acceptanceKey] === "object")
        ? existing[acceptanceKey] as Record<string, unknown>
        : {};
      next.settings = {
        ...nextSettings,
        phantomFoShortageAcceptBySku: {
          ...existing,
          [acceptanceKey]: {
            ...previous,
            sku,
            reason: issueType,
            acceptedFromMonth,
            acceptedUntilMonth,
            durationMonths,
            updatedAt: nowIso(),
          },
        },
      };
      return next;
    }, "v2:month-planning:accept-risk");
  }, [saveWith]);

  const runForecastConflictAction = useCallback(async (mode: "update" | "draft" | "ignore", item: MonthReviewItem) => {
    if (!item.foId) return;
    setConflictActionLoading(true);
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        if (mode === "update") {
          updateForecastConflictFo(next, item);
        } else if (mode === "draft") {
          createForecastConflictDraft(next, item);
        } else {
          ignoreForecastConflict(next, item);
        }
        return next;
      }, `v2:month-planning:forecast-conflict:${mode}`);
      if (mode === "update") message.success(`FO ${item.foId} wurde aktualisiert.`);
      else if (mode === "draft") message.success(`Neue Draft-FO zu ${item.foId} erstellt.`);
      else message.success(`FO ${item.foId} für diese Forecast-Version ignoriert.`);
      setConflictModalOpen(false);
    } catch (persistError) {
      message.error(persistError instanceof Error ? persistError.message : "Forecast-Konflikt konnte nicht gespeichert werden.");
    } finally {
      setConflictActionLoading(false);
    }
  }, [saveWith]);

  const handleAction = useCallback((actionId: MonthPlanningActionId, item: MonthReviewItem) => {
    if (actionId === "open_specialist" || actionId === "open_sku_planning") {
      openSpecialist(item);
      return;
    }
    if (actionId === "convert_to_fo") {
      convertToFo(item);
      return;
    }
    if (actionId === "accept_risk_1") {
      void acceptRisk(item, 1);
      return;
    }
    if (actionId === "accept_risk_2") {
      void acceptRisk(item, 2);
      return;
    }
    if (actionId === "resolve_forecast_conflict") {
      setConflictModalOpen(true);
    }
  }, [acceptRisk, convertToFo, openSpecialist]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Row gutter={[12, 12]} className="v2-page-head">
          <Col xs={24} xl={14}>
            <div>
              <Title level={3}>Monatsplanung</Title>
              <Paragraph>
                Monat für Monat prüfen, offene Blocker behandeln und den Review-Monat auf robust bringen.
              </Paragraph>
            </div>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <div className="v2-toolbar-field">
              <Text>Review-Monat</Text>
              <Select
                value={selectedMonth}
                onChange={handleMonthChange}
                options={planningMonths.map((month) => ({ value: month, label: formatMonthLabel(month) }))}
                style={{ width: "100%" }}
              />
            </div>
          </Col>
          <Col xs={24} md={12} xl={4}>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Text type="secondary">Status</Text>
              <Space wrap>
                <Tag color={selectedMonthData?.robust ? "green" : "red"}>{selectedMonthData?.statusLabel || "—"}</Tag>
                {readOnly ? <Tag>Read only</Tag> : null}
              </Space>
            </Space>
          </Col>
        </Row>
        {selectedMonthData ? (
          <div className="v2-toolbar">
            <Text type="secondary">
              {selectedMonthData.progressDone} von {selectedMonthData.progressTotal} Items erledigt
            </Text>
            <Text type="secondary">
              Blocker: <strong>{selectedMonthData.blockerCount}</strong>
            </Text>
            <Text type="secondary">
              Coverage: <strong>{selectedMonthData.coverage.statusLabel}</strong>
            </Text>
          </div>
        ) : null}
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      {selectedMonthData ? (
        <>
          <div className="v2-month-planning-cards">
            {selectedMonthData.cards.map((card) => (
              <Card key={card.key} size="small" className="v2-month-planning-card">
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                    <Text strong>{card.label}</Text>
                    <Tag color={card.status === "ok" ? "green" : (card.status === "warn" ? "gold" : "red")}>
                      {card.count}
                    </Tag>
                  </Space>
                  <Text type="secondary">{card.detail}</Text>
                </Space>
              </Card>
            ))}
          </div>

          <Row gutter={[16, 16]} className="v2-month-planning-grid">
            <Col xs={24} lg={10}>
              <Card size="small" title={`Review-Liste · ${formatMonthLabel(selectedMonthData.month)}`} className="v2-month-planning-list-card">
                {selectedMonthData.reviewItems.length ? (
                  <List
                    className="v2-month-planning-list"
                    dataSource={selectedMonthData.reviewItems}
                    renderItem={(item) => {
                      const itemActionSurface = buildMonthPlanningActionSurface(item);
                      const conflictBadges = buildMonthPlanningConflictBadges(item);
                      return (
                        <List.Item
                          className={`v2-month-planning-item${item.id === selectedItemId ? " is-active" : ""}${item.status !== "open" ? " is-done" : ""}`}
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          <Space direction="vertical" size={6} style={{ width: "100%" }}>
                            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                              <Text strong>{item.title}</Text>
                              <Tag color={statusTagColor(item)}>{statusTagLabel(item)}</Tag>
                            </Space>
                            <Text>{itemActionSurface.problemStatement}</Text>
                            <Text type="secondary">{item.detail}</Text>
                            {conflictBadges.length ? (
                              <Space wrap size={6}>
                                {conflictBadges.map((badge) => (
                                  <Tag key={`${item.id}:${badge}`} color={item.isOverdue ? "red" : "volcano"}>{badge}</Tag>
                                ))}
                              </Space>
                            ) : null}
                            <Space wrap size={6}>
                              <Text type="secondary">Wirkmonat: {formatMonthLabel(item.impactMonth)}</Text>
                              <Text type="secondary">
                                {itemActionSurface.dateMeta.label} {itemActionSurface.dateMeta.value ? formatDate(itemActionSurface.dateMeta.value) : formatMonthLabel(item.month)}
                              </Text>
                              {item.suggestedUnits != null ? <Text type="secondary">Empfohlen {formatUnits(item.suggestedUnits)} Units</Text> : null}
                            </Space>
                          </Space>
                        </List.Item>
                      );
                    }}
                  />
                ) : (
                  <Empty description="Keine Review-Items für diesen Monat." />
                )}
              </Card>
            </Col>

            <Col xs={24} lg={14}>
              <Card size="small" title="Detailpanel" className="v2-month-planning-detail-card">
                {selectedItem && selectedActionSurface ? (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Space wrap>
                      <Tag color={statusTagColor(selectedItem)}>{statusTagLabel(selectedItem)}</Tag>
                      <Tag>{selectedActionSurface.typeLabel}</Tag>
                      <Text strong>{selectedItem.title}</Text>
                      {selectedItem.foId ? <Tag>FO {selectedItem.foId}</Tag> : null}
                      {selectedItem.abcClass ? <Tag>{selectedItem.abcClass}</Tag> : null}
                    </Space>

                    <Paragraph style={{ marginBottom: 0 }}>{selectedActionSurface.problemStatement}</Paragraph>
                    <Text type="secondary">{selectedItem.detail}</Text>

                    {selectedConflictBadges.length ? (
                      <Space wrap size={6}>
                        {selectedConflictBadges.map((badge) => (
                          <Tag key={`${selectedItem.id}:detail:${badge}`} color={selectedItem.isOverdue ? "red" : "volcano"}>
                            {badge}
                          </Tag>
                        ))}
                      </Space>
                    ) : null}

                    <div className="v2-month-planning-kpis">
                      <div><Text type="secondary">Wirkmonat</Text><div>{formatMonthLabel(selectedItem.impactMonth)}</div></div>
                      <div>
                        <Text type="secondary">{selectedActionSurface.dateMeta.label}</Text>
                        <div>{selectedActionSurface.dateMeta.value ? formatDate(selectedActionSurface.dateMeta.value) : formatMonthLabel(selectedItem.month)}</div>
                      </div>
                      <div><Text type="secondary">Empfohlen</Text><div>{formatUnits(selectedItem.suggestedUnits)} Units</div></div>
                      <div><Text type="secondary">ETA-Ziel</Text><div>{formatDate(selectedItem.requiredArrivalDate || selectedItem.recommendedArrivalDate)}</div></div>
                    </div>

                    <div className="v2-month-planning-action-row">
                      {selectedActionSurface.actions.map((action) => (
                        <Button
                          key={`${selectedItem.id}:${action.id}`}
                          type={action.variant === "primary" ? "primary" : "default"}
                          disabled={readOnly && isMutatingAction(action.id)}
                          onClick={() => handleAction(action.id, selectedItem)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>

                    {readOnly ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Read only"
                        description="Vergangene oder bereits geschlossene Monate bleiben sichtbar, können hier aber nicht mehr mutiert werden."
                      />
                    ) : null}

                    {selectedActionSurface.showSupplyVisual && selectedInventoryContext && supplyVisualModel ? (
                      <Card size="small" title="Plausibilisierung" className="v2-month-planning-visual-card">
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Space wrap>
                            <Tag color="blue">Unter Safety ab {selectedInventoryContext.firstUnderSafety ? formatMonthLabel(selectedInventoryContext.firstUnderSafety) : "—"}</Tag>
                            <Tag color="red">OOS ab {selectedInventoryContext.firstOos ? formatMonthLabel(selectedInventoryContext.firstOos) : "—"}</Tag>
                          </Space>

                          <ReactECharts
                            style={{ height: 290 }}
                            option={supplyVisualModel.chartOption}
                            notMerge
                          />

                          <div className="v2-month-planning-timeline">
                            <div className="v2-month-planning-timeline-head">
                              <Text type="secondary">{supplyVisualModel.timeline.startLabel}</Text>
                              <Text type="secondary">{supplyVisualModel.timeline.endLabel}</Text>
                            </div>
                            <div className="v2-month-planning-timeline-track">
                              {supplyVisualModel.timeline.segments.map((segment) => (
                                <div
                                  key={segment.key}
                                  className="v2-month-planning-timeline-segment"
                                  style={{ left: `${segment.positionPct}%` }}
                                >
                                  <span>{segment.label}</span>
                                </div>
                              ))}
                              {supplyVisualModel.timeline.markers.map((marker) => (
                                <div
                                  key={marker.id}
                                  className={`v2-month-planning-timeline-marker is-${marker.tone}`}
                                  style={{
                                    left: `${marker.positionPct}%`,
                                    top: `${12 + marker.lane * 24}px`,
                                  }}
                                  title={`${marker.label} · ${marker.dateLabel}`}
                                />
                              ))}
                            </div>
                            <div className="v2-month-planning-timeline-list">
                              {supplyVisualModel.timeline.markers.map((marker) => (
                                <div key={`${marker.id}:label`} className="v2-month-planning-timeline-list-item">
                                  <span className={`v2-month-planning-timeline-dot is-${marker.tone}`} />
                                  <Text>{marker.label}</Text>
                                  <Text type="secondary">{marker.dateLabel}</Text>
                                </div>
                              ))}
                            </div>
                          </div>
                        </Space>
                      </Card>
                    ) : (
                      <Card size="small" title="Nächster Schritt" className="v2-month-planning-visual-card">
                        <Text type="secondary">
                          {selectedItem.detail}
                        </Text>
                      </Card>
                    )}
                  </Space>
                ) : (
                  <Empty description="Kein Review-Item ausgewählt." />
                )}
              </Card>
            </Col>
          </Row>
        </>
      ) : (
        <Card>
          <Empty description="Kein Review-Monat verfügbar." />
        </Card>
      )}

      <Modal
        open={conflictModalOpen && Boolean(conflictModalItem)}
        onCancel={() => setConflictModalOpen(false)}
        footer={null}
        title="Forecast-Konflikt lösen"
        destroyOnClose={false}
      >
        {conflictModalItem ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text strong>{conflictModalItem.title}</Text>
            <Text type="secondary">FO {conflictModalItem.foId}</Text>
            <Space wrap size={6}>
              {buildMonthPlanningConflictBadges(conflictModalItem).map((badge) => (
                <Tag key={`modal:${conflictModalItem.id}:${badge}`} color={conflictModalItem.isOverdue ? "red" : "volcano"}>
                  {badge}
                </Tag>
              ))}
            </Space>
            <Paragraph style={{ marginBottom: 0 }}>
              Bestehende FO und Forecast-Empfehlung weichen ab. Wähle jetzt, ob du die FO aktualisierst, eine neue Draft-FO erzeugst oder den Konflikt für diese Forecast-Version bewusst ignorierst.
            </Paragraph>

            <div className="v2-month-planning-conflict-grid">
              <div>
                <Text type="secondary">Aktuelle FO</Text>
                <div>{formatUnits(conflictModalItem.currentUnits)} Units</div>
                <Text type="secondary">Target {formatDate(conflictModalItem.currentTargetDeliveryDate)}</Text>
                <br />
                <Text type="secondary">ETA {formatDate(conflictModalItem.currentEtaDate)}</Text>
              </div>
              <div>
                <Text type="secondary">Empfehlung</Text>
                <div>{formatUnits(conflictModalItem.suggestedUnits)} Units</div>
                <Text type="secondary">Arrival {formatDate(conflictModalItem.recommendedArrivalDate || conflictModalItem.requiredArrivalDate)}</Text>
                <br />
                <Text type="secondary">
                  {conflictModalItem.latestOrderDate && conflictModalItem.latestOrderDate < nowIso().slice(0, 10) ? "Überfällig seit" : "Empfohlene Aktion bis"}{" "}
                  {formatDate(conflictModalItem.latestOrderDate)}
                </Text>
              </div>
            </div>

            <Space wrap>
              <Button
                type="primary"
                loading={conflictActionLoading}
                onClick={() => { void runForecastConflictAction("update", conflictModalItem); }}
              >
                FO aktualisieren
              </Button>
              <Button
                loading={conflictActionLoading}
                onClick={() => { void runForecastConflictAction("draft", conflictModalItem); }}
              >
                Draft neu erzeugen
              </Button>
              <Button
                loading={conflictActionLoading}
                onClick={() => { void runForecastConflictAction("ignore", conflictModalItem); }}
              >
                Für diese Forecast-Version ignorieren
              </Button>
              <Button onClick={() => openSpecialist(conflictModalItem)}>
                Forecast-Modul öffnen
              </Button>
            </Space>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
