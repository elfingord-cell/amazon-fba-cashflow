import { useMemo } from "react";
import { Alert, Card, Space, Tag, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface AbcRow {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  abcBasis: "revenue_6m" | "units_6m_fallback" | "no_data";
  revenue6m: number | null;
  units6m: number | null;
  vkPriceGross: number | null;
  active: boolean;
}

function formatNumber(value: number | null, digits = 0): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function basisLabel(value: AbcRow["abcBasis"]): string {
  if (value === "revenue_6m") return "Umsatz 6M";
  if (value === "units_6m_fallback") return "Units-Fallback 6M";
  return "Keine Forecast-Daten";
}

function abcTag(value: AbcRow["abcClass"]): JSX.Element {
  if (value === "A") return <Tag color="green">A</Tag>;
  if (value === "B") return <Tag color="gold">B</Tag>;
  return <Tag>C</Tag>;
}

export default function AbcInsightsModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;

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
      });
    });
    return Array.from(dedup.values()).sort((a, b) => a.alias.localeCompare(b.alias, "de-DE", { sensitivity: "base" }));
  }, [state.products, stateObject]);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (!row.active) return acc;
        acc[row.abcClass] += 1;
        if (row.abcBasis === "revenue_6m") acc.revenueBasis += 1;
        if (row.abcBasis === "units_6m_fallback") acc.unitsFallback += 1;
        if (row.abcBasis === "no_data") acc.noData += 1;
        return acc;
      },
      { A: 0, B: 0, C: 0, revenueBasis: 0, unitsFallback: 0, noData: 0 },
    );
  }, [rows]);

  const columns = useMemo<ColumnDef<AbcRow>[]>(() => [
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
      header: "ABC",
      meta: { width: 88, align: "center" },
      cell: ({ row }) => abcTag(row.original.abcClass),
    },
    {
      header: "Basis",
      meta: { width: 180 },
      cell: ({ row }) => basisLabel(row.original.abcBasis),
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
      meta: { width: 160, align: "right" },
      cell: ({ row }) => formatNumber(row.original.revenue6m, 2),
    },
    {
      header: "Status",
      meta: { width: 100 },
      cell: ({ row }) => (row.original.active ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>),
    },
  ], []);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>ABC Insights</Title>
            <Paragraph>
              Transparenz zur ABC-Klassifizierung: zuerst Umsatz der nächsten 6 Monate, bei fehlendem Preis Units-Fallback.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="green">A: {counts.A}</Tag>
            <Tag color="gold">B: {counts.B}</Tag>
            <Tag>C: {counts.C}</Tag>
            <Tag color="blue">Umsatz-Basis: {counts.revenueBasis}</Tag>
            <Tag color="purple">Units-Fallback: {counts.unitsFallback}</Tag>
            <Tag color={counts.noData > 0 ? "orange" : "green"}>Ohne Forecast: {counts.noData}</Tag>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text type="secondary">
            Regel: Ranking nach 6M-Umsatz. Falls kein belastbarer Verkaufspreis vorhanden ist, wird Units als Fallback verwendet.
          </Text>
          <TanStackGrid data={rows} columns={columns} minTableWidth={1120} tableLayout="fixed" />
        </Space>
      </Card>
    </div>
  );
}
