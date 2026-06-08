import { InfoCircleOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  CASH_IN_QUOTE_MAX_PCT,
  CASH_IN_QUOTE_MIN_PCT,
  clampPct,
  normalizeCalibrationHorizonMonths,
  parsePayoutPctInput,
} from "../../../domain/cashInRules.js";
import { DeNumberInput } from "../../components/DeNumberInput";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

function normalizePayoutInput(value: unknown): number | null {
  const parsed = parsePayoutPctInput(value);
  if (!Number.isFinite(parsed as number)) return null;
  return clampPct(Number(parsed), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
}

function boolLabel(value: boolean): string {
  return value ? "An" : "Aus";
}

export default function MethodikModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [messageApi, contextHolder] = message.useMessage();

  const settings = (state.settings || {}) as Record<string, unknown>;
  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastSettings = (forecast.settings && typeof forecast.settings === "object")
    ? forecast.settings as Record<string, unknown>
    : {};

  const useForecast = forecastSettings.useForecast === true;
  const cashInCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const cashInCalibrationHorizonMonths = normalizeCalibrationHorizonMonths(
    settings.cashInCalibrationHorizonMonths,
    6,
  );
  const cashInRecommendationSeasonalityEnabled = settings.cashInRecommendationSeasonalityEnabled == null
    ? settings.cashInRecommendationIgnoreQ4 !== true
    : settings.cashInRecommendationSeasonalityEnabled !== false;
  const cashInRecommendationBaselineNormalPct = normalizePayoutInput(settings.cashInRecommendationBaselineNormalPct)
    ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;

  const statusLine = useMemo(() => {
    return [
      `Forecast: ${boolLabel(useForecast)}`,
      "Cash-In Quote: Empfohlen (Plan)",
      `Kalibrierung: ${boolLabel(cashInCalibrationEnabled)}${cashInCalibrationEnabled ? ` (${cashInCalibrationHorizonMonths} Monate)` : ""}`,
      `Saisonalität: ${boolLabel(cashInRecommendationSeasonalityEnabled)}`,
    ].join(" · ");
  }, [
    cashInCalibrationEnabled,
    cashInCalibrationHorizonMonths,
    cashInRecommendationSeasonalityEnabled,
    useForecast,
  ]);

  async function updateMethodikSettings(patch: Record<string, unknown>, source: string): Promise<void> {
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const stateDraft = next as unknown as Record<string, unknown>;
        const settingsDraft = (stateDraft.settings && typeof stateDraft.settings === "object")
          ? stateDraft.settings as Record<string, unknown>
          : {};
        stateDraft.settings = {
          ...settingsDraft,
          ...patch,
        };
        return next;
      }, source);
    } catch (saveError) {
      messageApi.error(saveError instanceof Error ? saveError.message : "Methodik konnte nicht gespeichert werden.");
    }
  }

  async function updateForecastSettings(patch: Record<string, unknown>, source: string): Promise<void> {
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const stateDraft = next as unknown as Record<string, unknown>;
        if (!stateDraft.forecast || typeof stateDraft.forecast !== "object") {
          stateDraft.forecast = {};
        }
        const forecastDraft = stateDraft.forecast as Record<string, unknown>;
        const forecastSettingsDraft = (forecastDraft.settings && typeof forecastDraft.settings === "object")
          ? forecastDraft.settings as Record<string, unknown>
          : {};
        forecastDraft.settings = {
          ...forecastSettingsDraft,
          ...patch,
        };
        return next;
      }, source);
    } catch (saveError) {
      messageApi.error(saveError instanceof Error ? saveError.message : "Forecast-Methodik konnte nicht gespeichert werden.");
    }
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Methodik &amp; Regeln</Title>
            <Paragraph>
              Zentraler Ort für globale Rechenlogik. Änderungen wirken global auf Dashboard, Soll/Ist, USt und weitere Auswertungen.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            {saving ? <Tag color="processing">Speichern...</Tag> : <Tag color="green">Synchron</Tag>}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space wrap>
            <Title level={5} style={{ margin: 0 }}>Aktive Rechenbasis (global)</Title>
            <Tag color="blue">GLOBAL</Tag>
          </Space>
          <Text>{statusLine}</Text>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12} xl={6}><Tag color={useForecast ? "green" : "default"}>Forecast: {boolLabel(useForecast)}</Tag></Col>
            <Col xs={24} md={12} xl={6}><Tag>Cash-In Quote: Empfohlen (Plan)</Tag></Col>
            <Col xs={24} md={12} xl={6}><Tag>Kalibrierung: {boolLabel(cashInCalibrationEnabled)}{cashInCalibrationEnabled ? ` (${cashInCalibrationHorizonMonths} M)` : ""}</Tag></Col>
            <Col xs={24} md={12} xl={6}><Tag>Saisonalität: {boolLabel(cashInRecommendationSeasonalityEnabled)}</Tag></Col>
          </Row>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card>
            <Space wrap style={{ marginBottom: 8 }}>
              <Title level={5} style={{ margin: 0 }}>A) Forecast-Nutzung</Title>
              <Tag color="blue">GLOBAL</Tag>
            </Space>
            <Checkbox
              checked={useForecast}
              onChange={(event) => {
                void updateForecastSettings(
                  { useForecast: event.target.checked },
                  `v2:methodik:forecast-use:${event.target.checked ? "on" : "off"}`,
                );
              }}
            >
              Absatzprognose im Cashflow nutzen
            </Checkbox>
            <div>
              <Text type="secondary">Wirkt global auf Dashboard, Soll/Ist, USt, …</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card>
            <Space wrap style={{ marginBottom: 8 }}>
              <Title level={5} style={{ margin: 0 }}>B) Auszahlungsquote (Plan)</Title>
              <Tag color="blue">GLOBAL</Tag>
              <Tooltip title="Empfohlen (Plan) nutzt Niveau + Saisonmuster - kleine Sicherheitsmarge. Manuell/Eingaben steuerst du im Dashboard oder in der Sandbox.">
                <Tag icon={<InfoCircleOutlined />}>Hilfe</Tag>
              </Tooltip>
            </Space>
            <Text>
              Kein separater Basis/Konservativ-Modus mehr. Die Empfehlung bleibt leicht vorsichtig über die
              integrierte Sicherheitsmarge.
            </Text>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card>
            <Space wrap style={{ marginBottom: 8 }}>
              <Title level={5} style={{ margin: 0 }}>C) Umsatz-Kalibrierung</Title>
              <Tag color="blue">GLOBAL</Tag>
            </Space>
            <Space wrap>
              <Checkbox
                checked={cashInCalibrationEnabled}
                onChange={(event) => {
                  void updateMethodikSettings(
                    { cashInCalibrationEnabled: event.target.checked },
                    `v2:methodik:calibration-enabled:${event.target.checked ? "on" : "off"}`,
                  );
                }}
              >
                Umsatz-Kalibrierung aktiv
              </Checkbox>
              <Space align="center">
                <Text>Wirkt über:</Text>
                <Select
                  value={cashInCalibrationHorizonMonths}
                  options={[
                    { value: 3, label: "3 Monate" },
                    { value: 6, label: "6 Monate" },
                    { value: 12, label: "12 Monate" },
                  ]}
                  onChange={(value) => {
                    const horizon = normalizeCalibrationHorizonMonths(value, 6);
                    void updateMethodikSettings(
                      { cashInCalibrationHorizonMonths: horizon },
                      `v2:methodik:calibration-horizon:${horizon}`,
                    );
                  }}
                  style={{ width: 160 }}
                />
              </Space>
            </Space>
            <div>
              <Text type="secondary">Kalibriert nur Umsatz (Cash-In), keine Units/Absatz.</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card>
            <Space wrap style={{ marginBottom: 8 }}>
              <Title level={5} style={{ margin: 0 }}>D) Empfehlung-Regeln (Lernend)</Title>
              <Tag color="blue">GLOBAL</Tag>
            </Space>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox
                checked={cashInRecommendationSeasonalityEnabled}
                onChange={(event) => {
                  const nextEnabled = event.target.checked;
                  void updateMethodikSettings(
                    {
                      cashInRecommendationSeasonalityEnabled: nextEnabled,
                      cashInRecommendationIgnoreQ4: !nextEnabled,
                    },
                    `v2:methodik:recommendation-seasonality:${nextEnabled ? "on" : "off"}`,
                  );
                }}
              >
                Saisonalität in Empfehlung aktivieren
              </Checkbox>
              <Space wrap>
                <Space align="center">
                  <Text>Startniveau L (%)</Text>
                  <DeNumberInput
                    value={cashInRecommendationBaselineNormalPct}
                    mode="percent"
                    min={CASH_IN_QUOTE_MIN_PCT}
                    max={CASH_IN_QUOTE_MAX_PCT}
                    step={0.1}
                    style={{ width: 128 }}
                    onChange={(value) => {
                      const parsed = normalizePayoutInput(value);
                      if (!Number.isFinite(parsed as number)) return;
                      void updateMethodikSettings(
                        { cashInRecommendationBaselineNormalPct: parsed },
                        "v2:methodik:recommendation-baseline-normal",
                      );
                    }}
                  />
                </Space>
              </Space>
              <Text type="secondary">
                Für ein robustes Startprofil (historische Quoten) bitte im Cash-in Setup den Import im Cash-In-Block nutzen.
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Title level={5} style={{ margin: 0 }}>Produkt-Reifegrade &amp; Forecast-Quellen</Title>
          <Text type="secondary">
            Zwei getrennte Achsen: <strong>Reifegrad/Lebenszyklus</strong> (= die Dashboard-Buckets Kern/Plan/Ideen) und die
            daraus abgeleitete <strong>Forecast-Quelle</strong>. So ist klar, warum ein Plan-Produkt im Forecast erscheint, aber
            nicht „aktiv“ ist.
          </Text>
          <table className="v2-reifegrad-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 4 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--v2-border, #e5e7eb)" }}>
                <th style={{ padding: "6px 8px" }}>Reifegrad (Dashboard-Bucket)</th>
                <th style={{ padding: "6px 8px" }}>Lebenszyklus</th>
                <th style={{ padding: "6px 8px" }}>SKU/ASIN?</th>
                <th style={{ padding: "6px 8px" }}>verkauft?</th>
                <th style={{ padding: "6px 8px" }}>Forecast-Quelle</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Ideenprodukt", "Geplant", "nein", "nein", "Plan (grob) / keine"],
                ["Planprodukt", "Prelaunch", "ja", "nein", "Plan-Brücke (Baseline × Saisonalität)"],
                ["Kernprodukt", "Aktiv", "ja", "ja", "VentoryOne-Live (Verkaufshistorie)"],
                ["Kernprodukt", "Auslaufend", "ja", "ja (Restbestand)", "VO-Live, am Bestand gedeckelt — kein Nachschub"],
                ["—", "Inaktiv", "ja", "nein", "— / manuell"],
              ].map((cells) => (
                <tr key={cells[0]} style={{ borderBottom: "1px solid var(--v2-border, #f0f0f0)" }}>
                  {cells.map((c, idx) => (
                    <td key={idx} style={{ padding: "6px 8px", fontWeight: idx === 0 ? 600 : 400 }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="Launch-Trigger (eine Quelle der Wahrheit)"
            description={(
              <span>
                Der Übergang <strong>Planprodukt → Kernprodukt</strong> passiert beim <strong>Launch</strong> (erste
                VentoryOne-Verkäufe / Live-Forecast), nicht schon bei PO-Anlage. Derselbe Trigger schaltet zugleich:
                Lebenszyklus Prelaunch → Aktiv und Quelle Plan → VO-Live; die Plan-Brücke phast sich pro Monat aus.
                Solange ein Produkt noch nicht gelauncht ist, steht es im VentoryOne-Import auf 0 (keine Historie) — die
                Plan-Brücke füllt die Lücke.
              </span>
            )}
          />
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
            message="Auslaufend (Sell-Through ohne Nachschub)"
            description={(
              <span>
                Ein Produkt mit dem Marker <strong>Auslaufend</strong> wird nicht mehr nachbestellt: Es erscheint in
                keiner Bestell-/PO-/FO-Empfehlung mehr. Der Forecast-Umsatz läuft aber weiter, <strong>gedeckelt am
                verfügbaren Bestand</strong> (jüngster Snapshot): solange kumulierte Forecast-Stück ≤ Bestand voller
                Umsatz, der Überlaufmonat anteilig, danach 0. Bestand 0 ⇒ sofort 0. Die Deckelung wird bei jeder
                Berechnung frisch ermittelt und übersteht VentoryOne-Re-Imports. Geändert wird der Marker in der
                Produkt-Tabelle. Hinweis: Forecast-Import-Zeilen ohne zugehöriges Produkt (verwaist) zählen gar nicht
                mehr in den Cashflow.
              </span>
            )}
          />
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Title level={5} style={{ margin: 0 }}>Änderungs-Log (letzte Writes)</Title>
          <Text type="secondary">
            Jeder API-/CLI-Write hinterlässt einen Eintrag (Zeit · was · Quelle · rev). Lückenloser Audit-Trail —
            so ist nachvollziehbar, wer wann woher etwas geändert hat.
          </Text>
          {(() => {
            const log = Array.isArray((state as Record<string, unknown>).changeLog)
              ? [...((state as Record<string, unknown>).changeLog as Array<Record<string, unknown>>)].reverse()
              : [];
            if (!log.length) return <Text type="secondary">Noch keine Einträge (entsteht ab dem nächsten API-Write).</Text>;
            return (
              <table className="v2-reifegrad-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--v2-border, #e5e7eb)" }}>
                    <th style={{ padding: "4px 8px" }}>Zeit</th>
                    <th style={{ padding: "4px 8px" }}>Was</th>
                    <th style={{ padding: "4px 8px" }}>Quelle</th>
                    <th style={{ padding: "4px 8px" }}>rev</th>
                  </tr>
                </thead>
                <tbody>
                  {log.slice(0, 30).map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--v2-border, #f0f0f0)" }}>
                      <td style={{ padding: "4px 8px" }}>{e.at ? new Date(String(e.at)).toLocaleString("de-DE") : "—"}</td>
                      <td style={{ padding: "4px 8px" }}>{String(e.label || "")}{e.summary ? ` · ${String(e.summary)}` : ""}</td>
                      <td style={{ padding: "4px 8px" }}>{String(e.source || "—")}</td>
                      <td style={{ padding: "4px 8px" }}>{String(e.rev || "").slice(0, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Title level={5} style={{ margin: 0 }}>Bestands-Snapshot (VentoryOne → CFP)</Title>
          <Text type="secondary">
            Wie der Monats-Snapshot in der <strong>Bestandsaufnahme</strong> aus VentoryOne-Live-Daten gebildet wird —
            und warum die Zahl bewusst <strong>nicht</strong> exakt der VentoryOne-Anzeige entspricht.
          </Text>
          <table className="v2-reifegrad-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 4 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--v2-border, #e5e7eb)" }}>
                <th style={{ padding: "6px 8px" }}>Spalte im Snapshot</th>
                <th style={{ padding: "6px 8px" }}>zählt</th>
                <th style={{ padding: "6px 8px" }}>VentoryOne-Feld</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Amazon", "verfügbar + reserviert + Transit zu FBA", "InStockSupplyQuantity + afn_reserved_quantity + fba_pcs_on_the_way"],
                ["3PL", "nur externes Lager (Majamo)", "wh_pcs_left"],
              ].map((cells) => (
                <tr key={cells[0]} style={{ borderBottom: "1px solid var(--v2-border, #f0f0f0)" }}>
                  {cells.map((c, idx) => (
                    <td key={idx} style={{ padding: "6px 8px", fontWeight: idx === 0 ? 600 : 400 }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="Warum CFP ≠ VentoryOne — und das ist Absicht"
            description={(
              <span>
                <strong>Reservierte zählen im CFP mit</strong> (sie liegen physisch im Amazon-FC und sind mahonas
                Eigentum bis zur Auslieferung) — der CFP-Snapshot ist also ein vollständiger <strong>Eigentums-/Bestandswert</strong>.
                VentoryOnes Anzeige (<Text code>TotalSupplyQuantity</Text>) lässt die reservierten weg. Daraus folgt die
                Faustregel: <strong>CFP ≈ VentoryOne + reservierte</strong>.
                <br /><br />
                Der Snapshot ist außerdem ein <strong>eingefrorenes Stichtags-Foto</strong>. Wenn du ihn mit dem
                VentoryOne-Live-Stand vergleichst, liegen die täglichen Verkäufe dazwischen — pro vergangenem Tag rund die
                Sales-Velocity abziehen (<Text code>Snapshot − Velocity × Tage ≈ Live</Text>). Gleich sind beide nur am selben Tag.
                <br /><br />
                <Text type="secondary">
                  Beispiel Satteltasche: CFP 884 = VentoryOne 842 + 42 reservierte. Die Rohkomponenten
                  (InStock/reserviert/wh/Transit) werden je SKU im Snapshot gespeichert. Gültig ab Juni 2026 (GF-Entscheidung 2026-06-01).
                </Text>
              </span>
            )}
          />
        </Space>
      </Card>
    </div>
  );
}
