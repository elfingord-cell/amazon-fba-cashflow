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
import { TanStackGrid } from "../../components/TanStackGrid";
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
  const [scope, setScope] = useState<PaymentExportScope>("both");
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
    { header: "Monat", accessorKey: "month" },
    { header: "Typ", accessorKey: "entityType" },
    {
      header: "PO/FO Nr",
      cell: ({ row }) => (row.original.entityType === "PO" ? row.original.poNumber : row.original.foNumber) || "—",
    },
    { header: "Supplier", accessorKey: "supplierName" },
    { header: "SKU Alias", accessorKey: "skuAliases" },
    { header: "Payment Type", accessorKey: "paymentType" },
    {
      header: "Status",
      cell: ({ row }) => (
        row.original.status === "PAID"
          ? <Tag color="green">Bezahlt</Tag>
          : <Tag color="gold">Offen</Tag>
      ),
    },
    {
      header: "Faellig",
      cell: ({ row }) => formatDate(row.original.dueDate),
    },
    {
      header: "Bezahlt",
      cell: ({ row }) => formatDate(row.original.paidDate),
    },
    {
      header: "Soll EUR",
      cell: ({ row }) => formatCurrency(row.original.amountPlannedEur),
    },
    {
      header: "Ist EUR",
      cell: ({ row }) => {
        if (row.original.status !== "PAID") return "—";
        const hasMissingActual = row.original.amountActualEur == null;
        return (
          <span className={hasMissingActual ? "v2-negative" : undefined}>
            {formatCurrency(row.original.amountActualEur)}
          </span>
        );
      },
    },
    {
      header: "Issues",
      cell: ({ row }) => row.original.issues?.length ? row.original.issues.join(" | ") : "—",
    },
    {
      header: "Payment ID",
      cell: ({ row }) => row.original.paymentId || "—",
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
              Zahlungsjournal mit Scope/Monatsfilter sowie CSV-Export und PDF-Print-View.
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
                  { label: "Paid", value: "paid" },
                  { label: "Open", value: "open" },
                  { label: "Both", value: "both" },
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
            <Button type="primary" onClick={exportRows}>
              Export
            </Button>
            <Button onClick={() => { void reload(); }}>
              Neu laden
            </Button>
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
          Paid-Positionen werden mit Ist-Betrag angezeigt; fehlende Ist-Werte sind als Issue markiert.
        </Text>
        <TanStackGrid
          data={rows}
          columns={columns}
          minTableWidth={1600}
          tableLayout="auto"
        />
      </Card>
    </div>
  );
}
