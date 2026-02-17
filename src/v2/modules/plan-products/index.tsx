import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { DeNumberInput } from "../../components/DeNumberInput";
import { buildForecastMonths } from "../../domain/tableModels";
import { formatMonthLabel } from "../../domain/months";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import {
  PLAN_RELATION_TYPES,
  buildPlanProductForecastRow,
  buildPlanProductForecastRows,
  computeSeasonalityFromForecastImport,
  monthNumberToLabel,
  normalizeIsoDate,
  normalizePlanProductRecord,
} from "../../../domain/planProducts.js";

const { Paragraph, Text, Title } = Typography;

interface PlanProductDraft {
  id?: string;
  alias: string;
  plannedSku?: string;
  relationType: string;
  categoryId: string | null;
  status: "active" | "draft" | "archived";
  baselineReferenceMonth: number | null;
  baselineUnitsInReferenceMonth: number | null;
  seasonalityReferenceSku: string;
  baselineReferenceSku?: string;
  avgSellingPriceGrossEUR: number | null;
  sellerboardMarginPct: number | null;
  launchDate: string;
  rampUpWeeks: number | null;
  softLaunchStartSharePct: number | null;
}

const RELATION_LABELS: Record<string, string> = {
  standalone: "Standalone",
  variant_of_existing: "Variant of Existing",
  category_adjacent: "Category Adjacent",
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function planDraftFromRow(row?: Record<string, unknown>): PlanProductDraft {
  const normalized = normalizePlanProductRecord(row || {}, 0);
  return {
    id: normalized.id || "",
    alias: normalized.alias || "",
    plannedSku: normalized.plannedSku || "",
    relationType: normalized.relationType || PLAN_RELATION_TYPES[0],
    categoryId: normalized.categoryId || null,
    status: (normalized.status as "active" | "draft" | "archived") || "active",
    baselineReferenceMonth: asNumber(normalized.baselineReferenceMonth),
    baselineUnitsInReferenceMonth: asNumber(normalized.baselineUnitsInReferenceMonth),
    seasonalityReferenceSku: normalized.seasonalityReferenceSku || "",
    baselineReferenceSku: normalized.baselineReferenceSku || "",
    avgSellingPriceGrossEUR: asNumber(normalized.avgSellingPriceGrossEUR),
    sellerboardMarginPct: asNumber((normalized as Record<string, unknown>).sellerboardMarginPct),
    launchDate: normalized.launchDate || todayIsoDate(),
    rampUpWeeks: asNumber(normalized.rampUpWeeks),
    softLaunchStartSharePct: asNumber(normalized.softLaunchStartSharePct),
  };
}

export default function PlanProductsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [takeoverPlanId, setTakeoverPlanId] = useState<string | null>(null);
  const [takeoverSku, setTakeoverSku] = useState("");
  const [form] = Form.useForm<PlanProductDraft>();
  const draftValues = Form.useWatch([], form) as PlanProductDraft | undefined;

  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const months = useMemo(() => buildForecastMonths(settings), [settings.horizonMonths, settings.startMonth]);

  const categories = useMemo(() => {
    return (Array.isArray(state.productCategories) ? state.productCategories : [])
      .map((entry) => ({
        id: String((entry as Record<string, unknown>).id || ""),
        name: String((entry as Record<string, unknown>).name || "Ohne Kategorie"),
      }))
      .filter((entry) => entry.id);
  }, [state.productCategories]);

  const liveSkuOptions = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => {
        const product = entry as Record<string, unknown>;
        const sku = String(product.sku || "").trim();
        if (!sku) return null;
        const alias = String(product.alias || sku);
        return {
          value: sku,
          label: `${alias} · ${sku}`,
        };
      })
      .filter(Boolean) as Array<{ value: string; label: string }>;
  }, [state.products]);

  const planRows = useMemo(() => {
    return buildPlanProductForecastRows({
      state: stateObject,
      months,
    });
  }, [months, stateObject]);

  const editingRow = useMemo(() => {
    if (!editingId) return null;
    return planRows.find((row) => String(row.id || "") === editingId) || null;
  }, [editingId, planRows]);
  const takeoverRow = useMemo(() => {
    if (!takeoverPlanId) return null;
    return planRows.find((row) => String(row.id || "") === takeoverPlanId) || null;
  }, [planRows, takeoverPlanId]);

  const modalPreview = useMemo(() => {
    if (!modalOpen) return null;
    const draft = draftValues || planDraftFromRow(editingRow || undefined);
    return buildPlanProductForecastRow({
      planProduct: draft,
      forecastImport: ((state.forecast as Record<string, unknown> | undefined)?.forecastImport || {}) as Record<string, unknown>,
      months,
      fallbackIndex: 0,
    });
  }, [draftValues, editingRow, modalOpen, months, state.forecast]);
  const baselineReferenceHint = useMemo(() => {
    if (!modalOpen) return null;
    const draft = draftValues || planDraftFromRow(editingRow || undefined);
    const baselineRefSku = String(draft.baselineReferenceSku || "").trim();
    const baselineMonth = Number(draft.baselineReferenceMonth || 0);
    if (!baselineRefSku || baselineMonth < 1 || baselineMonth > 12) return null;
    const forecastImport = ((state.forecast as Record<string, unknown> | undefined)?.forecastImport || {}) as Record<string, unknown>;
    const profile = computeSeasonalityFromForecastImport(forecastImport, baselineRefSku);
    if (!profile) return null;
    const monthAvg = asNumber((profile.averagesByMonthNumber || {})[baselineMonth]);
    if (!Number.isFinite(monthAvg as number)) return null;
    return {
      sku: baselineRefSku,
      baselineMonth,
      monthAverageUnits: monthAvg,
    };
  }, [draftValues, editingRow, modalOpen, state.forecast]);

  function openCreate(): void {
    setEditingId(null);
    form.setFieldsValue({
      alias: "",
      plannedSku: "",
      relationType: "standalone",
      categoryId: null,
      status: "active",
      baselineReferenceMonth: new Date().getMonth() + 1,
      baselineUnitsInReferenceMonth: null,
      seasonalityReferenceSku: "",
      baselineReferenceSku: "",
      avgSellingPriceGrossEUR: null,
      sellerboardMarginPct: null,
      launchDate: todayIsoDate(),
      rampUpWeeks: 8,
      softLaunchStartSharePct: 0,
    });
    setModalOpen(true);
  }

  function openEdit(row: Record<string, unknown>): void {
    setEditingId(String(row.id || ""));
    form.setFieldsValue(planDraftFromRow(row));
    setModalOpen(true);
  }

  async function deleteRow(rowId: string): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.planProducts) ? next.planProducts : [];
      next.planProducts = list.filter((entry) => String((entry as Record<string, unknown>).id || "") !== rowId);
      return next;
    }, "v2:plan-products:delete");
    message.success("Plan-Produkt entfernt.");
  }

  async function saveDraft(values: PlanProductDraft): Promise<void> {
    const alias = String(values.alias || "").trim();
    if (!alias) throw new Error("Alias ist erforderlich.");
    if (!values.seasonalityReferenceSku) throw new Error("Bitte Referenz-SKU für Saisonalität wählen.");
    const baselineMonth = Number(values.baselineReferenceMonth || 0);
    if (!Number.isFinite(baselineMonth) || baselineMonth < 1 || baselineMonth > 12) {
      throw new Error("Referenzmonat muss zwischen 1 und 12 liegen.");
    }
    const baselineUnits = Number(values.baselineUnitsInReferenceMonth || 0);
    if (!Number.isFinite(baselineUnits) || baselineUnits <= 0) {
      throw new Error("Baseline Units im Referenzmonat müssen > 0 sein.");
    }
    const price = Number(values.avgSellingPriceGrossEUR || 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Bitte einen gültigen Preis (EUR) für Revenue-Berechnung pflegen.");
    }
    const grossMargin = Number(values.sellerboardMarginPct || 0);
    if (!Number.isFinite(grossMargin) || grossMargin <= 0 || grossMargin > 100) {
      throw new Error("Bitte eine gültige Brutto-Marge (%) > 0 und <= 100 pflegen.");
    }
    const launchDate = normalizeIsoDate(values.launchDate);
    if (!launchDate) {
      throw new Error("Launch-Datum ist erforderlich.");
    }
    const rampUpWeeks = Math.round(Number(values.rampUpWeeks || 0));
    if (!Number.isFinite(rampUpWeeks) || rampUpWeeks <= 0) {
      throw new Error("Ramp-up Wochen müssen größer als 0 sein.");
    }
    const softLaunchStartSharePct = Number(values.softLaunchStartSharePct || 0);
    if (!Number.isFinite(softLaunchStartSharePct) || softLaunchStartSharePct < 0 || softLaunchStartSharePct > 100) {
      throw new Error("Soft-Launch Start in % muss zwischen 0 und 100 liegen.");
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.planProducts) ? [...next.planProducts] : [];
      const normalizedAlias = alias.toLowerCase();
      const duplicate = list.find((entry) => {
        const row = entry as Record<string, unknown>;
        const sameAlias = String(row.alias || "").trim().toLowerCase() === normalizedAlias;
        if (!sameAlias) return false;
        if (!editingId) return true;
        return String(row.id || "") !== editingId;
      });
      if (duplicate) {
        throw new Error(`Alias "${alias}" existiert bereits bei einem Plan-Produkt.`);
      }

      const id = editingId || randomId("plan");
      const payload = {
        id,
        alias,
        plannedSku: String(values.plannedSku || "").trim(),
        relationType: String(values.relationType || "standalone"),
        categoryId: values.categoryId || null,
        status: values.status || "active",
        baselineReferenceMonth: baselineMonth,
        baselineUnitsInReferenceMonth: baselineUnits,
        seasonalityReferenceSku: String(values.seasonalityReferenceSku || "").trim(),
        baselineReferenceSku: String(values.baselineReferenceSku || "").trim(),
        avgSellingPriceGrossEUR: price,
        sellerboardMarginPct: grossMargin,
        launchDate,
        rampUpWeeks,
        softLaunchStartSharePct,
        updatedAt: nowIso(),
        createdAt: editingId
          ? String((list.find((entry) => String((entry as Record<string, unknown>).id || "") === editingId) as Record<string, unknown> | undefined)?.createdAt || nowIso())
          : nowIso(),
      };

      const existingIndex = list.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === id);
      if (existingIndex >= 0) {
        list[existingIndex] = payload;
      } else {
        list.push(payload);
      }
      next.planProducts = list;
      return next;
    }, editingId ? "v2:plan-products:update" : "v2:plan-products:create");

    message.success(editingId ? "Plan-Produkt aktualisiert." : "Plan-Produkt angelegt.");
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  function openTakeover(row: Record<string, unknown>): void {
    const rowId = String(row.id || "").trim();
    if (!rowId) return;
    setTakeoverPlanId(rowId);
    const fallbackSku = String(row.plannedSku || "").trim();
    setTakeoverSku(fallbackSku);
    setTakeoverOpen(true);
  }

  async function confirmTakeover(): Promise<void> {
    const planId = String(takeoverPlanId || "").trim();
    const sku = String(takeoverSku || "").trim();
    if (!planId) throw new Error("Plan-Produkt nicht gefunden.");
    if (!sku) throw new Error("Bitte SKU für die Übernahme wählen.");
    const matchingSkuExists = liveSkuOptions.some((entry) => entry.value === sku);
    if (!matchingSkuExists) {
      throw new Error("Die gewählte SKU ist nicht in der Live-Produktdatenbank vorhanden.");
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      const planList = Array.isArray(next.planProducts) ? [...next.planProducts] : [];
      const targetIndex = planList.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === planId);
      if (targetIndex < 0) {
        throw new Error("Plan-Produkt wurde nicht gefunden.");
      }

      const forecast = (nextState.forecast && typeof nextState.forecast === "object")
        ? nextState.forecast as Record<string, unknown>
        : {};
      const forecastImport = (forecast.forecastImport && typeof forecast.forecastImport === "object")
        ? forecast.forecastImport as Record<string, unknown>
        : {};
      const snapshot = buildPlanProductForecastRow({
        planProduct: planList[targetIndex] as Record<string, unknown>,
        forecastImport,
        months,
        fallbackIndex: targetIndex,
      });
      const mappedAt = nowIso();
      const mapping = {
        id: randomId("plan-map"),
        planProductId: String(snapshot.id || planId),
        planProductAlias: String(snapshot.alias || ""),
        sku,
        plannedSku: String(snapshot.plannedSku || ""),
        mappedAt,
        launchDate: String(snapshot.launchDate || ""),
        rampUpWeeks: Number(snapshot.rampUpWeeks || 0) || null,
        softLaunchStartSharePct: Number(snapshot.softLaunchStartSharePct || 0),
        baselineReferenceMonth: Number(snapshot.baselineReferenceMonth || 0) || null,
        baselineUnitsInReferenceMonth: Number(snapshot.baselineUnitsInReferenceMonth || 0) || null,
        seasonalityReferenceSku: String(snapshot.seasonalityReferenceSku || ""),
        months: [...snapshot.months],
        planUnitsByMonth: { ...(snapshot.unitsByMonth || {}) },
        planRevenueByMonth: { ...(snapshot.revenueByMonth || {}) },
        source: "plan_product",
      };

      const currentMappings = Array.isArray(next.planProductMappings) ? [...next.planProductMappings] : [];
      next.planProductMappings = [
        ...currentMappings.filter((entry) => String((entry as Record<string, unknown>).planProductId || "") !== mapping.planProductId),
        mapping,
      ];

      planList[targetIndex] = {
        ...(planList[targetIndex] as Record<string, unknown>),
        status: "archived",
        plannedSku: sku,
        mappedSku: sku,
        mappedAt,
        archivedAt: mappedAt,
        updatedAt: mappedAt,
      };
      next.planProducts = planList;
      return next;
    }, "v2:plan-products:takeover");

    message.success(`Plan-Produkt wurde als Live-SKU ${sku} übernommen und archiviert.`);
    setTakeoverOpen(false);
    setTakeoverPlanId(null);
    setTakeoverSku("");
    window.location.hash = `#/v2/products?source=plan-products&sku=${encodeURIComponent(sku)}`;
  }

  const tableData = useMemo(() => {
    return planRows.map((row) => ({
      ...row,
      monthPreview: months.slice(0, 3).map((month) => `${formatMonthLabel(month)}: ${formatNumber(row.unitsByMonth?.[month], 0)}`).join(" · "),
    }));
  }, [months, planRows]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Neue Produkte (Plan-Produkte)</Title>
            <Paragraph>
              Pre-SKU Produkte mit Referenzmonat-Baseline und übernommener Saisonalität aus bestehender SKU.
              Monats-Units werden automatisch über den Forecast-Horizont berechnet.
            </Paragraph>
          </div>
          <Space>
            <Button type="primary" onClick={openCreate}>Plan-Produkt hinzufügen</Button>
          </Space>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="blue">Plan-Produkte: {planRows.length}</Tag>
            <Tag color="green">Aktiv: {planRows.filter((row) => String(row.status || "") === "active").length}</Tag>
            <Tag>Horizont: {months.length} Monate</Tag>
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Table
          rowKey={(row) => String((row as Record<string, unknown>).id || (row as Record<string, unknown>).key || "")}
          size="small"
          pagination={false}
          dataSource={tableData}
          columns={[
            {
              title: "Alias",
              dataIndex: "alias",
              key: "alias",
              sorter: (a, b) => String(a.alias || "").localeCompare(String(b.alias || ""), "de-DE"),
              render: (value: string) => (
                <Space size={6}>
                  <Tag color="blue">Plan</Tag>
                  <Text strong>{value || "—"}</Text>
                </Space>
              ),
            },
            {
              title: "Pre-SKU",
              dataIndex: "plannedSku",
              key: "plannedSku",
              sorter: (a, b) => String(a.plannedSku || "").localeCompare(String(b.plannedSku || ""), "de-DE"),
              render: (value: string) => value || <Text type="secondary">ohne SKU</Text>,
            },
            {
              title: "Relation",
              dataIndex: "relationType",
              key: "relationType",
              sorter: (a, b) => String(a.relationType || "").localeCompare(String(b.relationType || ""), "de-DE"),
              render: (value: string) => RELATION_LABELS[value] || value || "—",
            },
            {
              title: "Baseline",
              key: "baseline",
              sorter: (a, b) => Number(asNumber(a.baselineUnitsInReferenceMonth) || 0) - Number(asNumber(b.baselineUnitsInReferenceMonth) || 0),
              render: (_, row: Record<string, unknown>) => (
                <span>
                  {monthNumberToLabel(row.baselineReferenceMonth)} · {formatNumber(row.baselineUnitsInReferenceMonth, 0)} Units
                </span>
              ),
            },
            {
              title: "Saisonalität von",
              dataIndex: "seasonalityReferenceSku",
              key: "seasonalityReferenceSku",
              sorter: (a, b) => String(a.seasonalityReferenceSku || "").localeCompare(String(b.seasonalityReferenceSku || ""), "de-DE"),
              render: (value: string) => value || "—",
            },
            {
              title: "Preis (EUR)",
              dataIndex: "avgSellingPriceGrossEUR",
              key: "avgSellingPriceGrossEUR",
              align: "right" as const,
              sorter: (a, b) => Number(asNumber(a.avgSellingPriceGrossEUR) || 0) - Number(asNumber(b.avgSellingPriceGrossEUR) || 0),
              render: (value: unknown) => formatNumber(value, 2),
            },
            {
              title: "Brutto-Marge %",
              dataIndex: "sellerboardMarginPct",
              key: "sellerboardMarginPct",
              align: "right" as const,
              sorter: (a, b) => Number(asNumber(a.sellerboardMarginPct) || 0) - Number(asNumber(b.sellerboardMarginPct) || 0),
              render: (value: unknown) => formatNumber(value, 2),
            },
            {
              title: "Launch & Ramp",
              key: "launchRamp",
              sorter: (a, b) => String(a.launchDate || "").localeCompare(String(b.launchDate || "")),
              render: (_, row: Record<string, unknown>) => (
                <span>
                  {String(row.launchDate || "—")} · {formatNumber(asNumber(row.rampUpWeeks), 0)}W · Start {formatNumber(asNumber(row.softLaunchStartSharePct), 0)}%
                </span>
              ),
            },
            {
              title: "Vorschau (Next 3)",
              dataIndex: "monthPreview",
              key: "monthPreview",
              sorter: (a, b) => String(a.monthPreview || "").localeCompare(String(b.monthPreview || ""), "de-DE"),
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              sorter: (a, b) => String(a.status || "").localeCompare(String(b.status || ""), "de-DE"),
              render: (value: string, row: Record<string, unknown>) => {
                if (value === "archived") {
                  const mappedSku = String(row.mappedSku || row.plannedSku || "");
                  return (
                    <Space direction="vertical" size={2}>
                      <Tag>Archiviert</Tag>
                      {mappedSku ? <Text type="secondary">Live-SKU: {mappedSku}</Text> : null}
                    </Space>
                  );
                }
                return value === "draft"
                  ? <Tag color="gold">Draft</Tag>
                  : <Tag color="green">Aktiv</Tag>;
              },
            },
            {
              title: "Aktionen",
              key: "actions",
              render: (_, row: Record<string, unknown>) => (
                <Space size={6}>
                  <Button size="small" onClick={() => openEdit(row)}>Bearbeiten</Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    onClick={() => openTakeover(row)}
                    disabled={String(row.status || "") === "archived"}
                  >
                    Als gelauncht markieren
                  </Button>
                  <Popconfirm
                    title="Plan-Produkt löschen?"
                    onConfirm={() => { void deleteRow(String(row.id || "")); }}
                  >
                    <Button size="small" danger>Löschen</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "Noch keine Plan-Produkte angelegt." }}
        />
      </Card>

      <Modal
        title={editingId ? "Plan-Produkt bearbeiten" : "Plan-Produkt anlegen"}
        rootClassName="v2-form-modal"
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingId(null);
          form.resetFields();
        }}
        onOk={() => {
          void form.validateFields()
            .then((values) => saveDraft(values))
            .catch(() => {});
        }}
        width={980}
      >
        <Form<PlanProductDraft>
          form={form}
          layout="vertical"
        >
          <div className="v2-form-row">
            <Form.Item name="alias" label="Alias" rules={[{ required: true, message: "Alias ist erforderlich." }]}>
              <Input placeholder="z. B. Messerblock Premium" />
            </Form.Item>
            <Form.Item name="plannedSku" label="Planned SKU (optional)">
              <Input placeholder="optional, falls intern bereits vergeben" />
            </Form.Item>
            <Form.Item name="status" label="Status" initialValue="active">
              <Select
                options={[
                  { value: "active", label: "Aktiv" },
                  { value: "draft", label: "Draft" },
                  { value: "archived", label: "Archiviert" },
                ]}
              />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="relationType" label="Relation" rules={[{ required: true }]}>
              <Select
                options={PLAN_RELATION_TYPES.map((value) => ({ value, label: RELATION_LABELS[value] || value }))}
              />
            </Form.Item>
            <Form.Item name="categoryId" label="Kategorie">
              <Select
                allowClear
                options={categories.map((entry) => ({ value: entry.id, label: entry.name }))}
              />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item
              name="avgSellingPriceGrossEUR"
              label="Preis (EUR) für Revenue"
              rules={[{ required: true, message: "Preis ist erforderlich." }]}
            >
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item
              name="sellerboardMarginPct"
              label="Brutto-Marge (%)"
              rules={[
                { required: true, message: "Marge ist erforderlich." },
                {
                  validator: (_, value) => {
                    const margin = Number(value);
                    if (Number.isFinite(margin) && margin > 0 && margin <= 100) return Promise.resolve();
                    return Promise.reject(new Error("Marge muss > 0 und <= 100 sein."));
                  },
                },
              ]}
            >
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item
              name="baselineReferenceMonth"
              label="Referenzmonat"
              rules={[{ required: true, message: "Referenzmonat ist erforderlich." }]}
            >
              <Select
                options={Array.from({ length: 12 }, (_, idx) => ({
                  value: idx + 1,
                  label: `${monthNumberToLabel(idx + 1)} (${idx + 1})`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="baselineUnitsInReferenceMonth"
              label="Baseline Units im Referenzmonat"
              rules={[{ required: true, message: "Baseline Units sind erforderlich." }]}
            >
              <DeNumberInput mode="int" min={0} />
            </Form.Item>
            <Form.Item
              name="seasonalityReferenceSku"
              label="Saisonalität übernehmen von SKU"
              rules={[{ required: true, message: "Referenz-SKU ist erforderlich." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={liveSkuOptions}
              />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="baselineReferenceSku" label="Baseline-Referenz-SKU (optional)">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={liveSkuOptions}
              />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item
              name="launchDate"
              label="Launch-Datum"
              rules={[{ required: true, message: "Launch-Datum ist erforderlich." }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              name="rampUpWeeks"
              label="Ramp-up (Wochen)"
              rules={[{ required: true, message: "Ramp-up Wochen sind erforderlich." }]}
            >
              <DeNumberInput mode="int" min={1} />
            </Form.Item>
            <Form.Item
              name="softLaunchStartSharePct"
              label="Soft-Launch Start (%)"
              extra="Startniveau am Launch-Tag. 0 = Start bei 0 %, 20 = Start bei 20 %."
            >
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
          </div>
        </Form>

        <Card size="small">
          <Title level={5}>Forecast-Vorschau (berechnet)</Title>
          <Paragraph type="secondary">
            Monatswerte werden aus Baseline im Referenzmonat, dem Saisonalitätsprofil der gewählten Referenz-SKU
            und einer taggenauen Launch-/Ramp-Aggregation berechnet.
          </Paragraph>
          {!modalPreview?.seasonality ? (
            <Alert
              type="warning"
              showIcon
              message="Saisonalitätsprofil noch nicht ableitbar"
              description="Für die gewählte Referenz-SKU liegen noch keine verwertbaren Forecast-Monatswerte vor."
            />
          ) : (
            <>
              <Space wrap style={{ marginBottom: 8 }}>
                <Tag color="blue">
                  Baseline: {monthNumberToLabel(modalPreview.baselineReferenceMonth)} · {formatNumber(modalPreview.baselineUnitsInReferenceMonth, 0)} Units
                </Tag>
                <Tag color="green">
                  Referenz-SKU: {modalPreview.seasonalityReferenceSku}
                </Tag>
                <Tag color="purple">
                  Launch: {String(modalPreview.launchDate || "—")} · Ramp: {formatNumber(asNumber(modalPreview.rampUpWeeks), 0)}W · Start: {formatNumber(asNumber(modalPreview.softLaunchStartSharePct), 0)}%
                </Tag>
                <Tag>
                  Zeitraum: {formatMonthLabel(modalPreview.seasonality.startMonth)} bis {formatMonthLabel(modalPreview.seasonality.endMonth)}
                </Tag>
                {baselineReferenceHint ? (
                  <Tag color="purple">
                    Orientierung: {baselineReferenceHint.sku} hat in {monthNumberToLabel(baselineReferenceHint.baselineMonth)} im Schnitt {formatNumber(baselineReferenceHint.monthAverageUnits, 0)} Units
                  </Tag>
                ) : null}
              </Space>
              <Table
                size="small"
                pagination={false}
                rowKey={(row) => String((row as Record<string, unknown>).month || "")}
                dataSource={months.map((month) => ({
                  month,
                  baseUnits: modalPreview.baseUnitsByMonth?.[month],
                  rampFactor: modalPreview.rampFactorByMonth?.[month],
                  units: modalPreview.unitsByMonth?.[month],
                  revenue: modalPreview.revenueByMonth?.[month],
                }))}
                columns={[
                  {
                    title: "Monat",
                    dataIndex: "month",
                    key: "month",
                    sorter: (a, b) => String(a.month || "").localeCompare(String(b.month || "")),
                    render: (value: string) => formatMonthLabel(value),
                  },
                  {
                    title: "Base Units",
                    dataIndex: "baseUnits",
                    key: "baseUnits",
                    align: "right" as const,
                    sorter: (a, b) => Number(asNumber(a.baseUnits) || 0) - Number(asNumber(b.baseUnits) || 0),
                    render: (value: unknown) => formatNumber(asNumber(value), 2),
                  },
                  {
                    title: "Ramp-Faktor",
                    dataIndex: "rampFactor",
                    key: "rampFactor",
                    align: "right" as const,
                    sorter: (a, b) => Number(asNumber(a.rampFactor) || 0) - Number(asNumber(b.rampFactor) || 0),
                    render: (value: unknown) => formatNumber(asNumber(value), 2),
                  },
                  {
                    title: "Units (Plan)",
                    dataIndex: "units",
                    key: "units",
                    align: "right" as const,
                    sorter: (a, b) => Number(asNumber(a.units) || 0) - Number(asNumber(b.units) || 0),
                    render: (value: unknown) => formatNumber(value, 0),
                  },
                  {
                    title: "Revenue (Plan)",
                    dataIndex: "revenue",
                    key: "revenue",
                    align: "right" as const,
                    sorter: (a, b) => Number(asNumber(a.revenue) || 0) - Number(asNumber(b.revenue) || 0),
                    render: (value: unknown) => formatNumber(value, 2),
                  },
                ]}
              />
            </>
          )}
        </Card>
      </Modal>

      <Modal
        title="Plan-Produkt in Live-SKU übernehmen"
        open={takeoverOpen}
        onCancel={() => {
          setTakeoverOpen(false);
          setTakeoverPlanId(null);
          setTakeoverSku("");
        }}
        onOk={() => {
          void confirmTakeover().catch((takeoverError: unknown) => {
            message.error(takeoverError instanceof Error ? takeoverError.message : String(takeoverError));
          });
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Plan wird archiviert, Mapping bleibt für Plan-vs-Ist erhalten."
            description="Nach der Übernahme zählt im operativen Forecast/Cashflow nur noch die Live-SKU (CSV)."
          />
          <div>
            <Text strong>Plan-Produkt: </Text>
            <Text>{takeoverRow?.alias || "—"}</Text>
          </div>
          <div>
            <Text strong>Aktueller Status: </Text>
            <Text>{takeoverRow?.status || "—"}</Text>
          </div>
          <Select
            value={takeoverSku || undefined}
            showSearch
            optionFilterProp="label"
            placeholder="Live-SKU auswählen"
            options={liveSkuOptions}
            onChange={(value) => setTakeoverSku(String(value || ""))}
          />
        </Space>
      </Modal>
    </div>
  );
}
