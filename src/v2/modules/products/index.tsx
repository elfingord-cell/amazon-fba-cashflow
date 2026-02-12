import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
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
import { buildProductGridRows, type ProductGridRow } from "../../domain/tableModels";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [form] = Form.useForm<ProductDraft>();
  const stateObject = state as unknown as Record<string, unknown>;

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

  const rows = useMemo(() => {
    return buildProductGridRows({
      state: stateObject,
      search,
      statusFilter,
      categoryLabelById,
      supplierLabelById,
    });
  }, [categoryLabelById, search, stateObject, statusFilter, supplierLabelById]);

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => [
    { header: "SKU", accessorKey: "sku" },
    { header: "Alias", accessorKey: "alias" },
    {
      header: "Kategorie",
      cell: ({ row }) => (row.original.categoryId ? categoryLabelById.get(row.original.categoryId) || row.original.categoryId : "Ohne Kategorie"),
    },
    {
      header: "Supplier",
      cell: ({ row }) => (row.original.supplierId ? supplierLabelById.get(row.original.supplierId) || row.original.supplierId : "—"),
    },
    {
      header: "Status",
      cell: ({ row }) => (
        row.original.status === "inactive"
          ? <Tag>Inaktiv</Tag>
          : <Tag color="green">Aktiv</Tag>
      ),
    },
    {
      header: "Completeness",
      cell: ({ row }) => completenessTag(row.original.completeness),
    },
    {
      header: "Ø VK (EUR)",
      cell: ({ row }) => row.original.avgSellingPriceGrossEUR == null ? "—" : row.original.avgSellingPriceGrossEUR.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    {
      header: "Marge %",
      cell: ({ row }) => row.original.sellerboardMarginPct == null ? "—" : row.original.sellerboardMarginPct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
    },
    {
      header: "MOQ",
      cell: ({ row }) => row.original.moqUnits == null ? "—" : String(Math.round(row.original.moqUnits)),
    },
    {
      header: "Aktionen",
      cell: ({ row }) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditing(row.original);
              form.setFieldsValue(productDraftFromRow(row.original));
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
        </Space>
      ),
    },
  ], [categoryLabelById, form, saveWith, supplierLabelById]);

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
    form.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Produkte (V2 Native)</Title>
        <Paragraph>
          Produktstammdaten mit Completeness-Status, Kategorie/Supplier-Zuordnung und Kern-Kalkulationsfeldern.
        </Paragraph>
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
            onClick={() => {
              setEditing(null);
              form.setFieldsValue(productDraftFromRow(undefined));
              setModalOpen(true);
            }}
          >
            Produkt hinzufuegen
          </Button>
          {saving ? <Tag color="processing">Speichern...</Tag> : null}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <TanStackGrid data={rows} columns={columns} />
      </Card>

      <Modal
        title={editing ? `Produkt bearbeiten: ${editing.sku}` : "Produkt hinzufuegen"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => handleSave(values)).catch(() => {});
        }}
        width={1060}
      >
        <Form<ProductDraft> form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>

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

          <div className="v2-form-row">
            <Form.Item name="avgSellingPriceGrossEUR" label="Ø VK-Preis (Brutto EUR)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="sellerboardMarginPct" label="Sellerboard Marge %" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.01} />
            </Form.Item>
            <Form.Item name="moqUnits" label="MOQ Units" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="safetyStockDohOverride" label="Safety Stock DOH Override" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="foCoverageDohOverride" label="FO Coverage DOH Override" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="moqOverrideUnits" label="MOQ Override Units" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="landedUnitCostEur" label="Einstandspreis (EUR)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="logisticsPerUnitEur" label="Logistik je Einheit (EUR)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="productionLeadTimeDaysDefault" label="Production Lead Time (Tage)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
          </div>

          <Title level={5}>Template (Kernfelder)</Title>
          <div className="v2-form-row">
            <Form.Item name="templateUnitPriceUsd" label="Stueckpreis (USD)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="templateTransportMode" label="Transport" style={{ flex: 1 }}>
              <Select options={TRANSPORT_MODES.map((mode) => ({ value: mode, label: mode }))} />
            </Form.Item>
            <Form.Item name="templateCurrency" label="Currency" style={{ flex: 1 }}>
              <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="templateProductionDays" label="Produktionstage" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="templateTransitDays" label="Transit-Tage" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="templateFreightEur" label="Fracht (EUR)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
            </Form.Item>
          </div>

          <div className="v2-form-row">
            <Form.Item name="templateDutyPct" label="Zoll %" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.01} />
            </Form.Item>
            <Form.Item name="templateVatImportPct" label="EUSt %" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.01} />
            </Form.Item>
            <Form.Item name="templateFxRate" label="FX Rate" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} step={0.0001} />
            </Form.Item>
          </div>

          <Form.Item name="templateDdp" valuePropName="checked">
            <Checkbox>DDP aktiv</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
