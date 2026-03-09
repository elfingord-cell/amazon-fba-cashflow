import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Grid,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Tabs,
  Typography,
  message,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { currentMonthKey, formatMonthLabel, monthRange } from "../../domain/months";
import {
  DEFAULT_SUPPLIER_OUTLOOK_HORIZON,
  addSupplierOutlookManualRow,
  buildSupplierOutlookDraft,
  buildSupplierOutlookExportModel,
  collectSupplierOutlookSkuOptions,
  duplicateSupplierOutlookRecord,
  freezeSupplierOutlookRecord,
  markSupplierOutlookRecordExported,
  normalizeSupplierOutlookRecord,
  normalizeSupplierOutlooks,
  removeSupplierOutlookRow,
  resetSupplierOutlookCell,
  resetSupplierOutlookRow,
  resolveSupplierFacingCellStatus,
  setSupplierOutlookRowExcluded,
  supplierOutlookHash,
  updateSupplierOutlookCell,
  updateSupplierOutlookRowMeta,
  upsertSupplierOutlookRecordInState,
  type SupplierOutlookActor,
  type SupplierOutlookExportModel,
  type SupplierOutlookTraceRow,
} from "../../domain/supplierOutlook";
import type { SupplierOutlookRecord, SupplierOutlookRow, SupplierOutlookSourceType } from "../../state/types";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { buildSupplierOutlookWorkbookBlob } from "../../../domain/supplierOutlookWorkbook.js";
import { openSupplierOutlookPrintView } from "../../../domain/supplierOutlookPrint.js";
import { triggerBlobDownload } from "../../../domain/accountantBundle.js";

const { Paragraph, Text, Title } = Typography;

const SOURCE_OPTIONS = [
  { value: "po", label: "PO" },
  { value: "fo", label: "FO" },
  { value: "pfo", label: "PFO (indikativ)" },
] satisfies Array<{ value: SupplierOutlookSourceType; label: string }>;

const HORIZON_OPTIONS = [6, 12, 18];

interface ConflictBannerState {
  reason: string;
}

function formatInt(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return Math.round(parsed).toLocaleString("de-DE");
}

function formatTimestamp(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeFileToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "supplier-outlook";
}

function draftStatusTag(status: string): JSX.Element {
  return status === "frozen"
    ? <Tag color="blue">Eingefroren</Tag>
    : <Tag color="green">Entwurf</Tag>;
}

function exportStatusTag(record: SupplierOutlookRecord): JSX.Element | null {
  if (!record.lastExportedAt || !record.lastExportFormat) return null;
  return (
    <Tag color="purple">
      Exportiert: {record.lastExportFormat.toUpperCase()} · {formatTimestamp(record.lastExportedAt)}
    </Tag>
  );
}

function supplierStatusTone(status: string): string {
  if (status === "confirmed") return "#1d7f5c";
  if (status === "indicative") return "#9c6a00";
  return "#215ea8";
}

function selectDraftLabel(record: SupplierOutlookRecord, supplierName: string): string {
  const start = formatMonthLabel(record.startMonth);
  const status = record.status === "frozen" ? "Eingefroren" : "Entwurf";
  return `${supplierName} · ${start} · ${status}`;
}

function buildExportFileName(model: SupplierOutlookExportModel, extension: "xlsx" | "pdf"): string {
  return `lieferantenausblick_${sanitizeFileToken(model.supplierName)}_${model.startMonth}.${extension}`;
}

export default function SupplierOutlookView(): JSX.Element {
  const screens = Grid.useBreakpoint();
  const { state, loading, error, saving, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const stateObj = state as unknown as Record<string, unknown>;
  const supplierNameMap = useMemo(() => new Map(
    (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => [String(entry.id || ""), String(entry.name || entry.id || "Lieferant")]),
  ), [state.suppliers]);
  const displayNameMap = useMemo(() => {
    const settings = (state.settings && typeof state.settings === "object")
      ? state.settings as Record<string, unknown>
      : {};
    return readCollaborationDisplayNames(settings);
  }, [state.settings]);
  const actor = useMemo<SupplierOutlookActor>(() => ({
    userId: syncSession.userId,
    userLabel: resolveCollaborationUserLabel({
      userId: syncSession.userId,
      userEmail: syncSession.email,
    }, displayNameMap),
  }), [displayNameMap, syncSession.email, syncSession.userId]);

  const persistedOutlooks = useMemo(
    () => normalizeSupplierOutlooks((state as Record<string, unknown>).supplierOutlooks),
    [state],
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string>("");
  const [workingDraft, setWorkingDraft] = useState<SupplierOutlookRecord | null>(null);
  const [generationSupplierId, setGenerationSupplierId] = useState("");
  const [generationStartMonth, setGenerationStartMonth] = useState(currentMonthKey());
  const [generationHorizon, setGenerationHorizon] = useState(DEFAULT_SUPPLIER_OUTLOOK_HORIZON);
  const [generationSourceTypes, setGenerationSourceTypes] = useState<SupplierOutlookSourceType[]>(["po", "fo"]);
  const [generationSkuIds, setGenerationSkuIds] = useState<string[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [conflictBanner, setConflictBanner] = useState<ConflictBannerState | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef<string>("");

  const generationSkuOptions = useMemo(
    () => collectSupplierOutlookSkuOptions(stateObj, generationSupplierId),
    [generationSupplierId, stateObj],
  );
  const selectedPersistedDraft = useMemo(
    () => persistedOutlooks.find((entry) => entry.id === selectedDraftId) || null,
    [persistedOutlooks, selectedDraftId],
  );

  const activateDraft = useCallback((record: SupplierOutlookRecord | null) => {
    if (!record) {
      setSelectedDraftId("");
      setWorkingDraft(null);
      setSelectedRowId("");
      setSelectedMonth("");
      lastSavedHashRef.current = "";
      return;
    }
    setSelectedDraftId(record.id);
    setWorkingDraft(normalizeSupplierOutlookRecord(record));
    setSelectedRowId(record.rows[0]?.id || "");
    setSelectedMonth("");
    setGenerationSupplierId(record.supplierId);
    setGenerationStartMonth(record.startMonth);
    setGenerationHorizon(record.horizonMonths);
    setGenerationSourceTypes(record.includedSourceTypes.filter((entry) => entry !== "plan"));
    setGenerationSkuIds(record.includedSkuIds);
    setConflictBanner(null);
    lastSavedHashRef.current = supplierOutlookHash(record);
  }, []);

  useEffect(() => {
    if (selectedDraftId && selectedPersistedDraft) return;
    if (persistedOutlooks.length) {
      activateDraft(persistedOutlooks[0]);
      return;
    }
    if (!generationSupplierId) {
      const firstSupplier = (Array.isArray(state.suppliers) ? state.suppliers : [])[0] as Record<string, unknown> | undefined;
      if (firstSupplier?.id) {
        setGenerationSupplierId(String(firstSupplier.id));
      }
    }
  }, [activateDraft, generationSupplierId, persistedOutlooks, selectedDraftId, selectedPersistedDraft, state.suppliers]);

  useEffect(() => {
    if (!generationSupplierId) return;
    if (!generationSkuOptions.length) {
      setGenerationSkuIds([]);
      return;
    }
    setGenerationSkuIds((current) => {
      const validIds = new Set(generationSkuOptions.map((entry) => entry.id));
      const next = current.filter((entry) => validIds.has(entry));
      if (next.length) return next;
      return generationSkuOptions.map((entry) => entry.id);
    });
  }, [generationSkuOptions, generationSupplierId]);

  const workingDraftHash = useMemo(() => supplierOutlookHash(workingDraft), [workingDraft]);
  const isWorkingDirty = Boolean(workingDraft && workingDraftHash !== lastSavedHashRef.current);

  useEffect(() => {
    if (!selectedPersistedDraft || !workingDraft || workingDraft.id !== selectedPersistedDraft.id) return;
    if (conflictBanner) return;
    if (isWorkingDirty) return;
    const persistedHash = supplierOutlookHash(selectedPersistedDraft);
    if (persistedHash === workingDraftHash) return;
    setWorkingDraft(normalizeSupplierOutlookRecord(selectedPersistedDraft));
    lastSavedHashRef.current = persistedHash;
  }, [conflictBanner, isWorkingDirty, selectedPersistedDraft, workingDraft, workingDraftHash]);

  useEffect(() => {
    if (!workingDraft) return;
    if (!selectedRowId || !workingDraft.rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(workingDraft.rows[0]?.id || "");
      setSelectedMonth("");
    }
  }, [selectedRowId, workingDraft]);

  const persistDraft = useCallback(async (draft: SupplierOutlookRecord, source: string) => {
    const targetHash = supplierOutlookHash(draft);
    if (targetHash === lastSavedHashRef.current) return;
    await saveWith((current) => upsertSupplierOutlookRecordInState(current, draft), source);
    lastSavedHashRef.current = targetHash;
  }, [saveWith]);

  useEffect(() => {
    if (!workingDraft || workingDraft.status === "frozen" || conflictBanner) return;
    if (!isWorkingDirty) return;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDraft(workingDraft, "v2:supplier-outlook:auto").catch((persistError) => {
        setConflictBanner({
          reason: persistError instanceof Error ? persistError.message : "Autosave-Konflikt",
        });
      });
    }, 420);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [conflictBanner, isWorkingDirty, persistDraft, workingDraft]);

  const months = useMemo(
    () => workingDraft ? monthRange(workingDraft.startMonth, workingDraft.horizonMonths) : monthRange(generationStartMonth, generationHorizon),
    [generationHorizon, generationStartMonth, workingDraft],
  );
  const exportModel = useMemo(
    () => workingDraft ? buildSupplierOutlookExportModel({ record: workingDraft, state: stateObj }) : null,
    [stateObj, workingDraft],
  );
  const selectedRow = useMemo(
    () => workingDraft?.rows.find((row) => row.id === selectedRowId) || null,
    [selectedRowId, workingDraft],
  );
  const selectedCell = useMemo(
    () => (selectedRow && selectedMonth ? selectedRow.cells[selectedMonth] || null : null),
    [selectedMonth, selectedRow],
  );

  const applyDraftUpdate = useCallback((updater: (current: SupplierOutlookRecord) => SupplierOutlookRecord) => {
    setWorkingDraft((current) => current ? updater(current) : current);
  }, []);

  async function handleGenerateDraft(): Promise<void> {
    if (!generationSupplierId) {
      message.error("Bitte zuerst einen Lieferanten wählen.");
      return;
    }
    if (!generationSourceTypes.length) {
      message.error("Bitte mindestens eine Quelle aktivieren.");
      return;
    }
    if (!generationSkuIds.length) {
      message.error("Bitte mindestens eine SKU wählen.");
      return;
    }
    try {
      const nextDraft = buildSupplierOutlookDraft({
        state: stateObj,
        supplierId: generationSupplierId,
        startMonth: generationStartMonth,
        horizonMonths: generationHorizon,
        includedSkuIds: generationSkuIds,
        includedSourceTypes: generationSourceTypes,
        actor,
      });
      await persistDraft(nextDraft, "v2:supplier-outlook:generate");
      activateDraft(nextDraft);
      message.success("Neuer Lieferantenausblick erzeugt.");
    } catch (errorCreate) {
      message.error(errorCreate instanceof Error ? errorCreate.message : "Lieferantenausblick konnte nicht erzeugt werden.");
    }
  }

  async function handleDuplicateDraft(): Promise<void> {
    if (!workingDraft) return;
    try {
      const duplicate = duplicateSupplierOutlookRecord(workingDraft, actor);
      await persistDraft(duplicate, "v2:supplier-outlook:duplicate");
      activateDraft(duplicate);
      message.success("Entwurf dupliziert.");
    } catch (duplicateError) {
      message.error(duplicateError instanceof Error ? duplicateError.message : "Duplikat konnte nicht gespeichert werden.");
    }
  }

  async function handleFreezeDraft(): Promise<void> {
    if (!workingDraft || workingDraft.status === "frozen") return;
    try {
      const frozen = freezeSupplierOutlookRecord(workingDraft, actor);
      await persistDraft(frozen, "v2:supplier-outlook:freeze");
      activateDraft(frozen);
      message.success("Entwurf eingefroren.");
    } catch (freezeError) {
      message.error(freezeError instanceof Error ? freezeError.message : "Freeze fehlgeschlagen.");
    }
  }

  async function handleExportWorkbook(): Promise<void> {
    if (!exportModel || workingDraft?.status !== "frozen") return;
    try {
      const blob = await buildSupplierOutlookWorkbookBlob(exportModel);
      triggerBlobDownload(blob, buildExportFileName(exportModel, "xlsx"));
      const exportedRecord = markSupplierOutlookRecordExported(workingDraft, { format: "xlsx", actor });
      await persistDraft(exportedRecord, "v2:supplier-outlook:export:xlsx");
      activateDraft(exportedRecord);
      message.success("XLSX Export erstellt.");
    } catch (exportError) {
      message.error(exportError instanceof Error ? exportError.message : "XLSX Export fehlgeschlagen.");
    }
  }

  async function handleExportPrint(): Promise<void> {
    if (!exportModel || workingDraft?.status !== "frozen") return;
    const opened = openSupplierOutlookPrintView(exportModel);
    if (!opened) {
      message.error("Popup für PDF-Druckansicht konnte nicht geöffnet werden.");
      return;
    }
    try {
      const exportedRecord = markSupplierOutlookRecordExported(workingDraft, { format: "pdf", actor });
      await persistDraft(exportedRecord, "v2:supplier-outlook:export:pdf");
      activateDraft(exportedRecord);
      message.success("PDF-Druckansicht geöffnet.");
    } catch (exportError) {
      message.error(exportError instanceof Error ? exportError.message : "PDF Export-Metadaten konnten nicht gespeichert werden.");
    }
  }

  async function handleSaveConflictAsCopy(): Promise<void> {
    if (!workingDraft) return;
    try {
      const copy = duplicateSupplierOutlookRecord(workingDraft, actor);
      await persistDraft(copy, "v2:supplier-outlook:conflict-copy");
      activateDraft(copy);
      setConflictBanner(null);
      message.success("Lokale Änderungen als neuer Entwurf gespeichert.");
    } catch (copyError) {
      message.error(copyError instanceof Error ? copyError.message : "Kopie konnte nicht gespeichert werden.");
    }
  }

  function reloadLocalFromPersisted(): void {
    if (!selectedPersistedDraft) return;
    activateDraft(selectedPersistedDraft);
    setConflictBanner(null);
  }

  const matrixColumns = useMemo<ColumnDef<SupplierOutlookRow>[]>(() => {
    const base: ColumnDef<SupplierOutlookRow>[] = [{
      id: "label",
      header: "Produkt / Zeile",
      meta: { width: 250, minWidth: 220 },
      cell: ({ row }) => {
        const selected = row.original.id === selectedRowId && !selectedMonth;
        const label = row.original.rowType === "manual"
          ? (row.original.manualLabel || "Manuelle Zeile")
          : (row.original.alias || row.original.sku || "SKU");
        return (
          <button
            type="button"
            onClick={() => {
              setSelectedRowId(row.original.id);
              setSelectedMonth("");
            }}
            style={{
              width: "100%",
              textAlign: "left",
              border: selected ? "1px solid #2e7d6c" : "1px solid #d9e2ea",
              background: selected ? "#eef8f5" : "#fff",
              borderRadius: 10,
              padding: "10px 12px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600 }}>{label}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>
              {row.original.rowType === "manual"
                ? `Manuell${row.original.linkedSku ? ` · ${row.original.linkedSku}` : ""}`
                : (row.original.sku || "—")}
            </div>
          </button>
        );
      },
    }];

    months.forEach((month) => {
      base.push({
        id: month,
        header: formatMonthLabel(month),
        meta: { width: 155, minWidth: 150 },
        cell: ({ row }) => {
          const cell = row.original.cells[month];
          const selected = row.original.id === selectedRowId && month === selectedMonth;
          const supplierStatus = resolveSupplierFacingCellStatus(row.original, cell);
          const overridden = cell.finalQty !== cell.systemQty;
          const excluded = cell.excluded === true;
          return (
            <button
              type="button"
              onClick={() => {
                setSelectedRowId(row.original.id);
                setSelectedMonth(month);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                border: selected ? "1px solid #2e7d6c" : "1px solid #d9e2ea",
                background: selected ? "#eef8f5" : excluded ? "#fafafa" : "#fff",
                borderRadius: 10,
                padding: "10px 12px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{excluded ? "—" : formatInt(cell.finalQty)}</span>
                <span style={{ fontSize: 12, color: supplierStatusTone(supplierStatus) }}>{supplierStatus}</span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Sys {formatInt(cell.systemQty)}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {overridden ? <span style={{ fontSize: 11, color: "#215ea8" }}>Override</span> : null}
                {excluded ? <span style={{ fontSize: 11, color: "#8a6b00" }}>Ausgeschlossen</span> : null}
                {cell.sourceBreakdown.length ? <span style={{ fontSize: 11, color: "#64748b" }}>{cell.sourceBreakdown.length} Quelle(n)</span> : null}
              </div>
            </button>
          );
        },
      });
    });
    return base;
  }, [months, selectedMonth, selectedRowId]);

  const previewColumns = useMemo<ColumnDef<(SupplierOutlookExportModel["supplierRows"][number])>[]>(() => {
    const columns: ColumnDef<(SupplierOutlookExportModel["supplierRows"][number])>[] = [{
      id: "label",
      header: "Produkt",
      meta: { width: 240, minWidth: 220 },
      accessorFn: (row) => row.label,
    }];
    months.forEach((month) => {
      columns.push({
        id: month,
        header: formatMonthLabel(month),
        meta: { width: 140, minWidth: 135 },
        cell: ({ row }) => row.original.cells[month]?.text || "—",
      });
    });
    return columns;
  }, [months]);

  const traceColumns = useMemo<ColumnDef<SupplierOutlookTraceRow>[]>(() => [
    { header: "Produkt", accessorKey: "label", meta: { width: 220, minWidth: 200 } },
    { header: "SKU", accessorKey: "sku", meta: { width: 120 } },
    { header: "Monat", accessorKey: "monthLabel", meta: { width: 110 } },
    { header: "System", accessorKey: "systemQty", meta: { width: 90, align: "right" } },
    { header: "Final", accessorKey: "finalQty", meta: { width: 90, align: "right" } },
    { header: "Abweichung", accessorKey: "deviation", meta: { width: 100, align: "right" } },
    { header: "Status", accessorKey: "supplierStatus", meta: { width: 110 } },
    { header: "Quellen", accessorKey: "sourceSummary", meta: { width: 160, minWidth: 150 } },
    { header: "Zeitkontext", accessorKey: "timingSummary", meta: { width: 220, minWidth: 180 } },
    { header: "Notiz", accessorKey: "note", meta: { width: 180 } },
    { header: "Grund", accessorKey: "reason", meta: { width: 180 } },
  ], []);

  const toolbarActionsDisabled = !workingDraft || Boolean(conflictBanner);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Lieferantenausblick</Title>
            <Paragraph>
              Kommunikations-Layer für lieferantensichere Outlooks auf Basis bestehender PO-, FO- und optionaler PFO-Daten:
              Vorschlag erzeugen, im Entwurf prüfen, Snapshot einfrieren, eingefrorenen Stand exportieren.
            </Paragraph>
          </div>
          <Space wrap>
            {workingDraft ? draftStatusTag(workingDraft.status) : <Tag>Kein Entwurf</Tag>}
            {workingDraft ? exportStatusTag(workingDraft) : null}
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </Space>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <div className="v2-toolbar-field">
              <Text strong>Entwurf</Text>
              <Select
                allowClear
                value={selectedDraftId || undefined}
                placeholder="Entwurf wählen"
                options={persistedOutlooks.map((entry) => ({
                  value: entry.id,
                  label: selectDraftLabel(entry, supplierNameMap.get(entry.supplierId) || entry.supplierId || "Lieferant"),
                }))}
                onChange={(value) => {
                  const next = persistedOutlooks.find((entry) => entry.id === value) || null;
                  activateDraft(next);
                }}
                style={{ width: 320, maxWidth: "100%" }}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text strong>Lieferant</Text>
              <Select
                value={generationSupplierId || undefined}
                onChange={(value) => setGenerationSupplierId(value)}
                options={(Array.isArray(state.suppliers) ? state.suppliers : [])
                  .map((entry) => entry as Record<string, unknown>)
                  .map((entry) => ({ value: String(entry.id || ""), label: String(entry.name || entry.id || "Lieferant") }))
                  .filter((entry) => entry.value)}
                style={{ width: 220, maxWidth: "100%" }}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text strong>Startmonat</Text>
              <Select
                value={generationStartMonth}
                onChange={(value) => setGenerationStartMonth(value)}
                options={monthRange(currentMonthKey(), 18).map((month) => ({
                  value: month,
                  label: `${month} · ${formatMonthLabel(month)}`,
                }))}
                style={{ width: 180 }}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text strong>Horizont</Text>
              <Select
                value={generationHorizon}
                onChange={(value) => setGenerationHorizon(Number(value))}
                options={HORIZON_OPTIONS.map((value) => ({ value, label: `${value} Monate` }))}
                style={{ width: 140 }}
              />
            </div>
          </div>
          <div className="v2-toolbar-row">
            <div className="v2-toolbar-field" style={{ minWidth: 280 }}>
              <Text strong>SKUs</Text>
              <Select
                mode="multiple"
                value={generationSkuIds}
                onChange={(value) => setGenerationSkuIds(value)}
                options={generationSkuOptions.map((entry) => ({
                  value: entry.id,
                  label: `${entry.alias} · ${entry.sku}`,
                }))}
                style={{ width: screens.md ? 420 : "100%" }}
                maxTagCount="responsive"
              />
            </div>
            <div className="v2-toolbar-field">
              <Text strong>Quellen</Text>
              <Checkbox.Group
                options={SOURCE_OPTIONS}
                value={generationSourceTypes}
                onChange={(value) => setGenerationSourceTypes(value as SupplierOutlookSourceType[])}
              />
            </div>
            <div className="v2-toolbar-actions">
              <Space wrap>
                <Button type="primary" onClick={() => { void handleGenerateDraft(); }}>
                  Neuen Vorschlag generieren
                </Button>
                <Button onClick={() => { void handleDuplicateDraft(); }} disabled={!workingDraft}>
                  Duplizieren
                </Button>
                <Button onClick={() => applyDraftUpdate((current) => addSupplierOutlookManualRow(current, { actor }))} disabled={toolbarActionsDisabled || workingDraft?.status === "frozen"}>
                  Manuelle Zeile
                </Button>
                <Button onClick={() => { void handleFreezeDraft(); }} disabled={!workingDraft || workingDraft.status === "frozen" || Boolean(conflictBanner)}>
                  Einfrieren
                </Button>
                <Button onClick={() => { void handleExportPrint(); }} disabled={!workingDraft || workingDraft.status !== "frozen" || Boolean(conflictBanner)}>
                  PDF (Druckansicht)
                </Button>
                <Button onClick={() => { void handleExportWorkbook(); }} disabled={!workingDraft || workingDraft.status !== "frozen" || Boolean(conflictBanner)}>
                  XLSX
                </Button>
              </Space>
            </div>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." style={{ marginBottom: 12 }} /> : null}
      {conflictBanner ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Autosave pausiert"
          description={(
            <Space direction="vertical" size={8}>
              <Text>Die lokale Arbeitskopie blieb erhalten, konnte aber wegen eines Workspace-Konflikts nicht gespeichert werden.</Text>
              <Text type="secondary">{conflictBanner.reason}</Text>
              <Space wrap>
                <Button size="small" onClick={reloadLocalFromPersisted}>Neu laden</Button>
                <Button size="small" type="primary" onClick={() => { void handleSaveConflictAsCopy(); }}>
                  Als neue Draft speichern
                </Button>
              </Space>
            </Space>
          )}
        />
      ) : null}

      <div style={{
        display: "grid",
        gridTemplateColumns: screens.lg ? "minmax(0, 1fr) 360px" : "1fr",
        gap: 12,
        alignItems: "start",
      }}
      >
        <Card title="Matrix">
          {workingDraft ? (
            <DataTable
              data={workingDraft.rows}
              columns={matrixColumns}
              minTableWidth={Math.max(920, 260 + (months.length * 160))}
              tableLayout="fixed"
              crosshair="matrix"
              sorting={false}
            />
          ) : (
            <Empty description="Noch kein Lieferantenausblick vorhanden." />
          )}
        </Card>

        <Card title="Details">
          {!workingDraft ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Vorschlag generieren oder vorhandenen Entwurf auswählen.
            </Paragraph>
          ) : !selectedRow ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Zeile oder Zelle in der Matrix wählen.
            </Paragraph>
          ) : (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div>
                <Title level={5} style={{ marginBottom: 4 }}>{selectedRow.rowType === "manual" ? (selectedRow.manualLabel || "Manuelle Zeile") : (selectedRow.alias || selectedRow.sku || "SKU")}</Title>
                <Text type="secondary">{selectedRow.rowType === "manual" ? "Manuelle Ergänzung" : selectedRow.sku || "—"}</Text>
              </div>

              {selectedRow.rowType === "manual" ? (
                <>
                  <div>
                    <Text strong>Bezeichnung</Text>
                    <Input
                      value={selectedRow.manualLabel || ""}
                      disabled={workingDraft.status === "frozen"}
                      onChange={(event) => applyDraftUpdate((current) => updateSupplierOutlookRowMeta(current, {
                        rowId: selectedRow.id,
                        patch: { manualLabel: event.target.value },
                        actor,
                      }))}
                    />
                  </div>
                  <div>
                    <Text strong>Verknüpfte SKU</Text>
                    <Select
                      allowClear
                      value={selectedRow.linkedSku || undefined}
                      disabled={workingDraft.status === "frozen"}
                      options={generationSkuOptions.map((entry) => ({
                        value: entry.sku,
                        label: `${entry.alias} · ${entry.sku}`,
                      }))}
                      onChange={(value) => applyDraftUpdate((current) => updateSupplierOutlookRowMeta(current, {
                        rowId: selectedRow.id,
                        patch: { linkedSku: value || "" },
                        actor,
                      }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                </>
              ) : null}

              {selectedCell ? (
                <>
                  <div>
                    <Text strong>{formatMonthLabel(selectedMonth)}</Text>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <Tag>System: {formatInt(selectedCell.systemQty)}</Tag>
                      <Tag color="blue">Final: {formatInt(selectedCell.finalQty)}</Tag>
                      {selectedCell.excluded ? <Tag color="gold">Ausgeschlossen</Tag> : null}
                      <Tag color={selectedCell.finalQty === selectedCell.systemQty ? "default" : "purple"}>Abweichung: {formatInt(selectedCell.finalQty - selectedCell.systemQty)}</Tag>
                    </div>
                  </div>
                  <div>
                    <Text strong>Finale Menge</Text>
                    <InputNumber
                      min={0}
                      precision={0}
                      value={selectedCell.finalQty}
                      disabled={workingDraft.status === "frozen"}
                      onChange={(value) => applyDraftUpdate((current) => updateSupplierOutlookCell(current, {
                        rowId: selectedRow.id,
                        month: selectedMonth,
                        patch: { finalQty: value ?? 0 },
                        actor,
                      }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <Checkbox
                    checked={selectedCell.excluded}
                    disabled={workingDraft.status === "frozen"}
                    onChange={(event) => applyDraftUpdate((current) => updateSupplierOutlookCell(current, {
                      rowId: selectedRow.id,
                      month: selectedMonth,
                      patch: { excluded: event.target.checked },
                      actor,
                    }))}
                  >
                    Zelle aus Kommunikation ausschließen
                  </Checkbox>
                  <div>
                    <Text strong>Notiz</Text>
                    <Input
                      value={selectedCell.note || ""}
                      disabled={workingDraft.status === "frozen"}
                      onChange={(event) => applyDraftUpdate((current) => updateSupplierOutlookCell(current, {
                        rowId: selectedRow.id,
                        month: selectedMonth,
                        patch: { note: event.target.value },
                        actor,
                      }))}
                    />
                  </div>
                  <div>
                    <Text strong>Grund / Kommentar</Text>
                    <Input.TextArea
                      rows={3}
                      value={selectedCell.reason || ""}
                      disabled={workingDraft.status === "frozen"}
                      onChange={(event) => applyDraftUpdate((current) => updateSupplierOutlookCell(current, {
                        rowId: selectedRow.id,
                        month: selectedMonth,
                        patch: { reason: event.target.value },
                        actor,
                      }))}
                    />
                  </div>
                  <Space wrap>
                    <Button onClick={() => applyDraftUpdate((current) => resetSupplierOutlookCell(current, { rowId: selectedRow.id, month: selectedMonth, actor }))} disabled={workingDraft.status === "frozen"}>
                      Auf Systemwert zurücksetzen
                    </Button>
                  </Space>
                  <div>
                    <Text strong>Quellenaufschlüsselung</Text>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {selectedCell.sourceBreakdown.length ? selectedCell.sourceBreakdown.map((entry) => (
                        <div key={`${entry.sourceType}-${entry.sourceId}`} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <Tag>{entry.sourceType.toUpperCase()}</Tag>
                            <Text strong>{formatInt(entry.qty)}</Text>
                          </div>
                          <div>{entry.sourceLabel}</div>
                          <Text type="secondary">{entry.timingLabel || entry.arrivalDate || entry.arrivalMonth || "Kein Zeitkontext"}</Text>
                        </div>
                      )) : (
                        <Text type="secondary">Keine Systemquellen für diese Zelle.</Text>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Zeile gewählt. Wähle zusätzlich einen Monat in der Matrix, um Mengen, Notizen und Ausschluss auf Zellenebene zu bearbeiten.
                  </Paragraph>
                  <Space wrap>
                    <Button onClick={() => applyDraftUpdate((current) => setSupplierOutlookRowExcluded(current, { rowId: selectedRow.id, excluded: true, actor }))} disabled={workingDraft.status === "frozen"}>
                      Ganze Zeile ausschließen
                    </Button>
                    <Button onClick={() => applyDraftUpdate((current) => setSupplierOutlookRowExcluded(current, { rowId: selectedRow.id, excluded: false, actor }))} disabled={workingDraft.status === "frozen"}>
                      Ausschluss lösen
                    </Button>
                    <Button onClick={() => applyDraftUpdate((current) => resetSupplierOutlookRow(current, { rowId: selectedRow.id, actor }))} disabled={workingDraft.status === "frozen"}>
                      Ganze Zeile zurücksetzen
                    </Button>
                    {selectedRow.rowType === "manual" ? (
                      <Button danger onClick={() => applyDraftUpdate((current) => removeSupplierOutlookRow(current, { rowId: selectedRow.id, actor }))} disabled={workingDraft.status === "frozen"}>
                        Manuelle Zeile löschen
                      </Button>
                    ) : null}
                  </Space>
                </>
              )}
            </Space>
          )}
        </Card>
      </div>

      <Card style={{ marginTop: 12 }}>
        <Tabs
          items={[
            {
              key: "supplier",
              label: "Supplier Preview",
              children: exportModel ? (
                exportModel.supplierRows.length ? (
                  <DataTable
                    data={exportModel.supplierRows}
                    columns={previewColumns}
                    minTableWidth={Math.max(860, 240 + (months.length * 140))}
                    tableLayout="fixed"
                    sorting={false}
                  />
                ) : (
                  <Empty description="Keine sichtbaren Lieferantenzeilen für den aktuellen Entwurf." />
                )
              ) : (
                <Empty description="Kein Vorschau-Modell vorhanden." />
              ),
            },
            {
              key: "trace",
              label: "Interne Trace",
              children: exportModel ? (
                exportModel.traceRows.length ? (
                  <DataTable
                    data={exportModel.traceRows}
                    columns={traceColumns}
                    minTableWidth={1520}
                    tableLayout="fixed"
                    sorting={false}
                  />
                ) : (
                  <Empty description="Keine internen Trace-Zeilen für den aktuellen Entwurf." />
                )
              ) : (
                <Empty description="Kein Vorschau-Modell vorhanden." />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
