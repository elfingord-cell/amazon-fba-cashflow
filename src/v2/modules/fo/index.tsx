import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  message,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocation, useNavigate } from "react-router-dom";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { OrdersGanttTimeline, type OrdersGanttGroup, type OrdersGanttItem } from "../../components/OrdersGanttTimeline";
import { safeTimelineSpanMs, timelineRangeFromIsoDates, toTimelineMs } from "../../components/ordersTimelineUtils";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { getActiveForecastVersion } from "../../domain/forecastVersioning";
import { applyAdoptedFieldToProduct, resolveMasterDataHierarchy, sourceChipClass } from "../../domain/masterDataHierarchy";
import { evaluateOrderBlocking } from "../../domain/productCompletenessV2";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import { useModalCollaboration } from "../../sync/modalCollaboration";
import {
  FO_STATUS_VALUES,
  INCOTERMS,
  PAYMENT_CURRENCIES,
  PAYMENT_TRIGGERS,
  TRANSPORT_MODES,
  type FoStatus,
  buildFoPayments,
  buildFoRecommendationContext,
  computeFoCostValues,
  computeFoRecommendationForSku,
  computeFoSchedule,
  computeScheduleFromOrderDate,
  convertToEur,
  createPoFromFo,
  createPoFromFos,
  extractSupplierTerms,
  isFoConvertibleStatus,
  normalizeFoStatus,
  normalizeFoRecord,
  nowIso,
  resolveProductBySku,
  suggestNextFoNumber,
  sumSupplierPercent,
  type SupplierPaymentTermDraft,
} from "../../domain/orderUtils";

const { Paragraph, Text, Title } = Typography;

interface FoFormValues {
  id?: string;
  sku: string;
  supplierId: string;
  status: FoStatus;
  targetDeliveryDate: string;
  units: number;
  transportMode: string;
  incoterm: string;
  unitPrice: number;
  currency: string;
  freight: number;
  freightCurrency: string;
  dutyRatePct: number;
  eustRatePct: number;
  fxRate: number;
  productionLeadTimeDays: number;
  logisticsLeadTimeDays: number;
  bufferDays: number;
  paymentTerms: SupplierPaymentTermDraft[];
}

interface FoRow {
  id: string;
  foNo: string | null;
  foNumber: string | null;
  displayNumber: string;
  sku: string;
  alias: string;
  supplierId: string;
  supplierName: string;
  units: number;
  targetDeliveryDate: string | null;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  landedCostEur: number;
  status: string;
  convertedPoNo: string | null;
  forecastBasisLabel: string;
  forecastConflictState: string | null;
  recommendationText: string;
  recommendationUnits: number | null;
  raw: Record<string, unknown>;
}

interface FoPaymentPreviewRow {
  id: string;
  label: string;
  category: "supplier" | "freight" | "duty" | "eust" | "eust_refund";
  currency: string;
  amount: number;
  plannedEur: number;
  dueDate: string | null;
  triggerEvent: string;
  offsetDays: number;
  offsetMonths: number;
}

interface CoverageDemandBreakdownRow {
  month: string;
  daysCovered: number;
  forecastMonthUnits: number | null;
  demandUnitsInWindow: number;
  usedFallback: boolean;
}

function formatDate(value: unknown): string {
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

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function normalizeCoverageDemandBreakdown(input: unknown): CoverageDemandBreakdownRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => ({
      month: String(entry.month || ""),
      daysCovered: Math.max(0, Number(entry.daysCovered || 0)),
      forecastMonthUnits: Number.isFinite(Number(entry.forecastMonthUnits))
        ? Number(entry.forecastMonthUnits)
        : null,
      demandUnitsInWindow: Number.isFinite(Number(entry.demandUnitsInWindow))
        ? Number(entry.demandUnitsInWindow)
        : 0,
      usedFallback: Boolean(entry.usedFallback),
    }))
    .filter((entry) => /^\d{4}-\d{2}$/.test(entry.month));
}

function statusTag(status: string): JSX.Element {
  const normalized = normalizeFoStatus(status);
  if (normalized === "ACTIVE") return <Tag color="green">Active</Tag>;
  if (normalized === "CONVERTED") return <Tag color="blue">Converted</Tag>;
  if (normalized === "ARCHIVED") return <Tag color="default">Archived</Tag>;
  return <Tag color="gold">Draft</Tag>;
}

function formatForecastConflictState(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "—";
  if (normalized === "review_needed") return "Review nötig";
  if (normalized === "reviewed_updated") return "Aktualisiert";
  if (normalized === "superseded") return "Superseded";
  if (normalized === "ignored") return "Ignoriert";
  return String(value || "—");
}

function nextPlanningStatus(status: FoStatus): FoStatus {
  return status === "ACTIVE" ? "DRAFT" : "ACTIVE";
}

function formatFoPaymentCategory(category: FoPaymentPreviewRow["category"]): string {
  if (category === "supplier") return "Supplier";
  if (category === "freight") return "Shipping China -> 3PL";
  if (category === "duty") return "Custom Duties";
  if (category === "eust") return "Einfuhrumsatzsteuer";
  return "EUSt Erstattung";
}

function isProductActive(product: Record<string, unknown>): boolean {
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function suggestNextPoNo(pos: unknown[]): string {
  let best = 0;
  const regex = /(\d+)(?!.*\d)/;
  (pos || []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const match = regex.exec(String(row.poNo || ""));
    if (!match) return;
    const numeric = Number(match[1]);
    if (Number.isFinite(numeric) && numeric > best) best = numeric;
  });
  if (best > 0) return String(best + 1);
  return String((pos || []).length + 1);
}

function normalizeFoNumberToken(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, "");
  return compact.startsWith("FO") ? compact.slice(2) : compact;
}

function resolveFoDisplayNumber(input: {
  foNo?: unknown;
  foNumber?: unknown;
  id?: unknown;
}): string {
  const byFoNo = normalizeFoNumberToken(input.foNo);
  if (byFoNo) return byFoNo;
  const byFoNumber = normalizeFoNumberToken(input.foNumber);
  if (byFoNumber) return byFoNumber;
  return String(input.id || "").slice(-6).toUpperCase();
}

function normalizeIsoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function compareIsoDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function resolveFoViewMode(search: string): "table" | "timeline" {
  const params = new URLSearchParams(search);
  return params.get("view") === "timeline" ? "timeline" : "table";
}

function etaSortValue(row: unknown): string {
  return normalizeIsoDate((row as { etaDate?: unknown })?.etaDate) || "9999-12-31";
}

function resolveFoTargetDeliveryDate(fo: Record<string, unknown>): string | null {
  return (
    normalizeIsoDate(fo.targetDeliveryDate)
    || normalizeIsoDate(fo.deliveryDate)
    || normalizeIsoDate(fo.etaDate)
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeTransportMode(value: unknown): string {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "AIR" || upper === "SEA" || upper === "RAIL") return upper;
  return "RAIL";
}

function resolveSettingsFxRate(settings: Record<string, unknown>): number {
  return Number(toPositiveNumberOrNull(settings.fxRate) ?? 0);
}

function resolveSettingsTransportLeadTime(settings: Record<string, unknown>, transportMode: unknown): { days: number; sourceMode: string | null } {
  const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const preferred = normalizeTransportMode(transportMode);
  const fallbackModes = [preferred, "RAIL", "SEA", "AIR"];
  const seen = new Set<string>();
  for (let index = 0; index < fallbackModes.length; index += 1) {
    const mode = fallbackModes[index];
    if (seen.has(mode)) continue;
    seen.add(mode);
    const parsed = Number(transportLeadMap[mode.toLowerCase()]);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    return { days: Math.max(0, Math.round(parsed)), sourceMode: mode };
  }
  return { days: 0, sourceMode: null };
}

function templateFields(product: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const template = (product?.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function resolveSkuMasterUnitPrice(product: Record<string, unknown> | null | undefined): number {
  const template = templateFields(product);
  return Number(
    toPositiveNumberOrNull(template.unitPriceUsd)
    ?? toPositiveNumberOrNull(product?.unitPriceUsd)
    ?? toPositiveNumberOrNull(product?.unitPrice)
    ?? 0,
  );
}

function resolveSkuMasterShippingPerUnit(product: Record<string, unknown> | null | undefined): number {
  const template = templateFields(product);
  return Number(
    toPositiveNumberOrNull(product?.logisticsPerUnitEur)
    ?? toPositiveNumberOrNull(product?.freightPerUnitEur)
    ?? toPositiveNumberOrNull(template.logisticsPerUnitEur)
    ?? toPositiveNumberOrNull(template.freightEur)
    ?? 0,
  );
}

function resolveFoProductPrefill(input: {
  state: Record<string, unknown>;
  product: Record<string, unknown> | null;
  supplier: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  supplierId?: string;
  transportMode?: string;
  units: number;
}): Partial<FoFormValues> {
  const product = input.product || {};
  const supplier = input.supplier || {};
  const settings = input.settings || {};
  const hierarchy = resolveMasterDataHierarchy({
    state: input.state || {},
    product,
    sku: String(product.sku || ""),
    supplierId: input.supplierId || String(product.supplierId || ""),
    orderContext: "fo",
  });

  const unitPrice = resolveSkuMasterUnitPrice(product);
  const fxRate = resolveSettingsFxRate(settings);
  const logisticsPerUnit = resolveSkuMasterShippingPerUnit(product);
  const freight = Math.max(0, round2(logisticsPerUnit));
  const transportMode = normalizeTransportMode(input.transportMode || "RAIL");
  const logisticsLead = resolveSettingsTransportLeadTime(settings, transportMode).days;
  const productionLead = Number(hierarchy.fields.productionLeadTimeDays.value || 45);
  const ddp = hierarchy.fields.ddp.value === true;
  const incoterm = String(supplier.incotermDefault || hierarchy.fields.incoterm.value || (ddp ? "DDP" : "EXW")).toUpperCase();

  return {
    transportMode,
    incoterm,
    unitPrice,
    currency: "USD",
    freight,
    freightCurrency: "EUR",
    dutyRatePct: Number(hierarchy.fields.dutyRatePct.value || 0),
    eustRatePct: Number(hierarchy.fields.eustRatePct.value || 0),
    fxRate,
    productionLeadTimeDays: Math.max(0, Math.round(productionLead)),
    logisticsLeadTimeDays: Math.max(0, Math.round(logisticsLead)),
    bufferDays: Math.max(0, Math.round(toNumberOrNull(settings.defaultBufferDays) ?? 0)),
  };
}

function resolveLeadTimeSourceInfo(input: {
  product: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  transportMode?: string | null;
}): {
  production: string;
  logistics: string;
} {
  const product = input.product || {};
  const settings = input.settings || {};
  const template = templateFields(product);
  const effectiveTransport = normalizeTransportMode(input.transportMode || "RAIL");
  const transportLead = resolveSettingsTransportLeadTime(settings, effectiveTransport);

  let production = "Fallback";
  if (toPositiveNumberOrNull(product.productionLeadTimeDaysDefault) != null) {
    production = "Produkt-Override";
  } else if (toPositiveNumberOrNull(template.productionDays) != null) {
    production = "Beschaffungs-Template";
  } else if (toPositiveNumberOrNull(settings.defaultProductionLeadTimeDays) != null) {
    production = "Settings-Default";
  }

  let logistics = "Fallback";
  if (transportLead.sourceMode) {
    logistics = `Settings-Default (${transportLead.sourceMode})`;
  }

  return { production, logistics };
}

export interface FoModuleProps {
  embedded?: boolean;
}

export default function FoModule({ embedded = false }: FoModuleProps = {}): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | FoStatus>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTargetId, setConvertTargetId] = useState<string | null>(null);
  const [convertPoNo, setConvertPoNo] = useState("");
  const [convertOrderDate, setConvertOrderDate] = useState("");
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePoNo, setMergePoNo] = useState("");
  const [mergeOrderDate, setMergeOrderDate] = useState("");
  const [mergeTargetMode, setMergeTargetMode] = useState<"earliest" | "manual">("earliest");
  const [mergeManualTargetDate, setMergeManualTargetDate] = useState("");
  const [mergeAllowMixedTerms, setMergeAllowMixedTerms] = useState(false);
  const [form] = Form.useForm<FoFormValues>();
  const foViewMode = useMemo<"table" | "timeline">(
    () => resolveFoViewMode(location.search),
    [location.search],
  );

  const stateObj = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const displayNameMap = useMemo(() => readCollaborationDisplayNames(settings), [settings]);
  const ownDisplayName = useMemo(() => {
    return resolveCollaborationUserLabel({
      userId: syncSession.userId,
      userEmail: syncSession.email,
    }, displayNameMap);
  }, [displayNameMap, syncSession.email, syncSession.userId]);
  const modalScope = useMemo(
    () => `fo:edit:${String(editingId || "new")}`,
    [editingId],
  );
  const modalCollab = useModalCollaboration({
    workspaceId: syncSession.workspaceId,
    modalScope,
    isOpen: modalOpen,
    userId: syncSession.userId,
    userEmail: syncSession.email,
    userDisplayName: ownDisplayName,
    displayNames: displayNameMap,
  });

  function updateFoViewMode(next: "table" | "timeline"): void {
    const params = new URLSearchParams(location.search);
    if (next === "timeline") params.set("view", "timeline");
    else params.delete("view");
    const query = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: query ? `?${query}` : "",
      },
      { replace: true },
    );
  }

  const supplierRows = useMemo(() => {
    return (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        id: String(entry.id || ""),
        name: String(entry.name || "—"),
        productionLeadTimeDaysDefault: Number(entry.productionLeadTimeDaysDefault) || 0,
        incotermDefault: String(entry.incotermDefault || "EXW").toUpperCase(),
        currencyDefault: String(entry.currencyDefault || "EUR").toUpperCase(),
        raw: entry,
      }))
      .filter((entry) => entry.id);
  }, [state.suppliers]);

  const supplierById = useMemo(() => new Map(supplierRows.map((entry) => [entry.id, entry.raw])), [supplierRows]);

  const productRows = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        sku: String(entry.sku || ""),
        alias: String(entry.alias || entry.sku || ""),
        status: String(entry.status || "active"),
        supplierId: String(entry.supplierId || ""),
        productionLeadTimeDaysDefault: Number(entry.productionLeadTimeDaysDefault) || 0,
        raw: entry,
      }))
      .filter((entry) => entry.sku);
  }, [state.products]);

  const productBySku = useMemo(() => new Map(productRows.map((entry) => [entry.sku, entry])), [productRows]);
  const activeForecastVersion = useMemo(
    () => getActiveForecastVersion((state.forecast || {}) as Record<string, unknown>),
    [state.forecast],
  );

  const recommendationContext = useMemo(
    () => buildFoRecommendationContext(stateObj),
    [state.forecast, state.inventory, state.pos, state.fos],
  );

  const rows = useMemo(() => {
    const allRows = (Array.isArray(state.fos) ? state.fos : []).map((entry) => {
      const fo = entry as Record<string, unknown>;
      const sku = String(fo.sku || "");
      const product = productBySku.get(sku);
      const supplier = supplierRows.find((row) => row.id === String(fo.supplierId || ""));
      const scheduleFromTarget = computeFoSchedule({
        targetDeliveryDate: fo.targetDeliveryDate,
        productionLeadTimeDays: fo.productionLeadTimeDays,
        logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
        bufferDays: fo.bufferDays,
      });
      const schedule = {
        orderDate: String(fo.orderDate || scheduleFromTarget.orderDate || ""),
        etdDate: String(fo.etdDate || scheduleFromTarget.etdDate || ""),
        etaDate: String(fo.etaDate || scheduleFromTarget.etaDate || ""),
      };
      const costs = computeFoCostValues({
        units: fo.units,
        unitPrice: fo.unitPrice,
        currency: fo.currency,
        freight: fo.freight,
        freightCurrency: fo.freightCurrency,
        dutyRatePct: fo.dutyRatePct,
        eustRatePct: fo.eustRatePct,
        fxRate: fo.fxRate,
      });
      const leadTimeDays =
        Number(fo.productionLeadTimeDays || 0)
        + Number(fo.logisticsLeadTimeDays || 0)
        + Number(fo.bufferDays || 0);
      const recommendation = computeFoRecommendationForSku({
        context: recommendationContext,
        sku,
        leadTimeDays,
        product: resolveProductBySku(
          productRows.map((item) => item.raw),
          sku,
        ),
        settings,
        horizonMonths: 12,
      });
      let recommendationText = "—";
      let recommendationUnits: number | null = null;
      if (recommendation) {
        if (recommendation.status === "no_fo_needed") {
          recommendationText = "Keine FO erforderlich";
        } else if (recommendation.status === "ok") {
          recommendationUnits = Number(recommendation.recommendedUnits || 0);
          recommendationText = `${formatNumber(recommendationUnits, 0)} Units`;
        } else {
          recommendationText = "Nicht berechenbar";
        }
      }

      return {
        id: String(fo.id || ""),
        foNo: String(fo.foNo || "").trim() || null,
        foNumber: String(fo.foNumber || "").trim() || null,
        displayNumber: resolveFoDisplayNumber({
          foNo: fo.foNo,
          foNumber: fo.foNumber,
          id: fo.id,
        }),
        sku,
        alias: product?.alias || sku || "—",
        supplierId: String(fo.supplierId || ""),
        supplierName: supplier?.name || "—",
        units: Number(fo.units || 0),
        targetDeliveryDate: fo.targetDeliveryDate ? String(fo.targetDeliveryDate) : null,
        orderDate: schedule.orderDate || null,
        etdDate: schedule.etdDate || null,
        etaDate: schedule.etaDate || null,
        landedCostEur: round2(costs.landedCostEur),
        status: normalizeFoStatus(fo.status),
        convertedPoNo: fo.convertedPoNo ? String(fo.convertedPoNo) : null,
        forecastBasisLabel: String(fo.forecastBasisVersionName || fo.forecastBasisVersionId || "—"),
        forecastConflictState: String(fo.forecastConflictState || "").trim() || null,
        recommendationText,
        recommendationUnits,
        raw: fo,
      } satisfies FoRow;
    });

    const needle = search.trim().toLowerCase();
    return allRows
      .filter((row) => {
        if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
        if (!needle) return true;
        return [
          row.displayNumber,
          row.foNo || "",
          row.foNumber || "",
          row.alias,
          row.sku,
          row.supplierName,
          row.status,
        ].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => (a.targetDeliveryDate || "").localeCompare(b.targetDeliveryDate || ""));
  }, [
    productBySku,
    productRows,
    recommendationContext,
    search,
    settings,
    state.fos,
    statusFilter,
    supplierRows,
  ]);

  const foById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.fos) ? state.fos : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "").trim();
      if (!id) return;
      map.set(id, row);
    });
    return map;
  }, [state.fos]);

  const mergeSelectedFos = useMemo(() => {
    return mergeSelection
      .map((id) => foById.get(id) || null)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry) => isFoConvertibleStatus(entry.status));
  }, [foById, mergeSelection]);

  const mergeEarliestTargetDate = useMemo(() => {
    return mergeSelectedFos
      .map((fo) => resolveFoTargetDeliveryDate(fo))
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => compareIsoDate(a, b))[0] || "";
  }, [mergeSelectedFos]);

  const mergeResolvedTargetDate = useMemo(() => {
    if (mergeTargetMode === "manual") return normalizeIsoDate(mergeManualTargetDate) || null;
    return normalizeIsoDate(mergeEarliestTargetDate) || null;
  }, [mergeEarliestTargetDate, mergeManualTargetDate, mergeTargetMode]);

  const mergeSupplierIds = useMemo(
    () => Array.from(new Set(mergeSelectedFos.map((fo) => String(fo.supplierId || "").trim()).filter(Boolean))),
    [mergeSelectedFos],
  );
  const mergeHasSupplierMismatch = mergeSupplierIds.length > 1;
  const mergeTransportModes = useMemo(
    () => Array.from(new Set(mergeSelectedFos.map((fo) => String(fo.transportMode || "").trim().toUpperCase()).filter(Boolean))),
    [mergeSelectedFos],
  );
  const mergeIncoterms = useMemo(
    () => Array.from(new Set(mergeSelectedFos.map((fo) => String(fo.incoterm || "").trim().toUpperCase()).filter(Boolean))),
    [mergeSelectedFos],
  );
  const mergeHasMixedTerms = mergeTransportModes.length > 1 || mergeIncoterms.length > 1;
  const mergeTimelineRows = useMemo(() => {
    if (!mergeResolvedTargetDate) return [];
    return mergeSelectedFos.map((fo) => {
      const target = resolveFoTargetDeliveryDate(fo);
      const compare = compareIsoDate(target, mergeResolvedTargetDate);
      const deviation = compare < 0 ? "Zu spät bei gemeinsamer PO" : compare > 0 ? "Früher als Ziel" : "Passt";
      return {
        id: String(fo.id || ""),
        sku: String(fo.sku || ""),
        targetDate: target,
        deviation,
        status: compare,
      };
    });
  }, [mergeResolvedTargetDate, mergeSelectedFos]);

  function toggleMergeSelectionForRow(rowId: string, checked: boolean): void {
    setMergeSelection((current) => {
      if (checked) return Array.from(new Set([...current, rowId]));
      return current.filter((entry) => entry !== rowId);
    });
  }

  function openConvertModalForRow(row: FoRow): void {
    setConvertTargetId(row.id);
    setConvertPoNo(suggestNextPoNo(Array.isArray(state.pos) ? state.pos : []));
    setConvertOrderDate(row.orderDate || "");
    setConvertOpen(true);
  }

  const foTimelineWindow = useMemo(
    () => timelineRangeFromIsoDates({
      state: stateObj,
      dates: rows.flatMap((row) => [row.orderDate, row.etdDate, row.etaDate, row.targetDeliveryDate]),
      fallbackHorizon: 12,
    }),
    [rows, stateObj],
  );

  const foTimelinePayload = useMemo(() => {
    const groups: OrdersGanttGroup[] = [];
    const items: OrdersGanttItem[] = [];
    const itemRowMap = new Map<string, FoRow>();

    rows.forEach((row) => {
      const canSelectForMerge = isFoConvertibleStatus(row.status);
      groups.push({
        id: row.id,
        title: (
          <div className="v2-orders-gantt-meta">
            <div className="v2-orders-gantt-topline">
              <Checkbox
                checked={mergeSelection.includes(row.id)}
                disabled={!canSelectForMerge}
                onChange={(event) => toggleMergeSelectionForRow(row.id, event.target.checked)}
              />
              <Text strong>FO {row.displayNumber}</Text>
              {statusTag(row.status)}
            </div>
            <div className="v2-orders-gantt-subline">
              {row.alias} ({row.sku}) · {row.supplierName}
            </div>
            <div className="v2-orders-gantt-subline">
              Target {formatDate(row.targetDeliveryDate)} · ETA {formatDate(row.etaDate)}
            </div>
            <div className="v2-orders-gantt-actionline">
              <Button size="small" onClick={() => openEditModal(row.raw)}>
                {canSelectForMerge ? "Bearbeiten" : "Details"}
              </Button>
              <Button
                size="small"
                disabled={!canSelectForMerge}
                onClick={() => openConvertModalForRow(row)}
              >
                Convert
              </Button>
              {row.convertedPoNo ? (
                <Button
                  size="small"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set("source", "fo_convert");
                    params.set("poNo", String(row.convertedPoNo || ""));
                    navigate(`/v2/orders/po?${params.toString()}`);
                  }}
                >
                  PO öffnen
                </Button>
              ) : null}
            </div>
          </div>
        ),
      });

      const orderMs = toTimelineMs(row.orderDate);
      const etdMs = toTimelineMs(row.etdDate);
      const etaMs = toTimelineMs(row.etaDate || row.targetDeliveryDate);
      const productionStart = orderMs ?? etdMs;
      const productionEnd = etdMs;
      if (productionStart != null && productionEnd != null) {
        const span = safeTimelineSpanMs({ startMs: productionStart, endMs: productionEnd });
        const itemId = `${row.id}:production`;
        items.push({
          id: itemId,
          group: row.id,
          title: `FO ${row.displayNumber} · Produktion`,
          startMs: span.startMs,
          endMs: span.endMs,
          className: "v2-orders-gantt-item v2-orders-gantt-item--fo-production",
          tooltip: [
            `FO: ${row.displayNumber}`,
            `Produkt: ${row.alias} (${row.sku})`,
            `Produktion: ${formatDate(row.orderDate)} bis ${formatDate(row.etdDate)}`,
          ].join("\n"),
        });
        itemRowMap.set(itemId, row);
      }
      if (etaMs != null) {
        const transitStart = etdMs ?? orderMs ?? etaMs;
        const span = safeTimelineSpanMs({ startMs: transitStart, endMs: etaMs });
        const itemId = `${row.id}:transit`;
        items.push({
          id: itemId,
          group: row.id,
          title: `FO ${row.displayNumber} · Transit`,
          startMs: span.startMs,
          endMs: span.endMs,
          className: "v2-orders-gantt-item v2-orders-gantt-item--fo-transit",
          tooltip: [
            `FO: ${row.displayNumber}`,
            `Produkt: ${row.alias} (${row.sku})`,
            `Transit: ${formatDate(row.etdDate || row.orderDate)} bis ${formatDate(row.etaDate || row.targetDeliveryDate)}`,
          ].join("\n"),
        });
        itemRowMap.set(itemId, row);
      }
    });

    return { groups, items, itemRowMap };
  }, [mergeSelection, navigate, rows, state.pos]);

  useEffect(() => {
    setMergeSelection((current) =>
      current.filter((id) => {
        const fo = foById.get(id);
        return Boolean(fo) && isFoConvertibleStatus(fo?.status);
      }),
    );
  }, [foById]);

  const columns = useMemo<ColumnDef<FoRow>[]>(() => [
    {
      header: "Merge",
      meta: { width: 84, minWidth: 84 },
      cell: ({ row }) => {
        const canSelect = isFoConvertibleStatus(row.original.status);
        return (
          <Checkbox
            checked={mergeSelection.includes(row.original.id)}
            disabled={!canSelect}
            onChange={(event) => {
              toggleMergeSelectionForRow(row.original.id, event.target.checked);
            }}
          />
        );
      },
    },
    {
      header: "FO",
      cell: ({ row }) => row.original.displayNumber,
    },
    {
      header: "Produkt",
      meta: { width: 220, minWidth: 220 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    { header: "Supplier", accessorKey: "supplierName" },
    {
      header: "Units",
      cell: ({ row }) => formatNumber(row.original.units, 0),
    },
    {
      header: "Target",
      cell: ({ row }) => formatDate(row.original.targetDeliveryDate),
    },
    {
      header: "Order",
      cell: ({ row }) => formatDate(row.original.orderDate),
    },
    {
      header: "ETD / ETA",
      meta: { sortAccessor: etaSortValue },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>ETD {formatDate(row.original.etdDate)}</Text>
          <Text type="secondary">ETA {formatDate(row.original.etaDate)}</Text>
        </Space>
      ),
    },
    {
      header: "Landed EUR",
      cell: ({ row }) => formatCurrency(row.original.landedCostEur),
    },
    {
      header: "Empfehlung",
      cell: ({ row }) => row.original.recommendationText,
    },
    {
      header: "Forecast-Basis",
      meta: { width: 210, minWidth: 210 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>{row.original.forecastBasisLabel || "—"}</Text>
          <Text type="secondary">{formatForecastConflictState(row.original.forecastConflictState)}</Text>
        </Space>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => statusTag(row.original.status),
    },
    {
      header: "Aktionen",
      meta: { width: 250, minWidth: 250 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button
            size="small"
            onClick={() => {
              openEditModal(row.original.raw);
            }}
          >
            {isFoConvertibleStatus(row.original.status) ? "Bearbeiten" : "Details"}
          </Button>
          <Button
            size="small"
            disabled={!isFoConvertibleStatus(row.original.status)}
            onClick={() => {
              openConvertModalForRow(row.original);
            }}
          >
            Convert
          </Button>
          {row.original.convertedPoNo ? (
            <Button
              size="small"
              onClick={() => {
                const params = new URLSearchParams();
                params.set("source", "fo_convert");
                params.set("poNo", String(row.original.convertedPoNo || ""));
                navigate(`/v2/orders/po?${params.toString()}`);
              }}
            >
              PO öffnen
            </Button>
          ) : null}
          <Button
            size="small"
            danger
            disabled={!isFoConvertibleStatus(row.original.status)}
            onClick={() => {
              Modal.confirm({
                title: "FO loeschen?",
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.fos = (Array.isArray(next.fos) ? next.fos : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    return next;
                  }, "v2:fo:delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </div>
      ),
    },
  ], [mergeSelection, navigate, saveWith, state.pos]);

  const draftValues = Form.useWatch([], form) as FoFormValues | undefined;
  const editingRow = useMemo(
    () => (editingId ? rows.find((entry) => entry.id === editingId) || null : null),
    [editingId, rows],
  );
  const draftStatus = useMemo<FoStatus>(() => {
    return normalizeFoStatus(draftValues?.status || editingRow?.status || "DRAFT");
  }, [draftValues?.status, editingRow?.status]);
  const draftStatusLocked = !isFoConvertibleStatus(draftStatus);
  const modalFieldLocked = modalCollab.readOnly || draftStatusLocked;
  const draftConvertedPoNo = String(
    editingRow?.convertedPoNo
    || (editingRow?.raw?.convertedPoNo as string | undefined)
    || "",
  ).trim();
  const selectedDraftProduct = useMemo(() => {
    const sku = String(draftValues?.sku || "").trim();
    return sku ? (productBySku.get(sku)?.raw || null) : null;
  }, [draftValues?.sku, productBySku]);

  const foHierarchy = useMemo(() => {
    return resolveMasterDataHierarchy({
      state: stateObj,
      product: selectedDraftProduct || undefined,
      sku: String(draftValues?.sku || ""),
      supplierId: String(draftValues?.supplierId || selectedDraftProduct?.supplierId || ""),
      orderContext: "fo",
      orderOverrides: {
        unitPrice: draftValues?.unitPrice,
        productionLeadTimeDays: draftValues?.productionLeadTimeDays,
        logisticsLeadTimeDays: draftValues?.logisticsLeadTimeDays,
        dutyRatePct: draftValues?.dutyRatePct,
        eustRatePct: draftValues?.eustRatePct,
        incoterm: draftValues?.incoterm,
        currency: draftValues?.currency,
        fxRate: draftValues?.fxRate,
      },
    });
  }, [
    draftValues?.currency,
    draftValues?.dutyRatePct,
    draftValues?.eustRatePct,
    draftValues?.fxRate,
    draftValues?.incoterm,
    draftValues?.logisticsLeadTimeDays,
    draftValues?.productionLeadTimeDays,
    draftValues?.sku,
    draftValues?.supplierId,
    draftValues?.unitPrice,
    selectedDraftProduct,
    stateObj,
  ]);

  const foHierarchyBase = useMemo(() => {
    return resolveMasterDataHierarchy({
      state: stateObj,
      product: selectedDraftProduct || undefined,
      sku: String(draftValues?.sku || ""),
      supplierId: String(draftValues?.supplierId || selectedDraftProduct?.supplierId || ""),
      orderContext: "fo",
    });
  }, [draftValues?.sku, draftValues?.supplierId, selectedDraftProduct, stateObj]);

  const foBlocking = useMemo(() => {
    return evaluateOrderBlocking({
      product: selectedDraftProduct,
      state: stateObj,
      supplierId: String(draftValues?.supplierId || selectedDraftProduct?.supplierId || ""),
      orderContext: "fo",
      orderOverrides: {
        unitPrice: draftValues?.unitPrice,
        productionLeadTimeDays: draftValues?.productionLeadTimeDays,
        logisticsLeadTimeDays: draftValues?.logisticsLeadTimeDays,
        dutyRatePct: draftValues?.dutyRatePct,
        eustRatePct: draftValues?.eustRatePct,
        incoterm: draftValues?.incoterm,
      },
    });
  }, [
    draftValues?.dutyRatePct,
    draftValues?.eustRatePct,
    draftValues?.incoterm,
    draftValues?.logisticsLeadTimeDays,
    draftValues?.productionLeadTimeDays,
    draftValues?.supplierId,
    draftValues?.unitPrice,
    selectedDraftProduct,
    stateObj,
  ]);

  function resetFoFieldFromHierarchy(field: "unitPrice" | "productionLeadTimeDays" | "logisticsLeadTimeDays" | "dutyRatePct" | "eustRatePct" | "incoterm" | "currency" | "fxRate"): void {
    if (field === "unitPrice") {
      form.setFieldValue("unitPrice", resolveSkuMasterUnitPrice(selectedDraftProduct));
      return;
    }
    if (field === "productionLeadTimeDays") {
      form.setFieldValue("productionLeadTimeDays", Number(foHierarchyBase.fields.productionLeadTimeDays.value || 0));
      return;
    }
    if (field === "logisticsLeadTimeDays") {
      const transportMode = normalizeTransportMode(form.getFieldValue("transportMode"));
      form.setFieldValue("logisticsLeadTimeDays", resolveSettingsTransportLeadTime(settings, transportMode).days);
      return;
    }
    if (field === "dutyRatePct") {
      form.setFieldValue("dutyRatePct", Number(foHierarchyBase.fields.dutyRatePct.value || 0));
      return;
    }
    if (field === "eustRatePct") {
      form.setFieldValue("eustRatePct", Number(foHierarchyBase.fields.eustRatePct.value || 0));
      return;
    }
    if (field === "incoterm") {
      const supplier = supplierById.get(String(form.getFieldValue("supplierId") || ""));
      form.setFieldValue("incoterm", String(supplier?.incotermDefault || foHierarchyBase.fields.incoterm.value || "EXW").toUpperCase());
      return;
    }
    if (field === "currency") {
      form.setFieldValue("currency", "USD");
      return;
    }
    form.setFieldValue("fxRate", resolveSettingsFxRate(settings));
  }

  function adoptFoFieldToProduct(field: "unitPriceUsd" | "productionLeadTimeDays" | "transitDays" | "dutyRatePct" | "eustRatePct" | "ddp", value: unknown): void {
    const sku = String(selectedDraftProduct?.sku || draftValues?.sku || "").trim();
    if (!sku) return;
    Modal.confirm({
      title: "Als neuen Produkt-Stammdatenwert uebernehmen?",
      content: `SKU ${sku}: Wert wird in den Produktstammdaten gespeichert.`,
      okText: "Uebernehmen",
      cancelText: "Abbrechen",
      onOk: () => {
        Modal.confirm({
          title: "Bist du sicher?",
          content: "Diese Aenderung beeinflusst zukuenftige FO/PO Prefills.",
          okText: "Ja, speichern",
          cancelText: "Nein",
          onOk: async () => {
            await saveWith((current) => {
              const next = ensureAppStateV2(current);
              const products = Array.isArray(next.products) ? [...next.products] : [];
              const index = products.findIndex((entry) => String((entry as Record<string, unknown>).sku || "").trim().toLowerCase() === sku.toLowerCase());
              if (index < 0) return next;
              const base = products[index] as Record<string, unknown>;
              products[index] = {
                ...applyAdoptedFieldToProduct({
                  product: base,
                  field,
                  value,
                }),
                updatedAt: nowIso(),
              };
              next.products = products;
              return next;
            }, "v2:fo:adopt-masterdata");
            message.success("Produkt-Stammdaten aktualisiert.");
          },
        });
      },
    });
  }

  const leadTimeSourceInfo = useMemo(() => {
    const sku = String(draftValues?.sku || "").trim();
    const selectedProduct = sku ? (productBySku.get(sku)?.raw || null) : null;
    return resolveLeadTimeSourceInfo({
      product: selectedProduct,
      settings,
      transportMode: draftValues?.transportMode || null,
    });
  }, [draftValues?.sku, draftValues?.transportMode, productBySku, settings]);

  const liveSchedule = useMemo(() => computeFoSchedule({
    targetDeliveryDate: draftValues?.targetDeliveryDate,
    productionLeadTimeDays: draftValues?.productionLeadTimeDays,
    logisticsLeadTimeDays: draftValues?.logisticsLeadTimeDays,
    bufferDays: draftValues?.bufferDays,
  }), [draftValues]);

  const liveShippingTotalEur = useMemo(() => {
    const units = Math.max(0, Number(draftValues?.units || 0));
    const shippingPerUnit = Math.max(0, Number(draftValues?.freight || 0));
    return round2(units * shippingPerUnit);
  }, [draftValues?.freight, draftValues?.units]);

  const liveCosts = useMemo(() => computeFoCostValues({
    units: draftValues?.units,
    unitPrice: draftValues?.unitPrice,
    currency: draftValues?.currency,
    freight: liveShippingTotalEur,
    freightCurrency: draftValues?.freightCurrency,
    dutyRatePct: draftValues?.dutyRatePct,
    eustRatePct: draftValues?.eustRatePct,
    fxRate: draftValues?.fxRate,
  }), [draftValues, liveShippingTotalEur]);

  const liveRecommendation = useMemo(() => {
    const sku = draftValues?.sku || "";
    if (!sku) return null;
    const leadTimeDays =
      Number(draftValues?.productionLeadTimeDays || 0)
      + Number(draftValues?.logisticsLeadTimeDays || 0)
      + Number(draftValues?.bufferDays || 0);
    const product = resolveProductBySku(
      productRows.map((entry) => entry.raw),
      sku,
    );
    return computeFoRecommendationForSku({
      context: recommendationContext,
      sku,
      leadTimeDays,
      product,
      settings,
      horizonMonths: 12,
      requiredArrivalMonth: draftValues?.targetDeliveryDate
        ? String(draftValues.targetDeliveryDate).slice(0, 7)
        : null,
    });
  }, [draftValues, productRows, recommendationContext, settings]);

  const liveRecommendationBreakdown = useMemo(
    () => normalizeCoverageDemandBreakdown(liveRecommendation?.coverageDemandBreakdown),
    [liveRecommendation?.coverageDemandBreakdown],
  );
  const liveRecommendationBreakdownSum = useMemo(
    () => liveRecommendationBreakdown.reduce((sum, entry) => sum + Number(entry.demandUnitsInWindow || 0), 0),
    [liveRecommendationBreakdown],
  );

  const livePaymentPreviewRows = useMemo<FoPaymentPreviewRow[]>(() => {
    if (!draftValues) return [];
    const paymentRows = buildFoPayments({
      supplierTerms: Array.isArray(draftValues.paymentTerms) ? draftValues.paymentTerms : [],
      schedule: liveSchedule,
      unitPrice: draftValues.unitPrice,
      units: draftValues.units,
      currency: draftValues.currency,
      freight: liveShippingTotalEur,
      freightCurrency: draftValues.freightCurrency,
      dutyRatePct: draftValues.dutyRatePct,
      eustRatePct: draftValues.eustRatePct,
      fxRate: draftValues.fxRate,
      incoterm: draftValues.incoterm,
      vatRefundLagMonths: settings.vatRefundLagMonths,
      paymentDueDefaults: settings.paymentDueDefaults,
    });
    return paymentRows.map((row) => {
      const plannedEur = row.currency === "EUR"
        ? Number(row.amount || 0)
        : convertToEur(row.amount, row.currency, draftValues.fxRate);
      return {
        id: String(row.id || ""),
        label: String(row.label || ""),
        category: row.category,
        currency: String(row.currency || "EUR"),
        amount: Number(row.amount || 0),
        plannedEur: Number.isFinite(plannedEur) ? plannedEur : 0,
        dueDate: row.dueDate ? String(row.dueDate) : null,
        triggerEvent: String(row.triggerEvent || "ORDER_DATE"),
        offsetDays: Number(row.offsetDays || 0),
        offsetMonths: Number(row.offsetMonths || 0),
      };
    });
  }, [draftValues, liveSchedule, liveShippingTotalEur, settings.paymentDueDefaults, settings.vatRefundLagMonths]);

  const supplierPercentSum = useMemo(
    () => sumSupplierPercent(draftValues?.paymentTerms || []),
    [draftValues?.paymentTerms],
  );

  useEffect(() => {
    if (!modalOpen || !modalCollab.readOnly || !modalCollab.remoteDraftPatch) return;
    form.setFieldsValue(modalCollab.remoteDraftPatch as Partial<FoFormValues>);
  }, [form, modalCollab.readOnly, modalCollab.remoteDraftPatch, modalCollab.remoteDraftVersion, modalOpen]);

  function buildDefaultDraft(
    existing?: Record<string, unknown> | null,
    prefill?: Partial<FoFormValues>,
  ): FoFormValues {
    const firstActiveProduct = productRows.find((entry) => isProductActive(entry.raw)) || productRows[0] || null;
    const seedSku = String(prefill?.sku || existing?.sku || firstActiveProduct?.sku || "");
    const seedProduct = productBySku.get(seedSku) || firstActiveProduct;
    const supplierId = String(
      prefill?.supplierId
      || existing?.supplierId
      || seedProduct?.supplierId
      || supplierRows[0]?.id
      || "",
    );
    const supplier = supplierById.get(supplierId) || null;
    const units = Number(prefill?.units ?? existing?.units ?? 0);
    const productDefaults = resolveFoProductPrefill({
      state: stateObj,
      product: seedProduct?.raw || null,
      supplier: supplier || null,
      settings,
      supplierId,
      units,
    });
    const supplierTerms = extractSupplierTerms(existing?.payments, supplier || undefined);
    const existingUnits = toPositiveNumberOrNull(existing?.units);
    const existingFreightTotal = toPositiveNumberOrNull(existing?.freight);
    const existingFreightPerUnit =
      existingUnits != null && existingFreightTotal != null
        ? round2(existingFreightTotal / existingUnits)
        : null;
    return {
      id: existing?.id ? String(existing.id) : undefined,
      sku: seedSku,
      supplierId,
      status: normalizeFoStatus(existing?.status || prefill?.status || "DRAFT"),
      targetDeliveryDate: String(prefill?.targetDeliveryDate || existing?.targetDeliveryDate || new Date().toISOString().slice(0, 10)),
      units,
      transportMode: normalizeTransportMode(existing?.transportMode || productDefaults.transportMode || "RAIL"),
      incoterm: String(existing?.incoterm || productDefaults.incoterm || "EXW").toUpperCase(),
      unitPrice: Number(existing?.unitPrice ?? productDefaults.unitPrice ?? 0),
      currency: String(existing?.currency || productDefaults.currency || "USD").toUpperCase(),
      freight: Number(existingFreightPerUnit ?? prefill?.freight ?? productDefaults.freight ?? 0),
      freightCurrency: "EUR",
      dutyRatePct: Number(existing?.dutyRatePct ?? productDefaults.dutyRatePct ?? 0),
      eustRatePct: Number(existing?.eustRatePct ?? productDefaults.eustRatePct ?? 0),
      fxRate: Number(existing?.fxRate ?? productDefaults.fxRate ?? resolveSettingsFxRate(settings)),
      productionLeadTimeDays: Number(existing?.productionLeadTimeDays ?? productDefaults.productionLeadTimeDays ?? 45),
      logisticsLeadTimeDays: Number(existing?.logisticsLeadTimeDays ?? productDefaults.logisticsLeadTimeDays ?? 45),
      bufferDays: Number(existing?.bufferDays ?? productDefaults.bufferDays ?? settings.defaultBufferDays ?? 0),
      paymentTerms: supplierTerms,
    };
  }

  function applyProductDefaults(skuValue: string, unitsOverride?: number): void {
    const sku = String(skuValue || "").trim();
    if (!sku) return;
    const product = productBySku.get(sku) || null;
    if (!product) return;
    const current = form.getFieldsValue();
    const supplierId = String(product.supplierId || current.supplierId || "");
    const supplier = supplierById.get(supplierId) || null;
    const defaults = resolveFoProductPrefill({
      state: stateObj,
      product: product.raw,
      supplier: supplier || null,
      settings,
      supplierId,
      transportMode: "RAIL",
      units: Number(unitsOverride ?? current.units ?? 0),
    });
    form.setFieldsValue({
      supplierId: supplierId || current.supplierId,
      transportMode: defaults.transportMode,
      incoterm: defaults.incoterm,
      unitPrice: resolveSkuMasterUnitPrice(product.raw),
      currency: defaults.currency,
      freight: defaults.freight,
      freightCurrency: "EUR",
      dutyRatePct: defaults.dutyRatePct,
      eustRatePct: defaults.eustRatePct,
      fxRate: resolveSettingsFxRate(settings),
      productionLeadTimeDays: defaults.productionLeadTimeDays,
      logisticsLeadTimeDays: defaults.logisticsLeadTimeDays,
      bufferDays: defaults.bufferDays,
      paymentTerms: extractSupplierTerms([], supplier || undefined),
    });
  }

  function applySupplierDefaults(supplierIdValue: string): void {
    const supplierId = String(supplierIdValue || "").trim();
    const values = form.getFieldsValue();
    const sku = String(values.sku || "").trim();
    const product = sku ? (productBySku.get(sku)?.raw || null) : null;
    const supplier = supplierById.get(supplierId) || null;
    const transportMode = normalizeTransportMode(values.transportMode || "RAIL");
    const defaults = resolveFoProductPrefill({
      state: stateObj,
      product,
      supplier: supplier || null,
      settings,
      supplierId,
      transportMode,
      units: Number(values.units || 0),
    });
    const supplierProductionLead = toPositiveNumberOrNull(supplier?.productionLeadTimeDaysDefault);
    form.setFieldsValue({
      supplierId,
      incoterm: String(supplier?.incotermDefault || defaults.incoterm || values.incoterm || "EXW").toUpperCase(),
      productionLeadTimeDays: Number(supplierProductionLead ?? defaults.productionLeadTimeDays ?? values.productionLeadTimeDays ?? 0),
      logisticsLeadTimeDays: resolveSettingsTransportLeadTime(settings, transportMode).days,
      paymentTerms: extractSupplierTerms([], supplier || undefined),
      unitPrice: resolveSkuMasterUnitPrice(product),
      currency: "USD",
      fxRate: resolveSettingsFxRate(settings),
      freight: defaults.freight,
      freightCurrency: "EUR",
    });
  }

  function openCreateModal(prefill?: Partial<FoFormValues>): void {
    setEditingId(null);
    const draft = buildDefaultDraft(null, prefill);
    form.setFieldsValue({
      ...draft,
      ...(prefill || {}),
    });
    setModalOpen(true);
  }

  function openEditModal(existing: Record<string, unknown>): void {
    setEditingId(String(existing.id || ""));
    form.setFieldsValue(buildDefaultDraft(existing));
    setModalOpen(true);
  }

  function openMergeModalFromSelection(): void {
    const selected = mergeSelectedFos;
    if (selected.length < 2) {
      message.warning("Bitte mindestens 2 aktive FOs fuer den Merge auswaehlen.");
      return;
    }
    const targetDate = mergeEarliestTargetDate || "";
    setMergePoNo(suggestNextPoNo(Array.isArray(state.pos) ? state.pos : []));
    setMergeOrderDate("");
    setMergeTargetMode("earliest");
    setMergeManualTargetDate(targetDate);
    setMergeAllowMixedTerms(false);
    setMergeOpen(true);
  }

  async function saveFo(values: FoFormValues): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Dieser FO wird gerade von einem anderen Nutzer bearbeitet.");
    }
    const sku = String(values.sku || "").trim();
    const product = sku ? resolveProductBySku(productRows.map((entry) => entry.raw), sku) : null;
    const derivedSupplierId = String(product?.supplierId || "").trim();
    const supplierId = String(values.supplierId || derivedSupplierId || "").trim();
    if (!supplierId) {
      throw new Error("Supplier ist erforderlich.");
    }
    if (!product && !values.supplierId) {
      throw new Error("SKU nicht gefunden. Bitte Produkt prüfen.");
    }
    const existing = editingId
      ? rows.find((entry) => entry.id === editingId)?.raw || null
      : null;
    const existingStatus = normalizeFoStatus(existing?.status || "DRAFT");
    const requestedStatus = normalizeFoStatus(values.status || existingStatus || "DRAFT");
    let sanitizedStatus: FoStatus = requestedStatus;
    if (existing && !isFoConvertibleStatus(existingStatus)) {
      sanitizedStatus = existingStatus;
    } else if (!isFoConvertibleStatus(requestedStatus)) {
      sanitizedStatus = existing ? existingStatus : "DRAFT";
    }
    const sanitizedValues: FoFormValues = {
      ...values,
      supplierId,
      status: sanitizedStatus,
    };
    const blocking = evaluateOrderBlocking({
      product,
      state: stateObj,
      supplierId,
      orderContext: "fo",
      orderOverrides: {
        unitPrice: sanitizedValues.unitPrice,
        productionLeadTimeDays: sanitizedValues.productionLeadTimeDays,
        logisticsLeadTimeDays: sanitizedValues.logisticsLeadTimeDays,
        dutyRatePct: sanitizedValues.dutyRatePct,
        eustRatePct: sanitizedValues.eustRatePct,
        incoterm: sanitizedValues.incoterm,
      },
    });
    if (blocking.blocked) {
      throw new Error(`Blockierende Stammdaten fehlen: ${blocking.issues.map((entry) => entry.label).join(", ")}`);
    }
    const terms = (values.paymentTerms || []).map((row) => ({
      id: row.id,
      label: String(row.label || "Milestone"),
      percent: Number(row.percent || 0),
      triggerEvent: String(row.triggerEvent || "ORDER_DATE").toUpperCase() as SupplierPaymentTermDraft["triggerEvent"],
      offsetDays: Number(row.offsetDays || 0),
      offsetMonths: Number(row.offsetMonths || 0),
    }));
    const sumPercent = sumSupplierPercent(terms);
    if (Math.abs(sumPercent - 100) > 0.01) {
      throw new Error("Supplier Payment Terms muessen in Summe 100% ergeben.");
    }
    const schedule = computeFoSchedule({
      targetDeliveryDate: sanitizedValues.targetDeliveryDate,
      productionLeadTimeDays: sanitizedValues.productionLeadTimeDays,
      logisticsLeadTimeDays: sanitizedValues.logisticsLeadTimeDays,
      bufferDays: sanitizedValues.bufferDays,
    });
    const shippingPerUnit = Math.max(0, Number(sanitizedValues.freight || 0));
    const shippingTotal = round2(shippingPerUnit * Math.max(0, Number(sanitizedValues.units || 0)));
    const normalized = normalizeFoRecord({
      existing,
      supplierTerms: terms,
      values: {
        ...(sanitizedValues as unknown as Record<string, unknown>),
        freight: shippingTotal,
        freightCurrency: "EUR",
        forecastBasisVersionId: activeForecastVersion?.id || null,
        forecastBasisVersionName: activeForecastVersion?.name || null,
        forecastBasisSetAt: nowIso(),
      },
      schedule,
      vatRefundLagMonths: settings.vatRefundLagMonths,
      paymentDueDefaults: settings.paymentDueDefaults,
    });

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.fos) ? [...next.fos] as Record<string, unknown>[] : [];
      const nextRecord = { ...(normalized as Record<string, unknown>) };
      const index = list.findIndex((entry) => String(entry.id || "") === String(nextRecord.id || ""));
      if (index >= 0) {
        list[index] = nextRecord;
      } else {
        if (!String(nextRecord.foNo || "").trim() || !String(nextRecord.foNumber || "").trim()) {
          const suggestion = suggestNextFoNumber(list, nextRecord.createdAt || nextRecord.updatedAt || nowIso());
          if (!String(nextRecord.foNo || "").trim()) {
            nextRecord.foNo = suggestion.foNo;
          }
          if (!String(nextRecord.foNumber || "").trim()) {
            nextRecord.foNumber = suggestion.foNumber;
          }
        }
        list.push(nextRecord);
      }
      next.fos = list;
      return next;
    }, editingId ? "v2:fo:update" : "v2:fo:create");
    modalCollab.clearDraft();
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  async function convertFo(): Promise<void> {
    const targetId = convertTargetId;
    if (!targetId) return;
    const poNo = String(convertPoNo || "").trim();
    if (!poNo) throw new Error("PO Nummer ist erforderlich.");
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const pos = Array.isArray(next.pos) ? [...next.pos] : [];
      const fos = Array.isArray(next.fos) ? [...next.fos] : [];
      if (pos.some((entry) => String((entry as Record<string, unknown>).poNo || "") === poNo)) {
        throw new Error(`PO Nummer ${poNo} existiert bereits.`);
      }
      const foIndex = fos.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === targetId);
      if (foIndex < 0) {
        throw new Error("FO nicht gefunden.");
      }
      const fo = { ...(fos[foIndex] as Record<string, unknown>) };
      if (!isFoConvertibleStatus(fo.status)) {
        throw new Error("Nur aktive FOs (Draft/Active) koennen konvertiert werden.");
      }
      const po = createPoFromFo({
        fo,
        poNumber: poNo,
        orderDateOverride: convertOrderDate || String(fo.orderDate || ""),
      });
      pos.push(po);

      const supplierMap = new Map(
        (Array.isArray(next.suppliers) ? next.suppliers : [])
          .map((entry) => entry as Record<string, unknown>)
          .map((entry) => [String(entry.id || ""), entry]),
      );
      const supplier = supplierMap.get(String(fo.supplierId || "")) || null;
      const supplierTerms = extractSupplierTerms(fo.payments, supplier || undefined);
      const schedule = computeScheduleFromOrderDate({
        orderDate: convertOrderDate || fo.orderDate,
        productionLeadTimeDays: fo.productionLeadTimeDays,
        logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
        bufferDays: fo.bufferDays,
        deliveryDate: fo.targetDeliveryDate,
      });
      const payments = buildFoPayments({
        supplierTerms,
        schedule,
        unitPrice: fo.unitPrice,
        units: fo.units,
        currency: fo.currency,
        freight: fo.freight,
        freightCurrency: fo.freightCurrency,
        dutyRatePct: fo.dutyRatePct,
        eustRatePct: fo.eustRatePct,
        fxRate: fo.fxRate,
        incoterm: fo.incoterm,
        vatRefundLagMonths: (next.settings as Record<string, unknown> | undefined)?.vatRefundLagMonths,
        paymentDueDefaults: (next.settings as Record<string, unknown> | undefined)?.paymentDueDefaults,
      });

      fos[foIndex] = {
        ...fo,
        ...schedule,
        payments,
        status: "CONVERTED",
        convertedPoId: po.id,
        convertedPoNo: po.poNo,
        updatedAt: nowIso(),
      };

      next.pos = pos;
      next.fos = fos;
      return next;
    }, "v2:fo:convert");

    setConvertOpen(false);
    setConvertTargetId(null);
    setMergeSelection((current) => current.filter((entry) => entry !== targetId));
    message.success(`FO wurde in PO ${poNo} konvertiert.`);
  }

  async function convertFoMerge(): Promise<void> {
    const sourceFos = mergeSelectedFos;
    if (sourceFos.length < 2) {
      throw new Error("Bitte mindestens 2 FOs auswaehlen.");
    }
    if (mergeHasSupplierMismatch) {
      throw new Error("Merge ist nur mit gleichem Lieferanten erlaubt.");
    }
    if (mergeHasMixedTerms && !mergeAllowMixedTerms) {
      throw new Error("Bitte gemischte Transport/Incoterm explizit bestaetigen.");
    }
    const poNo = String(mergePoNo || "").trim();
    if (!poNo) throw new Error("PO Nummer ist erforderlich.");
    const targetDate = mergeResolvedTargetDate;
    if (mergeTargetMode === "manual" && !targetDate) {
      throw new Error("Bitte ein manuelles Ziel-Lieferdatum setzen.");
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const pos = Array.isArray(next.pos) ? [...next.pos] : [];
      const fos = Array.isArray(next.fos) ? [...next.fos] : [];
      if (pos.some((entry) => String((entry as Record<string, unknown>).poNo || "") === poNo)) {
        throw new Error(`PO Nummer ${poNo} existiert bereits.`);
      }
      const sourceIds = sourceFos.map((fo) => String(fo.id || ""));
      const selectedFromState = fos
        .filter((entry) => sourceIds.includes(String((entry as Record<string, unknown>).id || "")))
        .map((entry) => ({ ...(entry as Record<string, unknown>) }));
      if (selectedFromState.length !== sourceFos.length) {
        throw new Error("Nicht alle ausgewaehlten FOs konnten geladen werden.");
      }
      if (selectedFromState.some((fo) => !isFoConvertibleStatus(fo.status))) {
        throw new Error("Enthaelt bereits konvertierte oder archivierte FOs.");
      }
      const po = createPoFromFos({
        fos: selectedFromState,
        poNumber: poNo,
        orderDateOverride: mergeOrderDate || null,
        targetDeliveryDate: targetDate,
      });
      pos.push(po);

      const supplierMap = new Map(
        (Array.isArray(next.suppliers) ? next.suppliers : [])
          .map((entry) => entry as Record<string, unknown>)
          .map((entry) => [String(entry.id || ""), entry]),
      );
      const vatRefundLagMonths = (next.settings as Record<string, unknown> | undefined)?.vatRefundLagMonths;

      const updatedFos = fos.map((entry) => {
        const fo = entry as Record<string, unknown>;
        const foId = String(fo.id || "");
        if (!sourceIds.includes(foId)) return fo;
        const supplier = supplierMap.get(String(fo.supplierId || "")) || null;
        const supplierTerms = extractSupplierTerms(fo.payments, supplier || undefined);
        const schedule = computeScheduleFromOrderDate({
          orderDate: mergeOrderDate || po.orderDate || fo.orderDate,
          productionLeadTimeDays: fo.productionLeadTimeDays,
          logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
          bufferDays: fo.bufferDays,
          deliveryDate: targetDate || fo.targetDeliveryDate,
        });
        const payments = buildFoPayments({
          supplierTerms,
          schedule,
          unitPrice: fo.unitPrice,
          units: fo.units,
          currency: fo.currency,
          freight: fo.freight,
          freightCurrency: fo.freightCurrency,
          dutyRatePct: fo.dutyRatePct,
          eustRatePct: fo.eustRatePct,
          fxRate: fo.fxRate,
          incoterm: fo.incoterm,
          vatRefundLagMonths,
          paymentDueDefaults: (next.settings as Record<string, unknown> | undefined)?.paymentDueDefaults,
        });
        return {
          ...fo,
          ...schedule,
          payments,
          status: "CONVERTED",
          convertedPoId: po.id,
          convertedPoNo: po.poNo,
          updatedAt: nowIso(),
        };
      });

      next.pos = pos;
      next.fos = updatedFos;
      return next;
    }, "v2:fo:merge-convert");

    setMergeOpen(false);
    setMergeSelection([]);
    setMergeAllowMixedTerms(false);
    setMergeOrderDate("");
    setMergeManualTargetDate("");
    setMergePoNo("");
    setMergeTargetMode("earliest");
    message.success(`FO-Merge erstellt PO ${poNo}.`);
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const source = params.get("source");
    const clearHandledParams = (keys: string[]): void => {
      const next = new URLSearchParams(location.search);
      keys.forEach((key) => next.delete(key));
      const query = next.toString();
      navigate(
        {
          pathname: location.pathname,
          search: query ? `?${query}` : "",
        },
        { replace: true },
      );
    };

    if (source === "orders_sku") {
      const foId = String(params.get("foId") || "").trim();
      if (foId) {
        const target = (Array.isArray(state.fos) ? state.fos : [])
          .map((entry) => entry as Record<string, unknown>)
          .find((entry) => String(entry.id || "") === foId);
        if (target) openEditModal(target);
      }
      clearHandledParams(["source", "foId"]);
      return;
    }

    if (source !== "inventory_projection") return;
    const sku = String(params.get("sku") || "").trim();
    if (!sku) {
      clearHandledParams(["source"]);
      return;
    }
    const product = productBySku.get(sku) || null;
    const suggestedUnits = Math.max(0, Math.round(Number(params.get("suggestedUnits") || 0)));
    const requiredArrivalDate = String(params.get("requiredArrivalDate") || "");

    const prefill: Partial<FoFormValues> = {
      sku,
      units: suggestedUnits,
      status: "ACTIVE",
    };
    if (product?.supplierId) prefill.supplierId = String(product.supplierId);
    if (requiredArrivalDate) prefill.targetDeliveryDate = requiredArrivalDate;

    openCreateModal(prefill);
    clearHandledParams([
      "source",
      "sku",
      "month",
      "suggestedUnits",
      "projectedEnd",
      "mode",
      "requiredArrivalDate",
      "recommendedOrderDate",
      "returnTo",
      "nextSku",
      "nextMonth",
      "nextSuggestedUnits",
      "nextRequiredArrivalDate",
      "nextRecommendedOrderDate",
    ]);
  }, [location.pathname, location.search, navigate, productBySku, state.fos]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        {!embedded ? (
          <div className="v2-page-head">
            <div>
              <Title level={3}>Forecast Orders</Title>
              <Paragraph>
                FO ist ein Planobjekt je SKU (inkl. Plan-Meilensteinen). Zahlungen werden erst nach PO-Conversion im PO-Flow bestätigt.
              </Paragraph>
            </div>
          </div>
        ) : null}
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => openCreateModal()}>Create FO</Button>
            <Segmented
              value={foViewMode}
              options={[
                { label: "Tabelle", value: "table" },
                { label: "Timeline", value: "timeline" },
              ]}
              onChange={(value) => updateFoViewMode(String(value) === "timeline" ? "timeline" : "table")}
            />
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? (
              <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
          <Input
            placeholder="Alias, SKU, Supplier"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 280 }}
          />
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as "ALL" | FoStatus)}
            options={[
              { value: "ALL", label: "Alle Status" },
              ...FO_STATUS_VALUES.map((status) => ({ value: status, label: status })),
            ]}
            style={{ width: 190 }}
          />
          <Button
            onClick={openMergeModalFromSelection}
            disabled={mergeSelectedFos.length < 2}
          >
            Create PO from FOs
          </Button>
          <Tag>{mergeSelectedFos.length} ausgewählt</Tag>
        </div>
        {foViewMode === "table" ? (
          <TanStackGrid
            data={rows}
            columns={columns}
            minTableWidth={1400}
            tableLayout="auto"
          />
        ) : (
          <OrdersGanttTimeline
            className="v2-orders-gantt--fo"
            groups={foTimelinePayload.groups}
            items={foTimelinePayload.items}
            visibleStartMs={foTimelineWindow.visibleStartMs}
            visibleEndMs={foTimelineWindow.visibleEndMs}
            sidebarWidth={340}
            lineHeight={72}
            sidebarHeaderLabel="FO / Produkt"
            emptyMessage="Keine Forecast Orders für die aktuelle Suche/Filter."
            onItemSelect={(itemId) => {
              const row = foTimelinePayload.itemRowMap.get(itemId);
              if (!row) return;
              openEditModal(row.raw);
            }}
          />
        )}
      </Card>

      <Modal
        title={editingId ? "FO bearbeiten" : "FO anlegen"}
        open={modalOpen}
        width={1120}
        onCancel={() => {
          modalCollab.clearDraft();
          setModalOpen(false);
        }}
        onOk={() => {
          if (modalFieldLocked) {
            if (draftStatusLocked && !modalCollab.readOnly) {
              Modal.info({
                title: "Read-only FO",
                content: "Konvertierte oder archivierte FOs sind schreibgeschuetzt. Bitte ueber PO weiterarbeiten.",
              });
              return;
            }
            Modal.warning({
              title: "Nur Lesemodus",
              content: `${modalCollab.remoteUserLabel || "Kollege"} bearbeitet diesen FO. Bitte Bearbeitung übernehmen oder warten.`,
            });
            return;
          }
          void form.validateFields().then((values) => saveFo(values)).catch(() => {});
        }}
      >
        {modalCollab.banner ? (
          <Alert
            style={{ marginBottom: 10 }}
            type={modalCollab.banner.tone}
            showIcon
            message={modalCollab.banner.text}
            action={modalCollab.readOnly ? (
              <Button size="small" onClick={modalCollab.takeOver}>
                Bearbeitung uebernehmen
              </Button>
            ) : null}
          />
        ) : null}
        {modalCollab.readOnly && modalCollab.remoteDraftVersion > 0 ? (
          <Tag color="orange" style={{ marginBottom: 10 }}>
            Entwurf von {modalCollab.remoteUserLabel || "Kollege"} wird live gespiegelt.
          </Tag>
        ) : null}
        <Space style={{ width: "100%", marginBottom: 10 }} wrap>
          <Text type="secondary">Status:</Text>
          {statusTag(draftStatus)}
          {isFoConvertibleStatus(draftStatus) ? (
            <Button
              size="small"
              disabled={modalFieldLocked}
              onClick={() => form.setFieldValue("status", nextPlanningStatus(draftStatus))}
            >
              {draftStatus === "ACTIVE" ? "Als Draft markieren" : "Als Active markieren"}
            </Button>
          ) : (
            <Tag color="default">Read-only</Tag>
          )}
          {draftConvertedPoNo ? (
            <Button
              size="small"
              onClick={() => {
                const params = new URLSearchParams();
                params.set("source", "fo_convert");
                params.set("poNo", draftConvertedPoNo);
                navigate(`/v2/orders/po?${params.toString()}`);
              }}
            >
              Zugehoerige PO oeffnen
            </Button>
          ) : null}
        </Space>
        <Form
          name="v2-fo-modal"
          form={form}
          layout="vertical"
          disabled={modalFieldLocked}
          onValuesChange={(changedValues) => {
            if (modalFieldLocked) return;
            modalCollab.publishDraftPatch(changedValues as Record<string, unknown>);
          }}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="status" hidden>
            <Input />
          </Form.Item>
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              name="sku"
              label="Produkt (SKU)"
              style={{ minWidth: 230, flex: 1 }}
              rules={[{ required: true, message: "SKU ist erforderlich." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={productRows.map((product) => ({
                  value: product.sku,
                  label: `${product.alias} (${product.sku})`,
                }))}
                onChange={(nextSku) => {
                  applyProductDefaults(String(nextSku || ""));
                }}
              />
            </Form.Item>
            <Form.Item
              name="supplierId"
              label="Supplier"
              style={{ minWidth: 230, flex: 1 }}
              rules={[{ required: true, message: "Supplier ist erforderlich." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={supplierRows.map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                }))}
                onChange={(nextSupplierId) => {
                  applySupplierDefaults(String(nextSupplierId || ""));
                }}
              />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              name="units"
              label="Units"
              style={{ width: 130 }}
              rules={[{ required: true, message: "Units sind erforderlich." }]}
            >
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item
              name="targetDeliveryDate"
              label="Target Delivery"
              style={{ width: 190 }}
              rules={[{ required: true, message: "Zieltermin ist erforderlich." }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item name="transportMode" label="Transport" style={{ width: 140 }}>
              <Select
                options={TRANSPORT_MODES.map((mode) => ({ value: mode, label: mode }))}
                onChange={(nextMode) => {
                  const transportMode = normalizeTransportMode(nextMode);
                  form.setFieldsValue({
                    transportMode,
                    logisticsLeadTimeDays: resolveSettingsTransportLeadTime(settings, transportMode).days,
                  });
                }}
              />
            </Form.Item>
            <Form.Item name="incoterm" label="Incoterm" style={{ width: 130 }}>
              <Select options={INCOTERMS.map((term) => ({ value: term, label: term }))} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" style={{ width: 130 }}>
              <Select options={PAYMENT_CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
            </Form.Item>
            <Form.Item name="fxRate" label="FX Rate" style={{ width: 140 }}>
              <DeNumberInput mode="fx" min={0} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="unitPrice" label="Unit Price (USD/Stück)" style={{ width: 190 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="freight" label="Shipping costs (EUR/Stück)" style={{ width: 210 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="freightCurrency" label="Shipping Currency" style={{ width: 160 }}>
              <Select
                disabled
                options={[{ value: "EUR", label: "EUR" }]}
              />
            </Form.Item>
            <Form.Item name="dutyRatePct" label="Duty %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
            <Form.Item name="eustRatePct" label="EUSt %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
          </Space>
          <div style={{ marginTop: -6, marginBottom: 10 }}>
            <Text type="secondary">
              Shipping total: {formatCurrency(liveShippingTotalEur)} ({formatNumber(draftValues?.units || 0, 0)} x {formatNumber(draftValues?.freight || 0, 2)} EUR/Stück)
            </Text>
          </div>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="productionLeadTimeDays" label="Production Lead Days" style={{ width: 220 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item name="logisticsLeadTimeDays" label="Logistics Lead Days" style={{ width: 220 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item name="bufferDays" label="Buffer Days" style={{ width: 180 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Button
              disabled={modalFieldLocked}
              onClick={() => {
                const values = form.getFieldsValue();
                const supplier = supplierById.get(String(values.supplierId || ""));
                const terms = extractSupplierTerms([], supplier || undefined);
                form.setFieldsValue({
                  incoterm: String(supplier?.incotermDefault || values.incoterm || "EXW").toUpperCase(),
                  currency: "USD",
                  fxRate: resolveSettingsFxRate(settings),
                  paymentTerms: terms,
                });
              }}
            >
              Supplier Terms
            </Button>
          </Space>
          <div style={{ marginTop: -2, marginBottom: 10 }}>
            <Text type="secondary">
              Quelle Leadtime: Produktion = {leadTimeSourceInfo.production} · Logistik = {leadTimeSourceInfo.logistics}
            </Text>
          </div>

          {foBlocking.blocked ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="Blockierende Stammdaten fehlen"
              description={foBlocking.issues.map((entry) => entry.label).join(", ")}
            />
          ) : null}

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Text strong>Stammdaten-Herkunft (FO)</Text>
              <div className="v2-source-row">
                <span>Unit Price</span>
                <span className={sourceChipClass(foHierarchy.fields.unitPriceUsd.source, true)}>{foHierarchy.fields.unitPriceUsd.label}</span>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("unitPrice")}>Zuruecksetzen</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("unitPriceUsd", draftValues?.unitPrice)}>Als Produktwert uebernehmen</Button>
              </div>
              <div className="v2-source-row">
                <span>Production Lead</span>
                <span className={sourceChipClass(foHierarchy.fields.productionLeadTimeDays.source, true)}>{foHierarchy.fields.productionLeadTimeDays.label}</span>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("productionLeadTimeDays")}>Zuruecksetzen</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("productionLeadTimeDays", draftValues?.productionLeadTimeDays)}>Als Produktwert uebernehmen</Button>
              </div>
              <div className="v2-source-row">
                <span>Logistics Lead</span>
                <span className={sourceChipClass(foHierarchy.fields.transitDays.source, false)}>{foHierarchy.fields.transitDays.label}</span>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("logisticsLeadTimeDays")}>Zuruecksetzen</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("transitDays", draftValues?.logisticsLeadTimeDays)}>Als Produktwert uebernehmen</Button>
              </div>
              <div className="v2-source-row">
                <span>Duty / EUSt</span>
                <span className={sourceChipClass(foHierarchy.fields.dutyRatePct.source, false)}>{foHierarchy.fields.dutyRatePct.label}</span>
                <span className={sourceChipClass(foHierarchy.fields.eustRatePct.source, false)}>{foHierarchy.fields.eustRatePct.label}</span>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("dutyRatePct")}>Duty reset</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("eustRatePct")}>EUSt reset</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("dutyRatePct", draftValues?.dutyRatePct)}>Duty uebernehmen</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("eustRatePct", draftValues?.eustRatePct)}>EUSt uebernehmen</Button>
              </div>
              <div className="v2-source-row">
                <span>Incoterm</span>
                <span className={sourceChipClass(foHierarchy.fields.incoterm.source, true)}>{foHierarchy.fields.incoterm.label}</span>
                <Button size="small" disabled={modalFieldLocked} onClick={() => resetFoFieldFromHierarchy("incoterm")}>Zuruecksetzen</Button>
                <Button size="small" disabled={modalFieldLocked} onClick={() => adoptFoFieldToProduct("ddp", String(draftValues?.incoterm || "").toUpperCase() === "DDP")}>Als Produktwert uebernehmen</Button>
              </div>
            </Space>
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={4}>
              <Text strong>Schedule Preview</Text>
              <Text>Order Date: {formatDate(liveSchedule.orderDate)}</Text>
              <Text>Production End: {formatDate(liveSchedule.productionEndDate)}</Text>
              <Text>ETD: {formatDate(liveSchedule.etdDate)}</Text>
              <Text>ETA: {formatDate(liveSchedule.etaDate)}</Text>
              <Text>Landed Cost: {formatCurrency(liveCosts.landedCostEur)}</Text>
            </Space>
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={4}>
              <Text strong>FO Empfehlung</Text>
              {!recommendationContext.baselineMonth ? (
                <Text type="secondary">Kein Inventory Snapshot vorhanden.</Text>
              ) : null}
              {liveRecommendation ? (
                <>
                  <Text>Baseline: {String(liveRecommendation.baselineMonth || "—")}</Text>
                  <Text>Status: {String(liveRecommendation.status || "—")}</Text>
                  <Text type="secondary">Empfehlung basiert auf Forecast + Coverage DOH + MOQ.</Text>
                  <Text>
                    Reichweite-Bedarf ({formatNumber(liveRecommendation.coverageDaysForOrder, 0)} Tage): {formatNumber(liveRecommendation.coverageDemandUnits, 0)}
                  </Text>
                  {liveRecommendationBreakdown.length ? (
                    <div className="v2-fo-breakdown-wrap">
                      <table className="v2-fo-breakdown-table">
                        <thead>
                          <tr>
                            <th>Monat</th>
                            <th>Tage im Fenster</th>
                            <th>Forecast Monat</th>
                            <th>Beitrags-Units</th>
                          </tr>
                        </thead>
                        <tbody>
                          {liveRecommendationBreakdown.map((entry) => (
                            <tr key={`${entry.month}-${entry.daysCovered}`}>
                              <td>{entry.month}</td>
                              <td>{formatNumber(entry.daysCovered, 0)}</td>
                              <td>
                                {entry.forecastMonthUnits == null
                                  ? "—"
                                  : formatNumber(entry.forecastMonthUnits, 0)}
                                {entry.usedFallback ? <span className="v2-fo-breakdown-flag"> (Fallback)</span> : null}
                              </td>
                              <td>{formatNumber(entry.demandUnitsInWindow, 0)}</td>
                            </tr>
                          ))}
                          <tr className="is-total">
                            <td>Summe</td>
                            <td>{formatNumber(liveRecommendation.coverageDaysForOrder, 0)}</td>
                            <td>—</td>
                            <td>{formatNumber(liveRecommendationBreakdownSum, 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <Text>
                    Rohwert (aufgerundet): {formatNumber(liveRecommendation.recommendedUnitsRaw, 0)}
                  </Text>
                  <Text>
                    Empfohlene Units: {formatNumber(liveRecommendation.recommendedUnits, 0)}
                  </Text>
                  {liveRecommendation.moqApplied ? (
                    <Text type="warning">
                      MOQ-Aufrundung: {formatNumber(liveRecommendation.recommendedUnitsRaw, 0)} → {formatNumber(liveRecommendation.recommendedUnits, 0)}
                    </Text>
                  ) : null}
                  <Text>
                    Arrival: {formatDate(liveRecommendation.requiredArrivalDate)}
                  </Text>
                  <Text>
                    Order: {formatDate(liveRecommendation.orderDateAdjusted || liveRecommendation.orderDate)}
                  </Text>
                </>
              ) : (
                <Text type="secondary">Bitte SKU waehlen.</Text>
              )}
            </Space>
          </Card>

          <Card size="small">
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Text strong>Supplier Payment Terms</Text>
              <Text type={Math.abs(supplierPercentSum - 100) <= 0.01 ? "secondary" : "danger"}>
                Summe: {formatNumber(supplierPercentSum, 2)}%
              </Text>
            </Space>
            <Form.List name="paymentTerms">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ width: "100%" }} wrap>
                      <Form.Item
                        {...field}
                        name={[field.name, "label"]}
                        style={{ flex: 2, minWidth: 220 }}
                        rules={[{ required: true, message: "Label fehlt." }]}
                      >
                        <Input placeholder="Label" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "percent"]}
                        style={{ width: 100 }}
                        rules={[{ required: true, message: "%" }]}
                      >
                        <DeNumberInput mode="percent" min={0} max={100} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "triggerEvent"]}
                        style={{ width: 170 }}
                        rules={[{ required: true, message: "Trigger fehlt." }]}
                      >
                        <Select options={PAYMENT_TRIGGERS.map((trigger) => ({ value: trigger, label: trigger }))} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "offsetDays"]}
                        style={{ width: 110 }}
                      >
                        <DeNumberInput mode="int" />
                      </Form.Item>
                      <Button danger disabled={modalFieldLocked} onClick={() => remove(field.name)}>X</Button>
                    </Space>
                  ))}
                  <Space>
                    <Button
                      disabled={modalFieldLocked}
                      onClick={() => add({
                        label: "Milestone",
                        percent: 0,
                        triggerEvent: "ORDER_DATE",
                        offsetDays: 0,
                        offsetMonths: 0,
                      })}
                    >
                      Milestone
                    </Button>
                    <Button
                      disabled={modalFieldLocked}
                      onClick={() => {
                        const supplierId = String(form.getFieldValue("supplierId") || "");
                        const supplier = supplierById.get(supplierId) || null;
                        form.setFieldsValue({
                          paymentTerms: extractSupplierTerms([], supplier || undefined),
                        });
                      }}
                    >
                      Terms laden
                    </Button>
                  </Space>
                </Space>
              )}
            </Form.List>
            <div style={{ marginTop: 12 }}>
              <Text strong>Zahlungsfaelligkeiten (Plan)</Text>
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="FOs erzeugen nur Plan-Meilensteine. Zahlungen werden ausschließlich in POs bestätigt."
              />
              <div className="v2-stats-table-wrap" style={{ marginTop: 8 }}>
                <table className="v2-stats-table" data-layout="auto">
                  <thead>
                    <tr>
                      <th>Typ</th>
                      <th>Label</th>
                      <th>Soll</th>
                      <th>Waehrung</th>
                      <th>Fällig</th>
                      <th>Regel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {livePaymentPreviewRows.length ? (
                      livePaymentPreviewRows.map((row) => {
                        return (
                          <tr key={row.id}>
                            <td>{formatFoPaymentCategory(row.category)}</td>
                            <td>{row.label}</td>
                            <td>{formatCurrency(row.plannedEur)}</td>
                            <td>{row.currency}</td>
                            <td>{formatDate(row.dueDate)}</td>
                            <td>{`${row.triggerEvent} + ${formatNumber(row.offsetDays, 0)}d + ${formatNumber(row.offsetMonths, 0)}m`}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6}>Keine Zahlungszeilen.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </Form>
      </Modal>

      <Modal
        title="Einzel-FO in PO konvertieren"
        open={convertOpen}
        onCancel={() => setConvertOpen(false)}
        onOk={() => {
          void convertFo().catch((convertError: unknown) => {
            Modal.error({
              title: "Konvertierung fehlgeschlagen",
              content: convertError instanceof Error ? convertError.message : String(convertError),
            });
          });
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>PO Nummer</Text>
          <Input value={convertPoNo} onChange={(event) => setConvertPoNo(event.target.value)} />
          <Text>Order Date (optional)</Text>
          <Input type="date" value={convertOrderDate} onChange={(event) => setConvertOrderDate(event.target.value)} />
        </Space>
      </Modal>

      <Modal
        title="Mehrere FOs zu einer PO bündeln"
        open={mergeOpen}
        width={960}
        onCancel={() => setMergeOpen(false)}
        onOk={() => {
          void convertFoMerge().catch((mergeError: unknown) => {
            Modal.error({
              title: "Merge fehlgeschlagen",
              content: mergeError instanceof Error ? mergeError.message : String(mergeError),
            });
          });
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Text type="secondary">
            {mergeSelectedFos.length} FO(s) ausgewählt. Ergebnis ist eine Multi-SKU-PO mit PO-basierten Zahlungsmeilensteinen.
          </Text>
          <Space align="start" wrap style={{ width: "100%" }}>
            <div style={{ minWidth: 220, flex: 1 }}>
              <Text>PO Nummer</Text>
              <Input value={mergePoNo} onChange={(event) => setMergePoNo(event.target.value)} />
            </div>
            <div style={{ minWidth: 220, flex: 1 }}>
              <Text>Order Date (optional)</Text>
              <Input type="date" value={mergeOrderDate} onChange={(event) => setMergeOrderDate(event.target.value)} />
            </div>
          </Space>

          <div>
            <Text strong>Ziel-Liefertermin der PO</Text>
            <Space direction="vertical" style={{ marginTop: 6, width: "100%" }}>
              <Checkbox
                checked={mergeTargetMode === "earliest"}
                onChange={(event) => setMergeTargetMode(event.target.checked ? "earliest" : "manual")}
              >
                Frühester FO-Zieltermin verwenden ({formatDate(mergeEarliestTargetDate || null)})
              </Checkbox>
              <Checkbox
                checked={mergeTargetMode === "manual"}
                onChange={(event) => setMergeTargetMode(event.target.checked ? "manual" : "earliest")}
              >
                Manuelles Ziel setzen
              </Checkbox>
              {mergeTargetMode === "manual" ? (
                <Input
                  type="date"
                  value={mergeManualTargetDate}
                  onChange={(event) => setMergeManualTargetDate(event.target.value)}
                  style={{ maxWidth: 240 }}
                />
              ) : null}
            </Space>
          </div>

          {mergeHasSupplierMismatch ? (
            <Alert
              type="error"
              showIcon
              message="FO-Merge nur bei gleichem Lieferanten erlaubt."
            />
          ) : null}
          {mergeHasMixedTerms ? (
            <Alert
              type="warning"
              showIcon
              message="Gemischte Incoterms/Transportmodi erkannt."
              description={
                <div>
                  <div>Incoterms: {mergeIncoterms.join(", ") || "—"}</div>
                  <div>Transport: {mergeTransportModes.join(", ") || "—"}</div>
                  <Checkbox
                    checked={mergeAllowMixedTerms}
                    onChange={(event) => setMergeAllowMixedTerms(event.target.checked)}
                    style={{ marginTop: 8 }}
                  >
                    Ich habe den Mix geprüft und möchte trotzdem bündeln.
                  </Checkbox>
                </div>
              }
            />
          ) : null}

          <div className="v2-stats-table-wrap">
            <table className="v2-stats-table" data-layout="auto">
              <thead>
                <tr>
                  <th>FO</th>
                  <th>SKU</th>
                  <th>Units</th>
                  <th>FO Ziel</th>
                  <th>Abweichung zur PO</th>
                </tr>
              </thead>
              <tbody>
                {mergeSelectedFos.length ? mergeSelectedFos.map((fo) => {
                  const target = resolveFoTargetDeliveryDate(fo);
                  const row = mergeTimelineRows.find((entry) => entry.id === String(fo.id || ""));
                  return (
                    <tr key={String(fo.id || "")}>
                      <td>{resolveFoDisplayNumber({ foNo: fo.foNo, foNumber: fo.foNumber, id: fo.id })}</td>
                      <td>{String(fo.sku || "—")}</td>
                      <td>{formatNumber(fo.units, 0)}</td>
                      <td>{formatDate(target)}</td>
                      <td>
                        {row ? (
                          row.status < 0
                            ? <Tag color="red">{row.deviation}</Tag>
                            : row.status > 0
                              ? <Tag color="gold">{row.deviation}</Tag>
                              : <Tag color="green">{row.deviation}</Tag>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5}>Keine FOs gewählt.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Space>
      </Modal>
    </div>
  );
}
