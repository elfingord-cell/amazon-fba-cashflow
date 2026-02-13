import { InfoCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Modal,
  Popover,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import {
  computeInventoryProjection,
  getProjectionSafetyClass,
  resolveCoverageDays,
  resolveSafetyStockDays,
} from "../../../domain/inventoryProjection.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import {
  addMonths,
  currentMonthKey,
  formatMonthLabel,
  monthRange,
  normalizeMonthKey,
} from "../../domain/months";
import {
  buildFoRecommendationContext,
  computeFoRecommendationForSku,
  resolveProductBySku,
} from "../../domain/orderUtils";
import { ensureAppStateV2 } from "../../state/appState";
import {
  getModuleExpandedCategoryKeys,
  hasModuleExpandedCategoryKeys,
  setModuleExpandedCategoryKeys,
} from "../../state/uiPrefs";
import { useWorkspaceState } from "../../state/workspace";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

type ProjectionMode = "units" | "doh" | "plan";
type InventoryView = "snapshot" | "projection" | "both";

export interface InventoryModuleProps {
  view?: InventoryView;
}

interface SnapshotItemDraft {
  amazonUnits: number;
  threePLUnits: number;
  note: string;
}

type SnapshotDraftMap = Record<string, SnapshotItemDraft>;

interface InboundItemDetail {
  id: string;
  ref: string;
  units: number;
  arrivalDate: string | null;
  arrivalSource: string | null;
}

interface InboundDetailCell {
  totalUnits: number;
  poUnits: number;
  foUnits: number;
  poItems: InboundItemDetail[];
  foItems: InboundItemDetail[];
}

interface ProjectionCellData {
  forecastUnits: number | null;
  hasForecast: boolean;
  inboundUnits: number;
  inboundDetails: InboundDetailCell | null;
  endAvailable: number | null;
  safetyDays: number | null;
  safetyUnits: number | null;
  doh: number | null;
  passesDoh: boolean;
  passesUnits: boolean;
  isCovered: boolean;
  forecastMissing: boolean;
}

interface InventoryProductRow {
  sku: string;
  alias: string;
  categoryLabel: string;
  abcClass: string | null;
  isActive: boolean;
  amazonUnits: number;
  threePLUnits: number;
  totalUnits: number;
  delta: number;
  safetyDays: number | null;
  coverageDays: number | null;
}

interface CategoryGroup {
  key: string;
  label: string;
  rows: InventoryProductRow[];
}

interface ProjectionActionIntent {
  row: InventoryProductRow;
  month: string;
  data: ProjectionCellData;
  riskClass: "safety-negative" | "safety-low";
  recommendedUnits: number;
  requiredArrivalDate: string | null;
  recommendedOrderDate: string | null;
  recommendation: Record<string, unknown> | null;
}

interface ProjectionRiskSummary {
  underSafetySkus: number;
  oosSkus: number;
  criticalMonth: string | null;
  missingEta: number;
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

function formatInt(value: number | null): string {
  if (!Number.isFinite(value as number)) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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

function resolveLatestSnapshotMonth(state: Record<string, unknown>): string | null {
  const snapshots = (((state.inventory as Record<string, unknown> | undefined)?.snapshots || []) as unknown[])
    .map((entry) => normalizeMonthKey((entry as Record<string, unknown>).month))
    .filter(Boolean) as string[];
  if (!snapshots.length) return null;
  snapshots.sort((a, b) => a.localeCompare(b));
  return snapshots[snapshots.length - 1] || null;
}

function toCategoryGroups(rows: InventoryProductRow[]): CategoryGroup[] {
  const groups = new Map<string, InventoryProductRow[]>();
  rows.forEach((row) => {
    const key = row.categoryLabel || "Ohne Kategorie";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(row);
  });
  return Array.from(groups.entries())
    .map(([key, entries]) => ({
      key,
      label: key,
      rows: entries.sort((a, b) => a.sku.localeCompare(b.sku)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function monthStartIso(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return `${month}-01`;
}

function estimateLeadTimeDays(product: Record<string, unknown> | null, settings: Record<string, unknown>): number {
  const production = Number(
    product?.productionLeadTimeDaysDefault
    ?? settings.defaultProductionLeadTimeDays
    ?? 45,
  );
  const productTemplate = (product?.template as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined;
  const transportMode = String(
    productTemplate?.transportMode
    ?? product?.transportMode
    ?? "sea",
  ).toLowerCase();
  const transportLeadTimes = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const transit = Number(
    transportLeadTimes[transportMode]
    ?? transportLeadTimes.sea
    ?? 45,
  );
  const buffer = Number(settings.defaultBufferDays ?? 0);
  return Math.max(0, Math.round((Number.isFinite(production) ? production : 45)
    + (Number.isFinite(transit) ? transit : 45)
    + (Number.isFinite(buffer) ? buffer : 0)));
}

function projectionModeHint(mode: ProjectionMode): string {
  if (mode === "doh") return "DOH zeigt die Reichweite des projizierten Monatsendbestands in Tagen.";
  if (mode === "plan") return "Plan zeigt den geplanten Monatsabsatz (Forecast) je SKU.";
  return "Units zeigt den projizierten Monatsendbestand je SKU inklusive Inbound-Wirkung.";
}

function buildInboundPopover(detail: InboundDetailCell | null): JSX.Element {
  if (!detail) return <Text type="secondary">Kein Inbound in diesem Monat.</Text>;
  const poItems = Array.isArray(detail.poItems) ? detail.poItems : [];
  const foItems = Array.isArray(detail.foItems) ? detail.foItems : [];
  return (
    <div style={{ minWidth: 260, maxWidth: 340 }}>
      <div style={{ marginBottom: 8 }}>
        <Text strong>PO Inbound</Text>
        {poItems.length ? (
          <div>
            {poItems.map((item) => (
              <div key={`po-${item.id}-${item.ref}-${item.units}-${item.arrivalDate}`}>
                <Text>
                  {item.ref} · +{formatInt(item.units)} · {formatDate(item.arrivalDate)}
                </Text>
              </div>
            ))}
          </div>
        ) : <Text type="secondary"> Keine PO-Ankunft</Text>}
      </div>
      <div>
        <Text strong>FO Inbound</Text>
        {foItems.length ? (
          <div>
            {foItems.map((item) => (
              <div key={`fo-${item.id}-${item.ref}-${item.units}-${item.arrivalDate}`}>
                <Text>
                  {item.ref} · +{formatInt(item.units)} · {formatDate(item.arrivalDate)}
                </Text>
              </div>
            ))}
          </div>
        ) : <Text type="secondary"> Keine FO-Ankunft</Text>}
      </div>
    </div>
  );
}

export default function InventoryModule({ view = "both" }: InventoryModuleProps = {}): JSX.Element {
  const navigate = useNavigate();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const hasStoredSnapshotPrefs = hasModuleExpandedCategoryKeys("inventory_snapshot");
  const hasStoredProjectionPrefs = hasModuleExpandedCategoryKeys("inventory_projection");

  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());
  const [selectedMonthTouched, setSelectedMonthTouched] = useState(false);
  const [snapshotDraft, setSnapshotDraft] = useState<SnapshotDraftMap>({});
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>("units");
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [projectionMonths, setProjectionMonths] = useState(12);
  const [snapshotExpandedCategories, setSnapshotExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("inventory_snapshot"));
  const [projectionExpandedCategories, setProjectionExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("inventory_projection"));
  const [actionIntent, setActionIntent] = useState<ProjectionActionIntent | null>(null);

  const showSnapshot = view !== "projection";
  const showProjection = view !== "snapshot";

  const stateObject = state as unknown as Record<string, unknown>;
  const inventory = ((state.inventory || {}) as Record<string, unknown>);
  const inventorySettings = ((inventory.settings || {}) as Record<string, unknown>);
  const settings = (state.settings || {}) as Record<string, unknown>;

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

  const latestSnapshotMonth = useMemo(
    () => resolveLatestSnapshotMonth(stateObject),
    [state.inventory],
  );

  useEffect(() => {
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth(latestSnapshotMonth || monthOptions[monthOptions.length - 1] || currentMonthKey());
      setSelectedMonthTouched(false);
    }
  }, [latestSnapshotMonth, monthOptions, selectedMonth]);

  useEffect(() => {
    if (selectedMonthTouched) return;
    const preferred = latestSnapshotMonth || monthOptions[monthOptions.length - 1] || currentMonthKey();
    if (preferred && preferred !== selectedMonth) {
      setSelectedMonth(preferred);
    }
  }, [latestSnapshotMonth, monthOptions, selectedMonth, selectedMonthTouched]);

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

  const abcBySku = useMemo(() => {
    const snapshot = computeAbcClassification(stateObject);
    return snapshot.bySku;
  }, [state]);

  const productRows = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        sku: String(entry.sku || "").trim(),
        raw: entry,
      }))
      .filter((entry) => entry.sku);
  }, [state.products]);

  const productBySku = useMemo(
    () => new Map(productRows.map((entry) => [entry.sku, entry.raw])),
    [productRows],
  );

  const previousSnapshot = useMemo(
    () => findPreviousSnapshot(stateObject, selectedMonth),
    [selectedMonth, stateObject],
  );

  const previousDraft = useMemo(
    () => normalizeSnapshotItems(previousSnapshot?.items || []),
    [previousSnapshot?.items],
  );

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
        const abcClass = abcBySku.get(sku)?.abcClass ?? null;
        return {
          sku,
          alias,
          categoryLabel,
          abcClass,
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
  }, [abcBySku, categoriesById, previousDraft, snapshotDraft, state.products, stateObject]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return baseRows
      .filter((row) => {
        if (onlyActive && !row.isActive) return false;
        if (!needle) return true;
        return [row.sku, row.alias, row.categoryLabel, row.abcClass || ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => `${a.categoryLabel}|${a.sku}`.localeCompare(`${b.categoryLabel}|${b.sku}`));
  }, [baseRows, onlyActive, search]);

  const groupedRows = useMemo(() => toCategoryGroups(filteredRows), [filteredRows]);

  useEffect(() => {
    if (!showSnapshot) return;
    setSnapshotExpandedCategories((current) => {
      if (!groupedRows.length) return [];
      const valid = new Set(groupedRows.map((group) => group.key));
      const filtered = current.filter((key) => valid.has(key));
      if (filtered.length || hasStoredSnapshotPrefs) return filtered;
      return groupedRows.map((group) => group.key);
    });
  }, [groupedRows, hasStoredSnapshotPrefs, showSnapshot]);

  useEffect(() => {
    if (!showProjection) return;
    setProjectionExpandedCategories((current) => {
      if (!groupedRows.length) return [];
      const valid = new Set(groupedRows.map((group) => group.key));
      const filtered = current.filter((key) => valid.has(key));
      if (filtered.length || hasStoredProjectionPrefs) return filtered;
      return groupedRows.map((group) => group.key);
    });
  }, [groupedRows, hasStoredProjectionPrefs, showProjection]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("inventory_snapshot", snapshotExpandedCategories);
  }, [snapshotExpandedCategories]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("inventory_projection", projectionExpandedCategories);
  }, [projectionExpandedCategories]);

  const projectionStartMonth = useMemo(() => addMonths(selectedMonth, 1), [selectedMonth]);
  const projectionMonthList = useMemo(
    () => monthRange(projectionStartMonth, projectionMonths),
    [projectionMonths, projectionStartMonth],
  );

  const selectedSnapshot = useMemo(
    () => findSnapshot(stateObject, selectedMonth),
    [selectedMonth, stateObject],
  );

  const snapshotForProjection = useMemo(() => {
    const hasDraftData = Object.keys(snapshotDraft).length > 0;
    const shouldUseDraft = snapshotDirty || Boolean(selectedSnapshot) || hasDraftData;
    if (!shouldUseDraft) return null;
    return {
      month: selectedMonth,
      items: Object.entries(snapshotDraft).map(([sku, values]) => ({
        sku,
        amazonUnits: parseUnits(values.amazonUnits),
        threePLUnits: parseUnits(values.threePLUnits),
        note: String(values.note || ""),
      })),
    };
  }, [selectedMonth, selectedSnapshot, snapshotDirty, snapshotDraft]);

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
    snapshotMonth: selectedMonth,
    projectionMode,
  }), [filteredRows, projectionMode, projectionMonthList, selectedMonth, snapshotForProjection, stateObject]);

  const recommendationContext = useMemo(
    () => buildFoRecommendationContext(stateObject),
    [state.forecast, state.inventory, state.pos, state.fos],
  );

  const riskSummary = useMemo<ProjectionRiskSummary>(() => {
    const underSafetySet = new Set<string>();
    const oosSet = new Set<string>();
    let firstLowMonth: string | null = null;
    let firstOosMonth: string | null = null;

    filteredRows.forEach((row) => {
      projectionMonthList.forEach((month) => {
        const data = projection.perSkuMonth.get(row.sku)?.get(month) as ProjectionCellData | undefined;
        if (!data) return;
        const riskClass = getProjectionSafetyClass({
          projectionMode,
          endAvailable: data.endAvailable,
          safetyUnits: data.safetyUnits,
          doh: data.doh,
          safetyDays: data.safetyDays,
        });
        if (!riskClass) return;
        underSafetySet.add(row.sku);
        if (!firstLowMonth || month < firstLowMonth) firstLowMonth = month;
        if (riskClass === "safety-negative") {
          oosSet.add(row.sku);
          if (!firstOosMonth || month < firstOosMonth) firstOosMonth = month;
        }
      });
    });

    return {
      underSafetySkus: underSafetySet.size,
      oosSkus: oosSet.size,
      criticalMonth: firstOosMonth || firstLowMonth,
      missingEta: Number(projection.inboundMissingDateCount || 0),
    };
  }, [filteredRows, projection, projectionMode, projectionMonthList]);

  function openProjectionAction(row: InventoryProductRow, month: string, data: ProjectionCellData, riskClass: "safety-negative" | "safety-low"): void {
    const product = resolveProductBySku(Array.isArray(state.products) ? (state.products as Record<string, unknown>[]) : [], row.sku);
    const leadTimeDays = estimateLeadTimeDays(product, settings);
    const recommendation = computeFoRecommendationForSku({
      context: recommendationContext,
      sku: row.sku,
      leadTimeDays,
      product,
      settings,
      horizonMonths: Math.max(6, projectionMonths),
    }) as Record<string, unknown> | null;

    const recommendationUnits = Number(recommendation?.recommendedUnits || 0);
    const fallbackUnits = Math.max(0, Math.ceil(Number(data.safetyUnits || 0) - Number(data.endAvailable || 0)));
    const recommendedUnits = Math.max(0, Math.round(Number.isFinite(recommendationUnits) && recommendationUnits > 0
      ? recommendationUnits
      : fallbackUnits));
    const requiredArrivalDate = String(
      recommendation?.requiredArrivalDate
      || monthStartIso(month)
      || "",
    ) || null;
    const recommendedOrderDate = String(
      recommendation?.orderDateAdjusted
      || recommendation?.orderDate
      || "",
    ) || null;

    setActionIntent({
      row,
      month,
      data,
      riskClass,
      recommendedUnits,
      requiredArrivalDate,
      recommendedOrderDate,
      recommendation,
    });
  }

  function navigateToOrderIntent(target: "fo" | "po"): void {
    if (!actionIntent) return;
    const params = new URLSearchParams();
    params.set("source", "inventory_projection");
    params.set("sku", actionIntent.row.sku);
    params.set("month", actionIntent.month);
    params.set("suggestedUnits", String(actionIntent.recommendedUnits || 0));
    params.set("projectedEnd", String(Math.round(Number(actionIntent.data.endAvailable || 0))));
    params.set("mode", projectionMode);
    if (actionIntent.requiredArrivalDate) {
      params.set("requiredArrivalDate", actionIntent.requiredArrivalDate);
    }
    if (actionIntent.recommendedOrderDate) {
      params.set("recommendedOrderDate", actionIntent.recommendedOrderDate);
    }
    navigate(`/v2/orders/${target}?${params.toString()}`);
    setActionIntent(null);
  }

  const snapshotColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => [
    { header: "SKU", accessorKey: "sku", meta: { width: 158, minWidth: 158 } },
    { header: "Alias", accessorKey: "alias", meta: { width: 230, minWidth: 220 } },
    {
      header: "ABC",
      meta: { width: 72, align: "center" },
      cell: ({ row }) => row.original.abcClass || "—",
    },
    {
      header: "Amazon",
      meta: { width: 116, align: "right" },
      cell: ({ row }) => (
        <InputNumber
          className="v2-grid-input"
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
          className="v2-grid-input"
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
      header: "Safety DOH",
      meta: { width: 96, align: "right" },
      cell: ({ row }) => formatInt(row.original.safetyDays),
    },
    {
      header: "Coverage DOH",
      meta: { width: 108, align: "right" },
      cell: ({ row }) => formatInt(row.original.coverageDays),
    },
  ], []);

  const projectionColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => {
    const base: ColumnDef<InventoryProductRow>[] = [
      { header: "SKU", accessorKey: "sku", meta: { width: 158, minWidth: 158 } },
      { header: "Alias", accessorKey: "alias", meta: { width: 230, minWidth: 220 } },
      {
        header: "ABC",
        meta: { width: 68, align: "center" },
        cell: ({ row }) => row.original.abcClass || "—",
      },
      {
        header: "Safety DOH",
        meta: { width: 96, align: "right" },
        cell: ({ row }) => formatInt(row.original.safetyDays),
      },
      {
        header: "Coverage DOH",
        meta: { width: 110, align: "right" },
        cell: ({ row }) => formatInt(row.original.coverageDays),
      },
      {
        header: "Ankerbestand",
        meta: { width: 118, align: "right" },
        cell: ({ row }) => {
          const anchor = projection.startAvailableBySku.get(row.original.sku);
          return formatInt(Number.isFinite(anchor as number) ? Number(anchor) : 0);
        },
      },
    ];

    const monthColumns = projectionMonthList.map((month) => ({
      id: month,
      header: formatMonthLabel(month),
      meta: { minWidth: 118, width: 118, align: "right" },
      cell: ({ row }: { row: { original: InventoryProductRow } }) => {
        const data = projection.perSkuMonth.get(row.original.sku)?.get(month) as ProjectionCellData | undefined;
        if (!data) return "—";

        let value: number | null = null;
        if (projectionMode === "plan") {
          value = Number.isFinite(data.forecastUnits as number) ? Number(data.forecastUnits) : null;
        } else if (projectionMode === "doh") {
          value = Number.isFinite(data.doh as number) ? Number(data.doh) : null;
        } else {
          value = Number.isFinite(data.endAvailable as number) ? Number(data.endAvailable) : null;
        }

        const riskClass = getProjectionSafetyClass({
          projectionMode,
          endAvailable: data.endAvailable,
          safetyUnits: data.safetyUnits,
          doh: data.doh,
          safetyDays: data.safetyDays,
        }) as "" | "safety-negative" | "safety-low";

        const isActionable = projectionMode !== "plan" && (riskClass === "safety-negative" || riskClass === "safety-low");
        const inbound = data.inboundDetails;

        return (
          <div
            className={[
              "v2-proj-cell",
              riskClass ? `v2-proj-cell--${riskClass}` : "",
              isActionable ? "v2-proj-cell--actionable" : "",
            ].filter(Boolean).join(" ")}
            role={isActionable ? "button" : undefined}
            tabIndex={isActionable ? 0 : undefined}
            onClick={isActionable ? () => openProjectionAction(row.original, month, data, riskClass) : undefined}
            onKeyDown={isActionable ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openProjectionAction(row.original, month, data, riskClass);
              }
            } : undefined}
          >
            <div className="v2-proj-cell-main">{formatInt(value)}</div>
            {projectionMode !== "plan" && Number.isFinite(data.safetyUnits as number) ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                SB: {formatInt(data.safetyUnits)}
              </Text>
            ) : null}
            {inbound && inbound.totalUnits > 0 ? (
              <Popover content={buildInboundPopover(inbound)} trigger="hover" placement="topLeft">
                <div className="v2-proj-inbound-row">
                  {inbound.poUnits > 0 ? <Tag className="v2-proj-inbound v2-proj-inbound--po">PO +{formatInt(inbound.poUnits)}</Tag> : null}
                  {inbound.foUnits > 0 ? <Tag className="v2-proj-inbound v2-proj-inbound--fo">FO +{formatInt(inbound.foUnits)}</Tag> : null}
                </div>
              </Popover>
            ) : null}
          </div>
        );
      },
    })) as ColumnDef<InventoryProductRow>[];

    return [...base, ...monthColumns];
  }, [projection, projectionMode, projectionMonthList]);

  async function saveSnapshot(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureInventoryContainers(nextState);
      const inventoryTarget = nextState.inventory as Record<string, unknown>;
      const snapshots = (Array.isArray(inventoryTarget.snapshots)
        ? [...(inventoryTarget.snapshots as unknown[])]
        : []) as Record<string, unknown>[];

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
            <Title level={3}>
              {showSnapshot && !showProjection
                ? "Bestandsaufnahme"
                : (showProjection && !showSnapshot ? "Bestandsprojektion" : "Inventory")}
            </Title>
            <Paragraph>
              {showSnapshot && !showProjection
                ? "Monatliche Snapshot-Erfassung mit Kategoriegruppen, Copy-Forward, Speicherung und CSV-Export."
                : (showProjection && !showSnapshot
                  ? "Bestandsprojektion mit Risikoampel, PO/FO-Inbound-Sicht und direkter Bestellbrücke."
                  : "Snapshot-Erfassung und Projektion (Units / DOH / Plan) in einem Arbeitsbereich.")}
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Select
              value={selectedMonth}
              onChange={(value) => {
                setSelectedMonth(value);
                setSelectedMonthTouched(true);
              }}
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
            {showProjection ? (
              <>
                <Radio.Group value={projectionMode} onChange={(event) => setProjectionMode(event.target.value as ProjectionMode)}>
                  <Radio.Button value="units">Units</Radio.Button>
                  <Radio.Button value="doh">DOH</Radio.Button>
                  <Radio.Button value="plan">Plan</Radio.Button>
                </Radio.Group>
                <Tooltip title={projectionModeHint(projectionMode)}>
                  <InfoCircleOutlined style={{ color: "#64748b", fontSize: 16 }} />
                </Tooltip>
                <InputNumber
                  min={1}
                  max={36}
                  value={projectionMonths}
                  onChange={(value) => setProjectionMonths(Math.max(1, Math.round(Number(value) || 1)))}
                />
              </>
            ) : null}
          </div>

          {showSnapshot ? (
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
          ) : (
            <div className="v2-toolbar-row">
              <Tag color="blue">Anker: {projection.resolvedSnapshotMonth || "—"}</Tag>
              {projection.snapshotFallbackUsed ? (
                <Tag color="gold">Fallback auf letzten Snapshot</Tag>
              ) : null}
              {projection.resolvedSnapshotMonth ? (
                <Text type="secondary">Projektion startet auf Snapshot {projection.resolvedSnapshotMonth}.</Text>
              ) : (
                <Tag color="red">Kein Snapshot verfügbar: Projektion startet bei 0.</Tag>
              )}
            </div>
          )}
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      {showSnapshot ? (
        <Card>
          <Title level={4}>Snapshot {selectedMonth}</Title>
          <div className="v2-category-tools">
            <Text type="secondary">{filteredRows.length} Produkte in {groupedRows.length} Kategorien</Text>
            <div className="v2-actions-inline">
              <Button
                size="small"
                onClick={() => setSnapshotExpandedCategories(groupedRows.map((group) => group.key))}
                disabled={!groupedRows.length}
              >
                Alles auf
              </Button>
              <Button
                size="small"
                onClick={() => setSnapshotExpandedCategories([])}
                disabled={!snapshotExpandedCategories.length}
              >
                Alles zu
              </Button>
            </div>
          </div>

          {!groupedRows.length ? (
            <Text type="secondary">Keine Snapshot-Zeilen für den aktuellen Filter.</Text>
          ) : (
            <Collapse
              className="v2-category-collapse"
              activeKey={snapshotExpandedCategories}
              onChange={(nextKeys) => setSnapshotExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
              items={groupedRows.map((group) => ({
                key: group.key,
                label: (
                  <Space>
                    <Text strong>{group.label}</Text>
                    <span className="v2-category-count">{group.rows.length} Produkte</span>
                  </Space>
                ),
                children: (
                  <TanStackGrid
                    data={group.rows}
                    columns={snapshotColumns}
                    minTableWidth={1120}
                    tableLayout="fixed"
                  />
                ),
              }))}
            />
          )}
        </Card>
      ) : null}

      {showProjection ? (
        <Card>
          <Title level={4}>Projektion ({projectionMode.toUpperCase()})</Title>
          <Text type="secondary">
            Zeitraum: {projectionMonthList[0] || "—"} bis {projectionMonthList[projectionMonthList.length - 1] || "—"}.
          </Text>

          <div className="v2-toolbar-row" style={{ marginTop: 10 }}>
            <Tag color={riskSummary.underSafetySkus > 0 ? "gold" : "green"}>
              Unter Safety: {riskSummary.underSafetySkus}
            </Tag>
            <Tag color={riskSummary.oosSkus > 0 ? "red" : "green"}>
              OOS: {riskSummary.oosSkus}
            </Tag>
            <Tag color="blue">
              Kritischster Monat: {riskSummary.criticalMonth ? formatMonthLabel(riskSummary.criticalMonth) : "—"}
            </Tag>
            <Tag color={riskSummary.missingEta > 0 ? "orange" : "green"}>
              Fehlende ETA: {riskSummary.missingEta}
            </Tag>
          </div>

          <div className="v2-toolbar-row" style={{ marginTop: 4 }}>
            <Tag className="v2-proj-legend v2-proj-legend--negative">OOS / {"<="} 0</Tag>
            <Tag className="v2-proj-legend v2-proj-legend--low">Unter Safety</Tag>
            <Tag className="v2-proj-legend">Inbound Marker: PO / FO</Tag>
            <Text type="secondary">Risikozellen anklicken für `FO erstellen` / `PO erstellen`.</Text>
          </div>

          <div className="v2-category-tools" style={{ marginTop: 10 }}>
            <Text type="secondary">{filteredRows.length} Produkte in {groupedRows.length} Kategorien</Text>
            <div className="v2-actions-inline">
              <Button
                size="small"
                onClick={() => setProjectionExpandedCategories(groupedRows.map((group) => group.key))}
                disabled={!groupedRows.length}
              >
                Alles auf
              </Button>
              <Button
                size="small"
                onClick={() => setProjectionExpandedCategories([])}
                disabled={!projectionExpandedCategories.length}
              >
                Alles zu
              </Button>
            </div>
          </div>

          {!groupedRows.length ? (
            <Text type="secondary">Keine Projektion für den aktuellen Filter.</Text>
          ) : (
            <Collapse
              className="v2-category-collapse"
              activeKey={projectionExpandedCategories}
              onChange={(nextKeys) => setProjectionExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
              items={groupedRows.map((group) => ({
                key: group.key,
                label: (
                  <Space>
                    <Text strong>{group.label}</Text>
                    <span className="v2-category-count">{group.rows.length} Produkte</span>
                  </Space>
                ),
                children: (
                  <TanStackGrid
                    data={group.rows}
                    columns={projectionColumns}
                    minTableWidth={Math.max(1080, 760 + (projectionMonthList.length * 118))}
                    tableLayout="fixed"
                  />
                ),
              }))}
            />
          )}
        </Card>
      ) : null}

      <Modal
        title="Bestellassistent aus Projektion"
        open={Boolean(actionIntent)}
        onCancel={() => setActionIntent(null)}
        footer={(
          <Space>
            <Button onClick={() => setActionIntent(null)}>Abbrechen</Button>
            <Button onClick={() => navigateToOrderIntent("fo")}>FO erstellen</Button>
            <Button type="primary" onClick={() => navigateToOrderIntent("po")}>PO erstellen</Button>
          </Space>
        )}
      >
        {actionIntent ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text>
              <strong>{actionIntent.row.alias}</strong> ({actionIntent.row.sku}) · {formatMonthLabel(actionIntent.month)}
            </Text>
            <Text>
              Erwarteter Monatsendbestand: <strong>{formatInt(actionIntent.data.endAvailable)}</strong>
            </Text>
            <Text>
              Safety-Status: <Tag color={actionIntent.riskClass === "safety-negative" ? "red" : "gold"}>
                {actionIntent.riskClass === "safety-negative" ? "OOS" : "Unter Safety"}
              </Tag>
            </Text>
            <Text>
              Empfohlene Ankunft: <strong>{formatDate(actionIntent.requiredArrivalDate)}</strong>
            </Text>
            <Text>
              Empfohlener Bestelltermin: <strong>{formatDate(actionIntent.recommendedOrderDate)}</strong>
            </Text>
            <Text>
              Empfohlene Bestellmenge: <strong>{formatInt(actionIntent.recommendedUnits)}</strong>
            </Text>
            {Array.isArray(actionIntent.recommendation?.issues) && actionIntent.recommendation?.issues?.length ? (
              <Alert
                type="warning"
                showIcon
                message="Qualitätshinweise"
                description={(actionIntent.recommendation.issues as Record<string, unknown>[])
                  .map((issue) => `${String(issue.code || "ISSUE")} (${Number(issue.count || 0)})`)
                  .join(" · ")}
              />
            ) : null}
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
