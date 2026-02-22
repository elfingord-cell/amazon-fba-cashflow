import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { expandFixcostInstances } from "../../../domain/cashflow.js";
import { randomId } from "../../domain/orderUtils";
import { StatsTableShell } from "../../components/StatsTableShell";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

const CATEGORY_OPTIONS = [
  "Lizenz",
  "Steuerberatung",
  "Versicherung",
  "Miete",
  "Tools",
  "Sonstiges",
];

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "monatlich" },
  { value: "quarterly", label: "vierteljaehrlich" },
  { value: "semiannual", label: "halbjaehrlich" },
  { value: "annual", label: "jaehrlich" },
  { value: "custom", label: "benutzerdefiniert" },
];

const ANCHOR_OPTIONS = [
  { value: "1", label: "1." },
  { value: "15", label: "15." },
  { value: "LAST", label: "Letzter Tag" },
];

const PRORATION_OPTIONS = [
  { value: "daily", label: "tagesgenau" },
  { value: "none", label: "keine Proration" },
];

interface FixcostDraft {
  id: string;
  name: string;
  category: string;
  amount: string;
  frequency: string;
  intervalMonths: number;
  anchor: string;
  startMonth: string;
  endMonth: string;
  proration: {
    enabled: boolean;
    method: string;
  };
  autoPaid: boolean;
  notes: string;
}

interface FixcostInstance {
  id: string;
  month: string;
  amount: number;
  label: string;
  category: string;
  dueDateIso: string | null;
  fixedCostId: string;
  autoPaid: boolean;
  paid: boolean;
  autoSuppressed: boolean;
  autoTooltip: string | null;
  overrideActive: boolean;
  override: {
    amount?: string;
    dueDate?: string;
    note?: string;
  };
}

interface OverrideEditorState {
  instanceId: string;
  fixedCostId: string;
  month: string;
  amount: string;
  dueDate: string;
  note: string;
}

function parseCurrency(value: unknown): number {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatCurrencyInput(value: unknown): string {
  const num = parseCurrency(value);
  return num.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function formatDate(value: string | null | undefined): string {
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

function monthLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return ym;
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function normalizeMonth(value: unknown): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return "";
}

function normalizeDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";
  const day = String(Number(match[1])).padStart(2, "0");
  const month = String(Number(match[2])).padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function normalizeFixcosts(input: unknown[], fallbackStartMonth: string): FixcostDraft[] {
  return (Array.isArray(input) ? input : [])
    .map((entry) => {
      const row = (entry || {}) as Record<string, unknown>;
      return {
        id: String(row.id || randomId("fix")),
        name: String(row.name || "Neue Fixkosten"),
        category: String(row.category || "Sonstiges"),
        amount: formatCurrencyInput(row.amount || 0),
        frequency: String(row.frequency || "monthly"),
        intervalMonths: Math.max(1, Number(row.intervalMonths || 1)),
        anchor: String(row.anchor || "LAST"),
        startMonth: normalizeMonth(row.startMonth) || fallbackStartMonth,
        endMonth: normalizeMonth(row.endMonth),
        proration: {
          enabled: row?.proration && typeof row.proration === "object" ? (row.proration as Record<string, unknown>).enabled === true : false,
          method: row?.proration && typeof row.proration === "object"
            ? String((row.proration as Record<string, unknown>).method || "none")
            : "none",
        },
        autoPaid: row.autoPaid === true,
        notes: String(row.notes || ""),
      } satisfies FixcostDraft;
    });
}

function validateFixcost(row: FixcostDraft): string[] {
  const errors: string[] = [];
  if (!row.name.trim()) errors.push("name");
  if (!(parseCurrency(row.amount) > 0)) errors.push("amount");
  if (row.startMonth && row.endMonth && row.startMonth > row.endMonth) errors.push("range");
  if (row.anchor && row.anchor !== "LAST" && !/^\d+$/.test(String(row.anchor))) errors.push("anchor");
  return errors;
}

function cloneEvents(input: unknown): Record<string, Record<string, unknown>> {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce((acc, [id, value]) => {
    if (!value || typeof value !== "object") return acc;
    acc[id] = { ...(value as Record<string, unknown>) };
    return acc;
  }, {} as Record<string, Record<string, unknown>>);
}

function cloneOverrides(input: unknown): Record<string, Record<string, Record<string, unknown>>> {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce((acc, [fixedCostId, monthMap]) => {
    if (!monthMap || typeof monthMap !== "object") return acc;
    acc[fixedCostId] = Object.entries(monthMap as Record<string, unknown>).reduce((inner, [month, override]) => {
      if (!override || typeof override !== "object") return inner;
      inner[month] = { ...(override as Record<string, unknown>) };
      return inner;
    }, {} as Record<string, Record<string, unknown>>);
    return acc;
  }, {} as Record<string, Record<string, Record<string, unknown>>>);
}

export default function FixcostsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [draftRows, setDraftRows] = useState<FixcostDraft[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, Record<string, Record<string, unknown>>>>({});
  const [draftEvents, setDraftEvents] = useState<Record<string, Record<string, unknown>>>({});
  const [autoManualCheck, setAutoManualCheck] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [overrideEditor, setOverrideEditor] = useState<OverrideEditorState | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<string[]>([]);

  const stateObj = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const defaultStartMonth = normalizeMonth(settings.startMonth) || new Date().toISOString().slice(0, 7);

  useEffect(() => {
    setDraftRows(normalizeFixcosts((Array.isArray(state.fixcosts) ? state.fixcosts : []), defaultStartMonth));
    setDraftOverrides(cloneOverrides(state.fixcostOverrides));
    const status = (state.status && typeof state.status === "object") ? state.status as Record<string, unknown> : {};
    setAutoManualCheck(status.autoManualCheck === true);
    setDraftEvents(cloneEvents(status.events));
    setDirty(false);
  }, [defaultStartMonth, state.fixcostOverrides, state.fixcosts, state.status]);

  const expandedInstances = useMemo(() => {
    const virtualState = {
      ...stateObj,
      fixcosts: draftRows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        amount: row.amount,
        frequency: row.frequency,
        intervalMonths: row.intervalMonths,
        anchor: row.anchor,
        startMonth: row.startMonth,
        endMonth: row.endMonth || "",
        proration: { ...row.proration },
        autoPaid: row.autoPaid,
        notes: row.notes,
      })),
      fixcostOverrides: draftOverrides,
      status: {
        ...(stateObj.status && typeof stateObj.status === "object" ? stateObj.status : {}),
        autoManualCheck,
        events: draftEvents,
      },
    };
    return (expandFixcostInstances(virtualState, {
      statusEvents: draftEvents,
      autoManualCheck,
      today: new Date(),
    }) as unknown as FixcostInstance[]);
  }, [autoManualCheck, draftEvents, draftOverrides, draftRows, stateObj]);

  const groupedByMonth = useMemo(() => {
    const map = new Map<string, FixcostInstance[]>();
    expandedInstances.forEach((instance) => {
      if (!map.has(instance.month)) map.set(instance.month, []);
      map.get(instance.month)?.push(instance);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, list]) => {
        const total = list.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const paid = list.reduce((sum, row) => sum + (row.paid ? Number(row.amount || 0) : 0), 0);
        return {
          month,
          items: list,
          total,
          paid,
          open: Math.max(0, total - paid),
        };
      });
  }, [expandedInstances]);

  useEffect(() => {
    setExpandedMonths((current) => current.filter((month) => groupedByMonth.some((group) => group.month === month)));
  }, [groupedByMonth]);

  const hasValidationErrors = useMemo(
    () => draftRows.some((row) => validateFixcost(row).length > 0),
    [draftRows],
  );

  const dirtyLabel = hasValidationErrors ? "Validierungsfehler" : (dirty ? "Ungespeicherte Aenderungen" : "Synchron");
  const dirtyColor = hasValidationErrors ? "red" : (dirty ? "gold" : "green");

  async function saveAll(): Promise<void> {
    if (hasValidationErrors) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      next.fixcosts = draftRows.map((row) => ({
        id: row.id,
        name: row.name.trim() || "Fixkosten",
        category: row.category,
        amount: formatCurrencyInput(row.amount),
        frequency: row.frequency,
        intervalMonths: Math.max(1, Number(row.intervalMonths || 1)),
        anchor: row.anchor || "LAST",
        startMonth: normalizeMonth(row.startMonth) || defaultStartMonth,
        endMonth: normalizeMonth(row.endMonth),
        proration: {
          enabled: row.proration.enabled === true,
          method: row.proration.enabled ? row.proration.method : "none",
        },
        autoPaid: row.autoPaid === true,
        notes: row.notes,
      }));
      next.fixcostOverrides = draftOverrides;
      if (!next.status || typeof next.status !== "object") {
        next.status = { autoManualCheck: false, events: {} };
      }
      const status = next.status as Record<string, unknown>;
      status.autoManualCheck = autoManualCheck;
      status.events = draftEvents;
      next.status = status;
      return next;
    }, "v2:fixcosts:save");
    setDirty(false);
  }

  function updateRow(id: string, updater: (current: FixcostDraft) => FixcostDraft): void {
    setDraftRows((prev) => prev.map((row) => (row.id === id ? updater(row) : row)));
    setDirty(true);
  }

  function duplicateRow(id: string): void {
    setDraftRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const current = prev[index];
      const clone: FixcostDraft = {
        ...current,
        id: randomId("fix"),
        name: `${current.name || "Fixkosten"} (Kopie)`,
      };
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
    });
    setDirty(true);
  }

  function removeRow(id: string): void {
    setDraftRows((prev) => prev.filter((row) => row.id !== id));
    setDraftOverrides((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      return next;
    });
    setDirty(true);
  }

  function addRow(): void {
    setDraftRows((prev) => [...prev, {
      id: randomId("fix"),
      name: "Neue Fixkosten",
      category: "Sonstiges",
      amount: "1.000,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "LAST",
      startMonth: defaultStartMonth,
      endMonth: "",
      proration: { enabled: false, method: "none" },
      autoPaid: false,
      notes: "",
    }]);
    setDirty(true);
  }

  function setBulkManual(ids: string[], manual: boolean): void {
    if (!ids.length) return;
    setDraftEvents((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (!next[id]) next[id] = {};
        next[id] = { ...(next[id] || {}), manual };
      });
      return next;
    });
    setDirty(true);
  }

  function clearManual(eventId: string): void {
    setDraftEvents((prev) => {
      const next = { ...prev };
      if (!next[eventId]) return prev;
      const record = { ...next[eventId] };
      delete record.manual;
      if (!Object.keys(record).length) delete next[eventId];
      else next[eventId] = record;
      return next;
    });
    setDirty(true);
  }

  function togglePaid(instance: FixcostInstance, checked: boolean): void {
    const duePast = instance.dueDateIso ? new Date(`${instance.dueDateIso}T00:00:00Z`).getTime() <= Date.now() : false;
    const autoEligible = instance.autoPaid === true && !autoManualCheck;
    const autoDefault = autoEligible && duePast;
    if (autoEligible && checked === autoDefault) {
      clearManual(instance.id);
      return;
    }
    setBulkManual([instance.id], checked);
  }

  function openOverrideEditor(instance: FixcostInstance): void {
    setOverrideEditor({
      instanceId: instance.id,
      fixedCostId: instance.fixedCostId,
      month: instance.month,
      amount: instance.override?.amount && String(instance.override.amount).trim()
        ? String(instance.override.amount)
        : formatCurrencyInput(instance.amount),
      dueDate: normalizeDate(instance.override?.dueDate || instance.dueDateIso || ""),
      note: String(instance.override?.note || ""),
    });
  }

  function resetOverride(instance: FixcostInstance): void {
    setDraftOverrides((prev) => {
      const next = cloneOverrides(prev);
      if (!next[instance.fixedCostId]?.[instance.month]) return prev;
      delete next[instance.fixedCostId][instance.month];
      if (!Object.keys(next[instance.fixedCostId]).length) {
        delete next[instance.fixedCostId];
      }
      return next;
    });
    setDirty(true);
  }

  function saveOverride(): void {
    if (!overrideEditor) return;
    const parsedAmount = parseCurrency(overrideEditor.amount);
    if (!(parsedAmount > 0)) {
      Modal.error({
        title: "Override ungueltig",
        content: "Bitte Betrag > 0 eingeben.",
      });
      return;
    }
    const dueDate = overrideEditor.dueDate ? normalizeDate(overrideEditor.dueDate) : "";
    if (overrideEditor.dueDate && !dueDate) {
      Modal.error({
        title: "Override ungueltig",
        content: "Bitte ein gueltiges Datum eingeben.",
      });
      return;
    }
    setDraftOverrides((prev) => {
      const next = cloneOverrides(prev);
      if (!next[overrideEditor.fixedCostId]) next[overrideEditor.fixedCostId] = {};
      next[overrideEditor.fixedCostId][overrideEditor.month] = {
        amount: formatCurrencyInput(parsedAmount),
        dueDate: dueDate || "",
        note: overrideEditor.note.trim(),
      };
      return next;
    });
    setDirty(true);
    setOverrideEditor(null);
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Fixkosten</Title>
            <Paragraph>
              Stammdaten, monatliche Instanzen, Overrides und Paid-Logik für den Monatsabschluss.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => { void saveAll(); }} disabled={!dirty || hasValidationErrors} loading={saving}>
              Fixkosten speichern
            </Button>
            <Button
              onClick={() => {
                setDraftRows(normalizeFixcosts((Array.isArray(state.fixcosts) ? state.fixcosts : []), defaultStartMonth));
                setDraftOverrides(cloneOverrides(state.fixcostOverrides));
                const status = (state.status && typeof state.status === "object") ? state.status as Record<string, unknown> : {};
                setAutoManualCheck(status.autoManualCheck === true);
                setDraftEvents(cloneEvents(status.events));
                setDirty(false);
              }}
            >
              Verwerfen
            </Button>
            <Tag color={dirtyColor}>{dirtyLabel}</Tag>
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space>
            <Title level={5} style={{ margin: 0 }}>Fixkosten Stammdaten</Title>
            <Checkbox
              checked={autoManualCheck}
              onChange={(event) => {
                setAutoManualCheck(event.target.checked);
                setDirty(true);
              }}
            >
              Manuelle Pruefung fuer Auto-Paid
            </Checkbox>
          </Space>
          <Button onClick={addRow}>Position hinzufuegen</Button>
        </Space>

        <StatsTableShell>
          <table className="v2-stats-table v2-fixcost-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kategorie</th>
                <th>Betrag</th>
                <th>Frequenz</th>
                <th>Anker</th>
                <th>Start</th>
                <th>Ende</th>
                <th>Proration</th>
                <th>Auto Paid</th>
                <th>Notiz</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draftRows.map((row) => {
                const errors = validateFixcost(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <Input
                        status={errors.includes("name") ? "error" : ""}
                        value={row.name}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, name: event.target.value }))}
                      />
                    </td>
                    <td>
                      <Select
                        value={row.category}
                        options={CATEGORY_OPTIONS.map((value) => ({ value, label: value }))}
                        onChange={(value) => updateRow(row.id, (current) => ({ ...current, category: value }))}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <Input
                        status={errors.includes("amount") ? "error" : ""}
                        value={row.amount}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, amount: event.target.value }))}
                        onBlur={() => updateRow(row.id, (current) => ({ ...current, amount: formatCurrencyInput(current.amount) }))}
                      />
                    </td>
                    <td>
                      <Space direction="vertical" size={4}>
                        <Select
                          value={row.frequency}
                          options={FREQUENCY_OPTIONS}
                          onChange={(value) => updateRow(row.id, (current) => ({ ...current, frequency: value }))}
                          style={{ width: "100%" }}
                        />
                        {row.frequency === "custom" ? (
                          <InputNumber
                            value={row.intervalMonths}
                            min={1}
                            onChange={(value) => updateRow(row.id, (current) => ({
                              ...current,
                              intervalMonths: Math.max(1, Number(value || 1)),
                            }))}
                            style={{ width: "100%" }}
                          />
                        ) : null}
                      </Space>
                    </td>
                    <td>
                      <Select
                        value={row.anchor}
                        options={ANCHOR_OPTIONS}
                        onChange={(value) => updateRow(row.id, (current) => ({ ...current, anchor: value }))}
                        status={errors.includes("anchor") ? "error" : ""}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <Input
                        type="month"
                        value={row.startMonth}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, startMonth: normalizeMonth(event.target.value) }))}
                      />
                    </td>
                    <td>
                      <Input
                        type="month"
                        value={row.endMonth}
                        status={errors.includes("range") ? "error" : ""}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, endMonth: normalizeMonth(event.target.value) }))}
                      />
                    </td>
                    <td>
                      <Space direction="vertical" size={4}>
                        <Checkbox
                          checked={row.proration.enabled}
                          onChange={(event) => updateRow(row.id, (current) => ({
                            ...current,
                            proration: {
                              enabled: event.target.checked,
                              method: event.target.checked ? current.proration.method : "none",
                            },
                          }))}
                        >
                          anteilig
                        </Checkbox>
                        {row.proration.enabled ? (
                          <Select
                            value={row.proration.method}
                            options={PRORATION_OPTIONS}
                            onChange={(value) => updateRow(row.id, (current) => ({
                              ...current,
                              proration: { ...current.proration, method: value },
                            }))}
                            style={{ width: "100%" }}
                          />
                        ) : null}
                      </Space>
                    </td>
                    <td>
                      <Checkbox
                        checked={row.autoPaid}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, autoPaid: event.target.checked }))}
                      />
                    </td>
                    <td>
                      <Input
                        value={row.notes}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, notes: event.target.value }))}
                      />
                    </td>
                    <td>
                      <div className="v2-actions-nowrap">
                        <Button size="small" onClick={() => duplicateRow(row.id)}>Duplizieren</Button>
                        <Button size="small" danger onClick={() => removeRow(row.id)}>X</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }} wrap>
          <Title level={5} style={{ margin: 0 }}>Fixkosten je Monat</Title>
          <div className="v2-actions-inline">
            <Button
              size="small"
              onClick={() => setExpandedMonths(groupedByMonth.map((group) => group.month))}
              disabled={!groupedByMonth.length}
            >
              Alles auf
            </Button>
            <Button
              size="small"
              onClick={() => setExpandedMonths([])}
              disabled={!expandedMonths.length}
            >
              Alles zu
            </Button>
          </div>
        </Space>
        {!groupedByMonth.length ? (
          <Text type="secondary">Keine Instanzen im Planungshorizont.</Text>
        ) : (
          <Collapse
            activeKey={expandedMonths}
            onChange={(nextKeys) => setExpandedMonths((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
            items={groupedByMonth.map((group) => ({
              key: group.month,
              label: (
                <Space>
                  <Text strong>{monthLabel(group.month)}</Text>
                  <Tag color="default">Total: {formatCurrency(group.total)}</Tag>
                  <Tag color="green">Bezahlt: {formatCurrency(group.paid)}</Tag>
                  <Tag color="orange">Offen: {formatCurrency(group.open)}</Tag>
                </Space>
              ),
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space>
                    <Button
                      size="small"
                      onClick={() => {
                        const targets = group.items.filter((item) => !item.paid).map((item) => item.id);
                        setBulkManual(targets, true);
                      }}
                    >
                      Alle offenen bestaetigen
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        const targets = group.items.filter((item) => item.autoPaid).map((item) => item.id);
                        setBulkManual(targets, false);
                      }}
                    >
                      Auto-Markierung ignorieren
                    </Button>
                  </Space>
                  <StatsTableShell>
                    <table className="v2-stats-table">
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Kategorie</th>
                          <th>Betrag</th>
                          <th>Faelligkeit</th>
                          <th>Bezahlt</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <Space direction="vertical" size={0}>
                                <Space>
                                  <Text>{item.label}</Text>
                                  {item.autoPaid ? <Tag color="cyan">Auto</Tag> : null}
                                  {item.overrideActive ? <Tag color="purple">Override</Tag> : null}
                                  {item.autoSuppressed ? <Tag color="gold">Manuelle Pruefung</Tag> : null}
                                </Space>
                                {item.override?.note ? (
                                  <Text type="secondary">{String(item.override.note)}</Text>
                                ) : null}
                              </Space>
                            </td>
                            <td>{item.category || "Sonstiges"}</td>
                            <td>{formatCurrency(item.amount)}</td>
                            <td>{formatDate(item.dueDateIso)}</td>
                            <td>
                              <Checkbox
                                checked={item.paid}
                                onChange={(event) => togglePaid(item, event.target.checked)}
                              />
                            </td>
                            <td>
                              <div className="v2-actions-nowrap">
                                <Button size="small" onClick={() => openOverrideEditor(item)}>Override</Button>
                                {item.overrideActive ? (
                                  <Button size="small" onClick={() => resetOverride(item)}>Reset</Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </StatsTableShell>
                </Space>
              ),
            }))}
          />
        )}
      </Card>

      <Modal
        title="Override bearbeiten"
        open={Boolean(overrideEditor)}
        onCancel={() => setOverrideEditor(null)}
        onOk={saveOverride}
      >
        {overrideEditor ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text>Betrag (EUR)</Text>
            <Input
              value={overrideEditor.amount}
              onChange={(event) => setOverrideEditor((prev) => (prev ? { ...prev, amount: event.target.value } : prev))}
            />
            <Text>Faelligkeit (YYYY-MM-DD)</Text>
            <Input
              type="date"
              value={overrideEditor.dueDate}
              onChange={(event) => setOverrideEditor((prev) => (prev ? { ...prev, dueDate: event.target.value } : prev))}
            />
            <Text>Notiz</Text>
            <Input
              value={overrideEditor.note}
              onChange={(event) => setOverrideEditor((prev) => (prev ? { ...prev, note: event.target.value } : prev))}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
