import { Card, Tabs, Typography } from "antd";
import { ImportWizard } from "./ImportWizard";
import { WorkspaceTransferPanel } from "./WorkspaceTransferPanel";

const { Paragraph, Title } = Typography;

export default function ExportImportPage(): JSX.Element {
  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Export / Import</Title>
            <Paragraph>
              Neuer Migrationswizard fuer Legacy JSON mit Dry-Run/Apply sowie nativer Workspace JSON Transfer
              (Export, Backup, Import, Vorschau, Validierung).
            </Paragraph>
          </div>
        </div>
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
