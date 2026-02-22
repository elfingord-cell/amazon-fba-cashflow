import { useEffect, useMemo, useState } from "react";
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
import { DataTable } from "../../components/DataTable";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { useSyncSession } from "../../sync/session";
import { useModalCollaboration } from "../../sync/modalCollaboration";

const { Paragraph, Text, Title } = Typography;

const INCOTERMS = ["EXW", "FOB", "DDP", "FCA"];
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
  const syncSession = useSyncSession();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<SupplierDraft>();
  const settings = (state.settings || {}) as Record<string, unknown>;
  const displayNameMap = useMemo(() => readCollaborationDisplayNames(settings), [settings]);
  const ownDisplayName = useMemo(() => {
    return resolveCollaborationUserLabel({
      userId: syncSession.userId,
      userEmail: syncSession.email,
    }, displayNameMap);
  }, [displayNameMap, syncSession.email, syncSession.userId]);
  const modalScope = useMemo(
    () => `suppliers:edit:${String(editingId || "new")}`,
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
    { header: "Name", accessorKey: "name", meta: { width: 190 } },
    { header: "Company", accessorKey: "company_name", meta: { width: 240 } },
    { header: "Prod. Lead (Tage)", accessorKey: "productionLeadTimeDaysDefault", meta: { width: 118, align: "right" } },
    { header: "Incoterm", accessorKey: "incotermDefault", meta: { width: 96 } },
    { header: "Currency", accessorKey: "currencyDefault", meta: { width: 96 } },
    {
      header: "Payment Terms",
      meta: { width: 260 },
      cell: ({ row }) => summaryTerms(row.original.paymentTermsDefault),
    },
    {
      header: "Aktualisiert",
      meta: { width: 108 },
      cell: ({ row }) => (
        row.original.updatedAt
          ? new Date(row.original.updatedAt).toLocaleDateString("de-DE")
          : "—"
      ),
    },
    {
      header: "Aktionen",
      meta: { width: 190, minWidth: 190 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
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
        </div>
      ),
    },
  ], [form, saveWith]);

  useEffect(() => {
    if (!modalOpen || !modalCollab.readOnly || !modalCollab.remoteDraftPatch) return;
    form.setFieldsValue(modalCollab.remoteDraftPatch as Partial<SupplierDraft>);
  }, [form, modalCollab.readOnly, modalCollab.remoteDraftPatch, modalCollab.remoteDraftVersion, modalOpen]);

  async function handleSave(values: SupplierDraft): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Dieser Lieferant wird gerade von einem anderen Nutzer bearbeitet.");
    }
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
    modalCollab.clearDraft();
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Suppliers</Title>
            <Paragraph>
              Lieferantenverwaltung inkl. Payment Terms mit Triggern fuer PO-Events.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
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
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <DataTable
          data={rows}
          columns={tableColumns}
          minTableWidth={1320}
          tableLayout="auto"
        />
      </Card>

      <Modal
        title={editingId ? "Lieferant bearbeiten" : "Lieferant hinzufuegen"}
        open={modalOpen}
        onCancel={() => {
          modalCollab.clearDraft();
          setModalOpen(false);
        }}
        onOk={() => {
          if (modalCollab.readOnly) {
            Modal.warning({
              title: "Nur Lesemodus",
              content: `${modalCollab.remoteUserLabel || "Kollege"} bearbeitet diesen Lieferanten. Bitte Bearbeitung übernehmen oder warten.`,
            });
            return;
          }
          void form.validateFields().then((values) => handleSave(values)).catch(() => {});
        }}
        width={980}
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
          name="v2-suppliers-modal"
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
