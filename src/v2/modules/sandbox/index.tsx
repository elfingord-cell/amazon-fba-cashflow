import { InfoCircleOutlined } from "@ant-design/icons";
import { useCallback, useMemo, useState } from "react";
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
type SandboxTableFocus = "payout" | "revenue";

interface SandboxScenario {
  revenueBasisMode: RevenueBasisMode;
  calibrationEnabled: boolean;
  quoteMode: CashInQuoteMode;
}

interface SeriesResult {
  months?: string[];
  breakdown?: DashboardBreakdownRow[];
}

interface MonthQuoteSample {
  month: string;
  quotePct: number;
}

interface MonthMetaSnapshot {
  month: string;
  payoutPct: number | null;
  appliedRevenue: number | null;
  forecastRevenueRaw: number | null;
  revenueSource: string | null;
  manualPayoutPct: number | null;
  recommendationQuotePct: number | null;
  recommendationLevelPct: number | null;
  recommendationLevelAvg3Pct: number | null;
  recommendationLevelAvg12Pct: number | null;
  recommendationLevelRecentMonths: MonthQuoteSample[];
  recommendationLevelWindowMonths: MonthQuoteSample[];
  recommendationSeasonalityPct: number | null;
  recommendationSeasonalityMonthMeanPct: number | null;
  recommendationSeasonalityOverallMeanPct: number | null;
  recommendationSafetyMarginPct: number | null;
  recommendationRiskAdjustmentPct: number | null;
  recommendationSeasonalitySourceTag: string | null;
  recommendationSeasonalityProfileSource: string | null;
  recommendationSourceTag: string | null;
}

interface SandboxQuoteRow {
  key: string;
  month: string;
  monthLabel: string;
  manualQuote: number | null;
  recommendedQuote: number | null;
  levelPct: number | null;
  levelAvg3Pct: number | null;
  levelAvg12Pct: number | null;
  levelRecentMonths: MonthQuoteSample[];
  levelWindowMonths: MonthQuoteSample[];
  seasonalityFactorPct: number | null;
  seasonalityMonthMeanPct: number | null;
  seasonalityOverallMeanPct: number | null;
  safetyMarginPct: number | null;
  deltaPct: number | null;
  activeQuote: number | null;
  forecastRevenue: number | null;
  calibratedRevenue: number | null;
  deltaRevenue: number | null;
  activeRevenue: number | null;
  seasonalitySourceTag: string | null;
  seasonalityProfileSource: string | null;
}

const DEFAULT_REVENUE_MODE: RevenueBasisMode = "hybrid";

function normalizeCashInQuoteMode(value: unknown): CashInQuoteMode {
  return String(value || "").trim().toLowerCase() === "recommendation"
    ? "recommendation"
    : "manual";
}

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

function formatCurrency(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  if (numeric > 0) return `+${formatCurrency(numeric)}`;
  if (numeric < 0) return `−${formatCurrency(Math.abs(numeric))}`;
  return formatCurrency(0);
}

function deltaClassName(value: number | null | undefined): string | undefined {
  if (!Number.isFinite(Number(value))) return undefined;
  const numeric = Number(value);
  if (Math.abs(numeric) <= 0.000001) return undefined;
  return numeric > 0 ? "v2-sandbox-delta-positive" : "v2-sandbox-delta-negative";
}

function normalizeSeasonalitySourceTag(value: string | null): string | null {
  const tag = String(value || "").trim().toLowerCase();
  if (!tag) return null;
  if (tag === "ist_month") return "Ist-Daten (Kalendermonat)";
  if (tag === "history_month") return "Historie (Kalendermonat)";
  if (tag === "no_data") return "Keine Historie";
  if (tag === "disabled") return "Aus";
  return tag;
}

function normalizeMonthQuoteSamples(value: unknown): MonthQuoteSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const month = String((entry as Record<string, unknown>).month || "").trim();
      const quotePct = toFiniteOrNull((entry as Record<string, unknown>).quotePct);
      if (!month || !Number.isFinite(Number(quotePct))) return null;
      return {
        month,
        quotePct: Number(quotePct),
      };
    })
    .filter((entry): entry is MonthQuoteSample => Boolean(entry));
}

function formatSampleList(
  samples: MonthQuoteSample[],
  maxEntries = 3,
): string {
  if (!samples.length) return "keine";
  const items = samples.slice(Math.max(0, samples.length - maxEntries));
  return items
    .map((sample) => `${formatMonthLabel(sample.month)}: ${formatPercent(sample.quotePct)}`)
    .join(" · ");
}

function averageFinite(values: Array<number | null | undefined>): number | null {
  const finite = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
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
      appliedRevenue: toFiniteOrNull(firstMeta?.appliedRevenue),
      forecastRevenueRaw: toFiniteOrNull(firstMeta?.forecastRevenueRaw),
      revenueSource: firstMeta?.revenueSource ? String(firstMeta.revenueSource) : null,
      manualPayoutPct: toFiniteOrNull(firstMeta?.manualPayoutPct),
      recommendationQuotePct: toFiniteOrNull(firstMeta?.recommendationQuotePct),
      recommendationLevelPct: toFiniteOrNull(firstMeta?.recommendationLevelPct),
      recommendationLevelAvg3Pct: toFiniteOrNull(firstMeta?.recommendationLevelAvg3Pct),
      recommendationLevelAvg12Pct: toFiniteOrNull(firstMeta?.recommendationLevelAvg12Pct),
      recommendationLevelRecentMonths: normalizeMonthQuoteSamples(firstMeta?.recommendationLevelRecentMonths),
      recommendationLevelWindowMonths: normalizeMonthQuoteSamples(firstMeta?.recommendationLevelWindowMonths),
      recommendationSeasonalityPct: toFiniteOrNull(firstMeta?.recommendationSeasonalityPct),
      recommendationSeasonalityMonthMeanPct: toFiniteOrNull(firstMeta?.recommendationSeasonalityMonthMeanPct),
      recommendationSeasonalityOverallMeanPct: toFiniteOrNull(firstMeta?.recommendationSeasonalityOverallMeanPct),
      recommendationSafetyMarginPct: toFiniteOrNull(firstMeta?.recommendationSafetyMarginPct),
      recommendationRiskAdjustmentPct: toFiniteOrNull(firstMeta?.recommendationRiskAdjustmentPct),
      recommendationSeasonalitySourceTag: firstMeta?.recommendationSeasonalitySourceTag
        ? String(firstMeta.recommendationSeasonalitySourceTag)
        : null,
      recommendationSeasonalityProfileSource: firstMeta?.recommendationSeasonalityProfileSource
        ? String(firstMeta.recommendationSeasonalityProfileSource)
        : null,
      recommendationSourceTag: firstMeta?.recommendationSourceTag
        ? String(firstMeta.recommendationSourceTag)
        : null,
    });
  });

  return out;
}

export default function SandboxModule(): JSX.Element {
  const { state, loading, error, saveWith } = useWorkspaceState();

  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const calibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const methodikRevenueBasisMode = String(settings.cashInRevenueBasisMode || "").trim().toLowerCase() === "forecast_direct"
    ? "forecast_direct"
    : DEFAULT_REVENUE_MODE;
  const quoteMode = normalizeCashInQuoteMode(settings.cashInQuoteMode);
  const revenueCalibrationMode: RevenueCalibrationMode = calibrationEnabled ? "calibrated" : "forecast";
  const [tableFocus, setTableFocus] = useState<SandboxTableFocus>("payout");

  const persistSandboxCashInSettings = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    await saveWith((current) => {
      const next = structuredClone(current);
      if (!next.settings || typeof next.settings !== "object") {
        next.settings = {};
      }
      const settingsState = next.settings as Record<string, unknown>;
      next.settings = {
        ...settingsState,
        ...patch,
        lastUpdatedAt: new Date().toISOString(),
      };
      return next;
    }, "v2:sandbox:cashin-controls");
  }, [saveWith]);

  const stateObject = state as unknown as Record<string, unknown>;

  const scenarioBase = useMemo<SandboxScenario>(() => ({
    revenueBasisMode: methodikRevenueBasisMode,
    calibrationEnabled,
    quoteMode: "manual",
  }), [calibrationEnabled, methodikRevenueBasisMode]);

  const scenarioSandbox = useMemo<SandboxScenario>(() => ({
    ...scenarioBase,
    quoteMode,
  }), [quoteMode, scenarioBase]);

  const scenarioRecommendation = useMemo<SandboxScenario>(() => ({
    ...scenarioBase,
    quoteMode: "recommendation",
  }), [scenarioBase]);
  const scenarioRevenueForecast = useMemo<SandboxScenario>(() => ({
    revenueBasisMode: methodikRevenueBasisMode,
    calibrationEnabled: false,
    quoteMode,
  }), [methodikRevenueBasisMode, quoteMode]);
  const scenarioRevenueCalibrated = useMemo<SandboxScenario>(() => ({
    revenueBasisMode: methodikRevenueBasisMode,
    calibrationEnabled: true,
    quoteMode,
  }), [methodikRevenueBasisMode, quoteMode]);

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
  const revenueForecastReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, scenarioRevenueForecast)) as SeriesResult,
    [scenarioRevenueForecast, stateObject],
  );
  const revenueCalibratedReport = useMemo(
    () => computeSeries(applySandboxCalculationOverrides(stateObject, scenarioRevenueCalibrated)) as SeriesResult,
    [scenarioRevenueCalibrated, stateObject],
  );

  const manualQuoteByMonth = useMemo(
    () => collectManualQuoteByMonth(stateObject),
    [state.incomings, stateObject],
  );
  const baseByMonth = useMemo(() => buildSnapshotByMonth(baseReport), [baseReport]);
  const sandboxByMonth = useMemo(() => buildSnapshotByMonth(sandboxReport), [sandboxReport]);
  const recommendationByMonth = useMemo(() => buildSnapshotByMonth(recommendationReport), [recommendationReport]);
  const revenueForecastByMonth = useMemo(() => buildSnapshotByMonth(revenueForecastReport), [revenueForecastReport]);
  const revenueCalibratedByMonth = useMemo(() => buildSnapshotByMonth(revenueCalibratedReport), [revenueCalibratedReport]);

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
    add(revenueForecastReport);
    add(revenueCalibratedReport);
    return Array.from(all).sort();
  }, [baseReport, recommendationReport, revenueCalibratedReport, revenueForecastReport, sandboxReport]);

  const rows = useMemo<SandboxQuoteRow[]>(() => {
    return months.map((month) => {
      const baseSnapshot = baseByMonth.get(month) || null;
      const sandboxSnapshot = sandboxByMonth.get(month) || null;
      const recommendationSnapshot = recommendationByMonth.get(month) || null;
      const forecastSnapshot = revenueForecastByMonth.get(month) || null;
      const calibratedSnapshot = revenueCalibratedByMonth.get(month) || null;

      const manualQuote = manualQuoteByMonth.get(month)
        ?? toFiniteOrNull(baseSnapshot?.manualPayoutPct)
        ?? null;
      const recommendedQuote = toFiniteOrNull(recommendationSnapshot?.payoutPct)
        ?? toFiniteOrNull(recommendationSnapshot?.recommendationQuotePct)
        ?? null;
      const levelPct = toFiniteOrNull(recommendationSnapshot?.recommendationLevelPct);
      const levelAvg3Pct = toFiniteOrNull(recommendationSnapshot?.recommendationLevelAvg3Pct);
      const levelAvg12Pct = toFiniteOrNull(recommendationSnapshot?.recommendationLevelAvg12Pct);
      const levelRecentMonths = recommendationSnapshot?.recommendationLevelRecentMonths || [];
      const levelWindowMonths = recommendationSnapshot?.recommendationLevelWindowMonths || [];
      const seasonalityFactorPct = toFiniteOrNull(recommendationSnapshot?.recommendationSeasonalityPct);
      const seasonalityMonthMeanPct = toFiniteOrNull(recommendationSnapshot?.recommendationSeasonalityMonthMeanPct);
      const seasonalityOverallMeanPct = toFiniteOrNull(recommendationSnapshot?.recommendationSeasonalityOverallMeanPct);
      const safetyMarginPct = toFiniteOrNull(recommendationSnapshot?.recommendationSafetyMarginPct)
        ?? toFiniteOrNull(recommendationSnapshot?.recommendationRiskAdjustmentPct);
      const activeQuote = toFiniteOrNull(sandboxSnapshot?.payoutPct)
        ?? (quoteMode === "manual" ? manualQuote : recommendedQuote);
      const forecastRevenue = toFiniteOrNull(forecastSnapshot?.appliedRevenue)
        ?? toFiniteOrNull(forecastSnapshot?.forecastRevenueRaw);
      const calibratedRevenue = toFiniteOrNull(calibratedSnapshot?.appliedRevenue)
        ?? toFiniteOrNull(calibratedSnapshot?.forecastRevenueRaw);
      const activeRevenue = toFiniteOrNull(sandboxSnapshot?.appliedRevenue)
        ?? (revenueCalibrationMode === "calibrated" ? calibratedRevenue : forecastRevenue);

      return {
        key: month,
        month,
        monthLabel: formatMonthLabel(month),
        manualQuote,
        recommendedQuote,
        levelPct,
        levelAvg3Pct,
        levelAvg12Pct,
        levelRecentMonths,
        levelWindowMonths,
        seasonalityFactorPct,
        seasonalityMonthMeanPct,
        seasonalityOverallMeanPct,
        safetyMarginPct,
        deltaPct: Number.isFinite(Number(recommendedQuote)) && Number.isFinite(Number(manualQuote))
          ? Number(recommendedQuote) - Number(manualQuote)
          : null,
        activeQuote,
        forecastRevenue,
        calibratedRevenue,
        deltaRevenue: Number.isFinite(Number(calibratedRevenue)) && Number.isFinite(Number(forecastRevenue))
          ? Number(calibratedRevenue) - Number(forecastRevenue)
          : null,
        activeRevenue,
        seasonalitySourceTag: normalizeSeasonalitySourceTag(recommendationSnapshot?.recommendationSeasonalitySourceTag || null),
        seasonalityProfileSource: recommendationSnapshot?.recommendationSeasonalityProfileSource || null,
      };
    });
  }, [
    baseByMonth,
    manualQuoteByMonth,
    months,
    quoteMode,
    recommendationByMonth,
    revenueCalibratedByMonth,
    revenueCalibrationMode,
    revenueForecastByMonth,
    sandboxByMonth,
  ]);

  const payoutSummary = useMemo(() => {
    return {
      avgActiveQuote: averageFinite(rows.map((row) => row.activeQuote)),
      avgManualQuote: averageFinite(rows.map((row) => row.manualQuote)),
      avgRecommendedQuote: averageFinite(rows.map((row) => row.recommendedQuote)),
      validDeltaCount: rows.filter((row) => Number.isFinite(Number(row.deltaPct))).length,
      monthCount: rows.length,
    };
  }, [rows]);
  const revenueSummary = useMemo(() => {
    return {
      avgActiveRevenue: averageFinite(rows.map((row) => row.activeRevenue)),
      avgForecastRevenue: averageFinite(rows.map((row) => row.forecastRevenue)),
      avgCalibratedRevenue: averageFinite(rows.map((row) => row.calibratedRevenue)),
      validDeltaCount: rows.filter((row) => Number.isFinite(Number(row.deltaRevenue))).length,
      monthCount: rows.length,
    };
  }, [rows]);

  const payoutColumns = useMemo<ColumnsType<SandboxQuoteRow>>(() => {
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
            <Tooltip title="Automatisch berechnet aus Level + Saisonalitätsfaktor − Sicherheitsmarge.">
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
            <Tooltip title="Basiswert ohne Sicherheitsmarge; berechnet aus jüngsten Ist-Daten (stärker) und letzten 12 Monaten (schwächer).">
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
            <span>Saisonalitätsfaktor (pp)</span>
            <Tooltip title="Monatsspezifischer Faktor in Prozentpunkten (pp) aus dem Saisonalitätsprofil der Historie.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "seasonalityFactorPct",
        key: "seasonalityFactorPct",
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
            <Tooltip title="Kleiner Sicherheitsabschlag, damit Planung leicht vorsichtig bleibt.">
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
            <span>Herleitung (kurz)</span>
            <Tooltip title="Kurze Begründung der empfohlenen Quote je Monat.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        key: "derivation",
        width: 250,
        render: (_value: unknown, row) => {
          const avg3Text = Number.isFinite(Number(row.levelAvg3Pct))
            ? formatPercent(row.levelAvg3Pct)
            : "—";
          const avg12Text = Number.isFinite(Number(row.levelAvg12Pct))
            ? formatPercent(row.levelAvg12Pct)
            : "—";
          const recentList = formatSampleList(row.levelRecentMonths, 3);
          const windowCount = row.levelWindowMonths.length;
          const monthMeanText = Number.isFinite(Number(row.seasonalityMonthMeanPct))
            ? formatPercent(row.seasonalityMonthMeanPct)
            : "—";
          const overallMeanText = Number.isFinite(Number(row.seasonalityOverallMeanPct))
            ? formatPercent(row.seasonalityOverallMeanPct)
            : "—";
          const factorText = formatSignedPp(row.seasonalityFactorPct);
          const sourceText = row.seasonalitySourceTag || "Keine Historie";
          const profileSourceText = row.seasonalityProfileSource || "Historie (Mai 2022–Jan 2026)";
          const marginText = Number.isFinite(Number(row.safetyMarginPct))
            ? formatSignedPp(-Number(row.safetyMarginPct))
            : "−0,3 pp";
          const levelText = formatPercent(row.levelPct);
          const recommendedText = formatPercent(row.recommendedQuote);
          return (
            <Tooltip
              title={(
                <Space direction="vertical" size={2}>
                  <Text>Level (aktuelles Niveau): {levelText}</Text>
                  <Text>Saisonalitätsfaktor (pp): {factorText} (Historie-Prior)</Text>
                  <Text>Sicherheitsmarge (pp): {marginText}</Text>
                  <Text>Empfohlene Quote: {recommendedText}</Text>
                  <Text>Saisonalitätsprofil: {profileSourceText}</Text>
                  <Text>Level (70/30): Ø3M {avg3Text}, Ø12M {avg12Text}</Text>
                  <Text>3M-Inputs: {recentList}</Text>
                  <Text>12M-Inputs: Ø12M {avg12Text} (n={windowCount})</Text>
                  <Text>Saison: Monatsmittel {monthMeanText}, Gesamtmittel {overallMeanText}</Text>
                  <Text>Saisonalitätsfaktor (pp): {factorText}</Text>
                  <Text>Quelle: {sourceText}</Text>
                </Space>
              )}
            >
              <Space size={4}>
                <span>Level 70/30 · Saison Monat · Marge 0,3pp</span>
                <InfoCircleOutlined />
              </Space>
            </Tooltip>
          );
        },
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
  const revenueColumns = useMemo<ColumnsType<SandboxQuoteRow>>(() => {
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
            <span>Umsatz Forecast</span>
            <Tooltip title="Monatsumsatz ohne Kalibrierung (reiner Forecast/Plan-Umsatz).">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "forecastRevenue",
        key: "forecastRevenue",
        width: 190,
        align: "right",
        render: (value: number | null) => formatCurrency(value),
      },
      {
        title: (
          <Space size={6}>
            <span>Umsatz Kalibriert</span>
            <Tooltip title="Monatsumsatz mit Kalibrierung (gleiche Umsatzbasis, aber mit Kalibrierfaktor).">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "calibratedRevenue",
        key: "calibratedRevenue",
        width: 190,
        align: "right",
        render: (value: number | null) => formatCurrency(value),
      },
      {
        title: (
          <Space size={6}>
            <span>Delta</span>
            <Tooltip title="Kalibriert minus Forecast pro Monat. Positiv = Kalibrierung hebt den Umsatz.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "deltaRevenue",
        key: "deltaRevenue",
        width: 160,
        align: "right",
        className: "v2-sandbox-col-delta v2-sandbox-col-delta-strong",
        render: (value: number | null) => (
          <span className={deltaClassName(value)}>{formatSignedCurrency(value)}</span>
        ),
      },
      {
        title: (
          <Space size={6}>
            <span>Aktiv</span>
            <Tooltip title="Umsatz, der in der Sandbox aktuell im Cashflow verwendet wird.">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        ),
        dataIndex: "activeRevenue",
        key: "activeRevenue",
        width: 170,
        align: "right",
        fixed: "right",
        className: "v2-sandbox-col-sandbox",
        render: (value: number | null) => formatCurrency(value),
      },
    ];
  }, []);
  const columns = tableFocus === "revenue" ? revenueColumns : payoutColumns;

  const scenarioText = quoteMode === "manual"
    ? "Base Case aktiv: Auszahlungsquote = Manuell."
    : "Vergleich aktiv: Auszahlungsquote = Empfohlen (Plan).";
  const deltaHintText = tableFocus === "revenue"
    ? "Delta-Spalte: Kalibriert minus Forecast."
    : "Delta-Spalte: Empfohlen minus Manuell.";

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Row gutter={[10, 10]} className="v2-page-head">
          <Col xs={24} xl={16}>
            <Title level={3}>Sandbox</Title>
            <Paragraph>
              Transparenzansicht für die Amazon-Auszahlungsquote. Du siehst pro Monat, wie sich Empfohlen (Plan) aus
              Level, Saisonalitätsfaktor und Sicherheitsmarge zusammensetzt.
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
              onChange={(value) => {
                const nextMode = String(value) === "forecast" ? "forecast" : "calibrated";
                void persistSandboxCashInSettings({
                  cashInCalibrationEnabled: nextMode === "calibrated",
                }).catch(() => {});
              }}
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
              onChange={(value) => {
                const nextMode = String(value) === "recommendation" ? "recommendation" : "manual";
                void persistSandboxCashInSettings({
                  cashInQuoteMode: nextMode,
                }).catch(() => {});
              }}
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
            <Text type="secondary">{deltaHintText}</Text>
            <Text type="secondary">Keine Überschreibung deiner manuellen Tabelle.</Text>
          </div>
        </div>
      </Card>

      <Card>
        {tableFocus === "payout" ? (
          <>
            <div className="v2-sandbox-summary-head">
              <Text strong>Ø Manuell:</Text>
              <Text>{formatPercent(payoutSummary.avgManualQuote)}</Text>
              <Text strong>Ø Empfohlen (Plan):</Text>
              <Text>{formatPercent(payoutSummary.avgRecommendedQuote)}</Text>
              <Text strong>Ø Aktiv:</Text>
              <Text>{formatPercent(payoutSummary.avgActiveQuote)}</Text>
            </div>
            <div className="v2-sandbox-summary-head">
              <Text type="secondary">{payoutSummary.validDeltaCount} Monate mit direktem Delta-Vergleich.</Text>
            </div>
          </>
        ) : (
          <>
            <div className="v2-sandbox-summary-head">
              <Text strong>Ø Forecast:</Text>
              <Text>{formatCurrency(revenueSummary.avgForecastRevenue)}</Text>
              <Text strong>Ø Kalibriert:</Text>
              <Text>{formatCurrency(revenueSummary.avgCalibratedRevenue)}</Text>
              <Text strong>Ø Aktiv:</Text>
              <Text>{formatCurrency(revenueSummary.avgActiveRevenue)}</Text>
            </div>
            <div className="v2-sandbox-summary-head">
              <Text type="secondary">{revenueSummary.validDeltaCount} Monate mit direktem Delta-Vergleich.</Text>
            </div>
          </>
        )}
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={4} style={{ margin: 0 }}>Monatsvergleich</Title>
          <Space size={10} wrap>
            <Text type="secondary">
              {(tableFocus === "revenue" ? revenueSummary.monthCount : payoutSummary.monthCount)} Monate im Planungszeitraum
            </Text>
            <Segmented
              size="small"
              value={tableFocus}
              onChange={(value) => setTableFocus(String(value) === "revenue" ? "revenue" : "payout")}
              options={[
                { label: "Auszahlung", value: "payout" },
                { label: "Umsatz", value: "revenue" },
              ]}
            />
          </Space>
        </Space>
        <Table<SandboxQuoteRow>
          className="v2-ant-table v2-sandbox-table"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          rowKey="key"
          scroll={{ x: 1700, y: 560 }}
          sticky
        />
      </Card>
    </div>
  );
}
