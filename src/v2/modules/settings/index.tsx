import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { validateAll } from "../../../lib/dataHealth.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";

const { Paragraph, Text, Title } = Typography;

const CURRENCIES = ["EUR", "USD", "CNY"];
const MONTH_ANCHOR_OPTIONS = [
  { value: "START", label: "Start (1. Tag)" },
  { value: "MID", label: "Mitte (15. Tag)" },
  { value: "END", label: "Ende (letzter Tag)" },
];

interface SettingsDraft {
  air: number;
  rail: number;
  sea: number;
  defaultBufferDays: number;
  defaultCurrency: string;
  fxRate: number | null;
  eurUsdRate: number | null;
  safetyStockDohDefault: number;
  foCoverageDohDefault: number;
  moqDefaultUnits: number;
  monthAnchorDay: string;
  cnyStart: string;
  cnyEnd: string;
}

interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  productCount: number;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function settingsDraftFromState(state: Record<string, unknown>): SettingsDraft {
  const transport = (state.transportLeadTimesDays || {}) as Record<string, unknown>;
  const cny = (state.cny || {}) as Record<string, unknown>;
  return {
    air: Math.max(0, toNumber(transport.air, 10)),
    rail: Math.max(0, toNumber(transport.rail, 25)),
    sea: Math.max(0, toNumber(transport.sea, 45)),
    defaultBufferDays: Math.max(0, toNumber(state.defaultBufferDays, 0)),
    defaultCurrency: String(state.defaultCurrency || "EUR"),
    fxRate: toOptionalNumber(state.fxRate),
    eurUsdRate: toOptionalNumber(state.eurUsdRate),
    safetyStockDohDefault: Math.max(0, toNumber(state.safetyStockDohDefault, 60)),
    foCoverageDohDefault: Math.max(0, toNumber(state.foCoverageDohDefault, 90)),
    moqDefaultUnits: Math.max(0, Math.round(toNumber(state.moqDefaultUnits, 500))),
    monthAnchorDay: String(state.monthAnchorDay || "START"),
    cnyStart: String(cny.start || ""),
    cnyEnd: String(cny.end || ""),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function SettingsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const settings = (state.settings || {}) as Record<string, unknown>;
  const [form] = Form.useForm<SettingsDraft>();
  const [draftSeed, setDraftSeed] = useState(() => settingsDraftFromState(settings));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [categoryForm] = Form.useForm<{ name: string; sortOrder: number }>();

  useEffect(() => {
    const nextSeed = settingsDraftFromState(settings);
    setDraftSeed(nextSeed);
    form.setFieldsValue(nextSeed);
  }, [form, settings]);

  const categoryRows = useMemo(() => {
    const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
    const products = Array.isArray(state.products) ? state.products : [];
    const counts = new Map<string, number>();
    products.forEach((product) => {
      const key = String((product as Record<string, unknown>).categoryId || "");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return categories
      .map((category) => {
        const row = category as Record<string, unknown>;
        return {
          id: String(row.id || ""),
          name: String(row.name || ""),
          sortOrder: toNumber(row.sortOrder, 0),
          productCount: counts.get(String(row.id || "")) || 0,
        } as CategoryRow;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [state.productCategories, state.products]);

  const healthIssues = useMemo(() => {
    const result = validateAll({
      settings: state.settings,
      products: state.products,
      suppliers: state.suppliers,
      pos: state.pos,
      fos: state.fos,
    });
    return result.issues || [];
  }, [state.settings, state.products, state.suppliers, state.pos, state.fos]);

  const categoryColumns = useMemo<ColumnDef<CategoryRow>[]>(() => [
    { header: "Name", accessorKey: "name" },
    { header: "Sortierung", accessorKey: "sortOrder" },
    { header: "Produkte", accessorKey: "productCount" },
    {
      header: "Aktionen",
      cell: ({ row }) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditingCategory(row.original);
              categoryForm.setFieldsValue({
                name: row.original.name,
                sortOrder: row.original.sortOrder,
              });
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "Kategorie loeschen?",
                content: "Produkte dieser Kategorie werden auf 'ohne Kategorie' gesetzt.",
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.productCategories = (Array.isArray(next.productCategories) ? next.productCategories : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    next.products = (Array.isArray(next.products) ? next.products : []).map((entry) => {
                      const product = entry as Record<string, unknown>;
                      if (String(product.categoryId || "") !== row.original.id) return product;
                      return { ...product, categoryId: null };
                    });
                    return next;
                  }, "v2:settings:category-delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </Space>
      ),
    },
  ], [categoryForm, saveWith]);

  async function handleSaveSettings(values: SettingsDraft): Promise<void> {
    if ((values.cnyStart && !values.cnyEnd) || (!values.cnyStart && values.cnyEnd)) {
      throw new Error("Bitte CNY Start und Ende gemeinsam setzen.");
    }
    if (values.cnyStart && values.cnyEnd && values.cnyStart > values.cnyEnd) {
      throw new Error("CNY Start darf nicht nach dem Ende liegen.");
    }
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const baseSettings = (next.settings || {}) as Record<string, unknown>;
      next.settings = {
        ...baseSettings,
        transportLeadTimesDays: {
          ...(baseSettings.transportLeadTimesDays as Record<string, unknown> || {}),
          air: Math.max(0, Math.round(values.air)),
          rail: Math.max(0, Math.round(values.rail)),
          sea: Math.max(0, Math.round(values.sea)),
        },
        defaultBufferDays: Math.max(0, Math.round(values.defaultBufferDays)),
        defaultCurrency: values.defaultCurrency,
        fxRate: values.fxRate,
        eurUsdRate: values.eurUsdRate,
        safetyStockDohDefault: Math.max(0, Math.round(values.safetyStockDohDefault)),
        foCoverageDohDefault: Math.max(0, Math.round(values.foCoverageDohDefault)),
        moqDefaultUnits: Math.max(0, Math.round(values.moqDefaultUnits)),
        monthAnchorDay: values.monthAnchorDay,
        cny: {
          start: values.cnyStart || "",
          end: values.cnyEnd || "",
        },
        lastUpdatedAt: nowIso(),
      };
      return next;
    }, "v2:settings:save");
  }

  async function handleAddCategory(): Promise<void> {
    const name = newCategoryName.trim();
    if (!name) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const categories = Array.isArray(next.productCategories) ? [...next.productCategories] : [];
      const exists = categories.some((entry) => String((entry as Record<string, unknown>).name || "").trim().toLowerCase() === name.toLowerCase());
      if (exists) {
        throw new Error("Kategorie existiert bereits.");
      }
      categories.push({
        id: randomId("cat"),
        name,
        sortOrder: categories.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      next.productCategories = categories;
      return next;
    }, "v2:settings:category-add");
    setNewCategoryName("");
  }

  async function handleUpdateCategory(values: { name: string; sortOrder: number }): Promise<void> {
    if (!editingCategory) return;
    const nextName = values.name.trim();
    if (!nextName) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      next.productCategories = (Array.isArray(next.productCategories) ? next.productCategories : []).map((entry) => {
        const category = entry as Record<string, unknown>;
        if (String(category.id || "") !== editingCategory.id) return category;
        return {
          ...category,
          name: nextName,
          sortOrder: Math.max(0, Math.round(values.sortOrder || 0)),
          updatedAt: nowIso(),
        };
      });
      return next;
    }, "v2:settings:category-update");
    setEditingCategory(null);
    categoryForm.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Settings</Title>
            <Paragraph>
              Lead Times, Defaults, CNY-Fenster und Kategorien werden direkt auf dem V2 Workspace gespeichert.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Form<SettingsDraft>
          form={form}
          layout="vertical"
          initialValues={draftSeed}
          onFinish={(values) => {
            void handleSaveSettings(values);
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Air (Tage)" name="air" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Rail (Tage)" name="rail" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Sea (Tage)" name="sea" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Buffer Days" name="defaultBufferDays" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Default Currency" name="defaultCurrency" rules={[{ required: true }]}>
                <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Monats-Anker" name="monthAnchorDay" rules={[{ required: true }]}>
                <Select options={MONTH_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="FX Kurs (USD je EUR)" name="fxRate">
                <InputNumber style={{ width: "100%" }} min={0} step={0.0001} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="FX Kurs (EUR je USD)" name="eurUsdRate">
                <InputNumber style={{ width: "100%" }} min={0} step={0.0001} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="MOQ Default (Units)" name="moqDefaultUnits">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Safety Stock DOH" name="safetyStockDohDefault">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="FO Coverage DOH" name="foCoverageDohDefault">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="CNY Start" name="cnyStart">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="CNY Ende" name="cnyEnd">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          <Button type="primary" htmlType="submit" loading={saving}>
            Settings speichern
          </Button>
        </Form>
      </Card>

      <Card>
        <Title level={4}>Produktkategorien</Title>
        <Space style={{ marginBottom: 12 }}>
          <Input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Neue Kategorie"
            style={{ width: 260 }}
          />
          <Button onClick={() => { void handleAddCategory(); }}>
            Hinzufuegen
          </Button>
        </Space>
        <TanStackGrid data={categoryRows} columns={categoryColumns} />
      </Card>

      <Card>
        <Title level={4}>Data Health</Title>
        {healthIssues.length ? (
          <Space direction="vertical" size={6}>
            <Tag color="orange">{healthIssues.length} Issues</Tag>
            {healthIssues.slice(0, 10).map((issue) => (
              <Text key={issue.id}>
                {issue.message}
              </Text>
            ))}
          </Space>
        ) : (
          <Text type="secondary">Keine Issues gefunden.</Text>
        )}
      </Card>

      <Modal
        title="Kategorie bearbeiten"
        open={Boolean(editingCategory)}
        onCancel={() => setEditingCategory(null)}
        onOk={() => {
          void categoryForm
            .validateFields()
            .then((values) => handleUpdateCategory(values))
            .catch(() => {});
        }}
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name ist erforderlich." }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label="Sortierung" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
