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

  const inventoryColumns = useMemo<ColumnDef<InventoryRow>[]>(() => [
    { header: "Artikelnummer / SKU", accessorKey: "artikelnummerSku", meta: { width: 170, minWidth: 150 } },
    { header: "Artikelbezeichnung", accessorKey: "artikelbezeichnung", meta: { width: 240, minWidth: 220 } },
    { header: "Warengruppe", accessorKey: "warengruppe", meta: { width: 140, minWidth: 120 } },
    { header: "Amazon", cell: ({ row }) => formatInt(row.original.bestandAmazon), meta: { width: 110, minWidth: 90, align: "right" } },
    { header: "Externes Lager", cell: ({ row }) => formatInt(row.original.bestandExternesLager), meta: { width: 130, minWidth: 120, align: "right" } },
    { header: "Im Zulauf", cell: ({ row }) => formatInt(row.original.bestandImZulauf), meta: { width: 110, minWidth: 90, align: "right" } },
    { header: "Gesamtbestand", cell: ({ row }) => formatInt(row.original.gesamtbestand), meta: { width: 130, minWidth: 110, align: "right" } },
    { header: "Einstandspreis EUR", cell: ({ row }) => formatCurrency(row.original.einstandspreisEur), meta: { width: 150, minWidth: 130, align: "right" } },
    { header: "Bestandswert EUR", cell: ({ row }) => formatCurrency(row.original.bestandswertEur), meta: { width: 150, minWidth: 130, align: "right" } },
    { header: "Hinweis", accessorKey: "hinweis", meta: { width: 220, minWidth: 180 } },
  ], []);

  const paymentColumns = useMemo<ColumnDef<PaymentRow>[]>(() => [
    { header: "Fachliche Behandlung", accessorKey: "fachlicheBehandlung", meta: { width: 200, minWidth: 180 } },
    { header: "Zahlungsdatum", cell: ({ row }) => formatDate(row.original.zahlungsdatum), meta: { width: 120, minWidth: 110 } },
    { header: "Lieferant", accessorKey: "lieferant", meta: { width: 180, minWidth: 150 } },
    { header: "Bestellnummer (intern)", accessorKey: "bestellnummerIntern", meta: { width: 140, minWidth: 120 } },
    { header: "Zahlungsart", accessorKey: "zahlungsart", meta: { width: 140, minWidth: 120 } },
    { header: "Betrag Ist EUR", cell: ({ row }) => formatCurrency(row.original.betragIstEur), meta: { width: 130, minWidth: 120, align: "right" } },
    { header: "Betrag USD", cell: ({ row }) => formatCurrency(row.original.betragUsd), meta: { width: 130, minWidth: 120, align: "right" } },
    {
      header: "Artikel / Mengen",
      cell: ({ row }) => <span title={row.original.artikelMengen || "-"}>{row.original.artikelMengen || "-"}</span>,
      meta: { width: 260, minWidth: 220 },
    },
    { header: "Geplante Abfahrt", cell: ({ row }) => formatDate(row.original.geplanteAbfahrt), meta: { width: 120, minWidth: 110 } },
    { header: "Geplante Ankunft", cell: ({ row }) => formatDate(row.original.geplanteAnkunft), meta: { width: 130, minWidth: 120 } },
    { header: "Wareneingang laut System", cell: ({ row }) => formatDate(row.original.wareneingangLautSystem), meta: { width: 160, minWidth: 140 } },
    { header: "Datengrundlage Wareneingang", accessorKey: "wareneingangGrundlageLabel", meta: { width: 210, minWidth: 180 } },
    { header: "Status zur Bestellung", accessorKey: "statusZurBestellung", meta: { width: 180, minWidth: 160 } },
    {
      header: "Beleglink",
      cell: ({ row }) => row.original.beleglink
        ? <a href={row.original.beleglink} target="_blank" rel="noreferrer">oeffnen</a>
        : "-",
      meta: { width: 100, minWidth: 90 },
    },
    {
      header: "Hinweis",
      cell: ({ row }) => <span title={row.original.hinweis || "-"}>{row.original.hinweis || "-"}</span>,
      meta: { width: 240, minWidth: 200 },
    },
  ], []);

  const arrivalColumns = useMemo<ColumnDef<ArrivalRow>[]>(() => [
    { header: "Fachliche Behandlung", accessorKey: "fachlicheBehandlung", meta: { width: 240, minWidth: 210 } },
    { header: "Wareneingang laut System", cell: ({ row }) => formatDate(row.original.wareneingangLautSystem), meta: { width: 160, minWidth: 140 } },
    { header: "Datengrundlage Wareneingang", accessorKey: "wareneingangGrundlageLabel", meta: { width: 210, minWidth: 180 } },
    { header: "Lieferant", accessorKey: "lieferant", meta: { width: 180, minWidth: 150 } },
    { header: "Bestellnummer (intern)", accessorKey: "bestellnummerIntern", meta: { width: 140, minWidth: 120 } },
    {
      header: "Artikel / Mengen",
      cell: ({ row }) => <span title={row.original.artikelMengen || "-"}>{row.original.artikelMengen || "-"}</span>,
      meta: { width: 260, minWidth: 220 },
    },
    { header: "Gesamtmenge", cell: ({ row }) => formatInt(row.original.gesamtmenge), meta: { width: 110, minWidth: 90, align: "right" } },
    { header: "Warenwert USD", cell: ({ row }) => formatCurrency(row.original.warenwertUsd), meta: { width: 130, minWidth: 120, align: "right" } },
    { header: "Warenwert EUR", cell: ({ row }) => formatCurrency(row.original.warenwertEur), meta: { width: 130, minWidth: 120, align: "right" } },
    { header: "Geplante Abfahrt", cell: ({ row }) => formatDate(row.original.geplanteAbfahrt), meta: { width: 120, minWidth: 110 } },
    { header: "Geplante Ankunft", cell: ({ row }) => formatDate(row.original.geplanteAnkunft), meta: { width: 130, minWidth: 120 } },
    { header: "Bisherige Zahlungen EUR", cell: ({ row }) => formatCurrency(row.original.bisherigeLieferantenzahlungenEur), meta: { width: 160, minWidth: 150, align: "right" } },
    { header: "Davon im Monat EUR", cell: ({ row }) => formatCurrency(row.original.davonImMonatBezahltEur), meta: { width: 150, minWidth: 140, align: "right" } },
    { header: "Transportart", accessorKey: "transportart", meta: { width: 120, minWidth: 100 } },
    {
      header: "Hinweis",
      cell: ({ row }) => <span title={row.original.hinweis || "-"}>{row.original.hinweis || "-"}</span>,
      meta: { width: 240, minWidth: 200 },
    },
  ], []);

  const qualityColumns = useMemo<ColumnDef<QualityRow>[]>(() => [
    { header: "Bereich", accessorKey: "bereich", meta: { width: 150, minWidth: 130 } },
    { header: "Bezug", accessorKey: "bezug", meta: { width: 180, minWidth: 160 } },
    { header: "Hinweis", accessorKey: "hinweis", meta: { width: 420, minWidth: 320 } },
    { header: "Relevanz fuer Buchhaltung", accessorKey: "relevanzFuerBuchhaltung", meta: { width: 180, minWidth: 160 } },
  ], []);

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
            <Tag color="blue">Wareneingaenge: {overview.anzahlWareneingaenge || 0}</Tag>
            <Tag color="green">Warenwert: {preview.inventory.totalValueEur != null ? `${formatCurrency(preview.inventory.totalValueEur)} EUR` : "-"}</Tag>
            <Tag color={preview.pruefhinweise.length ? "orange" : "green"}>Pruefhinweise: {preview.pruefhinweise.length}</Tag>
          </div>
        </div>
      </Card>

      {error ? (
        <Alert type="error" showIcon message="Workspace Fehler" description={error} />
      ) : null}

      <Card title="Monatsuebersicht">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text><strong>Verbindliche Datei:</strong> {overview.verbindlicheDatei || "-"}</Text>
          <Text><strong>Bestandsstichtag:</strong> {formatDate(overview.bestandStichtag || null)}</Text>
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
          minTableWidth={2220}
          tableLayout="auto"
        />
      </Card>

      <Card title={`Wareneingaenge in ${month}`} loading={loading}>
        <DataTable
          data={(preview.wareneingaenge || []) as ArrivalRow[]}
          columns={arrivalColumns}
          minTableWidth={2360}
          tableLayout="auto"
        />
      </Card>

      <Card title="Warenbestand Monatsende" loading={loading}>
        <DataTable
          data={(preview.warenbestandRows || []) as InventoryRow[]}
          columns={inventoryColumns}
          minTableWidth={1540}
          tableLayout="auto"
        />
      </Card>

      <Card title="Pruefhinweise" loading={loading}>
        <DataTable
          data={(preview.pruefhinweise || []) as QualityRow[]}
          columns={qualityColumns}
          minTableWidth={980}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
