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
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocation, useNavigate } from "react-router-dom";
import { parseDeNumber } from "../../../lib/dataHealth.js";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { CASH_IN_QUOTE_MAX_PCT, CASH_IN_QUOTE_MIN_PCT, clampPct, parsePayoutPctInput } from "../../../domain/cashInRules.js";
import { parseVentoryCsv } from "../../../ui/forecastCsv.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { buildCategoryOrderMap, sortCategoryGroups } from "../../domain/categoryOrder";
import { computeForecastDriftSummary } from "../../domain/forecastDrift";
import { computeForecastImpact, type FoImpactConflictRow, type ForecastImpactResult, type ForecastSkuImpactRow } from "../../domain/forecastImpact";
import {
  appendForecastVersion,
  buildForecastVersionName,
  createForecastVersion,
  deleteForecastVersion,
  ensureForecastVersioningContainers,
  getActiveForecastLabel,
  getActiveForecastVersion,
  normalizeForecastImportMap,
  renameForecastVersion,
  setActiveVersion,
  type ForecastVersionRecord,
} from "../../domain/forecastVersioning";
import { currentMonthKey, formatMonthLabel, normalizeMonthKey } from "../../domain/months";
import { computeFoSchedule, suggestNextFoNumber } from "../../domain/orderUtils";
import {
  type ForecastRecord,
  type ForecastViewMode,
  type ManualMap,
  type ForecastProductRow as ProductRow,
  buildCategoryLabelMap,
  buildForecastMonths,
  buildForecastProducts,
  buildForecastRevenueByMonth,
  deriveForecastValue,
  filterForecastProducts,
  getEffectiveUnits,
  getImportValue,
  isForecastProductActive,
  normalizeManualMap,
  serializeManualMap,
} from "../../domain/tableModels";
import { ensureAppStateV2 } from "../../state/appState";
import {
  getModuleExpandedCategoryKeys,
  hasModuleExpandedCategoryKeys,
  setModuleExpandedCategoryKeys,
} from "../../state/uiPrefs";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type ForecastRangeMode = "next6" | "next12" | "next18" | "all";
type ForecastPanel = "grid" | "versions" | "impact";

const RANGE_OPTIONS: Array<{ value: ForecastRangeMode; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6", count: 6 },
  { value: "next12", label: "Nächste 12", count: 12 },
  { value: "next18", label: "Nächste 18", count: 18 },
  { value: "all", label: "Alle", count: null },
];

interface ForecastImpactSummaryMeta {
  comparedAt: string;
  fromVersionId: string | null;
  fromVersionName: string | null;
  toVersionId: string | null;
  toVersionName: string | null;
  flaggedSkus: number;
  flaggedAB: number;
  foConflictsTotal: number;
  foConflictsOpen: number;
}

interface ForecastImpactSkuRow extends ForecastSkuImpactRow {
  categoryLabel: string;
}

interface ForecastFoConflictRow extends FoImpactConflictRow {
  ignored: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function ensureForecastContainers(state: Record<string, unknown>): void {
  if (!state.forecast || typeof state.forecast !== "object") {
    state.forecast = {
      items: [],
      settings: { useForecast: false },
      forecastImport: {},
      forecastManual: {},
      versions: [],
      activeVersionId: null,
      lastImpactSummary: null,
      foConflictDecisionsByVersion: {},
      lastImportAt: null,
      importSource: null,
    };
  }
  const forecast = state.forecast as Record<string, unknown>;
  if (!forecast.settings || typeof forecast.settings !== "object") {
    forecast.settings = { useForecast: false };
  }
  if (!forecast.forecastManual || typeof forecast.forecastManual !== "object") {
    forecast.forecastManual = {};
  }
  ensureForecastVersioningContainers(forecast);
}

function formatDisplay(value: number | null, digits = 0): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSigned(value: number | null, digits = 0): string {
  if (!Number.isFinite(value as number)) return "—";
  const number = Number(value);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatSignedPercent(value: number | null): string {
  if (!Number.isFinite(value as number)) return "—";
  const number = Number(value);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

function normalizeImpactSummary(value: unknown): ForecastImpactSummaryMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const comparedAt = String(raw.comparedAt || "").trim();
  const toVersionId = raw.toVersionId == null ? null : String(raw.toVersionId || "").trim() || null;
  if (!comparedAt || !toVersionId) return null;
  return {
    comparedAt,
    fromVersionId: raw.fromVersionId == null ? null : String(raw.fromVersionId || "").trim() || null,
    fromVersionName: raw.fromVersionName == null ? null : String(raw.fromVersionName || ""),
    toVersionId,
    toVersionName: raw.toVersionName == null ? null : String(raw.toVersionName || ""),
    flaggedSkus: Math.max(0, Math.round(Number(raw.flaggedSkus || 0))),
    flaggedAB: Math.max(0, Math.round(Number(raw.flaggedAB || 0))),
    foConflictsTotal: Math.max(0, Math.round(Number(raw.foConflictsTotal || 0))),
    foConflictsOpen: Math.max(0, Math.round(Number(raw.foConflictsOpen || 0))),
  };
}

function isConflictIgnored(decisionsForVersion: Record<string, unknown>, foId: string): boolean {
  const entry = decisionsForVersion?.[foId];
  if (!entry || typeof entry !== "object") return false;
  return (entry as Record<string, unknown>).ignored === true;
}

function countOpenConflictsFromImpact(
  impact: ForecastImpactResult,
  decisionsForVersion: Record<string, unknown>,
): number {
  return impact.foConflicts.filter((entry) => !isConflictIgnored(decisionsForVersion, entry.foId)).length;
}

function formatConflictType(type: string): string {
  if (type === "units_too_small") return "Menge zu klein";
  if (type === "units_too_large") return "Menge zu groß";
  if (type === "timing_too_late") return "Timing zu spät";
  if (type === "timing_too_early") return "Timing zu früh";
  return type;
}

function recomputeStoredImpactSummary(stateObject: Record<string, unknown>, forecastTarget: Record<string, unknown>): void {
  const summary = normalizeImpactSummary(forecastTarget.lastImpactSummary);
  if (!summary) return;
  const versions = (Array.isArray(forecastTarget.versions) ? forecastTarget.versions : []) as ForecastVersionRecord[];
  const toVersion = versions.find((entry) => entry.id === summary.toVersionId) || null;
  if (!toVersion) {
    forecastTarget.lastImpactSummary = null;
    return;
  }
  const fromVersion = summary.fromVersionId
    ? (versions.find((entry) => entry.id === summary.fromVersionId) || null)
    : null;
  const impact = computeForecastImpact({
    state: stateObject,
    fromVersion,
    toVersion,
    nowMonth: currentMonthKey(),
  });
  const decisionsAll = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
    ? forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
    : {};
  const decisionsForVersion = (decisionsAll[toVersion.id] && typeof decisionsAll[toVersion.id] === "object")
    ? decisionsAll[toVersion.id]
    : {};
  forecastTarget.lastImpactSummary = {
    ...impact.summary,
    foConflictsOpen: countOpenConflictsFromImpact(impact, decisionsForVersion),
  };
}

export default function ForecastModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const location = useLocation();
  const navigate = useNavigate();
  const hasStoredExpandedPrefs = hasModuleExpandedCategoryKeys("forecast");

  const [panel, setPanel] = useState<ForecastPanel>("grid");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<ForecastRangeMode>("next12");
  const [view, setView] = useState<ForecastViewMode>("units");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithForecast, setOnlyWithForecast] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualMap>({});
  const [manualDirty, setManualDirty] = useState(false);
  const [importRecords, setImportRecords] = useState<ForecastRecord[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [importOnlyActive, setImportOnlyActive] = useState(true);
  const [importSourceLabel, setImportSourceLabel] = useState("");
  const [importVersionName, setImportVersionName] = useState("");
  const [importVersionNote, setImportVersionNote] = useState("");
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [importPersisting, setImportPersisting] = useState(false);
  const [versionEditOpen, setVersionEditOpen] = useState(false);
  const [versionEditId, setVersionEditId] = useState<string | null>(null);
  const [versionEditName, setVersionEditName] = useState("");
  const [versionEditNote, setVersionEditNote] = useState("");
  const [showOnlyFlaggedSkus, setShowOnlyFlaggedSkus] = useState(true);
  const [showIgnoredConflicts, setShowIgnoredConflicts] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSelection, setTransferSelection] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("forecast"));
  const [impactExpandedCategories, setImpactExpandedCategories] = useState<string[]>([]);

  const settings = (state.settings || {}) as Record<string, unknown>;
  const forecast = (state.forecast || {}) as Record<string, unknown>;
  const forecastSettings = (forecast.settings && typeof forecast.settings === "object")
    ? forecast.settings as Record<string, unknown>
    : {};
  const methodikUseForecast = forecastSettings.useForecast === true;
  const forecastImport = (forecast.forecastImport || {}) as Record<string, unknown>;
  const stateObject = state as unknown as Record<string, unknown>;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const panelParam = params.get("panel");
    if (panelParam === "versions") {
      setPanel("versions");
    } else if (panelParam === "impact" || panelParam === "conflicts") {
      setPanel("impact");
    }
    if (params.get("source") === "dashboard") {
      const sku = String(params.get("sku") || "").trim();
      if (sku) setSearch(sku);
    }
  }, [location.search]);

  useEffect(() => {
    setManualDraft(normalizeManualMap((forecast.forecastManual || {}) as Record<string, unknown>));
    setManualDirty(false);
  }, [forecast.forecastManual]);

  const allMonths = useMemo(() => {
    return buildForecastMonths(settings);
  }, [settings.horizonMonths, settings.startMonth]);

  const visibleMonths = useMemo(() => {
    const option = RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return allMonths;
    return allMonths.slice(0, option.count);
  }, [allMonths, range]);

  const categoriesById = useMemo(() => {
    return buildCategoryLabelMap(stateObject);
  }, [stateObject]);

  const categoryOrderMap = useMemo(() => buildCategoryOrderMap(stateObject), [state.productCategories, stateObject]);

  const products = useMemo(() => {
    return buildForecastProducts(stateObject, categoriesById);
  }, [categoriesById, stateObject]);

  const productBySkuRaw = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .forEach((entry) => {
        const sku = String(entry.sku || "").trim();
        if (!sku) return;
        map.set(sku.toLowerCase(), entry);
      });
    return map;
  }, [state.products]);

  const missingProfitMarginProducts = useMemo(() => {
    return products
      .filter((product) => product.isActive)
      .filter((product) => {
        const margin = Number(product.sellerboardMarginPct);
        return !(Number.isFinite(margin) && margin > 0 && margin <= 100);
      });
  }, [products]);

  const filteredProducts = useMemo(() => {
    return filterForecastProducts({
      products,
      search,
      onlyActive,
      onlyWithForecast,
      visibleMonths,
      manualDraft,
      forecastImport,
    });
  }, [forecastImport, manualDraft, onlyActive, onlyWithForecast, products, search, visibleMonths]);

  const groupedProducts = useMemo(() => {
    const groups = new Map<string, ProductRow[]>();
    filteredProducts.forEach((row) => {
      const key = String(row.categoryLabel || "Ohne Kategorie");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(row);
    });
    const mapped = Array.from(groups.entries())
      .map(([key, rows]) => ({
        key,
        label: key,
        rows: rows.sort((a, b) => a.sku.localeCompare(b.sku)),
      }));
    return sortCategoryGroups(mapped, categoryOrderMap);
  }, [categoryOrderMap, filteredProducts]);

  useEffect(() => {
    setExpandedCategories((current) => {
      if (!groupedProducts.length) return [];
      const valid = new Set(groupedProducts.map((group) => group.key));
      const filtered = current.filter((key) => valid.has(key));
      if (filtered.length || hasStoredExpandedPrefs) return filtered;
      return groupedProducts.map((group) => group.key);
    });
  }, [groupedProducts, hasStoredExpandedPrefs]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("forecast", expandedCategories);
  }, [expandedCategories]);

  const revenueByMonth = useMemo(() => {
    return buildForecastRevenueByMonth({
      allMonths,
      products,
      manualDraft,
      forecastImport,
    });
  }, [allMonths, forecastImport, manualDraft, products]);

  const versioningSnapshot = useMemo(() => {
    const clone = structuredClone(forecast || {});
    ensureForecastVersioningContainers(clone as Record<string, unknown>);
    return clone as Record<string, unknown>;
  }, [forecast]);

  const versions = useMemo(() => {
    const list = (Array.isArray(versioningSnapshot.versions) ? versioningSnapshot.versions : []) as ForecastVersionRecord[];
    return list
      .slice()
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }, [versioningSnapshot.versions]);

  const versionById = useMemo(
    () => new Map(versions.map((entry) => [entry.id, entry])),
    [versions],
  );

  const activeVersion = useMemo(
    () => getActiveForecastVersion(versioningSnapshot as Record<string, unknown>),
    [versioningSnapshot],
  );

  const activeVersionId = activeVersion?.id || null;
  const activeBaselineLabel = useMemo(
    () => getActiveForecastLabel(versioningSnapshot as Record<string, unknown>),
    [versioningSnapshot],
  );

  const impactSummary = useMemo(
    () => normalizeImpactSummary(versioningSnapshot.lastImpactSummary),
    [versioningSnapshot.lastImpactSummary],
  );

  const decisionsByVersion = (versioningSnapshot.foConflictDecisionsByVersion && typeof versioningSnapshot.foConflictDecisionsByVersion === "object")
    ? versioningSnapshot.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
    : {};
  const activeDecisionMap = (activeVersionId && decisionsByVersion[activeVersionId] && typeof decisionsByVersion[activeVersionId] === "object")
    ? decisionsByVersion[activeVersionId]
    : {};

  const impactResult = useMemo(() => {
    if (!impactSummary?.toVersionId) return null;
    const toVersion = versionById.get(impactSummary.toVersionId) || null;
    if (!toVersion) return null;
    const fromVersion = impactSummary.fromVersionId
      ? (versionById.get(impactSummary.fromVersionId) || null)
      : null;
    return computeForecastImpact({
      state: stateObject,
      fromVersion,
      toVersion,
      nowMonth: currentMonthKey(),
    });
  }, [
    impactSummary,
    state.forecast,
    state.fos,
    state.inventory,
    state.pos,
    state.products,
    state.settings,
    state.suppliers,
    stateObject,
    versionById,
  ]);

  const impactSkuRows = useMemo(() => {
    if (!impactResult) return [] as ForecastImpactSkuRow[];
    const categoryBySku = new Map<string, string>();
    products.forEach((row) => {
      categoryBySku.set(String(row.sku || "").trim().toLowerCase(), String(row.categoryLabel || "Ohne Kategorie"));
    });
    return impactResult.skuRows.map((row) => ({
      ...row,
      categoryLabel: categoryBySku.get(String(row.sku || "").trim().toLowerCase()) || "Ohne Kategorie",
    }));
  }, [impactResult, products]);

  const visibleImpactSkuRows = useMemo(() => {
    const rows = showOnlyFlaggedSkus
      ? impactSkuRows.filter((row) => row.flagged)
      : impactSkuRows;
    return rows;
  }, [impactSkuRows, showOnlyFlaggedSkus]);

  const groupedImpactSkuRows = useMemo(() => {
    const groups = new Map<string, ForecastImpactSkuRow[]>();
    visibleImpactSkuRows.forEach((row) => {
      const category = String(row.categoryLabel || "Ohne Kategorie");
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)?.push(row);
    });
    const mapped = Array.from(groups.entries()).map(([key, rows]) => ({
      key,
      label: key,
      rows,
    }));
    return sortCategoryGroups(mapped, categoryOrderMap);
  }, [categoryOrderMap, visibleImpactSkuRows]);

  useEffect(() => {
    setImpactExpandedCategories((current) => {
      if (!groupedImpactSkuRows.length) return [];
      const valid = new Set(groupedImpactSkuRows.map((group) => group.key));
      const filtered = current.filter((key) => valid.has(key));
      if (filtered.length) return filtered;
      return groupedImpactSkuRows.map((group) => group.key);
    });
  }, [groupedImpactSkuRows]);

  const impactConflictRows = useMemo(() => {
    if (!impactResult) return [] as ForecastFoConflictRow[];
    return impactResult.foConflicts.map((row) => ({
      ...row,
      ignored: isConflictIgnored(activeDecisionMap, row.foId),
    }));
  }, [activeDecisionMap, impactResult]);

  const openConflictRows = useMemo(
    () => impactConflictRows.filter((row) => !row.ignored),
    [impactConflictRows],
  );

  const displayedConflictRows = useMemo(
    () => (showIgnoredConflicts ? impactConflictRows : openConflictRows),
    [impactConflictRows, openConflictRows, showIgnoredConflicts],
  );

  const conflictHintCount = impactSummary
    && activeVersionId
    && impactSummary.toVersionId === activeVersionId
    ? impactSummary.foConflictsOpen
    : 0;

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const base: ColumnDef<ProductRow>[] = [
      {
        header: "Alias",
        accessorKey: "alias",
        meta: { width: 300, minWidth: 300 },
        cell: ({ row }) => (
          <SkuAliasCell
            alias={row.original.alias || (row.original.isPlan ? row.original.plannedSku : row.original.sku)}
            sku={row.original.sku}
          />
        ),
      },
      {
        header: "Status",
        meta: { width: 86, minWidth: 86 },
        cell: ({ row }) => (
          row.original.isPlan
            ? <Tag color="blue">Plan</Tag>
            : (row.original.isActive ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>)
        ),
      },
    ];

    const monthColumns: ColumnDef<ProductRow>[] = visibleMonths.map((month) => ({
      id: month,
      header: formatMonthLabel(month),
      meta: { width: 118, minWidth: 118, align: "right" },
      cell: ({ row }) => {
        const sku = row.original.sku;
        const manualValue = manualDraft?.[sku]?.[month];
        const imported = getImportValue(forecastImport, sku, month);
        const effectiveUnits = getEffectiveUnits(
          manualDraft,
          forecastImport,
          sku,
          month,
          row.original.plannedUnitsByMonth,
        );

        if (view === "units") {
          if (row.original.isPlan) {
            return (
              <div className="v2-forecast-cell">
                <div>{formatDisplay(effectiveUnits, 0)}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Quelle: Plan (Baseline + Saisonalitaet)
                </Text>
              </div>
            );
          }
          return (
            <div className="v2-forecast-cell">
              <InputNumber
                className="v2-grid-input"
                value={Number.isFinite(manualValue) ? manualValue : null}
                onChange={(nextValue) => {
                  setManualDraft((prev) => {
                    const next = { ...prev };
                    const skuMap = { ...(next[sku] || {}) };
                    const parsed = typeof nextValue === "number" && Number.isFinite(nextValue) ? nextValue : null;
                    if (parsed == null) {
                      delete skuMap[month];
                    } else {
                      skuMap[month] = parsed;
                    }
                    if (Object.keys(skuMap).length) {
                      next[sku] = skuMap;
                    } else {
                      delete next[sku];
                    }
                    return next;
                  });
                  setManualDirty(true);
                }}
                min={0}
                controls={false}
                placeholder={Number.isFinite(effectiveUnits as number) ? String(Math.round(Number(effectiveUnits))) : "—"}
                style={{ width: "100%" }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Imp: {formatDisplay(imported?.units ?? null, 0)}
              </Text>
            </div>
          );
        }

        const derived = deriveForecastValue(view, effectiveUnits, row.original);
        return (
          <div>
            <div>{formatDisplay(derived, 2)}</div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Units: {formatDisplay(effectiveUnits, 0)}
            </Text>
          </div>
        );
      },
    }));

    return [...base, ...monthColumns];
  }, [forecastImport, manualDraft, view, visibleMonths]);

  const impactSkuColumns = useMemo<ColumnDef<ForecastImpactSkuRow>[]>(() => [
    {
      header: "Alias",
      accessorKey: "alias",
      meta: { width: 260, minWidth: 260 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    {
      header: "ABC",
      accessorKey: "abcClass",
      meta: { width: 80, minWidth: 80, align: "center" },
      cell: ({ row }) => (
        <Tag color={row.original.abcClass === "A" ? "red" : row.original.abcClass === "B" ? "gold" : "blue"}>
          {row.original.abcClass}
        </Tag>
      ),
    },
    {
      header: "Δ 1M Units",
      meta: { width: 120, minWidth: 120, align: "right" },
      cell: ({ row }) => formatSigned(row.original.delta1Units, 0),
    },
    {
      header: "Δ 1M %",
      meta: { width: 100, minWidth: 100, align: "right" },
      cell: ({ row }) => formatSignedPercent(row.original.delta1Pct),
    },
    {
      header: "Δ 3M Units",
      meta: { width: 120, minWidth: 120, align: "right" },
      cell: ({ row }) => formatSigned(row.original.delta3Units, 0),
    },
    {
      header: "Δ 3M %",
      meta: { width: 100, minWidth: 100, align: "right" },
      cell: ({ row }) => formatSignedPercent(row.original.delta3Pct),
    },
    {
      header: "Δ 6M Units",
      meta: { width: 120, minWidth: 120, align: "right" },
      cell: ({ row }) => formatSigned(row.original.delta6Units, 0),
    },
    {
      header: "Δ 6M %",
      meta: { width: 100, minWidth: 100, align: "right" },
      cell: ({ row }) => formatSignedPercent(row.original.delta6Pct),
    },
    {
      header: "Δ Umsatz 3M",
      meta: { width: 130, minWidth: 130, align: "right" },
      cell: ({ row }) => formatSigned(row.original.delta3Revenue, 2),
    },
    {
      header: "Flags",
      meta: { width: 170, minWidth: 170 },
      cell: ({ row }) => (
        <Space wrap>
          {row.original.flagged ? <Tag color="gold">Review</Tag> : <Tag color="green">OK</Tag>}
          {row.original.reasons.includes("safety_risk") ? <Tag color="red">Safety</Tag> : null}
          {row.original.reasons.includes("abc_threshold") ? <Tag color="blue">Δ3M</Tag> : null}
        </Space>
      ),
    },
  ], []);

  function clearStagedImport(): void {
    setImportRecords([]);
    setImportWarnings([]);
    setImportError("");
    setImportSourceLabel("");
    setImportVersionName("");
    setImportVersionNote("");
    setImportReviewOpen(false);
  }

  function buildImportedForecastMap(baseImport: Record<string, unknown>): Record<string, unknown> {
    const target = importMode === "overwrite"
      ? {}
      : structuredClone(normalizeForecastImportMap(baseImport || {}));
    importRecords.forEach((record) => {
      const sku = String(record.sku || "").trim();
      if (!sku) return;
      const month = normalizeMonthKey(record.month);
      if (!month) return;
      const product = productBySkuRaw.get(sku.toLowerCase()) || null;
      if (!product) return;
      if (importOnlyActive && !isForecastProductActive(product)) return;
      if (!target[sku] || typeof target[sku] !== "object") {
        target[sku] = {};
      }
      (target[sku] as Record<string, unknown>)[month] = {
        units: record.units,
        revenueEur: record.revenueEur,
        profitEur: record.profitEur,
      };
    });
    return normalizeForecastImportMap(target);
  }

  async function saveManualForecast(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureForecastContainers(nextState);
      const forecastTarget = nextState.forecast as Record<string, unknown>;
      forecastTarget.forecastManual = serializeManualMap(manualDraft);
      return next;
    }, "v2:forecast:manual-save");
    setManualDirty(false);
  }

  async function handleCsvImport(file: File): Promise<void> {
    setImportError("");
    setImportWarnings([]);
    try {
      const text = await file.text();
      const parsed = parseVentoryCsv(text);
      if (parsed.error) {
        setImportRecords([]);
        setImportError(parsed.error);
        setImportWarnings(parsed.warnings || []);
        setImportReviewOpen(false);
        return;
      }
      const records = (parsed.records || []).map((entry) => ({
        sku: String(entry.sku || "").trim(),
        month: normalizeMonthKey(entry.month) || String(entry.month || ""),
        units: parseDeNumber(entry.units),
        revenueEur: parseDeNumber(entry.revenueEur),
        profitEur: parseDeNumber(entry.profitEur),
      })).filter((entry) => entry.sku && normalizeMonthKey(entry.month));
      if (!records.length) {
        setImportRecords([]);
        setImportError("Keine gültigen Forecast-Zeilen erkannt.");
        setImportWarnings(parsed.warnings || []);
        setImportReviewOpen(false);
        return;
      }
      setImportRecords(records);
      setImportWarnings(parsed.warnings || []);
      setImportSourceLabel(file.name);
      setImportVersionName(buildForecastVersionName(new Date()));
      setImportVersionNote("");
      setImportReviewOpen(true);
    } catch (importReadError) {
      setImportError(importReadError instanceof Error ? importReadError.message : "Datei konnte nicht gelesen werden.");
      setImportRecords([]);
      setImportReviewOpen(false);
    }
  }

  async function persistImportedVersion(mode: "save" | "activate"): Promise<void> {
    if (!importRecords.length) return;
    setImportPersisting(true);
    try {
      const createdAt = nowIso();
      const sourceLabel = importSourceLabel || "VentoryOne CSV";
      const versionName = String(importVersionName || "").trim() || buildForecastVersionName(new Date(createdAt));
      const versionNote = String(importVersionNote || "").trim() || null;
      const activeBefore = activeVersion || null;
      const candidateImport = buildImportedForecastMap(activeBefore?.forecastImport || {});
      if (!Object.keys(candidateImport).length) {
        throw new Error("Keine gültigen Zeilen für den aktuellen Import-Filter.");
      }
      const candidateVersion = createForecastVersion({
        name: versionName,
        note: versionNote,
        createdAt,
        sourceLabel,
        importMode,
        onlyActiveSkus: importOnlyActive,
        forecastImport: candidateImport,
      });

      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const nextState = next as unknown as Record<string, unknown>;
        ensureForecastContainers(nextState);
        const forecastTarget = nextState.forecast as Record<string, unknown>;
        const previousActive = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
        const appended = appendForecastVersion(forecastTarget as Record<string, unknown>, candidateVersion);

        forecastTarget.lastImportAt = createdAt;
        forecastTarget.importSource = sourceLabel;
        forecastTarget.importCadence = "monthly";
        forecastTarget.lastDriftSummary = computeForecastDriftSummary({
          previousImport: normalizeForecastImportMap(previousActive?.forecastImport || {}),
          nextImport: normalizeForecastImportMap(appended.forecastImport || {}),
          products: (Array.isArray(nextState.products) ? nextState.products : []) as Array<Record<string, unknown>>,
          abcBySku: computeAbcClassification(nextState).bySku,
          comparedAt: createdAt,
          profile: "medium",
        });

        if (mode === "activate") {
          const switched = setActiveVersion(forecastTarget as Record<string, unknown>, appended.id, { touchImportMeta: true });
          if (!switched.ok) {
            throw new Error(switched.reason || "Baseline konnte nicht aktiviert werden.");
          }
          const impact = computeForecastImpact({
            state: nextState,
            fromVersion: previousActive,
            toVersion: switched.version || appended,
            nowMonth: currentMonthKey(),
          });
          const decisionsAll = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
            ? forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
            : {};
          const decisionsForVersion = decisionsAll[appended.id] || {};
          forecastTarget.lastImpactSummary = {
            ...impact.summary,
            foConflictsOpen: countOpenConflictsFromImpact(impact, decisionsForVersion),
          };
        }

        return next;
      }, mode === "activate" ? "v2:forecast:import:activate" : "v2:forecast:import:save");

      if (mode === "activate") {
        setPanel("impact");
        message.success("Version gespeichert und als aktive Baseline gesetzt.");
      } else {
        message.success("Version gespeichert. Baseline bleibt unverändert.");
      }
      clearStagedImport();
    } catch (persistError) {
      message.error(persistError instanceof Error ? persistError.message : "Import konnte nicht gespeichert werden.");
    } finally {
      setImportPersisting(false);
    }
  }

  async function transferRevenueToInputs(): Promise<void> {
    if (!transferSelection.length) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      const incomings = Array.isArray(nextState.incomings) ? [...(nextState.incomings as Record<string, unknown>[])] : [];
      const normalizeTransferredPayoutPct = (value: unknown): number => {
        const parsed = parsePayoutPctInput(value);
        if (!Number.isFinite(parsed as number)) return 50;
        return clampPct(Number(parsed), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
      };
      const lastPayout = incomings
        .slice()
        .reverse()
        .find((entry) => String(entry.payoutPct || "").trim())?.payoutPct;
      const fallbackPayoutPct = normalizeTransferredPayoutPct(lastPayout);

      transferSelection.forEach((month) => {
        const revenue = Number(revenueByMonth.get(month) || 0);
        const index = incomings.findIndex((entry) => String(entry.month || "") === month);
        if (index >= 0) {
          const existingPayoutPct = normalizeTransferredPayoutPct(incomings[index].payoutPct);
          incomings[index] = {
            ...incomings[index],
            month,
            revenueEur: revenue,
            payoutPct: existingPayoutPct || fallbackPayoutPct,
            source: "forecast",
          };
          return;
        }
        incomings.push({
          month,
          revenueEur: revenue,
          payoutPct: fallbackPayoutPct,
          source: "forecast",
          calibrationCutoffDate: null,
          calibrationRevenueToDateEur: null,
          calibrationPayoutRateToDatePct: null,
          calibrationSellerboardMonthEndEur: null,
        });
      });

      incomings.sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));
      nextState.incomings = incomings;
      return next;
    }, "v2:forecast:transfer-revenue");
    setTransferOpen(false);
  }

  function openVersionEdit(version: ForecastVersionRecord): void {
    setVersionEditId(version.id);
    setVersionEditName(version.name || "");
    setVersionEditNote(version.note || "");
    setVersionEditOpen(true);
  }

  async function saveVersionEdit(): Promise<void> {
    if (!versionEditId) return;
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const nextState = next as unknown as Record<string, unknown>;
        ensureForecastContainers(nextState);
        const forecastTarget = nextState.forecast as Record<string, unknown>;
        const renamed = renameForecastVersion(
          forecastTarget as Record<string, unknown>,
          versionEditId,
          { name: versionEditName, note: versionEditNote },
        );
        if (!renamed) {
          throw new Error("Version nicht gefunden.");
        }
        return next;
      }, "v2:forecast:version:rename");
      setVersionEditOpen(false);
      setVersionEditId(null);
      message.success("Version aktualisiert.");
    } catch (renameError) {
      message.error(renameError instanceof Error ? renameError.message : "Version konnte nicht gespeichert werden.");
    }
  }

  function requestActivateVersion(version: ForecastVersionRecord): void {
    if (!version?.id || version.id === activeVersionId) return;
    Modal.confirm({
      title: "Aktive Baseline wechseln?",
      content: `Neue Baseline: ${version.name}`,
      okText: "Baseline wechseln",
      cancelText: "Abbrechen",
      onOk: async () => {
        await saveWith((current) => {
          const next = ensureAppStateV2(current);
          const nextState = next as unknown as Record<string, unknown>;
          ensureForecastContainers(nextState);
          const forecastTarget = nextState.forecast as Record<string, unknown>;
          const previousActive = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
          const switched = setActiveVersion(forecastTarget as Record<string, unknown>, version.id, { touchImportMeta: true });
          if (!switched.ok) {
            throw new Error(switched.reason || "Baseline konnte nicht gesetzt werden.");
          }
          const activeAfter = switched.version || getActiveForecastVersion(forecastTarget as Record<string, unknown>);
          if (!activeAfter) {
            throw new Error("Aktive Baseline fehlt.");
          }
          const impact = computeForecastImpact({
            state: nextState,
            fromVersion: previousActive,
            toVersion: activeAfter,
            nowMonth: currentMonthKey(),
          });
          const decisionsAll = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
            ? forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
            : {};
          const decisionsForVersion = decisionsAll[activeAfter.id] || {};
          forecastTarget.lastImpactSummary = {
            ...impact.summary,
            foConflictsOpen: countOpenConflictsFromImpact(impact, decisionsForVersion),
          };
          return next;
        }, "v2:forecast:version:activate");
        setPanel("impact");
        message.success("Baseline gewechselt. Impact-Analyse wurde aktualisiert.");
      },
    });
  }

  function requestDeleteVersion(version: ForecastVersionRecord): void {
    if (!version?.id) return;
    Modal.confirm({
      title: "Version löschen?",
      content: `Die Version "${version.name}" wird dauerhaft gelöscht.`,
      okText: "Version löschen",
      okType: "danger",
      cancelText: "Abbrechen",
      onOk: async () => {
        await saveWith((current) => {
          const next = ensureAppStateV2(current);
          const nextState = next as unknown as Record<string, unknown>;
          ensureForecastContainers(nextState);
          const forecastTarget = nextState.forecast as Record<string, unknown>;
          const deleted = deleteForecastVersion(forecastTarget as Record<string, unknown>, version.id);
          if (!deleted.ok) {
            if (deleted.reason === "ACTIVE_VERSION") {
              throw new Error("Aktive Baseline kann nicht gelöscht werden. Bitte zuerst Baseline wechseln.");
            }
            throw new Error("Version konnte nicht gelöscht werden.");
          }
          if (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object") {
            const decisions = { ...(forecastTarget.foConflictDecisionsByVersion as Record<string, unknown>) };
            delete decisions[version.id];
            forecastTarget.foConflictDecisionsByVersion = decisions;
          }
          const summary = normalizeImpactSummary(forecastTarget.lastImpactSummary);
          if (summary && (summary.toVersionId === version.id || summary.fromVersionId === version.id)) {
            forecastTarget.lastImpactSummary = null;
          }
          return next;
        }, "v2:forecast:version:delete");
        message.success("Version gelöscht.");
      },
    });
  }

  function clearConflictIgnoreDecision(
    forecastTarget: Record<string, unknown>,
    versionId: string | null,
    foId: string,
  ): void {
    if (!versionId) return;
    const all = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
      ? { ...(forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>) }
      : {};
    const map = { ...(all[versionId] || {}) };
    delete map[foId];
    all[versionId] = map;
    forecastTarget.foConflictDecisionsByVersion = all;
  }

  function requestUpdateFoFromConflict(conflict: ForecastFoConflictRow): void {
    if (conflict.ignored) return;
    Modal.confirm({
      title: `FO ${conflict.foId} aktualisieren?`,
      content: (
        <Space direction="vertical" size={4}>
          <Text>Aktuell: {formatDisplay(conflict.currentUnits, 0)} Units · Target {conflict.currentTargetDeliveryDate || "—"}</Text>
          <Text>Neu: {formatDisplay(conflict.recommendedUnits, 0)} Units · Arrival {conflict.recommendedArrivalDate || "—"}</Text>
        </Space>
      ),
      okText: "FO aktualisieren",
      cancelText: "Abbrechen",
      onOk: async () => {
        await saveWith((current) => {
          const next = ensureAppStateV2(current);
          const nextState = next as unknown as Record<string, unknown>;
          ensureForecastContainers(nextState);
          const forecastTarget = nextState.forecast as Record<string, unknown>;
          const active = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
          const fos = Array.isArray(next.fos) ? [...next.fos] as Record<string, unknown>[] : [];
          const index = fos.findIndex((entry) => String(entry.id || "") === conflict.foId);
          if (index < 0) {
            throw new Error("FO nicht gefunden.");
          }
          const existing = fos[index];
          const targetDate = conflict.recommendedArrivalDate || conflict.requiredArrivalDate || String(existing.targetDeliveryDate || "") || null;
          const schedule = computeFoSchedule({
            targetDeliveryDate: targetDate,
            productionLeadTimeDays: existing.productionLeadTimeDays,
            logisticsLeadTimeDays: existing.logisticsLeadTimeDays,
            bufferDays: existing.bufferDays,
          });
          const changedAt = nowIso();
          fos[index] = {
            ...existing,
            units: Math.max(0, Math.round(Number(conflict.recommendedUnits || 0))),
            targetDeliveryDate: targetDate,
            orderDate: schedule.orderDate,
            productionEndDate: schedule.productionEndDate,
            etdDate: schedule.etdDate,
            etaDate: schedule.etaDate,
            deliveryDate: schedule.deliveryDate,
            forecastBasisVersionId: active?.id || null,
            forecastBasisVersionName: active?.name || null,
            forecastBasisSetAt: changedAt,
            forecastConflictState: "reviewed_updated",
            supersededByFoId: null,
            updatedAt: changedAt,
          };
          next.fos = fos;
          clearConflictIgnoreDecision(forecastTarget, active?.id || null, conflict.foId);
          recomputeStoredImpactSummary(nextState, forecastTarget);
          return next;
        }, "v2:forecast:conflict:update");
        message.success(`FO ${conflict.foId} wurde aktualisiert.`);
      },
    });
  }

  function requestCreateDraftFromConflict(conflict: ForecastFoConflictRow): void {
    if (conflict.ignored) return;
    Modal.confirm({
      title: `Draft-FO für ${conflict.foId} erzeugen?`,
      content: (
        <Space direction="vertical" size={4}>
          <Text>Neue Draft-FO: {formatDisplay(conflict.recommendedUnits, 0)} Units · Arrival {conflict.recommendedArrivalDate || "—"}</Text>
          <Text>Bestehende FO bleibt erhalten und wird als superseded markiert.</Text>
        </Space>
      ),
      okText: "Draft erzeugen",
      cancelText: "Abbrechen",
      onOk: async () => {
        await saveWith((current) => {
          const next = ensureAppStateV2(current);
          const nextState = next as unknown as Record<string, unknown>;
          ensureForecastContainers(nextState);
          const forecastTarget = nextState.forecast as Record<string, unknown>;
          const active = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
          const fos = Array.isArray(next.fos) ? [...next.fos] as Record<string, unknown>[] : [];
          const index = fos.findIndex((entry) => String(entry.id || "") === conflict.foId);
          if (index < 0) {
            throw new Error("FO nicht gefunden.");
          }
          const existing = fos[index];
          const targetDate = conflict.recommendedArrivalDate || conflict.requiredArrivalDate || String(existing.targetDeliveryDate || "") || null;
          const schedule = computeFoSchedule({
            targetDeliveryDate: targetDate,
            productionLeadTimeDays: existing.productionLeadTimeDays,
            logisticsLeadTimeDays: existing.logisticsLeadTimeDays,
            bufferDays: existing.bufferDays,
          });
          const changedAt = nowIso();
          const draftId = randomId("fo");
          const foNumberSuggestion = suggestNextFoNumber(fos, changedAt);
          const draftFo = {
            ...existing,
            id: draftId,
            foNo: foNumberSuggestion.foNo,
            foNumber: foNumberSuggestion.foNumber,
            status: "DRAFT",
            units: Math.max(0, Math.round(Number(conflict.recommendedUnits || 0))),
            targetDeliveryDate: targetDate,
            orderDate: schedule.orderDate,
            productionEndDate: schedule.productionEndDate,
            etdDate: schedule.etdDate,
            etaDate: schedule.etaDate,
            deliveryDate: schedule.deliveryDate,
            convertedPoId: null,
            convertedPoNo: null,
            forecastBasisVersionId: active?.id || null,
            forecastBasisVersionName: active?.name || null,
            forecastBasisSetAt: changedAt,
            forecastConflictState: "review_needed",
            supersedesFoId: String(existing.id || conflict.foId),
            supersededByFoId: null,
            createdAt: changedAt,
            updatedAt: changedAt,
          };

          fos[index] = {
            ...existing,
            forecastConflictState: "superseded",
            supersededByFoId: draftId,
            updatedAt: changedAt,
          };
          fos.push(draftFo);
          next.fos = fos;
          clearConflictIgnoreDecision(forecastTarget, active?.id || null, conflict.foId);
          recomputeStoredImpactSummary(nextState, forecastTarget);
          return next;
        }, "v2:forecast:conflict:draft");
        message.success(`Neue Draft-FO zu ${conflict.foId} erstellt.`);
      },
    });
  }

  async function ignoreConflict(conflict: ForecastFoConflictRow): Promise<void> {
    if (conflict.ignored || !activeVersionId) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureForecastContainers(nextState);
      const forecastTarget = nextState.forecast as Record<string, unknown>;
      const all = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
        ? { ...(forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>) }
        : {};
      const currentDecisionMap = { ...(all[activeVersionId] || {}) };
      currentDecisionMap[conflict.foId] = {
        ignored: true,
        ignoredAt: nowIso(),
        reason: "manual_ignore",
      };
      all[activeVersionId] = currentDecisionMap;
      forecastTarget.foConflictDecisionsByVersion = all;
      recomputeStoredImpactSummary(nextState, forecastTarget);
      return next;
    }, "v2:forecast:conflict:ignore");
    message.success(`FO ${conflict.foId} für diese Forecast-Version ignoriert.`);
  }

  const impactConflictColumns = useMemo<ColumnDef<ForecastFoConflictRow>[]>(() => [
    {
      header: "FO",
      meta: { width: 90, minWidth: 90 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text strong>{String(row.original.foId || "").slice(-6).toUpperCase()}</Text>
          {row.original.ignored ? <Tag color="default">Ignoriert</Tag> : <Tag color="gold">To Review</Tag>}
        </Space>
      ),
    },
    {
      header: "Produkt",
      meta: { width: 220, minWidth: 220 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    {
      header: "Supplier",
      accessorKey: "supplierName",
      meta: { width: 170, minWidth: 170 },
    },
    {
      header: "Aktuelle FO",
      meta: { width: 190, minWidth: 190 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>{formatDisplay(row.original.currentUnits, 0)} Units</Text>
          <Text type="secondary">Target: {row.original.currentTargetDeliveryDate || "—"}</Text>
          <Text type="secondary">ETA: {row.original.currentEtaDate || "—"}</Text>
        </Space>
      ),
    },
    {
      header: "Neuer Forecast",
      meta: { width: 190, minWidth: 190 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>Safety-Bruch: {row.original.firstMonthBelowSafety || "—"}</Text>
          <Text type="secondary">Required Arrival: {row.original.requiredArrivalDate || "—"}</Text>
        </Space>
      ),
    },
    {
      header: "Empfehlung",
      meta: { width: 210, minWidth: 210 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>{formatDisplay(row.original.recommendedUnits, 0)} Units</Text>
          <Text type="secondary">Order: {row.original.recommendedOrderDate || "—"}</Text>
          <Text type="secondary">Arrival: {row.original.recommendedArrivalDate || "—"}</Text>
        </Space>
      ),
    },
    {
      header: "Konflikte",
      meta: { width: 220, minWidth: 220 },
      cell: ({ row }) => (
        <Space wrap>
          {row.original.conflictTypes.map((type) => (
            <Tag key={`${row.original.foId}-${type}`} color={type.includes("late") || type.includes("small") ? "red" : "orange"}>
              {formatConflictType(type)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      header: "Aktionen",
      meta: { width: 310, minWidth: 310 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button
            size="small"
            disabled={row.original.ignored}
            onClick={() => requestUpdateFoFromConflict(row.original)}
          >
            FO aktualisieren
          </Button>
          <Button
            size="small"
            disabled={row.original.ignored}
            onClick={() => requestCreateDraftFromConflict(row.original)}
          >
            Als Draft neu erzeugen
          </Button>
          <Button
            size="small"
            disabled={row.original.ignored}
            onClick={() => { void ignoreConflict(row.original); }}
          >
            Ignorieren
          </Button>
        </div>
      ),
    },
  ], [ignoreConflict, requestCreateDraftFromConflict, requestUpdateFoFromConflict]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Forecast</Title>
            <Paragraph>
              Versionierte VentoryOne-Imports mit aktiver Baseline, Impact-Analyse und FO-Konflikt-Workflow.
            </Paragraph>
          </div>
          <Space wrap>
            <Tag color="blue">Baseline Forecast: {activeBaselineLabel}</Tag>
            {conflictHintCount > 0 ? (
              <Tag color="gold">Forecast-Änderung: {conflictHintCount} FOs prüfen</Tag>
            ) : null}
          </Space>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Radio.Group value={panel} onChange={(event) => setPanel(event.target.value as ForecastPanel)}>
              <Radio.Button value="grid">Forecast Grid</Radio.Button>
              <Radio.Button value="versions">Versionen</Radio.Button>
              <Radio.Button value="impact">Impact & FO-Konflikte</Radio.Button>
            </Radio.Group>
            <Space wrap>
              <Text>Forecast wird im Cashflow genutzt: <strong>{methodikUseForecast ? "Ja" : "Nein"}</strong></Text>
              <Button size="small" onClick={() => navigate("/v2/methodik")}>
                In Methodik &amp; Regeln ändern
              </Button>
            </Space>
          </div>

          {panel === "grid" ? (
            <>
              <div className="v2-toolbar-row">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Suche SKU, Alias, Kategorie"
                  style={{ width: 320, maxWidth: "100%" }}
                />
                <Select
                  value={range}
                  onChange={(value) => setRange(value)}
                  options={RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
                  style={{ width: 140, maxWidth: "100%" }}
                />
                <Radio.Group value={view} onChange={(event) => setView(event.target.value as ForecastViewMode)}>
                  <Radio.Button value="units">Units</Radio.Button>
                  <Radio.Button value="revenue">Umsatz</Radio.Button>
                  <Radio.Button value="profit">Gewinn</Radio.Button>
                </Radio.Group>
                <Checkbox checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)}>
                  Nur aktive Produkte
                </Checkbox>
                <Checkbox checked={onlyWithForecast} onChange={(event) => setOnlyWithForecast(event.target.checked)}>
                  Nur mit Forecast
                </Checkbox>
              </div>
              <div className="v2-toolbar-row">
                <Button type="primary" onClick={() => { void saveManualForecast(); }} disabled={!manualDirty} loading={saving}>
                  Manuelle Änderungen speichern
                </Button>
                <Button
                  onClick={() => {
                    const defaults = visibleMonths.filter((month) => Number(revenueByMonth.get(month) || 0) > 0);
                    setTransferSelection(defaults);
                    setTransferOpen(true);
                  }}
                >
                  Umsatz übertragen
                </Button>
                {manualDirty ? <Tag color="orange">Ungespeicherte Änderungen</Tag> : <Tag color="green">Synchron</Tag>}
                {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}
      {missingProfitMarginProducts.length ? (
        <Alert
          type="warning"
          showIcon
          message={`Brutto-Marge fehlt für ${missingProfitMarginProducts.length} aktive Forecast-Produkt(e). Gewinn-Ansicht ist dadurch unvollständig.`}
          description={(
            <Space wrap>
              <Text type="secondary">
                Beispiele: {missingProfitMarginProducts.slice(0, 5).map((entry) => entry.sku).join(", ")}
                {missingProfitMarginProducts.length > 5 ? " ..." : ""}
              </Text>
              <Button size="small" onClick={() => { window.location.hash = "/v2/products?issues=revenue&expand=all"; }}>
                Produkte öffnen
              </Button>
              <Button size="small" onClick={() => { window.location.hash = "/v2/plan-products"; }}>
                Neue Produkte öffnen
              </Button>
            </Space>
          )}
        />
      ) : null}

      <Card>
        <Title level={4}>VentoryOne CSV Import</Title>
        <Space direction="vertical" style={{ width: "100%" }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleCsvImport(file);
            }}
          />
          <Space wrap>
            <Radio.Group value={importMode} onChange={(event) => setImportMode(event.target.value as "merge" | "overwrite")}>
              <Radio.Button value="merge">Merge</Radio.Button>
              <Radio.Button value="overwrite">Overwrite</Radio.Button>
            </Radio.Group>
            <Checkbox checked={importOnlyActive} onChange={(event) => setImportOnlyActive(event.target.checked)}>
              Nur aktive SKUs importieren
            </Checkbox>
            {importSourceLabel ? <Tag>{importSourceLabel}</Tag> : null}
            {importRecords.length ? <Tag color="blue">{importRecords.length} Zeilen geladen</Tag> : null}
            {importReviewOpen ? <Tag color="gold">Importkandidat bereit</Tag> : null}
          </Space>
          {importError ? <Alert type="error" showIcon message={importError} /> : null}
          {importWarnings.length ? (
            <Alert
              type="warning"
              showIcon
              message={`${importWarnings.length} Warnung(en) beim Import`}
              description={importWarnings.slice(0, 5).join(" | ")}
            />
          ) : null}
          <Text type="secondary">
            `Merge` startet aus aktiver Baseline und überlagert importierte Zellen. `Overwrite` erstellt eine Version nur aus den Importdaten.
          </Text>
        </Space>
      </Card>

      {panel === "grid" ? (
        <Card>
          <div className="v2-category-tools">
            <Text type="secondary">{filteredProducts.length} Produkte in {groupedProducts.length} Kategorien</Text>
            <div className="v2-actions-inline">
              <Button
                size="small"
                onClick={() => setExpandedCategories(groupedProducts.map((group) => group.key))}
                disabled={!groupedProducts.length}
              >
                Alles auf
              </Button>
              <Button
                size="small"
                onClick={() => setExpandedCategories([])}
                disabled={!expandedCategories.length}
              >
                Alles zu
              </Button>
            </div>
          </div>

          {!groupedProducts.length ? (
            <Text type="secondary">Keine Forecast-Zeilen für den aktuellen Filter.</Text>
          ) : (
            <Collapse
              className="v2-category-collapse"
              activeKey={expandedCategories}
              onChange={(nextKeys) => setExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
              items={groupedProducts.map((group) => ({
                key: group.key,
                label: (
                  <Space>
                    <Text strong>{group.label}</Text>
                    <span className="v2-category-count">{group.rows.length} Produkte</span>
                  </Space>
                ),
                children: (
                  <div className="v2-products-grid-host">
                    <TanStackGrid
                      className="v2-products-grid-wrap"
                      data={group.rows}
                      columns={columns}
                      minTableWidth={Math.max(920, 400 + (visibleMonths.length * 118))}
                      tableLayout="fixed"
                    />
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      ) : null}

      {panel === "versions" ? (
        <Card>
          <Title level={4}>Forecast-Versionen</Title>
          {!versions.length ? (
            <Alert type="info" showIcon message="Noch keine Forecast-Versionen vorhanden." />
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              {versions.map((version) => {
                const isActive = version.id === activeVersionId;
                return (
                  <Card key={version.id} size="small">
                    <div className="v2-page-head">
                      <div>
                        <Space wrap>
                          <Text strong>{version.name}</Text>
                          {isActive ? <Tag color="blue">Aktive Baseline</Tag> : null}
                          <Tag>{new Date(version.createdAt).toLocaleString("de-DE")}</Tag>
                          {version.sourceLabel ? <Tag>{version.sourceLabel}</Tag> : null}
                          {version.importMode ? <Tag>{version.importMode}</Tag> : null}
                        </Space>
                        <div>
                          <Text type="secondary">
                            Rows: {formatDisplay(version.stats?.rowCount ?? 0, 0)} · SKUs: {formatDisplay(version.stats?.skuCount ?? 0, 0)} · Monate: {formatDisplay(version.stats?.monthCount ?? 0, 0)}
                          </Text>
                        </div>
                        {version.note ? <Paragraph type="secondary" style={{ marginBottom: 0 }}>{version.note}</Paragraph> : null}
                      </div>
                      <Space wrap>
                        <Button size="small" onClick={() => openVersionEdit(version)}>
                          Umbenennen / Notiz
                        </Button>
                        <Button
                          size="small"
                          type={isActive ? "default" : "primary"}
                          disabled={isActive}
                          onClick={() => requestActivateVersion(version)}
                        >
                          Als Baseline aktiv setzen
                        </Button>
                        <Button
                          size="small"
                          danger
                          disabled={isActive}
                          onClick={() => requestDeleteVersion(version)}
                        >
                          Löschen
                        </Button>
                      </Space>
                    </div>
                  </Card>
                );
              })}
            </Space>
          )}
        </Card>
      ) : null}

      {panel === "impact" ? (
        <Card>
          <Title level={4}>Impact & FO-Konflikte</Title>
          {!impactSummary || !impactResult ? (
            <Alert
              type="info"
              showIcon
              message="Noch keine Impact-Analyse vorhanden."
              description="Die Analyse wird erzeugt, sobald eine Forecast-Version als Baseline aktiviert wird."
            />
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Tag color="blue">Von: {impactSummary.fromVersionName || "—"}</Tag>
                <Tag color="blue">Nach: {impactSummary.toVersionName || "—"}</Tag>
                <Tag>Verglichen: {new Date(impactSummary.comparedAt).toLocaleString("de-DE")}</Tag>
                <Tag color={impactSummary.flaggedSkus > 0 ? "gold" : "green"}>Flagged SKUs: {impactSummary.flaggedSkus}</Tag>
                <Tag color={impactSummary.flaggedAB > 0 ? "gold" : "green"}>Flagged A/B: {impactSummary.flaggedAB}</Tag>
                <Tag color={openConflictRows.length > 0 ? "red" : "green"}>FO offen: {openConflictRows.length}</Tag>
                <Tag>FO total: {impactSummary.foConflictsTotal}</Tag>
              </Space>

              {openConflictRows.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`Forecast-Änderung: ${openConflictRows.length} FOs prüfen`}
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message="Keine offenen FO-Konflikte."
                />
              )}

              <Card size="small">
                <div className="v2-page-head">
                  <Title level={5} style={{ marginBottom: 0 }}>SKU-Abweichungen</Title>
                  <Space wrap>
                    <Checkbox checked={showOnlyFlaggedSkus} onChange={(event) => setShowOnlyFlaggedSkus(event.target.checked)}>
                      Nur flagged anzeigen
                    </Checkbox>
                    <Button
                      size="small"
                      onClick={() => setImpactExpandedCategories(groupedImpactSkuRows.map((group) => group.key))}
                      disabled={!groupedImpactSkuRows.length}
                    >
                      Alles auf
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setImpactExpandedCategories([])}
                      disabled={!impactExpandedCategories.length}
                    >
                      Alles zu
                    </Button>
                  </Space>
                </div>

                {!groupedImpactSkuRows.length ? (
                  <Text type="secondary">Keine SKU-Abweichungen für den aktuellen Filter.</Text>
                ) : (
                  <Collapse
                    className="v2-category-collapse"
                    activeKey={impactExpandedCategories}
                    onChange={(nextKeys) => setImpactExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
                    items={groupedImpactSkuRows.map((group) => ({
                      key: group.key,
                      label: (
                        <Space>
                          <Text strong>{group.label}</Text>
                          <span className="v2-category-count">{group.rows.length} SKUs</span>
                        </Space>
                      ),
                      children: (
                        <div className="v2-products-grid-host">
                          <TanStackGrid
                            className="v2-products-grid-wrap"
                            data={group.rows}
                            columns={impactSkuColumns}
                            minTableWidth={1460}
                            tableLayout="fixed"
                          />
                        </div>
                      ),
                    }))}
                  />
                )}
              </Card>

              <Card size="small">
                <div className="v2-page-head">
                  <Title level={5} style={{ marginBottom: 0 }}>FO-Konflikte</Title>
                  <Checkbox checked={showIgnoredConflicts} onChange={(event) => setShowIgnoredConflicts(event.target.checked)}>
                    Ignorierte anzeigen
                  </Checkbox>
                </div>
                {!displayedConflictRows.length ? (
                  <Text type="secondary">Keine Konflikte im aktuellen Filter.</Text>
                ) : (
                  <TanStackGrid
                    data={displayedConflictRows}
                    columns={impactConflictColumns}
                    minTableWidth={1800}
                    tableLayout="fixed"
                  />
                )}
              </Card>
            </Space>
          )}
        </Card>
      ) : null}

      <Modal
        title="Import erfolgreich"
        open={importReviewOpen}
        onCancel={() => {
          clearStagedImport();
        }}
        footer={[
          <Button key="cancel" onClick={() => clearStagedImport()} disabled={importPersisting}>
            Abbrechen (verwerfen)
          </Button>,
          <Button
            key="save"
            onClick={() => { void persistImportedVersion("save"); }}
            loading={importPersisting}
            disabled={!importRecords.length}
          >
            Nur speichern
          </Button>,
          <Button
            key="activate"
            type="primary"
            onClick={() => { void persistImportedVersion("activate"); }}
            loading={importPersisting}
            disabled={!importRecords.length}
          >
            Als Baseline aktiv setzen
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>{importRecords.length} Forecast-Zeilen erkannt.</Text>
          <Input
            value={importVersionName}
            onChange={(event) => setImportVersionName(event.target.value)}
            placeholder="Versionsname"
          />
          <Input.TextArea
            value={importVersionNote}
            onChange={(event) => setImportVersionNote(event.target.value)}
            placeholder="Optionale Notiz"
            rows={3}
          />
          <Text type="secondary">
            Abbrechen verwirft den aktuellen Importkandidaten (es wird keine Version gespeichert).
          </Text>
        </Space>
      </Modal>

      <Modal
        title="Version bearbeiten"
        open={versionEditOpen}
        onCancel={() => {
          setVersionEditOpen(false);
          setVersionEditId(null);
        }}
        onOk={() => { void saveVersionEdit(); }}
        okText="Speichern"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            value={versionEditName}
            onChange={(event) => setVersionEditName(event.target.value)}
            placeholder="Versionsname"
          />
          <Input.TextArea
            value={versionEditNote}
            onChange={(event) => setVersionEditNote(event.target.value)}
            rows={3}
            placeholder="Optionale Notiz"
          />
        </Space>
      </Modal>

      <Modal
        title="Umsatz in Eingaben übertragen"
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={() => { void transferRevenueToInputs(); }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">Monate auswählen, deren Forecast-Umsatz in `incomings` übernommen wird.</Text>
          <Checkbox.Group
            value={transferSelection}
            onChange={(values) => setTransferSelection(values as string[])}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {allMonths.map((month) => (
                <Checkbox key={month} value={month}>
                  {month} · {formatDisplay(revenueByMonth.get(month) || 0, 2)} €
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Space>
      </Modal>
    </div>
  );
}
