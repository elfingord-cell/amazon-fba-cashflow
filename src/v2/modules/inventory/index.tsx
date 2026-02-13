import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import {
  computeInventoryProjection,
  resolveCoverageDays,
  resolveSafetyStockDays,
} from "../../../domain/inventoryProjection.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { addMonths, currentMonthKey, formatMonthLabel, monthRange, normalizeMonthKey } from "../../domain/months";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type ProjectionMode = "units" | "doh" | "plan";

interface SnapshotItemDraft {
  amazonUnits: number;
  threePLUnits: number;
  note: string;
}

type SnapshotDraftMap = Record<string, SnapshotItemDraft>;

interface InventoryProductRow {
  sku: string;
  alias: string;
  categoryLabel: string;
  isActive: boolean;
  amazonUnits: number;
  threePLUnits: number;
  totalUnits: number;
  delta: number;
  safetyDays: number | null;
  coverageDays: number | null;
}

function ensureInventoryContainers(state: Record<string, unknown>): void {
  if (!state.inventory || typeof state.inventory !== "object") {
    state.inventory = {
      snapshots: [],
      settings: { projectionMonths: 12, safetyDays: 60 },
    };
  }
  const inventory = state.inventory as Record<string, unknown>;
  if (!Array.isArray(inventory.snapshots)) inventory.snapshots = [];
  if (!inventory.settings || typeof inventory.settings !== "object") {
    inventory.settings = { projectionMonths: 12, safetyDays: 60 };
  }
}

function parseUnits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeSnapshotItems(input: unknown): SnapshotDraftMap {
  const out: SnapshotDraftMap = {};
  if (!Array.isArray(input)) return out;
  input.forEach((entry) => {
    const item = (entry || {}) as Record<string, unknown>;
    const sku = String(item.sku || "").trim();
    if (!sku) return;
    out[sku] = {
      amazonUnits: parseUnits(item.amazonUnits),
      threePLUnits: parseUnits(item.threePLUnits),
      note: String(item.note || ""),
    };
  });
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatInt(value: number | null): string {
  if (!Number.isFinite(value as number)) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE");
}

function findSnapshot(state: Record<string, unknown>, month: string): Record<string, unknown> | null {
  const snapshots = (((state.inventory as Record<string, unknown> | undefined)?.snapshots || []) as unknown[]);
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const snapshot = snapshots.find((entry) => normalizeMonthKey((entry as Record<string, unknown>).month) === normalized);
  return (snapshot as Record<string, unknown>) || null;
}

function findPreviousSnapshot(state: Record<string, unknown>, month: string): Record<string, unknown> | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const snapshots = (((state.inventory as Record<string, unknown> | undefined)?.snapshots || []) as unknown[])
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => normalizeMonthKey(entry.month))
    .sort((a, b) => String(normalizeMonthKey(a.month)).localeCompare(String(normalizeMonthKey(b.month))));

  let previous: Record<string, unknown> | null = null;
  snapshots.forEach((entry) => {
    const entryMonth = normalizeMonthKey(entry.month);
    if (!entryMonth) return;
    if (entryMonth < normalized) previous = entry;
  });
  return previous;
}

export default function InventoryModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());
  const [snapshotDraft, setSnapshotDraft] = useState<SnapshotDraftMap>({});
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>("units");
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [projectionMonths, setProjectionMonths] = useState(12);

  const stateObject = state as unknown as Record<string, unknown>;
  const inventory = ((state.inventory || {}) as Record<string, unknown>);
  const inventorySettings = ((inventory.settings || {}) as Record<string, unknown>);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey());
    (Array.isArray(inventory.snapshots) ? inventory.snapshots : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const month = normalizeMonthKey(row.month);
      if (month) months.add(month);
    });
    return Array.from(months).sort();
  }, [inventory.snapshots]);

  useEffect(() => {
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth(monthOptions[monthOptions.length - 1] || currentMonthKey());
    }
  }, [monthOptions, selectedMonth]);

  useEffect(() => {
    const snapshot = findSnapshot(stateObject, selectedMonth);
    const nextDraft = normalizeSnapshotItems(snapshot?.items || []);
    setSnapshotDraft(nextDraft);
    setSnapshotDirty(false);
  }, [selectedMonth, stateObject]);

  useEffect(() => {
    const fromSettings = Number(inventorySettings.projectionMonths);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
      setProjectionMonths(Math.round(fromSettings));
    }
  }, [inventorySettings.projectionMonths]);

  const categoriesById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.productCategories) ? state.productCategories : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "");
      if (!id) return;
      map.set(id, String(row.name || "Ohne Kategorie"));
    });
    return map;
  }, [state.productCategories]);

  const previousSnapshot = useMemo(() => findPreviousSnapshot(stateObject, selectedMonth), [selectedMonth, stateObject]);
  const previousDraft = useMemo(() => normalizeSnapshotItems(previousSnapshot?.items || []), [previousSnapshot?.items]);

  const baseRows = useMemo(() => {
    const products = (Array.isArray(state.products) ? state.products : []);
    return products
      .map((entry) => {
        const product = entry as Record<string, unknown>;
        const sku = String(product.sku || "").trim();
        if (!sku) return null;
        const alias = String(product.alias || sku);
        const status = String(product.status || "").trim().toLowerCase();
        const isActive = !status || status === "active" || status === "aktiv";
        const categoryLabel = categoriesById.get(String(product.categoryId || "")) || "Ohne Kategorie";
        const item = snapshotDraft[sku] || { amazonUnits: 0, threePLUnits: 0, note: "" };
        const prevItem = previousDraft[sku] || { amazonUnits: 0, threePLUnits: 0, note: "" };
        const totalUnits = item.amazonUnits + item.threePLUnits;
        const prevTotal = prevItem.amazonUnits + prevItem.threePLUnits;
        const safetyDays = resolveSafetyStockDays(product, stateObject);
        const coverageDays = resolveCoverageDays(product, stateObject);
        return {
          sku,
          alias,
          categoryLabel,
          isActive,
          amazonUnits: item.amazonUnits,
          threePLUnits: item.threePLUnits,
          totalUnits,
          delta: totalUnits - prevTotal,
          safetyDays: Number.isFinite(safetyDays as number) ? Number(safetyDays) : null,
          coverageDays: Number.isFinite(coverageDays as number) ? Number(coverageDays) : null,
        } satisfies InventoryProductRow;
      })
      .filter(Boolean) as InventoryProductRow[];
  }, [categoriesById, previousDraft, snapshotDraft, state.products, stateObject]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return baseRows
      .filter((row) => {
        if (onlyActive && !row.isActive) return false;
        if (!needle) return true;
        return [row.sku, row.alias, row.categoryLabel].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [baseRows, onlyActive, search]);

  const snapshotColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => [
    { header: "SKU", accessorKey: "sku", meta: { width: 150 } },
    { header: "Alias", accessorKey: "alias", meta: { width: 220 } },
    { header: "Kategorie", accessorKey: "categoryLabel", meta: { width: 150 } },
    {
      header: "Amazon",
      meta: { width: 116, align: "right" },
      cell: ({ row }) => (
        <InputNumber
          value={row.original.amazonUnits}
          min={0}
          style={{ width: "100%" }}
          controls={false}
          onChange={(nextValue) => {
            const parsed = parseUnits(nextValue);
            setSnapshotDraft((prev) => ({
              ...prev,
              [row.original.sku]: {
                ...(prev[row.original.sku] || { amazonUnits: 0, threePLUnits: 0, note: "" }),
                amazonUnits: parsed,
              },
            }));
            setSnapshotDirty(true);
          }}
        />
      ),
    },
    {
      header: "3PL",
      meta: { width: 116, align: "right" },
      cell: ({ row }) => (
        <InputNumber
          value={row.original.threePLUnits}
          min={0}
          style={{ width: "100%" }}
          controls={false}
          onChange={(nextValue) => {
            const parsed = parseUnits(nextValue);
            setSnapshotDraft((prev) => ({
              ...prev,
              [row.original.sku]: {
                ...(prev[row.original.sku] || { amazonUnits: 0, threePLUnits: 0, note: "" }),
                threePLUnits: parsed,
              },
            }));
            setSnapshotDirty(true);
          }}
        />
      ),
    },
    {
      header: "Total",
      meta: { width: 92, align: "right" },
      cell: ({ row }) => formatInt(row.original.totalUnits),
    },
    {
      header: "Delta",
      meta: { width: 92, align: "right" },
      cell: ({ row }) => (
        <span className={row.original.delta < 0 ? "v2-negative" : ""}>
          {formatInt(row.original.delta)}
        </span>
      ),
    },
    {
      header: "Safety",
      meta: { width: 88, align: "right" },
      cell: ({ row }) => formatInt(row.original.safetyDays),
    },
    {
      header: "Coverage",
      meta: { width: 94, align: "right" },
      cell: ({ row }) => formatInt(row.original.coverageDays),
    },
  ], []);

  const projectionStartMonth = useMemo(() => addMonths(selectedMonth, 1), [selectedMonth]);
  const projectionMonthList = useMemo(() => monthRange(projectionStartMonth, projectionMonths), [projectionMonths, projectionStartMonth]);

  const snapshotForProjection = useMemo(() => {
    return {
      month: selectedMonth,
      items: Object.entries(snapshotDraft).map(([sku, values]) => ({
        sku,
        amazonUnits: parseUnits(values.amazonUnits),
        threePLUnits: parseUnits(values.threePLUnits),
        note: String(values.note || ""),
      })),
    };
  }, [selectedMonth, snapshotDraft]);

  const projection = useMemo(() => computeInventoryProjection({
    state: stateObject,
    months: projectionMonthList,
    products: filteredRows.map((entry) => ({
      sku: entry.sku,
      alias: entry.alias,
      status: entry.isActive ? "active" : "inactive",
      safetyStockDohOverride: entry.safetyDays,
      foCoverageDohOverride: entry.coverageDays,
    })),
    snapshot: snapshotForProjection,
    projectionMode,
  }), [filteredRows, projectionMode, projectionMonthList, snapshotForProjection, stateObject]);

  const projectionColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => {
    const base: ColumnDef<InventoryProductRow>[] = [
      { header: "SKU", accessorKey: "sku", meta: { width: 150 } },
      { header: "Alias", accessorKey: "alias", meta: { width: 220 } },
      {
        header: projectionMode === "plan" ? "Forecast Units" : projectionMode === "doh" ? "DOH Verlauf" : "Bestandsverlauf",
        meta: { width: 128 },
        cell: () => " ",
      },
    ];
    const monthColumns = projectionMonthList.map((month) => ({
      id: month,
      header: formatMonthLabel(month),
      meta: { minWidth: 110, align: "right" },
      cell: ({ row }: { row: { original: InventoryProductRow } }) => {
        const data = projection.perSkuMonth.get(row.original.sku)?.get(month);
        if (!data) return "—";
        const inbound = Number(data.inboundUnits || 0);
        let value: number | null = null;
        if (projectionMode === "plan") {
          value = Number.isFinite(data.forecastUnits as number) ? Number(data.forecastUnits) : null;
        } else if (projectionMode === "doh") {
          value = Number.isFinite(data.doh as number) ? Number(data.doh) : null;
        } else {
          value = Number.isFinite(data.endAvailable as number) ? Number(data.endAvailable) : null;
        }
        return (
          <div>
            <div className={value != null && value < 0 ? "v2-negative" : ""}>
              {formatInt(value)}
            </div>
            {inbound > 0 ? <Text type="secondary" style={{ fontSize: 11 }}>+{formatInt(inbound)} in</Text> : null}
          </div>
        );
      },
    })) as ColumnDef<InventoryProductRow>[];
    return [...base, ...monthColumns];
  }, [projection.perSkuMonth, projectionMode, projectionMonthList]);

  async function saveSnapshot(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureInventoryContainers(nextState);
      const inventoryTarget = nextState.inventory as Record<string, unknown>;
      const snapshots = (Array.isArray(inventoryTarget.snapshots) ? [...(inventoryTarget.snapshots as unknown[])] : []) as Record<string, unknown>[];

      const items = Object.entries(snapshotDraft)
        .map(([sku, value]) => ({
          sku,
          amazonUnits: parseUnits(value.amazonUnits),
          threePLUnits: parseUnits(value.threePLUnits),
          note: String(value.note || ""),
        }))
        .filter((entry) => entry.amazonUnits > 0 || entry.threePLUnits > 0 || entry.note);

      const month = normalizeMonthKey(selectedMonth) || currentMonthKey();
      const index = snapshots.findIndex((entry) => normalizeMonthKey(entry.month) === month);
      const payload = { month, items, updatedAt: nowIso() };
      if (index >= 0) {
        snapshots[index] = { ...(snapshots[index] || {}), ...payload };
      } else {
        snapshots.push(payload);
      }
      snapshots.sort((a, b) => String(normalizeMonthKey(a.month)).localeCompare(String(normalizeMonthKey(b.month))));
      inventoryTarget.snapshots = snapshots;
      inventoryTarget.settings = {
        ...((inventoryTarget.settings || {}) as Record<string, unknown>),
        projectionMonths: Math.max(1, Math.round(projectionMonths)),
      };
      return next;
    }, "v2:inventory:save-snapshot");
    setSnapshotDirty(false);
  }

  async function copyFromPreviousMonth(): Promise<void> {
    const previous = findPreviousSnapshot(stateObject, selectedMonth);
    if (!previous) return;
    setSnapshotDraft(normalizeSnapshotItems(previous.items || []));
    setSnapshotDirty(true);
  }

  function exportSnapshotCsv(): void {
    const rows = [
      ["SKU", "Alias", "Kategorie", "AmazonUnits", "ThreePLUnits", "TotalUnits"],
      ...filteredRows.map((entry) => [
        entry.sku,
        entry.alias,
        entry.categoryLabel,
        String(entry.amazonUnits),
        String(entry.threePLUnits),
        String(entry.totalUnits),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventory-snapshot-${selectedMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Inventory</Title>
            <Paragraph>
              Snapshot-Erfassung und Projektion (Units / DOH / Plan) auf Basis der bestehenden Domain-Logik.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Select
              value={selectedMonth}
              onChange={(value) => setSelectedMonth(value)}
              options={monthOptions.map((month) => ({ value: month, label: month }))}
              style={{ width: 140, maxWidth: "100%" }}
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suche SKU, Alias, Kategorie"
              style={{ width: 320, maxWidth: "100%" }}
            />
            <Checkbox checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)}>
              Nur aktive Produkte
            </Checkbox>
            <Radio.Group value={projectionMode} onChange={(event) => setProjectionMode(event.target.value as ProjectionMode)}>
              <Radio.Button value="units">Units</Radio.Button>
              <Radio.Button value="doh">DOH</Radio.Button>
              <Radio.Button value="plan">Plan</Radio.Button>
            </Radio.Group>
            <InputNumber
              min={1}
              max={36}
              value={projectionMonths}
              onChange={(value) => setProjectionMonths(Math.max(1, Math.round(Number(value) || 1)))}
            />
          </div>
          <div className="v2-toolbar-row">
            <Button onClick={() => { void copyFromPreviousMonth(); }}>
              Vorherigen Monat kopieren
            </Button>
            <Button type="primary" onClick={() => { void saveSnapshot(); }} disabled={!snapshotDirty} loading={saving}>
              Snapshot speichern
            </Button>
            <Button onClick={exportSnapshotCsv}>
              Snapshot CSV
            </Button>
            {snapshotDirty ? <Tag color="orange">Ungespeicherte Änderungen</Tag> : <Tag color="green">Synchron</Tag>}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={4}>Snapshot {selectedMonth}</Title>
        <TanStackGrid
          data={filteredRows}
          columns={snapshotColumns}
          minTableWidth={980}
          tableLayout="auto"
        />
      </Card>

      <Card>
        <Title level={4}>Projektion ({projectionMode.toUpperCase()})</Title>
        <Text type="secondary">
          Zeitraum: {projectionMonthList[0] || "—"} bis {projectionMonthList[projectionMonthList.length - 1] || "—"}.
        </Text>
        <TanStackGrid
          data={filteredRows}
          columns={projectionColumns}
          minTableWidth={Math.max(980, 500 + (projectionMonthList.length * 110))}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
