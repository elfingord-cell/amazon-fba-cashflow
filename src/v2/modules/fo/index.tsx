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
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocation, useNavigate } from "react-router-dom";
import { allocatePayment, isHttpUrl, normalizePaymentId } from "../../../ui/utils/paymentValidation.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
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
  extractSupplierTerms,
  normalizeFoRecord,
  nowIso,
  resolveProductBySku,
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
  sku: string;
  alias: string;
  supplierName: string;
  units: number;
  targetDeliveryDate: string | null;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  landedCostEur: number;
  status: string;
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
  status: "open" | "paid";
  paidDate: string | null;
  paymentId: string | null;
  paidEurActual: number | null;
  paidUsdActual: number | null;
  paidBy: string | null;
  method: string | null;
  note: string;
  invoiceDriveUrl: string;
  invoiceFolderDriveUrl: string;
}

interface FoPaymentBookingValues {
  selectedEventIds: string[];
  paidDate: string;
  method: string;
  paidBy: string;
  amountActualEur: number | null;
  amountActualUsd: number | null;
  paymentId: string;
  invoiceDriveUrl: string;
  invoiceFolderDriveUrl: string;
  note: string;
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
  const normalized = String(status || "DRAFT").toUpperCase();
  if (normalized === "CONVERTED") return <Tag color="blue">Converted</Tag>;
  if (normalized === "PLANNED") return <Tag color="green">Planned</Tag>;
  if (normalized === "CANCELLED") return <Tag color="default">Cancelled</Tag>;
  return <Tag color="orange">Draft</Tag>;
}

function formatFoPaymentCategory(category: FoPaymentPreviewRow["category"]): string {
  if (category === "supplier") return "Supplier";
  if (category === "freight") return "Shipping China -> 3PL";
  if (category === "duty") return "Custom Duties";
  if (category === "eust") return "Einfuhrumsatzsteuer";
  return "EUSt Erstattung";
}

function normalizeFoPaymentStatus(value: unknown): "open" | "paid" {
  return String(value || "").toLowerCase() === "paid" ? "paid" : "open";
}

function buildFoPaymentFilename(input: {
  paidDate: string;
  foId: string;
  alias: string;
  units: number;
  selectedRows: FoPaymentPreviewRow[];
}): string {
  const date = String(input.paidDate || "").trim() || "YYYY-MM-DD";
  const foNo = String(input.foId || "").slice(-6).toUpperCase() || "FO";
  const alias = String(input.alias || "").trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-") || "Alias";
  const units = Number.isFinite(Number(input.units)) ? Math.max(0, Math.round(Number(input.units))) : 0;
  const labels = Array.from(
    new Set((input.selectedRows || []).map((row) => formatFoPaymentCategory(row.category))),
  ).map((entry) => entry.replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-"));
  const paymentChunk = labels.length ? labels.join("+") : "Payment";
  return `${date}_FO-${foNo}_${alias}_${units}u_${paymentChunk}.pdf`.replace(/-+/g, "-");
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

function templateFields(product: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const template = (product?.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function resolveFoProductPrefill(input: {
  product: Record<string, unknown> | null;
  supplier: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  units: number;
}): Partial<FoFormValues> {
  const product = input.product || {};
  const supplier = input.supplier || {};
  const settings = input.settings || {};
  const template = templateFields(product);

  const unitPrice = toNumberOrNull(template.unitPriceUsd) ?? 0;
  const fxRate = toNumberOrNull(template.fxRate) ?? toNumberOrNull(settings.fxRate) ?? 0;
  const logisticsPerUnit = toNumberOrNull(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur) ?? 0;
  const freight = Math.max(0, round2(logisticsPerUnit * Math.max(0, Number(input.units || 0))));
  const transportMode = String(template.transportMode || "SEA").toUpperCase();
  const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const logisticsLead = toPositiveNumberOrNull(template.transitDays)
    ?? toPositiveNumberOrNull(transportLeadMap[transportMode.toLowerCase()])
    ?? 45;
  const productionLead = toPositiveNumberOrNull(product.productionLeadTimeDaysDefault)
    ?? toPositiveNumberOrNull(template.productionDays)
    ?? toPositiveNumberOrNull(settings.defaultProductionLeadTimeDays)
    ?? 45;
  const ddp = template.ddp === true;

  return {
    transportMode,
    incoterm: String(ddp ? "DDP" : (supplier.incotermDefault || "EXW")).toUpperCase(),
    unitPrice,
    currency: String(template.currency || supplier.currencyDefault || settings.defaultCurrency || "EUR").toUpperCase(),
    freight,
    freightCurrency: "EUR",
    dutyRatePct: toNumberOrNull(product.dutyRatePct ?? template.dutyPct ?? settings.dutyRatePct) ?? 0,
    eustRatePct: toNumberOrNull(product.eustRatePct ?? template.vatImportPct ?? settings.eustRatePct) ?? 0,
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
  const effectiveTransport = String(input.transportMode || template.transportMode || "SEA").toUpperCase();
  const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;

  let production = "Fallback";
  if (toPositiveNumberOrNull(product.productionLeadTimeDaysDefault) != null) {
    production = "Produkt-Override";
  } else if (toPositiveNumberOrNull(template.productionDays) != null) {
    production = "Beschaffungs-Template";
  } else if (toPositiveNumberOrNull(settings.defaultProductionLeadTimeDays) != null) {
    production = "Settings-Default";
  }

  let logistics = "Fallback";
  if (toPositiveNumberOrNull(template.transitDays) != null) {
    logistics = "Beschaffungs-Template";
  } else if (toPositiveNumberOrNull(transportLeadMap[effectiveTransport.toLowerCase()]) != null) {
    logistics = `Settings-Default (${effectiveTransport})`;
  } else if (toPositiveNumberOrNull(transportLeadMap.sea) != null) {
    logistics = "Settings-Default (SEA)";
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
  const [form] = Form.useForm<FoFormValues>();
  const [paymentForm] = Form.useForm<FoPaymentBookingValues>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentEditingId, setPaymentEditingId] = useState<string | null>(null);
  const [paymentModalError, setPaymentModalError] = useState<string | null>(null);
  const [paymentInitialEventIds, setPaymentInitialEventIds] = useState<string[]>([]);

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

  const recommendationContext = useMemo(
    () => buildFoRecommendationContext(stateObj),
    [state.forecast, state.inventory, state.pos, state.fos],
  );
  const paymentRecordById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.payments) ? state.payments : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "").trim();
      if (!id) return;
      map.set(id, row);
    });
    return map;
  }, [state.payments]);
  const paymentMethodOptions = useMemo(() => [
    { value: "Alibaba Trade Assurance", label: "Alibaba Trade Assurance" },
    { value: "Wise Transfer", label: "Wise Transfer" },
    { value: "PayPal", label: "PayPal" },
    { value: "SEPA Bank Transfer", label: "SEPA Bank Transfer" },
    { value: "Kreditkarte", label: "Kreditkarte" },
  ], []);
  const payerHint = useMemo(() => {
    const labels = new Set<string>();
    Object.entries(displayNameMap || {}).forEach(([email, name]) => {
      const text = String(name || email || "").trim();
      if (text) labels.add(text);
    });
    if (syncSession.email) labels.add(String(syncSession.email).trim());
    return Array.from(labels).join(" / ");
  }, [displayNameMap, syncSession.email]);

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
        sku,
        alias: product?.alias || sku || "—",
        supplierName: supplier?.name || "—",
        units: Number(fo.units || 0),
        targetDeliveryDate: fo.targetDeliveryDate ? String(fo.targetDeliveryDate) : null,
        orderDate: schedule.orderDate || null,
        etdDate: schedule.etdDate || null,
        etaDate: schedule.etaDate || null,
        landedCostEur: round2(costs.landedCostEur),
        status: String(fo.status || "DRAFT").toUpperCase(),
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

  const columns = useMemo<ColumnDef<FoRow>[]>(() => [
    {
      header: "FO",
      cell: ({ row }) => String(row.original.id || "").slice(-6).toUpperCase(),
    },
    {
      header: "Produkt",
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>{row.original.alias}</Text>
          <Text type="secondary">{row.original.sku}</Text>
        </Space>
      ),
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
            Bearbeiten
          </Button>
          <Button
            size="small"
            disabled={String(row.original.status || "").toUpperCase() === "CONVERTED"}
            onClick={() => {
              setConvertTargetId(row.original.id);
              setConvertPoNo(suggestNextPoNo(Array.isArray(state.pos) ? state.pos : []));
              setConvertOrderDate(row.original.orderDate || "");
              setConvertOpen(true);
            }}
          >
            Convert
          </Button>
          <Button
            size="small"
            danger
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
  ], [saveWith, state.pos]);

  const draftValues = Form.useWatch([], form) as FoFormValues | undefined;

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

  const liveCosts = useMemo(() => computeFoCostValues({
    units: draftValues?.units,
    unitPrice: draftValues?.unitPrice,
    currency: draftValues?.currency,
    freight: draftValues?.freight,
    freightCurrency: draftValues?.freightCurrency,
    dutyRatePct: draftValues?.dutyRatePct,
    eustRatePct: draftValues?.eustRatePct,
    fxRate: draftValues?.fxRate,
  }), [draftValues]);

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

  const editingFoPayments = useMemo(() => {
    if (!editingId) return null;
    const match = (Array.isArray(state.fos) ? state.fos : [])
      .find((entry) => String((entry as Record<string, unknown>).id || "") === editingId) as Record<string, unknown> | undefined;
    if (!match || !Array.isArray(match.payments)) return null;
    return match.payments;
  }, [editingId, state.fos]);

  const livePaymentPreviewRows = useMemo<FoPaymentPreviewRow[]>(() => {
    if (!draftValues) return [];
    const paymentRows = buildFoPayments({
      supplierTerms: Array.isArray(draftValues.paymentTerms) ? draftValues.paymentTerms : [],
      schedule: liveSchedule,
      unitPrice: draftValues.unitPrice,
      units: draftValues.units,
      currency: draftValues.currency,
      freight: draftValues.freight,
      freightCurrency: draftValues.freightCurrency,
      dutyRatePct: draftValues.dutyRatePct,
      eustRatePct: draftValues.eustRatePct,
      fxRate: draftValues.fxRate,
      incoterm: draftValues.incoterm,
      existingPayments: editingFoPayments,
    });
    return paymentRows.map((row) => {
      const paymentId = row.paymentId ? String(row.paymentId) : null;
      const paymentRecord = paymentId ? (paymentRecordById.get(paymentId) || null) : null;
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
        status: normalizeFoPaymentStatus(row.status || paymentRecord?.status),
        paidDate: row.paidDate ? String(row.paidDate) : (paymentRecord?.paidDate ? String(paymentRecord.paidDate) : null),
        paymentId,
        paidEurActual: Number.isFinite(Number(row.paidEurActual))
          ? Number(row.paidEurActual)
          : (Number.isFinite(Number(paymentRecord?.amountActualEurTotal)) ? Number(paymentRecord?.amountActualEurTotal) : null),
        paidUsdActual: Number.isFinite(Number(row.paidUsdActual))
          ? Number(row.paidUsdActual)
          : (Number.isFinite(Number(paymentRecord?.amountActualUsdTotal)) ? Number(paymentRecord?.amountActualUsdTotal) : null),
        paidBy: row.paidBy ? String(row.paidBy) : (paymentRecord?.payer ? String(paymentRecord.payer) : null),
        method: row.method ? String(row.method) : (paymentRecord?.method ? String(paymentRecord.method) : null),
        note: String(row.note || paymentRecord?.note || ""),
        invoiceDriveUrl: String(row.invoiceDriveUrl || paymentRecord?.invoiceDriveUrl || ""),
        invoiceFolderDriveUrl: String(row.invoiceFolderDriveUrl || paymentRecord?.invoiceFolderDriveUrl || ""),
      };
    });
  }, [draftValues, editingFoPayments, liveSchedule, paymentRecordById]);

  const supplierPercentSum = useMemo(
    () => sumSupplierPercent(draftValues?.paymentTerms || []),
    [draftValues?.paymentTerms],
  );
  const paymentSelectedIds = Form.useWatch("selectedEventIds", paymentForm) as string[] | undefined;
  const paymentDraftValues = Form.useWatch([], paymentForm) as FoPaymentBookingValues | undefined;
  const paymentSelectedRows = useMemo(() => {
    const selected = new Set((paymentSelectedIds || []).map((entry) => String(entry || "").trim()));
    return livePaymentPreviewRows.filter((row) => selected.has(row.id));
  }, [livePaymentPreviewRows, paymentSelectedIds]);
  const suggestedPaymentFilename = useMemo(() => {
    if (!paymentDraftValues || !draftValues) return "";
    const alias = productBySku.get(String(draftValues.sku || ""))?.alias || String(draftValues.sku || "");
    return buildFoPaymentFilename({
      paidDate: paymentDraftValues.paidDate,
      foId: String(draftValues.id || editingId || "FO"),
      alias,
      units: Number(draftValues.units || 0),
      selectedRows: paymentSelectedRows,
    });
  }, [draftValues, editingId, paymentDraftValues, paymentSelectedRows, productBySku]);

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
      product: seedProduct?.raw || null,
      supplier: supplier || null,
      settings,
      units,
    });
    const supplierTerms = extractSupplierTerms(existing?.payments, supplier || undefined);
    return {
      id: existing?.id ? String(existing.id) : undefined,
      sku: seedSku,
      supplierId,
      status: String(existing?.status || "DRAFT").toUpperCase() as FoStatus,
      targetDeliveryDate: String(prefill?.targetDeliveryDate || existing?.targetDeliveryDate || new Date().toISOString().slice(0, 10)),
      units,
      transportMode: String(existing?.transportMode || productDefaults.transportMode || "SEA").toUpperCase(),
      incoterm: String(existing?.incoterm || productDefaults.incoterm || "EXW").toUpperCase(),
      unitPrice: Number(existing?.unitPrice ?? productDefaults.unitPrice ?? 0),
      currency: String(existing?.currency || productDefaults.currency || settings.defaultCurrency || "EUR").toUpperCase(),
      freight: Number(existing?.freight ?? productDefaults.freight ?? 0),
      freightCurrency: String(existing?.freightCurrency || productDefaults.freightCurrency || "EUR").toUpperCase(),
      dutyRatePct: Number(existing?.dutyRatePct ?? productDefaults.dutyRatePct ?? 0),
      eustRatePct: Number(existing?.eustRatePct ?? productDefaults.eustRatePct ?? 0),
      fxRate: Number(existing?.fxRate ?? productDefaults.fxRate ?? settings.fxRate ?? 0),
      productionLeadTimeDays: Number(existing?.productionLeadTimeDays ?? productDefaults.productionLeadTimeDays ?? 45),
      logisticsLeadTimeDays: Number(existing?.logisticsLeadTimeDays ?? productDefaults.logisticsLeadTimeDays ?? 45),
      bufferDays: Number(existing?.bufferDays ?? productDefaults.bufferDays ?? settings.defaultBufferDays ?? 0),
      paymentTerms: supplierTerms,
    };
  }

  function applyProductDefaults(skuValue: string, unitsOverride?: number): void {
    if (editingId) return;
    const sku = String(skuValue || "").trim();
    if (!sku) return;
    const product = productBySku.get(sku) || null;
    if (!product) return;
    const current = form.getFieldsValue();
    const supplierId = String(product.supplierId || current.supplierId || "");
    const supplier = supplierById.get(supplierId) || null;
    const defaults = resolveFoProductPrefill({
      product: product.raw,
      supplier: supplier || null,
      settings,
      units: Number(unitsOverride ?? current.units ?? 0),
    });
    form.setFieldsValue({
      supplierId: supplierId || current.supplierId,
      transportMode: defaults.transportMode,
      incoterm: defaults.incoterm,
      unitPrice: defaults.unitPrice,
      currency: defaults.currency,
      freight: defaults.freight,
      freightCurrency: defaults.freightCurrency,
      dutyRatePct: defaults.dutyRatePct,
      eustRatePct: defaults.eustRatePct,
      fxRate: defaults.fxRate,
      productionLeadTimeDays: defaults.productionLeadTimeDays,
      logisticsLeadTimeDays: defaults.logisticsLeadTimeDays,
      bufferDays: defaults.bufferDays,
      paymentTerms: extractSupplierTerms([], supplier || undefined),
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

  function openPaymentBookingModal(seed?: FoPaymentPreviewRow | null): void {
    if (!editingId) {
      message.info("Bitte FO zuerst speichern, danach koennen Zahlungen verbucht werden.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const fromSeed = seed || null;
    const fromPaymentId = fromSeed?.paymentId || null;
    const selectableRows = livePaymentPreviewRows.filter((row) => row.category !== "eust_refund" && row.amount >= 0);
    const selectedRows = fromPaymentId
      ? selectableRows.filter((entry) => entry.paymentId === fromPaymentId)
      : (fromSeed ? [fromSeed] : selectableRows.filter((entry) => entry.status !== "paid"));
    const selectedEventIds = selectedRows.map((entry) => entry.id);
    const plannedSum = selectedRows.reduce((sum, entry) => sum + Number(entry.plannedEur || 0), 0);
    const paymentRecord = fromPaymentId ? (paymentRecordById.get(fromPaymentId) || null) : null;
    const requestedPaymentId = String(
      paymentRecord?.id
      || fromPaymentId
      || normalizePaymentId(randomId("pay"))
      || randomId("pay"),
    );
    paymentForm.setFieldsValue({
      selectedEventIds,
      paidDate: String(paymentRecord?.paidDate || fromSeed?.paidDate || today),
      method: String(paymentRecord?.method || fromSeed?.method || "Alibaba Trade Assurance"),
      paidBy: String(paymentRecord?.payer || fromSeed?.paidBy || ownDisplayName || syncSession.email || ""),
      amountActualEur: Number.isFinite(Number(paymentRecord?.amountActualEurTotal))
        ? Number(paymentRecord?.amountActualEurTotal)
        : Math.round(plannedSum * 100) / 100,
      amountActualUsd: Number.isFinite(Number(paymentRecord?.amountActualUsdTotal))
        ? Number(paymentRecord?.amountActualUsdTotal)
        : null,
      paymentId: requestedPaymentId,
      invoiceDriveUrl: String(paymentRecord?.invoiceDriveUrl || fromSeed?.invoiceDriveUrl || ""),
      invoiceFolderDriveUrl: String(paymentRecord?.invoiceFolderDriveUrl || fromSeed?.invoiceFolderDriveUrl || ""),
      note: String(paymentRecord?.note || fromSeed?.note || ""),
    });
    setPaymentInitialEventIds(selectedEventIds);
    setPaymentEditingId(paymentRecord?.id ? String(paymentRecord.id) : null);
    setPaymentModalError(null);
    setPaymentModalOpen(true);
  }

  async function savePaymentBooking(values: FoPaymentBookingValues): Promise<void> {
    if (modalCollab.readOnly) throw new Error("Nur Lesemodus: keine Zahlungen speichern.");
    if (!editingId) throw new Error("FO muss zuerst gespeichert werden.");
    const selectedIds = Array.from(new Set((values.selectedEventIds || []).map((entry) => String(entry || "").trim()).filter(Boolean)));
    if (!selectedIds.length) throw new Error("Bitte mindestens einen Zahlungsbaustein waehlen.");
    if (!values.paidDate) throw new Error("Bitte ein Zahlungsdatum setzen.");
    if (!values.method.trim()) throw new Error("Bitte eine Zahlungsmethode waehlen.");
    if (!values.paidBy.trim()) throw new Error("Bitte angeben, wer gezahlt hat.");
    const amountActualEur = Number(values.amountActualEur);
    if (!Number.isFinite(amountActualEur) || amountActualEur < 0) throw new Error("Bitte einen gueltigen Ist-Betrag in EUR eingeben.");
    if (values.invoiceDriveUrl && !isHttpUrl(values.invoiceDriveUrl)) throw new Error("Invoice-Link muss mit http:// oder https:// beginnen.");
    if (values.invoiceFolderDriveUrl && !isHttpUrl(values.invoiceFolderDriveUrl)) throw new Error("Folder-Link muss mit http:// oder https:// beginnen.");

    const paymentId = String(normalizePaymentId(values.paymentId) || normalizePaymentId(randomId("pay")) || randomId("pay"));
    const selectedRows = livePaymentPreviewRows.filter((entry) => selectedIds.includes(entry.id));
    const allocations = allocatePayment(amountActualEur, selectedRows.map((row) => ({ id: row.id, plannedEur: row.plannedEur })));
    if (!allocations || !allocations.length) throw new Error("Konnte die Zahlung nicht auf die gewaehlten Bausteine verteilen.");
    const amountActualUsdRaw = Number(values.amountActualUsd);
    const amountActualUsd = Number.isFinite(amountActualUsdRaw) ? amountActualUsdRaw : null;
    const plannedSum = selectedRows.reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
    const usdByEvent = new Map<string, number>(
      amountActualUsd != null && plannedSum > 0
        ? selectedRows.map((row) => [
          row.id,
          Math.round((amountActualUsd * (Number(row.plannedEur || 0) / plannedSum)) * 100) / 100,
        ])
        : [],
    );

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const fos = Array.isArray(next.fos) ? [...next.fos] : [];
      const foIndex = fos.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === editingId);
      if (foIndex < 0) throw new Error("FO nicht gefunden.");
      const fo = { ...(fos[foIndex] as Record<string, unknown>) };
      const payments = Array.isArray(fo.payments)
        ? [...(fo.payments as Record<string, unknown>[])]
        : [];
      const paymentById = new Map(payments.map((entry) => [String(entry.id || ""), { ...(entry as Record<string, unknown>) }]));

      paymentInitialEventIds.forEach((eventId) => {
        if (selectedIds.includes(eventId)) return;
        const row = paymentById.get(eventId);
        if (!row) return;
        if (row.paymentId && row.paymentId !== paymentId) return;
        row.status = "open";
        row.paidDate = null;
        row.paymentId = null;
        row.paidEurActual = null;
        row.paidUsdActual = null;
        row.method = null;
        row.paidBy = null;
        row.note = null;
      });

      allocations.forEach((allocation) => {
        const row = paymentById.get(allocation.eventId);
        if (!row) return;
        row.status = "paid";
        row.paidDate = values.paidDate;
        row.paymentId = paymentId;
        row.paidEurActual = Number(allocation.actual || 0);
        row.paidUsdActual = usdByEvent.get(allocation.eventId) ?? null;
        row.method = values.method.trim();
        row.paidBy = values.paidBy.trim();
        row.note = values.note?.trim() || null;
        row.invoiceDriveUrl = values.invoiceDriveUrl?.trim() || "";
        row.invoiceFolderDriveUrl = values.invoiceFolderDriveUrl?.trim() || "";
      });

      fo.payments = Array.from(paymentById.values());
      fo.updatedAt = nowIso();
      fos[foIndex] = fo;
      next.fos = fos;

      const statePayments = Array.isArray(next.payments) ? [...next.payments] : [];
      const payload: Record<string, unknown> = {
        id: paymentId,
        paidDate: values.paidDate,
        method: values.method.trim(),
        payer: values.paidBy.trim(),
        currency: "EUR",
        amountActualEurTotal: amountActualEur,
        amountActualUsdTotal: amountActualUsd,
        coveredEventIds: selectedIds,
        note: values.note?.trim() || null,
        invoiceDriveUrl: values.invoiceDriveUrl?.trim() || "",
        invoiceFolderDriveUrl: values.invoiceFolderDriveUrl?.trim() || "",
      };
      const upsertIndex = statePayments.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === paymentId);
      if (upsertIndex >= 0) statePayments[upsertIndex] = { ...(statePayments[upsertIndex] as Record<string, unknown>), ...payload };
      else statePayments.push(payload);
      next.payments = statePayments;
      return next;
    }, "v2:fo:payment-booking");

    setPaymentModalOpen(false);
    setPaymentEditingId(null);
    setPaymentInitialEventIds([]);
    setPaymentModalError(null);
    paymentForm.resetFields();
    message.success("FO-Zahlung wurde gespeichert.");
  }

  async function saveFo(values: FoFormValues): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Dieser FO wird gerade von einem anderen Nutzer bearbeitet.");
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
    const existing = editingId
      ? rows.find((entry) => entry.id === editingId)?.raw || null
      : null;
    const schedule = computeFoSchedule({
      targetDeliveryDate: values.targetDeliveryDate,
      productionLeadTimeDays: values.productionLeadTimeDays,
      logisticsLeadTimeDays: values.logisticsLeadTimeDays,
      bufferDays: values.bufferDays,
    });
    const normalized = normalizeFoRecord({
      existing,
      supplierTerms: terms,
      values: values as unknown as Record<string, unknown>,
      schedule,
    });

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.fos) ? [...next.fos] : [];
      const index = list.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === String(normalized.id));
      if (index >= 0) {
        list[index] = normalized;
      } else {
        list.push(normalized);
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
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("source") !== "inventory_projection") return;
    const sku = String(params.get("sku") || "").trim();
    if (!sku) return;
    const product = productBySku.get(sku) || null;
    const suggestedUnits = Math.max(0, Math.round(Number(params.get("suggestedUnits") || 0)));
    const requiredArrivalDate = String(params.get("requiredArrivalDate") || "");

    const prefill: Partial<FoFormValues> = {
      sku,
      units: suggestedUnits,
    };
    if (product?.supplierId) prefill.supplierId = String(product.supplierId);
    if (requiredArrivalDate) prefill.targetDeliveryDate = requiredArrivalDate;

    openCreateModal(prefill);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate, productBySku]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        {!embedded ? (
          <div className="v2-page-head">
            <div>
              <Title level={3}>Forecast Orders</Title>
              <Paragraph>
                Backward Scheduling, FO-Empfehlung und Conversion nach PO in einem durchgängigen Flow.
              </Paragraph>
            </div>
          </div>
        ) : null}
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => openCreateModal()}>Create FO</Button>
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
        </div>
        <TanStackGrid
          data={rows}
          columns={columns}
          minTableWidth={1400}
          tableLayout="auto"
        />
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
          if (modalCollab.readOnly) {
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
        <Form
          name="v2-fo-modal"
          form={form}
          layout="vertical"
          disabled={modalCollab.readOnly}
          onValuesChange={(changedValues) => {
            if (modalCollab.readOnly) return;
            modalCollab.publishDraftPatch(changedValues as Record<string, unknown>);
          }}
        >
          <Form.Item name="id" hidden>
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
              />
            </Form.Item>
            <Form.Item
              name="status"
              label="Status"
              style={{ width: 170 }}
            >
              <Select options={FO_STATUS_VALUES.map((status) => ({ value: status, label: status }))} />
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
              <Select options={TRANSPORT_MODES.map((mode) => ({ value: mode, label: mode }))} />
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
            <Form.Item name="unitPrice" label="Unit Price" style={{ width: 160 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="freight" label="Freight" style={{ width: 160 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="freightCurrency" label="Freight Currency" style={{ width: 170 }}>
              <Select options={PAYMENT_CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
            </Form.Item>
            <Form.Item name="dutyRatePct" label="Duty %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
            <Form.Item name="eustRatePct" label="EUSt %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
          </Space>

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
              onClick={() => {
                const values = form.getFieldsValue();
                const supplier = supplierById.get(String(values.supplierId || ""));
                const terms = extractSupplierTerms([], supplier || undefined);
                form.setFieldsValue({
                  incoterm: String(supplier?.incotermDefault || values.incoterm || "EXW").toUpperCase(),
                  currency: String(supplier?.currencyDefault || values.currency || settings.defaultCurrency || "EUR").toUpperCase(),
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
                      <Button danger onClick={() => remove(field.name)}>X</Button>
                    </Space>
                  ))}
                  <Space>
                    <Button
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
              <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                <Text strong>Zahlungsfaelligkeiten (Preview)</Text>
                <Button
                  size="small"
                  onClick={() => openPaymentBookingModal(null)}
                  disabled={!editingId || !livePaymentPreviewRows.length || modalCollab.readOnly}
                >
                  Sammelzahlung buchen
                </Button>
              </Space>
              {!editingId ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 8 }}
                  message="FO zuerst speichern, danach koennen Zahlungen verbucht werden."
                />
              ) : null}
              <div className="v2-stats-table-wrap" style={{ marginTop: 8 }}>
                <table className="v2-stats-table" data-layout="auto">
                  <thead>
                    <tr>
                      <th>Typ</th>
                      <th>Label</th>
                      <th>Soll</th>
                      <th>Ist</th>
                      <th>Währung</th>
                      <th>Fällig</th>
                      <th>Status</th>
                      <th>Paid</th>
                      <th>Methode / Von</th>
                      <th>Invoice / Folder</th>
                      <th>Aktionen</th>
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
                            <td>{row.paidEurActual != null ? formatCurrency(row.paidEurActual) : "—"}</td>
                            <td>{row.currency}</td>
                            <td>{formatDate(row.dueDate)}</td>
                            <td>{row.status === "paid" ? "Bezahlt" : "Offen"}</td>
                            <td>{formatDate(row.paidDate)}</td>
                            <td>
                              {row.method || row.paidBy ? (
                                <Space direction="vertical" size={0}>
                                  <Text>{row.method || "—"}</Text>
                                  <Text type="secondary">{row.paidBy || "—"}</Text>
                                </Space>
                              ) : "—"}
                            </td>
                            <td>
                              <Space direction="vertical" size={0}>
                                {row.invoiceDriveUrl && isHttpUrl(row.invoiceDriveUrl) ? (
                                  <a href={row.invoiceDriveUrl} target="_blank" rel="noreferrer">Invoice</a>
                                ) : <Text type="secondary">Invoice —</Text>}
                                {row.invoiceFolderDriveUrl && isHttpUrl(row.invoiceFolderDriveUrl) ? (
                                  <a href={row.invoiceFolderDriveUrl} target="_blank" rel="noreferrer">Folder</a>
                                ) : <Text type="secondary">Folder —</Text>}
                              </Space>
                            </td>
                            <td>
                              <Button
                                size="small"
                                onClick={() => openPaymentBookingModal(row)}
                                disabled={!editingId || modalCollab.readOnly || row.category === "eust_refund"}
                              >
                                {row.status === "paid" ? "Bearbeiten" : "Zahlung buchen"}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={11}>Keine Zahlungszeilen.</td>
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
        title="FO Zahlung verbuchen"
        open={paymentModalOpen}
        width={900}
        onCancel={() => {
          setPaymentModalOpen(false);
          setPaymentEditingId(null);
          setPaymentInitialEventIds([]);
          setPaymentModalError(null);
          paymentForm.resetFields();
        }}
        onOk={() => {
          setPaymentModalError(null);
          void paymentForm.validateFields().then((values) => savePaymentBooking(values)).catch((saveError) => {
            if (saveError?.errorFields) return;
            setPaymentModalError(String(saveError instanceof Error ? saveError.message : saveError));
          });
        }}
      >
        {paymentModalError ? (
          <Alert type="error" showIcon message={paymentModalError} style={{ marginBottom: 10 }} />
        ) : null}
        <Form form={paymentForm} layout="vertical">
          <Form.Item
            name="selectedEventIds"
            label="Welche Zahlungsbausteine sind in dieser Zahlung enthalten?"
            rules={[{ required: true, message: "Bitte mindestens einen Baustein waehlen." }]}
          >
            <Checkbox.Group style={{ width: "100%" }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                {livePaymentPreviewRows
                  .filter((row) => row.category !== "eust_refund" && row.amount >= 0)
                  .map((row) => {
                    const lockedByOtherPayment = row.status === "paid"
                      && row.paymentId
                      && row.paymentId !== paymentEditingId
                      && !paymentInitialEventIds.includes(row.id);
                    return (
                      <Card key={row.id} size="small" style={{ width: "100%" }}>
                        <Checkbox value={row.id} disabled={lockedByOtherPayment}>
                          <Space size={10} wrap>
                            <Text strong>{formatFoPaymentCategory(row.category)}</Text>
                            <Text type="secondary">{row.label}</Text>
                            <Text type="secondary">Due {formatDate(row.dueDate)}</Text>
                            <Text>{formatCurrency(row.plannedEur)}</Text>
                            {row.status === "paid" ? <Tag color="green">Bereits bezahlt</Tag> : <Tag>Offen</Tag>}
                            {row.paymentId ? <Text type="secondary">Payment-ID {row.paymentId}</Text> : null}
                          </Space>
                        </Checkbox>
                      </Card>
                    );
                  })}
              </Space>
            </Checkbox.Group>
          </Form.Item>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="paidDate" label="Zahlungsdatum" style={{ width: 170 }} rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="method" label="Zahlungsmethode" style={{ minWidth: 230, flex: 1 }} rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={paymentMethodOptions} />
            </Form.Item>
            <Form.Item name="paidBy" label="Bezahlt durch" style={{ minWidth: 220, flex: 1 }} rules={[{ required: true }]}>
              <Input placeholder={payerHint || "Name oder E-Mail"} />
            </Form.Item>
          </Space>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="amountActualEur" label="Ist-Betrag EUR" style={{ width: 180 }} rules={[{ required: true }]}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="amountActualUsd" label="Ist-Betrag USD (optional)" style={{ width: 210 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="paymentId" label="Payment-ID (intern)" style={{ minWidth: 300, flex: 1 }}>
              <Input placeholder="pay-..." />
            </Form.Item>
          </Space>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="invoiceDriveUrl" label="Invoice Link (Google Drive)" style={{ minWidth: 360, flex: 1 }}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Button
              style={{ marginTop: 31 }}
              disabled={!isHttpUrl(String(paymentDraftValues?.invoiceDriveUrl || ""))}
              onClick={() => window.open(String(paymentDraftValues?.invoiceDriveUrl || ""), "_blank", "noopener,noreferrer")}
            >
              Link oeffnen
            </Button>
          </Space>
          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="invoiceFolderDriveUrl" label="Ordner-Link (Google Drive)" style={{ minWidth: 360, flex: 1 }}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Button
              style={{ marginTop: 31 }}
              disabled={!isHttpUrl(String(paymentDraftValues?.invoiceFolderDriveUrl || ""))}
              onClick={() => window.open(String(paymentDraftValues?.invoiceFolderDriveUrl || ""), "_blank", "noopener,noreferrer")}
            >
              Ordner oeffnen
            </Button>
          </Space>

          <Form.Item name="note" label="Notiz">
            <Input.TextArea rows={2} placeholder="Optionaler Hinweis" />
          </Form.Item>

          <Card size="small">
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              <Text strong>Dateiname-Vorschlag fuer Rechnung</Text>
              <Text code>{suggestedPaymentFilename || "—"}</Text>
              <div>
                <Button
                  size="small"
                  onClick={() => {
                    if (!suggestedPaymentFilename) return;
                    void navigator.clipboard.writeText(suggestedPaymentFilename);
                    message.success("Dateiname kopiert.");
                  }}
                >
                  Dateiname kopieren
                </Button>
              </div>
            </Space>
          </Card>
        </Form>
      </Modal>

      <Modal
        title="FO in PO konvertieren"
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
    </div>
  );
}
