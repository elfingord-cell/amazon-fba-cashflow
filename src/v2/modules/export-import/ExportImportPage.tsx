import { Card, Tabs, Typography } from "antd";
import { ImportWizard } from "./ImportWizard";
import { WorkspaceTransferPanel } from "./WorkspaceTransferPanel";

const { Paragraph, Title } = Typography;

export default function ExportImportPage(): JSX.Element {
  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Export / Import (V2)</Title>
        <Paragraph>
          Neuer Migrationswizard fuer Legacy JSON mit Dry-Run/Apply sowie nativer Workspace JSON Transfer
          (Export, Backup, Import, Vorschau, Validierung).
        </Paragraph>
      </Card>

      <Tabs
        defaultActiveKey="transfer"
        items={[
          {
            key: "transfer",
            label: "Workspace JSON Transfer",
            children: <WorkspaceTransferPanel />,
          },
          {
            key: "wizard",
            label: "Legacy Migration Wizard",
            children: <ImportWizard />,
          },
        ]}
      />
    </div>
  );
}
