import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { currentMonthKey, formatMonthLabel } from "../../domain/months";
import {
  type PaymentExportScope,
  type PaymentJournalRow,
  buildPaymentJournalCsvRows,
  buildPaymentJournalRowsFromState,
  openPaymentJournalPrintView,
  paymentJournalRowsToCsv,
  sumPaymentRows,
} from "../../domain/paymentJournal";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type ExportFormat = "csv" | "print";

const ALL_MONTHS = "__all__";

function isMonthKey(value: unknown): value is string {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function formatDate(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(value: number | null): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function triggerCsvDownload(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function PaymentsExportModule(): JSX.Element {
  const { state, loading, error, reload } = useWorkspaceState();
  const [scope, setScope] = useState<PaymentExportScope>("paid");
  const [monthFilter, setMonthFilter] = useState<string>(currentMonthKey());
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [messageApi, contextHolder] = message.useMessage();

  const stateObject = state as unknown as Record<string, unknown>;
  const effectiveMonth = monthFilter === ALL_MONTHS ? undefined : monthFilter;

  const allRows = useMemo(
    () => buildPaymentJournalRowsFromState(stateObject, { scope: "both" }),
    [state],
  );

  const rows = useMemo(
    () => buildPaymentJournalRowsFromState(stateObject, { month: effectiveMonth, scope }),
    [effectiveMonth, scope, state],
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey());
    allRows.forEach((row) => {
      if (isMonthKey(row.month)) months.add(row.month);
    });
    return Array.from(months).sort();
  }, [allRows]);

  const paidRows = useMemo(
    () => rows.filter((row) => row.status === "PAID"),
    [rows],
  );
  const openRows = useMemo(
    () => rows.filter((row) => row.status === "OPEN"),
    [rows],
  );
  const issueCount = useMemo(
    () => rows.reduce((sum, row) => sum + (row.issues?.length || 0), 0),
    [rows],
  );
  const paidActualTotal = useMemo(
    () => sumPaymentRows(paidRows, "amountActualEur"),
    [paidRows],
  );
  const openPlannedTotal = useMemo(
    () => sumPaymentRows(openRows, "amountPlannedEur"),
    [openRows],
  );

  const columns = useMemo<ColumnDef<PaymentJournalRow>[]>(() => [
    {
      header: "Zahlungsdatum",
      cell: ({ row }) => formatDate(row.original.status === "PAID" ? (row.original.paidDate || row.original.dueDate) : row.original.dueDate),
    },
    {
      header: "Status",
      cell: ({ row }) => (
        row.original.status === "PAID"
          ? <Tag color="green">Bezahlt</Tag>
          : <Tag color="gold">Offen</Tag>
      ),
    },
    {
      header: "PO/FO Nr",
      cell: ({ row }) => (row.original.entityType === "PO" ? row.original.poNumber : row.original.foNumber) || "—",
    },
    { header: "Lieferant", accessorKey: "supplierName" },
    {
      header: "Item",
      cell: ({ row }) => (
        <span title={row.original.itemTooltip || row.original.skuAliases}>
          {row.original.itemSummary || row.original.skuAliases}
        </span>
      ),
    },
    { header: "Enthaltene Positionen", accessorKey: "paymentType" },
    {
      header: "Ist EUR",
      cell: ({ row }) => {
        if (row.original.status !== "PAID") return "—";
        return formatCurrency(row.original.amountActualEur);
      },
    },
    {
      header: "Plan EUR",
      cell: ({ row }) => {
        const hasMissingActual = row.original.status === "PAID" && row.original.amountActualEur == null;
        return <span className={hasMissingActual ? "v2-negative" : undefined}>{formatCurrency(row.original.amountPlannedEur)}</span>;
      },
    },
    {
      header: "Issues",
      cell: ({ row }) => row.original.issues?.length ? row.original.issues.join(" | ") : "—",
    },
    {
      header: "Zahler",
      cell: ({ row }) => row.original.payer || "—",
    },
    {
      header: "Methode",
      cell: ({ row }) => row.original.paymentMethod || "—",
    },
    {
      header: "Notiz",
      cell: ({ row }) => row.original.note || "—",
    },
  ], []);

  function exportRows(): void {
    if (!rows.length) {
      messageApi.warning("Keine passenden Zahlungen fuer den Export gefunden.");
      return;
    }
    if (format === "print") {
      openPaymentJournalPrintView(rows, { month: effectiveMonth, scope });
      return;
    }
    const csvRows = buildPaymentJournalCsvRows(rows);
    const csv = paymentJournalRowsToCsv(csvRows, ";");
    const fileMonth = effectiveMonth || "all-months";
    const fileName = `payment_journal_${fileMonth}_${scope}.csv`;
    triggerCsvDownload(csv, fileName);
    messageApi.success(`CSV erstellt: ${fileName}`);
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Payments Export</Title>
            <Paragraph>
              Zahlungsjournal auf Zahlungsebene fuer steuerrelevante PO-Positionen inkl. Datum-Fallback und Warnhinweisen.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <div className="v2-toolbar-field">
              <Text>Monat</Text>
              <Select
                value={monthFilter}
                onChange={(value) => setMonthFilter(value)}
                options={[
                  { value: ALL_MONTHS, label: "Alle Monate" },
                  ...monthOptions.map((month) => ({
                    value: month,
                    label: `${month} (${formatMonthLabel(month)})`,
                  })),
                ]}
                style={{ width: 220, maxWidth: "100%" }}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text>Scope</Text>
              <Radio.Group
                value={scope}
                onChange={(event) => setScope(event.target.value as PaymentExportScope)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: "Nur bezahlt", value: "paid" },
                  { label: "Open", value: "open" },
                  { label: "Beides", value: "both" },
                ]}
              />
            </div>
            <div className="v2-toolbar-field">
              <Text>Format</Text>
              <Radio.Group
                value={format}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: "CSV", value: "csv" },
                  { label: "PDF (Print)", value: "print" },
                ]}
              />
            </div>
          </div>
          <div className="v2-toolbar-row v2-toolbar-actions">
            <div className="v2-actions-inline">
              <Button type="primary" onClick={exportRows}>
                Export
              </Button>
              <Button onClick={() => { void reload(); }}>
                Neu laden
              </Button>
            </div>
            <Tag color="blue">Zeilen: {rows.length}</Tag>
            <Tag color="green">Ist (PAID): {formatCurrency(paidActualTotal)}</Tag>
            <Tag color="orange">Soll (OPEN): {formatCurrency(openPlannedTotal)}</Tag>
            <Tag color={issueCount > 0 ? "red" : "green"}>Issues: {issueCount}</Tag>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={4}>Journal</Title>
        <Text type="secondary">
          Monatslogik: bezahlt nach Paid-Date, ohne Paid-Date mit Due-Date als Fallback (markiert als Hinweis).
        </Text>
        <DataTable
          data={rows}
          columns={columns}
          minTableWidth={1480}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
