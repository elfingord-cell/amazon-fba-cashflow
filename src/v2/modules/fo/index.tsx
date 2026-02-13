import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackGrid } from "../../components/TanStackGrid";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
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

function statusTag(status: string): JSX.Element {
  const normalized = String(status || "DRAFT").toUpperCase();
  if (normalized === "CONVERTED") return <Tag color="blue">Converted</Tag>;
  if (normalized === "PLANNED") return <Tag color="green">Planned</Tag>;
  if (normalized === "CANCELLED") return <Tag color="default">Cancelled</Tag>;
  return <Tag color="orange">Draft</Tag>;
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

export interface FoModuleProps {
  embedded?: boolean;
}

export default function FoModule({ embedded = false }: FoModuleProps = {}): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | FoStatus>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTargetId, setConvertTargetId] = useState<string | null>(null);
  const [convertPoNo, setConvertPoNo] = useState("");
  const [convertOrderDate, setConvertOrderDate] = useState("");
  const [form] = Form.useForm<FoFormValues>();

  const stateObj = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;

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
    });
  }, [draftValues, productRows, recommendationContext, settings]);

  const supplierPercentSum = useMemo(
    () => sumSupplierPercent(draftValues?.paymentTerms || []),
    [draftValues?.paymentTerms],
  );

  function buildDefaultDraft(existing?: Record<string, unknown> | null): FoFormValues {
    const firstActiveProduct = productRows.find((entry) => isProductActive(entry.raw)) || productRows[0] || null;
    const supplierId = String(existing?.supplierId || firstActiveProduct?.supplierId || supplierRows[0]?.id || "");
    const supplier = supplierById.get(supplierId) || null;
    const defaultTransport = String(existing?.transportMode || "SEA").toUpperCase();
    const defaultLead = Number(
      existing?.productionLeadTimeDays
      ?? supplier?.productionLeadTimeDaysDefault
      ?? firstActiveProduct?.productionLeadTimeDaysDefault
      ?? settings.defaultProductionLeadTimeDays
      ?? 45,
    ) || 45;
    const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
    const logisticsLead = Number(
      existing?.logisticsLeadTimeDays
      ?? transportLeadMap[String(defaultTransport || "SEA").toLowerCase()]
      ?? 45,
    ) || 45;
    const supplierTerms = extractSupplierTerms(existing?.payments, supplier || undefined);
    return {
      id: existing?.id ? String(existing.id) : undefined,
      sku: String(existing?.sku || firstActiveProduct?.sku || ""),
      supplierId,
      status: String(existing?.status || "DRAFT").toUpperCase() as FoStatus,
      targetDeliveryDate: String(existing?.targetDeliveryDate || new Date().toISOString().slice(0, 10)),
      units: Number(existing?.units || 0),
      transportMode: defaultTransport,
      incoterm: String(existing?.incoterm || supplier?.incotermDefault || "EXW").toUpperCase(),
      unitPrice: Number(existing?.unitPrice || 0),
      currency: String(existing?.currency || supplier?.currencyDefault || settings.defaultCurrency || "EUR").toUpperCase(),
      freight: Number(existing?.freight || 0),
      freightCurrency: String(existing?.freightCurrency || "EUR").toUpperCase(),
      dutyRatePct: Number(existing?.dutyRatePct ?? settings.dutyRatePct ?? 0),
      eustRatePct: Number(existing?.eustRatePct ?? settings.eustRatePct ?? 0),
      fxRate: Number(existing?.fxRate ?? settings.fxRate ?? 0),
      productionLeadTimeDays: defaultLead,
      logisticsLeadTimeDays: logisticsLead,
      bufferDays: Number(existing?.bufferDays ?? settings.defaultBufferDays ?? 0),
      paymentTerms: supplierTerms,
    };
  }

  function openCreateModal(): void {
    setEditingId(null);
    form.setFieldsValue(buildDefaultDraft(null));
    setModalOpen(true);
  }

  function openEditModal(existing: Record<string, unknown>): void {
    setEditingId(String(existing.id || ""));
    form.setFieldsValue(buildDefaultDraft(existing));
    setModalOpen(true);
  }

  async function saveFo(values: FoFormValues): Promise<void> {
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
            <Button type="primary" onClick={openCreateModal}>Create FO</Button>
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
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => saveFo(values)).catch(() => {});
        }}
      >
        <Form form={form} layout="vertical">
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
              <InputNumber style={{ width: "100%" }} min={0} />
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
              <InputNumber style={{ width: "100%" }} min={0} step={0.0001} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="unitPrice" label="Unit Price" style={{ width: 160 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="freight" label="Freight" style={{ width: 160 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="freightCurrency" label="Freight Currency" style={{ width: 170 }}>
              <Select options={PAYMENT_CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
            </Form.Item>
            <Form.Item name="dutyRatePct" label="Duty %" style={{ width: 140 }}>
              <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.1} />
            </Form.Item>
            <Form.Item name="eustRatePct" label="EUSt %" style={{ width: 140 }}>
              <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.1} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="productionLeadTimeDays" label="Production Lead Days" style={{ width: 220 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="logisticsLeadTimeDays" label="Logistics Lead Days" style={{ width: 220 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="bufferDays" label="Buffer Days" style={{ width: 180 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Button
              onClick={() => {
                const values = form.getFieldsValue();
                const supplier = supplierById.get(String(values.supplierId || ""));
                const terms = extractSupplierTerms([], supplier || undefined);
                form.setFieldsValue({
                  incoterm: String(supplier?.incotermDefault || values.incoterm || "EXW").toUpperCase(),
                  currency: String(supplier?.currencyDefault || values.currency || settings.defaultCurrency || "EUR").toUpperCase(),
                  productionLeadTimeDays: Number(
                    supplier?.productionLeadTimeDaysDefault
                    || values.productionLeadTimeDays
                    || settings.defaultProductionLeadTimeDays
                    || 45,
                  ),
                  paymentTerms: terms,
                });
              }}
            >
              Supplier Defaults
            </Button>
          </Space>

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
                  <Text>
                    Empfohlene Units: {formatNumber(liveRecommendation.recommendedUnits, 0)}
                  </Text>
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
                        <InputNumber min={0} max={100} style={{ width: "100%" }} />
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
                        <InputNumber style={{ width: "100%" }} />
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
