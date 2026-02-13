import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { deriveShippingPerUnitEur } from "../../../domain/costing/shipping.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { buildCategoryOrderMap, sortCategoryGroups } from "../../domain/categoryOrder";
import { resolveProductFieldResolution, type ResolvedField } from "../../domain/productFieldResolution";
import { buildProductGridRows, type ProductGridRow } from "../../domain/tableModels";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";
import {
  getModuleExpandedCategoryKeys,
  hasModuleExpandedCategoryKeys,
  setModuleExpandedCategoryKeys,
} from "../../state/uiPrefs";

const { Paragraph, Text, Title } = Typography;

const STATUS_OPTIONS = [
  { value: "active", label: "Aktiv" },
  { value: "inactive", label: "Inaktiv" },
];

const TRANSPORT_MODES = ["AIR", "RAIL", "SEA"];
const CURRENCIES = ["EUR", "USD", "CNY"];

type ProductRow = ProductGridRow;

interface ProductDraft {
  id?: string;
  sku: string;
  alias: string;
  supplierId: string;
  categoryId: string | null;
  status: "active" | "inactive";
  avgSellingPriceGrossEUR: number | null;
  sellerboardMarginPct: number | null;
  moqUnits: number | null;
  safetyStockDohOverride: number | null;
  foCoverageDohOverride: number | null;
  moqOverrideUnits: number | null;
  landedUnitCostEur: number | null;
  logisticsPerUnitEur: number | null;
  productionLeadTimeDaysDefault: number | null;
  templateUnitPriceUsd: number | null;
  templateTransportMode: string;
  templateProductionDays: number | null;
  templateTransitDays: number | null;
  templateFreightEur: number | null;
  templateDutyPct: number | null;
  templateVatImportPct: number | null;
  templateFxRate: number | null;
  templateCurrency: string;
  templateDdp: boolean;
}

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

function formatNumber(value: number | null, digits = 2): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatResolvedField(
  field: ResolvedField<number | string | boolean>,
  options?: { digits?: number; kind?: "number" | "text" | "boolean" },
): string {
  const kind = options?.kind || "number";
  if (kind === "boolean") return field.value === true ? "Ja" : "Nein";
  if (kind === "text") return String(field.value || "—");
  return formatNumber(typeof field.value === "number" ? field.value : null, options?.digits ?? 2);
}

function completenessTag(status: "blocked" | "warn" | "ok"): JSX.Element {
  if (status === "ok") return <Tag color="green">OK</Tag>;
  if (status === "warn") return <Tag color="orange">WARN</Tag>;
  return <Tag color="red">BLOCKED</Tag>;
}

function productDraftFromRow(row?: ProductRow): ProductDraft {
  const templateSource = (row?.raw.template as Record<string, unknown> | undefined) || {};
  const template = (
    templateSource.fields && typeof templateSource.fields === "object"
      ? templateSource.fields
      : templateSource
  ) as Record<string, unknown>;
  return {
    id: row?.id,
    sku: row?.sku || "",
    alias: row?.alias || "",
    supplierId: row?.supplierId || "",
    categoryId: row?.categoryId || null,
    status: row?.status || "active",
    avgSellingPriceGrossEUR: row?.avgSellingPriceGrossEUR ?? null,
    sellerboardMarginPct: row?.sellerboardMarginPct ?? null,
    moqUnits: row?.moqUnits ?? null,
    safetyStockDohOverride: asNumber(row?.raw.safetyStockDohOverride),
    foCoverageDohOverride: asNumber(row?.raw.foCoverageDohOverride),
    moqOverrideUnits: asNumber(row?.raw.moqOverrideUnits),
    landedUnitCostEur: asNumber(row?.raw.landedUnitCostEur),
    logisticsPerUnitEur: asNumber(row?.raw.logisticsPerUnitEur ?? row?.raw.freightPerUnitEur),
    productionLeadTimeDaysDefault: asNumber(row?.raw.productionLeadTimeDaysDefault),
    templateUnitPriceUsd: asNumber(template.unitPriceUsd),
    templateTransportMode: String(template.transportMode || "SEA"),
    templateProductionDays: asNumber(template.productionDays),
    templateTransitDays: asNumber(template.transitDays),
    templateFreightEur: asNumber(template.freightEur),
    templateDutyPct: asNumber(template.dutyPct),
    templateVatImportPct: asNumber(template.vatImportPct),
    templateFxRate: asNumber(template.fxRate),
    templateCurrency: String(template.currency || "USD"),
    templateDdp: template.ddp === true,
  };
}

export default function ProductsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const hasStoredExpandedPrefs = hasModuleExpandedCategoryKeys("products");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [logisticsManualOverride, setLogisticsManualOverride] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("products"));
  const [form] = Form.useForm<ProductDraft>();
  const draftValues = Form.useWatch([], form) as ProductDraft | undefined;
  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;

  const categories = useMemo(() => {
    return (Array.isArray(state.productCategories) ? state.productCategories : [])
      .map((entry) => ({
        id: String((entry as Record<string, unknown>).id || ""),
        name: String((entry as Record<string, unknown>).name || "Ohne Kategorie"),
      }))
      .filter((entry) => entry.id);
  }, [state.productCategories]);

  const suppliers = useMemo(() => {
    return (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => ({
        id: String((entry as Record<string, unknown>).id || ""),
        name: String((entry as Record<string, unknown>).name || ""),
      }))
      .filter((entry) => entry.id);
  }, [state.suppliers]);

  const categoryLabelById = useMemo(() => new Map(categories.map((entry) => [entry.id, entry.name])), [categories]);
  const supplierLabelById = useMemo(() => new Map(suppliers.map((entry) => [entry.id, entry.name])), [suppliers]);
  const categoryOrderMap = useMemo(() => buildCategoryOrderMap(stateObject), [state.productCategories]);

  const rows = useMemo(() => {
    return buildProductGridRows({
      state: stateObject,
      search,
      statusFilter,
      categoryLabelById,
      supplierLabelById,
    });
  }, [categoryLabelById, search, stateObject, statusFilter, supplierLabelById]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, ProductRow[]>();
    rows.forEach((row) => {
      const categoryLabel = row.categoryId ? (categoryLabelById.get(row.categoryId) || "Ohne Kategorie") : "Ohne Kategorie";
      if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
      groups.get(categoryLabel)?.push(row);
    });
    const mapped = Array.from(groups.entries())
      .map(([category, items]) => ({
        key: category,
        label: category,
        rows: items.sort((a, b) => a.sku.localeCompare(b.sku)),
      }));
    return sortCategoryGroups(mapped, categoryOrderMap);
  }, [categoryLabelById, categoryOrderMap, rows]);

  useEffect(() => {
    setExpandedCategories((current) => {
      if (!groupedRows.length) return [];
      const validKeys = new Set(groupedRows.map((group) => group.key));
      const filtered = current.filter((key) => validKeys.has(key));
      if (filtered.length || hasStoredExpandedPrefs) return filtered;
      return groupedRows.map((group) => group.key);
    });
  }, [groupedRows, hasStoredExpandedPrefs]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("products", expandedCategories);
  }, [expandedCategories]);

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => [
    { header: "SKU", accessorKey: "sku", meta: { width: 170 } },
    { header: "Alias", accessorKey: "alias", meta: { width: 230 } },
    {
      header: "Supplier",
      meta: { width: 190 },
      cell: ({ row }) => (row.original.supplierId ? supplierLabelById.get(row.original.supplierId) || row.original.supplierId : "—"),
    },
    {
      header: "Status",
      meta: { width: 96 },
      cell: ({ row }) => (
        row.original.status === "inactive"
          ? <Tag>Inaktiv</Tag>
          : <Tag color="green">Aktiv</Tag>
      ),
    },
    {
      header: "Completeness",
      meta: { width: 122 },
      cell: ({ row }) => completenessTag(row.original.completeness),
    },
    {
      header: "Ø VK (EUR)",
      meta: { width: 116, align: "right" },
      cell: ({ row }) => row.original.avgSellingPriceGrossEUR == null ? "—" : row.original.avgSellingPriceGrossEUR.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    {
      header: "Marge %",
      meta: { width: 96, align: "right" },
      cell: ({ row }) => row.original.sellerboardMarginPct == null ? "—" : row.original.sellerboardMarginPct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
    },
    {
      header: "MOQ",
      meta: { width: 84, align: "right" },
      cell: ({ row }) => row.original.moqUnits == null ? "—" : String(Math.round(row.original.moqUnits)),
    },
    {
      header: "Aktionen",
      meta: { width: 230, minWidth: 230 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button
            size="small"
            onClick={() => {
              const draft = productDraftFromRow(row.original);
              setEditing(row.original);
              form.setFieldsValue(draft);
              setLogisticsManualOverride(draft.logisticsPerUnitEur != null);
              setModalOpen(true);
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            onClick={() => {
              void saveWith((current) => {
                const next = ensureAppStateV2(current);
                next.products = (Array.isArray(next.products) ? next.products : []).map((entry) => {
                  const product = entry as Record<string, unknown>;
                  if (String(product.sku || "").toLowerCase() !== row.original.sku.toLowerCase()) return product;
                  return {
                    ...product,
                    status: product.status === "inactive" ? "active" : "inactive",
                    updatedAt: nowIso(),
                  };
                });
                return next;
              }, "v2:products:toggle-status");
            }}
          >
            Status
          </Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: `Produkt "${row.original.sku}" loeschen?`,
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.products = (Array.isArray(next.products) ? next.products : [])
                      .filter((entry) => String((entry as Record<string, unknown>).sku || "").toLowerCase() !== row.original.sku.toLowerCase());
                    return next;
                  }, "v2:products:delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </div>
      ),
    },
  ], [form, saveWith, supplierLabelById]);

  const resolvedDraft = useMemo(() => {
    const baseRaw = (editing?.raw || {}) as Record<string, unknown>;
    const baseTemplate = (((baseRaw.template as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined)
      || (baseRaw.template as Record<string, unknown> | undefined)
      || {}) as Record<string, unknown>;
    const current = draftValues || productDraftFromRow(editing || undefined);

    const draftProduct: Record<string, unknown> = {
      ...baseRaw,
      sku: current.sku || baseRaw.sku || "",
      alias: current.alias || baseRaw.alias || "",
      supplierId: current.supplierId || baseRaw.supplierId || "",
      categoryId: current.categoryId ?? baseRaw.categoryId ?? null,
      moqUnits: current.moqUnits ?? baseRaw.moqUnits ?? null,
      moqOverrideUnits: current.moqOverrideUnits ?? baseRaw.moqOverrideUnits ?? null,
      safetyStockDohOverride: current.safetyStockDohOverride ?? baseRaw.safetyStockDohOverride ?? null,
      foCoverageDohOverride: current.foCoverageDohOverride ?? baseRaw.foCoverageDohOverride ?? null,
      landedUnitCostEur: current.landedUnitCostEur ?? baseRaw.landedUnitCostEur ?? null,
      logisticsPerUnitEur: current.logisticsPerUnitEur ?? baseRaw.logisticsPerUnitEur ?? null,
      freightPerUnitEur: current.logisticsPerUnitEur ?? baseRaw.freightPerUnitEur ?? null,
      productionLeadTimeDaysDefault: current.productionLeadTimeDaysDefault ?? baseRaw.productionLeadTimeDaysDefault ?? null,
      template: {
        scope: "SKU",
        name: "Standard (SKU)",
        fields: {
          ...baseTemplate,
          unitPriceUsd: current.templateUnitPriceUsd ?? baseTemplate.unitPriceUsd ?? null,
          transportMode: current.templateTransportMode || String(baseTemplate.transportMode || "SEA"),
          productionDays: current.templateProductionDays ?? baseTemplate.productionDays ?? null,
          transitDays: current.templateTransitDays ?? baseTemplate.transitDays ?? null,
          freightEur: current.templateFreightEur ?? baseTemplate.freightEur ?? null,
          dutyPct: current.templateDutyPct ?? baseTemplate.dutyPct ?? null,
          vatImportPct: current.templateVatImportPct ?? baseTemplate.vatImportPct ?? null,
          fxRate: current.templateFxRate ?? baseTemplate.fxRate ?? settings.fxRate ?? null,
          currency: current.templateCurrency || String(baseTemplate.currency || settings.defaultCurrency || "EUR"),
          ddp: current.templateDdp ?? baseTemplate.ddp ?? false,
        },
      },
    };

    return resolveProductFieldResolution({
      product: draftProduct,
      state: stateObject,
      supplierId: current.supplierId || null,
    });
  }, [draftValues, editing, settings.defaultCurrency, settings.fxRate, stateObject]);

  const shippingSuggestion = useMemo(() => {
    const values = draftValues || ({} as ProductDraft);
    const fallbackFx = resolvedDraft.fxRate.value;
    return deriveShippingPerUnitEur({
      unitCostUsd: values.templateUnitPriceUsd,
      landedUnitCostEur: values.landedUnitCostEur,
      fxEurUsd: values.templateFxRate ?? fallbackFx,
    });
  }, [draftValues, resolvedDraft.fxRate.value]);

  useEffect(() => {
    if (!modalOpen || logisticsManualOverride) return;
    const suggested = Number(shippingSuggestion.value);
    if (!Number.isFinite(suggested)) return;
    const rounded = Math.round(suggested * 100) / 100;
    const current = asNumber(form.getFieldValue("logisticsPerUnitEur"));
    if (current == null || Math.abs(current - rounded) > 0.00001) {
      form.setFieldValue("logisticsPerUnitEur", rounded);
    }
  }, [form, logisticsManualOverride, modalOpen, shippingSuggestion.value]);

  function resetField(field: keyof ProductDraft): void {
    form.setFieldValue(field as string, null);
    if (field === "logisticsPerUnitEur") {
      setLogisticsManualOverride(false);
      const suggested = Number(shippingSuggestion.value);
      if (Number.isFinite(suggested)) {
        form.setFieldValue("logisticsPerUnitEur", Math.round(suggested * 100) / 100);
      }
    }
  }

  function renderResolvedMeta(
    field: ResolvedField<number | string | boolean>,
    options?: { digits?: number; kind?: "number" | "text" | "boolean"; extraHint?: string },
  ): JSX.Element {
    return (
      <span className="v2-field-meta">
        <span>Effektiv: {formatResolvedField(field, options)}</span>
        <span>Quelle: {field.sourceLabel}</span>
        <span>{options?.extraHint || field.hint}</span>
      </span>
    );
  }

  function labelWithReset(label: string, field: keyof ProductDraft): JSX.Element {
    const value = draftValues?.[field];
    const active = value !== null && value !== undefined && value !== "";
    return (
      <span className="v2-field-meta-row">
        <span>{label}</span>
        {active ? (
          <Button
            type="link"
            size="small"
            className="v2-field-reset"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetField(field);
            }}
          >
            Default
          </Button>
        ) : null}
      </span>
    );
  }

  function openCreateModal(): void {
    const draft = productDraftFromRow(undefined);
    setEditing(null);
    form.setFieldsValue(draft);
    setLogisticsManualOverride(draft.logisticsPerUnitEur != null);
    setModalOpen(true);
  }

  async function handleSave(values: ProductDraft): Promise<void> {
    const sku = values.sku.trim();
    if (!sku) {
      throw new Error("SKU ist erforderlich.");
    }
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const products = Array.isArray(next.products) ? [...next.products] : [];
      const lowerSku = sku.toLowerCase();
      const duplicate = products.find((entry) => {
        const product = entry as Record<string, unknown>;
        return String(product.sku || "").toLowerCase() === lowerSku
          && String(product.id || "") !== String(values.id || "");
      });
      if (duplicate) {
        throw new Error("SKU existiert bereits.");
      }

      const existingIndex = products.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === String(values.id || ""));
      const existing = existingIndex >= 0 ? products[existingIndex] as Record<string, unknown> : null;
      const now = nowIso();

      const templateFields: Record<string, unknown> = {
        unitPriceUsd: values.templateUnitPriceUsd,
        transportMode: values.templateTransportMode,
        productionDays: values.templateProductionDays,
        transitDays: values.templateTransitDays,
        freightEur: values.templateFreightEur,
        dutyPct: values.templateDutyPct,
        vatImportPct: values.templateVatImportPct,
        fxRate: values.templateFxRate,
        currency: values.templateCurrency,
        ddp: values.templateDdp,
      };

      const payload: Record<string, unknown> = {
        ...(existing || {}),
        id: values.id || existing?.id || randomId("prod"),
        sku,
        alias: values.alias.trim() || sku,
        supplierId: values.supplierId || "",
        categoryId: values.categoryId || null,
        status: values.status || "active",
        avgSellingPriceGrossEUR: values.avgSellingPriceGrossEUR,
        sellerboardMarginPct: values.sellerboardMarginPct,
        moqUnits: values.moqUnits,
        safetyStockDohOverride: values.safetyStockDohOverride,
        foCoverageDohOverride: values.foCoverageDohOverride,
        moqOverrideUnits: values.moqOverrideUnits,
        landedUnitCostEur: values.landedUnitCostEur,
        logisticsPerUnitEur: values.logisticsPerUnitEur,
        freightPerUnitEur: values.logisticsPerUnitEur,
        productionLeadTimeDaysDefault: values.productionLeadTimeDaysDefault,
        template: {
          scope: "SKU",
          name: "Standard (SKU)",
          fields: templateFields,
        },
        updatedAt: now,
      };

      if (!payload.createdAt) {
        payload.createdAt = now;
      }

      if (existingIndex >= 0) {
        products[existingIndex] = payload;
      } else {
        products.push(payload);
      }
      next.products = products;
      return next;
    }, editing ? "v2:products:update" : "v2:products:create");
    setEditing(null);
    setModalOpen(false);
    setLogisticsManualOverride(false);
    form.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Produkte</Title>
            <Paragraph>
              Produktstammdaten mit Completeness-Status, Kategorie/Supplier-Zuordnung und Kern-Kalkulationsfeldern.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Space wrap>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Suche SKU, Alias, Supplier, Kategorie"
                style={{ width: 340, maxWidth: "100%" }}
              />
              <Select
                value={statusFilter}
                onChange={(value) => setStatusFilter(value)}
                options={[
                  { value: "all", label: "Alle" },
                  { value: "active", label: "Aktiv" },
                  { value: "inactive", label: "Inaktiv" },
                ]}
                style={{ width: 140, maxWidth: "100%" }}
              />
              <Button
                type="primary"
                onClick={openCreateModal}
              >
                Produkt hinzufuegen
              </Button>
            </Space>
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-category-tools">
          <Text type="secondary">{rows.length} Produkte in {groupedRows.length} Kategorien</Text>
          <div className="v2-actions-inline">
            <Button
              size="small"
              onClick={() => setExpandedCategories(groupedRows.map((group) => group.key))}
              disabled={!groupedRows.length}
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

        {!groupedRows.length ? (
          <Text type="secondary">Keine Produkte für den aktuellen Filter.</Text>
        ) : (
          <Collapse
            className="v2-category-collapse"
            activeKey={expandedCategories}
            onChange={(nextKeys) => setExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
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
                  columns={columns}
                  minTableWidth={1380}
                  tableLayout="auto"
                />
              ),
            }))}
          />
        )}
      </Card>

      <Modal
        title={editing ? `Produkt bearbeiten: ${editing.sku}` : "Produkt hinzufuegen"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setLogisticsManualOverride(false);
        }}
        onOk={() => {
          void form.validateFields().then((values) => handleSave(values)).catch(() => {});
        }}
        width={1060}
      >
        <Form<ProductDraft> form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Basis</Title>
              <span className="v2-form-section-desc">Identitaet, Zuordnung und Aktivstatus.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item name="sku" label="SKU" style={{ flex: 1 }} rules={[{ required: true, message: "SKU fehlt." }]}>
                <Input />
              </Form.Item>
              <Form.Item name="alias" label="Alias" style={{ flex: 1 }} rules={[{ required: true, message: "Alias fehlt." }]}>
                <Input />
              </Form.Item>
              <Form.Item name="status" label="Status" style={{ width: 140 }}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="v2-form-row">
              <Form.Item name="categoryId" label="Kategorie" style={{ flex: 1 }}>
                <Select
                  allowClear
                  options={categories.map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Form.Item>
              <Form.Item name="supplierId" label="Supplier" style={{ flex: 1 }}>
                <Select
                  allowClear
                  options={suppliers.map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Vertrieb</Title>
              <span className="v2-form-section-desc">Preis- und Margenparameter fuer Umsatz/Profit-Logik.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item name="avgSellingPriceGrossEUR" label="Ø VK-Preis (Brutto EUR)" style={{ flex: 1 }}>
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
              <Form.Item name="sellerboardMarginPct" label="Sellerboard Marge %" style={{ flex: 1 }}>
                <DeNumberInput mode="percent" min={0} max={100} />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Planungs-Policies</Title>
              <span className="v2-form-section-desc">Defaults aus Settings, optional produktspezifisch uebersteuerbar.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="moqUnits"
                label="MOQ Units"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.moqEffective, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="moqOverrideUnits"
                label={labelWithReset("MOQ Override Units", "moqOverrideUnits")}
                style={{ flex: 1 }}
                extra={<span className="v2-field-meta">Nur fuer dieses Produkt. Leer = MOQ aus Produkt/Settings.</span>}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="safetyStockDohOverride"
                label={labelWithReset("Safety Stock DOH Override", "safetyStockDohOverride")}
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.safetyDohEffective, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="foCoverageDohOverride"
                label={labelWithReset("FO Coverage DOH Override", "foCoverageDohOverride")}
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.coverageDohEffective, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Kosten</Title>
              <span className="v2-form-section-desc">Einstand (Landed) plus Logistikanteil je Einheit fuer Planungs- und PO/FO-Prefill.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="landedUnitCostEur"
                label="Einstandspreis (Landed Cost EUR)"
                style={{ flex: 1 }}
                extra={<span className="v2-field-meta">Gesamtkosten pro Einheit laut Ist-Daten (inkl. Importkosten je nach Quelle).</span>}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
              <Form.Item
                name="logisticsPerUnitEur"
                label={labelWithReset("Logistik/Stk (EUR)", "logisticsPerUnitEur")}
                style={{ flex: 1 }}
                extra={(
                  <span className="v2-field-meta">
                    <span>Effektiv: {formatNumber(asNumber(draftValues?.logisticsPerUnitEur), 2)} · Quelle: {logisticsManualOverride ? "Produkt-Override" : resolvedDraft.logisticsPerUnitEur.sourceLabel}</span>
                    <span>Vorschlag: {formatNumber(asNumber(shippingSuggestion.value), 2)} EUR/Stk (Formel: Landed - (USD/FX))</span>
                    <span>Warenkosten aus USD/FX: {formatNumber(asNumber(shippingSuggestion.goodsCostEur), 2)} EUR/Stk</span>
                  </span>
                )}
              >
                <DeNumberInput
                  mode="decimal"
                  min={0}
                  onChange={() => setLogisticsManualOverride(true)}
                />
              </Form.Item>
              <Form.Item
                name="productionLeadTimeDaysDefault"
                label={labelWithReset("Production Lead Time (Tage)", "productionLeadTimeDaysDefault")}
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.productionLeadDays, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Beschaffungs-Template</Title>
              <span className="v2-form-section-desc">Kosten- und Transportdefaults fuer Orders, wenn kein produktspezifischer Override gesetzt ist.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="templateUnitPriceUsd"
                label="Stueckpreis (USD)"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.unitPriceUsd, { digits: 2 })}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
              <Form.Item
                name="templateTransportMode"
                label="Transportmodus"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.transportMode, { kind: "text" })}
              >
                <Select options={TRANSPORT_MODES.map((mode) => ({ value: mode, label: mode }))} />
              </Form.Item>
              <Form.Item
                name="templateCurrency"
                label="Currency"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.currency, { kind: "text" })}
              >
                <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
              </Form.Item>
            </div>

            <div className="v2-form-row">
              <Form.Item
                name="templateProductionDays"
                label="Template Produktionstage"
                style={{ flex: 1 }}
                extra={<span className="v2-field-meta">Optionales Templatefeld fuer externe Vorlagen.</span>}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="templateTransitDays"
                label="Template Transit-Tage"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.transitDays, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="templateFreightEur"
                label="Template Logistik/Stk (EUR)"
                style={{ flex: 1 }}
                extra={<span className="v2-field-meta">Fallback fuer Kostenkette, wenn kein produktspezifischer Logistikwert gesetzt ist.</span>}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
            </div>

            <div className="v2-form-row">
              <Form.Item
                name="templateDutyPct"
                label="Zoll %"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.dutyPct, { digits: 2 })}
              >
                <DeNumberInput mode="percent" min={0} max={100} />
              </Form.Item>
              <Form.Item
                name="templateVatImportPct"
                label="EUSt %"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.eustPct, { digits: 2 })}
              >
                <DeNumberInput mode="percent" min={0} max={100} />
              </Form.Item>
              <Form.Item
                name="templateFxRate"
                label={labelWithReset("FX Rate (USD je EUR)", "templateFxRate")}
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.fxRate, { digits: 4 })}
              >
                <DeNumberInput mode="fx" min={0} />
              </Form.Item>
            </div>

            <Form.Item
              name="templateDdp"
              valuePropName="checked"
              extra={renderResolvedMeta(resolvedDraft.ddp, { kind: "boolean" })}
            >
              <Checkbox>DDP aktiv (Door-to-Door, Importkosten im Lieferpreis)</Checkbox>
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
