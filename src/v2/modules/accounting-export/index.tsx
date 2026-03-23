import { useMemo, useState } from "react";
import { Alert, Button, Card, Input, Space, Tag, Typography, message } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { currentMonthKey } from "../../domain/months";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import {
  buildAccountantReportData,
  buildAccountantReportBundleFromState,
} from "../../../domain/accountantReport.js";
import { triggerBlobDownload } from "../../../domain/accountantBundle.js";
import {
  ACCOUNTANT_CELL_TYPES,
  ACCOUNTANT_SHEET_SCHEMAS,
  accountantToneToAntColor,
  buildAccountantOverviewRows,
  formatAccountantDisplayValue,
  resolveAccountantStatusTone,
} from "../../../domain/accountantPresentation.js";

const { Paragraph, Text, Title } = Typography;

type InventoryRow = {
  artikelnummerSku: string;
  artikelbezeichnung: string;
  warengruppe: string;
  bestandAmazon: number;
  bestandExternesLager: number;
  bestandImZulauf: number;
  gesamtbestand: number;
  einstandspreisEur: number | null;
  bestandswertEur: number | null;
  hinweis: string;
};

type PaymentRow = {
  fachlicheBehandlung: string;
  zahlungsdatum: string | null;
  lieferant: string;
  bestellnummerIntern: string;
  verknuepfteBestellung: string;
  zahlungsart: string;
  betragIstEur: number | null;
  betragUsd: number | null;
  artikelMengen: string;
  geplanteAbfahrt: string | null;
  geplanteAnkunft: string | null;
  wareneingangLautSystem: string | null;
  wareneingangGrundlageLabel: string;
  statusZurBestellung: string;
  beleglink: string;
  hinweis: string;
};

type ArrivalRow = {
  fachlicheBehandlung: string;
  wareneingangLautSystem: string | null;
  wareneingangGrundlageLabel: string;
  lieferant: string;
  bestellnummerIntern: string;
  verknuepfteBestellung: string;
  artikelMengen: string;
  gesamtmenge: number | null;
  warenwertUsd: number | null;
  warenwertEur: number | null;
  geplanteAbfahrt: string | null;
  geplanteAnkunft: string | null;
  bisherigeLieferantenzahlungenEur: number | null;
  davonImMonatBezahltEur: number | null;
  transportart: string;
  hinweis: string;
};

type QualityRow = {
  bereich: string;
  bezug: string;
  hinweis: string;
  relevanzFuerBuchhaltung: string;
};

function parseOverride(value: string): number | null {
  const normalized = String(value || "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type SchemaColumn = {
  key: string;
  label: string;
  cellType: string;
  columnWidth?: number;
  wrap?: boolean;
  alignment?: "left" | "right" | "center";
  linkLabel?: string;
};

function renderCellValue<T extends object>(tableKey: string, column: SchemaColumn, row: T): JSX.Element | string {
  const rawValue = (row as Record<string, unknown>)[column.key];
  const tone = resolveAccountantStatusTone(tableKey, column.key, row as Record<string, unknown>);
  const formatted = formatAccountantDisplayValue(column.cellType, rawValue, {
    linkLabel: column.linkLabel,
  });

  if (column.cellType === ACCOUNTANT_CELL_TYPES.link) {
    const href = String(rawValue || "").trim();
    if (!href) return "-";
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {formatted}
      </a>
    );
  }

  if ((column.key === "statusZurBestellung" || column.key === "wareneingangGrundlageLabel" || tableKey === "quality") && formatted !== "-") {
    return <Tag color={accountantToneToAntColor(tone)}>{formatted}</Tag>;
  }

  if (column.key === "hinweis" && formatted !== "-") {
    return <Tag color={accountantToneToAntColor(tone)}>{formatted}</Tag>;
  }

  if (column.wrap) {
    return (
      <span title={formatted} style={{ display: "block", whiteSpace: "normal", lineHeight: 1.35 }}>
        {formatted}
      </span>
    );
  }

  return formatted;
}

function buildColumns<T extends object>(tableKey: string, columns: SchemaColumn[]): ColumnDef<T>[] {
  return columns.map((column) => ({
    header: column.label,
    accessorKey: column.key,
    cell: ({ row }) => renderCellValue(tableKey, column, row.original),
    meta: {
      width: column.columnWidth ? column.columnWidth * 8 : 120,
      minWidth: column.columnWidth ? Math.max(90, column.columnWidth * 7) : 100,
      align: column.alignment || "left",
    },
  }));
}

function minTableWidth(columns: SchemaColumn[]): number {
  return columns.reduce((sum, column) => sum + ((column.columnWidth || 14) * 8), 0);
}

export default function AccountingExportModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();
  const syncSession = useSyncSession();
  const [month, setMonth] = useState(() => currentMonthKey());
  const [inventoryOverrideRaw, setInventoryOverrideRaw] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const [exportBusy, setExportBusy] = useState(false);

  const stateObject = state as unknown as Record<string, unknown>;
  const workspaceName = syncSession.workspaceId || "Workspace";

  const preview = useMemo(() => {
    return buildAccountantReportData(
      stateObject,
      { month },
      {
        workspaceName,
        inventoryValueOverrideEur: parseOverride(inventoryOverrideRaw),
      },
    );
  }, [inventoryOverrideRaw, month, stateObject, workspaceName]);

  const paymentSchema = ACCOUNTANT_SHEET_SCHEMAS.payments.columns as SchemaColumn[];
  const arrivalSchema = ACCOUNTANT_SHEET_SCHEMAS.arrivals.columns as SchemaColumn[];
  const inventorySchema = ACCOUNTANT_SHEET_SCHEMAS.inventory.columns as SchemaColumn[];
  const qualitySchema = ACCOUNTANT_SHEET_SCHEMAS.quality.columns as SchemaColumn[];

  const inventoryColumns = useMemo<ColumnDef<InventoryRow>[]>(() => buildColumns<InventoryRow>("inventory", inventorySchema), [inventorySchema]);
  const paymentColumns = useMemo<ColumnDef<PaymentRow>[]>(() => buildColumns<PaymentRow>("payments", paymentSchema), [paymentSchema]);
  const arrivalColumns = useMemo<ColumnDef<ArrivalRow>[]>(() => buildColumns<ArrivalRow>("arrivals", arrivalSchema), [arrivalSchema]);
  const qualityColumns = useMemo<ColumnDef<QualityRow>[]>(() => buildColumns<QualityRow>("quality", qualitySchema), [qualitySchema]);

  async function handleExport(): Promise<void> {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const bundle = await buildAccountantReportBundleFromState(
        stateObject,
        { month },
        {
          workspaceName,
          inventoryValueOverrideEur: parseOverride(inventoryOverrideRaw),
        },
      );
      await triggerBlobDownload(bundle.zipBlob, bundle.zipFileName);
      messageApi.success(`Paket erstellt: ${bundle.zipFileName}`);
    } catch (bundleError) {
      console.error(bundleError);
      messageApi.error(bundleError instanceof Error ? bundleError.message : "Export fehlgeschlagen");
    } finally {
      setExportBusy(false);
    }
  }

  const overview = preview.uebersicht || {};

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Buchhalterpaket</Title>
            <Paragraph>
              Standard-Download fuer Frau Kalinna mit genau zwei Dateien: Monatsuebersicht als PDF und Arbeitsdatei als XLSX.
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
            </div>
            <Tag color="blue">Verbindliche Datei: {overview.verbindlicheDatei || "-"}</Tag>
            <Tag color="blue">Zahlungen: {overview.anzahlZahlungenLieferanten || 0}</Tag>
            <Tag color="green">Bestaetigte Wareneingaenge: {overview.anzahlBestaetigteWareneingaenge || 0}</Tag>
            <Tag color="gold">Nur geplante Ankuenfte: {overview.anzahlGeplanteAnkuenfte || 0}</Tag>
            <Tag color="green">Warenwert: {preview.inventory.totalValueEur != null ? `${formatAccountantDisplayValue(ACCOUNTANT_CELL_TYPES.currency, preview.inventory.totalValueEur)} EUR` : "-"}</Tag>
            <Tag color={preview.pruefhinweise.length ? "orange" : "green"}>Pruefhinweise: {preview.pruefhinweise.length}</Tag>
          </div>
        </div>
      </Card>

      {error ? (
        <Alert type="error" showIcon message="Workspace Fehler" description={error} />
      ) : null}

      <Card title="Monatsuebersicht">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          {buildAccountantOverviewRows(preview).map((entry) => (
            <Text key={entry.label}>
              <strong>{entry.label}:</strong> {formatAccountantDisplayValue(entry.cellType, entry.value)}
              {entry.cellType === ACCOUNTANT_CELL_TYPES.currency && entry.value != null ? " EUR" : ""}
            </Text>
          ))}
          <Text><strong>Bewertungsgrundlage:</strong> {overview.bewertungsgrundlageText || "-"}</Text>
          <Text><strong>Vollstaendigkeit innerhalb der Plattform:</strong> {overview.vollstaendigkeitInnerhalbPlattformText || "-"}</Text>
          <Text><strong>Manuell ausserhalb der Plattform beizulegen:</strong></Text>
          <div>
            {(overview.manuellAusserhalbPlattformBeizulegen || []).map((entry: string) => (
              <Tag key={entry} style={{ marginBottom: 8 }}>{entry}</Tag>
            ))}
          </div>
        </Space>
      </Card>

      <Card title={`Zahlungen Lieferanten in ${month}`} loading={loading}>
        <DataTable
          data={(preview.zahlungenLieferanten || []) as PaymentRow[]}
          columns={paymentColumns}
          minTableWidth={minTableWidth(paymentSchema)}
          tableLayout="fixed"
        />
      </Card>

      <Card title={`Wareneingaenge in ${month}`} loading={loading}>
        <DataTable
          data={(preview.wareneingaenge || []) as ArrivalRow[]}
          columns={arrivalColumns}
          minTableWidth={minTableWidth(arrivalSchema)}
          tableLayout="fixed"
        />
      </Card>

      <Card title="Warenbestand Monatsende" loading={loading}>
        <DataTable
          data={(preview.warenbestandRows || []) as InventoryRow[]}
          columns={inventoryColumns}
          minTableWidth={minTableWidth(inventorySchema)}
          tableLayout="fixed"
        />
      </Card>

      <Card title="Pruefhinweise" loading={loading}>
        <DataTable
          data={(preview.pruefhinweise || []) as QualityRow[]}
          columns={qualityColumns}
          minTableWidth={minTableWidth(qualitySchema)}
          tableLayout="fixed"
        />
      </Card>
    </div>
  );
}
