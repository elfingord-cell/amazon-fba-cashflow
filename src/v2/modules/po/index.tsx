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
import { buildPaymentRows } from "../../../ui/orderEditorFactory.js";
import { allocatePayment, isHttpUrl, normalizePaymentId } from "../../../ui/utils/paymentValidation.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { computeScheduleFromOrderDate, nowIso, PO_ANCHORS, randomId } from "../../domain/orderUtils";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import { useModalCollaboration } from "../../sync/modalCollaboration";

const { Paragraph, Text, Title } = Typography;

const PO_CONFIG = {
  slug: "po",
  entityLabel: "PO",
  numberField: "poNo",
};

interface PoMilestoneDraft {
  id?: string;
  label: string;
  percent: number;
  anchor: string;
  lagDays: number;
}

interface PoFormValues {
  id?: string;
  poNo: string;
  sku: string;
  supplierId: string;
  orderDate: string;
  etdManual?: string;
  etaManual?: string;
  units: number;
  unitCostUsd: number;
  unitExtraUsd: number;
  extraFlatUsd: number;
  prodDays: number;
  transitDays: number;
  transport: "sea" | "rail" | "air";
  freightEur: number;
  dutyRatePct: number;
  dutyIncludeFreight: boolean;
  eustRatePct: number;
  fxOverride: number;
  ddp: boolean;
  archived: boolean;
  milestones: PoMilestoneDraft[];
}

interface PoRow {
  id: string;
  poNo: string;
  sku: string;
  alias: string;
  supplierName: string;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  goodsEur: number;
  openEur: number;
  paidEur: number;
  statusText: string;
  raw: Record<string, unknown>;
}

interface PoPaymentRow {
  id: string;
  typeLabel: string;
  label: string;
  dueDate: string | null;
  plannedEur: number;
  status: "open" | "paid";
  paidDate: string | null;
  paidEurActual: number | null;
  paymentId: string | null;
  method: string | null;
  paidBy: string | null;
  note: string;
  invoiceDriveUrl: string;
  invoiceFolderDriveUrl: string;
  eventType: string | null;
}

interface PoPaymentFormValues {
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

function shortId(value: string): string {
  return String(value || "").slice(-6).toUpperCase();
}

function statusTag(status: string): JSX.Element {
  if (status === "paid_only") return <Tag color="green">Bezahlt</Tag>;
  if (status === "mixed") return <Tag color="gold">Teilweise bezahlt</Tag>;
  return <Tag color="blue">Offen</Tag>;
}

function paymentTypeLabel(row: Pick<PoPaymentRow, "typeLabel" | "eventType" | "label">): string {
  if (row.eventType === "duty") return "Custom Duties";
  if (row.eventType === "eust") return "Einfuhrumsatzsteuer";
  if (row.eventType === "freight") return "Shipping China -> 3PL";
  if (row.eventType === "fx_fee") return "FX Gebuehr";
  const base = String(row.typeLabel || row.label || "").trim();
  return base || "Payment";
}

function paymentMethodOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "Alibaba Trade Assurance", label: "Alibaba Trade Assurance" },
    { value: "Wise Transfer", label: "Wise Transfer" },
    { value: "PayPal", label: "PayPal" },
    { value: "SEPA Bank Transfer", label: "SEPA Bank Transfer" },
    { value: "Kreditkarte", label: "Kreditkarte" },
  ];
}

function paymentPayerOptions(input: {
  displayNameMap: Record<string, string>;
  syncEmail: string | null;
}): Array<{ value: string; label: string }> {
  const labels = new Set<string>();
  Object.entries(input.displayNameMap || {}).forEach(([key, name]) => {
    const clean = String(name || key || "").trim();
    if (clean) labels.add(clean);
  });
  if (input.syncEmail) labels.add(String(input.syncEmail).trim());
  if (!labels.size) return [];
  return Array.from(labels).sort((a, b) => a.localeCompare(b, "de-DE", { sensitivity: "base" })).map((entry) => ({
    value: entry,
    label: entry,
  }));
}

function canOpenLink(value: string): boolean {
  const url = String(value || "").trim();
  return url.length > 0 && isHttpUrl(url);
}

function buildSuggestedInvoiceFilename(input: {
  paidDate: string;
  poNo: string;
  alias: string;
  units: number;
  selectedRows: PoPaymentRow[];
}): string {
  const date = String(input.paidDate || "").trim() || "YYYY-MM-DD";
  const poNo = String(input.poNo || "").trim() || "PO";
  const alias = String(input.alias || "").trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-") || "Alias";
  const units = Number.isFinite(Number(input.units)) ? Math.max(0, Math.round(Number(input.units))) : 0;
  const labels = Array.from(new Set((input.selectedRows || []).map((row) => paymentTypeLabel(row))))
    .map((entry) => entry.replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-"));
  const paymentChunk = labels.length ? labels.join("+") : "Payment";
  return `${date}_PO-${poNo}_${alias}_${units}u_${paymentChunk}.pdf`.replace(/-+/g, "-");
}

function poSettingsFromState(state: Record<string, unknown>): Record<string, unknown> {
  const settings = (state.settings || {}) as Record<string, unknown>;
  return {
    fxRate: Number(settings.fxRate || 0),
    fxFeePct: Number(settings.fxFeePct || 0),
    dutyRatePct: Number(settings.dutyRatePct || 0),
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: Number(settings.eustRatePct || 0),
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(settings.vatRefundLagMonths || 0),
    freightLagDays: Number(settings.freightLagDays || 0),
    cny: settings.cny || { start: "", end: "" },
    cnyBlackoutByYear: settings.cnyBlackoutByYear || {},
  };
}

function defaultMilestones(): PoMilestoneDraft[] {
  return [
    { label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
    { label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
  ];
}

function milestoneSum(milestones: PoMilestoneDraft[]): number {
  return Math.round((milestones || []).reduce((sum, row) => sum + Number(row.percent || 0), 0) * 100) / 100;
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function resolvePoProductPrefill(input: {
  product: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  units: number;
}): Partial<PoFormValues> {
  const product = input.product || {};
  const settings = input.settings || {};
  const template = templateFields(product);

  const transport = String(template.transportMode || "SEA").toLowerCase() as "sea" | "rail" | "air";
  const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const transitDays = toNumberOrNull(template.transitDays)
    ?? toNumberOrNull(transportLeadMap[transport])
    ?? 45;
  const prodDays = toNumberOrNull(product.productionLeadTimeDaysDefault ?? template.productionDays)
    ?? toNumberOrNull(settings.defaultProductionLeadTimeDays)
    ?? 60;
  const unitCostUsd = toNumberOrNull(template.unitPriceUsd) ?? 0;
  const fxOverride = toNumberOrNull(template.fxRate ?? settings.fxRate) ?? 0;
  const logisticsPerUnit = toNumberOrNull(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur) ?? 0;
  const freightEur = Math.max(0, Math.round(logisticsPerUnit * Math.max(0, Number(input.units || 0)) * 100) / 100);

  return {
    transport,
    prodDays: Math.max(0, Math.round(prodDays)),
    transitDays: Math.max(0, Math.round(transitDays)),
    unitCostUsd,
    unitExtraUsd: 0,
    extraFlatUsd: 0,
    freightEur,
    dutyRatePct: toNumberOrNull(product.dutyRatePct ?? template.dutyPct ?? settings.dutyRatePct) ?? 0,
    eustRatePct: toNumberOrNull(product.eustRatePct ?? template.vatImportPct ?? settings.eustRatePct) ?? 0,
    fxOverride,
    ddp: template.ddp === true,
  };
}

function toPoRecord(values: PoFormValues, existing: Record<string, unknown> | null): Record<string, unknown> {
  const now = nowIso();
  const milestones = (values.milestones || []).map((row) => ({
    id: String(row.id || randomId("ms")),
    label: String(row.label || "Milestone"),
    percent: Number(row.percent || 0),
    anchor: String(row.anchor || "ORDER_DATE"),
    lagDays: Number(row.lagDays || 0),
  }));
  return {
    ...(existing || {}),
    id: String(values.id || existing?.id || randomId("po")),
    poNo: String(values.poNo || "").trim(),
    sku: String(values.sku || "").trim(),
    supplierId: String(values.supplierId || "").trim(),
    orderDate: values.orderDate || null,
    etdManual: values.etdManual || null,
    etaManual: values.etaManual || null,
    units: Number(values.units || 0),
    unitCostUsd: Number(values.unitCostUsd || 0),
    unitExtraUsd: Number(values.unitExtraUsd || 0),
    extraFlatUsd: Number(values.extraFlatUsd || 0),
    prodDays: Number(values.prodDays || 0),
    transitDays: Number(values.transitDays || 0),
    transport: String(values.transport || "sea").toLowerCase(),
    freightEur: Number(values.freightEur || 0),
    freightMode: "total",
    freightPerUnitEur: 0,
    dutyRatePct: Number(values.dutyRatePct || 0),
    dutyIncludeFreight: values.dutyIncludeFreight !== false,
    eustRatePct: Number(values.eustRatePct || 0),
    fxOverride: Number(values.fxOverride || 0),
    ddp: values.ddp === true,
    milestones,
    archived: values.archived === true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    paymentLog: existing?.paymentLog || {},
    autoEvents: existing?.autoEvents || undefined,
  };
}

export interface PoModuleProps {
  embedded?: boolean;
}

export default function PoModule({ embedded = false }: PoModuleProps = {}): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<PoFormValues>();
  const [paymentForm] = Form.useForm<PoPaymentFormValues>();
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
    () => `po:edit:${String(editingId || "new")}`,
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
  const poSettings = useMemo(() => poSettingsFromState(stateObj), [state.settings]);

  const supplierRows = useMemo(() => {
    return (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        id: String(entry.id || ""),
        name: String(entry.name || "—"),
      }))
      .filter((entry) => entry.id);
  }, [state.suppliers]);

  const supplierNameById = useMemo(() => new Map(supplierRows.map((entry) => [entry.id, entry.name])), [supplierRows]);

  const productRows = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        sku: String(entry.sku || ""),
        alias: String(entry.alias || entry.sku || ""),
        supplierId: String(entry.supplierId || ""),
        raw: entry,
      }))
      .filter((entry) => entry.sku);
  }, [state.products]);

  const productBySku = useMemo(() => new Map(productRows.map((entry) => [entry.sku, entry])), [productRows]);

  const rows = useMemo(() => {
    const paymentRecords = Array.isArray(state.payments) ? state.payments : [];
    return (Array.isArray(state.pos) ? state.pos : [])
      .map((entry) => {
        const po = entry as Record<string, unknown>;
        const schedule = computeScheduleFromOrderDate({
          orderDate: po.orderDate,
          productionLeadTimeDays: po.prodDays,
          logisticsLeadTimeDays: po.transitDays,
          bufferDays: 0,
        });
        const etdDate = String(po.etdManual || schedule.etdDate || "");
        const etaDate = String(po.etaManual || schedule.etaDate || "");
        const goodsUsd =
          Number(po.units || 0) * (Number(po.unitCostUsd || 0) + Number(po.unitExtraUsd || 0))
          + Number(po.extraFlatUsd || 0);
        const fxRate = Number(po.fxOverride || poSettings.fxRate || 0);
        const goodsEur = fxRate > 0 ? goodsUsd / fxRate : goodsUsd;
        const paymentRows = (() => {
          try {
            const cloned = structuredClone(po);
            return buildPaymentRows(cloned, PO_CONFIG, poSettings, paymentRecords as Record<string, unknown>[]);
          } catch {
            return [];
          }
        })();
        const paidEur = paymentRows
          .filter((row) => row.status === "paid")
          .reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
        const openEur = paymentRows
          .filter((row) => row.status !== "paid")
          .reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
        const statusText = openEur <= 0 && paidEur > 0
          ? "paid_only"
          : (openEur > 0 && paidEur > 0 ? "mixed" : "open");
        return {
          id: String(po.id || ""),
          poNo: String(po.poNo || ""),
          sku: String(po.sku || ""),
          alias: productBySku.get(String(po.sku || ""))?.alias || String(po.sku || "—"),
          supplierName: supplierNameById.get(String(po.supplierId || "")) || "—",
          orderDate: po.orderDate ? String(po.orderDate) : null,
          etdDate: etdDate || null,
          etaDate: etaDate || null,
          goodsEur,
          openEur,
          paidEur,
          statusText,
          raw: po,
        } satisfies PoRow;
      })
      .filter((row) => {
        if (!includeArchived && row.raw.archived) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [
          row.poNo,
          row.sku,
          row.alias,
          row.supplierName,
        ].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => String(a.poNo || "").localeCompare(String(b.poNo || "")));
  }, [includeArchived, poSettings, productBySku, search, state.payments, state.pos, supplierNameById]);

  const columns = useMemo<ColumnDef<PoRow>[]>(() => [
    { header: "PO", accessorKey: "poNo", meta: { width: 98 } },
    {
      header: "Produkt",
      meta: { width: 230 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>{row.original.alias}</Text>
          <Text type="secondary">{row.original.sku}</Text>
        </Space>
      ),
    },
    { header: "Supplier", accessorKey: "supplierName", meta: { width: 150 } },
    { header: "Order", meta: { width: 112 }, cell: ({ row }) => formatDate(row.original.orderDate) },
    {
      header: "ETD / ETA",
      meta: { width: 162 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>ETD {formatDate(row.original.etdDate)}</Text>
          <Text type="secondary">ETA {formatDate(row.original.etaDate)}</Text>
        </Space>
      ),
    },
    {
      header: "Warenwert",
      meta: { width: 130, align: "right" },
      cell: ({ row }) => formatCurrency(row.original.goodsEur),
    },
    {
      header: "Open / Paid",
      meta: { width: 160, align: "right" },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>Open: {formatCurrency(row.original.openEur)}</Text>
          <Text type="secondary">Paid: {formatCurrency(row.original.paidEur)}</Text>
        </Space>
      ),
    },
    {
      header: "Status",
      meta: { width: 110 },
      cell: ({ row }) => statusTag(row.original.statusText),
    },
    {
      header: "Aktionen",
      meta: { width: 190, minWidth: 190 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button size="small" onClick={() => openEditModal(row.original.raw)}>Bearbeiten</Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "PO loeschen?",
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.pos = (Array.isArray(next.pos) ? next.pos : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    return next;
                  }, "v2:po:delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </div>
      ),
    },
  ], [saveWith]);

  const draftValues = Form.useWatch([], form) as PoFormValues | undefined;

  const draftPoRecord = useMemo(() => {
    if (!draftValues) return null;
    const existing = editingId ? rows.find((row) => row.id === editingId)?.raw || null : null;
    return toPoRecord(draftValues, existing);
  }, [draftValues, editingId, rows]);

  const draftPaymentRows = useMemo<PoPaymentRow[]>(() => {
    if (!draftPoRecord) return [];
    try {
      const cloned = structuredClone(draftPoRecord);
      const rows = buildPaymentRows(
        cloned,
        PO_CONFIG,
        poSettings,
        (Array.isArray(state.payments) ? state.payments : []) as Record<string, unknown>[],
      );
      return rows.map((row) => ({
        id: String(row.id || ""),
        typeLabel: String(row.typeLabel || ""),
        label: String(row.label || ""),
        dueDate: row.dueDate ? String(row.dueDate) : null,
        plannedEur: Number(row.plannedEur || 0),
        status: row.status === "paid" ? "paid" : "open",
        paidDate: row.paidDate ? String(row.paidDate) : null,
        paidEurActual: Number.isFinite(Number(row.paidEurActual)) ? Number(row.paidEurActual) : null,
        paymentId: row.paymentId ? String(row.paymentId) : null,
        method: row.method ? String(row.method) : null,
        paidBy: row.paidBy ? String(row.paidBy) : null,
        note: String(row.note || ""),
        invoiceDriveUrl: String(row.invoiceDriveUrl || ""),
        invoiceFolderDriveUrl: String(row.invoiceFolderDriveUrl || ""),
        eventType: row.eventType ? String(row.eventType) : null,
      }));
    } catch {
      return [];
    }
  }, [draftPoRecord, poSettings, state.payments]);

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

  const payerOptions = useMemo(
    () => paymentPayerOptions({ displayNameMap, syncEmail: syncSession.email }),
    [displayNameMap, syncSession.email],
  );
  const methodOptions = useMemo(() => paymentMethodOptions(), []);
  const paymentSelectedIds = Form.useWatch("selectedEventIds", paymentForm) as string[] | undefined;
  const paymentDraftValues = Form.useWatch([], paymentForm) as PoPaymentFormValues | undefined;
  const paymentSelectedRows = useMemo(() => {
    const selected = new Set((paymentSelectedIds || []).map((entry) => String(entry || "")));
    return draftPaymentRows.filter((entry) => selected.has(entry.id));
  }, [draftPaymentRows, paymentSelectedIds]);
  const suggestedPaymentFilename = useMemo(() => {
    if (!draftPoRecord || !paymentDraftValues) return "";
    const alias = productBySku.get(String(draftPoRecord.sku || ""))?.alias || String(draftPoRecord.sku || "");
    return buildSuggestedInvoiceFilename({
      paidDate: paymentDraftValues.paidDate,
      poNo: String(draftPoRecord.poNo || ""),
      alias,
      units: Number(draftPoRecord.units || 0),
      selectedRows: paymentSelectedRows,
    });
  }, [draftPoRecord, paymentDraftValues, paymentSelectedRows, productBySku]);

  useEffect(() => {
    if (!modalOpen || !modalCollab.readOnly || !modalCollab.remoteDraftPatch) return;
    form.setFieldsValue(modalCollab.remoteDraftPatch as Partial<PoFormValues>);
  }, [form, modalCollab.readOnly, modalCollab.remoteDraftPatch, modalCollab.remoteDraftVersion, modalOpen]);

  function buildDefaultDraft(
    existing?: Record<string, unknown> | null,
    prefill?: Partial<PoFormValues>,
  ): PoFormValues {
    const firstProduct = productRows[0] || null;
    const seedSku = String(prefill?.sku || existing?.sku || firstProduct?.sku || "");
    const product = productBySku.get(seedSku) || firstProduct;
    const units = Number(prefill?.units ?? existing?.units ?? 0);
    const defaults = resolvePoProductPrefill({
      product: product?.raw || null,
      settings,
      units,
    });

    return {
      id: existing?.id ? String(existing.id) : undefined,
      poNo: String(existing?.poNo || ""),
      sku: seedSku,
      supplierId: String(prefill?.supplierId || existing?.supplierId || product?.supplierId || supplierRows[0]?.id || ""),
      orderDate: String(prefill?.orderDate || existing?.orderDate || new Date().toISOString().slice(0, 10)),
      etdManual: String(prefill?.etdManual || existing?.etdManual || ""),
      etaManual: String(prefill?.etaManual || existing?.etaManual || ""),
      units,
      unitCostUsd: Number(existing?.unitCostUsd ?? defaults.unitCostUsd ?? 0),
      unitExtraUsd: Number(existing?.unitExtraUsd || 0),
      extraFlatUsd: Number(existing?.extraFlatUsd || 0),
      prodDays: Number(existing?.prodDays ?? defaults.prodDays ?? 60),
      transitDays: Number(existing?.transitDays ?? defaults.transitDays ?? 45),
      transport: (String(existing?.transport || defaults.transport || "sea").toLowerCase() as "sea" | "rail" | "air"),
      freightEur: Number(existing?.freightEur ?? defaults.freightEur ?? 0),
      dutyRatePct: Number(existing?.dutyRatePct ?? defaults.dutyRatePct ?? settings.dutyRatePct ?? 0),
      dutyIncludeFreight: existing?.dutyIncludeFreight !== false,
      eustRatePct: Number(existing?.eustRatePct ?? defaults.eustRatePct ?? settings.eustRatePct ?? 0),
      fxOverride: Number(existing?.fxOverride ?? defaults.fxOverride ?? settings.fxRate ?? 0),
      ddp: existing?.ddp === true ? true : Boolean(defaults.ddp),
      archived: existing?.archived === true,
      milestones: Array.isArray(existing?.milestones)
        ? (existing?.milestones as Record<string, unknown>[]).map((row) => ({
          id: String(row.id || randomId("ms")),
          label: String(row.label || "Milestone"),
          percent: Number(row.percent || 0),
          anchor: String(row.anchor || "ORDER_DATE"),
          lagDays: Number(row.lagDays || 0),
        }))
        : defaultMilestones(),
    };
  }

  function applyProductDefaults(skuValue: string, unitsOverride?: number): void {
    if (editingId) return;
    const sku = String(skuValue || "").trim();
    if (!sku) return;
    const product = productBySku.get(sku) || null;
    if (!product) return;
    const current = form.getFieldsValue();
    const defaults = resolvePoProductPrefill({
      product: product.raw,
      settings,
      units: Number(unitsOverride ?? current.units ?? 0),
    });
    const supplierId = String(product.supplierId || current.supplierId || "");
    form.setFieldsValue({
      supplierId,
      transport: defaults.transport,
      prodDays: defaults.prodDays,
      transitDays: defaults.transitDays,
      unitCostUsd: defaults.unitCostUsd,
      freightEur: defaults.freightEur,
      dutyRatePct: defaults.dutyRatePct,
      eustRatePct: defaults.eustRatePct,
      fxOverride: defaults.fxOverride,
      ddp: defaults.ddp,
    });
  }

  function openCreateModal(prefill?: Partial<PoFormValues>): void {
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

  function openPaymentBookingModal(seed?: PoPaymentRow | null): void {
    if (!editingId) {
      message.info("Bitte PO zuerst speichern, danach koennen Zahlungen verbucht werden.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const fromSeed = seed || null;
    const fromPaymentId = fromSeed?.paymentId || null;
    const selectedRows = fromPaymentId
      ? draftPaymentRows.filter((entry) => entry.paymentId === fromPaymentId)
      : (fromSeed ? [fromSeed] : draftPaymentRows.filter((entry) => entry.status !== "paid"));
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

  async function savePaymentBooking(values: PoPaymentFormValues): Promise<void> {
    if (modalCollab.readOnly) throw new Error("Nur Lesemodus: keine Zahlungen speichern.");
    if (!editingId) throw new Error("PO muss zuerst gespeichert werden.");
    const selectedIds = Array.from(new Set((values.selectedEventIds || []).map((entry) => String(entry || "").trim()).filter(Boolean)));
    if (!selectedIds.length) throw new Error("Bitte mindestens einen Zahlungsbaustein auswaehlen.");
    if (!values.paidDate) throw new Error("Bitte ein Zahlungsdatum setzen.");
    if (!values.method.trim()) throw new Error("Bitte eine Zahlungsmethode waehlen.");
    if (!values.paidBy.trim()) throw new Error("Bitte angeben, wer gezahlt hat.");
    const amountActualEur = Number(values.amountActualEur);
    if (!Number.isFinite(amountActualEur) || amountActualEur < 0) {
      throw new Error("Bitte einen gueltigen Ist-Betrag in EUR eingeben.");
    }
    if (values.invoiceDriveUrl && !isHttpUrl(values.invoiceDriveUrl)) {
      throw new Error("Invoice-Link muss mit http:// oder https:// beginnen.");
    }
    if (values.invoiceFolderDriveUrl && !isHttpUrl(values.invoiceFolderDriveUrl)) {
      throw new Error("Folder-Link muss mit http:// oder https:// beginnen.");
    }

    const paymentId = String(normalizePaymentId(values.paymentId) || normalizePaymentId(randomId("pay")) || randomId("pay"));
    const selectedRows = draftPaymentRows.filter((entry) => selectedIds.includes(entry.id));
    const allocations = allocatePayment(amountActualEur, selectedRows.map((row) => ({ id: row.id, plannedEur: row.plannedEur })));
    if (!allocations || !allocations.length) throw new Error("Konnte die Zahlung nicht auf die gewaehlten Bausteine verteilen.");

    const amountActualUsdRaw = Number(values.amountActualUsd);
    const amountActualUsd = Number.isFinite(amountActualUsdRaw) ? amountActualUsdRaw : null;
    const plannedSum = selectedRows.reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
    const usdAllocations = amountActualUsd != null && plannedSum > 0
      ? selectedRows.map((row) => {
        const share = Number(row.plannedEur || 0) / plannedSum;
        return {
          eventId: row.id,
          actual: Math.round(amountActualUsd * share * 100) / 100,
        };
      })
      : [];
    const usdByEvent = new Map(usdAllocations.map((entry) => [entry.eventId, entry.actual]));

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const pos = Array.isArray(next.pos) ? [...next.pos] : [];
      const index = pos.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === editingId);
      if (index < 0) throw new Error("PO nicht gefunden.");
      const record = { ...(pos[index] as Record<string, unknown>) };
      const paymentLog = (record.paymentLog && typeof record.paymentLog === "object")
        ? { ...(record.paymentLog as Record<string, Record<string, unknown>>) }
        : {};
      const oldPaymentId = paymentEditingId ? String(paymentEditingId) : null;

      paymentInitialEventIds.forEach((eventId) => {
        if (selectedIds.includes(eventId)) return;
        const prev = (paymentLog[eventId] && typeof paymentLog[eventId] === "object")
          ? { ...(paymentLog[eventId] as Record<string, unknown>) }
          : {};
        paymentLog[eventId] = {
          ...prev,
          status: "open",
          paidDate: null,
          paymentId: null,
          amountActualEur: null,
          amountActualUsd: null,
          method: null,
          payer: null,
          note: null,
        };
      });

      allocations.forEach((entry) => {
        const prev = (paymentLog[entry.eventId] && typeof paymentLog[entry.eventId] === "object")
          ? { ...(paymentLog[entry.eventId] as Record<string, unknown>) }
          : {};
        paymentLog[entry.eventId] = {
          ...prev,
          paymentInternalId: String(prev.paymentInternalId || randomId("payrow")),
          status: "paid",
          paidDate: values.paidDate,
          paymentId,
          amountActualEur: Number(entry.actual || 0),
          amountActualUsd: usdByEvent.get(entry.eventId) ?? null,
          method: values.method.trim(),
          payer: values.paidBy.trim(),
          note: values.note?.trim() || null,
        };
      });

      record.paymentLog = paymentLog;
      record.updatedAt = nowIso();
      pos[index] = record;
      next.pos = pos;

      const payments = Array.isArray(next.payments) ? [...next.payments] : [];
      const duplicateIndex = payments.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === paymentId);
      if (duplicateIndex >= 0 && (!oldPaymentId || String((payments[duplicateIndex] as Record<string, unknown>).id || "") !== oldPaymentId)) {
        const currentCovered = new Set((payments[duplicateIndex] as Record<string, unknown>).coveredEventIds as string[] || []);
        const overlap = selectedIds.some((eventId) => currentCovered.has(eventId));
        if (!overlap && paymentId !== oldPaymentId) {
          throw new Error(`Payment-ID ${paymentId} ist bereits vergeben.`);
        }
      }
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
      const upsertIndex = payments.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === paymentId);
      if (upsertIndex >= 0) payments[upsertIndex] = { ...(payments[upsertIndex] as Record<string, unknown>), ...payload };
      else payments.push(payload);
      next.payments = payments;
      return next;
    }, "v2:po:payment-booking");

    setPaymentModalOpen(false);
    setPaymentEditingId(null);
    setPaymentInitialEventIds([]);
    setPaymentModalError(null);
    paymentForm.resetFields();
    message.success("Zahlung wurde gespeichert.");
  }

  async function savePo(values: PoFormValues): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Diese PO wird gerade von einem anderen Nutzer bearbeitet.");
    }
    if (!values.poNo.trim()) {
      throw new Error("PO Nummer ist erforderlich.");
    }
    const sum = milestoneSum(values.milestones || []);
    if (Math.abs(sum - 100) > 0.01) {
      throw new Error("Milestone Prozentwerte muessen 100% ergeben.");
    }
    const existing = editingId
      ? rows.find((row) => row.id === editingId)?.raw || null
      : null;
    const record = toPoRecord(values, existing);

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.pos) ? [...next.pos] : [];
      const duplicate = list.find((entry) =>
        String((entry as Record<string, unknown>).poNo || "") === record.poNo
        && String((entry as Record<string, unknown>).id || "") !== String(record.id || ""),
      );
      if (duplicate) {
        throw new Error(`PO Nummer ${record.poNo} existiert bereits.`);
      }
      const index = list.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === String(record.id || ""));
      if (index >= 0) list[index] = record;
      else list.push(record);
      next.pos = list;
      return next;
    }, editingId ? "v2:po:update" : "v2:po:create");
    modalCollab.clearDraft();

    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("source") !== "inventory_projection") return;
    const sku = String(params.get("sku") || "").trim();
    if (!sku) return;
    const product = productRows.find((entry) => entry.sku === sku) || null;
    const suggestedUnits = Math.max(0, Math.round(Number(params.get("suggestedUnits") || 0)));
    const requiredArrivalDate = String(params.get("requiredArrivalDate") || "");
    const recommendedOrderDate = String(params.get("recommendedOrderDate") || "");

    const prefill: Partial<PoFormValues> = {
      sku,
      units: suggestedUnits,
    };
    if (product?.supplierId) prefill.supplierId = String(product.supplierId);
    if (requiredArrivalDate) prefill.etaManual = requiredArrivalDate;
    if (recommendedOrderDate) prefill.orderDate = recommendedOrderDate;

    openCreateModal(prefill);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate, productRows]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        {!embedded ? (
          <div className="v2-page-head">
            <div>
              <Title level={3}>Purchase Orders</Title>
              <Paragraph>
                PO-Stammdaten, Milestones, Auto-Events und Payment-Status in einem konsistenten Arbeitsbereich.
              </Paragraph>
            </div>
          </div>
        ) : null}
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => openCreateModal()}>Neue PO</Button>
            <Checkbox checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}>
              Archiv anzeigen
            </Checkbox>
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
          <Input
            placeholder="PO Nummer, SKU, Alias, Supplier"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 320, maxWidth: "100%" }}
          />
        </div>
        <TanStackGrid
          data={rows}
          columns={columns}
          minTableWidth={1360}
          tableLayout="auto"
        />
      </Card>

      <Modal
        title={editingId ? "PO bearbeiten" : "PO anlegen"}
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
              content: `${modalCollab.remoteUserLabel || "Kollege"} bearbeitet diese PO. Bitte Bearbeitung übernehmen oder warten.`,
            });
            return;
          }
          void form.validateFields().then((values) => savePo(values)).catch(() => {});
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
          name="v2-po-modal"
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
              name="poNo"
              label="PO Nummer"
              style={{ width: 190 }}
              rules={[{ required: true, message: "PO Nummer ist erforderlich." }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="sku" label="SKU" style={{ minWidth: 220, flex: 1 }} rules={[{ required: true }]}>
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
            <Form.Item name="supplierId" label="Supplier" style={{ minWidth: 220, flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                options={supplierRows.map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="orderDate" label="Order Date" style={{ width: 190 }} rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="etdManual" label="ETD Manual" style={{ width: 190 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="etaManual" label="ETA Manual" style={{ width: 190 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="transport" label="Transport" style={{ width: 150 }}>
              <Select
                options={[
                  { value: "sea", label: "SEA" },
                  { value: "rail", label: "RAIL" },
                  { value: "air", label: "AIR" },
                ]}
              />
            </Form.Item>
            <Form.Item name="prodDays" label="Prod Days" style={{ width: 140 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item name="transitDays" label="Transit Days" style={{ width: 140 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="units" label="Units" style={{ width: 130 }}>
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item name="unitCostUsd" label="Unit Cost USD" style={{ width: 170 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="unitExtraUsd" label="Unit Extra USD" style={{ width: 170 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="extraFlatUsd" label="Extra Flat USD" style={{ width: 170 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="fxOverride" label="FX Override" style={{ width: 150 }}>
              <DeNumberInput mode="fx" min={0} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="freightEur" label="Freight EUR" style={{ width: 170 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="dutyRatePct" label="Duty %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
            <Form.Item name="eustRatePct" label="EUSt %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
            <Form.Item name="dutyIncludeFreight" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>Duty inkl. Freight</Checkbox>
            </Form.Item>
            <Form.Item name="ddp" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>DDP</Checkbox>
            </Form.Item>
            <Form.Item name="archived" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>Archiviert</Checkbox>
            </Form.Item>
          </Space>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Text strong>Milestones</Text>
              <Text type={Math.abs(milestoneSum(draftValues?.milestones || []) - 100) <= 0.01 ? "secondary" : "danger"}>
                Summe: {formatNumber(milestoneSum(draftValues?.milestones || []), 2)}%
              </Text>
            </Space>
            <Form.List name="milestones">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ width: "100%" }} wrap>
                      <Form.Item
                        {...field}
                        name={[field.name, "label"]}
                        style={{ minWidth: 240, flex: 2 }}
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
                        name={[field.name, "anchor"]}
                        style={{ width: 160 }}
                        rules={[{ required: true, message: "Anchor fehlt." }]}
                      >
                        <Select options={PO_ANCHORS.map((anchor) => ({ value: anchor, label: anchor }))} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "lagDays"]}
                        style={{ width: 120 }}
                      >
                        <DeNumberInput mode="int" />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>X</Button>
                    </Space>
                  ))}
                  <Button
                    onClick={() => add({
                      id: randomId("ms"),
                      label: "Milestone",
                      percent: 0,
                      anchor: "ORDER_DATE",
                      lagDays: 0,
                    })}
                  >
                    Milestone
                  </Button>
                </Space>
              )}
            </Form.List>
          </Card>

          <Card size="small">
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Text strong>Event / Payment Preview</Text>
              <Button
                size="small"
                onClick={() => openPaymentBookingModal(null)}
                disabled={!editingId || !draftPaymentRows.length || modalCollab.readOnly}
              >
                Sammelzahlung buchen
              </Button>
            </Space>
            {draftPoRecord ? (
              <Space direction="vertical" size={4} style={{ width: "100%", marginTop: 8 }}>
                <Text>
                  Timeline: Order {formatDate(draftPoRecord.orderDate)} · ETD {
                    formatDate(
                      draftPoRecord.etdManual
                      || computeScheduleFromOrderDate({
                        orderDate: draftPoRecord.orderDate,
                        productionLeadTimeDays: draftPoRecord.prodDays,
                        logisticsLeadTimeDays: draftPoRecord.transitDays,
                        bufferDays: 0,
                      }).etdDate,
                    )
                  } · ETA {
                    formatDate(
                      draftPoRecord.etaManual
                      || computeScheduleFromOrderDate({
                        orderDate: draftPoRecord.orderDate,
                        productionLeadTimeDays: draftPoRecord.prodDays,
                        logisticsLeadTimeDays: draftPoRecord.transitDays,
                        bufferDays: 0,
                      }).etaDate,
                    )
                  }
                </Text>
                {!editingId ? (
                  <Alert
                    type="info"
                    showIcon
                    message="PO zuerst speichern, danach koennen Zahlungen (inkl. Sammelzahlung) verbucht werden."
                  />
                ) : null}
                <div className="v2-stats-table-wrap">
                  <table className="v2-stats-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Typ</th>
                        <th>Due</th>
                        <th>Planned EUR</th>
                        <th>Ist EUR</th>
                        <th>Status</th>
                        <th>Paid Date</th>
                        <th>Methode / Von</th>
                        <th>Invoice / Folder</th>
                        <th>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftPaymentRows.map((row) => (
                        <tr key={row.id}>
                          <td>{shortId(String(row.id || ""))}</td>
                          <td>{paymentTypeLabel(row)}</td>
                          <td>{formatDate(row.dueDate)}</td>
                          <td>{formatCurrency(row.plannedEur)}</td>
                          <td>{row.paidEurActual != null ? formatCurrency(row.paidEurActual) : "—"}</td>
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
                              {canOpenLink(row.invoiceDriveUrl) ? (
                                <a href={String(row.invoiceDriveUrl)} target="_blank" rel="noreferrer">Invoice</a>
                              ) : <Text type="secondary">Invoice —</Text>}
                              {canOpenLink(row.invoiceFolderDriveUrl) ? (
                                <a href={String(row.invoiceFolderDriveUrl)} target="_blank" rel="noreferrer">Folder</a>
                              ) : <Text type="secondary">Folder —</Text>}
                            </Space>
                          </td>
                          <td>
                            <Button
                              size="small"
                              onClick={() => openPaymentBookingModal(row)}
                              disabled={!editingId || modalCollab.readOnly}
                            >
                              {row.status === "paid" ? "Bearbeiten" : "Zahlung buchen"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Space>
            ) : (
              <Text type="secondary">Preview erscheint nach Eingabe.</Text>
            )}
          </Card>
        </Form>
      </Modal>

      <Modal
        title="PO Zahlung verbuchen"
        open={paymentModalOpen}
        width={920}
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
        <Form
          form={paymentForm}
          layout="vertical"
          onFinish={(values) => {
            setPaymentModalError(null);
            void savePaymentBooking(values).catch((saveError) => {
              setPaymentModalError(String(saveError instanceof Error ? saveError.message : saveError));
            });
          }}
        >
          <Form.Item
            name="selectedEventIds"
            label="Welche Zahlungsbausteine sind in dieser Zahlung enthalten?"
            rules={[{ required: true, message: "Bitte mindestens einen Baustein waehlen." }]}
          >
            <Checkbox.Group style={{ width: "100%" }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                {draftPaymentRows.map((row) => {
                  const lockedByOtherPayment = row.status === "paid"
                    && row.paymentId
                    && row.paymentId !== paymentEditingId
                    && !paymentInitialEventIds.includes(row.id);
                  return (
                    <Card key={row.id} size="small" style={{ width: "100%" }}>
                      <Checkbox value={row.id} disabled={lockedByOtherPayment}>
                        <Space size={10} wrap>
                          <Text strong>{paymentTypeLabel(row)}</Text>
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
            <Form.Item name="method" label="Zahlungsmethode" style={{ minWidth: 240, flex: 1 }} rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={methodOptions}
                placeholder="z. B. Alibaba Trade Assurance"
              />
            </Form.Item>
            <Form.Item name="paidBy" label="Bezahlt durch" style={{ minWidth: 220, flex: 1 }} rules={[{ required: true }]}>
              <Input placeholder={payerOptions.map((entry) => entry.label).join(" / ") || "Name oder E-Mail"} />
            </Form.Item>
          </Space>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="amountActualEur" label="Ist-Betrag EUR" style={{ width: 190 }} rules={[{ required: true }]}>
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
              disabled={!canOpenLink(String(paymentDraftValues?.invoiceDriveUrl || ""))}
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
              disabled={!canOpenLink(String(paymentDraftValues?.invoiceFolderDriveUrl || ""))}
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
    </div>
  );
}
