import { useMemo } from "react";
import { Card, Tabs, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import FoModule from "../fo";
import PoModule from "../po";
import SkuTimelineView from "./SkuTimelineView";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Title } = Typography;

function resolveOrdersTab(pathname: string): "po" | "fo" | "sku" {
  if (pathname.includes("/orders/sku")) return "sku";
  if (pathname.includes("/orders/fo")) return "fo";
  return "po";
}

export default function OrdersModule(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useWorkspaceState();

  const activeTab = useMemo(() => resolveOrdersTab(location.pathname), [location.pathname]);
  const paymentRows = useMemo(() => {
    return (Array.isArray(state.payments) ? state.payments : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        id: String(entry.id || ""),
        paidDate: String(entry.paidDate || ""),
        method: String(entry.method || "—"),
        payer: String(entry.payer || "—"),
        amountActualEurTotal: Number(entry.amountActualEurTotal || 0),
        coveredCount: Array.isArray(entry.coveredEventIds) ? entry.coveredEventIds.length : 0,
      }))
      .filter((entry) => entry.id)
      .sort((a, b) => String(b.paidDate || "").localeCompare(String(a.paidDate || "")))
      .slice(0, 12);
  }, [state.payments]);

  const paidSum = useMemo(
    () => paymentRows.reduce((sum, row) => sum + Number(row.amountActualEurTotal || 0), 0),
    [paymentRows],
  );

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

      <Card style={{ marginBottom: 12 }}>
        <div className="v2-page-head">
          <div>
            <Title level={5}>Zahlungsprotokoll (PO-Ist)</Title>
            <Paragraph>
              Tatsächlich bestätigte Zahlungen werden nur auf POs gebucht. FOs bleiben Planobjekte.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar-row" style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary">Eintraege: {paymentRows.length}</Typography.Text>
          <Typography.Text type="secondary">
            Summe Ist: {paidSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
          </Typography.Text>
        </div>
        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table" data-layout="auto">
            <thead>
              <tr>
                <th>Payment-ID</th>
                <th>Paid Date</th>
                <th>Methode</th>
                <th>Durch</th>
                <th>Ist EUR</th>
                <th>Abgedeckte Events</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.length ? paymentRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.paidDate || "—"}</td>
                  <td>{row.method}</td>
                  <td>{row.payer}</td>
                  <td>{Number(row.amountActualEurTotal || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
                  <td>{row.coveredCount}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>Noch keine Zahlungen verbucht.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(next) => navigate(`/v2/orders/${next}`)}
        items={[
          {
            key: "po",
            label: "Bestellungen (PO)",
            children: <PoModule embedded />,
          },
          {
            key: "fo",
            label: "Forecast Orders (FO)",
            children: <FoModule embedded />,
          },
          {
            key: "sku",
            label: "SKU Sicht",
            children: <SkuTimelineView />,
          },
        ]}
      />
    </div>
  );
}
