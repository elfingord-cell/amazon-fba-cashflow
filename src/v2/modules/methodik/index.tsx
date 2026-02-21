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

function normalizeCashInMode(value: unknown): "basis" | "conservative" {
  return String(value || "").trim().toLowerCase() === "basis" ? "basis" : "conservative";
}

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
  const cashInMode = normalizeCashInMode(settings.cashInMode);
  const cashInCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const cashInCalibrationHorizonMonths = normalizeCalibrationHorizonMonths(
    settings.cashInCalibrationHorizonMonths,
    6,
  );
  const cashInRecommendationIgnoreQ4 = settings.cashInRecommendationIgnoreQ4 === true;
  const cashInRecommendationBaselineNormalPct = normalizePayoutInput(settings.cashInRecommendationBaselineNormalPct)
    ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
  const cashInRecommendationBaselineQ4Pct = normalizePayoutInput(settings.cashInRecommendationBaselineQ4Pct);

  const statusLine = useMemo(() => {
    const modeLabel = cashInMode === "basis" ? "Basis" : "Konservativ";
    return [
      `Forecast: ${boolLabel(useForecast)}`,
      `Cash-In Modus: ${modeLabel}`,
      `Kalibrierung: ${boolLabel(cashInCalibrationEnabled)}${cashInCalibrationEnabled ? ` (${cashInCalibrationHorizonMonths} Monate)` : ""}`,
      `Q4 ignorieren: ${boolLabel(cashInRecommendationIgnoreQ4)}`,
    ].join(" · ");
  }, [
    cashInCalibrationEnabled,
    cashInCalibrationHorizonMonths,
    cashInMode,
    cashInRecommendationIgnoreQ4,
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
            <Col xs={24} md={12} xl={6}><Tag>Cash-In: {cashInMode === "basis" ? "Basis" : "Konservativ"}</Tag></Col>
            <Col xs={24} md={12} xl={6}><Tag>Kalibrierung: {boolLabel(cashInCalibrationEnabled)}{cashInCalibrationEnabled ? ` (${cashInCalibrationHorizonMonths} M)` : ""}</Tag></Col>
            <Col xs={24} md={12} xl={6}><Tag>Q4 ignorieren: {boolLabel(cashInRecommendationIgnoreQ4)}</Tag></Col>
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
              <Title level={5} style={{ margin: 0 }}>B) Cash-In Modus</Title>
              <Tag color="blue">GLOBAL</Tag>
              <Tooltip title="Konservativ: Abzug 1pp je Zukunftsmonat (max 5pp). Die finale Quote bleibt im Band 40..60%.">
                <Tag icon={<InfoCircleOutlined />}>Hilfe</Tag>
              </Tooltip>
            </Space>
            <Space align="center" wrap>
              <Text>Cash-In Modus:</Text>
              <Select
                value={cashInMode}
                options={[
                  { value: "basis", label: "Basis" },
                  { value: "conservative", label: "Konservativ" },
                ]}
                onChange={(value) => {
                  const nextMode = String(value || "").trim().toLowerCase() === "basis" ? "basis" : "conservative";
                  void updateMethodikSettings(
                    { cashInMode: nextMode },
                    `v2:methodik:cashin-mode:${nextMode}`,
                  );
                }}
                style={{ width: 220 }}
              />
            </Space>
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
              <Title level={5} style={{ margin: 0 }}>D) Empfehlung-Regeln (Erweitert)</Title>
              <Tag color="blue">GLOBAL</Tag>
            </Space>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox
                checked={cashInRecommendationIgnoreQ4}
                onChange={(event) => {
                  void updateMethodikSettings(
                    { cashInRecommendationIgnoreQ4: event.target.checked },
                    `v2:methodik:recommendation-ignore-q4:${event.target.checked ? "on" : "off"}`,
                  );
                }}
              >
                Q4 bei Empfehlung ignorieren
              </Checkbox>
              <Space wrap>
                <Space align="center">
                  <Text>Baseline Normal %</Text>
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
                <Space align="center">
                  <Text>Baseline Q4 %</Text>
                  <DeNumberInput
                    value={cashInRecommendationBaselineQ4Pct ?? undefined}
                    mode="percent"
                    min={CASH_IN_QUOTE_MIN_PCT}
                    max={CASH_IN_QUOTE_MAX_PCT}
                    step={0.1}
                    style={{ width: 128 }}
                    onChange={(value) => {
                      if (value == null || String(value).trim() === "") {
                        void updateMethodikSettings(
                          { cashInRecommendationBaselineQ4Pct: null },
                          "v2:methodik:recommendation-baseline-q4:auto",
                        );
                        return;
                      }
                      const parsed = normalizePayoutInput(value);
                      if (!Number.isFinite(parsed as number)) return;
                      void updateMethodikSettings(
                        { cashInRecommendationBaselineQ4Pct: parsed },
                        "v2:methodik:recommendation-baseline-q4",
                      );
                    }}
                  />
                  <Button
                    size="small"
                    onClick={() => {
                      void updateMethodikSettings(
                        { cashInRecommendationBaselineQ4Pct: null },
                        "v2:methodik:recommendation-baseline-q4:auto",
                      );
                    }}
                  >
                    Auto
                  </Button>
                </Space>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
