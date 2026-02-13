import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { formatMonthLabel } from "../../domain/months";
import { getEffectiveUnits, normalizeManualMap } from "../../domain/tableModels";
import {
  buildDashboardMaturityRows,
  buildDashboardPnlRowsByMonth,
  buildInventoryMonthRiskIndex,
  type DashboardBreakdownRow,
  type DashboardMaturityCheckV2,
  type DashboardMaturityRowV2,
  type DashboardPnlRow,
} from "../../domain/dashboardMaturity";
import { useWorkspaceState } from "../../state/workspace";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

type DashboardRange = "next6" | "next12" | "next18" | "all";

interface DashboardSeriesRow {
  month: string;
  inflow: { total: number; paid: number; open: number };
  outflow: { total: number; paid: number; open: number };
  net: { total: number; paid: number; open: number };
}

interface ActualComparisonRow {
  month: string;
  plannedRevenue: number | null;
  actualRevenue: number | null;
  revenueDelta: number;
  revenueDeltaPct: number | null;
  plannedPayout: number | null;
  actualPayout: number | null;
  payoutDelta: number;
  payoutDeltaPct: number | null;
  plannedClosing: number | null;
  actualClosing: number | null;
  closingDelta: number;
}

interface SeriesResult {
  months: string[];
  series: DashboardSeriesRow[];
  breakdown: DashboardBreakdownRow[];
  actualComparisons: ActualComparisonRow[];
  kpis: {
    opening?: number;
    salesPayoutAvg?: number;
    firstNegativeMonth?: string | null;
    actuals?: {
      count?: number;
      lastMonth?: string | null;
      lastClosing?: number | null;
      closingDelta?: number | null;
      revenueDeltaPct?: number | null;
      payoutDeltaPct?: number | null;
      avgRevenueDeltaPct?: number | null;
      avgPayoutDeltaPct?: number | null;
    };
  };
}

interface ProductAbcRow {
  sku: string;
  active: boolean;
  abcClass: string | null;
}

const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6 Monate", count: 6 },
  { value: "next12", label: "Nächste 12 Monate", count: 12 },
  { value: "next18", label: "Nächste 18 Monate", count: 18 },
  { value: "all", label: "Alle Monate", count: null },
];

const PNL_GROUP_ORDER: Array<{ key: DashboardPnlRow["group"]; label: string }> = [
  { key: "inflow", label: "Einzahlungen" },
  { key: "po_fo", label: "PO/FO Zahlungen" },
  { key: "fixcost", label: "Fixkosten" },
  { key: "tax", label: "Steuern & Importkosten" },
  { key: "outflow", label: "Sonstige Auszahlungen" },
  { key: "other", label: "Sonstige" },
];

function isActiveProduct(product: Record<string, unknown>): boolean {
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedCurrency(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value < 0) return `−${formatCurrency(Math.abs(value))}`;
  return formatCurrency(value);
}

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

function normalizeSkuKey(value: string): string {
  return value.trim().toLowerCase();
}

function statusTag(status: DashboardMaturityCheckV2["status"]): JSX.Element {
  if (status === "ok") return <Tag color="green">OK</Tag>;
  if (status === "warning") return <Tag color="gold">Warnung</Tag>;
  return <Tag color="red">Offen</Tag>;
}

function sumRows(rows: DashboardPnlRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export default function DashboardModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("next12");
  const [selectedMaturityMonth, setSelectedMaturityMonth] = useState<string>("");
  const [openPnlMonths, setOpenPnlMonths] = useState<string[]>([]);
  const stateObject = state as unknown as Record<string, unknown>;

  const report = useMemo(() => computeSeries(stateObject) as SeriesResult, [state]);
  const months = report.months || [];
  const seriesRows = report.series || [];
  const breakdown = report.breakdown || [];
  const actualComparisons = report.actualComparisons || [];
  const kpis = report.kpis || {};

  const visibleMonths = useMemo(() => {
    const option = DASHBOARD_RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return months;
    return months.slice(0, option.count);
  }, [months, range]);

  const visibleMonthSet = useMemo(() => new Set(visibleMonths), [visibleMonths]);

  const visibleSeriesRows = useMemo(
    () => seriesRows.filter((row) => visibleMonthSet.has(row.month)),
    [seriesRows, visibleMonthSet],
  );
  const visibleBreakdown = useMemo(
    () => breakdown.filter((row) => visibleMonthSet.has(row.month)),
    [breakdown, visibleMonthSet],
  );
  const visibleActualComparisons = useMemo(
    () => actualComparisons.filter((row) => visibleMonthSet.has(row.month)),
    [actualComparisons, visibleMonthSet],
  );

  const latestBreakdown = visibleBreakdown[visibleBreakdown.length - 1] || null;
  const totalInflow = visibleSeriesRows.reduce((sum, row) => sum + Number(row.inflow?.total || 0), 0);
  const totalOutflow = visibleSeriesRows.reduce((sum, row) => sum + Number(row.outflow?.total || 0), 0);
  const totalNet = visibleSeriesRows.reduce((sum, row) => sum + Number(row.net?.total || 0), 0);

  const abcSnapshot = useMemo(() => computeAbcClassification(stateObject), [state]);
  const abcRows = useMemo(() => {
    const uniqueBySku = new Map<string, ProductAbcRow>();
    Array.from(abcSnapshot.bySku.values()).forEach((value) => {
      const row = value as ProductAbcRow;
      const key = normalizeSkuKey(String(row?.sku || ""));
      if (!key || uniqueBySku.has(key)) return;
      uniqueBySku.set(key, row);
    });
    return Array.from(uniqueBySku.values());
  }, [abcSnapshot.bySku]);

  const activeABucketSkus = useMemo(() => {
    return abcRows
      .filter((row) => row.active && (row.abcClass === "A" || row.abcClass === "B"))
      .map((row) => String(row.sku || "").trim())
      .filter(Boolean);
  }, [abcRows]);

  const forecastImport = useMemo(() => {
    const forecast = (state.forecast && typeof state.forecast === "object") ? state.forecast as Record<string, unknown> : {};
    return (forecast.forecastImport && typeof forecast.forecastImport === "object")
      ? forecast.forecastImport as Record<string, unknown>
      : {};
  }, [state.forecast]);

  const forecastManual = useMemo(() => {
    const forecast = (state.forecast && typeof state.forecast === "object") ? state.forecast as Record<string, unknown> : {};
    return normalizeManualMap((forecast.forecastManual || {}) as Record<string, unknown>);
  }, [state.forecast]);

  const hasFixcosts = Array.isArray(state.fixcosts) && state.fixcosts.length > 0;
  const hasVatConfig = useMemo(() => {
    const vatPreview = state.settings && typeof state.settings === "object"
      ? (state.settings as Record<string, unknown>).vatPreview
      : null;
    return Boolean(vatPreview && typeof vatPreview === "object");
  }, [state.settings]);

  const incomingsMonthSet = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(state.incomings) ? state.incomings : []).forEach((entry) => {
      const month = String((entry as Record<string, unknown>).month || "").trim();
      if (month) set.add(month);
    });
    return set;
  }, [state.incomings]);

  const seriesByMonth = useMemo(() => {
    const map = new Map<string, DashboardSeriesRow>();
    seriesRows.forEach((row) => map.set(row.month, row));
    return map;
  }, [seriesRows]);

  const activeProducts = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => (entry || {}) as Record<string, unknown>)
      .filter(isActiveProduct)
      .filter((entry) => String(entry.sku || "").trim());
  }, [state.products]);

  const forecastCoveredCount = useMemo(() => {
    return activeProducts.filter((product) => {
      const sku = String(product.sku || "").trim();
      return visibleMonths.some((month) => {
        const units = getEffectiveUnits(forecastManual, forecastImport, sku, month);
        return Number.isFinite(units as number) && Number(units) > 0;
      });
    }).length;
  }, [activeProducts, forecastImport, forecastManual, visibleMonths]);

  const abcClassCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0 };
    abcRows.forEach((row) => {
      if (!row.active) return;
      if (row.abcClass === "A") counts.A += 1;
      else if (row.abcClass === "B") counts.B += 1;
      else if (row.abcClass === "C") counts.C += 1;
    });
    return counts;
  }, [abcRows]);

  const forecastCoveragePct = activeProducts.length
    ? Math.min(100, Math.round((forecastCoveredCount / activeProducts.length) * 100))
    : 0;

  const inventoryRiskByMonth = useMemo(
    () => buildInventoryMonthRiskIndex({ state: stateObject, months: visibleMonths, abcBySku: abcSnapshot.bySku }),
    [abcSnapshot.bySku, stateObject, visibleMonths],
  );

  const maturityByMonth = useMemo<DashboardMaturityRowV2[]>(() => {
    return buildDashboardMaturityRows({
      months: visibleMonths,
      seriesByMonth,
      incomingsMonthSet,
      hasFixcosts,
      hasVatConfig,
      activeABucketSkus,
      forecastManual,
      forecastImport,
      inventoryRiskSummaryByMonth: inventoryRiskByMonth.summaryByMonth,
    });
  }, [
    activeABucketSkus,
    forecastImport,
    forecastManual,
    hasFixcosts,
    hasVatConfig,
    incomingsMonthSet,
    inventoryRiskByMonth.summaryByMonth,
    seriesByMonth,
    visibleMonths,
  ]);

  useEffect(() => {
    if (!maturityByMonth.length) {
      setSelectedMaturityMonth("");
      return;
    }
    if (!selectedMaturityMonth || !maturityByMonth.some((entry) => entry.month === selectedMaturityMonth)) {
      setSelectedMaturityMonth(maturityByMonth[0].month);
    }
  }, [maturityByMonth, selectedMaturityMonth]);

  useEffect(() => {
    if (!visibleBreakdown.length) {
      setOpenPnlMonths([]);
      return;
    }
    setOpenPnlMonths((current) => {
      const valid = new Set(visibleBreakdown.map((entry) => entry.month));
      const kept = current.filter((month) => valid.has(month));
      if (kept.length) return kept;
      return [visibleBreakdown[0].month];
    });
  }, [visibleBreakdown]);

  const selectedMaturity = useMemo(() => {
    return maturityByMonth.find((entry) => entry.month === selectedMaturityMonth) || maturityByMonth[0] || null;
  }, [maturityByMonth, selectedMaturityMonth]);

  const monthMaturityMap = useMemo(() => {
    const map = new Map<string, DashboardMaturityRowV2>();
    maturityByMonth.forEach((entry) => map.set(entry.month, entry));
    return map;
  }, [maturityByMonth]);

  const pnlRowsByMonth = useMemo(
    () => buildDashboardPnlRowsByMonth({ breakdown: visibleBreakdown, state: stateObject }),
    [stateObject, visibleBreakdown],
  );

  const chartOption = useMemo(() => {
    const monthLabels = visibleMonths.map((month) => formatMonthLabel(month));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const first = rows[0] as { axisValueLabel?: string } | undefined;
          const lines = [`<div><strong>${first?.axisValueLabel || ""}</strong></div>`];
          rows.forEach((entryRaw) => {
            const entry = entryRaw as { marker?: string; seriesName?: string; value?: number | null };
            const value = Number(entry?.value);
            const formatted = Number.isFinite(value) ? formatCurrency(value) : "-";
            lines.push(`<div>${entry?.marker || ""}${entry?.seriesName || ""}: ${formatted}</div>`);
          });
          return lines.join("");
        },
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 56,
        right: 70,
        top: 44,
        bottom: 32,
      },
      xAxis: {
        type: "category",
        data: monthLabels,
      },
      yAxis: [
        {
          type: "value",
          name: "Cashflow",
          axisLabel: {
            formatter: (value: number) => formatSignedCurrency(value),
          },
        },
        {
          type: "value",
          name: "Kontostand",
          position: "right",
          axisLabel: {
            formatter: (value: number) => formatCurrency(value),
          },
        },
      ],
      series: [
        {
          name: "Einzahlungen",
          type: "bar",
          stack: "cash",
          data: visibleSeriesRows.map((row) => Number(row.inflow?.total || 0)),
          itemStyle: { color: "#27ae60" },
        },
        {
          name: "Auszahlungen",
          type: "bar",
          stack: "cash",
          data: visibleSeriesRows.map((row) => -Number(row.outflow?.total || 0)),
          itemStyle: { color: "#e74c3c" },
        },
        {
          name: "Netto",
          type: "line",
          smooth: true,
          data: visibleSeriesRows.map((row) => Number(row.net?.total || 0)),
          itemStyle: { color: "#0f1b2d" },
        },
        {
          name: "Kontostand (valide)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: visibleBreakdown.map((row) => (monthMaturityMap.get(row.month)?.allGreen ? Number(row.closing || 0) : null)),
          lineStyle: { width: 2 },
          itemStyle: { color: "#3bc2a7" },
        },
        {
          name: "Kontostand (nicht valide)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: visibleBreakdown.map((row) => (!monthMaturityMap.get(row.month)?.allGreen ? Number(row.closing || 0) : null)),
          lineStyle: {
            width: 2,
            type: "dashed",
            color: "#94a3b8",
          },
          itemStyle: { color: "#94a3b8" },
        },
      ],
    };
  }, [monthMaturityMap, visibleBreakdown, visibleMonths, visibleSeriesRows]);

  const actualColumns = useMemo<ColumnDef<ActualComparisonRow>[]>(() => [
    { header: "Monat", accessorKey: "month" },
    {
      header: "Plan Umsatz",
      cell: ({ row }) => formatCurrency(row.original.plannedRevenue),
    },
    {
      header: "Ist Umsatz",
      cell: ({ row }) => formatCurrency(row.original.actualRevenue),
    },
    {
      header: "Delta Umsatz",
      cell: ({ row }) => (
        <span className={Number(row.original.revenueDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatCurrency(row.original.revenueDelta)}
        </span>
      ),
    },
    {
      header: "Delta Umsatz %",
      cell: ({ row }) => formatPercent(row.original.revenueDeltaPct),
    },
    {
      header: "Plan Kontostand",
      cell: ({ row }) => formatCurrency(row.original.plannedClosing),
    },
    {
      header: "Ist Kontostand",
      cell: ({ row }) => formatCurrency(row.original.actualClosing),
    },
    {
      header: "Delta Kontostand",
      cell: ({ row }) => (
        <span className={Number(row.original.closingDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatCurrency(row.original.closingDelta)}
        </span>
      ),
    },
  ], []);

  const maturityColumns = useMemo(() => [
    {
      title: "Check",
      dataIndex: "label",
      key: "label",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (status: DashboardMaturityCheckV2["status"]) => statusTag(status),
    },
    {
      title: "Detail",
      dataIndex: "detail",
      key: "detail",
      width: 260,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
  ], []);

  const readyMonthCount = useMemo(
    () => maturityByMonth.filter((entry) => entry.allGreen).length,
    [maturityByMonth],
  );

  const pnlItems = useMemo(() => {
    return visibleBreakdown.map((monthRow) => {
      const monthRows = pnlRowsByMonth.get(monthRow.month) || [];
      const groupedRows = PNL_GROUP_ORDER
        .map((group) => ({
          ...group,
          rows: monthRows.filter((row) => row.group === group.key),
        }))
        .filter((group) => group.rows.length > 0);

      const inflowRows = monthRows.filter((row) => row.group === "inflow");
      const outflowRows = monthRows.filter((row) => row.amount < 0);

      return {
        key: monthRow.month,
        label: (
          <div className="v2-dashboard-pnl-header">
            <Text strong>{formatMonthLabel(monthRow.month)}</Text>
            <Space wrap>
              <Tag color="green">Einzahlungen: {formatCurrency(sumRows(inflowRows))}</Tag>
              <Tag color="red">Auszahlungen: {formatCurrency(Math.abs(sumRows(outflowRows)))}</Tag>
              <Tag color={monthRow.net >= 0 ? "green" : "red"}>Netto: {formatCurrency(monthRow.net)}</Tag>
              <Tag color={(monthMaturityMap.get(monthRow.month)?.allGreen || false) ? "green" : "gold"}>
                Reifegrad: {(monthMaturityMap.get(monthRow.month)?.allGreen || false) ? "grün" : "offen"}
              </Tag>
            </Space>
          </div>
        ),
        children: (
          <div className="v2-dashboard-pnl-month">
            {groupedRows.map((group) => {
              if (group.key === "po_fo") {
                const orderMap = new Map<string, DashboardPnlRow[]>();
                group.rows.forEach((row) => {
                  const key = `${row.source}:${row.sourceNumber || row.label}`;
                  const bucket = orderMap.get(key) || [];
                  bucket.push(row);
                  orderMap.set(key, bucket);
                });

                const orderItems = Array.from(orderMap.entries()).map(([orderKey, rows]) => {
                  const [source, sourceNumber] = orderKey.split(":");
                  const total = sumRows(rows);
                  const tooltipMeta = rows.find((row) => row.tooltipMeta)?.tooltipMeta;

                  return {
                    key: orderKey,
                    label: (
                      <div className="v2-dashboard-pnl-order-row">
                        <Text strong>{String(source).toUpperCase()} {sourceNumber || "—"}</Text>
                        <Space size={6}>
                          <Tag color={total < 0 ? "red" : "green"}>{formatSignedCurrency(total)}</Tag>
                          {tooltipMeta?.units != null ? <Tag>Stück: {formatNumber(tooltipMeta.units, 0)}</Tag> : null}
                        </Space>
                      </div>
                    ),
                    children: (
                      <div className="v2-table-shell v2-scroll-host">
                        <table className="v2-stats-table" data-layout="auto">
                          <thead>
                            <tr>
                              <th>Milestone</th>
                              <th>Betrag</th>
                              <th>Fällig</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, index) => {
                              const tooltip = row.tooltipMeta ? (
                                <div>
                                  <div><strong>{String(row.source).toUpperCase()} {row.sourceNumber || "—"}</strong></div>
                                  <div>Alias: {row.tooltipMeta.aliases.join(", ") || "-"}</div>
                                  <div>Stückzahl: {row.tooltipMeta.units != null ? formatNumber(row.tooltipMeta.units, 0) : "-"}</div>
                                  <div>Fälligkeit: {formatIsoDate(row.tooltipMeta.dueDate)}</div>
                                </div>
                              ) : null;
                              return (
                                <tr key={`${orderKey}-${index}`}>
                                  <td>
                                    {tooltip ? (
                                      <Tooltip title={tooltip}>{row.label}</Tooltip>
                                    ) : row.label}
                                  </td>
                                  <td className={row.amount < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(row.amount)}</td>
                                  <td>{formatIsoDate(row.tooltipMeta?.dueDate)}</td>
                                  <td>
                                    {row.paid == null ? <Tag>—</Tag> : row.paid ? <Tag color="green">Bezahlt</Tag> : <Tag color="gold">Offen</Tag>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ),
                  };
                });

                return (
                  <div key={`${monthRow.month}-${group.key}`} className="v2-dashboard-pnl-group">
                    <div className="v2-dashboard-pnl-group-head">
                      <Text strong>{group.label}</Text>
                      <Tag color="blue">{formatSignedCurrency(sumRows(group.rows))}</Tag>
                    </div>
                    <Collapse size="small" items={orderItems} />
                  </div>
                );
              }

              return (
                <div key={`${monthRow.month}-${group.key}`} className="v2-dashboard-pnl-group">
                  <div className="v2-dashboard-pnl-group-head">
                    <Text strong>{group.label}</Text>
                    <Tag color={sumRows(group.rows) < 0 ? "red" : "green"}>{formatSignedCurrency(sumRows(group.rows))}</Tag>
                  </div>
                  <div className="v2-table-shell v2-scroll-host">
                    <table className="v2-stats-table" data-layout="auto">
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Betrag</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row, index) => (
                          <tr key={`${monthRow.month}-${group.key}-${index}`}>
                            <td>{row.label}</td>
                            <td className={row.amount < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(row.amount)}</td>
                            <td>
                              {row.paid == null ? <Tag>—</Tag> : row.paid ? <Tag color="green">Bezahlt</Tag> : <Tag color="gold">Offen</Tag>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ),
      };
    });
  }, [monthMaturityMap, pnlRowsByMonth, visibleBreakdown]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Dashboard</Title>
            <Paragraph>
              Plan/Ist Übersicht mit 12M-Steuerung, Reifegrad pro Monat und PnL-Drilldown für operative Entscheidungen.
            </Paragraph>
          </div>
          <div className="v2-toolbar-field">
            <Text>Zeitraum</Text>
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={DASHBOARD_RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 200, maxWidth: "100%" }}
            />
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button onClick={() => navigate("/v2/forecast")}>Zur Absatzprognose</Button>
            <Button onClick={() => navigate("/v2/inventory/projektion")}>Zur Bestandsprojektion</Button>
            <Button onClick={() => navigate("/v2/orders/po")}>Zu Bestellungen</Button>
            <Button onClick={() => navigate("/v2/abschluss/eingaben")}>Zum Abschluss</Button>
          </div>
          <Text type="secondary">Quicklinks arbeiten im aktuell gewählten Zeitraum ({visibleMonths.length} Monate).</Text>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Opening Balance" value={Number(kpis.opening || 0)} formatter={(value) => formatCurrency(value)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Sales Payout Ø" value={Number(kpis.salesPayoutAvg || 0)} formatter={(value) => formatCurrency(value)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Erster negativer Monat" value={kpis.firstNegativeMonth || "-"} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Letzter Kontostand" value={Number(latestBreakdown?.closing || 0)} formatter={(value) => formatCurrency(value)} />
          </Card>
        </Col>
      </Row>

      <Card className="v2-dashboard-chart-card">
        <Title level={4}>Cashflow Verlauf</Title>
        <Space wrap>
          <Tag color="green">Einzahlungen: {formatCurrency(totalInflow)}</Tag>
          <Tag color="red">Auszahlungen: {formatCurrency(totalOutflow)}</Tag>
          <Tag color={totalNet >= 0 ? "green" : "red"}>Netto: {formatCurrency(totalNet)}</Tag>
        </Space>
        <ReactECharts style={{ height: 360 }} option={chartOption} />
      </Card>

      <Card>
        <Title level={4}>Reifegrad</Title>
        <Paragraph type="secondary">
          Ein Monat ist nur grün, wenn alle Checks erfüllt sind und bei A/B-Produkten weder OOS noch „unter Safety" auftreten.
        </Paragraph>

        <div className="v2-dashboard-maturity-months">
          {maturityByMonth.map((entry) => (
            <Button
              key={entry.month}
              size="small"
              type={entry.month === selectedMaturity?.month ? "primary" : "default"}
              onClick={() => setSelectedMaturityMonth(entry.month)}
            >
              {formatMonthLabel(entry.month)} {entry.allGreen ? "●" : "○"}
            </Button>
          ))}
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Progress
              percent={selectedMaturity?.scorePct || 0}
              status={(selectedMaturity?.allGreen || false) ? "success" : "active"}
            />
            <Table
              style={{ marginTop: 12 }}
              size="small"
              pagination={false}
              rowKey="key"
              columns={maturityColumns}
              dataSource={selectedMaturity?.checks || []}
            />
          </Col>
          <Col xs={24} xl={10}>
            <div className="v2-dashboard-maturity-kpis">
              <Text strong>Produktabdeckung (12M)</Text>
              <div>Aktive Produkte: {activeProducts.length}</div>
              <div>Mit Forecast (12M): {forecastCoveredCount}</div>
              <div>Coverage: {formatNumber(forecastCoveragePct, 0)} %</div>
              <div>ABC A/B/C: {abcClassCounts.A} / {abcClassCounts.B} / {abcClassCounts.C}</div>
              <div>Monate komplett grün: {readyMonthCount} / {maturityByMonth.length}</div>
              <Divider style={{ margin: "10px 0" }} />
              <Text type="secondary">
                A/B Risiko im gewählten Monat: {selectedMaturity ? (
                  `${inventoryRiskByMonth.summaryByMonth.get(selectedMaturity.month)?.abRiskSkuCount || 0} SKU betroffen`
                ) : "-"}
              </Text>
            </div>
          </Col>
        </Row>
      </Card>

      <Card>
        <Title level={4}>Monatliche PnL (Drilldown)</Title>
        <Paragraph type="secondary">
          Einzahlungen, PO/FO-Zahlungen, Fixkosten und Steuern je Monat. PO/FO-Positionen sind aufklappbar bis auf Milestone-Ebene.
        </Paragraph>
        <Collapse
          className="v2-dashboard-pnl-collapse"
          activeKey={openPnlMonths}
          onChange={(keys) => setOpenPnlMonths(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
          items={pnlItems}
        />
      </Card>

      <Card>
        <Title level={4}>Plan/Ist Drilldown</Title>
        <Paragraph type="secondary">
          Monatsvergleich zwischen geplantem und erfasstem Istwert aus den Monats-Ist-Daten.
        </Paragraph>
        <TanStackGrid
          data={visibleActualComparisons}
          columns={actualColumns}
          minTableWidth={980}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
