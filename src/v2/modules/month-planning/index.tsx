import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Select,
  Space,
  Tag,
  Typography,
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
  type MonthPlanningMonth,
  type MonthReviewItem,
} from "../../domain/monthPlanning";
import { currentMonthKey, formatMonthLabel, monthIndex, monthRange, normalizeMonthKey } from "../../domain/months";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { resolvePlanningMonthsFromState } from "../../domain/phantomFo";

const { Paragraph, Text, Title } = Typography;

interface ProjectionCellData {
  endAvailable?: number | null;
  safetyUnits?: number | null;
  safetyDays?: number | null;
  daysToOos?: number | null;
  doh?: number | null;
  hasForecast?: boolean;
}

interface InboundDetailCell {
  totalUnits?: number;
  poItems?: Array<Record<string, unknown>>;
  foItems?: Array<Record<string, unknown>>;
}

function normalizeMonthSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return normalizeMonthKey(params.get("month"));
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDate(value: string | undefined): string {
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
  if (item.type === "overdue_order_decision") return "red";
  if (item.type === "forecast_conflict_relevant") return "volcano";
  return "blue";
}

function statusTagLabel(item: MonthReviewItem): string {
  if (item.status === "accepted") return "Akzeptiert";
  if (item.status === "converted") return "In FO";
  if (item.type === "overdue_order_decision") return "Überfällig";
  if (item.type === "inventory_order_required") return "Bestellen";
  if (item.type === "inventory_risk_acceptance_required") return "Risiko prüfen";
  if (item.type === "cash_in_missing") return "Cash-in";
  if (item.type === "fixcost_missing") return "Fixkosten";
  if (item.type === "vat_missing") return "VAT";
  if (item.type === "revenue_input_missing") return "Revenue";
  if (item.type === "master_data_blocking") return "Stammdaten";
  return "Forecast";
}

function isInventoryItem(item: MonthReviewItem | null): boolean {
  if (!item) return false;
  return item.type === "inventory_order_required"
    || item.type === "inventory_risk_acceptance_required"
    || item.type === "overdue_order_decision";
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

export default function MonthPlanningPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, error, saveWith } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;
  const requestedMonth = normalizeMonthSearch(location.search);
  const [selectedItemId, setSelectedItemId] = useState("");

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
    products: Array.isArray(state.products) ? state.products : [],
    projectionMode: "units",
  }) as {
    perSkuMonth: Map<string, Map<string, ProjectionCellData>>;
    inboundDetailsMap: Map<string, Map<string, InboundDetailCell>>;
  }, [projectionMonths, state.products, stateObject]);

  const selectedInventoryContext = useMemo(() => {
    if (!selectedItem?.sku) return null;
    const skuMonths = inventoryProjection.perSkuMonth.get(selectedItem.sku) || new Map<string, ProjectionCellData>();
    const inboundMonths = inventoryProjection.inboundDetailsMap.get(selectedItem.sku) || new Map<string, InboundDetailCell>();
    let firstUnderSafety: string | null = null;
    let firstOos: string | null = null;
    const monthRows = projectionMonths.map((month) => {
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
      const inbound = inboundMonths.get(month);
      const poCount = Array.isArray(inbound?.poItems) ? inbound.poItems.length : 0;
      const foCount = Array.isArray(inbound?.foItems) ? inbound.foItems.length : 0;
      return {
        month,
        projectedUnits: data?.endAvailable ?? null,
        inboundUnits: inbound?.totalUnits ?? null,
        poCount,
        foCount,
        daysToOos: data?.daysToOos ?? null,
      };
    }).filter((entry) => {
      if (entry.month === selectedMonth) return true;
      if (selectedItem.impactMonth && entry.month >= selectedMonth && entry.month <= selectedItem.impactMonth) return true;
      return entry.inboundUnits != null && entry.inboundUnits > 0;
    });
    return {
      firstUnderSafety,
      firstOos,
      monthRows: monthRows.slice(0, 6),
      selectedMonthRow: skuMonths.get(selectedMonth) || null,
    };
  }, [inventoryProjection.inboundDetailsMap, inventoryProjection.perSkuMonth, projectionMonths, selectedItem, selectedMonth]);

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

  const canConvertToFo = Boolean(
    selectedItem
    && selectedItem.status === "open"
    && (selectedItem.type === "inventory_order_required" || selectedItem.type === "overdue_order_decision")
    && selectedItem.sku
    && Number(selectedItem.suggestedUnits || 0) > 0,
  );
  const canAcceptRisk = Boolean(
    selectedItem
    && selectedItem.status === "open"
    && isInventoryItem(selectedItem)
    && resolveRiskIssueType(selectedItem),
  );

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
                    renderItem={(item) => (
                      <List.Item
                        className={`v2-month-planning-item${item.id === selectedItemId ? " is-active" : ""}${item.status !== "open" ? " is-done" : ""}`}
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                          <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                            <Text strong>{item.title}</Text>
                            <Tag color={statusTagColor(item)}>{statusTagLabel(item)}</Tag>
                          </Space>
                          <Text type="secondary">{item.detail}</Text>
                          <Space wrap size={6}>
                            <Text type="secondary">Wirkmonat: {formatMonthLabel(item.impactMonth)}</Text>
                            {item.latestOrderDate ? <Text type="secondary">Bestellen bis {formatDate(item.latestOrderDate)}</Text> : null}
                            {item.suggestedUnits != null ? <Text type="secondary">Empfohlen {formatUnits(item.suggestedUnits)} Units</Text> : null}
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="Keine Review-Items für diesen Monat." />
                )}
              </Card>
            </Col>

            <Col xs={24} lg={14}>
              <Card size="small" title="Detailpanel" className="v2-month-planning-detail-card">
                {selectedItem ? (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Space wrap>
                      <Tag color={statusTagColor(selectedItem)}>{statusTagLabel(selectedItem)}</Tag>
                      <Text strong>{selectedItem.title}</Text>
                      {selectedItem.abcClass ? <Tag>{selectedItem.abcClass}</Tag> : null}
                    </Space>
                    <Paragraph style={{ marginBottom: 0 }}>{selectedItem.detail}</Paragraph>

                    <div className="v2-month-planning-kpis">
                      <div><Text type="secondary">Wirkmonat</Text><div>{formatMonthLabel(selectedItem.impactMonth)}</div></div>
                      <div><Text type="secondary">Bestellen bis</Text><div>{formatDate(selectedItem.latestOrderDate)}</div></div>
                      <div><Text type="secondary">Empfohlen</Text><div>{formatUnits(selectedItem.suggestedUnits)} Units</div></div>
                      <div><Text type="secondary">ETA-Ziel</Text><div>{formatDate(selectedItem.requiredArrivalDate)}</div></div>
                    </div>

                    {isInventoryItem(selectedItem) && selectedInventoryContext ? (
                      <Card size="small" title="Inventory-Kontext">
                        <Space direction="vertical" size={10} style={{ width: "100%" }}>
                          <Space wrap>
                            <Tag color="blue">Unter Safety ab {selectedInventoryContext.firstUnderSafety ? formatMonthLabel(selectedInventoryContext.firstUnderSafety) : "—"}</Tag>
                            <Tag color="red">OOS ab {selectedInventoryContext.firstOos ? formatMonthLabel(selectedInventoryContext.firstOos) : "—"}</Tag>
                          </Space>
                          <div className="v2-month-planning-table-wrap">
                            <table className="v2-month-planning-mini-table">
                              <thead>
                                <tr>
                                  <th>Monat</th>
                                  <th>Proj. Bestand</th>
                                  <th>Inbound</th>
                                  <th>PO/FO</th>
                                  <th>Tage bis OOS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedInventoryContext.monthRows.length ? selectedInventoryContext.monthRows.map((row) => (
                                  <tr key={row.month}>
                                    <td>{formatMonthLabel(row.month)}</td>
                                    <td>{formatUnits(row.projectedUnits)}</td>
                                    <td>{formatUnits(row.inboundUnits)}</td>
                                    <td>{row.poCount}/{row.foCount}</td>
                                    <td>{row.daysToOos != null ? Math.round(Number(row.daysToOos)).toLocaleString("de-DE") : "—"}</td>
                                  </tr>
                                )) : (
                                  <tr>
                                    <td colSpan={5}><Text type="secondary">Kein Inventory-Kontext verfügbar.</Text></td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <Text type="secondary">
                            Für die vollständige Simulation und Grafikansicht springt der Deep Dive in SKU Planung.
                          </Text>
                        </Space>
                      </Card>
                    ) : null}

                    <Space wrap>
                      <Button onClick={() => openSpecialist(selectedItem)}>
                        Fachmodul öffnen
                      </Button>
                      {isInventoryItem(selectedItem) ? (
                        <Button
                          onClick={() => openSpecialist(selectedItem)}
                        >
                          SKU Planung öffnen
                        </Button>
                      ) : null}
                      <Button
                        type="primary"
                        disabled={!canConvertToFo || readOnly}
                        onClick={() => selectedItem && convertToFo(selectedItem)}
                      >
                        In FO umwandeln
                      </Button>
                      <Button
                        disabled={!canAcceptRisk || readOnly}
                        onClick={() => { if (selectedItem) void acceptRisk(selectedItem, 1); }}
                      >
                        Risiko 1 Monat akzeptieren
                      </Button>
                      <Button
                        disabled={!canAcceptRisk || readOnly}
                        onClick={() => { if (selectedItem) void acceptRisk(selectedItem, 2); }}
                      >
                        Risiko 2 Monate akzeptieren
                      </Button>
                    </Space>

                    {readOnly ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Read only"
                        description="Vergangene oder bereits geschlossene Monate bleiben sichtbar, können hier aber nicht mehr mutiert werden."
                      />
                    ) : null}
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
    </div>
  );
}
