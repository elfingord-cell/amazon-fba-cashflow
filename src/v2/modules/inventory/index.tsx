import { InfoCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
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
import { normalizeIncludeInForecast } from "../../../domain/portfolioBuckets.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import {
  addMonths,
  currentMonthKey,
  formatMonthEndLabel,
  formatMonthLabel,
  monthRange,
  normalizeMonthKey,
} from "../../domain/months";
import { buildCategoryOrderMap, compareCategoryLabels, sortCategoryGroups } from "../../domain/categoryOrder";
import { ensureForecastVersioningContainers, getActiveForecastLabel } from "../../domain/forecastVersioning";
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
import { useLocation, useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

type ProjectionMode = "units" | "doh" | "plan";
type InventoryView = "snapshot" | "projection" | "both";
type ProjectionRiskFilter = "all" | "oos" | "under_safety";
type ProjectionAbcFilter = "all" | "a" | "b" | "ab" | "abc";
const PROJECTION_HORIZON_OPTIONS = [6, 12, 18] as const;

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
  abcBasis: "revenue_6m" | "units_6m_fallback" | "no_data";
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
  cellKey: string;
  row: InventoryProductRow;
  month: string;
  data: ProjectionCellData;
  recommendedUnits: number;
  requiredArrivalDate: string | null;
  recommendedOrderDate: string | null;
  recommendation: Record<string, unknown> | null;
  recommendationStatus: string;
}

interface ProjectionRiskSummary {
  underSafetySkus: number;
  oosSkus: number;
  criticalMonth: string | null;
  missingEta: number;
}

interface MonthUrgencyData {
  month: string;
  score: number;
  oosCount: number;
  underSafetyCount: number;
  criticalSkus: Set<string>;
}

interface FoWorklistEntry {
  key: string;
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C" | null;
  month: string;
  riskClass: "safety-negative" | "safety-low";
  recommendedUnits: number;
  requiredArrivalDate: string | null;
  recommendedOrderDate: string | null;
  priority: number;
  intent: ProjectionActionIntent;
}

function normalizeForecastImpactSummary(value: unknown): {
  toVersionId: string | null;
  foConflictsOpen: number;
} {
  if (!value || typeof value !== "object") {
    return {
      toVersionId: null,
      foConflictsOpen: 0,
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    toVersionId: raw.toVersionId == null ? null : String(raw.toVersionId || "").trim() || null,
    foConflictsOpen: Math.max(0, Math.round(Number(raw.foConflictsOpen || 0))),
  };
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

function toCategoryGroups(
  rows: InventoryProductRow[],
  categoryOrderMap: Map<string, number>,
): CategoryGroup[] {
  const groups = new Map<string, InventoryProductRow[]>();
  rows.forEach((row) => {
    const key = row.categoryLabel || "Ohne Kategorie";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(row);
  });
  const mapped = Array.from(groups.entries())
    .map(([key, entries]) => ({
      key,
      label: key,
      rows: entries.sort((a, b) => {
        const aliasCmp = a.alias.localeCompare(b.alias, "de-DE", { sensitivity: "base" });
        if (aliasCmp !== 0) return aliasCmp;
        return a.sku.localeCompare(b.sku, "de-DE", { sensitivity: "base" });
      }),
    }));
  return sortCategoryGroups(mapped, categoryOrderMap);
}

function monthStartIso(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return `${month}-01`;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function estimateLeadTimeDays(product: Record<string, unknown> | null, settings: Record<string, unknown>): number {
  const production = parsePositiveNumber(product?.productionLeadTimeDaysDefault)
    ?? parsePositiveNumber(settings.defaultProductionLeadTimeDays)
    ?? 45;
  const productTemplate = (product?.template as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined;
  const transportMode = String(
    productTemplate?.transportMode
    ?? product?.transportMode
    ?? "sea",
  ).toLowerCase();
  const transportLeadTimes = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const transit = parsePositiveNumber(transportLeadTimes[transportMode])
    ?? parsePositiveNumber(transportLeadTimes.sea)
    ?? 45;
  const buffer = Number(settings.defaultBufferDays ?? 0);
  return Math.max(0, Math.round(production + transit + (Number.isFinite(buffer) ? buffer : 0)));
}

function projectionModeHint(mode: ProjectionMode): string {
  if (mode === "doh") return "DOH zeigt die Reichweite des projizierten Monatsendbestands in Tagen.";
  if (mode === "plan") return "Plan zeigt den geplanten Monatsabsatz (Forecast) je SKU.";
  return "Units zeigt den projizierten Monatsendbestand je SKU inklusive Inbound-Wirkung.";
}

function abcBasisHint(basis: InventoryProductRow["abcBasis"]): string {
  if (basis === "revenue_6m") return "ABC-Basis: Umsatz (6 Monate)";
  if (basis === "units_6m_fallback") return "ABC-Basis: Units-Fallback (6 Monate)";
  return "ABC-Basis: keine Forecast-Daten";
}

function monthRiskWeight(abcClass: string | null, riskClass: "" | "safety-negative" | "safety-low"): number {
  const abc = String(abcClass || "C").toUpperCase();
  if (riskClass === "safety-negative") {
    if (abc === "A") return 6;
    if (abc === "B") return 4;
    return 2;
  }
  if (riskClass === "safety-low") {
    if (abc === "A") return 3;
    if (abc === "B") return 2;
    return 1;
  }
  return 0;
}

function normalizeProjectionRiskFilter(value: unknown): ProjectionRiskFilter {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "oos") return "oos";
  if (raw === "under_safety") return "under_safety";
  return "all";
}

function normalizeProjectionAbcFilter(value: unknown): ProjectionAbcFilter {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "a") return "a";
  if (raw === "b") return "b";
  if (raw === "ab") return "ab";
  if (raw === "abc") return "abc";
  return "all";
}

function normalizeProjectionHorizon(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  const rounded = Math.round(parsed);
  if (PROJECTION_HORIZON_OPTIONS.includes(rounded as typeof PROJECTION_HORIZON_OPTIONS[number])) return rounded;
  if (rounded < 9) return 6;
  if (rounded < 15) return 12;
  return 18;
}

function normalizeProjectionMode(value: unknown): ProjectionMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "doh") return "doh";
  if (raw === "plan") return "plan";
  return "units";
}

function normalizeAbcClass(value: string | null | undefined): "A" | "B" | "C" | null {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "A" || raw === "B" || raw === "C") return raw;
  return null;
}

function abcPriority(value: string | null | undefined): number {
  const abc = normalizeAbcClass(value);
  if (abc === "A") return 0;
  if (abc === "B") return 1;
  if (abc === "C") return 2;
  return 3;
}

function matchesAbcFilter(abcClass: string | null, filter: ProjectionAbcFilter): boolean {
  if (filter === "all") return true;
  const normalized = normalizeAbcClass(abcClass);
  if (filter === "a") return normalized === "A";
  if (filter === "b") return normalized === "B";
  if (filter === "ab") return normalized === "A" || normalized === "B";
  return normalized != null;
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
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const hasStoredSnapshotPrefs = hasModuleExpandedCategoryKeys("inventory_snapshot");
  const hasStoredProjectionPrefs = hasModuleExpandedCategoryKeys("inventory_projection");
  const appliedDashboardQueryRef = useRef(false);

  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());
  const [selectedMonthTouched, setSelectedMonthTouched] = useState(false);
  const [snapshotDraft, setSnapshotDraft] = useState<SnapshotDraftMap>({});
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>("units");
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [riskFilter, setRiskFilter] = useState<ProjectionRiskFilter>("all");
  const [abcFilter, setAbcFilter] = useState<ProjectionAbcFilter>("all");
  const [projectionMonths, setProjectionMonths] = useState(12);
  const [snapshotExpandedCategories, setSnapshotExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("inventory_snapshot"));
  const [projectionExpandedCategories, setProjectionExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("inventory_projection"));
  const [selectedUrgencyMonth, setSelectedUrgencyMonth] = useState<string | null>(null);
  const [pendingUrgencyMonthFromQuery, setPendingUrgencyMonthFromQuery] = useState<string | null>(null);
  const [expandProjectionFromQuery, setExpandProjectionFromQuery] = useState(false);
  const [focusSkuFromQuery, setFocusSkuFromQuery] = useState<string | null>(null);
  const [focusSkuConsumed, setFocusSkuConsumed] = useState(false);
  const [highlightSku, setHighlightSku] = useState<string | null>(null);
  const [actionIntent, setActionIntent] = useState<ProjectionActionIntent | null>(null);

  const showSnapshot = view !== "projection";
  const showProjection = view !== "snapshot";

  const stateObject = state as unknown as Record<string, unknown>;
  const inventory = ((state.inventory || {}) as Record<string, unknown>);
  const inventorySettings = ((inventory.settings || {}) as Record<string, unknown>);
  const settings = (state.settings || {}) as Record<string, unknown>;
  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastVersioningSnapshot = useMemo(() => {
    const clone = structuredClone(forecast || {});
    ensureForecastVersioningContainers(clone as Record<string, unknown>);
    return clone as Record<string, unknown>;
  }, [forecast]);
  const activeForecastLabel = useMemo(
    () => getActiveForecastLabel(forecastVersioningSnapshot as Record<string, unknown>),
    [forecastVersioningSnapshot],
  );
  const forecastImpactSummary = normalizeForecastImpactSummary(forecastVersioningSnapshot.lastImpactSummary);
  const activeForecastVersionId = String(forecastVersioningSnapshot.activeVersionId || "").trim() || null;
  const openForecastFoConflicts = forecastImpactSummary.toVersionId
    && activeForecastVersionId
    && forecastImpactSummary.toVersionId === activeForecastVersionId
    ? forecastImpactSummary.foConflictsOpen
    : 0;

  useEffect(() => {
    if (appliedDashboardQueryRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get("source") !== "dashboard") return;
    appliedDashboardQueryRef.current = true;

    const sku = String(params.get("sku") || "").trim();
    if (sku) {
      setSearch(sku);
      setFocusSkuFromQuery(sku);
      setFocusSkuConsumed(false);
    } else {
      setFocusSkuFromQuery(null);
      setFocusSkuConsumed(true);
      setHighlightSku(null);
    }

    const month = normalizeMonthKey(params.get("month"));
    if (month) setPendingUrgencyMonthFromQuery(month);

    setRiskFilter(normalizeProjectionRiskFilter(params.get("risk")));
    setAbcFilter(normalizeProjectionAbcFilter(params.get("abc")));
    if (params.has("mode")) {
      setProjectionMode(normalizeProjectionMode(params.get("mode")));
    }
    if (params.get("expand") === "all") setExpandProjectionFromQuery(true);
  }, [location.search]);

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
      setProjectionMonths(normalizeProjectionHorizon(fromSettings));
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
  const categoryOrderMap = useMemo(() => buildCategoryOrderMap(stateObject), [state.productCategories]);

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
        const isActive = normalizeIncludeInForecast(product.includeInForecast, true)
          && (!status || status === "active" || status === "aktiv");
        const categoryLabel = categoriesById.get(String(product.categoryId || "")) || "Ohne Kategorie";
        const item = snapshotDraft[sku] || { amazonUnits: 0, threePLUnits: 0, note: "" };
        const prevItem = previousDraft[sku] || { amazonUnits: 0, threePLUnits: 0, note: "" };
        const totalUnits = item.amazonUnits + item.threePLUnits;
        const prevTotal = prevItem.amazonUnits + prevItem.threePLUnits;
        const safetyDays = resolveSafetyStockDays(product, stateObject);
        const coverageDays = resolveCoverageDays(product, stateObject);
        const abcEntry = abcBySku.get(sku.toLowerCase()) || abcBySku.get(sku) || null;
        const abcClass = abcEntry?.abcClass ?? null;
        const abcBasis = (abcEntry?.abcBasis || "no_data") as InventoryProductRow["abcBasis"];
        return {
          sku,
          alias,
          categoryLabel,
          abcClass,
          abcBasis,
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
        if (!matchesAbcFilter(row.abcClass, abcFilter)) return false;
        if (!needle) return true;
        return [row.sku, row.alias, row.categoryLabel, row.abcClass || ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        const byCategory = compareCategoryLabels(a.categoryLabel, b.categoryLabel, categoryOrderMap);
        if (byCategory !== 0) return byCategory;
        const byAlias = a.alias.localeCompare(b.alias, "de-DE", { sensitivity: "base" });
        if (byAlias !== 0) return byAlias;
        return a.sku.localeCompare(b.sku, "de-DE", { sensitivity: "base" });
      });
  }, [abcFilter, baseRows, categoryOrderMap, onlyActive, search]);

  const groupedRows = useMemo(
    () => toCategoryGroups(filteredRows, categoryOrderMap),
    [categoryOrderMap, filteredRows],
  );

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
    setModuleExpandedCategoryKeys("inventory_snapshot", snapshotExpandedCategories);
  }, [snapshotExpandedCategories]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("inventory_projection", projectionExpandedCategories);
  }, [projectionExpandedCategories]);

  const projectionBaseMonth = currentMonthKey();
  const projectionAnchorMonth = useMemo(() => addMonths(projectionBaseMonth, -1), [projectionBaseMonth]);
  const projectionMonthList = useMemo(
    () => monthRange(projectionBaseMonth, projectionMonths),
    [projectionBaseMonth, projectionMonths],
  );

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
    snapshot: null,
    snapshotMonth: projectionAnchorMonth,
    projectionMode,
  }), [filteredRows, projectionAnchorMonth, projectionMode, projectionMonthList, stateObject]);

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

  const urgencyByMonth = useMemo<Map<string, MonthUrgencyData>>(() => {
    const map = new Map<string, MonthUrgencyData>();
    projectionMonthList.forEach((month) => {
      map.set(month, {
        month,
        score: 0,
        oosCount: 0,
        underSafetyCount: 0,
        criticalSkus: new Set<string>(),
      });
    });

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
        }) as "" | "safety-negative" | "safety-low";
        if (!riskClass) return;
        const bucket = map.get(month);
        if (!bucket) return;
        bucket.score += monthRiskWeight(row.abcClass, riskClass);
        bucket.underSafetyCount += 1;
        if (riskClass === "safety-negative") bucket.oosCount += 1;
        bucket.criticalSkus.add(row.sku);
      });
    });
    return map;
  }, [filteredRows, projection, projectionMode, projectionMonthList]);

  const maxUrgencyScore = useMemo(() => {
    const values = Array.from(urgencyByMonth.values()).map((entry) => Number(entry.score || 0));
    if (!values.length) return 0;
    return Math.max(...values, 0);
  }, [urgencyByMonth]);

  const riskBySku = useMemo(() => {
    const map = new Map<string, { hasOos: boolean; hasUnderSafety: boolean }>();
    filteredRows.forEach((row) => {
      let hasOos = false;
      let hasUnderSafety = false;
      projectionMonthList.forEach((month) => {
        const data = projection.perSkuMonth.get(row.sku)?.get(month) as ProjectionCellData | undefined;
        if (!data) return;
        const riskClass = getProjectionSafetyClass({
          projectionMode,
          endAvailable: data.endAvailable,
          safetyUnits: data.safetyUnits,
          doh: data.doh,
          safetyDays: data.safetyDays,
        }) as "" | "safety-negative" | "safety-low";
        if (!riskClass) return;
        hasUnderSafety = true;
        if (riskClass === "safety-negative") hasOos = true;
      });
      map.set(row.sku, { hasOos, hasUnderSafety });
    });
    return map;
  }, [filteredRows, projection, projectionMode, projectionMonthList]);

  const projectionRows = useMemo(() => {
    if (riskFilter === "all") return filteredRows;
    return filteredRows.filter((row) => {
      const flags = riskBySku.get(row.sku);
      if (!flags) return false;
      if (riskFilter === "oos") return flags.hasOos;
      return flags.hasUnderSafety;
    });
  }, [filteredRows, riskBySku, riskFilter]);

  const projectionBaseGroups = useMemo(
    () => toCategoryGroups(projectionRows, categoryOrderMap),
    [categoryOrderMap, projectionRows],
  );

  const projectionCriticalSkuSet = useMemo(() => {
    if (!selectedUrgencyMonth) return null;
    return urgencyByMonth.get(selectedUrgencyMonth)?.criticalSkus || new Set<string>();
  }, [selectedUrgencyMonth, urgencyByMonth]);

  const projectionGroupedRows = useMemo(() => {
    if (!selectedUrgencyMonth || !projectionCriticalSkuSet || !projectionCriticalSkuSet.size) return projectionBaseGroups;
    return projectionBaseGroups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => projectionCriticalSkuSet.has(row.sku)),
      }))
      .filter((group) => group.rows.length > 0);
  }, [projectionBaseGroups, projectionCriticalSkuSet, selectedUrgencyMonth]);

  function buildProjectionFoIntent(
    row: InventoryProductRow,
    month: string,
    data: ProjectionCellData,
    cellKey: string,
  ): ProjectionActionIntent {
    const product = resolveProductBySku(Array.isArray(state.products) ? (state.products as Record<string, unknown>[]) : [], row.sku);
    const leadTimeDays = estimateLeadTimeDays(product, settings);
    const recommendation = computeFoRecommendationForSku({
      context: recommendationContext,
      sku: row.sku,
      leadTimeDays,
      product,
      settings,
      horizonMonths: Math.max(6, projectionMonths),
      requiredArrivalMonth: month,
    }) as Record<string, unknown> | null;

    const recommendationStatus = String(recommendation?.status || "");
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

    return {
      cellKey,
      row,
      month,
      data,
      recommendedUnits,
      requiredArrivalDate,
      recommendedOrderDate,
      recommendation,
      recommendationStatus,
    };
  }

  const firstRiskFoIntentByCellKey = useMemo(() => {
    if (projectionMode === "plan") return new Map<string, ProjectionActionIntent>();
    const map = new Map<string, ProjectionActionIntent>();
    projectionRows.forEach((row) => {
      let firstRiskMonth: string | null = null;
      for (const month of projectionMonthList) {
        const data = projection.perSkuMonth.get(row.sku)?.get(month) as ProjectionCellData | undefined;
        if (!data) continue;
        const riskClass = getProjectionSafetyClass({
          projectionMode,
          endAvailable: data.endAvailable,
          safetyUnits: data.safetyUnits,
          doh: data.doh,
          safetyDays: data.safetyDays,
        });
        if (riskClass === "safety-negative" || riskClass === "safety-low") {
          firstRiskMonth = month;
          break;
        }
      }
      if (!firstRiskMonth) return;
      const data = projection.perSkuMonth.get(row.sku)?.get(firstRiskMonth) as ProjectionCellData | undefined;
      if (!data) return;
      const cellKey = `${row.sku}|${firstRiskMonth}`;
      const intent = buildProjectionFoIntent(row, firstRiskMonth, data, cellKey);
      if (intent.recommendationStatus !== "ok" || intent.recommendedUnits <= 0) return;
      map.set(cellKey, intent);
    });
    return map;
  }, [projection, projectionMode, projectionMonthList, projectionRows, projectionMonths, recommendationContext, settings, state.products]);

  const foWorklist = useMemo<FoWorklistEntry[]>(() => {
    const entries = Array.from(firstRiskFoIntentByCellKey.values())
      .map((intent) => {
        const riskClass = getProjectionSafetyClass({
          projectionMode,
          endAvailable: intent.data.endAvailable,
          safetyUnits: intent.data.safetyUnits,
          doh: intent.data.doh,
          safetyDays: intent.data.safetyDays,
        }) as "" | "safety-negative" | "safety-low";
        if (riskClass !== "safety-negative" && riskClass !== "safety-low") return null;
        const abcClass = normalizeAbcClass(intent.row.abcClass);
        const month = intent.month;
        const monthRank = Number(String(month || "").replace("-", ""));
        const riskBoost = riskClass === "safety-negative" ? -0.5 : 0;
        const priority = (abcPriority(abcClass) * 1000) + (Number.isFinite(monthRank) ? monthRank : 999999) + riskBoost;
        return {
          key: `${intent.row.sku}|${intent.month}`,
          sku: intent.row.sku,
          alias: intent.row.alias,
          abcClass,
          month,
          riskClass,
          recommendedUnits: intent.recommendedUnits,
          requiredArrivalDate: intent.requiredArrivalDate,
          recommendedOrderDate: intent.recommendedOrderDate,
          priority,
          intent,
        } satisfies FoWorklistEntry;
      })
      .filter(Boolean) as FoWorklistEntry[];

    entries.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.month !== right.month) return left.month.localeCompare(right.month);
      const byUnits = Number(right.recommendedUnits || 0) - Number(left.recommendedUnits || 0);
      if (byUnits !== 0) return byUnits;
      return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
    });
    return entries;
  }, [firstRiskFoIntentByCellKey, projectionMode]);

  useEffect(() => {
    if (selectedUrgencyMonth && !projectionMonthList.includes(selectedUrgencyMonth)) {
      setSelectedUrgencyMonth(null);
    }
  }, [projectionMonthList, selectedUrgencyMonth]);

  useEffect(() => {
    if (!pendingUrgencyMonthFromQuery) return;
    if (!projectionMonthList.length) return;
    if (projectionMonthList.includes(pendingUrgencyMonthFromQuery)) {
      setSelectedUrgencyMonth(pendingUrgencyMonthFromQuery);
    }
    setPendingUrgencyMonthFromQuery(null);
  }, [pendingUrgencyMonthFromQuery, projectionMonthList]);

  useEffect(() => {
    if (!showProjection) return;
    setProjectionExpandedCategories((current) => {
      if (!projectionGroupedRows.length) return [];
      const valid = new Set(projectionGroupedRows.map((group) => group.key));
      const filtered = current.filter((key) => valid.has(key));
      if (filtered.length || hasStoredProjectionPrefs) return filtered;
      return projectionGroupedRows.map((group) => group.key);
    });
  }, [hasStoredProjectionPrefs, projectionGroupedRows, showProjection]);

  useEffect(() => {
    if (!showProjection || !expandProjectionFromQuery) return;
    if (!projectionGroupedRows.length) return;
    setProjectionExpandedCategories(projectionGroupedRows.map((group) => group.key));
    setExpandProjectionFromQuery(false);
  }, [expandProjectionFromQuery, projectionGroupedRows, showProjection]);

  useEffect(() => {
    if (!showProjection || !focusSkuFromQuery || focusSkuConsumed) return;
    const anchorId = `v2-proj-sku-${encodeURIComponent(focusSkuFromQuery)}`;
    const skuKey = focusSkuFromQuery.toLowerCase();
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-proj-sku-key]"))
      .find((entry) => String(entry.dataset.projSkuKey || "") === skuKey)
      || document.getElementById(anchorId);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightSku(focusSkuFromQuery);
    setFocusSkuConsumed(true);
    const timer = window.setTimeout(() => {
      setHighlightSku((current) => {
        if (!current) return current;
        return current.toLowerCase() === focusSkuFromQuery.toLowerCase() ? null : current;
      });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [focusSkuConsumed, focusSkuFromQuery, projectionGroupedRows, showProjection]);

  function openProjectionAction(
    row: InventoryProductRow,
    month: string,
    data: ProjectionCellData,
    cellKey: string,
  ): void {
    setActionIntent(buildProjectionFoIntent(row, month, data, cellKey));
  }

  function navigateToFoIntent(
    intent: ProjectionActionIntent | null,
    options?: { nextIntent?: ProjectionActionIntent | null },
  ): void {
    if (!intent) return;
    const params = new URLSearchParams();
    params.set("source", "inventory_projection");
    params.set("sku", intent.row.sku);
    params.set("month", intent.month);
    params.set("suggestedUnits", String(intent.recommendedUnits || 0));
    params.set("projectedEnd", String(Math.round(Number(intent.data.endAvailable || 0))));
    params.set("mode", projectionMode);
    if (intent.requiredArrivalDate) {
      params.set("requiredArrivalDate", intent.requiredArrivalDate);
    }
    if (intent.recommendedOrderDate) {
      params.set("recommendedOrderDate", intent.recommendedOrderDate);
    }
    params.set("returnTo", "/v2/inventory/projektion");
    const nextIntent = options?.nextIntent || null;
    if (nextIntent) {
      params.set("nextSku", nextIntent.row.sku);
      params.set("nextMonth", nextIntent.month);
      params.set("nextSuggestedUnits", String(nextIntent.recommendedUnits || 0));
      if (nextIntent.requiredArrivalDate) {
        params.set("nextRequiredArrivalDate", nextIntent.requiredArrivalDate);
      }
      if (nextIntent.recommendedOrderDate) {
        params.set("nextRecommendedOrderDate", nextIntent.recommendedOrderDate);
      }
    }
    navigate(`/v2/orders/fo?${params.toString()}`);
    setActionIntent(null);
  }

  function renderProjectionActionMenu(intent: ProjectionActionIntent): JSX.Element {
    return (
      <div className="v2-proj-action-menu">
        <Text strong>{intent.row.alias}</Text>
        <Text type="secondary">{intent.row.sku}</Text>
        <Text type="secondary">{formatMonthLabel(intent.month)}</Text>
        <Text>
          Bestand EOM: <strong>{formatInt(intent.data.endAvailable)}</strong>
        </Text>
        <Text>
          Safety: <strong>{formatInt(intent.data.safetyUnits)}</strong>
        </Text>
        <Text>
          Ankunft: <strong>{formatDate(intent.requiredArrivalDate)}</strong>
        </Text>
        <Text>
          Bestellen bis: <strong>{formatDate(intent.recommendedOrderDate)}</strong>
        </Text>
        <Text>
          Vorschlag: <strong>{formatInt(intent.recommendedUnits)}</strong>
        </Text>
        {intent.recommendationStatus !== "ok" ? (
          <Text type="warning">Hinweis: Empfehlung ist nicht vollständig belastbar.</Text>
        ) : null}
        {Number(intent.recommendation?.coverageDaysForOrder || 0) > 0 ? (
          <Text type="secondary">
            Bedarf ({formatInt(Number(intent.recommendation?.coverageDaysForOrder || 0))} Tage): {formatInt(Number(intent.recommendation?.coverageDemandUnits || 0))}
          </Text>
        ) : null}
        {intent.recommendation?.moqApplied ? (
          <Text type="warning">
            MOQ angewendet: kalkulatorisch {formatInt(Number(intent.recommendation?.recommendedUnitsRaw || 0))} → MOQ {formatInt(Number(intent.recommendation?.recommendedUnits || 0))}
          </Text>
        ) : null}
        <div className="v2-actions-inline">
          <Button size="small" type="primary" onClick={() => navigateToFoIntent(intent)}>FO erstellen</Button>
        </div>
      </div>
    );
  }

  const snapshotColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => [
    {
      header: "Alias",
      accessorKey: "alias",
      meta: { width: 270, minWidth: 250 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    {
      header: "ABC",
      accessorKey: "abcClass",
      meta: { width: 72, align: "center" },
      cell: ({ row }) => (
        <Tooltip title={abcBasisHint(row.original.abcBasis)}>
          <span>{row.original.abcClass || "—"}</span>
        </Tooltip>
      ),
    },
    {
      header: "Amazon",
      accessorKey: "amazonUnits",
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
      accessorKey: "threePLUnits",
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
      accessorKey: "totalUnits",
      meta: { width: 92, align: "right" },
      cell: ({ row }) => formatInt(row.original.totalUnits),
    },
    {
      header: "Delta",
      accessorKey: "delta",
      meta: { width: 92, align: "right" },
      cell: ({ row }) => (
        <span className={row.original.delta < 0 ? "v2-negative" : ""}>
          {formatInt(row.original.delta)}
        </span>
      ),
    },
    {
      header: "Safety DOH",
      accessorKey: "safetyDays",
      meta: { width: 96, align: "right" },
      cell: ({ row }) => formatInt(row.original.safetyDays),
    },
    {
      header: "Coverage DOH",
      accessorKey: "coverageDays",
      meta: { width: 108, align: "right" },
      cell: ({ row }) => formatInt(row.original.coverageDays),
    },
  ], []);

  const anchorForecastGapSkus = Array.isArray(projection.anchorForecastGapSkus)
    ? projection.anchorForecastGapSkus as string[]
    : [];
  const anchorSkuFallbackSkus = Array.isArray(projection.anchorSkuFallbackSkus)
    ? projection.anchorSkuFallbackSkus as string[]
    : [];
  const anchorSkuMissingHistory = Array.isArray(projection.anchorSkuMissingHistory)
    ? projection.anchorSkuMissingHistory as string[]
    : [];
  const anchorSkuFallbackSet = useMemo(
    () => new Set(anchorSkuFallbackSkus.map((sku) => String(sku || "").trim())),
    [anchorSkuFallbackSkus],
  );
  const anchorMissingHistorySet = useMemo(
    () => new Set(anchorSkuMissingHistory.map((sku) => String(sku || "").trim())),
    [anchorSkuMissingHistory],
  );

  const projectionColumns = useMemo<ColumnDef<InventoryProductRow>[]>(() => {
    const base: ColumnDef<InventoryProductRow>[] = [
      {
        header: "Alias",
        accessorKey: "alias",
        meta: { width: 270, minWidth: 250 },
        cell: ({ row }) => (
          <div
            id={`v2-proj-sku-${encodeURIComponent(row.original.sku)}`}
            data-proj-sku-key={row.original.sku.toLowerCase()}
            className={[
              "v2-proj-alias",
              highlightSku && row.original.sku.toLowerCase() === highlightSku.toLowerCase()
                ? "v2-proj-alias--highlight"
                : "",
            ].filter(Boolean).join(" ")}
          >
            <div className="v2-proj-alias-main" title={row.original.alias}>{row.original.alias}</div>
            <Text className="v2-proj-sku-secondary" type="secondary" title={row.original.sku}>
              {row.original.sku}
            </Text>
          </div>
        ),
      },
      {
        header: "ABC",
        accessorKey: "abcClass",
        meta: { width: 68, align: "center" },
        cell: ({ row }) => (
          <Tooltip title={abcBasisHint(row.original.abcBasis)}>
            <span>{row.original.abcClass || "—"}</span>
          </Tooltip>
        ),
      },
      {
        header: "Safety DOH",
        accessorKey: "safetyDays",
        meta: { width: 96, align: "right" },
        cell: ({ row }) => formatInt(row.original.safetyDays),
      },
      {
        header: "Coverage DOH",
        accessorKey: "coverageDays",
        meta: { width: 110, align: "right" },
        cell: ({ row }) => formatInt(row.original.coverageDays),
      },
      {
        header: "Ankerbestand",
        meta: {
          width: 118,
          align: "right",
          sortAccessor: (row: InventoryProductRow) => {
            const sku = String(row.sku || "").trim();
            const anchor = projection.startAvailableBySku.get(sku);
            return Number.isFinite(anchor as number) ? Number(anchor) : 0;
          },
        },
        cell: ({ row }) => {
          const sku = String(row.original.sku || "").trim();
          const anchor = projection.startAvailableBySku.get(sku);
          const isSkuFallback = anchorSkuFallbackSet.has(sku);
          const isMissingHistory = anchorMissingHistorySet.has(sku);
          const source = projection.anchorSourceBySku?.get?.(sku) || null;
          const sourceMonth = source?.month ? formatMonthEndLabel(String(source.month), "long") : "—";
          const title = isMissingHistory
            ? "Keine Snapshot-Historie für diese SKU. Startwert = 0."
            : (isSkuFallback
              ? `SKU-Fallback: letzter verfügbarer Snapshot (${sourceMonth}).`
              : `Anchor-Snapshot (${sourceMonth}).`);
          return (
            <Tooltip title={title}>
              <span>{formatInt(Number.isFinite(anchor as number) ? Number(anchor) : 0)}</span>
            </Tooltip>
          );
        },
      },
    ];

    const monthColumns = projectionMonthList.map((month) => ({
      id: month,
      header: formatMonthLabel(month),
      meta: {
        minWidth: 106,
        width: 106,
        align: "right",
        sortAccessor: (row: InventoryProductRow) => {
          const data = projection.perSkuMonth.get(row.sku)?.get(month) as ProjectionCellData | undefined;
          if (!data) return null;
          if (projectionMode === "plan") {
            return Number.isFinite(data.forecastUnits as number) ? Number(data.forecastUnits) : null;
          }
          if (projectionMode === "doh") {
            return Number.isFinite(data.doh as number) ? Number(data.doh) : null;
          }
          return Number.isFinite(data.endAvailable as number) ? Number(data.endAvailable) : null;
        },
      },
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

        const riskClassRaw = getProjectionSafetyClass({
          projectionMode,
          endAvailable: data.endAvailable,
          safetyUnits: data.safetyUnits,
          doh: data.doh,
          safetyDays: data.safetyDays,
        }) as "" | "safety-negative" | "safety-low";

        const isActionable = projectionMode !== "plan";
        const inbound = data.inboundDetails;
        const cellKey = `${row.original.sku}|${month}`;
        const foBadgeIntent = firstRiskFoIntentByCellKey.get(cellKey) || null;

        const isMenuOpen = actionIntent?.cellKey === cellKey;
        return (
          <Popover
            trigger={isActionable ? "click" : "hover"}
            placement="rightTop"
            open={isActionable ? isMenuOpen : undefined}
            onOpenChange={(open) => {
              if (!isActionable) return;
              if (!open && isMenuOpen) setActionIntent(null);
            }}
            content={isMenuOpen && actionIntent ? renderProjectionActionMenu(actionIntent) : null}
          >
            <div
              className={[
                "v2-proj-cell",
                riskClassRaw ? `v2-proj-cell--${riskClassRaw}` : "",
                isActionable ? "v2-proj-cell--actionable" : "",
              ].filter(Boolean).join(" ")}
              role={isActionable ? "button" : undefined}
              tabIndex={isActionable ? 0 : undefined}
              onClick={isActionable ? () => openProjectionAction(row.original, month, data, cellKey) : undefined}
              onKeyDown={isActionable ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openProjectionAction(row.original, month, data, cellKey);
                }
              } : undefined}
            >
              <div className="v2-proj-cell-main">{formatInt(value)}</div>
              {projectionMode !== "plan" && Number.isFinite(data.safetyUnits as number) ? (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  SB: {formatInt(data.safetyUnits)}
                </Text>
              ) : null}
              {foBadgeIntent ? (
                <button
                  type="button"
                  className="v2-proj-fo-badge"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigateToFoIntent(foBadgeIntent);
                  }}
                >
                  FO empfohlen
                </button>
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
          </Popover>
        );
      },
    })) as ColumnDef<InventoryProductRow>[];

    return [...base, ...monthColumns];
  }, [
    actionIntent,
    anchorMissingHistorySet,
    anchorSkuFallbackSet,
    firstRiskFoIntentByCellKey,
    highlightSku,
    projection,
    projectionMode,
    projectionMonthList,
  ]);

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
        projectionMonths: normalizeProjectionHorizon(projectionMonths),
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
  const anchorMode = String(projection.anchorMode || "no_snapshot");
  const anchorTargetMonth = normalizeMonthKey(projection.anchorTargetMonth || projection.anchorMonth);
  const projectionTodayMonth = projectionBaseMonth;
  const anchorLabel = anchorMode === "rollforward"
    ? `Anker: ${projection.anchorSourceMonth || "—"} Snapshot → Rollforward bis ${anchorTargetMonth || "—"}`
    : anchorMode === "snapshot"
      ? `Anker: Snapshot ${anchorTargetMonth || projection.anchorSourceMonth || "—"}`
      : "Anker: kein Snapshot (Start bei 0)";

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
            {showSnapshot ? (
              <Select
                value={selectedMonth}
                onChange={(value) => {
                  setSelectedMonth(value);
                  setSelectedMonthTouched(true);
                }}
                options={monthOptions.map((month) => ({
                  value: month,
                  label: `${month} · ${formatMonthEndLabel(month, "long")}`,
                }))}
                style={{ width: 260, maxWidth: "100%" }}
              />
            ) : null}
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
                <Select
                  value={projectionMonths}
                  onChange={(value) => setProjectionMonths(normalizeProjectionHorizon(value))}
                  style={{ width: 160, maxWidth: "100%" }}
                  options={PROJECTION_HORIZON_OPTIONS.map((months) => ({
                    value: months,
                    label: `Horizont ${months} Monate`,
                  }))}
                />
              </>
            ) : null}
            <Tag color="blue">Baseline Forecast: {activeForecastLabel}</Tag>
            {openForecastFoConflicts > 0 ? (
              <Button size="small" onClick={() => navigate("/v2/forecast?panel=conflicts")}>
                Forecast-Änderung: {openForecastFoConflicts} FOs prüfen
              </Button>
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
              <Tag color="blue">{formatMonthEndLabel(selectedMonth, "long")}</Tag>
              {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}
      {openForecastFoConflicts > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`Forecast-Änderung: ${openForecastFoConflicts} FOs prüfen`}
          description={(
            <Button size="small" onClick={() => navigate("/v2/forecast?panel=conflicts")}>
              Zur Konfliktliste
            </Button>
          )}
        />
      ) : null}

      {showSnapshot ? (
        <Card>
          <Title level={4}>Snapshot zum Stichtag {formatMonthEndLabel(selectedMonth, "long")}</Title>
          <Text type="secondary">Monatsschlüssel: {selectedMonth}</Text>
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
                    minTableWidth={1000}
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
          <div className="v2-proj-cluster-grid">
            <div className="v2-proj-context-cluster">
              <div className="v2-toolbar-row">
                <Tag color="blue">Heute: {formatMonthEndLabel(projectionTodayMonth, "long")}</Tag>
                <Tag color={anchorMode === "no_snapshot" ? "red" : "blue"}>{anchorLabel}</Tag>
                <Tag color="default">
                  Zeitraum: {projectionMonthList[0] || "—"} bis {projectionMonthList[projectionMonthList.length - 1] || "—"}
                </Tag>
                <Tag color="default">Horizont: {projectionMonths} Monate</Tag>
              </div>
              <div className="v2-toolbar-row">
                {projection.snapshotFallbackUsed ? (
                  <Tag color="gold">Fallback auf letzten Snapshot ≤ Ankermonat</Tag>
                ) : null}
                {projection.resolvedSnapshotMonth ? (
                  <Tag color="blue">Stichtag Anchor: {formatMonthEndLabel(String(projection.resolvedSnapshotMonth || anchorTargetMonth || ""), "long")}</Tag>
                ) : null}
                {Number(projection.anchorSkuFallbackCount || 0) > 0 ? (
                  <Tag color="gold">SKU-Fallback aktiv: {Number(projection.anchorSkuFallbackCount || 0)}</Tag>
                ) : null}
                {riskSummary.missingEta > 0 ? (
                  <Tag color="orange">Fehlende ETA: {riskSummary.missingEta}</Tag>
                ) : (
                  <Tag color="green">Fehlende ETA: 0</Tag>
                )}
                <Tooltip title="Units = projizierter Monatsendbestand · DOH = Reichweite in Tagen · Plan = Forecast-Absatz · Safety = Vergleich gegen Safety-Schwelle je SKU/Monat">
                  <Tag color="default">Modus-Hilfe</Tag>
                </Tooltip>
              </div>
              {anchorForecastGapSkus.length > 0 ? (
                <Alert
                  className="v2-proj-anchor-warning"
                  type="warning"
                  showIcon
                  message={`Anker-Rollforward mit Forecast-Lücken bei ${anchorForecastGapSkus.length} SKU(s) – diese Monate wurden mit 0 Units gerechnet.`}
                />
              ) : null}
            </div>

            <div className="v2-proj-filter-cluster">
              <Text type="secondary">Risiko-Filter</Text>
              <div className="v2-toolbar-row v2-proj-filter-row">
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${riskFilter === "all" ? "is-active" : ""}`}
                  onClick={() => setRiskFilter("all")}
                >
                  Alle Risiken
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn v2-proj-filter-btn--negative ${riskFilter === "oos" ? "is-active" : ""}`}
                  onClick={() => setRiskFilter("oos")}
                >
                  OOS / {"<="} 0
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn v2-proj-filter-btn--low ${riskFilter === "under_safety" ? "is-active" : ""}`}
                  onClick={() => setRiskFilter("under_safety")}
                >
                  Unter Safety
                </button>
              </div>
            </div>

            <div className="v2-proj-filter-cluster">
              <Text type="secondary">ABC-Filter</Text>
              <div className="v2-toolbar-row v2-proj-filter-row">
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${abcFilter === "all" ? "is-active" : ""}`}
                  onClick={() => setAbcFilter("all")}
                >
                  Alle
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${abcFilter === "a" ? "is-active" : ""}`}
                  onClick={() => setAbcFilter("a")}
                >
                  A
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${abcFilter === "b" ? "is-active" : ""}`}
                  onClick={() => setAbcFilter("b")}
                >
                  B
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${abcFilter === "ab" ? "is-active" : ""}`}
                  onClick={() => setAbcFilter("ab")}
                >
                  A+B
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${abcFilter === "abc" ? "is-active" : ""}`}
                  onClick={() => setAbcFilter("abc")}
                >
                  ABC
                </button>
              </div>
            </div>
          </div>

          <div className="v2-proj-score-strip">
            <div className="v2-toolbar-row">
              <Tag color={riskSummary.underSafetySkus > 0 ? "gold" : "green"}>
                SKUs unter Safety: {riskSummary.underSafetySkus}
              </Tag>
              <Tag color={riskSummary.oosSkus > 0 ? "red" : "green"}>
                OOS: {riskSummary.oosSkus}
              </Tag>
              <Tag color="blue">
                Kritischster Monat: {riskSummary.criticalMonth ? formatMonthLabel(riskSummary.criticalMonth) : "—"}
              </Tag>
            </div>
            <div className="v2-proj-heatmap">
              {projectionMonthList.map((month) => {
                const urgency = urgencyByMonth.get(month);
                const score = Number(urgency?.score || 0);
                const intensity = maxUrgencyScore > 0 ? Math.min(1, score / maxUrgencyScore) : 0;
                const isActive = selectedUrgencyMonth === month;
                return (
                  <button
                    type="button"
                    key={month}
                    className={`v2-proj-heatmap-item${isActive ? " is-active" : ""}`}
                    style={{
                      background: `rgba(220, 38, 38, ${0.08 + (intensity * 0.3)})`,
                      borderColor: isActive ? "rgba(220, 38, 38, 0.8)" : "rgba(15, 27, 45, 0.12)",
                    }}
                    onClick={() => setSelectedUrgencyMonth((current) => (current === month ? null : month))}
                    title={`${formatMonthLabel(month)} · ABC-gewichteter Risikoscore ${score} · OOS ${Number(urgency?.oosCount || 0)} · Unter Safety ${Number(urgency?.underSafetyCount || 0)}`}
                  >
                    <span>{formatMonthLabel(month)}</span>
                    <strong>Score {score}</strong>
                  </button>
                );
              })}
              {selectedUrgencyMonth ? (
                <Button size="small" onClick={() => setSelectedUrgencyMonth(null)}>
                  Filter löschen
                </Button>
              ) : null}
            </div>
            <div className="v2-toolbar-row">
              <Tag className="v2-proj-legend v2-proj-legend--negative">Rot = OOS / {"<="} 0</Tag>
              <Tag className="v2-proj-legend v2-proj-legend--low">Orange = Unter Safety</Tag>
              <Tag className="v2-proj-legend">Inbound Marker: PO / FO</Tag>
              <Text type="secondary">`FO empfohlen` im ersten Risikomonat anklicken oder Zelle öffnen für FO-Anlage.</Text>
            </div>
          </div>

          <div className="v2-proj-worklist">
            <div className="v2-proj-worklist-head">
              <Space wrap>
                <Text strong>FO-Arbeitsliste</Text>
                <Tag color={foWorklist.length ? "gold" : "green"}>
                  {foWorklist.length} SKU(s)
                </Tag>
                <Tag color="blue">Sortierung: A/B zuerst, frühester Risikomonat</Tag>
              </Space>
              {foWorklist.length ? (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => navigateToFoIntent(foWorklist[0]?.intent || null, { nextIntent: foWorklist[1]?.intent || null })}
                >
                  Erste SKU öffnen
                </Button>
              ) : null}
            </div>

            {!foWorklist.length ? (
              <Text type="secondary">Keine FO-Empfehlungen im aktuellen Filterumfang.</Text>
            ) : (
              <div className="v2-table-shell v2-scroll-host">
                <table className="v2-stats-table" data-layout="auto">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>ABC</th>
                      <th>Risikomonat</th>
                      <th>Risiko</th>
                      <th>Empfohlen</th>
                      <th>ETA-Ziel</th>
                      <th>Bestellen bis</th>
                      <th>Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foWorklist.map((entry, index) => {
                      const nextIntent = foWorklist[index + 1]?.intent || null;
                      return (
                        <tr key={entry.key}>
                          <td>
                            <div className="v2-proj-alias">
                              <Text className="v2-proj-alias-main">{entry.alias || entry.sku}</Text>
                              <Text className="v2-proj-sku-secondary" type="secondary">{entry.sku}</Text>
                            </div>
                          </td>
                          <td>{entry.abcClass || "—"}</td>
                          <td>{formatMonthLabel(entry.month)}</td>
                          <td>
                            {entry.riskClass === "safety-negative"
                              ? <Tag color="red">OOS / ≤ 0</Tag>
                              : <Tag color="gold">Unter Safety</Tag>}
                          </td>
                          <td>{formatInt(entry.recommendedUnits)}</td>
                          <td>{formatDate(entry.requiredArrivalDate)}</td>
                          <td>{formatDate(entry.recommendedOrderDate)}</td>
                          <td>
                            <Button size="small" type="primary" onClick={() => navigateToFoIntent(entry.intent, { nextIntent })}>
                              FO öffnen
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="v2-category-tools" style={{ marginTop: 10 }}>
            <Text type="secondary">
              {selectedUrgencyMonth
                ? `${projectionGroupedRows.reduce((sum, group) => sum + group.rows.length, 0)} kritische Produkte in ${projectionGroupedRows.length} Kategorien (${formatMonthLabel(selectedUrgencyMonth)})`
                : `${projectionRows.length} Produkte in ${projectionBaseGroups.length} Kategorien`}
            </Text>
            <div className="v2-actions-inline">
              <Button
                size="small"
                onClick={() => setProjectionExpandedCategories(projectionGroupedRows.map((group) => group.key))}
                disabled={!projectionGroupedRows.length}
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

          {!projectionGroupedRows.length ? (
            <Text type="secondary">Keine Projektion für den aktuellen Filter.</Text>
          ) : (
            <Collapse
              className="v2-category-collapse"
              activeKey={projectionExpandedCategories}
              onChange={(nextKeys) => setProjectionExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
              items={projectionGroupedRows.map((group) => ({
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
                    crosshair="matrix"
                  />
                ),
              }))}
            />
          )}
        </Card>
      ) : null}

    </div>
  );
}
