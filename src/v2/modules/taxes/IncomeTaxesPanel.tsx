import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  createDefaultTaxesState,
  expandTaxInstances,
  getTaxTypeLabel,
  normalizeTaxesState,
  TAX_TYPE_CONFIG,
} from "../../../domain/taxPlanner.js";
import { StatsTableShell } from "../../components/StatsTableShell";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface TaxMasterDraft {
  active: boolean;
  amount: string;
  firstDueDate: string;
  pauseFromMonth: string;
  endMonth: string;
  note: string;
}

interface TaxOverrideDraft {
  active?: boolean;
  amount: string;
  dueDate: string;
  note: string;
}

interface OverrideEditorState {
  taxType: string;
  month: string;
  values: TaxOverrideDraft;
}

function emptyOverrideDraft(baseActive = true): TaxOverrideDraft {
  return {
    active: baseActive,
    amount: "",
    dueDate: "",
    note: "",
  };
}

function cloneTaxDraft(state: Record<string, unknown>) {
  return structuredClone(normalizeTaxesState(state.taxes));
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function formatMonthLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return ym;
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

export default function IncomeTaxesPanel(): JSX.Element {
  const { state, error, loading, lastSavedAt, saveWith, saving } = useWorkspaceState();
  const [draft, setDraft] = useState(() => cloneTaxDraft(state as unknown as Record<string, unknown>));
  const [dirty, setDirty] = useState(false);
  const [overrideEditor, setOverrideEditor] = useState<OverrideEditorState | null>(null);

  const stateObject = state as unknown as Record<string, unknown>;

  useEffect(() => {
    setDraft(cloneTaxDraft(stateObject));
    setDirty(false);
  }, [state.taxes, stateObject]);

  const previewInstances = useMemo(() => {
    const virtualState = {
      ...stateObject,
      taxes: draft,
    };
    return expandTaxInstances(virtualState, { today: new Date() });
  }, [draft, stateObject]);

  const instancesByType = useMemo(() => {
    return TAX_TYPE_CONFIG.reduce((acc, entry) => {
      acc[entry.key] = previewInstances.filter((instance) => instance.taxType === entry.key);
      return acc;
    }, {} as Record<string, Array<Record<string, unknown>>>);
  }, [previewInstances]);

  function updateMaster(taxType: string, updater: (current: TaxMasterDraft) => TaxMasterDraft): void {
    setDraft((current) => {
      const next = structuredClone(current);
      const masters = next.ertragsteuern.masters as Record<string, TaxMasterDraft>;
      masters[taxType] = updater(masters[taxType] || { ...createDefaultTaxesState().ertragsteuern.masters[taxType] });
      return next;
    });
    setDirty(true);
  }

  async function saveDraft(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      next.taxes = structuredClone(draft);
      return next;
    }, "v2:taxes:save");
    setDirty(false);
  }

  function openOverrideEditor(taxType: string, month: string): void {
    const overrideMap = draft.ertragsteuern.overrides as Record<string, Record<string, TaxOverrideDraft>>;
    const master = (draft.ertragsteuern.masters as Record<string, TaxMasterDraft>)[taxType];
    setOverrideEditor({
      taxType,
      month,
      values: {
        ...emptyOverrideDraft(master?.active !== false),
        ...(overrideMap[taxType]?.[month] || {}),
      },
    });
  }

  function saveOverride(): void {
    if (!overrideEditor) return;
    setDraft((current) => {
      const next = structuredClone(current);
      const overrides = next.ertragsteuern.overrides as Record<string, Record<string, TaxOverrideDraft>>;
      if (!overrides[overrideEditor.taxType]) overrides[overrideEditor.taxType] = {};
      overrides[overrideEditor.taxType][overrideEditor.month] = {
        active: overrideEditor.values.active,
        amount: overrideEditor.values.amount || "",
        dueDate: overrideEditor.values.dueDate || "",
        note: overrideEditor.values.note || "",
      };
      return next;
    });
    setDirty(true);
    setOverrideEditor(null);
  }

  function resetOverride(taxType: string, month: string): void {
    setDraft((current) => {
      const next = structuredClone(current);
      const overrides = next.ertragsteuern.overrides as Record<string, Record<string, TaxOverrideDraft>>;
      if (overrides[taxType]) {
        delete overrides[taxType][month];
      }
      return next;
    });
    setDirty(true);
  }

  return (
    <div className="v2-page">
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      {loading ? <Alert type="info" showIcon message="Steuern werden geladen..." style={{ marginBottom: 12 }} /> : null}

      <Card className="v2-intro-card" style={{ marginBottom: 12 }}>
        <div className="v2-page-head">
          <div>
            <Title level={4}>Ertragsteuern</Title>
            <Paragraph>
              Quartalsweise Cashflow-Planung für Körperschaftsteuer und Gewerbesteuer mit Monatsinstanzen und Overrides.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar-row">
          <Button type="primary" onClick={() => { void saveDraft(); }} disabled={!dirty} loading={saving}>
            Ertragsteuern speichern
          </Button>
          {dirty ? <Tag color="gold">Ungespeicherte Änderungen</Tag> : <Tag color="green">Synchron</Tag>}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </div>
      </Card>

      {TAX_TYPE_CONFIG.map((taxType) => {
        const master = (draft.ertragsteuern.masters as Record<string, TaxMasterDraft>)[taxType.key];
        const instances = instancesByType[taxType.key] || [];
        const overrides = ((draft.ertragsteuern.overrides as Record<string, Record<string, TaxOverrideDraft>>)[taxType.key]) || {};
        return (
          <Card key={taxType.key} style={{ marginBottom: 12 }}>
            <div className="v2-page-head">
              <div>
                <Title level={5}>{taxType.label}</Title>
                <Paragraph>
                  Wiederkehrende Quartalszahlung mit optionalem Pause-/Endfenster. Die Monatsinstanzen fließen cashflow-basiert in das Dashboard.
                </Paragraph>
              </div>
              <Space wrap>
                <Tag color={master?.active ? "green" : "default"}>{master?.active ? "Aktiv" : "Inaktiv"}</Tag>
                <Tag>Quartalsweise</Tag>
              </Space>
            </div>

            <div className="v2-stats-table-wrap" style={{ marginBottom: 12 }}>
              <table className="v2-stats-table" data-layout="auto">
                <thead>
                  <tr>
                    <th>Aktiv</th>
                    <th>Betrag je Rate</th>
                    <th>Erste Fälligkeit</th>
                    <th>Pause ab</th>
                    <th>Ende</th>
                    <th>Notiz</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Checkbox
                        checked={master?.active === true}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, active: event.target.checked }))}
                      />
                    </td>
                    <td>
                      <Input
                        value={master?.amount || ""}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, amount: event.target.value }))}
                        placeholder="z. B. 2.500,00"
                      />
                    </td>
                    <td>
                      <Input
                        type="date"
                        value={master?.firstDueDate || ""}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, firstDueDate: event.target.value }))}
                      />
                    </td>
                    <td>
                      <Input
                        type="month"
                        value={master?.pauseFromMonth || ""}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, pauseFromMonth: event.target.value }))}
                      />
                    </td>
                    <td>
                      <Input
                        type="month"
                        value={master?.endMonth || ""}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, endMonth: event.target.value }))}
                      />
                    </td>
                    <td>
                      <Input
                        value={master?.note || ""}
                        onChange={(event) => updateMaster(taxType.key, (current) => ({ ...current, note: event.target.value }))}
                        placeholder="Optional"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Text type="secondary">Monatsinstanzen und Override-Support</Text>
            <StatsTableShell>
              <table className="v2-stats-table" data-layout="auto">
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th>Fällig</th>
                    <th>Betrag</th>
                    <th>Notiz</th>
                    <th>Override</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.length ? instances.map((instance) => (
                    <tr key={String(instance.id)}>
                      <td>{formatMonthLabel(String(instance.month || ""))}</td>
                      <td>{formatDate(String(instance.dueDateIso || ""))}</td>
                      <td>{formatCurrency(instance.amount)}</td>
                      <td>{String(instance.note || "—") || "—"}</td>
                      <td>{instance.overrideActive ? <Tag color="blue">Aktiv</Tag> : "—"}</td>
                      <td>
                        <Space wrap>
                          <Button size="small" onClick={() => openOverrideEditor(taxType.key, String(instance.month || ""))}>
                            Override
                          </Button>
                          {overrides[String(instance.month || "")] ? (
                            <Button size="small" onClick={() => resetOverride(taxType.key, String(instance.month || ""))}>
                              Reset
                            </Button>
                          ) : null}
                        </Space>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6}>
                        Noch keine Quartalsinstanzen. Aktiviere {taxType.label} und setze eine erste Fälligkeit.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </StatsTableShell>
          </Card>
        );
      })}

      <Modal
        title={overrideEditor ? `${getTaxTypeLabel(overrideEditor.taxType)} · Override ${formatMonthLabel(overrideEditor.month)}` : "Override"}
        open={Boolean(overrideEditor)}
        onCancel={() => setOverrideEditor(null)}
        onOk={saveOverride}
        destroyOnClose
      >
        {overrideEditor ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Checkbox
              checked={overrideEditor.values.active !== false}
              onChange={(event) => setOverrideEditor((current) => current ? {
                ...current,
                values: { ...current.values, active: event.target.checked },
              } : current)}
            >
              Instanz aktiv
            </Checkbox>
            <div>
              <Text>Betrag</Text>
              <Input
                value={overrideEditor.values.amount}
                onChange={(event) => setOverrideEditor((current) => current ? {
                  ...current,
                  values: { ...current.values, amount: event.target.value },
                } : current)}
                placeholder="leer = Stammbetrag"
              />
            </div>
            <div>
              <Text>Fälligkeit</Text>
              <Input
                type="date"
                value={overrideEditor.values.dueDate}
                onChange={(event) => setOverrideEditor((current) => current ? {
                  ...current,
                  values: { ...current.values, dueDate: event.target.value },
                } : current)}
              />
            </div>
            <div>
              <Text>Notiz</Text>
              <Input
                value={overrideEditor.values.note}
                onChange={(event) => setOverrideEditor((current) => current ? {
                  ...current,
                  values: { ...current.values, note: event.target.value },
                } : current)}
                placeholder="Optional"
              />
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
