import { useMemo } from "react";
import { Alert, Card, Col, Progress, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { formatMonthLabel } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";

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
  const stateObject = state as unknown as Record<string, unknown>;

  const report = useMemo(() => computeSeries(stateObject) as SeriesResult, [state]);
  const months = report.months || [];
  const seriesRows = report.series || [];
  const breakdown = report.breakdown || [];
  const actualComparisons = report.actualComparisons || [];
  const kpis = report.kpis || {};

  const latestBreakdown = breakdown[breakdown.length - 1] || null;
  const totalInflow = seriesRows.reduce((sum, row) => sum + Number(row.inflow?.total || 0), 0);
  const totalOutflow = seriesRows.reduce((sum, row) => sum + Number(row.outflow?.total || 0), 0);
  const totalNet = seriesRows.reduce((sum, row) => sum + Number(row.net?.total || 0), 0);

  const abcSnapshot = useMemo(() => computeAbcClassification(stateObject), [state]);
  const abcRows = useMemo(() => {
    return Array.from(abcSnapshot.bySku.values()) as ProductAbcRow[];
  }, [abcSnapshot.bySku]);

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

  const maturityChecks = useMemo(() => {
    const hasIncomings = Array.isArray(state.incomings) && state.incomings.length > 0;
    const hasFixcosts = Array.isArray(state.fixcosts) && state.fixcosts.length > 0;
    const hasOrders = (Array.isArray(state.pos) && state.pos.length > 0) || (Array.isArray(state.fos) && state.fos.length > 0);
    const vatPreview = state.settings && typeof state.settings === "object"
      ? (state.settings as Record<string, unknown>).vatPreview
      : null;
    const hasVatConfig = Boolean(vatPreview && typeof vatPreview === "object");
    const checks = [
      { key: "incomings", label: "Cash-In Daten", ok: hasIncomings },
      { key: "fixcosts", label: "Fixkosten", ok: hasFixcosts },
      { key: "orders", label: "PO/FO Daten", ok: hasOrders },
      { key: "vat", label: "USt-Vorschau", ok: hasVatConfig },
      { key: "forecast", label: "Forecast-Abdeckung >= 70%", ok: forecastCoveragePct >= 70 },
    ];
    const okCount = checks.filter((entry) => entry.ok).length;
    return {
      checks,
      scorePct: Math.round((okCount / checks.length) * 100),
    };
  }, [forecastCoveragePct, state.fixcosts, state.fos, state.incomings, state.pos, state.settings]);

  const chartOption = useMemo(() => {
    const monthLabels = months.map((month) => formatMonthLabel(month));
    return {
      tooltip: {
        trigger: "axis",
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 56,
        right: 20,
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
          name: "Monat",
        },
      ],
      series: [
        {
          name: "Inflow",
          type: "bar",
          stack: "cash",
          data: seriesRows.map((row) => Number(row.inflow?.total || 0)),
          itemStyle: { color: "#27ae60" },
        },
        {
          name: "Outflow",
          type: "bar",
          stack: "cash",
          data: seriesRows.map((row) => -Number(row.outflow?.total || 0)),
          itemStyle: { color: "#e74c3c" },
        },
        {
          name: "Net",
          type: "line",
          smooth: true,
          data: seriesRows.map((row) => Number(row.net?.total || 0)),
          itemStyle: { color: "#0f1b2d" },
        },
        {
          name: "Closing",
          type: "line",
          smooth: true,
          data: breakdown.map((row) => Number(row.closing || 0)),
          itemStyle: { color: "#3bc2a7" },
        },
      ],
    };
  }, [breakdown, months, seriesRows]);

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
  ], []);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Dashboard (V2 Native)</Title>
        <Paragraph>
          Plan/Ist Uebersicht mit Cashflow-KPIs, Monatsverlauf, Datenreife und Produkt-Forecast-Abdeckung.
        </Paragraph>
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
              Score basiert auf Kerninputs und Forecast-Abdeckung.
            </Paragraph>
            <Progress percent={maturityChecks.scorePct} status={maturityChecks.scorePct >= 70 ? "success" : "active"} />
            <Table
              style={{ marginTop: 12 }}
              size="small"
              pagination={false}
              rowKey="key"
              columns={maturityColumns}
              dataSource={maturityChecks.checks}
            />
            <div style={{ marginTop: 16 }}>
              <Text strong>Produktabdeckung</Text>
              <div>Aktive Produkte: {activeProducts.length}</div>
              <div>Mit Forecast (6M): {forecastCoveredCount}</div>
              <div>Coverage: {formatNumber(forecastCoveragePct, 0)} %</div>
              <div>ABC A/B/C: {abcClassCounts.A} / {abcClassCounts.B} / {abcClassCounts.C}</div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card>
        <Title level={4}>Plan/Ist Drilldown</Title>
        <Paragraph type="secondary">
          Monatsvergleich zwischen geplantem und erfasstem Istwert aus den Monats-Ist-Daten.
        </Paragraph>
        <TanStackGrid data={actualComparisons} columns={actualColumns} />
      </Card>
    </div>
  );
}
