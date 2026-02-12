import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { computeVatPreview } from "../../../domain/vatPreview.js";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface VatSettingsDraft {
  eustLagMonths: number;
  deShareDefault: number;
  feeRateDefault: number;
  fixInputDefault: number;
}

interface VatMonthOverrideDraft {
  deShare?: number;
  feeRateOfGross?: number;
  fixInputVat?: number;
}

interface VatDetailItem {
  label?: string;
  sublabel?: string;
  date?: string | null;
  amount?: number;
  meta?: Record<string, unknown>;
}

interface VatDetailBucket {
  formula?: string;
  items?: VatDetailItem[];
  notes?: string;
  total?: number;
}

interface VatPreviewRow {
  month: string;
  monthLabel?: string;
  grossDe: number;
  outVat: number;
  feeInputVat: number;
  fixInputVat: number;
  eustRefund: number;
  payable: number;
  details: Record<string, VatDetailBucket>;
}

interface VatPreviewResult {
  months: string[];
  rows: VatPreviewRow[];
  totals: {
    grossDe: number;
    outVat: number;
    feeInputVat: number;
    fixInputVat: number;
    eustRefund: number;
    payable: number;
  };
}

const DETAIL_LABELS: Record<string, string> = {
  deBrutto: "DE-Brutto",
  outputUst: "Output-USt",
  vstFees: "VSt Fees",
  fixkostenVst: "Fixkosten-VSt",
  eustErstattung: "EUSt-Erstattung",
  zahllast: "Zahllast",
};

function toNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  return `${(value * 100).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} %`;
}

function normalizeSettings(state: Record<string, unknown>): VatSettingsDraft {
  const vatPreview = (state?.settings && typeof state.settings === "object")
    ? ((state.settings as Record<string, unknown>).vatPreview as Record<string, unknown> | undefined)
    : undefined;
  return {
    eustLagMonths: Math.max(0, toNumber(vatPreview?.eustLagMonths, 2)),
    deShareDefault: Math.min(1, Math.max(0, toNumber(vatPreview?.deShareDefault, 0.8))),
    feeRateDefault: Math.min(1, Math.max(0, toNumber(vatPreview?.feeRateDefault, 0.38))),
    fixInputDefault: Math.max(0, toNumber(vatPreview?.fixInputDefault, 0)),
  };
}

function normalizeMonthOverrides(input: unknown): Record<string, VatMonthOverrideDraft> {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce((acc, [month, row]) => {
    if (!/^\d{4}-\d{2}$/.test(month) || !row || typeof row !== "object") return acc;
    const source = row as Record<string, unknown>;
    acc[month] = {
      deShare: source.deShare == null ? undefined : Math.min(1, Math.max(0, toNumber(source.deShare, 0))),
      feeRateOfGross: source.feeRateOfGross == null ? undefined : Math.min(1, Math.max(0, toNumber(source.feeRateOfGross, 0))),
      fixInputVat: source.fixInputVat == null ? undefined : Math.max(0, toNumber(source.fixInputVat, 0)),
    };
    return acc;
  }, {} as Record<string, VatMonthOverrideDraft>);
}

export default function VatModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [settingsDraft, setSettingsDraft] = useState<VatSettingsDraft>(() => normalizeSettings(state as unknown as Record<string, unknown>));
  const [monthOverridesDraft, setMonthOverridesDraft] = useState<Record<string, VatMonthOverrideDraft>>({});
  const [dirty, setDirty] = useState(false);
  const [monthModal, setMonthModal] = useState<null | { month: string; values: VatMonthOverrideDraft }>(null);
  const [detailModal, setDetailModal] = useState<null | { month: string; key: string }>(null);

  const stateObj = state as unknown as Record<string, unknown>;

  useEffect(() => {
    setSettingsDraft(normalizeSettings(stateObj));
    setMonthOverridesDraft(normalizeMonthOverrides(stateObj.vatPreviewMonths));
    setDirty(false);
  }, [state.settings, state.vatPreviewMonths]);

  const preview = useMemo(() => {
    const virtualState = structuredClone(stateObj);
    if (!virtualState.settings || typeof virtualState.settings !== "object") {
      virtualState.settings = {};
    }
    (virtualState.settings as Record<string, unknown>).vatPreview = {
      eustLagMonths: settingsDraft.eustLagMonths,
      deShareDefault: settingsDraft.deShareDefault,
      feeRateDefault: settingsDraft.feeRateDefault,
      fixInputDefault: settingsDraft.fixInputDefault,
    };
    virtualState.vatPreviewMonths = monthOverridesDraft;
    return computeVatPreview(virtualState) as VatPreviewResult;
  }, [monthOverridesDraft, settingsDraft, stateObj]);

  const rowsByMonth = useMemo(() => new Map(preview.rows.map((row) => [row.month, row])), [preview.rows]);

  const tableData = useMemo(() => {
    return preview.rows.map((row) => ({
      key: row.month,
      month: row.month,
      monthLabel: row.monthLabel || row.month,
      grossDe: row.grossDe,
      outVat: row.outVat,
      feeInputVat: row.feeInputVat,
      fixInputVat: row.fixInputVat,
      eustRefund: row.eustRefund,
      payable: row.payable,
      deShare: monthOverridesDraft[row.month]?.deShare ?? settingsDraft.deShareDefault,
      feeRate: monthOverridesDraft[row.month]?.feeRateOfGross ?? settingsDraft.feeRateDefault,
    }));
  }, [monthOverridesDraft, preview.rows, settingsDraft.deShareDefault, settingsDraft.feeRateDefault]);

  async function saveVatDraft(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const settings = (next.settings || {}) as Record<string, unknown>;
      next.settings = {
        ...settings,
        vatPreview: {
          eustLagMonths: settingsDraft.eustLagMonths,
          deShareDefault: settingsDraft.deShareDefault,
          feeRateDefault: settingsDraft.feeRateDefault,
          fixInputDefault: settingsDraft.fixInputDefault,
        },
      };
      next.vatPreviewMonths = monthOverridesDraft;
      return next;
    }, "v2:vat:save");
    setDirty(false);
  }

  function openMonthEditor(month: string): void {
    setMonthModal({
      month,
      values: {
        deShare: monthOverridesDraft[month]?.deShare ?? settingsDraft.deShareDefault,
        feeRateOfGross: monthOverridesDraft[month]?.feeRateOfGross ?? settingsDraft.feeRateDefault,
        fixInputVat: monthOverridesDraft[month]?.fixInputVat ?? settingsDraft.fixInputDefault,
      },
    });
  }

  function copyPreviousMonth(month: string): void {
    const idx = preview.months.indexOf(month);
    if (idx <= 0) return;
    const prevMonth = preview.months[idx - 1];
    const prev = monthOverridesDraft[prevMonth] || {
      deShare: settingsDraft.deShareDefault,
      feeRateOfGross: settingsDraft.feeRateDefault,
      fixInputVat: settingsDraft.fixInputDefault,
    };
    setMonthModal((current) => current && current.month === month ? { ...current, values: { ...prev } } : current);
  }

  const detailContent = useMemo(() => {
    if (!detailModal) return null;
    const row = rowsByMonth.get(detailModal.month);
    if (!row) return null;
    const detail = row.details?.[detailModal.key];
    if (!detail) return null;
    return {
      row,
      detail,
    };
  }, [detailModal, rowsByMonth]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>USt Vorschau (V2 Native)</Title>
        <Paragraph>
          DE-USt-Vorschau mit Detaildrilldown und Monats-Overrides fuer DE-Anteil, Gebuehrensatz und Fixkosten-VSt.
        </Paragraph>
        <Space>
          <Button type="primary" onClick={() => { void saveVatDraft(); }} disabled={!dirty} loading={saving}>
            USt-Einstellungen speichern
          </Button>
          <Button
            onClick={() => {
              setMonthOverridesDraft({});
              setDirty(true);
            }}
          >
            Monats-Overrides zuruecksetzen
          </Button>
          {dirty ? <Tag color="gold">Ungespeicherte Aenderungen</Tag> : <Tag color="green">Synchron</Tag>}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={5}>Standardwerte</Title>
        <Space wrap align="start">
          <div>
            <Text>EUSt Lag (Monate)</Text>
            <InputNumber
              value={settingsDraft.eustLagMonths}
              min={0}
              onChange={(value) => {
                setSettingsDraft((prev) => ({ ...prev, eustLagMonths: Math.max(0, Number(value || 0)) }));
                setDirty(true);
              }}
            />
          </div>
          <div>
            <Text>DE Anteil</Text>
            <InputNumber
              value={settingsDraft.deShareDefault}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => {
                setSettingsDraft((prev) => ({ ...prev, deShareDefault: Math.min(1, Math.max(0, Number(value || 0))) }));
                setDirty(true);
              }}
            />
          </div>
          <div>
            <Text>Gebuehrensatz</Text>
            <InputNumber
              value={settingsDraft.feeRateDefault}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => {
                setSettingsDraft((prev) => ({ ...prev, feeRateDefault: Math.min(1, Math.max(0, Number(value || 0))) }));
                setDirty(true);
              }}
            />
          </div>
          <div>
            <Text>Fixkosten-VSt pauschal (EUR)</Text>
            <InputNumber
              value={settingsDraft.fixInputDefault}
              min={0}
              step={10}
              onChange={(value) => {
                setSettingsDraft((prev) => ({ ...prev, fixInputDefault: Math.max(0, Number(value || 0)) }));
                setDirty(true);
              }}
            />
          </div>
        </Space>
      </Card>

      <Card>
        <Space wrap>
          <Tag color="default">Output-USt gesamt: {formatCurrency(preview.totals.outVat)}</Tag>
          <Tag color="blue">VSt Fees gesamt: {formatCurrency(preview.totals.feeInputVat)}</Tag>
          <Tag color="purple">Fixkosten-VSt gesamt: {formatCurrency(preview.totals.fixInputVat)}</Tag>
          <Tag color={preview.totals.payable < 0 ? "red" : "green"}>
            Zahllast gesamt: {formatCurrency(preview.totals.payable)}
          </Tag>
        </Space>
      </Card>

      <Card>
        <Table
          size="small"
          pagination={false}
          dataSource={tableData}
          columns={[
            { title: "Monat", dataIndex: "monthLabel", key: "monthLabel" },
            {
              title: "DE Anteil",
              key: "deShare",
              render: (_, row) => formatPercent(row.deShare),
            },
            {
              title: "Gebuehrensatz",
              key: "feeRate",
              render: (_, row) => formatPercent(row.feeRate),
            },
            {
              title: "DE-Brutto",
              key: "grossDe",
              render: (_, row) => (
                <Button type="link" onClick={() => setDetailModal({ month: row.month, key: "deBrutto" })}>
                  {formatCurrency(row.grossDe)}
                </Button>
              ),
            },
            {
              title: "Output-USt",
              key: "outVat",
              render: (_, row) => (
                <Button type="link" onClick={() => setDetailModal({ month: row.month, key: "outputUst" })}>
                  {formatCurrency(row.outVat)}
                </Button>
              ),
            },
            {
              title: "VSt Fees",
              key: "feeInputVat",
              render: (_, row) => (
                <Button type="link" onClick={() => setDetailModal({ month: row.month, key: "vstFees" })}>
                  {formatCurrency(row.feeInputVat)}
                </Button>
              ),
            },
            {
              title: "Fixkosten-VSt",
              key: "fixInputVat",
              render: (_, row) => (
                <Button type="link" onClick={() => setDetailModal({ month: row.month, key: "fixkostenVst" })}>
                  {formatCurrency(row.fixInputVat)}
                </Button>
              ),
            },
            {
              title: "EUSt-Erstattung",
              key: "eustRefund",
              render: (_, row) => (
                <Button type="link" onClick={() => setDetailModal({ month: row.month, key: "eustErstattung" })}>
                  {formatCurrency(row.eustRefund)}
                </Button>
              ),
            },
            {
              title: "Zahllast",
              key: "payable",
              render: (_, row) => (
                <Button type="link" danger={row.payable < 0} onClick={() => setDetailModal({ month: row.month, key: "zahllast" })}>
                  {formatCurrency(row.payable)}
                </Button>
              ),
            },
            {
              title: "Aktionen",
              key: "actions",
              render: (_, row) => (
                <Button size="small" onClick={() => openMonthEditor(row.month)}>
                  Monat bearbeiten
                </Button>
              ),
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}><strong>Summe</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={3}><strong>{formatCurrency(preview.totals.grossDe)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={4}><strong>{formatCurrency(preview.totals.outVat)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={5}><strong>{formatCurrency(preview.totals.feeInputVat)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={6}><strong>{formatCurrency(preview.totals.fixInputVat)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={7}><strong>{formatCurrency(preview.totals.eustRefund)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={8}><strong>{formatCurrency(preview.totals.payable)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={9} />
            </Table.Summary.Row>
          )}
        />
      </Card>

      <Modal
        title={monthModal ? `Monats-Override ${monthModal.month}` : "Monats-Override"}
        open={Boolean(monthModal)}
        onCancel={() => setMonthModal(null)}
        onOk={() => {
          if (!monthModal) return;
          setMonthOverridesDraft((prev) => ({
            ...prev,
            [monthModal.month]: {
              deShare: Math.min(1, Math.max(0, toNumber(monthModal.values.deShare, settingsDraft.deShareDefault))),
              feeRateOfGross: Math.min(1, Math.max(0, toNumber(monthModal.values.feeRateOfGross, settingsDraft.feeRateDefault))),
              fixInputVat: Math.max(0, toNumber(monthModal.values.fixInputVat, settingsDraft.fixInputDefault)),
            },
          }));
          setDirty(true);
          setMonthModal(null);
        }}
      >
        {monthModal ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Button
              onClick={() => copyPreviousMonth(monthModal.month)}
              disabled={preview.months.indexOf(monthModal.month) <= 0}
            >
              Vormonat uebernehmen
            </Button>
            <Text>DE Anteil</Text>
            <InputNumber
              value={monthModal.values.deShare}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setMonthModal((prev) => prev ? {
                ...prev,
                values: { ...prev.values, deShare: toNumber(value, prev.values.deShare ?? settingsDraft.deShareDefault) },
              } : prev)}
            />
            <Text>Gebuehrensatz</Text>
            <InputNumber
              value={monthModal.values.feeRateOfGross}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setMonthModal((prev) => prev ? {
                ...prev,
                values: { ...prev.values, feeRateOfGross: toNumber(value, prev.values.feeRateOfGross ?? settingsDraft.feeRateDefault) },
              } : prev)}
            />
            <Text>Fixkosten-VSt (EUR)</Text>
            <InputNumber
              value={monthModal.values.fixInputVat}
              min={0}
              step={10}
              onChange={(value) => setMonthModal((prev) => prev ? {
                ...prev,
                values: { ...prev.values, fixInputVat: toNumber(value, prev.values.fixInputVat ?? settingsDraft.fixInputDefault) },
              } : prev)}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={detailModal ? `${DETAIL_LABELS[detailModal.key] || detailModal.key} – ${detailModal.month}` : "Details"}
        open={Boolean(detailModal)}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={900}
      >
        {detailContent ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {detailContent.detail.formula ? <Text type="secondary">{detailContent.detail.formula}</Text> : null}
            {detailContent.detail.notes ? <Text type="secondary">{detailContent.detail.notes}</Text> : null}
            <div className="v2-stats-table-wrap">
              <table className="v2-stats-table">
                <thead>
                  <tr>
                    <th>Posten</th>
                    <th>Info</th>
                    <th>Datum</th>
                    <th>Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailContent.detail.items || []).map((item, index) => (
                    <tr key={`${detailModal?.month}-${detailModal?.key}-${index}`}>
                      <td>{item.label || "—"}</td>
                      <td>{item.sublabel || "—"}</td>
                      <td>{item.date || "—"}</td>
                      <td>{formatCurrency(item.amount || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Tag color="blue">Summe: {formatCurrency(detailContent.detail.total || 0)}</Tag>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
