import { useMemo } from "react";
import { Card, Tabs, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import FoModule from "../fo";
import PoModule from "../po";

const { Paragraph, Title } = Typography;

function resolveOrdersTab(pathname: string): "po" | "fo" {
  if (pathname.includes("/orders/fo")) return "fo";
  return "po";
}

export default function OrdersModule(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo(() => resolveOrdersTab(location.pathname), [location.pathname]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Bestellungen</Title>
            <Paragraph>
              Gemeinsamer Arbeitsbereich für Forecast Orders und Purchase Orders mit schneller FO-zu-PO Übergabe.
            </Paragraph>
          </div>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(next) => navigate(`/v2/orders/${next}`)}
        items={[
          {
            key: "po",
            label: "Purchase Orders",
            children: <PoModule embedded />,
          },
          {
            key: "fo",
            label: "Forecast Orders",
            children: <FoModule embedded />,
          },
        ]}
      />
    </div>
  );
}
