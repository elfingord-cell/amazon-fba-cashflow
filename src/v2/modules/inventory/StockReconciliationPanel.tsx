import { useMemo } from "react";
import { Alert, Card, Collapse, Space, Tag, Tooltip, Typography } from "antd";

const { Title, Text } = Typography;

// VentoryOne-Abgleich (Stueck-Ebene, pro SKU) fuer einen Bestands-Snapshot.
//
// Beantwortet "warum weicht der CFP-Bestand von VentoryOne ab?" ohne Live-VO-Abruf:
//   - VO-Aequivalent = CFP-Bestand - reserviert  (= was VOs TotalSupplyQuantity zeigt)
//   - projizierter Stand heute = Bestand - velocityPerDay * Tage_seit_capturedAt
// Nutzt nur im Snapshot gespeicherte Daten (components, velocityPerDay, capturedAt; ab Juni 2026).

interface SnapshotComponents {
  inStock?: number;
  reserved?: number;
  wh?: number;
  onTheWay?: number;
}
interface SnapshotItem {
  sku?: string;
  amazonUnits?: number;
  threePLUnits?: number;
  velocityPerDay?: number;
  components?: SnapshotComponents;
}
interface Props {
  snapshot: Record<string, unknown> | null;
  productBySku: Map<string, Record<string, unknown>>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("de-DE");
}
function productLabel(raw: Record<string, unknown> | undefined, sku: string): string {
  if (!raw) return sku;
  const alias = String(raw.alias || raw.name || raw.title || "").trim();
  return alias || sku;
}

export function StockReconciliationPanel({ snapshot, productBySku }: Props): JSX.Element | null {
  const model = useMemo(() => {
    if (!snapshot) return null;
    const items = (Array.isArray(snapshot.items) ? snapshot.items : []) as SnapshotItem[];
    const capturedAt = snapshot.capturedAt ? String(snapshot.capturedAt) : null;

    // Tage seit Snapshot-Erfassung (fuer die Velocity-Projektion).
    let daysSince = 0;
    if (capturedAt) {
      const ms = Date.now() - new Date(capturedAt).getTime();
      daysSince = ms > 0 ? ms / 86_400_000 : 0;
    }

    const rows = items
      .filter((it) => it && it.components && typeof it.components === "object")
      .map((it) => {
        const c = it.components || {};
        const inStock = num(c.inStock);
        const reserved = num(c.reserved);
        const transit = num(c.onTheWay);
        const wh = num(c.wh);
        const bestand = num(it.amazonUnits) + num(it.threePLUnits);
        const voEquiv = inStock + transit; // = bestand - reserved - wh? -> = InStock + Transit (VO-Headline)
        const velocity = num(it.velocityPerDay);
        const expectedSold = velocity * daysSince;
        const projVoToday = Math.max(0, Math.round(voEquiv - expectedSold));
        const sku = String(it.sku || "");
        return {
          sku,
          label: productLabel(productBySku.get(sku), sku),
          bestand, inStock, reserved, transit, wh, voEquiv, velocity,
          projVoToday,
        };
      })
      .sort((a, b) => b.bestand - a.bestand);

    const totals = rows.reduce(
      (acc, r) => {
        acc.bestand += r.bestand; acc.reserved += r.reserved; acc.transit += r.transit;
        acc.wh += r.wh; acc.voEquiv += r.voEquiv; acc.projVoToday += r.projVoToday;
        return acc;
      },
      { bestand: 0, reserved: 0, transit: 0, wh: 0, voEquiv: 0, projVoToday: 0 },
    );

    return { rows, totals, capturedAt, daysSince };
  }, [snapshot, productBySku]);

  if (!model) return null;

  if (model.rows.length === 0) {
    return (
      <Card style={{ marginTop: 12 }}>
        <Title level={4} style={{ marginTop: 0 }}>VentoryOne-Abgleich</Title>
        <Alert
          type="info"
          showIcon
          message="Für diesen Snapshot liegen keine Komponenten/Velocity vor"
          description="Der SKU-genaue VO-Abgleich braucht die ab Juni 2026 gespeicherten Rohkomponenten (InStock/reserviert/Transit) und die Velocity. Ältere Snapshots haben diese Felder nicht — bitte einen aktuellen Snapshot über die fba-cli ziehen."
        />
      </Card>
    );
  }

  const daysLabel = model.daysSince < 0.5
    ? "heute erfasst"
    : `vor ${model.daysSince.toFixed(1)} Tagen erfasst`;
  const capturedLabel = model.capturedAt
    ? new Date(model.capturedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  const th: React.CSSProperties = { padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" };
  const thL: React.CSSProperties = { padding: "6px 8px", textAlign: "left" };
  const td: React.CSSProperties = { padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" };
  const tdL: React.CSSProperties = { padding: "5px 8px", textAlign: "left" };

  const table = (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--v2-border, #e5e7eb)" }}>
            <th style={thL}>Produkt</th>
            <th style={th}>CFP-Bestand</th>
            <th style={th}>reserviert</th>
            <th style={th}>Transit</th>
            <th style={th}>3PL</th>
            <th style={th}><Tooltip title="CFP-Bestand − reserviert = was VentoryOne (TotalSupplyQuantity) anzeigt">VO-Äquiv.</Tooltip></th>
            <th style={th}><Tooltip title="Verkäufe pro Tag — VentoryOne 3-Tage-Schnitt (reagiert am schnellsten auf den aktuellen Abverkauf)">Velocity/Tag</Tooltip></th>
            <th style={th}><Tooltip title="VO-Äquivalent − Velocity × Tage seit Snapshot ≈ heutiger VentoryOne-Stand">proj. VO heute</Tooltip></th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.sku} style={{ borderBottom: "1px solid var(--v2-border, #f0f0f0)" }}>
              <td style={tdL}><Text strong>{r.label}</Text> <Text type="secondary" style={{ fontSize: 11 }}>{r.sku}</Text></td>
              <td style={td}>{fmt(r.bestand)}</td>
              <td style={{ ...td, color: r.reserved > 0 ? "#92400e" : undefined }}>{r.reserved ? fmt(r.reserved) : "–"}</td>
              <td style={td}>{r.transit ? fmt(r.transit) : "–"}</td>
              <td style={td}>{r.wh ? fmt(r.wh) : "–"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{fmt(r.voEquiv)}</td>
              <td style={td}>{r.velocity ? r.velocity.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{fmt(r.projVoToday)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--v2-border, #e5e7eb)", fontWeight: 700 }}>
            <td style={tdL}>Summe</td>
            <td style={td}>{fmt(model.totals.bestand)}</td>
            <td style={td}>{fmt(model.totals.reserved)}</td>
            <td style={td}>{fmt(model.totals.transit)}</td>
            <td style={td}>{fmt(model.totals.wh)}</td>
            <td style={td}>{fmt(model.totals.voEquiv)}</td>
            <td style={td}>—</td>
            <td style={td}>{fmt(model.totals.projVoToday)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <Card style={{ marginTop: 12 }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} align="start" wrap>
          <div>
            <Title level={4} style={{ margin: 0 }}>VentoryOne-Abgleich (Projektion auf heute)</Title>
            <Text type="secondary">
              Erklärt SKU-genau, warum der CFP-Bestand von VentoryOne abweicht — ohne Live-Abruf, rein aus den Snapshot-Daten.
            </Text>
          </div>
          <Tag color="blue">{capturedLabel} · {daysLabel}</Tag>
        </Space>

        <Alert
          type="info"
          showIcon
          message="So liest du die Tabelle"
          description={(
            <span>
              <strong>VO-Äquiv.</strong> = CFP-Bestand − reserviert = das, was VentoryOne in der Headline (<Text code>TotalSupplyQuantity</Text>) zeigt.
              {" "}<strong>proj. VO heute</strong> = VO-Äquivalent − Velocity × Tage seit Snapshot ≈ der Stand, den du <em>jetzt</em> in VentoryOne sehen solltest.
              {" "}Reservierte zählen im CFP mit (dein Eigentum im FC), in VentoryOne nicht — daher die Spalte „VO-Äquiv.". Details: <Text strong>Methodik &amp; Regeln</Text>.
            </span>
          )}
        />

        <Collapse
          items={[{
            key: "table",
            label: `SKU-Tabelle (${model.rows.length} Produkte)`,
            children: table,
          }]}
          defaultActiveKey={["table"]}
        />
      </Space>
    </Card>
  );
}

export default StockReconciliationPanel;
