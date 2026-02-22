import { useMemo, useState } from "react";
import { Alert, Card, Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { DataTable } from "../../components/DataTable";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;
const ABC_THRESHOLDS = { A: 0.8, B: 0.95 } as const;

type BasisMode = "revenue_6m" | "units_6m";
type AbcFilter = "all" | "A" | "B" | "C";
type StatusFilter = "all" | "active" | "inactive";

interface AbcRow {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  abcBasis: "revenue_6m" | "units_6m_fallback" | "no_data";
  revenue6m: number | null;
  units6m: number | null;
  vkPriceGross: number | null;
  active: boolean;
  revenueRankingMetric: number | null;
}

interface ScoredRow extends AbcRow {
  rank: number;
  metricValue: number | null;
  basisShare: number;
  cumulativeShare: number;
  viewAbcClass: "A" | "B" | "C";
}

function formatNumber(value: number | null, digits = 0): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null, digits = 1): string {
  if (!Number.isFinite(value as number)) return "Keine Daten";
  return `${Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function basisLabel(value: AbcRow["abcBasis"]): string {
  if (value === "revenue_6m") return "Umsatz 6M";
  if (value === "units_6m_fallback") return "Units 6M (Fallback)";
  return "Keine Forecast-Daten";
}

function basisHint(value: AbcRow["abcBasis"]): string {
  if (value === "revenue_6m") {
    return "Basis aus Umsatz der naechsten 6 Monate.";
  }
  if (value === "units_6m_fallback") {
    return "Fallback: Kein belastbarer VK-Preis, Einordnung ueber Units 6M (mit Durchschnittspreis gewichtet).";
  }
  return "Keine ausreichenden Forecast-Daten fuer die naechsten 6 Monate.";
}

function abcTag(value: "A" | "B" | "C"): JSX.Element {
  if (value === "A") return <Tag color="green">A</Tag>;
  if (value === "B") return <Tag color="gold">B</Tag>;
  return <Tag>C</Tag>;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function basisModeLabel(value: BasisMode): string {
  return value === "revenue_6m" ? "Umsatz 6M" : "Units 6M";
}

function resolveMetric(row: AbcRow, basisMode: BasisMode): number | null {
  if (basisMode === "revenue_6m") {
    return Number.isFinite(row.revenueRankingMetric as number) ? Number(row.revenueRankingMetric) : null;
  }
  return Number.isFinite(row.units6m as number) ? Number(row.units6m) : null;
}

function compareByMetric(a: AbcRow, b: AbcRow, basisMode: BasisMode): number {
  const aMetric = resolveMetric(a, basisMode);
  const bMetric = resolveMetric(b, basisMode);
  const aGroup = aMetric == null ? 2 : aMetric <= 0 ? 1 : 0;
  const bGroup = bMetric == null ? 2 : bMetric <= 0 ? 1 : 0;
  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aGroup === 0) {
    const diff = Number(bMetric || 0) - Number(aMetric || 0);
    if (Math.abs(diff) > 1e-9) return diff;
  }
  return a.alias.localeCompare(b.alias, "de-DE", { sensitivity: "base" });
}

function scoreRows(rows: AbcRow[], basisMode: BasisMode): ScoredRow[] {
  const sorted = rows.slice().sort((a, b) => compareByMetric(a, b, basisMode));
  const positiveMetricRows = sorted.filter((row) => Number(resolveMetric(row, basisMode) || 0) > 0);
  const totalMetric = positiveMetricRows.reduce((acc, row) => acc + Number(resolveMetric(row, basisMode) || 0), 0);

  const dynamicAbcBySku = new Map<string, "A" | "B" | "C">();
  if (basisMode === "units_6m" && totalMetric > 0) {
    let cumulative = 0;
    sorted.forEach((row) => {
      const metric = Number(resolveMetric(row, basisMode) || 0);
      if (metric <= 0) {
        dynamicAbcBySku.set(row.sku.toLowerCase(), "C");
        return;
      }
      cumulative += metric;
      const share = cumulative / totalMetric;
      if (share <= ABC_THRESHOLDS.A) {
        dynamicAbcBySku.set(row.sku.toLowerCase(), "A");
      } else if (share <= ABC_THRESHOLDS.B) {
        dynamicAbcBySku.set(row.sku.toLowerCase(), "B");
      } else {
        dynamicAbcBySku.set(row.sku.toLowerCase(), "C");
      }
    });
  }

  let cumulativeMetric = 0;
  return sorted.map((row, index) => {
    const metric = resolveMetric(row, basisMode);
    const positiveMetric = Number(metric || 0) > 0 ? Number(metric || 0) : 0;
    if (positiveMetric > 0) cumulativeMetric += positiveMetric;
    const basisShare = totalMetric > 0 ? positiveMetric / totalMetric : 0;
    const cumulativeShare = totalMetric > 0 ? cumulativeMetric / totalMetric : 0;
    const dynamicClass = dynamicAbcBySku.get(row.sku.toLowerCase());
    return {
      ...row,
      rank: index + 1,
      metricValue: metric,
      basisShare,
      cumulativeShare,
      viewAbcClass: basisMode === "revenue_6m" ? row.abcClass : (dynamicClass || "C"),
    };
  });
}

export default function AbcInsightsModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;
  const [basisMode, setBasisMode] = useState<BasisMode>("revenue_6m");
  const [abcFilter, setAbcFilter] = useState<AbcFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const rows = useMemo<AbcRow[]>(() => {
    const snapshot = computeAbcClassification(stateObject);
    const products = Array.isArray(state.products) ? state.products : [];
    const aliasBySku = new Map<string, string>();
    products.forEach((entry) => {
      const row = (entry || {}) as Record<string, unknown>;
      const sku = String(row.sku || "").trim();
      if (!sku) return;
      aliasBySku.set(sku.toLowerCase(), String(row.alias || sku));
    });
    const dedup = new Map<string, AbcRow>();
    snapshot.bySku.forEach((entry) => {
      const row = (entry || {}) as Record<string, unknown>;
      const sku = String(row.sku || "").trim();
      if (!sku) return;
      const key = sku.toLowerCase();
      if (dedup.has(key)) return;
      const abcClassRaw = String(row.abcClass || "C").toUpperCase();
      const abcClass = abcClassRaw === "A" || abcClassRaw === "B" ? abcClassRaw : "C";
      const basisRaw = String(row.abcBasis || "no_data");
      const abcBasis = basisRaw === "revenue_6m" || basisRaw === "units_6m_fallback" ? basisRaw : "no_data";
      dedup.set(key, {
        sku,
        alias: aliasBySku.get(key) || sku,
        abcClass,
        abcBasis,
        revenue6m: Number.isFinite(Number(row.revenue6m)) ? Number(row.revenue6m) : null,
        units6m: Number.isFinite(Number(row.units6m)) ? Number(row.units6m) : null,
        vkPriceGross: Number.isFinite(Number(row.vkPriceGross)) ? Number(row.vkPriceGross) : null,
        active: row.active !== false,
        revenueRankingMetric: null,
      });
    });

    const baseRows = Array.from(dedup.values());
    let revenueSum = 0;
    let revenueUnitsSum = 0;
    baseRows.forEach((row) => {
      const revenue = Number(row.revenue6m || 0);
      const units = Number(row.units6m || 0);
      if (row.abcBasis === "revenue_6m" && row.active && revenue > 0 && units > 0) {
        revenueSum += revenue;
        revenueUnitsSum += units;
      }
    });
    const fallbackUnitPrice = revenueSum > 0 && revenueUnitsSum > 0 ? revenueSum / revenueUnitsSum : 1;
    return baseRows
      .map((row) => {
        let revenueRankingMetric: number | null = null;
        if (row.abcBasis === "revenue_6m" && Number(row.revenue6m || 0) > 0) {
          revenueRankingMetric = Number(row.revenue6m || 0);
        } else if (row.abcBasis === "units_6m_fallback" && Number(row.units6m || 0) > 0) {
          revenueRankingMetric = Number(row.units6m || 0) * fallbackUnitPrice;
        } else if (Number.isFinite(row.revenue6m as number) && Number(row.revenue6m) === 0) {
          revenueRankingMetric = 0;
        }
        return { ...row, revenueRankingMetric };
      })
      .sort((a, b) => a.alias.localeCompare(b.alias, "de-DE", { sensitivity: "base" }));
  }, [state.products, stateObject]);

  const statusFilteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter === "active") return row.active;
      if (statusFilter === "inactive") return !row.active;
      return true;
    });
  }, [rows, statusFilter]);

  const scoredRows = useMemo(() => scoreRows(statusFilteredRows, basisMode), [statusFilteredRows, basisMode]);

  const abcCounts = useMemo(() => {
    return scoredRows.reduce(
      (acc, row) => {
        acc[row.viewAbcClass] += 1;
        return acc;
      },
      { A: 0, B: 0, C: 0 },
    );
  }, [scoredRows]);

  const visibleRows = useMemo(() => {
    if (abcFilter === "all") return scoredRows;
    return scoredRows.filter((row) => row.viewAbcClass === abcFilter);
  }, [abcFilter, scoredRows]);

  const summary = useMemo(() => {
    const data = visibleRows;
    const totalRevenue = data.reduce((acc, row) => acc + Number(row.revenue6m || 0), 0);
    const hasRevenueData = data.some((row) => Number.isFinite(row.revenue6m as number));
    const totalMetric = data.reduce((acc, row) => acc + Math.max(0, Number(row.metricValue || 0)), 0);
    const byClass = {
      A: { count: 0, revenue: 0 },
      B: { count: 0, revenue: 0 },
      C: { count: 0, revenue: 0 },
    };
    data.forEach((row) => {
      byClass[row.viewAbcClass].count += 1;
      byClass[row.viewAbcClass].revenue += Math.max(0, Number(row.revenue6m || 0));
    });
    const topRows = data.filter((row) => Number(row.metricValue || 0) > 0).slice(0, 5);
    const top1Metric = topRows.slice(0, 1).reduce((acc, row) => acc + Number(row.metricValue || 0), 0);
    const top3Metric = topRows.slice(0, 3).reduce((acc, row) => acc + Number(row.metricValue || 0), 0);
    const top5Metric = topRows.reduce((acc, row) => acc + Number(row.metricValue || 0), 0);
    const noDataCount = data.filter((row) => row.abcBasis === "no_data").length;
    const zeroRevenueCount = data.filter(
      (row) => Number.isFinite(row.revenue6m as number) && Number(row.revenue6m) === 0,
    ).length;
    return {
      totalSkus: data.length,
      totalRevenue: hasRevenueData ? totalRevenue : null,
      byClass,
      top1Share: totalMetric > 0 ? (top1Metric / totalMetric) * 100 : null,
      top3Share: totalMetric > 0 ? (top3Metric / totalMetric) * 100 : null,
      top5Share: totalMetric > 0 ? (top5Metric / totalMetric) * 100 : null,
      classRevenueShare: {
        A: totalRevenue > 0 ? (byClass.A.revenue / totalRevenue) * 100 : null,
        B: totalRevenue > 0 ? (byClass.B.revenue / totalRevenue) * 100 : null,
        C: totalRevenue > 0 ? (byClass.C.revenue / totalRevenue) * 100 : null,
      },
      noDataCount,
      zeroRevenueCount,
    };
  }, [visibleRows]);

  const paretoOption = useMemo(() => {
    if (!visibleRows.length) return null;
    const labels = visibleRows.map((row) => String(row.rank));
    const cumulative = visibleRows.map((row) => Number((row.cumulativeShare * 100).toFixed(2)));
    let aBoundaryRank: number | null = null;
    let bBoundaryRank: number | null = null;
    visibleRows.forEach((row) => {
      if (Number(row.metricValue || 0) <= 0) return;
      if (row.viewAbcClass === "A") aBoundaryRank = row.rank;
      if (row.viewAbcClass === "B") bBoundaryRank = row.rank;
    });
    const markLines: Array<Record<string, unknown>> = [
      { yAxis: ABC_THRESHOLDS.A * 100, name: "A-Schwelle 80 %" },
      { yAxis: ABC_THRESHOLDS.B * 100, name: "B-Schwelle 95 %" },
    ];
    if (aBoundaryRank != null) markLines.push({ xAxis: String(aBoundaryRank), name: `Ende A (Rank ${aBoundaryRank})` });
    if (bBoundaryRank != null) markLines.push({ xAxis: String(bBoundaryRank), name: `Ende B (Rank ${bBoundaryRank})` });
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const dataIndex = Number((first as { dataIndex?: number })?.dataIndex ?? -1);
          const row = visibleRows[dataIndex];
          if (!row) return "Keine Daten";
          return `
            <div style="min-width:220px">
              <div><strong>${escapeHtml(row.alias)}</strong></div>
              <div>${escapeHtml(row.sku)}</div>
              <div style="margin-top:6px">ABC: <strong>${row.viewAbcClass}</strong></div>
              <div>Basiswert: <strong>${formatNumber(row.metricValue, basisMode === "revenue_6m" ? 2 : 0)}</strong></div>
              <div>Umsatz 6M: <strong>${formatNumber(row.revenue6m, 2)} EUR</strong></div>
              <div>Basis-Anteil: <strong>${formatPercent(row.basisShare * 100, 2)}</strong></div>
              <div>Kumuliert: <strong>${formatPercent(row.cumulativeShare * 100, 2)}</strong></div>
            </div>
          `;
        },
      },
      grid: { left: 48, right: 26, top: 26, bottom: 44 },
      xAxis: {
        type: "category",
        name: "SKU-Rank",
        nameGap: 28,
        data: labels,
      },
      yAxis: {
        type: "value",
        name: "Kumuliert %",
        min: 0,
        max: 100,
        axisLabel: {
          formatter: "{value} %",
        },
      },
      series: [
        {
          name: "Pareto-Kurve",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 5,
          data: cumulative,
          lineStyle: { width: 2, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          areaStyle: { color: "rgba(37, 99, 235, 0.12)" },
          markLine: {
            symbol: "none",
            lineStyle: { type: "dashed", color: "rgba(15, 27, 45, 0.42)" },
            label: { formatter: "{b}" },
            data: markLines,
          },
        },
      ],
    };
  }, [basisMode, visibleRows]);

  const columns = useMemo<ColumnDef<ScoredRow>[]>(() => [
    {
      header: "Rank",
      meta: { width: 68, align: "right" },
      cell: ({ row }) => row.original.rank,
    },
    {
      header: "Alias",
      accessorKey: "alias",
      meta: { minWidth: 260, width: 280 },
      cell: ({ row }) => (
        <div className="v2-proj-alias">
          <Text className="v2-proj-alias-main">{row.original.alias}</Text>
          <Text className="v2-proj-sku-secondary" type="secondary">{row.original.sku}</Text>
        </div>
      ),
    },
    {
      header: `% vom Gesamt (${basisModeLabel(basisMode)})`,
      meta: { width: 190, align: "right" },
      cell: ({ row }) => {
        const pct = row.original.basisShare * 100;
        if (Number(row.original.metricValue || 0) <= 0) return <Text type="secondary">Keine Daten</Text>;
        const width = Math.max(3, Math.min(100, pct));
        return (
          <div className="v2-abc-share-cell">
            <Text>{formatPercent(pct, 2)}</Text>
            <div className="v2-abc-share-bar">
              <span style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      header: "Kumuliert %",
      meta: { width: 124, align: "right" },
      cell: ({ row }) => formatPercent(row.original.cumulativeShare * 100, 2),
    },
    {
      header: "ABC",
      meta: { width: 88, align: "center" },
      cell: ({ row }) => abcTag(row.original.viewAbcClass),
    },
    {
      header: "Basis",
      meta: { width: 196 },
      cell: ({ row }) => (
        <Tooltip title={basisHint(row.original.abcBasis)}>
          <div className="v2-abc-basis-cell">
            <Text>{basisLabel(row.original.abcBasis)}</Text>
            <Text type="secondary">
              {basisMode === "revenue_6m"
                ? `${formatNumber(row.original.metricValue, 2)} EUR`
                : `${formatNumber(row.original.metricValue, 0)} Units`}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      header: "Units (6M)",
      meta: { width: 120, align: "right" },
      cell: ({ row }) => formatNumber(row.original.units6m, 0),
    },
    {
      header: "Ø VK (EUR)",
      meta: { width: 120, align: "right" },
      cell: ({ row }) => formatNumber(row.original.vkPriceGross, 2),
    },
    {
      header: "Umsatz (6M EUR)",
      meta: { width: 172, align: "right" },
      cell: ({ row }) => {
        if (row.original.revenue6m == null) return <Text type="secondary">Keine Daten</Text>;
        if (Number(row.original.revenue6m) === 0) {
          return (
            <div className="v2-abc-revenue-cell">
              <Text>0,00</Text>
              <Text type="secondary">0 Umsatz im Zeitraum</Text>
            </div>
          );
        }
        return formatNumber(row.original.revenue6m, 2);
      },
    },
    {
      header: "Status",
      meta: { width: 100 },
      cell: ({ row }) => (row.original.active ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>),
    },
  ], [basisMode]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>ABC Insights</Title>
            <Paragraph>
              ABC ordnet SKUs nach Beitrag zur gewaehlten Basis. Die Pareto-Kurve zeigt die kumulierte Verteilung.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Text type="secondary">Klassifizierung nach</Text>
            <div className="v2-toolbar-row v2-proj-filter-row">
              <button
                type="button"
                className={`v2-proj-filter-btn ${basisMode === "revenue_6m" ? "is-active" : ""}`}
                onClick={() => setBasisMode("revenue_6m")}
              >
                Umsatz 6M
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${basisMode === "units_6m" ? "is-active" : ""}`}
                onClick={() => setBasisMode("units_6m")}
              >
                Units 6M
              </button>
            </div>
            <Tag color="blue">Zeitraum: 6 Monate</Tag>
          </div>

          <div className="v2-toolbar-row">
            <Text type="secondary">ABC-Filter</Text>
            <div className="v2-toolbar-row v2-proj-filter-row">
              <button
                type="button"
                className={`v2-proj-filter-btn ${abcFilter === "all" ? "is-active" : ""}`}
                onClick={() => setAbcFilter("all")}
              >
                Alle ({scoredRows.length})
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${abcFilter === "A" ? "is-active" : ""}`}
                onClick={() => setAbcFilter("A")}
              >
                A ({abcCounts.A})
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${abcFilter === "B" ? "is-active" : ""}`}
                onClick={() => setAbcFilter("B")}
              >
                B ({abcCounts.B})
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${abcFilter === "C" ? "is-active" : ""}`}
                onClick={() => setAbcFilter("C")}
              >
                C ({abcCounts.C})
              </button>
            </div>
            <Text type="secondary">Status</Text>
            <div className="v2-toolbar-row v2-proj-filter-row">
              <button
                type="button"
                className={`v2-proj-filter-btn ${statusFilter === "all" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                Alle
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${statusFilter === "active" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("active")}
              >
                Aktiv
              </button>
              <button
                type="button"
                className={`v2-proj-filter-btn ${statusFilter === "inactive" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("inactive")}
              >
                Inaktiv
              </button>
            </div>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}
      {!loading && !error && rows.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Keine Daten"
          description="Fuer diesen Workspace liegen aktuell keine auswertbaren ABC-Daten vor."
        />
      ) : null}

      <Card>
        <div className="v2-abc-summary-grid">
          <div className="v2-abc-summary-card">
            <Text type="secondary">ABC-Verteilung</Text>
            <div className="v2-abc-summary-line">
              <Text>A: {summary.byClass.A.count} SKUs</Text>
              <Text strong>{formatPercent(summary.classRevenueShare.A, 1)}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>B: {summary.byClass.B.count} SKUs</Text>
              <Text strong>{formatPercent(summary.classRevenueShare.B, 1)}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>C: {summary.byClass.C.count} SKUs</Text>
              <Text strong>{formatPercent(summary.classRevenueShare.C, 1)}</Text>
            </div>
          </div>

          <div className="v2-abc-summary-card">
            <Text type="secondary">Konzentration ({basisModeLabel(basisMode)})</Text>
            <div className="v2-abc-summary-line">
              <Text>Top 1 SKU</Text>
              <Text strong>{formatPercent(summary.top1Share, 1)}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>Top 3 SKUs</Text>
              <Text strong>{formatPercent(summary.top3Share, 1)}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>Top 5 SKUs</Text>
              <Text strong>{formatPercent(summary.top5Share, 1)}</Text>
            </div>
          </div>

          <div className="v2-abc-summary-card">
            <Text type="secondary">Umfang</Text>
            <div className="v2-abc-summary-line">
              <Text>SKUs gesamt</Text>
              <Text strong>{formatNumber(summary.totalSkus, 0)}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>Umsatz gesamt (6M)</Text>
              <Text strong>{summary.totalRevenue == null ? "Keine Daten" : `${formatNumber(summary.totalRevenue, 2)} EUR`}</Text>
            </div>
            <div className="v2-abc-summary-line">
              <Text>Ohne Forecast-Daten</Text>
              <Text strong>{formatNumber(summary.noDataCount, 0)}</Text>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Title level={4} style={{ margin: 0 }}>Pareto / ABC-Kurve</Title>
          <Text type="secondary">
            Sortierung nach {basisModeLabel(basisMode)}. Schwellen: A bis 80 %, B bis 95 %, danach C.
          </Text>
          {paretoOption ? (
            <ReactECharts style={{ height: 340 }} option={paretoOption} />
          ) : (
            <Alert type="info" showIcon message="Keine Daten fuer die Pareto-Kurve im aktuellen Filter." />
          )}
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text type="secondary">
            Tabelle nach {basisModeLabel(basisMode)} sortiert. Bei Umsatzbasis gilt weiterhin Units-Fallback, wenn kein belastbarer VK-Preis vorliegt.
          </Text>
          {summary.zeroRevenueCount > 0 ? (
            <Text type="secondary">{summary.zeroRevenueCount} SKU(s) mit 0 Umsatz im Zeitraum werden ans Tabellenende sortiert.</Text>
          ) : null}
          {visibleRows.length ? (
            <DataTable data={visibleRows} columns={columns} minTableWidth={1420} tableLayout="fixed" />
          ) : (
            <Alert
              type="info"
              showIcon
              message="Keine Treffer fuer die aktuellen Filter"
              description="Bitte ABC-Filter oder Status-Filter anpassen."
            />
          )}
        </Space>
      </Card>
    </div>
  );
}
