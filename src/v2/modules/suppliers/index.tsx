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
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";

const { Paragraph, Text, Title } = Typography;

const INCOTERMS = ["EXW", "FOB", "DDP"];
const CURRENCIES = ["EUR", "USD", "CNY"];
const TRIGGER_EVENTS = ["ORDER_DATE", "PRODUCTION_END", "ETD", "ETA"];

interface PaymentTerm {
  label: string;
  percent: number;
  triggerEvent: string;
  offsetDays: number;
}

interface SupplierDraft {
  id?: string;
  name: string;
  company_name: string;
  productionLeadTimeDaysDefault: number;
  incotermDefault: string;
  currencyDefault: string;
  paymentTermsDefault: PaymentTerm[];
}

interface SupplierRow {
  id: string;
  name: string;
  company_name: string;
  productionLeadTimeDaysDefault: number;
  incotermDefault: string;
  currencyDefault: string;
  paymentTermsDefault: PaymentTerm[];
  updatedAt: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultPaymentTerms(): PaymentTerm[] {
  return [
    { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
    { label: "Balance", percent: 70, triggerEvent: "ETD", offsetDays: 0 },
  ];
}

function normalizePaymentTerms(input: unknown[]): PaymentTerm[] {
  const list = Array.isArray(input) ? input : [];
  return list.map((entry) => {
    const row = (entry || {}) as Record<string, unknown>;
    return {
      label: String(row.label || "Milestone"),
      percent: Math.min(100, Math.max(0, Number(row.percent) || 0)),
      triggerEvent: TRIGGER_EVENTS.includes(String(row.triggerEvent || ""))
        ? String(row.triggerEvent)
        : "ORDER_DATE",
      offsetDays: Number(row.offsetDays) || 0,
    };
  });
}

function summaryTerms(terms: PaymentTerm[]): string {
  if (!terms.length) return "—";
  return terms
    .map((term) => `${term.percent}% @ ${term.triggerEvent}${term.offsetDays ? ` ${term.offsetDays >= 0 ? "+" : ""}${term.offsetDays}` : ""}`)
    .join(", ");
}

export default function SuppliersModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<SupplierDraft>();

  const rows = useMemo(() => {
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    return suppliers
      .map((entry) => {
        const supplier = entry as Record<string, unknown>;
        return {
          id: String(supplier.id || ""),
          name: String(supplier.name || ""),
          company_name: String(supplier.company_name || ""),
          productionLeadTimeDaysDefault: Number(supplier.productionLeadTimeDaysDefault) || 0,
          incotermDefault: String(supplier.incotermDefault || "EXW"),
          currencyDefault: String(supplier.currencyDefault || "EUR"),
          paymentTermsDefault: normalizePaymentTerms(supplier.paymentTermsDefault as unknown[]),
          updatedAt: supplier.updatedAt ? String(supplier.updatedAt) : null,
        } satisfies SupplierRow;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.suppliers]);

  const tableColumns = useMemo<ColumnDef<SupplierRow>[]>(() => [
    { header: "Name", accessorKey: "name" },
    { header: "Company", accessorKey: "company_name" },
    { header: "Prod. Lead (Tage)", accessorKey: "productionLeadTimeDaysDefault" },
    { header: "Incoterm", accessorKey: "incotermDefault" },
    { header: "Currency", accessorKey: "currencyDefault" },
    {
      header: "Payment Terms",
      cell: ({ row }) => summaryTerms(row.original.paymentTermsDefault),
    },
    {
      header: "Aktualisiert",
      cell: ({ row }) => (
        row.original.updatedAt
          ? new Date(row.original.updatedAt).toLocaleDateString("de-DE")
          : "—"
      ),
    },
    {
      header: "Aktionen",
      cell: ({ row }) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditingId(row.original.id);
              form.setFieldsValue({
                id: row.original.id,
                name: row.original.name,
                company_name: row.original.company_name,
                productionLeadTimeDaysDefault: row.original.productionLeadTimeDaysDefault,
                incotermDefault: row.original.incotermDefault,
                currencyDefault: row.original.currencyDefault,
                paymentTermsDefault: row.original.paymentTermsDefault,
              });
              setModalOpen(true);
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: `Lieferant "${row.original.name}" loeschen?`,
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.suppliers = (Array.isArray(next.suppliers) ? next.suppliers : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    return next;
                  }, "v2:suppliers:delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </Space>
      ),
    },
  ], [form, saveWith]);

  async function handleSave(values: SupplierDraft): Promise<void> {
    const terms = normalizePaymentTerms(values.paymentTermsDefault as unknown[]);
    const percentSum = terms.reduce((sum, row) => sum + row.percent, 0);
    if (Math.round(percentSum) !== 100) {
      throw new Error("Payment Terms muessen insgesamt 100% ergeben.");
    }
    const normalizedName = values.name.trim().toLowerCase();
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const suppliers = Array.isArray(next.suppliers) ? [...next.suppliers] : [];
      const conflict = suppliers.some((entry) => {
        const supplier = entry as Record<string, unknown>;
        const name = String(supplier.name || "").trim().toLowerCase();
        return name === normalizedName && String(supplier.id || "") !== String(values.id || "");
      });
      if (conflict) {
        throw new Error("Supplier-Name muss eindeutig sein.");
      }
      const now = nowIso();
      const payload = {
        id: values.id || randomId("sup"),
        name: values.name.trim(),
        company_name: values.company_name.trim(),
        productionLeadTimeDaysDefault: Math.max(0, Math.round(values.productionLeadTimeDaysDefault || 0)),
        incotermDefault: values.incotermDefault,
        currencyDefault: values.currencyDefault,
        paymentTermsDefault: terms,
        updatedAt: now,
      };
      const index = suppliers.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === payload.id);
      if (index >= 0) {
        suppliers[index] = {
          ...(suppliers[index] as Record<string, unknown>),
          ...payload,
        };
      } else {
        suppliers.push({
          ...payload,
          createdAt: now,
          skuOverrides: {},
        });
      }
      next.suppliers = suppliers;
      return next;
    }, editingId ? "v2:suppliers:update" : "v2:suppliers:create");
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Suppliers (V2 Native)</Title>
        <Paragraph>
          Lieferantenverwaltung inkl. Payment Terms mit Triggern fuer PO-Events.
        </Paragraph>
        <Space>
          <Button
            type="primary"
            onClick={() => {
              setEditingId(null);
              form.setFieldsValue({
                id: undefined,
                name: "",
                company_name: "",
                productionLeadTimeDaysDefault: 30,
                incotermDefault: "EXW",
                currencyDefault: "EUR",
                paymentTermsDefault: defaultPaymentTerms(),
              });
              setModalOpen(true);
            }}
          >
            Lieferant hinzufuegen
          </Button>
          {saving ? <Tag color="processing">Speichern...</Tag> : null}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <TanStackGrid data={rows} columns={tableColumns} />
      </Card>

      <Modal
        title={editingId ? "Lieferant bearbeiten" : "Lieferant hinzufuegen"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => handleSave(values)).catch(() => {});
        }}
        width={980}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ width: "100%" }} align="start">
            <Form.Item
              name="name"
              label="Name"
              style={{ flex: 1 }}
              rules={[{ required: true, message: "Name ist erforderlich." }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="company_name"
              label="Company"
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start">
            <Form.Item name="productionLeadTimeDaysDefault" label="Production Lead Time (Tage)" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item name="incotermDefault" label="Incoterm" style={{ flex: 1 }}>
              <Select options={INCOTERMS.map((incoterm) => ({ value: incoterm, label: incoterm }))} />
            </Form.Item>
            <Form.Item name="currencyDefault" label="Currency" style={{ flex: 1 }}>
              <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
            </Form.Item>
          </Space>

          <Title level={5}>Payment Terms</Title>
          <Form.List name="paymentTermsDefault">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ width: "100%" }}>
                    <Form.Item
                      {...field}
                      name={[field.name, "label"]}
                      style={{ flex: 2 }}
                      rules={[{ required: true, message: "Label fehlt." }]}
                    >
                      <Input placeholder="Label" />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "percent"]}
                      style={{ flex: 1 }}
                      rules={[{ required: true, message: "%" }]}
                    >
                      <InputNumber min={0} max={100} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "triggerEvent"]}
                      style={{ flex: 1 }}
                      rules={[{ required: true, message: "Trigger fehlt." }]}
                    >
                      <Select options={TRIGGER_EVENTS.map((evt) => ({ value: evt, label: evt }))} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "offsetDays"]}
                      style={{ flex: 1 }}
                    >
                      <InputNumber style={{ width: "100%" }} />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>
                      X
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add({ label: "Milestone", percent: 0, triggerEvent: "ORDER_DATE", offsetDays: 0 })}>
                  Milestone hinzufuegen
                </Button>
                <Text type="secondary">
                  Summe muss 100% ergeben.
                </Text>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
