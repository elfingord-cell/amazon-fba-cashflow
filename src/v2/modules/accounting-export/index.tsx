import { useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Space, Tag, Typography, message } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { currentMonthKey } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import {
  buildAccountantReportData,
  buildAccountantReportBundleFromState,
} from "../../../domain/accountantReport.js";
import { triggerBlobDownload } from "../../../domain/accountantBundle.js";
import { buildPoPaymentsLedgerExport } from "../../../domain/poPaymentsLedger.js";

const { Paragraph, Text, Title } = Typography;

type InventoryRow = {
  sku: string;
  alias: string;
  category: string;
  amazonUnits: number;
  threePLUnits: number;
  inTransitUnits: number;
  rowValueEur: number | null;
};

type DepositRow = {
  poNumber: string;
  supplier: string;
  skuAliases: string;
  paidDate: string | null;
  actualEur: number | null;
  amountUsd: number | null;
  issues: string[];
};

type ArrivalRow = {
  poNumber: string;
  supplier: string;
  skuAliases: string;
  arrivalDate: string | null;
  units: number | null;
  goodsEur: number | null;
  issues: string[];
};

type PoLedgerRow = {
  monthMarker: boolean;
  monthMarkerReason: string;
  poNumber: string;
  supplier: string;
  skuAliases: string;
  units: number | null;
  depositActualEurMonth: number | null;
  depositAmountUsdMonth: number | null;
  etdDate: string | null;
  etaDate: string | null;
  arrivalDate: string | null;
  arrivalSource: string;
  issues: string[];
};

type QualityRow = {
  code: string;
  severity: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

function formatCurrency(value: number | null): string {
  if (!Number.isFinite(value as number)) return "-";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInt(value: number | null): string {
  if (!Number.isFinite(value as number)) return "-";
  return Math.round(Number(value)).toLocaleString("de-DE");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "-";
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function parseOverride(value: string): number | null {
  const normalized = String(value || "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function copyToClipboard(value: string): Promise<void> {
  const text = String(value || "");
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function AccountingExportModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const syncSession = useSyncSession();
  const [month, setMonth] = useState(() => currentMonthKey());
  const [includeJournal, setIncludeJournal] = useState(false);
  const [inventoryOverrideRaw, setInventoryOverrideRaw] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const [exportBusy, setExportBusy] = useState(false);
  const [lastEmailText, setLastEmailText] = useState("");

  const stateObject = state as unknown as Record<string, unknown>;
  const workspaceName = syncSession.workspaceId || "Workspace";

  const preview = useMemo(() => {
    return buildAccountantReportData(
      stateObject,
      {
        month,
        scope: includeJournal ? "core_plus_journal" : "core",
      },
      {
        workspaceName,
        inventoryValueOverrideEur: parseOverride(inventoryOverrideRaw),
      },
    );
  }, [includeJournal, inventoryOverrideRaw, month, stateObject, workspaceName]);

  const inventoryColumns = useMemo<ColumnDef<InventoryRow>[]>(() => [
    {
      header: "Alias",
      accessorKey: "alias",
      meta: { width: 260, minWidth: 240 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    { header: "Kategorie", accessorKey: "category" },
    { header: "Amazon", cell: ({ row }) => formatInt(row.original.amazonUnits) },
    { header: "3PL", cell: ({ row }) => formatInt(row.original.threePLUnits) },
    { header: "In Transit", cell: ({ row }) => formatInt(row.original.inTransitUnits) },
    { header: "Warenwert EUR", cell: ({ row }) => formatCurrency(row.original.rowValueEur) },
  ], []);

  const depositColumns = useMemo<ColumnDef<DepositRow>[]>(() => [
    { header: "PO", accessorKey: "poNumber" },
    { header: "Supplier", accessorKey: "supplier" },
    { header: "SKU Alias", accessorKey: "skuAliases" },
    { header: "Paid Date", cell: ({ row }) => formatDate(row.original.paidDate) },
    { header: "Ist EUR", cell: ({ row }) => formatCurrency(row.original.actualEur) },
    { header: "USD", cell: ({ row }) => formatCurrency(row.original.amountUsd) },
    { header: "Issues", cell: ({ row }) => row.original.issues?.join(" | ") || "-" },
  ], []);

  const arrivalColumns = useMemo<ColumnDef<ArrivalRow>[]>(() => [
    { header: "PO", accessorKey: "poNumber" },
    { header: "Supplier", accessorKey: "supplier" },
    { header: "SKU Alias", accessorKey: "skuAliases" },
    { header: "Arrival", cell: ({ row }) => formatDate(row.original.arrivalDate) },
    { header: "Units", cell: ({ row }) => formatInt(row.original.units || 0) },
    { header: "Goods EUR", cell: ({ row }) => formatCurrency(row.original.goodsEur) },
    { header: "Issues", cell: ({ row }) => row.original.issues?.join(" | ") || "-" },
  ], []);

  const poLedgerColumns = useMemo<ColumnDef<PoLedgerRow>[]>(() => [
    {
      header: "Monat relevant",
      cell: ({ row }) => row.original.monthMarker
        ? <Tag color="green">{row.original.monthMarkerReason || "ja"}</Tag>
        : <Tag color="default">nein</Tag>,
    },
    { header: "PO", accessorKey: "poNumber" },
    { header: "Supplier", accessorKey: "supplier" },
    { header: "SKU Alias", accessorKey: "skuAliases" },
    { header: "Units", cell: ({ row }) => formatInt(row.original.units || 0) },
    { header: "Deposit EUR (Monat)", cell: ({ row }) => formatCurrency(row.original.depositActualEurMonth) },
    { header: "Deposit USD (Monat)", cell: ({ row }) => formatCurrency(row.original.depositAmountUsdMonth) },
    { header: "ETD", cell: ({ row }) => formatDate(row.original.etdDate) },
    { header: "ETA", cell: ({ row }) => formatDate(row.original.etaDate) },
    { header: "Ankunft", cell: ({ row }) => formatDate(row.original.arrivalDate || row.original.etaDate) },
    { header: "Source", accessorKey: "arrivalSource" },
    { header: "Issues", cell: ({ row }) => row.original.issues?.join(" | ") || "-" },
  ], []);

  const qualityColumns = useMemo<ColumnDef<QualityRow>[]>(() => [
    { header: "Severity", accessorKey: "severity" },
    { header: "Code", accessorKey: "code" },
    { header: "Message", accessorKey: "message" },
    { header: "Entity", cell: ({ row }) => row.original.entityType || "-" },
    { header: "ID", cell: ({ row }) => row.original.entityId || "-" },
  ], []);

  async function handleExport(): Promise<void> {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const bundle = await buildAccountantReportBundleFromState(
        stateObject,
        {
          month,
          scope: includeJournal ? "core_plus_journal" : "core",
        },
        {
          workspaceName,
          inventoryValueOverrideEur: parseOverride(inventoryOverrideRaw),
        },
      );
      setLastEmailText(bundle?.emailDraft?.text || "");
      await triggerBlobDownload(bundle.zipBlob, bundle.zipFileName);
      messageApi.success(`Paket erstellt: ${bundle.zipFileName}`);
    } catch (bundleError) {
      console.error(bundleError);
      messageApi.error(bundleError instanceof Error ? bundleError.message : "Export fehlgeschlagen");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyEmail(): Promise<void> {
    try {
      let payload = lastEmailText;
      if (!payload) {
        const bundle = await buildAccountantReportBundleFromState(
          stateObject,
          {
            month,
            scope: includeJournal ? "core_plus_journal" : "core",
          },
          {
            workspaceName,
            inventoryValueOverrideEur: parseOverride(inventoryOverrideRaw),
          },
        );
        payload = bundle?.emailDraft?.text || "";
        setLastEmailText(payload);
      }
      await copyToClipboard(payload);
      messageApi.success("E-Mail Text kopiert.");
    } catch (copyError) {
      console.error(copyError);
      messageApi.error(copyError instanceof Error ? copyError.message : "Kopieren fehlgeschlagen");
    }
  }

  async function handlePoPaymentsLedgerExport(): Promise<void> {
    try {
      const exportPayload = buildPoPaymentsLedgerExport(stateObject, { month });
      if (!exportPayload.rowCount) {
        messageApi.warning(`Keine bezahlten PO-Zahlungen fuer ${month} gefunden.`);
        return;
      }
      const blob = new Blob([exportPayload.csv], { type: "text/csv;charset=utf-8" });
      await triggerBlobDownload(blob, exportPayload.fileName);
      messageApi.success(`Ledger exportiert: ${exportPayload.fileName} (${exportPayload.rowCount} Zeilen)`);
    } catch (ledgerError) {
      console.error(ledgerError);
      messageApi.error(ledgerError instanceof Error ? ledgerError.message : "PO Payments Ledger Export fehlgeschlagen");
    }
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Buchhalter Export</Title>
            <Paragraph>
              One-Click Monats-Paket mit Preview: Warenbestand, Lieferanzahlungen, Wareneingaenge und E-Mail Text.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <div className="v2-toolbar-field">
              <Text>Monat</Text>
              <Input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value || currentMonthKey())}
                style={{ width: 180, maxWidth: "100%" }}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text>Scope</Text>
              <Checkbox checked={includeJournal} onChange={(event) => setIncludeJournal(event.target.checked)}>
                Zahlungsjournal zusaetzlich
              </Checkbox>
            </div>
            <div className="v2-toolbar-field">
              <Text>Warenwert Override EUR (optional)</Text>
              <Input
                placeholder="z.B. 150000"
                value={inventoryOverrideRaw}
                onChange={(event) => setInventoryOverrideRaw(event.target.value)}
                style={{ width: 220, maxWidth: "100%" }}
              />
            </div>
          </div>
          <div className="v2-toolbar-row v2-toolbar-actions">
            <div className="v2-actions-inline">
              <Button type="primary" onClick={() => { void handleExport(); }} loading={exportBusy}>
                Paket erstellen
              </Button>
              <Button onClick={() => { void handlePoPaymentsLedgerExport(); }}>
                Export PO Payments (Monat)
              </Button>
              <Button onClick={() => { void handleCopyEmail(); }}>
                E-Mail Text kopieren
              </Button>
            </div>
            <Tag color="blue">Anzahlungen: {preview.deposits.length}</Tag>
            <Tag color="blue">Wareneingaenge: {preview.arrivals.length}</Tag>
            <Tag color="blue">Kombi-Zeilen: {(preview.poLedger || []).length}</Tag>
            <Tag color="default">Monat markiert: {(preview.poLedger || []).filter((row: PoLedgerRow) => row.monthMarker).length}</Tag>
            <Tag color={preview.quality.length ? "red" : "green"}>Issues: {preview.quality.length}</Tag>
          </div>
        </div>
      </Card>

      {error ? (
        <Alert type="error" showIcon message="Workspace Fehler" description={error} />
      ) : null}

      <Card title="Monatszusammenfassung">
        <Space wrap>
          <Tag color="default">Snapshot: {formatDate(preview.inventory.snapshotAsOf)}</Tag>
          <Tag color="green">Warenwert: {preview.inventory.totalValueEur != null ? `${formatCurrency(preview.inventory.totalValueEur)} EUR` : "-"}</Tag>
          <Tag color="default">Amazon: {formatInt(preview.inventory.totalAmazonUnits)}</Tag>
          <Tag color="default">3PL: {formatInt(preview.inventory.total3plUnits)}</Tag>
          <Tag color="default">Transit: {formatInt(preview.inventory.totalInTransitUnits)}</Tag>
          <Tag color={preview.inventory.manualOverrideUsed ? "orange" : "default"}>
            Override: {preview.inventory.manualOverrideUsed ? "ja" : "nein"}
          </Tag>
        </Space>
      </Card>

      <Card title="Warenbestand Preview" loading={loading}>
        <DataTable
          data={(preview.inventoryRows || []) as InventoryRow[]}
          columns={inventoryColumns}
          minTableWidth={980}
          tableLayout="auto"
        />
      </Card>

      <Card title="Lieferanzahlungen Preview" loading={loading}>
        <DataTable
          data={(preview.deposits || []) as DepositRow[]}
          columns={depositColumns}
          minTableWidth={1180}
          tableLayout="auto"
        />
      </Card>

      <Card title="Anzahlungen + Wareneingang (PO)" loading={loading}>
        <DataTable
          data={(preview.poLedger || []) as PoLedgerRow[]}
          columns={poLedgerColumns}
          minTableWidth={1600}
          tableLayout="auto"
        />
      </Card>

      <Card title="Wareneingang Preview" loading={loading}>
        <DataTable
          data={(preview.arrivals || []) as ArrivalRow[]}
          columns={arrivalColumns}
          minTableWidth={1100}
          tableLayout="auto"
        />
      </Card>

      <Card title="Quality Issues" loading={loading}>
        <DataTable
          data={(preview.quality || []) as QualityRow[]}
          columns={qualityColumns}
          minTableWidth={960}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
