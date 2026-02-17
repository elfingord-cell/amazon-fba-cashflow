import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { buildDashboardPnlRowsByMonth, type DashboardBreakdownRow, type DashboardPnlRow } from "../../domain/dashboardMaturity";
import { currentMonthKey, formatMonthLabel, monthIndex } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type SollIstRange = "last6" | "last12" | "all";

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
  actualComparisons: ActualComparisonRow[];
  breakdown: DashboardBreakdownRow[];
}

interface SollIstRow extends ActualComparisonRow {
  provisional: boolean;
  plannedPayoutRatePct: number | null;
  actualPayoutRatePct: number | null;
  closingDeltaPct: number | null;
}

interface AccuracyResult {
  accuracyPct: number | null;
  mapePct: number | null;
  sampleCount: number;
}

interface DriverRow {
  key: string;
  label: string;
  amount: number;
  kind: "component" | "total";
}

const RANGE_OPTIONS: Array<{ value: SollIstRange; label: string; count: number | null }> = [
  { value: "last6", label: "Letzte 6 Monate", count: 6 },
  { value: "last12", label: "Letzte 12 Monate", count: 12 },
  { value: "all", label: "Alle Monate", count: null },
];

const PLAN_GROUP_LABEL: Record<DashboardPnlRow["group"], string> = {
  inflow: "Einzahlungen",
  po_fo: "PO/FO",
  fixcost: "Fixkosten",
  tax: "Steuern & Import",
  outflow: "Auszahlungen",
  other: "Sonstige",
};

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number < 0) return `−${formatCurrency(Math.abs(number))}`;
  return formatCurrency(number);
}

function formatPercent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function deriveRatePct(numerator: number | null, denominator: number | null): number | null {
  if (!Number.isFinite(numerator as number)) return null;
  if (!Number.isFinite(denominator as number) || Number(denominator) === 0) return null;
  return (Number(numerator) / Number(denominator)) * 100;
}

function deriveAccuracy(
  rows: SollIstRow[],
  getPlanned: (row: SollIstRow) => number | null,
  getActual: (row: SollIstRow) => number | null,
): AccuracyResult {
  const apes = rows
    .filter((row) => !row.provisional)
    .map((row) => {
      const planned = getPlanned(row);
      const actual = getActual(row);
      if (!Number.isFinite(planned as number) || !Number.isFinite(actual as number)) return null;
      if (!planned) return null;
      return Math.abs((Number(actual) - Number(planned)) / Number(planned)) * 100;
    })
    .filter((value): value is number => Number.isFinite(value));

  if (!apes.length) {
    return { accuracyPct: null, mapePct: null, sampleCount: 0 };
  }
  const mapePct = apes.reduce((sum, value) => sum + value, 0) / apes.length;
  return {
    accuracyPct: Math.max(0, 100 - mapePct),
    mapePct,
    sampleCount: apes.length,
  };
}

function deriveMonthDrivers(current: SollIstRow, previous: SollIstRow | null): DriverRow[] {
  const plannedRevenue = asNumber(current.plannedRevenue) || 0;
  const actualRevenue = asNumber(current.actualRevenue) || 0;
  const payoutDelta = asNumber(current.payoutDelta) || 0;
  const currentClosingDelta = asNumber(current.closingDelta) || 0;
  const previousClosingDelta = asNumber(previous?.closingDelta) || 0;
  const closingDeltaChange = currentClosingDelta - previousClosingDelta;

  const plannedRate = (asNumber(current.plannedPayoutRatePct) || 0) / 100;
  const actualRate = (asNumber(current.actualPayoutRatePct) || 0) / 100;

  let revenueEffect = payoutDelta;
  let payoutRateEffect = 0;
  if (
    Number.isFinite(plannedRevenue)
    && Number.isFinite(actualRevenue)
    && Number.isFinite(plannedRate)
    && Number.isFinite(actualRate)
  ) {
    revenueEffect = (actualRevenue - plannedRevenue) * plannedRate;
    payoutRateEffect = actualRevenue * (actualRate - plannedRate);
  }

  const residual = closingDeltaChange - payoutDelta;

  return [
    { key: "rev_effect", label: "Umsatz-Effekt (auf Payout)", amount: round2(revenueEffect), kind: "component" },
    { key: "payout_effect", label: "Payout-Quote-Effekt", amount: round2(payoutRateEffect), kind: "component" },
    { key: "residual", label: "Sonstige Effekte (Kosten/Timing)", amount: round2(residual), kind: "component" },
    { key: "total", label: "Delta Kontostand (Monats-Effekt)", amount: round2(closingDeltaChange), kind: "total" },
  ];
}

export default function SollIstModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const [range, setRange] = useState<SollIstRange>("last12");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const stateObject = state as unknown as Record<string, unknown>;
  const report = useMemo(() => computeSeries(stateObject) as SeriesResult, [stateObject]);

  const currentMonth = currentMonthKey();
  const currentMonthIdx = monthIndex(currentMonth);

  const rows = useMemo<SollIstRow[]>(() => {
    const source = Array.isArray(report.actualComparisons) ? report.actualComparisons : [];
    return source
      .map((row) => {
        const month = String(row.month || "").trim();
        const rowMonthIdx = monthIndex(month);
        const provisional = rowMonthIdx != null
          && currentMonthIdx != null
          && rowMonthIdx >= currentMonthIdx;
        const plannedPayoutRatePct = deriveRatePct(asNumber(row.plannedPayout), asNumber(row.plannedRevenue));
        const actualPayoutRatePct = deriveRatePct(asNumber(row.actualPayout), asNumber(row.actualRevenue));
        const plannedClosing = asNumber(row.plannedClosing);
        const actualClosing = asNumber(row.actualClosing);
        const closingDeltaPct = (
          Number.isFinite(plannedClosing as number)
          && plannedClosing
          && Number.isFinite(actualClosing as number)
        )
          ? ((Number(actualClosing) - Number(plannedClosing)) / Number(plannedClosing)) * 100
          : null;
        return {
          ...row,
          month,
          provisional,
          plannedPayoutRatePct,
          actualPayoutRatePct,
          closingDeltaPct,
        };
      })
      .filter((row) => row.month)
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [currentMonthIdx, report.actualComparisons]);

  const visibleRows = useMemo(() => {
    const option = RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return rows;
    return rows.slice(-option.count);
  }, [range, rows]);

  useEffect(() => {
    if (!visibleRows.length) {
      setSelectedMonth("");
      return;
    }
    const available = new Set(visibleRows.map((row) => row.month));
    if (!selectedMonth || !available.has(selectedMonth)) {
      setSelectedMonth(visibleRows[visibleRows.length - 1].month);
    }
  }, [selectedMonth, visibleRows]);

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.month === selectedMonth) || visibleRows[visibleRows.length - 1] || null,
    [selectedMonth, visibleRows],
  );

  const previousSelectedRow = useMemo(() => {
    if (!selectedRow) return null;
    const index = rows.findIndex((row) => row.month === selectedRow.month);
    if (index <= 0) return null;
    return rows[index - 1] || null;
  }, [rows, selectedRow]);

  const completedRows = useMemo(
    () => visibleRows.filter((row) => !row.provisional),
    [visibleRows],
  );

  const closingAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedClosing), (row) => asNumber(row.actualClosing)),
    [completedRows],
  );
  const revenueAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedRevenue), (row) => asNumber(row.actualRevenue)),
    [completedRows],
  );
  const payoutAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedPayout), (row) => asNumber(row.actualPayout)),
    [completedRows],
  );

  const selectedDrivers = useMemo(
    () => (selectedRow ? deriveMonthDrivers(selectedRow, previousSelectedRow) : []),
    [previousSelectedRow, selectedRow],
  );

  const pnlRowsByMonth = useMemo(
    () => buildDashboardPnlRowsByMonth({ breakdown: Array.isArray(report.breakdown) ? report.breakdown : [], state: stateObject }),
    [report.breakdown, stateObject],
  );

  const selectedPlanGroupRows = useMemo(() => {
    if (!selectedRow) return [];
    const rowsForMonth = pnlRowsByMonth.get(selectedRow.month) || [];
    const grouped = new Map<DashboardPnlRow["group"], number>();
    rowsForMonth.forEach((entry) => {
      grouped.set(entry.group, (grouped.get(entry.group) || 0) + Number(entry.amount || 0));
    });
    return Array.from(grouped.entries())
      .map(([group, amount]) => ({
        key: group,
        label: PLAN_GROUP_LABEL[group] || group,
        amount: round2(amount),
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [pnlRowsByMonth, selectedRow]);

  const closingChartOption = useMemo(() => {
    const firstProvisionalIndex = visibleRows.findIndex((row) => row.provisional);
    const xAxisLabels = visibleRows.map((row) => formatMonthLabel(row.month));
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: number) => formatCurrency(value),
      },
      legend: { top: 0 },
      grid: { left: 54, right: 26, top: 44, bottom: 26 },
      xAxis: {
        type: "category",
        data: xAxisLabels,
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
      series: [
        {
          name: "Delta Kontostand",
          type: "bar",
          data: visibleRows.map((row) => Number(row.closingDelta || 0)),
          itemStyle: {
            color: (params: { dataIndex: number; value: number }) => {
              const isProvisional = firstProvisionalIndex >= 0 && params.dataIndex >= firstProvisionalIndex;
              if (isProvisional) return "rgba(245, 158, 11, 0.65)";
              return params.value < 0 ? "#dc2626" : "#16a34a";
            },
          },
        },
        {
          name: "Kontostand Soll",
          type: "line",
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.plannedClosing)),
          lineStyle: { width: 2, type: "dashed", color: "#0f172a" },
          itemStyle: { color: "#0f172a" },
        },
        {
          name: "Kontostand Ist",
          type: "line",
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.actualClosing)),
          lineStyle: { width: 2, color: "#0ea5e9" },
          itemStyle: { color: "#0ea5e9" },
          markArea: firstProvisionalIndex >= 0
            ? {
              itemStyle: { color: "rgba(251, 191, 36, 0.12)" },
              data: [[
                { xAxis: xAxisLabels[firstProvisionalIndex] },
                { xAxis: xAxisLabels[xAxisLabels.length - 1] },
              ]],
            }
            : undefined,
        },
      ],
    };
  }, [visibleRows]);

  const revenuePayoutChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "axis",
      },
      legend: { top: 0 },
      grid: { left: 54, right: 52, top: 44, bottom: 26 },
      xAxis: {
        type: "category",
        data: visibleRows.map((row) => formatMonthLabel(row.month)),
      },
      yAxis: [
        {
          type: "value",
          name: "EUR",
          axisLabel: {
            formatter: (value: number) => formatCurrency(value),
          },
        },
        {
          type: "value",
          name: "%",
          min: 0,
          max: 100,
          axisLabel: {
            formatter: (value: number) => `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`,
          },
        },
      ],
      series: [
        {
          name: "Umsatz Soll",
          type: "bar",
          data: visibleRows.map((row) => asNumber(row.plannedRevenue)),
          itemStyle: { color: "#94a3b8" },
        },
        {
          name: "Umsatz Ist",
          type: "bar",
          data: visibleRows.map((row) => asNumber(row.actualRevenue)),
          itemStyle: { color: "#0ea5e9" },
        },
        {
          name: "Payout-Quote Soll",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.plannedPayoutRatePct)),
          lineStyle: { width: 2, type: "dashed", color: "#64748b" },
          itemStyle: { color: "#64748b" },
        },
        {
          name: "Payout-Quote Ist",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.actualPayoutRatePct)),
          lineStyle: { width: 2, color: "#f97316" },
          itemStyle: { color: "#f97316" },
        },
      ],
    };
  }, [visibleRows]);

  const driversChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: number) => formatCurrency(value),
      },
      grid: { left: 54, right: 20, top: 18, bottom: 48 },
      xAxis: {
        type: "category",
        data: selectedDrivers.map((entry) => entry.label),
        axisLabel: {
          interval: 0,
          rotate: 20,
        },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
      series: [
        {
          type: "bar",
          data: selectedDrivers.map((entry) => entry.amount),
          itemStyle: {
            color: (params: { dataIndex: number; value: number }) => {
              const item = selectedDrivers[params.dataIndex];
              if (item?.kind === "total") return "#0f172a";
              return params.value < 0 ? "#dc2626" : "#16a34a";
            },
          },
        },
      ],
    };
  }, [selectedDrivers]);

  const comparisonColumns = useMemo<ColumnDef<SollIstRow>[]>(() => [
    {
      header: "Monat",
      accessorKey: "month",
      meta: { minWidth: 150 },
      cell: ({ row }) => (
        <Space size={6}>
          <Button size="small" type={selectedMonth === row.original.month ? "primary" : "default"} onClick={() => setSelectedMonth(row.original.month)}>
            {formatMonthLabel(row.original.month)}
          </Button>
          {row.original.provisional ? <Tag color="gold">Vorlaeufig</Tag> : <Tag color="green">Abgeschlossen</Tag>}
        </Space>
      ),
    },
    {
      header: "Kontostand Soll",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => formatCurrency(row.original.plannedClosing),
    },
    {
      header: "Kontostand Ist",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => formatCurrency(row.original.actualClosing),
    },
    {
      header: "Delta Kontostand",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => (
        <span className={Number(row.original.closingDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatSignedCurrency(row.original.closingDelta)}
        </span>
      ),
    },
    {
      header: "Umsatz Soll",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.plannedRevenue),
    },
    {
      header: "Umsatz Ist",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.actualRevenue),
    },
    {
      header: "Payout Soll",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.plannedPayout),
    },
    {
      header: "Payout Ist",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.actualPayout),
    },
  ], [selectedMonth]);

  if (loading) {
    return (
      <div className="v2-page">
        <Alert type="info" showIcon message="Workspace wird geladen..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="v2-page">
        <Alert type="error" showIcon message={error} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="v2-page">
        <Card className="v2-intro-card">
          <div className="v2-page-head">
            <div>
              <Title level={3}>Soll vs. Ist</Title>
              <Paragraph>
                Analyse von Planwerten gegen eingetretene Ist-Werte (Kontostand, Umsatz und Payout).
              </Paragraph>
            </div>
          </div>
        </Card>
        <Alert
          type="warning"
          showIcon
          message="Noch keine Ist-Daten vorhanden"
          description="Bitte zuerst Monats-Istwerte in 'Abschluss > Eingaben' pflegen."
        />
      </div>
    );
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Soll vs. Ist</Title>
            <Paragraph>
              Wie gut war die Planung gegen die real eingetretenen Werte. Fokus: Kontostand, Umsatz und Payout.
            </Paragraph>
          </div>
          <div className="v2-toolbar-field">
            <Text>Zeitraum</Text>
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 220, maxWidth: "100%" }}
            />
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="green">Monate mit Istwerten: {rows.length}</Tag>
            <Tag color="blue">Im Vergleich (abgeschlossen): {completedRows.length}</Tag>
            <Tag color="gold">Laufender Monat wird als "vorlaeufig" markiert</Tag>
          </div>
        </div>
      </Card>

      <div className="v2-svi-kpi-grid">
        <Card>
          <Statistic
            title="Treffsicherheit Kontostand"
            value={closingAccuracy.accuracyPct != null ? `${closingAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(closingAccuracy.mapePct)} · n={closingAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Treffsicherheit Umsatz"
            value={revenueAccuracy.accuracyPct != null ? `${revenueAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(revenueAccuracy.mapePct)} · n={revenueAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Treffsicherheit Payout"
            value={payoutAccuracy.accuracyPct != null ? `${payoutAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(payoutAccuracy.mapePct)} · n={payoutAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Aktueller Delta-Kontostand"
            value={selectedRow ? formatSignedCurrency(selectedRow.closingDelta) : "—"}
          />
          <Text type="secondary">
            {selectedRow ? `${formatMonthLabel(selectedRow.month)} ${selectedRow.provisional ? "(vorlaeufig)" : "(abgeschlossen)"}` : "Kein Monat gewählt"}
          </Text>
        </Card>
      </div>

      <Card>
        <Title level={4}>Kontostand Soll vs. Ist</Title>
        <Paragraph type="secondary">
          Linien zeigen Soll/Ist-Kontostand, Balken darunter die Abweichung (Ist minus Soll) pro Monat.
        </Paragraph>
        <ReactECharts style={{ height: 380 }} option={closingChartOption} />
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card>
            <Title level={4}>Umsatz & Payout-Quote</Title>
            <Paragraph type="secondary">
              Umsatz in EUR als Balken, Payout-Quote als Linien (Soll vs. Ist).
            </Paragraph>
            <ReactECharts style={{ height: 340 }} option={revenuePayoutChartOption} />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card>
            <Title level={4}>Treiber Monat {selectedRow ? formatMonthLabel(selectedRow.month) : "—"}</Title>
            <Paragraph type="secondary">
              Zerlegung des Monats-Effekts auf den Kontostand in Umsatz-/Payout-Effekt und Residuum.
            </Paragraph>
            <ReactECharts style={{ height: 260 }} option={driversChartOption} />
            <div className="v2-svi-driver-list">
              {selectedDrivers.map((entry) => (
                <div key={entry.key} className={`v2-svi-driver-row ${entry.kind === "total" ? "is-total" : ""}`}>
                  <Text>{entry.label}</Text>
                  <Text className={entry.amount < 0 ? "v2-negative" : undefined}>
                    {formatSignedCurrency(entry.amount)}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Card>
        <Title level={4}>Monatsvergleich</Title>
        <Paragraph type="secondary">
          Monat anklicken, um den Treiber- und Detailbereich zu aktualisieren.
        </Paragraph>
        <TanStackGrid
          data={visibleRows}
          columns={comparisonColumns}
          minTableWidth={1240}
          tableLayout="auto"
        />
      </Card>

      <Card>
        <Title level={4}>Plan-Detail (Auszahlungen) für {selectedRow ? formatMonthLabel(selectedRow.month) : "—"}</Title>
        <Paragraph type="secondary">
          Geplante Auszahlungsstruktur im ausgewählten Monat als Kontext für die Soll-vs-Ist-Differenz.
        </Paragraph>
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={selectedPlanGroupRows}
          columns={[
            {
              title: "Gruppe",
              dataIndex: "label",
              key: "label",
              sorter: (a, b) => String(a.label || "").localeCompare(String(b.label || ""), "de-DE"),
            },
            {
              title: "Planbetrag",
              dataIndex: "amount",
              key: "amount",
              align: "right" as const,
              sorter: (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
              render: (value: number) => (
                <span className={value < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(value)}</span>
              ),
            },
          ]}
          locale={{ emptyText: "Keine geplanten Positionen im ausgewählten Monat." }}
        />
      </Card>
    </div>
  );
}
