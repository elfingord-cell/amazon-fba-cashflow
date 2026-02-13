import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocation, useNavigate } from "react-router-dom";
import { buildPaymentRows } from "../../../ui/orderEditorFactory.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { computeScheduleFromOrderDate, nowIso, PO_ANCHORS, randomId } from "../../domain/orderUtils";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

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
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<PoFormValues>();

  const stateObj = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
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

  const draftPaymentRows = useMemo(() => {
    if (!draftPoRecord) return [];
    try {
      const cloned = structuredClone(draftPoRecord);
      return buildPaymentRows(
        cloned,
        PO_CONFIG,
        poSettings,
        (Array.isArray(state.payments) ? state.payments : []) as Record<string, unknown>[],
      );
    } catch {
      return [];
    }
  }, [draftPoRecord, poSettings, state.payments]);

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

  async function savePo(values: PoFormValues): Promise<void> {
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
            <Button type="primary" onClick={openCreateModal}>Neue PO</Button>
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
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => savePo(values)).catch(() => {});
        }}
      >
        <Form form={form} layout="vertical">
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
            <Text strong>Event / Payment Preview</Text>
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
                <div className="v2-stats-table-wrap">
                  <table className="v2-stats-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Typ</th>
                        <th>Due</th>
                        <th>Planned EUR</th>
                        <th>Status</th>
                        <th>Paid Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftPaymentRows.map((row) => (
                        <tr key={row.id}>
                          <td>{shortId(String(row.id || ""))}</td>
                          <td>{row.typeLabel || row.label}</td>
                          <td>{formatDate(row.dueDate)}</td>
                          <td>{formatCurrency(row.plannedEur)}</td>
                          <td>{row.status === "paid" ? "Bezahlt" : "Offen"}</td>
                          <td>{formatDate(row.paidDate)}</td>
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
    </div>
  );
}
