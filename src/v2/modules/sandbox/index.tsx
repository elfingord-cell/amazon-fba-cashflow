import { InfoCircleOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { computeSeries } from "../../../domain/cashflow.js";
import { parsePayoutPctInput } from "../../../domain/cashInRules.js";
import { formatMonthLabel } from "../../domain/months";
import type { DashboardBreakdownRow, DashboardEntry } from "../../domain/dashboardMaturity";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type RevenueBasisMode = "hybrid" | "forecast_direct";
type RevenueCalibrationMode = "forecast" | "calibrated";
type CashInQuoteMode = "manual" | "recommendation";

interface SandboxScenario {
  revenueBasisMode: RevenueBasisMode;
  calibrationEnabled: boolean;
  quoteMode: CashInQuoteMode;
}

interface SeriesResult {
  months?: string[];
  breakdown?: DashboardBreakdownRow[];
}

interface MonthMetaSnapshot {
  month: string;
  payoutPct: number | null;
  manualPayoutPct: number | null;
  recommendationQuotePct: number | null;
  recommendationLevelPct: number | null;
  recommendationSeasonalityPct: number | null;
  recommendationSafetyMarginPct: number | null;
  recommendationRiskAdjustmentPct: number | null;
  recommendationSeasonalitySourceTag: string | null;
  recommendationSourceTag: string | null;
}

interface SandboxQuoteRow {
  key: string;
  month: string;
  monthLabel: string;
  manualQuote: number | null;
  recommendedQuote: number | null;
  levelPct: number | null;
  seasonalityOffsetPct: number | null;
  safetyMarginPct: number | null;
  deltaPct: number | null;
  activeQuote: number | null;
  seasonalitySourceTag: string | null;
}

const DEFAULT_REVENUE_MODE: RevenueBasisMode = "hybrid";

function toFiniteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function formatSignedPp(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  const absText = Math.abs(numeric).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (numeric > 0) return `+${absText} pp`;
  if (numeric < 0) return `−${absText} pp`;
  return `${absText} pp`;
}

function deltaClassName(value: number | null | undefined): string | undefined {
  if (!Number.isFinite(Number(value))) return undefined;
  const numeric = Number(value);
  if (Math.abs(numeric) <= 0.000001) return undefined;
  return numeric > 0 ? "v2-sandbox-delta-positive" : "v2-sandbox-delta-negative";
}

function normalizeSeasonalitySourceTag(value: string | null): string | null {
  const tag = String(value || "").trim();
  if (!tag) return null;
  if (tag === "recent_dominant") return "Junge Monate";
  if (tag === "stabilized_history") return "Stabilisiert";
  if (tag === "stabilized_prior") return "Historie";
  if (tag === "no_data") return "Keine Historie";
  if (tag === "disabled") return "Aus";
  return tag;
}

function collectManualQuoteByMonth(state: Record<string, unknown>): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const incomings = Array.isArray(state.incomings) ? state.incomings as Record<string, unknown>[] : [];
  incomings.forEach((incoming) => {
    const month = String(incoming?.month || "").trim();
    if (!month) return;
    const parsed = parsePayoutPctInput(incoming?.payoutPct);
    out.set(month, Number.isFinite(parsed as number) ? Number(parsed) : null);
  });
  return out;
}

function applySandboxCalculationOverrides(
  sourceState: Record<string, unknown>,
  options: SandboxScenario,
): Record<string, unknown> {
  const next = structuredClone(sourceState || {});
  if (!next.settings || typeof next.settings !== "object") {
    next.settings = {};
  }
  if (!next.forecast || typeof next.forecast !== "object") {
    next.forecast = {};
  }

  const settings = next.settings as Record<string, unknown>;
  const forecastState = next.forecast as Record<string, unknown>;
  if (!forecastState.settings || typeof forecastState.settings !== "object") {
    forecastState.settings = {};
  }
  const forecastSettings = forecastState.settings as Record<string, unknown>;

  forecastSettings.useForecast = true;
  settings.cashInMode = "basis";
  settings.cashInCalibrationEnabled = options.calibrationEnabled;
  settings.cashInRevenueBasisMode = options.revenueBasisMode;
  settings.cashInRecommendationSeasonalityEnabled = true;
  settings.cashInRecommendationIgnoreQ4 = false;

  if (options.revenueBasisMode === "forecast_direct" && Array.isArray(next.incomings)) {
    next.incomings = (next.incomings as unknown[]).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...(entry as Record<string, unknown>),
        source: "forecast",
        revenueEur: null,
      };
    });
  }

  if (options.quoteMode === "recommendation" && Array.isArray(next.incomings)) {
    next.incomings = (next.incomings as unknown[]).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...(entry as Record<string, unknown>),
        payoutPct: null,
      };
    });
  }

  return next;
}

function extractCashInMeta(entry: DashboardEntry): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const meta = (entry.meta && typeof entry.meta === "object")
    ? entry.meta as Record<string, unknown>
    : null;
  if (!meta || !meta.cashIn || typeof meta.cashIn !== "object") return null;
  return meta.cashIn as Record<string, unknown>;
}

function buildSnapshotByMonth(report: SeriesResult): Map<string, MonthMetaSnapshot> {
  const rows = Array.isArray(report.breakdown) ? report.breakdown : [];
  const out = new Map<string, MonthMetaSnapshot>();

  rows.forEach((row) => {
    if (!row || !row.month) return;
    const entries = Array.isArray(row.entries) ? row.entries : [];
    const salesEntries = entries
      .filter((entry) => String(entry?.kind || "").toLowerCase() === "sales-payout");
    const firstMeta = salesEntries
      .map((entry) => extractCashInMeta(entry as DashboardEntry))
      .find((meta) => meta && typeof meta === "object") || null;

    out.set(row.month, {
      month: row.month,
      payoutPct: toFiniteOrNull(firstMeta?.payoutPct),
      manualPayoutPct: toFiniteOrNull(firstMeta?.manualPayoutPct),
      recommendationQuotePct: toFiniteOrNull(firstMeta?.recommendationQuotePct),
      recommendationLevelPct: toFiniteOrNull(firstMeta?.recommendationLevelPct),
      recommendationSeasonalityPct: toFiniteOrNull(firstMeta?.recommendationSeasonalityPct),
      recommendationSafetyMarginPct: toFiniteOrNull(firstMeta?.recommendationSafetyMarginPct),
      recommendationRiskAdjustmentPct: toFiniteOrNull(firstMeta?.recommendationRiskAdjustmentPct),
      recommendationSeasonalitySourceTag: firstMeta?.recommendationSeasonalitySourceTag
        ? String(firstMeta.recommendationSeasonalitySourceTag)
        : null,
      recommendationSourceTag: firstMeta?.recommendationSourceTag
        ? String(firstMeta.recommendationSourceTag)
        : null,
    });
  });

  return out;
}

export default function SandboxModule(): JSX.Element {
  const { state, loading, error } = useWorkspaceState();

  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const methodikCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const methodikRevenueBasisMode = String(settings.cashInRevenueBasisMode || "").trim().toLowerCase() === "forecast_direct"
    ? "forecast_direct"
    : DEFAULT_REVENUE_MODE;

  const [revenueCalibrationMode, setRevenueCalibrationMode] = useState<RevenueCalibrationMode>(
    methodikCalibrationEnabled ? "calibrated" : "forecast",
  );
  const [quoteMode, setQuoteMode] = useState<CashInQuoteMode>("manual");

  const stateObject = state as unknown as Record<string, unknown>;

  const scenarioBase = useMemo<SandboxScenario>(() => ({
    revenueBasisMode: methodikRevenueBasisMode,
    calibrationEnabled: revenueCalibrationMode === "calibrated",
    quoteMode: "manual",
  }), [methodikRevenueBasisMode, revenueCalibrationMode]);

  const scenarioSandbox = useMemo<SandboxScenario>(() => ({
    ...scenarioBase,
    quoteMode,
  }), [quoteMode, scenarioBase]);

  const scenarioRecommendation = useMemo<SandboxScenario>(() => ({
    ...scenarioBase,
    quoteMode: "recommendation",
  }), [scenarioBase]);

  const baseReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, scenarioBase)) as SeriesResult,
    [scenarioBase, stateObject],
  );
  const sandboxReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, scenarioSandbox)) as SeriesResult,
    [scenarioSandbox, stateObject],
  );
  const recommendationReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, scenarioRecommendation)) as SeriesResult,
    [scenarioRecommendation, stateObject],
  );

  const manualQuoteByMonth = useMemo(
    () => collectManualQuoteByMonth(stateObject),
    [state.incomings, stateObject],
  );
  const baseByMonth = useMemo(() => buildSnapshotByMonth(baseReport), [baseReport]);
  const sandboxByMonth = useMemo(() => buildSnapshotByMonth(sandboxReport), [sandboxReport]);
  const recommendationByMonth = useMemo(() => buildSnapshotByMonth(recommendationReport), [recommendationReport]);

  const months = useMemo(() => {
    const all = new Set<string>();
    const add = (report: SeriesResult): void => {
      (Array.isArray(report.months) ? report.months : []).forEach((month) => {
        if (!month) return;
        all.add(month);
      });
    };
    add(baseReport);
    add(sandboxReport);
    add(recommendationReport);
    return Array.from(all).sort();
  }, [baseReport, recommendationReport, sandboxReport]);

  const rows = useMemo<SandboxQuoteRow[]>(() => {
    return months.map((month) => {
      const baseSnapshot = baseByMonth.get(month) || null;
      const sandboxSnapshot = sandboxByMonth.get(month) || null;
      const recommendationSnapshot = recommendationByMonth.get(month) || null;

      const manualQuote = manualQuoteByMonth.get(month)
        ?? toFiniteOrNull(baseSnapshot?.manualPayoutPct)
        ?? null;
      const recommendedQuote = toFiniteOrNull(recommendationSnapshot?.payoutPct)
        ?? toFiniteOrNull(recommendationSnapshot?.recommendationQuotePct)
        ?? null;
      const levelPct = toFiniteOrNull(recommendationSnapshot?.recommendationLevelPct);
      const seasonalityOffsetPct = toFiniteOrNull(recommendationSnapshot?.recommendationSeasonalityPct);
      const safetyMarginPct = toFiniteOrNull(recommendationSnapshot?.recommendationSafetyMarginPct)
        ?? toFiniteOrNull(recommendationSnapshot?.recommendationRiskAdjustmentPct);
      const activeQuote = toFiniteOrNull(sandboxSnapshot?.payoutPct)
        ?? (quoteMode === "manual" ? manualQuote : recommendedQuote);

      return {
        key: month,
        month,
        monthLabel: formatMonthLabel(month),
        manualQuote,
        recommendedQuote,
        levelPct,
        seasonalityOffsetPct,
        safetyMarginPct,
        deltaPct: Number.isFinite(Number(recommendedQuote)) && Number.isFinite(Number(manualQuote))
          ? Number(recommendedQuote) - Number(manualQuote)
          : null,
        activeQuote,
        seasonalitySourceTag: normalizeSeasonalitySourceTag(recommendationSnapshot?.recommendationSeasonalitySourceTag || null),
      };
    });
  }, [baseByMonth, manualQuoteByMonth, months, quoteMode, recommendationByMonth, sandboxByMonth]);

  const summary = useMemo(() => {
    const monthCount = rows.length || 1;
    const avgActiveQuote = rows.reduce((sum, row) => sum + (Number(row.activeQuote || 0)), 0) / monthCount;
    const avgManualQuote = rows.reduce((sum, row) => sum + (Number(row.manualQuote || 0)), 0) / monthCount;
    const avgRecommendedQuote = rows.reduce((sum, row) => sum + (Number(row.recommendedQuote || 0)), 0) / monthCount;
    const validDeltaCount = rows.filter((row) => Number.isFinite(Number(row.deltaPct))).length;
    return {
      avgActiveQuote,
      avgManualQuote,
      avgRecommendedQuote,
      validDeltaCount,
      monthCount: rows.length,
    };
  }, [rows]);

  const columns = useMemo<ColumnsType<SandboxQuoteRow>>(() => {
    return [
      {
        title: "Monat",
        dataIndex: "monthLabel",
        key: "month",
        width: 130,
        fixed: "left",
      },
      {
        title: (
          <Space size={6}>
            <span>Manuelle Quote</span>
            <Tooltip title="Monatswert aus Cash-in Setup. Wenn leer, greift später die Empfehlung.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "manualQuote",
        key: "manualQuote",
        width: 150,
        align: "right",
        render: (value: number | null) => formatPercent(value),
      },
      {
        title: (
          <Space size={6}>
            <span>Empfohlene Quote (Plan)</span>
            <Tooltip title="Automatisch berechnet aus Level + SaisonOffset − Sicherheitsmarge.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "recommendedQuote",
        key: "recommendedQuote",
        width: 186,
        align: "right",
        render: (value: number | null) => formatPercent(value),
      },
      {
        title: (
          <Space size={6}>
            <span>Level (aktuelles Niveau)</span>
            <Tooltip title="Gewichtetes Niveau aus den letzten Monaten, mit Fokus auf jüngere Daten.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "levelPct",
        key: "levelPct",
        width: 190,
        align: "right",
        render: (value: number | null) => formatPercent(value),
      },
      {
        title: (
          <Space size={6}>
            <span>SaisonOffset (Monatsfaktor)</span>
            <Tooltip title="Monatsspezifischer Zuschlag/Abzug aus dem saisonalen Jahresmuster (Q4 automatisch enthalten).">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "seasonalityOffsetPct",
        key: "seasonalityOffsetPct",
        width: 226,
        align: "right",
        render: (value: number | null, row) => {
          const sourceTag = row.seasonalitySourceTag;
          return (
            <Space size={6} style={{ justifyContent: "flex-end", width: "100%" }}>
              <span>{formatSignedPp(value)}</span>
              {sourceTag ? <Tag>{sourceTag}</Tag> : null}
            </Space>
          );
        },
      },
      {
        title: (
          <Space size={6}>
            <span>Sicherheitsmarge</span>
            <Tooltip title="Kleiner fixer Vorsichtspuffer im Plan-Case, ohne harte Monats-Strafen.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "safetyMarginPct",
        key: "safetyMarginPct",
        width: 152,
        align: "right",
        render: (value: number | null) => Number.isFinite(Number(value)) ? formatSignedPp(-Number(value)) : "-",
      },
      {
        title: (
          <Space size={6}>
            <span>Delta</span>
            <Tooltip title="Empfohlen minus Manuell pro Monat. Positiv = Empfehlung liegt höher als dein manueller Wert.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "deltaPct",
        key: "deltaPct",
        width: 130,
        align: "right",
        className: "v2-sandbox-col-delta v2-sandbox-col-delta-strong",
        render: (value: number | null) => (
          <span className={deltaClassName(value)}>{formatSignedPp(value)}</span>
        ),
      },
      {
        title: (
          <Space size={6}>
            <span>Aktiv</span>
            <Tooltip title="Quote, die in der Sandbox aktuell im Cashflow verwendet wird.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "activeQuote",
        key: "activeQuote",
        width: 120,
        align: "right",
        fixed: "right",
        className: "v2-sandbox-col-sandbox",
        render: (value: number | null) => formatPercent(value),
      },
    ];
  }, []);

  const scenarioText = quoteMode === "manual"
    ? "Base Case aktiv: Auszahlungsquote = Manuell."
    : "Vergleich aktiv: Auszahlungsquote = Empfohlen (Plan).";

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Row gutter={[10, 10]} className="v2-page-head">
          <Col xs={24} xl={16}>
            <Title level={3}>Sandbox</Title>
            <Paragraph>
              Transparenzansicht für die Amazon-Auszahlungsquote. Du siehst pro Monat, wie sich Empfohlen (Plan) aus
              Level, SaisonOffset und Sicherheitsmarge zusammensetzt.
            </Paragraph>
          </Col>
          <Col xs={24} xl={8}>
            <div className="v2-sandbox-head-note">
              <Text type="secondary">Sandbox ändert keine echten Daten.</Text>
            </div>
          </Col>
        </Row>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-sandbox-controls-grid">
          <div className="v2-sandbox-control-tile">
            <Space size={6}>
              <Text strong>Umsatzbasis</Text>
              <Tooltip title="Optionaler Vergleich der Umsatzquelle im Sandbox-Run (falls Kalibrierung genutzt wird).">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <Segmented
              block
              value={revenueCalibrationMode}
              onChange={(value) => setRevenueCalibrationMode(String(value) === "forecast" ? "forecast" : "calibrated")}
              options={[
                { label: "Forecast", value: "forecast" },
                { label: "Kalibriert", value: "calibrated" },
              ]}
            />
          </div>

          <div className="v2-sandbox-control-tile">
            <Space size={6}>
              <Text strong>Auszahlungsquote</Text>
              <Tooltip title="Manuell nutzt deine Monatswerte. Empfohlen (Plan) nutzt die berechnete Heuristik.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <Segmented
              block
              value={quoteMode}
              onChange={(value) => setQuoteMode(String(value) === "recommendation" ? "recommendation" : "manual")}
              options={[
                { label: "Manuell", value: "manual" },
                { label: "Empfohlen (Plan)", value: "recommendation" },
              ]}
            />
            <Button size="small" type="link" href="#/v2/abschluss/eingaben">
              Cash-in Setup öffnen
            </Button>
          </div>

          <div className="v2-sandbox-control-actions">
            <Text strong>{scenarioText}</Text>
            <Text type="secondary">Delta-Spalte: Empfohlen minus Manuell.</Text>
            <Text type="secondary">Keine Überschreibung deiner manuellen Tabelle.</Text>
          </div>
        </div>
      </Card>

      <Card>
        <div className="v2-sandbox-summary-head">
          <Text strong>Ø Manuell:</Text>
          <Text>{formatPercent(summary.avgManualQuote)}</Text>
          <Text strong>Ø Empfohlen (Plan):</Text>
          <Text>{formatPercent(summary.avgRecommendedQuote)}</Text>
          <Text strong>Ø Aktiv:</Text>
          <Text>{formatPercent(summary.avgActiveQuote)}</Text>
        </div>
        <div className="v2-sandbox-summary-head">
          <Text type="secondary">{summary.validDeltaCount} Monate mit direktem Delta-Vergleich.</Text>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={4} style={{ margin: 0 }}>Monatsvergleich</Title>
          <Text type="secondary">{summary.monthCount} Monate im Planungszeitraum</Text>
        </Space>
        <Table<SandboxQuoteRow>
          className="v2-ant-table v2-sandbox-table"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          rowKey="key"
          scroll={{ x: 1400, y: 560 }}
          sticky
        />
      </Card>
    </div>
  );
}
