import { Alert, Collapse, Tag, Typography } from "antd";

type CheckStatus = "green" | "amber" | "red";
type Check = { key: string; label: string; status: CheckStatus; detail: string; drill?: string };
type Audit = { lastRun?: string; overall?: CheckStatus; checks?: Check[] } | null | undefined;

const COLOR: Record<CheckStatus, string> = { green: "green", amber: "gold", red: "red" };
const ALERT: Record<CheckStatus, "success" | "warning" | "error"> = { green: "success", amber: "warning", red: "error" };

// Lese-Ampel fürs Vertrauen: zeigt das Ergebnis des letzten Glaubwürdigkeits-Audits (state.audit).
// Rein darstellend — keine Schreibvorgänge. Fehlt state.audit, steht "noch nicht geprüft".
export function CredibilityBadge({ audit }: { audit: Audit }) {
  if (!audit || !audit.overall) {
    return (
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Glaubwürdigkeit: noch nicht geprüft"
        description="Audit per CLI (node tools/fba-cli/cli.mjs audit --commit) oder wöchentlichem Task ausführen." />
    );
  }
  const checks = Array.isArray(audit.checks) ? audit.checks : [];
  const greens = checks.filter((c) => c.status === "green").length;
  const when = audit.lastRun ? new Date(audit.lastRun).toLocaleString("de-DE") : "—";
  return (
    <Alert
      type={ALERT[audit.overall]} showIcon style={{ marginBottom: 12 }}
      message={<span>Glaubwürdigkeit: <strong>{audit.overall.toUpperCase()}</strong> · {greens}/{checks.length} grün · geprüft {when}</span>}
      description={
        <Collapse ghost items={[{
          key: "checks", label: "Checks anzeigen",
          children: (
            <div>
              {checks.map((c) => (
                <div key={c.key} style={{ display: "flex", gap: 8, padding: "2px 0", alignItems: "baseline" }}>
                  <Tag color={COLOR[c.status]}>{c.label}</Tag>
                  <Typography.Text type="secondary">{c.detail}</Typography.Text>
                </div>
              ))}
            </div>
          ),
        }]} />
      } />
  );
}
