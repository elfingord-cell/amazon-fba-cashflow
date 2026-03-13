import { Card, Tabs, Typography } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import VatModule from "../vat";
import IncomeTaxesPanel from "./IncomeTaxesPanel";
import OssPanel from "./OssPanel";
import { buildTaxesLocation, resolveTaxesTab, TAXES_TAB_ITEMS } from "./tabs";

const { Paragraph, Title, Text } = Typography;

export default function TaxesModule(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return resolveTaxesTab(params.get("tab"));
  }, [location.search]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Steuern</Title>
            <Paragraph>
              Neues Dachmodul für Steuer-Themen. In diesem Increment speisen USt DE, OSS und Ertragsteuern gemeinsam den Steuer-Cashflow.
            </Paragraph>
          </div>
        </div>
        <Text type="secondary">
          USt DE bleibt methodisch die bestehende Vorschau. OSS ist jetzt als einfacher Proxy auf den Auslandsanteil aktiviert, ohne eine breitere OSS-Logik einzuführen.
        </Text>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(next) => navigate(buildTaxesLocation(location.pathname, location.search, resolveTaxesTab(next)))}
        items={TAXES_TAB_ITEMS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          children: tab.key === "ust-de"
            ? <VatModule embedded />
            : tab.key === "oss"
              ? <OssPanel />
              : <IncomeTaxesPanel />,
        }))}
      />
    </div>
  );
}
