import { useMemo, useState } from "react";
import { Card, Input, Select, Typography } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { formatMonthLabel, normalizeMonthKey } from "../../domain/months";
import { buildPhantomFoSuggestions, type PhantomFoSuggestion } from "../../domain/phantomFo";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph } = Typography;

type TriggerFilter = "all" | "stock_under_safety" | "stock_oos";

interface PfoListRow {
  id: string;
  sku: string;
  alias: string;
  supplierName: string;
  trigger: "stock_under_safety" | "stock_oos";
  triggerLabel: string;
  orderDateIso: string | null;
  orderDateLabel: string;
  orderMonth: string | null;
  orderMonthLabel: string;
  arrivalMonth: string | null;
  arrivalMonthLabel: string;
  units: number;
  unitsLabel: string;
  statusHint: string;
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function monthFromIsoDate(value: unknown): string | null {
  const iso = normalizeIsoDate(value);
  return iso ? iso.slice(0, 7) : null;
}

function localTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMonth(value: string | null): string {
  const normalized = normalizeMonthKey(value);
  if (!normalized) return "—";
  return formatMonthLabel(normalized);
}

function formatTriggerLabel(value: "stock_under_safety" | "stock_oos"): string {
  return value === "stock_oos" ? "OOS" : "Unter Safety";
}

function formatUnits(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("de-DE");
}

function resolveOrderDateIso(suggestion: PhantomFoSuggestion): string | null {
  return normalizeIsoDate(suggestion.recommendedOrderDate)
    || normalizeIsoDate(suggestion.latestOrderDate)
    || normalizeIsoDate((suggestion.foRecord || {}).orderDate);
}

function resolveStatusHint(orderDateIso: string | null, todayIso: string): string {
  if (!orderDateIso) return "Kein Bestelldatum";
  if (orderDateIso < todayIso) return "Bestelldatum in Vergangenheit";
  return "Planbar";
}

export default function PfoListView(): JSX.Element {
  const { state } = useWorkspaceState();
  const stateObject = state as unknown as Record<string, unknown>;
  const [search, setSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .forEach((entry) => {
        const id = String(entry.id || "").trim();
        if (!id) return;
        const name = String(entry.name || entry.supplierName || id).trim();
        map.set(id, name || id);
      });
    return map;
  }, [state.suppliers]);

  const rows = useMemo<PfoListRow[]>(() => {
    const todayIso = localTodayIso();
    return buildPhantomFoSuggestions({ state: stateObject })
      .map((suggestion) => {
        const supplierId = String(suggestion.supplierId || (suggestion.foRecord || {}).supplierId || "").trim();
        const orderDateIso = resolveOrderDateIso(suggestion);
        const orderMonth = normalizeMonthKey(suggestion.orderMonth) || monthFromIsoDate(orderDateIso);
        const arrivalMonth = normalizeMonthKey(monthFromIsoDate(suggestion.requiredArrivalDate) || suggestion.firstRiskMonth);
        const units = Math.max(0, Math.round(Number(suggestion.suggestedUnits || 0)));
        return {
          id: String(suggestion.id || ""),
          sku: String(suggestion.sku || "").trim(),
          alias: String(suggestion.alias || suggestion.sku || "").trim(),
          supplierName: supplierNameById.get(supplierId) || "—",
          trigger: suggestion.issueType === "stock_oos" ? "stock_oos" : "stock_under_safety",
          triggerLabel: formatTriggerLabel(suggestion.issueType === "stock_oos" ? "stock_oos" : "stock_under_safety"),
          orderDateIso,
          orderDateLabel: formatDate(orderDateIso),
          orderMonth,
          orderMonthLabel: formatMonth(orderMonth),
          arrivalMonth,
          arrivalMonthLabel: formatMonth(arrivalMonth),
          units,
          unitsLabel: formatUnits(units),
          statusHint: resolveStatusHint(orderDateIso, todayIso),
        } as PfoListRow;
      })
      .sort((left, right) => {
        const leftOrder = left.orderDateIso || "9999-12-31";
        const rightOrder = right.orderDateIso || "9999-12-31";
        const byOrderDate = leftOrder.localeCompare(rightOrder);
        if (byOrderDate !== 0) return byOrderDate;
        const byOrderMonth = (left.orderMonth || "9999-12").localeCompare(right.orderMonth || "9999-12");
        if (byOrderMonth !== 0) return byOrderMonth;
        return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
      });
  }, [stateObject, supplierNameById]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (triggerFilter !== "all" && row.trigger !== triggerFilter) return false;
      if (!query) return true;
      const haystack = `${row.sku} ${row.alias}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, search, triggerFilter]);

  const columns = useMemo<ColumnDef<PfoListRow>[]>(() => ([
    {
      id: "sku",
      header: "SKU / Alias",
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
      meta: { width: 220 },
    },
    {
      accessorKey: "supplierName",
      header: "Lieferant",
      meta: { width: 180 },
    },
    {
      accessorKey: "triggerLabel",
      header: "Trigger",
      meta: { width: 130 },
    },
    {
      accessorKey: "orderDateLabel",
      header: "Bestelldatum",
      meta: { width: 140 },
    },
    {
      accessorKey: "orderMonthLabel",
      header: "Bestellmonat",
      meta: { width: 130 },
    },
    {
      accessorKey: "arrivalMonthLabel",
      header: "Ankunft (Monat)",
      meta: { width: 140 },
    },
    {
      accessorKey: "unitsLabel",
      header: "Menge (Units)",
      meta: { align: "right", width: 120 },
    },
    {
      accessorKey: "statusHint",
      header: "Status/Hinweis",
      meta: { width: 220 },
    },
  ]), []);

  return (
    <Card>
      <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
        <Input
          placeholder="Suche nach SKU oder Alias"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: 280 }}
        />
        <Select
          value={triggerFilter}
          onChange={(value) => setTriggerFilter(value as TriggerFilter)}
          options={[
            { value: "all", label: "Alle Trigger" },
            { value: "stock_under_safety", label: "Unter Safety" },
            { value: "stock_oos", label: "OOS" },
          ]}
          style={{ width: 180 }}
        />
        <Typography.Text type="secondary">
          PFOs: {visibleRows.length} / {rows.length}
        </Typography.Text>
      </div>
      {visibleRows.length ? (
        <DataTable
          data={visibleRows}
          columns={columns}
          minTableWidth={1320}
          tableLayout="auto"
        />
      ) : (
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Keine Phantom Forecast Orders für die aktuelle Suche/Filter.
        </Paragraph>
      )}
    </Card>
  );
}
