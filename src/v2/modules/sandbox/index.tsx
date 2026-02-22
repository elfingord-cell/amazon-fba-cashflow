import { InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Row,
  Segmented,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";
import { computeSeries } from "../../../domain/cashflow.js";
import { parsePayoutPctInput } from "../../../domain/cashInRules.js";
import { formatMonthLabel } from "../../domain/months";
import type { DashboardBreakdownRow, DashboardEntry } from "../../domain/dashboardMaturity";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type RevenueBasisMode = "hybrid" | "forecast_direct";
type CashInQuoteMode = "manual" | "recommendation";
type CashInSafetyMode = "basis" | "conservative";

interface SandboxScenario {
  revenueBasisMode: RevenueBasisMode;
  calibrationEnabled: boolean;
  quoteMode: CashInQuoteMode;
  safetyMode: CashInSafetyMode;
  q4SeasonalityEnabled: boolean;
}

interface SeriesResult {
  months?: string[];
  breakdown?: DashboardBreakdownRow[];
}

interface SandboxMonthSnapshot {
  month: string;
  activeRevenue: number;
  activeQuote: number;
  activePayout: number;
  forecastRevenueRaw: number;
  calibratedRevenue: number;
  manualQuote: number | null;
  recommendationQuote: number | null;
  quoteSource: string | null;
  revenueSource: string | null;
  recommendationSourceTag: string | null;
  calibrationFactorApplied: number | null;
}

interface SandboxTableRow {
  key: string;
  month: string;
  monthLabel: string;
  forecastRevenue: number;
  hybridRevenue: number;
  calibratedRevenue: number;
  activeRevenueBase: number;
  activeRevenueSandbox: number;
  deltaRevenue: number;
  manualQuote: number | null;
  recommendedBasisQuote: number | null;
  recommendedConservativeQuote: number | null;
  activeQuoteBase: number;
  activeQuoteSandbox: number;
  deltaQuotePp: number;
  payoutBase: number;
  payoutSandbox: number;
  deltaPayout: number;
  details: {
    base: SandboxMonthSnapshot;
    sandbox: SandboxMonthSnapshot;
  };
}

const BASE_CASE_SCENARIO: SandboxScenario = {
  revenueBasisMode: "hybrid",
  calibrationEnabled: false,
  quoteMode: "manual",
  safetyMode: "basis",
  q4SeasonalityEnabled: true,
};

function toFinite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return amount.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatSignedCurrency(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value > 0) return `+${formatCurrency(Math.abs(value))}`;
  if (value < 0) return `−${formatCurrency(Math.abs(value))}`;
  return formatCurrency(0);
}

function formatPercent(value: unknown, digits = 1): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function formatSignedPp(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "-";
  const absText = Math.abs(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${absText} pp`;
  if (value < 0) return `−${absText} pp`;
  return `${absText} pp`;
}

function deltaClassName(value: number): string | undefined {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.000001) return undefined;
  return value > 0 ? "v2-sandbox-delta-positive" : "v2-sandbox-delta-negative";
}

function resolveRecommendationComponentLabel(tagRaw: string | null): string {
  const tag = String(tagRaw || "").trim().toUpperCase();
  if (!tag) return "-";
  if (tag.includes("IST")) return "IST";
  if (tag.includes("PROGNOSE")) return "PROGNOSE";
  if (tag.includes("BASELINE_Q4") || tag.includes("Q4")) return "BASELINE_Q4";
  if (tag.includes("BASELINE")) return "BASELINE";
  if (tag.includes("CONSERVATIVE")) return "RECOMMENDED_CONSERVATIVE";
  if (tag.includes("BASIS")) return "RECOMMENDED_BASIS";
  return tag;
}

function resolveRevenueSourceLabel(source: string | null, mode: RevenueBasisMode): string {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "manual_override" || normalized === "manual_no_forecast") {
    return "manuell";
  }
  if (mode === "forecast_direct") return "forecast";
  if (normalized === "forecast_calibrated" || normalized === "forecast_raw") {
    return "hybrid (Auto via Forecast)";
  }
  return mode === "hybrid" ? "hybrid" : "forecast";
}

function describeSandboxMode(options: SandboxScenario): string {
  const revenueLabel = options.revenueBasisMode === "hybrid"
    ? "Umsatzbasis: Plan-Umsatz (Hybrid)"
    : "Umsatzbasis: Forecast-Umsatz (direkt)";
  const calibrationLabel = `Kalibrierung: ${options.calibrationEnabled ? "AN" : "AUS"}`;
  const quoteLabel = options.quoteMode === "manual"
    ? "Quote: Manuell"
    : `Quote: Empfohlen (${options.safetyMode === "conservative" ? "Konservativ" : "Basis"}, Q4 ${options.q4SeasonalityEnabled ? "AN" : "AUS"})`;
  return `${revenueLabel} · ${calibrationLabel} · ${quoteLabel}`;
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
  settings.cashInMode = options.safetyMode === "basis" ? "basis" : "conservative";
  settings.cashInCalibrationEnabled = options.calibrationEnabled;
  settings.cashInRevenueBasisMode = options.revenueBasisMode;
  settings.cashInRecommendationSeasonalityEnabled = options.q4SeasonalityEnabled;
  settings.cashInRecommendationIgnoreQ4 = !options.q4SeasonalityEnabled;

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

function buildManualQuoteByMonth(state: Record<string, unknown>): Map<string, number | null> {
  const map = new Map<string, number | null>();
  const incomings = Array.isArray(state.incomings) ? state.incomings as Record<string, unknown>[] : [];
  incomings.forEach((incoming) => {
    const month = String(incoming?.month || "").trim();
    if (!month) return;
    const parsed = parsePayoutPctInput(incoming?.payoutPct);
    map.set(month, Number.isFinite(parsed) ? Number(parsed) : null);
  });
  return map;
}

function extractCashInMeta(entry: DashboardEntry): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const meta = (entry.meta && typeof entry.meta === "object")
    ? entry.meta as Record<string, unknown>
    : null;
  if (!meta || !meta.cashIn || typeof meta.cashIn !== "object") return null;
  return meta.cashIn as Record<string, unknown>;
}

function buildSnapshotByMonth(report: SeriesResult): Map<string, SandboxMonthSnapshot> {
  const months = Array.isArray(report.months) ? report.months : [];
  const breakdownRows = Array.isArray(report.breakdown) ? report.breakdown : [];
  const breakdownByMonth = new Map<string, DashboardBreakdownRow>(
    breakdownRows
      .filter((row) => typeof row?.month === "string" && row.month.trim().length > 0)
      .map((row) => [row.month, row]),
  );

  const snapshots = new Map<string, SandboxMonthSnapshot>();
  months.forEach((month) => {
    const row = breakdownByMonth.get(month);
    const entries = Array.isArray(row?.entries) ? row.entries : [];
    const salesEntries = entries.filter((entry) => String(entry?.kind || "").toLowerCase() === "sales-payout");

    let activePayout = 0;
    let componentRevenueSum = 0;
    let firstMeta: Record<string, unknown> | null = null;

    salesEntries.forEach((entry) => {
      const direction = String(entry.direction || "").toLowerCase();
      const amount = Math.abs(toFinite(entry.amount, 0));
      activePayout += direction === "out" ? -amount : amount;

      const cashInMeta = extractCashInMeta(entry);
      if (!firstMeta && cashInMeta) {
        firstMeta = cashInMeta;
      }
      const componentRevenue = toFiniteOrNull(cashInMeta?.revenue);
      if (componentRevenue != null) {
        componentRevenueSum += componentRevenue;
      }
    });

    const appliedRevenue = toFiniteOrNull(firstMeta?.appliedRevenue);
    const activeRevenue = appliedRevenue != null
      ? appliedRevenue
      : componentRevenueSum;

    snapshots.set(month, {
      month,
      activeRevenue,
      activeQuote: toFinite(firstMeta?.payoutPct, 0),
      activePayout,
      forecastRevenueRaw: toFinite(firstMeta?.forecastRevenueRaw, 0),
      calibratedRevenue: toFinite(firstMeta?.planRevenueAfterCalibration, toFinite(firstMeta?.forecastRevenueRaw, 0)),
      manualQuote: toFiniteOrNull(firstMeta?.manualPayoutPct),
      recommendationQuote: toFiniteOrNull(firstMeta?.recommendationQuotePct),
      quoteSource: firstMeta?.quoteSource ? String(firstMeta.quoteSource) : null,
      revenueSource: firstMeta?.revenueSource ? String(firstMeta.revenueSource) : null,
      recommendationSourceTag: firstMeta?.recommendationSourceTag ? String(firstMeta.recommendationSourceTag) : null,
      calibrationFactorApplied: toFiniteOrNull(firstMeta?.calibrationFactorApplied),
    });
  });

  return snapshots;
}

function resolveMonthsFromReports(reports: SeriesResult[]): string[] {
  const set = new Set<string>();
  reports.forEach((report) => {
    (Array.isArray(report.months) ? report.months : []).forEach((month) => {
      if (!month) return;
      set.add(month);
    });
  });
  return Array.from(set).sort();
}

export default function SandboxModule(): JSX.Element {
  const navigate = useNavigate();
  const { state, loading, error } = useWorkspaceState();

  const [revenueBasisMode, setRevenueBasisMode] = useState<RevenueBasisMode>(BASE_CASE_SCENARIO.revenueBasisMode);
  const [calibrationEnabled, setCalibrationEnabled] = useState<boolean>(BASE_CASE_SCENARIO.calibrationEnabled);
  const [quoteMode, setQuoteMode] = useState<CashInQuoteMode>(BASE_CASE_SCENARIO.quoteMode);
  const [q4SeasonalityEnabled, setQ4SeasonalityEnabled] = useState<boolean>(BASE_CASE_SCENARIO.q4SeasonalityEnabled);
  const [conservativeEnabled, setConservativeEnabled] = useState<boolean>(BASE_CASE_SCENARIO.safetyMode === "conservative");
  const [detailMonth, setDetailMonth] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);

  const stateObject = state as unknown as Record<string, unknown>;
  const manualQuoteByMonth = useMemo(() => buildManualQuoteByMonth(stateObject), [state.incomings]);

  const sandboxScenario = useMemo<SandboxScenario>(() => ({
    revenueBasisMode,
    calibrationEnabled,
    quoteMode,
    q4SeasonalityEnabled,
    safetyMode: conservativeEnabled ? "conservative" : "basis",
  }), [calibrationEnabled, conservativeEnabled, q4SeasonalityEnabled, quoteMode, revenueBasisMode]);

  const baseReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, BASE_CASE_SCENARIO)) as SeriesResult,
    [stateObject],
  );

  const sandboxReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, sandboxScenario)) as SeriesResult,
    [sandboxScenario, stateObject],
  );

  const recommendationBasisReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, {
      ...sandboxScenario,
      quoteMode: "recommendation",
      safetyMode: "basis",
    })) as SeriesResult,
    [sandboxScenario, stateObject],
  );

  const recommendationConservativeReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, {
      ...sandboxScenario,
      quoteMode: "recommendation",
      safetyMode: "conservative",
    })) as SeriesResult,
    [sandboxScenario, stateObject],
  );

  const baseByMonth = useMemo(() => buildSnapshotByMonth(baseReport), [baseReport]);
  const sandboxByMonth = useMemo(() => buildSnapshotByMonth(sandboxReport), [sandboxReport]);
  const recommendationBasisByMonth = useMemo(() => buildSnapshotByMonth(recommendationBasisReport), [recommendationBasisReport]);
  const recommendationConservativeByMonth = useMemo(
    () => buildSnapshotByMonth(recommendationConservativeReport),
    [recommendationConservativeReport],
  );

  const months = useMemo(
    () => resolveMonthsFromReports([
      baseReport,
      sandboxReport,
      recommendationBasisReport,
      recommendationConservativeReport,
    ]),
    [baseReport, recommendationBasisReport, recommendationConservativeReport, sandboxReport],
  );

  const rows = useMemo<SandboxTableRow[]>(() => {
    return months.map((month) => {
      const baseSnapshot = baseByMonth.get(month) || {
        month,
        activeRevenue: 0,
        activeQuote: 0,
        activePayout: 0,
        forecastRevenueRaw: 0,
        calibratedRevenue: 0,
        manualQuote: null,
        recommendationQuote: null,
        quoteSource: null,
        revenueSource: null,
        recommendationSourceTag: null,
        calibrationFactorApplied: null,
      };
      const sandboxSnapshot = sandboxByMonth.get(month) || baseSnapshot;
      const recommendationBasisSnapshot = recommendationBasisByMonth.get(month) || baseSnapshot;
      const recommendationConservativeSnapshot = recommendationConservativeByMonth.get(month) || baseSnapshot;

      const activeRevenueBase = toFinite(baseSnapshot.activeRevenue, 0);
      const activeRevenueSandbox = toFinite(sandboxSnapshot.activeRevenue, 0);
      const activeQuoteBase = toFinite(baseSnapshot.activeQuote, 0);
      const activeQuoteSandbox = toFinite(sandboxSnapshot.activeQuote, 0);
      const payoutBase = toFinite(baseSnapshot.activePayout, 0);
      const payoutSandbox = toFinite(sandboxSnapshot.activePayout, 0);

      const forecastRevenue = toFinite(
        sandboxSnapshot.forecastRevenueRaw,
        toFinite(baseSnapshot.forecastRevenueRaw, 0),
      );
      const hybridRevenue = activeRevenueBase;
      const calibratedRevenue = toFinite(
        sandboxSnapshot.calibratedRevenue,
        toFinite(baseSnapshot.calibratedRevenue, forecastRevenue),
      );

      return {
        key: month,
        month,
        monthLabel: formatMonthLabel(month),
        forecastRevenue,
        hybridRevenue,
        calibratedRevenue,
        activeRevenueBase,
        activeRevenueSandbox,
        deltaRevenue: activeRevenueSandbox - activeRevenueBase,
        manualQuote: manualQuoteByMonth.get(month) ?? baseSnapshot.manualQuote,
        recommendedBasisQuote: toFiniteOrNull(recommendationBasisSnapshot.activeQuote),
        recommendedConservativeQuote: toFiniteOrNull(recommendationConservativeSnapshot.activeQuote),
        activeQuoteBase,
        activeQuoteSandbox,
        deltaQuotePp: activeQuoteSandbox - activeQuoteBase,
        payoutBase,
        payoutSandbox,
        deltaPayout: payoutSandbox - payoutBase,
        details: {
          base: baseSnapshot,
          sandbox: sandboxSnapshot,
        },
      };
    });
  }, [
    baseByMonth,
    manualQuoteByMonth,
    months,
    recommendationBasisByMonth,
    recommendationConservativeByMonth,
    sandboxByMonth,
  ]);

  const rowByMonth = useMemo(() => new Map(rows.map((row) => [row.month, row])), [rows]);
  const selectedRow = detailMonth ? rowByMonth.get(detailMonth) || null : null;

  const summary = useMemo(() => {
    const monthCount = rows.length || 1;
    const deltaRevenueSum = rows.reduce((sum, row) => sum + row.deltaRevenue, 0);
    const deltaPayoutSum = rows.reduce((sum, row) => sum + row.deltaPayout, 0);
    const baseQuoteAvg = rows.reduce((sum, row) => sum + row.activeQuoteBase, 0) / monthCount;
    const sandboxQuoteAvg = rows.reduce((sum, row) => sum + row.activeQuoteSandbox, 0) / monthCount;
    return {
      deltaRevenueSum,
      deltaPayoutSum,
      deltaQuoteAvgPp: sandboxQuoteAvg - baseQuoteAvg,
      monthCount: rows.length,
    };
  }, [rows]);

  const columns = useMemo<ColumnsType<SandboxTableRow>>(() => {
    return [
      {
        title: "Monat",
        dataIndex: "monthLabel",
        key: "month",
        width: 116,
        fixed: "left",
      },
      {
        title: "Umsatz",
        children: [
          {
            title: "Forecast-Umsatz",
            dataIndex: "forecastRevenue",
            key: "forecastRevenue",
            width: 132,
            align: "right",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Plan-Umsatz (Hybrid)",
            dataIndex: "hybridRevenue",
            key: "hybridRevenue",
            width: 144,
            align: "right",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Kalibrierter Umsatz",
            dataIndex: "calibratedRevenue",
            key: "calibratedRevenue",
            width: 144,
            align: "right",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Umsatz aktiv (Base Case)",
            dataIndex: "activeRevenueBase",
            key: "activeRevenueBase",
            width: 162,
            align: "right",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Umsatz aktiv (Sandbox)",
            dataIndex: "activeRevenueSandbox",
            key: "activeRevenueSandbox",
            width: 166,
            align: "right",
            className: "v2-sandbox-col-sandbox",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Δ Umsatz",
            dataIndex: "deltaRevenue",
            key: "deltaRevenue",
            width: 130,
            align: "right",
            className: "v2-sandbox-col-delta",
            render: (value: number) => (
              <span className={deltaClassName(value)}>{formatSignedCurrency(value)}</span>
            ),
          },
        ],
      },
      {
        title: "Quote",
        children: [
          {
            title: "Quote manuell",
            dataIndex: "manualQuote",
            key: "manualQuote",
            width: 124,
            align: "right",
            render: (value: number | null) => value == null ? "-" : formatPercent(value),
          },
          {
            title: "Quote empfohlen (Basis)",
            dataIndex: "recommendedBasisQuote",
            key: "recommendedBasisQuote",
            width: 154,
            align: "right",
            render: (value: number | null) => value == null ? "-" : formatPercent(value),
          },
          {
            title: "Quote empfohlen (Konservativ)",
            dataIndex: "recommendedConservativeQuote",
            key: "recommendedConservativeQuote",
            width: 184,
            align: "right",
            render: (value: number | null) => value == null ? "-" : formatPercent(value),
          },
          {
            title: "Quote aktiv (Base Case)",
            dataIndex: "activeQuoteBase",
            key: "activeQuoteBase",
            width: 154,
            align: "right",
            render: (value: number) => formatPercent(value),
          },
          {
            title: "Quote aktiv (Sandbox)",
            dataIndex: "activeQuoteSandbox",
            key: "activeQuoteSandbox",
            width: 158,
            align: "right",
            className: "v2-sandbox-col-sandbox",
            render: (value: number) => formatPercent(value),
          },
          {
            title: "Δ Quote",
            dataIndex: "deltaQuotePp",
            key: "deltaQuotePp",
            width: 122,
            align: "right",
            className: "v2-sandbox-col-delta",
            render: (value: number) => (
              <span className={deltaClassName(value)}>{formatSignedPp(value)}</span>
            ),
          },
        ],
      },
      {
        title: "Ergebnis",
        children: [
          {
            title: "Payout aktiv (Base Case)",
            dataIndex: "payoutBase",
            key: "payoutBase",
            width: 172,
            align: "right",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Payout aktiv (Sandbox)",
            dataIndex: "payoutSandbox",
            key: "payoutSandbox",
            width: 176,
            align: "right",
            className: "v2-sandbox-col-sandbox",
            render: (value: number) => formatCurrency(value),
          },
          {
            title: "Δ Payout",
            dataIndex: "deltaPayout",
            key: "deltaPayout",
            width: 138,
            align: "right",
            className: "v2-sandbox-col-delta v2-sandbox-col-delta-strong",
            render: (value: number) => (
              <span className={deltaClassName(value)}>{formatSignedCurrency(value)}</span>
            ),
          },
        ],
      },
      {
        title: "",
        key: "details",
        width: 96,
        fixed: "right",
        render: (_value, row) => (
          <Button
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => {
              setDetailMonth(row.month);
              setDetailOpen(true);
            }}
          >
            Details
          </Button>
        ),
      },
    ];
  }, []);

  function resetToBaseCase(): void {
    setRevenueBasisMode(BASE_CASE_SCENARIO.revenueBasisMode);
    setCalibrationEnabled(BASE_CASE_SCENARIO.calibrationEnabled);
    setQuoteMode(BASE_CASE_SCENARIO.quoteMode);
    setQ4SeasonalityEnabled(BASE_CASE_SCENARIO.q4SeasonalityEnabled);
    setConservativeEnabled(BASE_CASE_SCENARIO.safetyMode === "conservative");
  }

  const sandboxModeText = describeSandboxMode(sandboxScenario);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Row gutter={[10, 10]} className="v2-page-head">
          <Col xs={24} xl={16}>
            <Title level={3}>Sandbox</Title>
            <Paragraph>
              Interaktive Vergleichsansicht für Umsatzbasis und Amazon-Auszahlungsquote. Nur View-State, ohne Persistenzänderung.
            </Paragraph>
          </Col>
          <Col xs={24} xl={8}>
            <div className="v2-sandbox-head-note">
              <Text type="secondary">Sandbox ändert keine echten Einstellungen.</Text>
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
              <Tooltip title="Plan-Umsatz nutzt manuelle Monate aus dem Cash-in Setup und sonst Forecast. Forecast direkt ignoriert manuelle Umsatz-Overrides.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <Segmented
              block
              value={revenueBasisMode}
              onChange={(value) => setRevenueBasisMode(String(value) === "forecast_direct" ? "forecast_direct" : "hybrid")}
              options={[
                { label: "Plan-Umsatz (Hybrid)", value: "hybrid" },
                { label: "Forecast-Umsatz (direkt)", value: "forecast_direct" },
              ]}
            />
            <div className="v2-sandbox-inline-row">
              <Text strong>Kalibrierung</Text>
              <Switch
                size="small"
                checked={calibrationEnabled}
                onChange={(checked) => setCalibrationEnabled(checked)}
              />
              <Tooltip title="Wirkt nur auf Monate, in denen Forecast-Umsatz genutzt wird.">
                <InfoCircleOutlined />
              </Tooltip>
            </div>
            <Button size="small" type="link" onClick={() => navigate("/v2/abschluss/eingaben")}>Cash-in Setup öffnen</Button>
          </div>

          <div className="v2-sandbox-control-tile">
            <Space size={6}>
              <Text strong>Amazon-Auszahlungsquote</Text>
              <Tooltip title="Manuell nutzt die gepflegte Monatsquote. Empfohlen berechnet die Quote monatlich mit bestehender Methodik.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <Segmented
              block
              value={quoteMode}
              onChange={(value) => setQuoteMode(String(value) === "recommendation" ? "recommendation" : "manual")}
              options={[
                { label: "Manuell", value: "manual" },
                { label: "Empfohlen", value: "recommendation" },
              ]}
            />
            <div className="v2-sandbox-switch-grid">
              <div className="v2-sandbox-inline-row">
                <Text>Q4 berücksichtigen</Text>
                <Tooltip title={quoteMode === "manual" ? "wirkt nur im Modus Empfohlen" : "Q4-Saisonalität in der Empfehlung berücksichtigen."}>
                  <span>
                    <Switch
                      size="small"
                      checked={q4SeasonalityEnabled}
                      disabled={quoteMode === "manual"}
                      onChange={(checked) => setQ4SeasonalityEnabled(checked)}
                    />
                  </span>
                </Tooltip>
              </div>
              <div className="v2-sandbox-inline-row">
                <Text>Konservativ</Text>
                <Tooltip title={quoteMode === "manual" ? "wirkt nur im Modus Empfohlen" : "Zusätzlicher Sicherheitsabschlag auf die Empfehlung."}>
                  <span>
                    <Switch
                      size="small"
                      checked={conservativeEnabled}
                      disabled={quoteMode === "manual"}
                      onChange={(checked) => setConservativeEnabled(checked)}
                    />
                  </span>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="v2-sandbox-control-actions">
            <Button icon={<ReloadOutlined />} onClick={resetToBaseCase}>Zurück auf Base Case</Button>
            <Text type="secondary">Base Case: Plan-Umsatz (Hybrid) · Manuell · Kalibrierung AUS</Text>
            <Text type="secondary">Nur für Nachvollziehbarkeit, ohne Speicherung.</Text>
          </div>
        </div>
      </Card>

      <Card>
        <div className="v2-sandbox-summary-head">
          <Text strong>Aktueller Modus:</Text>
          <Text>{sandboxModeText}</Text>
        </div>
        <div className="v2-sandbox-summary-head">
          <Text strong>Vergleich gegen:</Text>
          <Text>Base Case (Plan-Umsatz (Hybrid), Manuell, Kalibrierung AUS)</Text>
        </div>
        <div className="v2-sandbox-kpi-grid">
          <div className="v2-sandbox-kpi-card">
            <Text type="secondary">Δ Umsatz (Summe)</Text>
            <Text strong className={deltaClassName(summary.deltaRevenueSum)}>{formatSignedCurrency(summary.deltaRevenueSum)}</Text>
          </div>
          <div className="v2-sandbox-kpi-card">
            <Text type="secondary">Δ Ø Quote (pp)</Text>
            <Text strong className={deltaClassName(summary.deltaQuoteAvgPp)}>{formatSignedPp(summary.deltaQuoteAvgPp)}</Text>
          </div>
          <div className="v2-sandbox-kpi-card v2-sandbox-kpi-card-strong">
            <Text type="secondary">Δ Payout (Summe)</Text>
            <Text strong className={deltaClassName(summary.deltaPayoutSum)}>{formatSignedCurrency(summary.deltaPayoutSum)}</Text>
          </div>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={4} style={{ margin: 0 }}>Monatsvergleich</Title>
          <Text type="secondary">{summary.monthCount} Monate im aktuellen Planungszeitraum</Text>
        </Space>
        <Table<SandboxTableRow>
          className="v2-ant-table v2-sandbox-table"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          rowKey="key"
          scroll={{ x: 2800, y: 560 }}
          sticky
        />
      </Card>

      <Drawer
        title={selectedRow ? `Monat-Details: ${selectedRow.monthLabel}` : "Monat-Details"}
        placement="right"
        width={560}
        open={detailOpen && Boolean(selectedRow)}
        onClose={() => setDetailOpen(false)}
      >
        {selectedRow ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Card size="small" title="A) Warum ist Umsatz aktiv (Sandbox) so?">
              <div className="v2-sandbox-detail-lines">
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Quelle</Text>
                  <Text strong>{resolveRevenueSourceLabel(selectedRow.details.sandbox.revenueSource, sandboxScenario.revenueBasisMode)}</Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Kalibrierung</Text>
                  <Text strong>
                    {sandboxScenario.calibrationEnabled ? "an" : "aus"}
                    {sandboxScenario.calibrationEnabled && selectedRow.details.sandbox.calibrationFactorApplied != null
                      ? ` · Faktor ${selectedRow.details.sandbox.calibrationFactorApplied.toLocaleString("de-DE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                      : ""}
                  </Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Ergebnis-Umsatz</Text>
                  <Text strong>{formatCurrency(selectedRow.activeRevenueSandbox)}</Text>
                </div>
              </div>
            </Card>

            <Card size="small" title="B) Warum ist Quote aktiv (Sandbox) so?">
              <div className="v2-sandbox-detail-lines">
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Quelle</Text>
                  <Text strong>{selectedRow.details.sandbox.quoteSource === "manual" ? "manuell" : "empfohlen"}</Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Q4 / konservativ</Text>
                  <Text strong>
                    {selectedRow.details.sandbox.quoteSource === "manual"
                      ? "nicht aktiv (nur im Modus Empfohlen)"
                      : `Q4 ${sandboxScenario.q4SeasonalityEnabled ? "ja" : "nein"} · konservativ ${sandboxScenario.safetyMode === "conservative" ? "ja" : "nein"}`}
                  </Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Empfehlungskomponente</Text>
                  <Text strong>{selectedRow.details.sandbox.quoteSource === "manual" ? "-" : resolveRecommendationComponentLabel(selectedRow.details.sandbox.recommendationSourceTag)}</Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Ergebnis-Quote</Text>
                  <Text strong>{formatPercent(selectedRow.activeQuoteSandbox)}</Text>
                </div>
              </div>
            </Card>

            <Card size="small" title="C) Wirkung (Base Case vs Sandbox)">
              <div className="v2-sandbox-detail-lines">
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Umsatz</Text>
                  <Text>
                    {formatCurrency(selectedRow.activeRevenueBase)} → {formatCurrency(selectedRow.activeRevenueSandbox)}
                    {" "}(<span className={deltaClassName(selectedRow.deltaRevenue)}>{formatSignedCurrency(selectedRow.deltaRevenue)}</span>)
                  </Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Quote</Text>
                  <Text>
                    {formatPercent(selectedRow.activeQuoteBase)} → {formatPercent(selectedRow.activeQuoteSandbox)}
                    {" "}(<span className={deltaClassName(selectedRow.deltaQuotePp)}>{formatSignedPp(selectedRow.deltaQuotePp)}</span>)
                  </Text>
                </div>
                <div className="v2-sandbox-detail-line">
                  <Text type="secondary">Payout</Text>
                  <Text>
                    {formatCurrency(selectedRow.payoutBase)} → {formatCurrency(selectedRow.payoutSandbox)}
                    {" "}(<span className={deltaClassName(selectedRow.deltaPayout)}>{formatSignedCurrency(selectedRow.deltaPayout)}</span>)
                  </Text>
                </div>
              </div>
            </Card>
          </Space>
        ) : (
          <Text type="secondary">Kein Monat gewählt.</Text>
        )}
      </Drawer>
    </div>
  );
}
