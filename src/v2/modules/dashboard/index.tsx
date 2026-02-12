import { Card, Col, Row, Typography } from "antd";
import { LegacyMount } from "../../components/LegacyMount";
import { PlaceholderChart } from "../../components/PlaceholderChart";

const { Paragraph, Title } = Typography;

export default function DashboardModule(): JSX.Element {
  return (
    <div className="v2-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card className="v2-intro-card">
            <Title level={3}>V2 Dashboard</Title>
            <Paragraph>
              Parallelbetrieb unter <code>#/v2/...</code>. Unten laeuft das bestehende Dashboard fuer volle
              Funktionalitaet, waehrend neue V2-Komponenten schrittweise ersetzt werden.
            </Paragraph>
            <PlaceholderChart />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card className="v2-intro-card">
            <Title level={4}>Migrationsstatus</Title>
            <Paragraph>
              Phase 1/2 aktiv: neue Shell, Routing, Sync-Adapter und Import-Wizard sind implementiert.
            </Paragraph>
          </Card>
        </Col>
      </Row>
      <LegacyMount loader={() => import("../../../ui/dashboard.js")} />
    </div>
  );
}
