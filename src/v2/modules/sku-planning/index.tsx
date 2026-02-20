import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import ReactECharts from "echarts-for-react";
import { useLocation, useNavigate } from "react-router-dom";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { computeInventoryProjection, getProjectionSafetyClass } from "../../../domain/inventoryProjection.js";
import { normalizeIncludeInForecast } from "../../../domain/portfolioBuckets.js";
import { buildPhantomFoSuggestions, type PhantomFoSuggestion } from "../../domain/phantomFo";
import { addMonths, currentMonthKey, formatMonthLabel, monthRange, normalizeMonthKey } from "../../domain/months";
import { getActiveForecastLabel } from "../../domain/forecastVersioning";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type PlanningViewMode = "units" | "doh";
type PlanningAbcScope = "abc" | "ab" | "a";
type RiskStatus = "ok" | "under_safety" | "oos";
type PlanningEventType = "po" | "fo" | "phantom";

interface PlanningSettings {
  horizonMonths: 6 | 12 | 18;
  abcScope: PlanningAbcScope;
  maxPhantomSuggestionsPerSku: number;
  showSimulationDefault: boolean;
}

interface ProductRow {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  isActive: boolean;
}

interface OverviewRow {
  key: string;
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  status: RiskStatus;
  nextCriticalMonth: string | null;
}

interface ProjectionCellData {
  forecastUnits: number | null;
  inboundUnits: number;
  inboundDetails: InboundDetailCell | null;
  endAvailable: number | null;
  safetyDays: number | null;
  safetyUnits: number | null;
  doh: number | null;
}

interface InboundItemDetail {
  id: string;
  ref: string;
  units: number;
  arrivalDate: string | null;
}

interface InboundDetailCell {
  totalUnits: number;
  poUnits: number;
  foUnits: number;
  poItems: InboundItemDetail[];
  foItems: InboundItemDetail[];
}

interface PhantomOverlayEntry {
  id: string;
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  arrivalMonth: string;
  arrivalDate: string | null;
  suggestedUnits: number;
  recommendedOrderDate: string | null;
  firstRiskMonth: string | null;
  orderMonth: string | null;
  leadTimeDays: number | null;
  source: "auto" | "manual";
  note: string | null;
}

interface DetailMonthRow {
  month: string;
  forecastUnits: number | null;
  baseUnits: number | null;
  baseDoh: number | null;
  simulatedUnits: number | null;
  simulatedDoh: number | null;
  safetyUnits: number | null;
  safetyDoh: number | null;
  realInboundUnits: number;
  phantomInboundUnits: number;
}

interface MonthEvent {
  id: string;
  type: PlanningEventType;
  label: string;
  units: number;
  month: string;
  date: string | null;
  poNo: string | null;
  foId: string | null;
  phantomEntryId: string | null;
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeAbcClass(value: unknown): "A" | "B" | "C" {
  const text = String(value || "").trim().toUpperCase();
  if (text === "A" || text === "B" || text === "C") return text;
  return "C";
}

function matchesAbcScope(abcClass: "A" | "B" | "C", scope: PlanningAbcScope): boolean {
  if (scope === "a") return abcClass === "A";
  if (scope === "ab") return abcClass === "A" || abcClass === "B";
  return true;
}

function resolvePlanningSettings(settings: Record<string, unknown>): PlanningSettings {
  const rawHorizon = Math.round(Number(settings.skuPlanningHorizonMonths || 0));
  const horizonMonths: 6 | 12 | 18 = rawHorizon === 6 || rawHorizon === 18 ? rawHorizon : 12;
  const rawScope = String(settings.skuPlanningAbcFilter || "abc").trim().toLowerCase();
  const abcScope: PlanningAbcScope = rawScope === "a" || rawScope === "ab" ? rawScope : "abc";
  const maxRaw = Math.round(Number(settings.skuPlanningMaxPhantomSuggestionsPerSku || 0));
  const maxPhantomSuggestionsPerSku = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 3;
  return {
    horizonMonths,
    abcScope,
    maxPhantomSuggestionsPerSku,
    showSimulationDefault: settings.skuPlanningShowSimulationByDefault !== false,
  };
}

function resolveStatus(product: Record<string, unknown>): boolean {
  if (!normalizeIncludeInForecast(product.includeInForecast, true)) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function monthFromIsoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text.slice(0, 7);
}

function monthStartIso(month: string): string | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  return `${normalized}-01`;
}

function formatInt(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.round(number).toLocaleString("de-DE");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("de-DE");
}

function daysInMonth(month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return 30;
  const [year, monthNo] = month.split("-").map(Number);
  return new Date(year, monthNo, 0).getDate();
}

function normalizeFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizePositiveInt(value: unknown, fallback = 0): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function classifyRisk(input: {
  endAvailable: number | null;
  safetyUnits: number | null;
  doh: number | null;
  safetyDays: number | null;
}): RiskStatus {
  const raw = getProjectionSafetyClass({
    projectionMode: "units",
    endAvailable: input.endAvailable,
    safetyUnits: input.safetyUnits,
    doh: input.doh,
    safetyDays: input.safetyDays,
  });
  if (raw === "safety-negative") return "oos";
  if (raw === "safety-low") return "under_safety";
  return "ok";
}

function riskTag(status: RiskStatus): JSX.Element {
  if (status === "oos") return <Tag color="red">OOS Risiko</Tag>;
  if (status === "under_safety") return <Tag color="gold">Unter Safety</Tag>;
  return <Tag color="green">Stabil</Tag>;
}

function phantomFromSuggestion(suggestion: PhantomFoSuggestion): PhantomOverlayEntry | null {
  const arrivalMonth = monthFromIsoDate(suggestion.requiredArrivalDate) || normalizeMonthKey(suggestion.firstRiskMonth) || normalizeMonthKey(suggestion.orderMonth);
  if (!arrivalMonth) return null;
  return {
    id: suggestion.id,
    sku: normalizeSku(suggestion.sku),
    alias: String(suggestion.alias || suggestion.sku || ""),
    abcClass: normalizeAbcClass(suggestion.abcClass),
    arrivalMonth,
    arrivalDate: suggestion.requiredArrivalDate || monthStartIso(arrivalMonth),
    suggestedUnits: Math.max(1, normalizePositiveInt(suggestion.suggestedUnits, 1)),
    recommendedOrderDate: suggestion.recommendedOrderDate || suggestion.latestOrderDate || null,
    firstRiskMonth: normalizeMonthKey(suggestion.firstRiskMonth),
    orderMonth: normalizeMonthKey(suggestion.orderMonth),
    leadTimeDays: normalizePositiveInt(suggestion.leadTimeDays, 0) || null,
    source: "auto",
    note: "Automatischer Vorschlag",
  };
}

function sanitizeReturnPath(pathname: string): string {
  const normalized = String(pathname || "").trim();
  if (!normalized.startsWith("/v2/")) return "/v2/sku-planung";
  return normalized;
}

export default function SkuPlanningModule(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, loading, error } = useWorkspaceState();

  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const planningSettings = useMemo(
    () => resolvePlanningSettings(settings),
    [settings],
  );
  const [planningStartMonth] = useState(() => currentMonthKey());

  const [search, setSearch] = useState("");
  const [selectedSku, setSelectedSku] = useState("");
  const [viewMode, setViewMode] = useState<PlanningViewMode>("units");
  const [showSimulation, setShowSimulation] = useState(true);
  const simulationInitRef = useRef(false);
  const [focusedMonth, setFocusedMonth] = useState("");
  const focusedMonthRef = useRef("");

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualDraftMonth, setManualDraftMonth] = useState("");
  const [manualDraftUnits, setManualDraftUnits] = useState<number>(0);

  const [dismissedAutoIds, setDismissedAutoIds] = useState<string[]>([]);
  const [adoptedPhantomIds, setAdoptedPhantomIds] = useState<string[]>([]);
  const [manualPhantomsBySku, setManualPhantomsBySku] = useState<Record<string, PhantomOverlayEntry[]>>({});
  const [phantomModalEntry, setPhantomModalEntry] = useState<PhantomOverlayEntry | null>(null);

  useEffect(() => {
    if (simulationInitRef.current) return;
    simulationInitRef.current = true;
    setShowSimulation(planningSettings.showSimulationDefault);
  }, [planningSettings.showSimulationDefault]);

  useEffect(() => {
    focusedMonthRef.current = focusedMonth;
  }, [focusedMonth]);

  const planningMonths = useMemo(
    () => monthRange(planningStartMonth, planningSettings.horizonMonths),
    [planningSettings.horizonMonths, planningStartMonth],
  );
  const projectionAnchorMonth = useMemo(
    () => addMonths(planningStartMonth, -1),
    [planningStartMonth],
  );

  const abcBySku = useMemo(
    () => computeAbcClassification(stateObject).bySku,
    [state.forecast, state.products, stateObject],
  );

  const forecastLabel = useMemo(() => {
    const forecast = (state.forecast || {}) as Record<string, unknown>;
    return getActiveForecastLabel(forecast);
  }, [state.forecast]);

  const productRows = useMemo<ProductRow[]>(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => {
        const sku = normalizeSku(entry.sku);
        const alias = String(entry.alias || sku);
        const abcEntry = abcBySku.get(sku.toLowerCase()) || abcBySku.get(sku);
        return {
          sku,
          alias,
          abcClass: normalizeAbcClass(abcEntry?.abcClass),
          isActive: resolveStatus(entry),
        } satisfies ProductRow;
      })
      .filter((entry) => entry.sku && entry.isActive)
      .filter((entry) => matchesAbcScope(entry.abcClass, planningSettings.abcScope))
      .sort((left, right) => {
        const byAlias = left.alias.localeCompare(right.alias, "de-DE", { sensitivity: "base" });
        if (byAlias !== 0) return byAlias;
        return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
      });
  }, [abcBySku, planningSettings.abcScope, state.products]);

  const projection = useMemo(() => computeInventoryProjection({
    state: stateObject,
    months: planningMonths,
    products: productRows.map((entry) => ({
      sku: entry.sku,
      alias: entry.alias,
      status: "active",
    })),
    snapshot: null,
    snapshotMonth: projectionAnchorMonth,
    projectionMode: "units",
  }), [planningMonths, productRows, projectionAnchorMonth, stateObject]);

  const overviewRows = useMemo<OverviewRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return productRows
      .map((product) => {
        const monthMap = projection.perSkuMonth.get(product.sku) as Map<string, ProjectionCellData> | undefined;
        let firstRiskMonth: string | null = null;
        let status: RiskStatus = "ok";
        for (const month of planningMonths) {
          const data = monthMap?.get(month) as ProjectionCellData | undefined;
          if (!data) continue;
          const risk = classifyRisk({
            endAvailable: normalizeFiniteNumber(data.endAvailable),
            safetyUnits: normalizeFiniteNumber(data.safetyUnits),
            doh: normalizeFiniteNumber(data.doh),
            safetyDays: normalizeFiniteNumber(data.safetyDays),
          });
          if (risk === "ok") continue;
          firstRiskMonth = month;
          status = risk;
          break;
        }
        return {
          key: product.sku,
          sku: product.sku,
          alias: product.alias,
          abcClass: product.abcClass,
          status,
          nextCriticalMonth: firstRiskMonth,
        } satisfies OverviewRow;
      })
      .filter((row) => {
        if (!needle) return true;
        return `${row.alias} ${row.sku}`.toLowerCase().includes(needle);
      })
      .sort((left, right) => {
        const riskRank = (status: RiskStatus): number => {
          if (status === "oos") return 0;
          if (status === "under_safety") return 1;
          return 2;
        };
        const byRisk = riskRank(left.status) - riskRank(right.status);
        if (byRisk !== 0) return byRisk;
        const byMonth = String(left.nextCriticalMonth || "9999-12").localeCompare(String(right.nextCriticalMonth || "9999-12"));
        if (byMonth !== 0) return byMonth;
        const byAlias = left.alias.localeCompare(right.alias, "de-DE", { sensitivity: "base" });
        if (byAlias !== 0) return byAlias;
        return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
      });
  }, [planningMonths, productRows, projection.perSkuMonth, search]);

  const selectedOverviewRow = useMemo(
    () => overviewRows.find((entry) => entry.sku === selectedSku) || null,
    [overviewRows, selectedSku],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const skuFromQuery = normalizeSku(params.get("sku"));
    if (skuFromQuery && overviewRows.some((entry) => entry.sku === skuFromQuery)) {
      if (selectedSku !== skuFromQuery) {
        setSelectedSku(skuFromQuery);
      }
      return;
    }
    if (!selectedSku || !overviewRows.some((entry) => entry.sku === selectedSku)) {
      setSelectedSku(overviewRows[0]?.sku || "");
    }
  }, [location.search, overviewRows, selectedSku]);

  useEffect(() => {
    if (!planningMonths.length) {
      setFocusedMonth("");
      return;
    }
    setFocusedMonth((current) => {
      if (current && planningMonths.includes(current)) return current;
      if (selectedOverviewRow?.nextCriticalMonth && planningMonths.includes(selectedOverviewRow.nextCriticalMonth)) {
        return selectedOverviewRow.nextCriticalMonth;
      }
      return planningMonths[0];
    });
  }, [planningMonths, selectedOverviewRow?.nextCriticalMonth, selectedSku]);

  const poNoById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.pos) ? state.pos : [])
      .map((entry) => entry as Record<string, unknown>)
      .forEach((entry) => {
        const id = String(entry.id || "").trim();
        if (!id) return;
        const poNo = String(entry.poNo || id).trim();
        map.set(id, poNo || id);
      });
    return map;
  }, [state.pos]);

  const foLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(state.fos) ? state.fos : [])
      .map((entry) => entry as Record<string, unknown>)
      .forEach((entry) => {
        const id = String(entry.id || "").trim();
        if (!id) return;
        const label = String(entry.foNo || entry.foNumber || id.slice(-6).toUpperCase() || id);
        map.set(id, label);
      });
    return map;
  }, [state.fos]);

  const allAutoSuggestions = useMemo(() => {
    if (!planningMonths.length || !productRows.length) return [] as PhantomFoSuggestion[];
    return buildPhantomFoSuggestions({
      state: stateObject,
      months: planningMonths,
      targetMonth: planningMonths[planningMonths.length - 1] || null,
      maxSuggestions: Math.max(20, productRows.length * planningSettings.maxPhantomSuggestionsPerSku * 2),
    });
  }, [
    planningMonths,
    planningSettings.maxPhantomSuggestionsPerSku,
    productRows.length,
    state.fos,
    state.forecast,
    state.pos,
    state.products,
    state.settings,
    stateObject,
  ]);

  const adoptedIdSet = useMemo(() => new Set(adoptedPhantomIds), [adoptedPhantomIds]);
  const dismissedAutoIdSet = useMemo(() => new Set(dismissedAutoIds), [dismissedAutoIds]);

  const autoPhantomEntries = useMemo<PhantomOverlayEntry[]>(() => {
    if (!selectedSku) return [];
    return allAutoSuggestions
      .map((entry) => phantomFromSuggestion(entry))
      .filter((entry): entry is PhantomOverlayEntry => Boolean(entry))
      .filter((entry) => entry.sku === selectedSku)
      .filter((entry) => matchesAbcScope(entry.abcClass, planningSettings.abcScope))
      .filter((entry) => !dismissedAutoIdSet.has(entry.id) && !adoptedIdSet.has(entry.id))
      .slice(0, planningSettings.maxPhantomSuggestionsPerSku);
  }, [
    adoptedIdSet,
    allAutoSuggestions,
    dismissedAutoIdSet,
    planningSettings.abcScope,
    planningSettings.maxPhantomSuggestionsPerSku,
    selectedSku,
  ]);

  const manualPhantomEntries = useMemo(() => {
    if (!selectedSku) return [] as PhantomOverlayEntry[];
    return (manualPhantomsBySku[selectedSku] || []).filter((entry) => !adoptedIdSet.has(entry.id));
  }, [adoptedIdSet, manualPhantomsBySku, selectedSku]);

  const activePhantomEntries = useMemo(
    () => (showSimulation ? [...autoPhantomEntries, ...manualPhantomEntries] : []),
    [autoPhantomEntries, manualPhantomEntries, showSimulation],
  );

  const phantomEntryById = useMemo(() => {
    const map = new Map<string, PhantomOverlayEntry>();
    [...autoPhantomEntries, ...manualPhantomEntries].forEach((entry) => {
      map.set(entry.id, entry);
    });
    return map;
  }, [autoPhantomEntries, manualPhantomEntries]);

  const detailRows = useMemo<DetailMonthRow[]>(() => {
    if (!selectedSku || !planningMonths.length) return [];
    const monthMap = projection.perSkuMonth.get(selectedSku) as Map<string, ProjectionCellData> | undefined;
    const phantomInboundByMonth = new Map<string, number>();
    activePhantomEntries.forEach((entry) => {
      const month = normalizeMonthKey(entry.arrivalMonth);
      if (!month) return;
      phantomInboundByMonth.set(month, (phantomInboundByMonth.get(month) || 0) + Math.max(0, Number(entry.suggestedUnits || 0)));
    });

    let simulatedPrev = Number(projection.startAvailableBySku.get(selectedSku) || 0);
    let simulatedUnknown = false;

    return planningMonths.map((month) => {
      const data = monthMap?.get(month) as ProjectionCellData | undefined;
      const forecastUnits = normalizeFiniteNumber(data?.forecastUnits);
      const baseUnits = normalizeFiniteNumber(data?.endAvailable);
      const baseDoh = normalizeFiniteNumber(data?.doh);
      const safetyUnits = normalizeFiniteNumber(data?.safetyUnits);
      const safetyDoh = normalizeFiniteNumber(data?.safetyDays);
      const realInboundUnits = Math.max(0, Number(data?.inboundUnits || 0));
      const phantomInboundUnits = Math.max(0, Number(phantomInboundByMonth.get(month) || 0));

      let simulatedUnits: number | null = baseUnits;
      if (showSimulation) {
        if (simulatedUnknown || !Number.isFinite(forecastUnits as number)) {
          simulatedUnits = null;
          simulatedUnknown = true;
        } else {
          simulatedUnits = simulatedPrev + realInboundUnits + phantomInboundUnits - Number(forecastUnits || 0);
          simulatedPrev = simulatedUnits;
        }
      }
      const simulatedDoh = Number.isFinite(simulatedUnits as number) && Number.isFinite(forecastUnits as number) && Number(forecastUnits) > 0
        ? Math.max(0, Math.round(Number(simulatedUnits) / (Number(forecastUnits) / daysInMonth(month))))
        : null;

      return {
        month,
        forecastUnits,
        baseUnits,
        baseDoh,
        simulatedUnits,
        simulatedDoh,
        safetyUnits,
        safetyDoh,
        realInboundUnits,
        phantomInboundUnits,
      };
    });
  }, [
    activePhantomEntries,
    planningMonths,
    projection.perSkuMonth,
    projection.startAvailableBySku,
    selectedSku,
    showSimulation,
  ]);

  const detailByMonth = useMemo(
    () => new Map(detailRows.map((entry) => [entry.month, entry])),
    [detailRows],
  );

  const monthEventMap = useMemo(() => {
    const map = new Map<string, MonthEvent[]>();
    planningMonths.forEach((month) => map.set(month, []));
    if (!selectedSku) return map;

    const inboundBySku = projection.inboundDetailsMap.get(selectedSku) as Map<string, InboundDetailCell> | undefined;
    inboundBySku?.forEach((detail, month) => {
      if (!map.has(month)) return;
      const monthEvents = map.get(month) as MonthEvent[];
      (Array.isArray(detail.poItems) ? detail.poItems : []).forEach((entry, index) => {
        const poNo = poNoById.get(String(entry.id || "")) || String(entry.ref || "");
        monthEvents.push({
          id: `po-${month}-${index}-${String(entry.id || "")}`,
          type: "po",
          label: poNo || "PO",
          units: Math.max(0, Math.round(Number(entry.units || 0))),
          month,
          date: entry.arrivalDate || monthStartIso(month),
          poNo: poNo || null,
          foId: null,
          phantomEntryId: null,
        });
      });
      (Array.isArray(detail.foItems) ? detail.foItems : []).forEach((entry, index) => {
        const foId = String(entry.id || "").trim();
        monthEvents.push({
          id: `fo-${month}-${index}-${foId}`,
          type: "fo",
          label: foLabelById.get(foId) || String(entry.ref || foId || "FO"),
          units: Math.max(0, Math.round(Number(entry.units || 0))),
          month,
          date: entry.arrivalDate || monthStartIso(month),
          poNo: null,
          foId: foId || null,
          phantomEntryId: null,
        });
      });
    });

    if (showSimulation) {
      activePhantomEntries.forEach((entry) => {
        if (!map.has(entry.arrivalMonth)) return;
        const monthEvents = map.get(entry.arrivalMonth) as MonthEvent[];
        monthEvents.push({
          id: `phantom-${entry.id}`,
          type: "phantom",
          label: `${entry.source === "manual" ? "Manuell" : "Vorschlag"} ${entry.id.slice(-6).toUpperCase()}`,
          units: Math.max(0, Math.round(Number(entry.suggestedUnits || 0))),
          month: entry.arrivalMonth,
          date: entry.arrivalDate || monthStartIso(entry.arrivalMonth),
          poNo: null,
          foId: null,
          phantomEntryId: entry.id,
        });
      });
    }

    const orderRank = (eventType: PlanningEventType): number => {
      if (eventType === "po") return 0;
      if (eventType === "fo") return 1;
      return 2;
    };
    map.forEach((events) => {
      events.sort((left, right) => {
        const byType = orderRank(left.type) - orderRank(right.type);
        if (byType !== 0) return byType;
        const byUnits = Number(right.units || 0) - Number(left.units || 0);
        if (byUnits !== 0) return byUnits;
        return left.label.localeCompare(right.label, "de-DE", { sensitivity: "base" });
      });
    });
    return map;
  }, [
    activePhantomEntries,
    foLabelById,
    planningMonths,
    poNoById,
    projection.inboundDetailsMap,
    selectedSku,
    showSimulation,
  ]);

  const focusedEvents = useMemo(
    () => monthEventMap.get(focusedMonth) || [],
    [focusedMonth, monthEventMap],
  );

  const focusSku = useCallback((sku: string) => {
    const normalized = normalizeSku(sku);
    if (!normalized) return;
    setSelectedSku(normalized);
    const params = new URLSearchParams(location.search);
    params.set("sku", normalized);
    const query = params.toString();
    navigate({
      pathname: location.pathname,
      search: query ? `?${query}` : "",
    }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const openManualPhantomModal = useCallback((month?: string | null) => {
    if (!selectedSku || !planningMonths.length) return;
    const candidate = normalizeMonthKey(month || focusedMonth || planningMonths[0]) || planningMonths[0];
    setManualDraftMonth(candidate);
    setManualDraftUnits(0);
    setManualModalOpen(true);
  }, [focusedMonth, planningMonths, selectedSku]);

  const addManualPhantom = useCallback(() => {
    if (!selectedSku) return;
    const arrivalMonth = normalizeMonthKey(manualDraftMonth);
    const units = normalizePositiveInt(manualDraftUnits, 0);
    if (!arrivalMonth || !planningMonths.includes(arrivalMonth) || units <= 0) return;
    const selectedRow = overviewRows.find((entry) => entry.sku === selectedSku) || null;
    const entry: PhantomOverlayEntry = {
      id: randomId("manual-phantom"),
      sku: selectedSku,
      alias: selectedRow?.alias || selectedSku,
      abcClass: selectedRow?.abcClass || "C",
      arrivalMonth,
      arrivalDate: monthStartIso(arrivalMonth),
      suggestedUnits: units,
      recommendedOrderDate: null,
      firstRiskMonth: arrivalMonth,
      orderMonth: arrivalMonth,
      leadTimeDays: null,
      source: "manual",
      note: "Manuell hinzugefuegt",
    };
    setManualPhantomsBySku((current) => ({
      ...current,
      [selectedSku]: [...(current[selectedSku] || []), entry],
    }));
    setShowSimulation(true);
    setManualModalOpen(false);
    setFocusedMonth(arrivalMonth);
  }, [manualDraftMonth, manualDraftUnits, overviewRows, planningMonths, selectedSku]);

  const discardPhantomEntry = useCallback((entry: PhantomOverlayEntry) => {
    if (entry.source === "auto") {
      setDismissedAutoIds((current) => (current.includes(entry.id) ? current : [...current, entry.id]));
      return;
    }
    setManualPhantomsBySku((current) => {
      const next = { ...current };
      next[entry.sku] = (next[entry.sku] || []).filter((row) => row.id !== entry.id);
      return next;
    });
  }, []);

  const navigateToPo = useCallback((poNo: string | null) => {
    if (!poNo) return;
    const params = new URLSearchParams();
    params.set("source", "fo_convert");
    params.set("poNo", poNo);
    params.set("returnTo", sanitizeReturnPath(location.pathname));
    if (selectedSku) params.set("returnSku", selectedSku);
    navigate(`/v2/orders/po?${params.toString()}`);
  }, [location.pathname, navigate, selectedSku]);

  const navigateToFo = useCallback((foId: string | null) => {
    if (!foId) return;
    const params = new URLSearchParams();
    params.set("source", "orders_sku");
    params.set("foId", foId);
    params.set("returnTo", sanitizeReturnPath(location.pathname));
    if (selectedSku) params.set("returnSku", selectedSku);
    navigate(`/v2/orders/fo?${params.toString()}`);
  }, [location.pathname, navigate, selectedSku]);

  const navigatePhantomToFo = useCallback((entry: PhantomOverlayEntry) => {
    setAdoptedPhantomIds((current) => (current.includes(entry.id) ? current : [...current, entry.id]));
    const params = new URLSearchParams();
    params.set("source", "phantom_fo");
    params.set("phantomId", entry.id);
    params.set("sku", entry.sku);
    params.set("month", entry.arrivalMonth);
    params.set("suggestedUnits", String(Math.max(1, Math.round(Number(entry.suggestedUnits || 0)))));
    if (entry.arrivalDate) params.set("requiredArrivalDate", entry.arrivalDate);
    if (entry.recommendedOrderDate) params.set("recommendedOrderDate", entry.recommendedOrderDate);
    if (entry.firstRiskMonth) params.set("firstRiskMonth", entry.firstRiskMonth);
    if (entry.orderMonth) params.set("orderMonth", entry.orderMonth);
    if (Number.isFinite(Number(entry.leadTimeDays))) params.set("leadTimeDays", String(Math.max(1, Math.round(Number(entry.leadTimeDays || 0)))));
    params.set("returnTo", sanitizeReturnPath(location.pathname));
    params.set("returnSku", entry.sku);
    navigate(`/v2/orders/fo?${params.toString()}`);
  }, [location.pathname, navigate]);

  const openEvent = useCallback((event: MonthEvent) => {
    if (event.type === "po") {
      navigateToPo(event.poNo);
      return;
    }
    if (event.type === "fo") {
      navigateToFo(event.foId);
      return;
    }
    const phantomEntry = event.phantomEntryId ? (phantomEntryById.get(event.phantomEntryId) || null) : null;
    if (phantomEntry) {
      setPhantomModalEntry(phantomEntry);
    }
  }, [navigateToFo, navigateToPo, phantomEntryById]);

  const markerPoints = useMemo(() => {
    const po: Array<Record<string, unknown>> = [];
    const fo: Array<Record<string, unknown>> = [];
    const phantom: Array<Record<string, unknown>> = [];
    planningMonths.forEach((month) => {
      const events = monthEventMap.get(month) || [];
      const byType: Record<PlanningEventType, MonthEvent[]> = {
        po: [],
        fo: [],
        phantom: [],
      };
      events.forEach((event) => {
        byType[event.type].push(event);
      });
      (["po", "fo", "phantom"] as PlanningEventType[]).forEach((type) => {
        const monthEntries = byType[type];
        monthEntries.forEach((event, index) => {
          const detail = detailByMonth.get(month);
          const preferred = type === "phantom"
            ? (viewMode === "doh" ? detail?.simulatedDoh : detail?.simulatedUnits)
            : (viewMode === "doh" ? detail?.baseDoh : detail?.baseUnits);
          const fallback = viewMode === "doh" ? detail?.safetyDoh : detail?.safetyUnits;
          const baseValue = Number.isFinite(preferred as number)
            ? Number(preferred)
            : (Number.isFinite(fallback as number) ? Number(fallback) : 0);
          const markerOffset = (viewMode === "doh" ? 1.2 : 30) * index;
          const payload = {
            value: [month, Math.max(0, baseValue + markerOffset)],
            month,
            eventType: event.type,
            eventId: event.id,
            label: event.label,
            units: event.units,
          };
          if (type === "po") po.push(payload);
          else if (type === "fo") fo.push(payload);
          else phantom.push(payload);
        });
      });
    });
    return { po, fo, phantom };
  }, [detailByMonth, monthEventMap, planningMonths, viewMode]);

  const chartOption = useMemo(() => {
    const unitsSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.baseUnits));
    const simulatedUnitsSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.simulatedUnits));
    const dohSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.baseDoh));
    const simulatedDohSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.simulatedDoh));
    const safetyUnitsSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.safetyUnits));
    const safetyDohSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.safetyDoh));
    const demandSeries = detailRows.map((entry) => normalizeFiniteNumber(entry.forecastUnits));

    const inventorySeries = viewMode === "doh" ? dohSeries : unitsSeries;
    const simulationSeries = viewMode === "doh" ? simulatedDohSeries : simulatedUnitsSeries;
    const safetySeries = viewMode === "doh" ? safetyDohSeries : safetyUnitsSeries;

    return {
      animation: false,
      grid: {
        left: 56,
        right: 62,
        top: 42,
        bottom: 58,
      },
      legend: {
        top: 8,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (rawParams: unknown): string => {
          const params = Array.isArray(rawParams) ? rawParams as Array<Record<string, unknown>> : [rawParams as Record<string, unknown>];
          const month = normalizeMonthKey(params[0]?.axisValue || params[0]?.name || "");
          if (month && month !== focusedMonthRef.current) {
            setFocusedMonth(month);
          }
          const row = month ? (detailByMonth.get(month) || null) : null;
          const events = month ? (monthEventMap.get(month) || []) : [];
          const stockValue = viewMode === "doh" ? row?.simulatedDoh : row?.simulatedUnits;
          const stockLabel = viewMode === "doh" ? "Bestand (DOH)" : "Bestand (Units)";
          const eventLines = events.length
            ? events.map((entry) => `${String(entry.type || "").toUpperCase()} ${entry.label}: ${formatInt(entry.units)}`).join("<br/>")
            : "Keine Events";
          return [
            `<div><strong>${month ? formatMonthLabel(month) : "—"}</strong></div>`,
            `<div>${stockLabel}: ${formatInt(stockValue)}</div>`,
            `<div>Plan-Absatz: ${formatInt(row?.forecastUnits)}</div>`,
            `<div>Events:</div>`,
            `<div>${eventLines}</div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: planningMonths,
        axisLabel: {
          formatter: (value: string) => formatMonthLabel(String(value || "")),
        },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          name: viewMode === "doh" ? "DOH" : "Units",
        },
        {
          type: "value",
          min: 0,
          name: "Plan",
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Plan-Absatz",
          type: "bar",
          yAxisIndex: 1,
          itemStyle: { color: "#64748b", opacity: 0.26 },
          emphasis: { itemStyle: { opacity: 0.35 } },
          data: demandSeries,
        },
        {
          name: "Safety Bereich",
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(245, 158, 11, 0.12)" },
          data: safetySeries,
        },
        {
          name: "Safety",
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { width: 1, type: "dashed", color: "#f59e0b" },
          data: safetySeries,
        },
        {
          name: "Bestand Basis",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          markLine: {
            symbol: "none",
            lineStyle: { type: "dotted", color: "#ef4444" },
            data: [{ yAxis: 0, name: "OOS" }],
          },
          data: inventorySeries,
        },
        ...(showSimulation ? [{
          name: "Bestand Simulation",
          type: "line",
          smooth: true,
          symbol: "diamond",
          symbolSize: 6,
          lineStyle: { width: 2, color: "#ea580c" },
          itemStyle: { color: "#ea580c" },
          data: simulationSeries,
        }] : []),
        {
          name: "PO Ankunft",
          type: "scatter",
          symbol: "circle",
          symbolSize: 11,
          itemStyle: { color: "#0f766e", borderColor: "#134e4a", borderWidth: 1 },
          tooltip: { show: false },
          data: markerPoints.po,
        },
        {
          name: "FO Ankunft",
          type: "scatter",
          symbol: "diamond",
          symbolSize: 11,
          itemStyle: { color: "#16a34a", borderColor: "#166534", borderWidth: 1 },
          tooltip: { show: false },
          data: markerPoints.fo,
        },
        ...(showSimulation ? [{
          name: "Phantom Ankunft",
          type: "scatter",
          symbol: "triangle",
          symbolSize: 13,
          itemStyle: { color: "#f97316", borderColor: "#9a3412", borderWidth: 1 },
          tooltip: { show: false },
          data: markerPoints.phantom,
        }] : []),
      ],
    };
  }, [detailByMonth, detailRows, markerPoints.fo, markerPoints.phantom, markerPoints.po, monthEventMap, planningMonths, showSimulation, viewMode]);

  const chartEvents = useMemo(
    () => ({
      click: (event: any) => {
        const data = event?.data && typeof event.data === "object"
          ? event.data as Record<string, unknown>
          : {};
        const eventType = String(data.eventType || "");
        const eventId = String(data.eventId || "");
        const month = normalizeMonthKey(data.month || event?.name || event?.value?.[0] || "");
        if (month) setFocusedMonth(month);
        if (eventType && eventId && month) {
          const entry = (monthEventMap.get(month) || []).find((row) => row.id === eventId && row.type === eventType);
          if (entry) openEvent(entry);
        }
      },
      updateAxisPointer: (event: any) => {
        const axisInfo = Array.isArray(event?.axesInfo) ? event.axesInfo[0] : null;
        if (!axisInfo) return;
        let month: string | null = null;
        if (typeof axisInfo.value === "number") {
          month = planningMonths[axisInfo.value] || null;
        } else {
          month = normalizeMonthKey(axisInfo.value);
        }
        if (month && month !== focusedMonthRef.current) {
          setFocusedMonth(month);
        }
      },
    }),
    [monthEventMap, openEvent, planningMonths],
  );

  const overviewColumns = useMemo<ColumnsType<OverviewRow>>(() => [
    {
      title: "ABC",
      dataIndex: "abcClass",
      width: 74,
      align: "center",
    },
    {
      title: "Alias",
      dataIndex: "alias",
      ellipsis: true,
    },
    {
      title: "SKU",
      dataIndex: "sku",
      width: 180,
      ellipsis: true,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 150,
      render: (value: RiskStatus) => riskTag(value),
    },
    {
      title: "Naechster kritischer Monat",
      dataIndex: "nextCriticalMonth",
      width: 190,
      render: (value: string | null) => (value ? formatMonthLabel(value) : "—"),
    },
  ], []);

  const summaryTags = useMemo(() => {
    const oosCount = overviewRows.filter((entry) => entry.status === "oos").length;
    const underSafetyCount = overviewRows.filter((entry) => entry.status === "under_safety").length;
    return { oosCount, underSafetyCount };
  }, [overviewRows]);

  const renderEventLabel = useCallback((event: MonthEvent): string => {
    if (event.type === "po") return `PO ${event.label}`;
    if (event.type === "fo") return `FO ${event.label}`;
    return `Phantom ${event.label}`;
  }, []);

  const selectedSkuLabel = selectedOverviewRow?.alias || selectedOverviewRow?.sku || "";
  const selectedSkuCriticalMonth = selectedOverviewRow?.nextCriticalMonth || null;

  return (
    <div className="v2-page v2-sku-plan-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>SKU Planung</Title>
            <Paragraph>
              Interaktive SKU-Planung mit Bestandsverlauf, PO/FO-Ankuenften und Phantom-FO Simulation als reines Overlay.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="blue">Horizont: {planningSettings.horizonMonths} Monate</Tag>
            <Tag color="default">ABC Scope: {planningSettings.abcScope.toUpperCase()}</Tag>
            <Tag color="default">Max Phantom je SKU: {planningSettings.maxPhantomSuggestionsPerSku}</Tag>
            <Tag color="green">Forecast: {forecastLabel}</Tag>
            <Tag color={summaryTags.oosCount > 0 ? "red" : "green"}>OOS Risiko: {summaryTags.oosCount}</Tag>
            <Tag color={summaryTags.underSafetyCount > 0 ? "gold" : "green"}>Unter Safety: {summaryTags.underSafetyCount}</Tag>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={10}>
          <Card>
            <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
              <Input
                placeholder="Suche Alias oder SKU"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Table<OverviewRow>
              className="v2-sku-planning-overview"
              rowKey="key"
              size="small"
              pagination={false}
              columns={overviewColumns}
              dataSource={overviewRows}
              locale={{ emptyText: "Keine SKU im aktuellen Filter." }}
              rowClassName={(record) => (record.sku === selectedSku ? "v2-sku-plan-row-active" : "")}
              onRow={(record) => ({
                onClick: () => focusSku(record.sku),
              })}
              scroll={{ y: 560 }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card>
            {!selectedOverviewRow ? (
              <Empty description="Bitte eine SKU aus der Liste waehlen." />
            ) : (
              <>
                <div className="v2-page-head" style={{ marginBottom: 10 }}>
                  <div>
                    <Title level={4} style={{ marginBottom: 2 }}>{selectedSkuLabel}</Title>
                    <Text type="secondary">
                      {selectedOverviewRow.sku} · ABC {selectedOverviewRow.abcClass}
                    </Text>
                  </div>
                  <Space wrap>
                    {riskTag(selectedOverviewRow.status)}
                    {selectedSkuCriticalMonth ? <Tag color="gold">Kritisch ab {formatMonthLabel(selectedSkuCriticalMonth)}</Tag> : <Tag color="green">Kein kritischer Monat</Tag>}
                  </Space>
                </div>

                <div className="v2-toolbar-row v2-sku-planning-controls" style={{ marginBottom: 8 }}>
                  <Segmented
                    value={viewMode}
                    options={[
                      { value: "units", label: "Units" },
                      { value: "doh", label: "DOH" },
                    ]}
                    onChange={(value) => setViewMode(String(value) === "doh" ? "doh" : "units")}
                  />
                  <Space size={8}>
                    <Text type="secondary">Simulation</Text>
                    <Switch checked={showSimulation} onChange={setShowSimulation} />
                  </Space>
                  <Button onClick={() => openManualPhantomModal(focusedMonth || null)}>
                    + Phantom-FO manuell
                  </Button>
                </div>

                <ReactECharts
                  style={{ height: 420 }}
                  option={chartOption}
                  onEvents={chartEvents}
                />

                <div className="v2-sku-planning-hints">
                  <Tag>PO Marker: Kreis</Tag>
                  <Tag color="green">FO Marker: Diamant</Tag>
                  {showSimulation ? <Tag color="orange">Phantom Marker: Dreieck (Simulation)</Tag> : <Tag color="default">Simulation aus</Tag>}
                  <Text type="secondary">Marker anklicken oeffnet PO/FO/Phantom-Detail.</Text>
                </div>

                <Card size="small" style={{ marginTop: 10 }}>
                  <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                    <Title level={5} style={{ margin: 0 }}>
                      Monat im Fokus: {focusedMonth ? formatMonthLabel(focusedMonth) : "—"}
                    </Title>
                    <Button size="small" onClick={() => openManualPhantomModal(focusedMonth || null)}>
                      Phantom fuer Monat hinzufuegen
                    </Button>
                  </Space>
                  {!focusedEvents.length ? (
                    <Text type="secondary">Keine Events in diesem Monat.</Text>
                  ) : (
                    <div className="v2-sku-planning-focus-list">
                      {focusedEvents.map((event) => (
                        <div className="v2-sku-planning-focus-item" key={event.id}>
                          <Space wrap>
                            <Tag color={event.type === "po" ? "blue" : (event.type === "fo" ? "green" : "orange")}>
                              {event.type.toUpperCase()}
                            </Tag>
                            <Text strong>{renderEventLabel(event)}</Text>
                            <Text type="secondary">Menge: {formatInt(event.units)}</Text>
                            <Text type="secondary">Datum: {formatDate(event.date)}</Text>
                            <Button size="small" onClick={() => openEvent(event)}>
                              Oeffnen
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card size="small" style={{ marginTop: 10 }}>
                  <Title level={5} style={{ marginTop: 0 }}>Automatische Phantom-FO Vorschlaege</Title>
                  {!autoPhantomEntries.length ? (
                    <Text type="secondary">Keine Vorschlaege fuer diese SKU im aktuellen Horizont.</Text>
                  ) : (
                    <div className="v2-sku-planning-focus-list">
                      {autoPhantomEntries.map((entry) => (
                        <div className="v2-sku-planning-focus-item" key={entry.id}>
                          <Space wrap>
                            <Tag color="orange">Vorschlag</Tag>
                            <Text strong>Ankunft {formatMonthLabel(entry.arrivalMonth)}</Text>
                            <Text>Menge {formatInt(entry.suggestedUnits)}</Text>
                            <Text type="secondary">Bestellen bis: {formatDate(entry.recommendedOrderDate)}</Text>
                            <Button size="small" type="primary" onClick={() => navigatePhantomToFo(entry)}>
                              Als echte FO anlegen
                            </Button>
                            <Button size="small" onClick={() => discardPhantomEntry(entry)}>
                              Verwerfen
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card size="small" style={{ marginTop: 10 }}>
                  <Title level={5} style={{ marginTop: 0 }}>Manuelle Phantom-FOs</Title>
                  {!manualPhantomEntries.length ? (
                    <Text type="secondary">Noch keine manuellen Phantom-FOs.</Text>
                  ) : (
                    <div className="v2-sku-planning-focus-list">
                      {manualPhantomEntries.map((entry) => (
                        <div className="v2-sku-planning-focus-item" key={entry.id}>
                          <Space wrap>
                            <Tag>Manuell</Tag>
                            <Text strong>Ankunft {formatMonthLabel(entry.arrivalMonth)}</Text>
                            <Text>Menge {formatInt(entry.suggestedUnits)}</Text>
                            <Button size="small" type="primary" onClick={() => navigatePhantomToFo(entry)}>
                              Als echte FO anlegen
                            </Button>
                            <Button size="small" onClick={() => discardPhantomEntry(entry)}>
                              Entfernen
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="Phantom-FO manuell hinzufügen"
        open={manualModalOpen}
        onCancel={() => setManualModalOpen(false)}
        onOk={addManualPhantom}
        okButtonProps={{ disabled: !manualDraftMonth || manualDraftUnits <= 0 }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">SKU: {selectedSkuLabel || selectedSku || "—"}</Text>
          <Select
            value={manualDraftMonth || undefined}
            onChange={(value) => setManualDraftMonth(String(value || ""))}
            options={planningMonths.map((month) => ({
              value: month,
              label: formatMonthLabel(month),
            }))}
          />
          <InputNumber
            value={manualDraftUnits}
            min={1}
            style={{ width: "100%" }}
            controls={false}
            onChange={(value) => setManualDraftUnits(normalizePositiveInt(value, 0))}
            placeholder="Menge (Units)"
          />
        </Space>
      </Modal>

      <Modal
        title="Phantom-FO Detail"
        open={Boolean(phantomModalEntry)}
        onCancel={() => setPhantomModalEntry(null)}
        footer={phantomModalEntry ? (
          <Space>
            <Button onClick={() => {
              discardPhantomEntry(phantomModalEntry);
              setPhantomModalEntry(null);
            }}
            >
              Verwerfen
            </Button>
            <Button
              type="primary"
              onClick={() => {
                navigatePhantomToFo(phantomModalEntry);
                setPhantomModalEntry(null);
              }}
            >
              Als echte FO anlegen
            </Button>
          </Space>
        ) : null}
      >
        {phantomModalEntry ? (
          <Space direction="vertical">
            <Text>SKU: <strong>{phantomModalEntry.alias} ({phantomModalEntry.sku})</strong></Text>
            <Text>ABC: {phantomModalEntry.abcClass}</Text>
            <Text>Ankunft: {formatMonthLabel(phantomModalEntry.arrivalMonth)}</Text>
            <Text>Menge: {formatInt(phantomModalEntry.suggestedUnits)}</Text>
            <Text>Bestellen bis: {formatDate(phantomModalEntry.recommendedOrderDate)}</Text>
            <Text type="secondary">
              Hinweis: Phantom-FOs werden nur in der SKU Planung als Simulation angezeigt und nicht in P&L/Cashflow verbucht.
            </Text>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
