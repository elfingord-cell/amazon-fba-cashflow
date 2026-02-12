import { Card, Tabs, Typography } from "antd";
import { LegacyMount } from "../../components/LegacyMount";
import { ImportWizard } from "./ImportWizard";

const { Paragraph, Title } = Typography;

export default function ExportImportPage(): JSX.Element {
  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Export / Import (V2)</Title>
        <Paragraph>
          Neuer Migrationswizard fuer Legacy JSON mit Dry-Run und Apply sowie weiterhin Zugriff auf den bestehenden
          Export/Import-Tab fuer Rueckwaertskompatibilitaet.
        </Paragraph>
      </Card>

      <Tabs
        defaultActiveKey="wizard"
        items={[
          {
            key: "wizard",
            label: "V2 Migration Wizard",
            children: <ImportWizard />,
          },
          {
            key: "legacy",
            label: "Legacy Export/Import",
            children: <LegacyMount loader={() => import("../../../ui/export.js")} />,
          },
        ]}
      />
    </div>
  );
}
