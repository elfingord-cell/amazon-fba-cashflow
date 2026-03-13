import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, InputNumber, Space, Table, Tag, Typography } from "antd";
import { buildOssQuarterPreview, normalizeTaxesState, OSS_PROXY_RATE } from "../../../domain/taxPlanner.js";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface OssDraft {
  active: boolean;
  deSharePct: string;
}

function cloneOssDraft(state: Record<string, unknown>): OssDraft {
  return structuredClone(normalizeTaxesState(state.taxes).oss) as OssDraft;
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} %`;
}

function formatMonthLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return ym;
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function toPercentNumber(value: string): number {
  const numeric = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(100, Math.max(0, numeric));
}

export default function OssPanel(): JSX.Element {
  const { state, error, loading, lastSavedAt, saveWith, saving } = useWorkspaceState();
  const [draft, setDraft] = useState<OssDraft>(() => cloneOssDraft(state as unknown as Record<string, unknown>));
  const [dirty, setDirty] = useState(false);

  const stateObject = state as unknown as Record<string, unknown>;

  useEffect(() => {
    setDraft(cloneOssDraft(stateObject));
    setDirty(false);
  }, [state.taxes, stateObject]);

  const deSharePct = useMemo(() => toPercentNumber(draft.deSharePct), [draft.deSharePct]);
  const nonDeSharePct = useMemo(() => Math.max(0, 100 - deSharePct), [deSharePct]);

  const previewRows = useMemo(() => {
    const taxes = normalizeTaxesState(stateObject.taxes);
    taxes.oss = structuredClone(draft);
    return buildOssQuarterPreview({
      ...stateObject,
      taxes,
    });
  }, [draft, stateObject]);

  async function saveDraft(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const taxes = normalizeTaxesState(next.taxes);
      taxes.oss = structuredClone(draft);
      next.taxes = taxes;
      return next;
    }, "v2:taxes:oss:save");
    setDirty(false);
  }

  return (
    <div className="v2-page">
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      {loading ? <Alert type="info" showIcon message="OSS wird geladen..." style={{ marginBottom: 12 }} /> : null}

      <Card className="v2-intro-card" style={{ marginBottom: 12 }}>
        <div className="v2-page-head">
          <div>
            <Title level={4}>OSS</Title>
            <Paragraph>
              Vereinfachter Proxy-Modus: DE-Anteil, abgeleiteter Auslandsanteil, fixer Satz 20,3 % und Netto-Umsatz als Basis.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar-row">
          <Button type="primary" onClick={() => { void saveDraft(); }} disabled={!dirty} loading={saving}>
            OSS speichern
          </Button>
          {dirty ? <Tag color="gold">Ungespeicherte Änderungen</Tag> : <Tag color="green">Synchron</Tag>}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <Space wrap align="start" size={16}>
          <Checkbox
            checked={draft.active === true}
            onChange={(event) => {
              setDraft((current) => ({ ...current, active: event.target.checked }));
              setDirty(true);
            }}
          >
            OSS aktiv
          </Checkbox>
          <div>
            <Text>DE-Anteil am Umsatz</Text>
            <br />
            <InputNumber
              value={deSharePct}
              min={0}
              max={100}
              step={0.1}
              onChange={(value) => {
                const nextValue = Math.min(100, Math.max(0, Number(value || 0)));
                setDraft((current) => ({ ...current, deSharePct: String(nextValue).replace(".", ",") }));
                setDirty(true);
              }}
            />
          </div>
          <Tag color="blue">Auslandsanteil: {formatPercent(nonDeSharePct)}</Tag>
          <Tag color="purple">OSS Proxy: {formatPercent(OSS_PROXY_RATE * 100)}</Tag>
          <Tag color="default">Basis: Netto-Umsatz</Tag>
        </Space>
      </Card>

      <Card>
        <Table
          className="v2-ant-table"
          size="small"
          pagination={false}
          dataSource={previewRows.map((row) => ({ key: row.quarterKey, ...row }))}
          columns={[
            {
              title: "Quartal",
              dataIndex: "quarterLabel",
              key: "quarterLabel",
            },
            {
              title: "DE-Anteil",
              key: "deSharePct",
              render: (_, row) => formatPercent(Number(row.deSharePct || 0)),
            },
            {
              title: "Auslandsanteil",
              key: "nonDeSharePct",
              render: (_, row) => formatPercent(Number(row.nonDeSharePct || 0)),
            },
            {
              title: "Netto-Umsatz",
              key: "netRevenue",
              render: (_, row) => formatCurrency(row.netRevenue),
            },
            {
              title: "OSS-Basis",
              key: "quarterBaseAmount",
              render: (_, row) => formatCurrency(row.quarterBaseAmount),
            },
            {
              title: "OSS-Steuer",
              key: "taxAmount",
              render: (_, row) => formatCurrency(row.taxAmount),
            },
            {
              title: "Zahlungsmonat",
              key: "paymentMonth",
              render: (_, row) => formatMonthLabel(String(row.paymentMonth || "")),
            },
          ]}
          summary={() => {
            const totalBase = previewRows.reduce((sum, row) => sum + Number(row.quarterBaseAmount || 0), 0);
            const totalTax = previewRows.reduce((sum, row) => sum + Number(row.taxAmount || 0), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}><strong>Summe</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4}><strong>{formatCurrency(totalBase)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5}><strong>{formatCurrency(totalTax)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            );
          }}
        />
        {!draft.active ? (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="OSS ist aktuell deaktiviert. Die Quartalswerte dienen als Vorschau und fließen noch nicht in den Cashflow."
          />
        ) : null}
      </Card>
    </div>
  );
}
