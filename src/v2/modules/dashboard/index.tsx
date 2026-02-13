import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Progress, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { formatMonthLabel } from "../../domain/months";
import { getEffectiveUnits, normalizeManualMap } from "../../domain/tableModels";
import { useWorkspaceState } from "../../state/workspace";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

interface DashboardSeriesRow {
  month: string;
  inflow: { total: number; paid: number; open: number };
  outflow: { total: number; paid: number; open: number };
  net: { total: number; paid: number; open: number };
}

interface DashboardBreakdownRow {
  month: string;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  net: number;
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
  units6m: number | null;
  abcClass: string | null;
}

type DashboardRange = "next6" | "next12" | "next18" | "all";

interface MonthMaturityCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface MonthMaturityRow {
  month: string;
  scorePct: number;
  allGreen: boolean;
  checks: MonthMaturityCheck[];
}

const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6 Monate", count: 6 },
  { value: "next12", label: "Nächste 12 Monate", count: 12 },
  { value: "next18", label: "Nächste 18 Monate", count: 18 },
  { value: "all", label: "Alle Monate", count: null },
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
  });
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

export default function DashboardModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("next6");
  const [selectedMaturityMonth, setSelectedMaturityMonth] = useState<string>("");
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
    return Array.from(abcSnapshot.bySku.values()) as ProductAbcRow[];
  }, [abcSnapshot.bySku]);

  const activeABucketSkus = useMemo(() => {
    return abcRows
      .filter((row) => row.active && row.abcClass === "A")
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
      .filter(isActiveProduct);
  }, [state.products]);

  const forecastCoveredCount = useMemo(() => {
    return abcRows.filter((row) => row.active && Number(row.units6m || 0) > 0).length;
  }, [abcRows]);

  const abcClassCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0 };
    abcRows.forEach((row) => {
      if (row.abcClass === "A") counts.A += 1;
      else if (row.abcClass === "B") counts.B += 1;
      else if (row.abcClass === "C") counts.C += 1;
    });
    return counts;
  }, [abcRows]);

  const forecastCoveragePct = activeProducts.length
    ? Math.round((forecastCoveredCount / activeProducts.length) * 100)
    : 0;

  const maturityByMonth = useMemo<MonthMaturityRow[]>(() => {
    return visibleMonths.map((month) => {
      const seriesForMonth = seriesByMonth.get(month);
      const outflow = Number(seriesForMonth?.outflow?.total || 0);
      const inflow = Number(seriesForMonth?.inflow?.total || 0);
      const coveredACount = activeABucketSkus.filter((sku) => {
        const units = getEffectiveUnits(forecastManual, forecastImport, sku, month);
        return Number.isFinite(units as number) && Number(units) > 0;
      }).length;
      const coveragePct = activeABucketSkus.length
        ? Math.round((coveredACount / activeABucketSkus.length) * 100)
        : 100;
      const checks: MonthMaturityCheck[] = [
        {
          key: "incomings",
          label: "Cash-In Monat gepflegt",
          ok: incomingsMonthSet.has(month),
          detail: incomingsMonthSet.has(month) ? "vorhanden" : "fehlend",
        },
        {
          key: "orders",
          label: "PO/FO Zahlungswirkung",
          ok: outflow > 0,
          detail: outflow > 0 ? formatCurrency(outflow) : "keine geplanten Auszahlungen",
        },
        {
          key: "forecastA",
          label: "A-Produkte Forecast",
          ok: coveragePct === 100,
          detail: `${coveredACount}/${activeABucketSkus.length || 0} (${coveragePct} %)`,
        },
        {
          key: "fixcosts",
          label: "Fixkosten vorhanden",
          ok: hasFixcosts,
          detail: hasFixcosts ? "ja" : "nein",
        },
        {
          key: "vat",
          label: "USt-Konfiguration",
          ok: hasVatConfig,
          detail: hasVatConfig ? "ja" : "nein",
        },
        {
          key: "inflow",
          label: "Einzahlungen geplant",
          ok: inflow > 0,
          detail: inflow > 0 ? formatCurrency(inflow) : "keine Einzahlungen",
        },
      ];
      const okCount = checks.filter((entry) => entry.ok).length;
      return {
        month,
        checks,
        scorePct: Math.round((okCount / checks.length) * 100),
        allGreen: okCount === checks.length,
      };
    });
  }, [activeABucketSkus, forecastImport, forecastManual, hasFixcosts, hasVatConfig, incomingsMonthSet, seriesByMonth, visibleMonths]);

  useEffect(() => {
    if (!maturityByMonth.length) {
      setSelectedMaturityMonth("");
      return;
    }
    if (!selectedMaturityMonth || !maturityByMonth.some((entry) => entry.month === selectedMaturityMonth)) {
      setSelectedMaturityMonth(maturityByMonth[0].month);
    }
  }, [maturityByMonth, selectedMaturityMonth]);

  const selectedMaturity = useMemo(() => {
    return maturityByMonth.find((entry) => entry.month === selectedMaturityMonth) || maturityByMonth[0] || null;
  }, [maturityByMonth, selectedMaturityMonth]);

  const monthMaturityMap = useMemo(() => {
    const map = new Map<string, MonthMaturityRow>();
    maturityByMonth.forEach((entry) => map.set(entry.month, entry));
    return map;
  }, [maturityByMonth]);

  const chartOption = useMemo(() => {
    const monthLabels = visibleMonths.map((month) => formatMonthLabel(month));
    return {
      tooltip: {
        trigger: "axis",
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 56,
        right: 62,
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
        },
        {
          type: "value",
          name: "Kontostand",
          position: "right",
        },
      ],
      series: [
        {
          name: "Inflow",
          type: "bar",
          stack: "cash",
          data: visibleSeriesRows.map((row) => Number(row.inflow?.total || 0)),
          itemStyle: { color: "#27ae60" },
        },
        {
          name: "Outflow",
          type: "bar",
          stack: "cash",
          data: visibleSeriesRows.map((row) => -Number(row.outflow?.total || 0)),
          itemStyle: { color: "#e74c3c" },
        },
        {
          name: "Net",
          type: "line",
          smooth: true,
          data: visibleSeriesRows.map((row) => Number(row.net?.total || 0)),
          itemStyle: { color: "#0f1b2d" },
        },
        {
          name: "Kontostand (grün)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: visibleBreakdown.map((row) => (monthMaturityMap.get(row.month)?.allGreen ? Number(row.closing || 0) : null)),
          lineStyle: { width: 2 },
          itemStyle: { color: "#3bc2a7" },
        },
        {
          name: "Kontostand (ungeplant)",
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
      header: "Plan Revenue",
      cell: ({ row }) => formatCurrency(row.original.plannedRevenue),
    },
    {
      header: "Ist Revenue",
      cell: ({ row }) => formatCurrency(row.original.actualRevenue),
    },
    {
      header: "Delta Revenue",
      cell: ({ row }) => (
        <span className={Number(row.original.revenueDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatCurrency(row.original.revenueDelta)}
        </span>
      ),
    },
    {
      header: "Delta Revenue %",
      cell: ({ row }) => formatPercent(row.original.revenueDeltaPct),
    },
    {
      header: "Plan Closing",
      cell: ({ row }) => formatCurrency(row.original.plannedClosing),
    },
    {
      header: "Ist Closing",
      cell: ({ row }) => formatCurrency(row.original.actualClosing),
    },
    {
      header: "Delta Closing",
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
      dataIndex: "ok",
      key: "ok",
      width: 140,
      render: (ok: boolean) => (ok ? <Tag color="green">OK</Tag> : <Tag color="red">Offen</Tag>),
    },
    {
      title: "Detail",
      dataIndex: "detail",
      key: "detail",
      width: 180,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
  ], []);

  const readyMonthCount = useMemo(
    () => maturityByMonth.filter((entry) => entry.allGreen).length,
    [maturityByMonth],
  );

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Dashboard</Title>
            <Paragraph>
              Plan/Ist Uebersicht mit Cashflow-KPIs, Monatsverlauf, Datenreife und Produkt-Forecast-Abdeckung.
            </Paragraph>
          </div>
          <div className="v2-toolbar-field">
            <Text>Zeitraum</Text>
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={DASHBOARD_RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 180, maxWidth: "100%" }}
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
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Opening Balance" value={Number(kpis.opening || 0)} precision={2} suffix="EUR" />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="Sales Payout Avg" value={Number(kpis.salesPayoutAvg || 0)} precision={2} suffix="EUR" />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="First Negative Month" value={kpis.firstNegativeMonth || "-"} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Closing"
              value={Number(latestBreakdown?.closing || 0)}
              precision={2}
              suffix="EUR"
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card>
            <Title level={4}>Cashflow Verlauf</Title>
            <Space wrap>
              <Tag color="green">Inflow: {formatCurrency(totalInflow)}</Tag>
              <Tag color="red">Outflow: {formatCurrency(totalOutflow)}</Tag>
              <Tag color={totalNet >= 0 ? "green" : "red"}>Net: {formatCurrency(totalNet)}</Tag>
            </Space>
            <ReactECharts style={{ height: 340 }} option={chartOption} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card>
            <Title level={4}>Reifegrad</Title>
            <Paragraph type="secondary">
              Monatsstatus ist anklickbar. Nur komplett grüne Monate gelten als belastbar geplant.
            </Paragraph>
            <Space wrap style={{ marginBottom: 10 }}>
              {maturityByMonth.map((entry) => (
                <Button
                  key={entry.month}
                  size="small"
                  type={entry.month === selectedMaturity?.month ? "primary" : "default"}
                  onClick={() => setSelectedMaturityMonth(entry.month)}
                >
                  {formatMonthLabel(entry.month)}
                  {" "}
                  {entry.allGreen ? "●" : "○"}
                </Button>
              ))}
            </Space>
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
            <div style={{ marginTop: 16 }}>
              <Text strong>Produktabdeckung</Text>
              <div>Aktive Produkte: {activeProducts.length}</div>
              <div>Mit Forecast (6M): {forecastCoveredCount}</div>
              <div>Coverage: {formatNumber(forecastCoveragePct, 0)} %</div>
              <div>ABC A/B/C: {abcClassCounts.A} / {abcClassCounts.B} / {abcClassCounts.C}</div>
              <div>Monate komplett grün: {readyMonthCount} / {maturityByMonth.length}</div>
            </div>
          </Card>
        </Col>
      </Row>

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
