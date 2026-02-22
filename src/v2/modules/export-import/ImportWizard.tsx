import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  List,
  Radio,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { ColumnDef } from "@tanstack/react-table";
import type { ImportMode } from "../../state/types";
import type { DryRunBundle, ImportIssue, ImportSectionStats, ImportApplyResult } from "../../migration";
import { applyDryRunBundle, runLegacyDryRunFromJson } from "../../migration";
import { useStorageAdapter } from "../../sync/session";
import { DataTable } from "../../components/DataTable";

const { Paragraph, Text, Title } = Typography;

interface IssueTagProps {
  severity: ImportIssue["severity"];
}

function IssueSeverityTag({ severity }: IssueTagProps): JSX.Element {
  if (severity === "error") return <Tag color="red">Error</Tag>;
  if (severity === "warning") return <Tag color="gold">Warning</Tag>;
  return <Tag color="blue">Info</Tag>;
}

function statsColumns(): ColumnDef<ImportSectionStats>[] {
  return [
    { header: "Section", accessorKey: "section" },
    { header: "Total", accessorKey: "total" },
    { header: "Mapped", accessorKey: "mapped" },
    { header: "Normalized", accessorKey: "normalized" },
    { header: "Skipped", accessorKey: "skipped" },
    { header: "Blocked", accessorKey: "blocked" },
  ];
}

function StatsTable({ rows }: { rows: ImportSectionStats[] }): JSX.Element {
  const columns = useMemo(() => statsColumns(), []);
  return (
    <DataTable data={rows} columns={columns} minTableWidth={720} tableLayout="auto" sorting={false} />
  );
}

export function ImportWizard(): JSX.Element {
  const adapter = useStorageAdapter();
  const [mode, setMode] = useState<ImportMode>("replace_workspace");
  const [bundle, setBundle] = useState<DryRunBundle | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null);
  const [busyParse, setBusyParse] = useState(false);
  const [busyApply, setBusyApply] = useState(false);
  const [parseError, setParseError] = useState("");
  const [sourceInfo, setSourceInfo] = useState("");

  const stats = bundle?.report.sections || [];
  const issues = bundle?.report.issues || [];
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const mappedTotal = stats.reduce((sum, row) => sum + row.mapped, 0);

  async function handleFile(file: File): Promise<void> {
    setBusyParse(true);
    setParseError("");
    setApplyResult(null);

    try {
      const text = await file.text();
      const dryRun = runLegacyDryRunFromJson(text);
      setBundle(dryRun);
      setSourceInfo(`${file.name} · ${(file.size / 1024).toFixed(1)} KB`);
    } catch (error) {
      setBundle(null);
      setParseError(error instanceof Error ? error.message : "Datei konnte nicht verarbeitet werden.");
    } finally {
      setBusyParse(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!bundle) return;
    if (!bundle.report.canApply) return;
    setBusyApply(true);
    setParseError("");
    try {
      const result = await applyDryRunBundle(bundle, mode, adapter);
      setApplyResult(result);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Import konnte nicht angewendet werden.");
    } finally {
      setBusyApply(false);
    }
  }

  return (
    <div className="v2-import-wizard">
      <Card>
        <Title level={4}>Legacy JSON Migration Wizard</Title>
        <Paragraph>
          Best-Effort Import mit Dry-Run-Report. Vor jedem Apply wird automatisch ein Workspace-Backup erstellt.
        </Paragraph>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleFile(file);
            }}
          />
          {sourceInfo ? <Text type="secondary">Quelle: {sourceInfo}</Text> : null}
          {busyParse ? <Alert type="info" showIcon message="Dry-Run wird berechnet..." /> : null}
          {parseError ? <Alert type="error" showIcon message={parseError} /> : null}
          {bundle ? (
            <Alert
              type={bundle.report.canApply ? "success" : "warning"}
              showIcon
              message={`Quelle: ${bundle.report.sourceVersion} · Apply ${bundle.report.canApply ? "moeglich" : "nicht moeglich"}`}
              description={`Gemappte Datensaetze: ${mappedTotal}. Fehler: ${issues.filter((it) => it.severity === "error").length}.`}
            />
          ) : null}
        </Space>
      </Card>

      {bundle ? (
        <Card>
          <Space size={32} wrap>
            <Statistic title="Sections" value={stats.length} />
            <Statistic title="Mapped" value={mappedTotal} />
            <Statistic title="Warnings" value={issues.filter((it) => it.severity === "warning").length} />
            <Statistic title="Errors" value={issues.filter((it) => it.severity === "error").length} />
          </Space>
          <Divider />
          <StatsTable rows={stats} />
        </Card>
      ) : null}

      {issues.length ? (
        <Card>
          <Title level={5}>Issues</Title>
          <List
            size="small"
            dataSource={issues}
            renderItem={(issue) => (
              <List.Item>
                <Space direction="vertical" size={0}>
                  <Space>
                    <IssueSeverityTag severity={issue.severity} />
                    <Text strong>{issue.code}</Text>
                    <Text type="secondary">{issue.entityType}{issue.entityId ? ` · ${issue.entityId}` : ""}</Text>
                  </Space>
                  <Text>{issue.message}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      ) : null}

      {bundle ? (
        <Card>
          <Title level={5}>Apply</Title>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Radio.Group
              value={mode}
              onChange={(event) => setMode(event.target.value as ImportMode)}
            >
              <Radio value="replace_workspace">replace_workspace</Radio>
              <Radio value="merge_upsert">merge_upsert (existing wins)</Radio>
            </Radio.Group>
            <Button
              type="primary"
              onClick={() => {
                void handleApply();
              }}
              loading={busyApply}
              disabled={!bundle.report.canApply || hasErrors}
            >
              Apply Migration
            </Button>
            <Text type="secondary">
              Bei <code>merge_upsert</code> bleiben bestehende Daten bei Konflikten erhalten.
            </Text>
          </Space>
        </Card>
      ) : null}

      {applyResult ? (
        <Card>
          <Alert
            type="success"
            showIcon
            message="Migration angewendet"
            description={`Mode: ${applyResult.mode} · Backup: ${applyResult.backupId} · Zeitpunkt: ${applyResult.appliedAt}`}
          />
        </Card>
      ) : null}
    </div>
  );
}
