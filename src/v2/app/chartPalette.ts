export const v2ChartPalette = {
  brandNavy: "#1A2E4B",
  accentGold: "#C5A059",
  textStrong: "#1A2E4B",
  textMuted: "#6B7280",
  textSubtle: "#8B96A5",
  axisLine: "rgba(26, 46, 75, 0.24)",
  gridLine: "rgba(26, 46, 75, 0.10)",
  gridLineStrong: "rgba(26, 46, 75, 0.18)",
  successDark: "#1B5E20",
  success: "#2E7D32",
  successSoft: "#4CAF50",
  tealSoft: "#4DB6AC",
  dangerDark: "#B71C1C",
  danger: "#D32F2F",
  dangerSoft: "#EF5350",
  warning: "#FFA000",
  warningDark: "#F57F17",
  info: "#2563EB",
  infoSoft: "#0EA5E9",
  slate: "#64748B",
  slateLight: "#94A3B8",
  areaGoldSoft: "rgba(197, 160, 89, 0.16)",
  areaBlueSoft: "rgba(37, 99, 235, 0.12)",
  areaWarningSoft: "rgba(255, 160, 0, 0.14)",
  overlayProvisional: "rgba(197, 160, 89, 0.65)",
  neutralBarSoft: "rgba(100, 116, 139, 0.30)",
  markerPoBorder: "#134E4A",
  markerFoBorder: "#1B5E20",
  markerPhantomBorder: "#9A3412",
} as const;

export const v2DashboardChartColors = {
  amazonCore: v2ChartPalette.successDark,
  amazonPlanned: v2ChartPalette.success,
  amazonNew: v2ChartPalette.successSoft,
  otherInflow: v2ChartPalette.tealSoft,
  fixcost: v2ChartPalette.dangerDark,
  po: v2ChartPalette.danger,
  fo: v2ChartPalette.dangerSoft,
  phantomFo: v2ChartPalette.warningDark,
  net: v2ChartPalette.brandNavy,
  robustPositive: v2ChartPalette.accentGold,
  robustNegative: v2ChartPalette.danger,
  softPositive: v2ChartPalette.slateLight,
  softNegative: v2ChartPalette.warningDark,
} as const;

export const v2SollIstChartColors = {
  positive: v2ChartPalette.success,
  negative: v2ChartPalette.danger,
  provisionalOverlay: v2ChartPalette.overlayProvisional,
  plannedClosing: v2ChartPalette.brandNavy,
  actualClosing: v2ChartPalette.infoSoft,
  provisionalArea: v2ChartPalette.areaGoldSoft,
  plannedRevenue: v2ChartPalette.slateLight,
  actualRevenue: v2ChartPalette.infoSoft,
  plannedPayoutRate: v2ChartPalette.slate,
  actualPayoutRate: v2ChartPalette.warningDark,
  totalDriver: v2ChartPalette.brandNavy,
} as const;

export const v2SkuPlanningChartColors = {
  demandBar: v2ChartPalette.neutralBarSoft,
  safetyArea: v2ChartPalette.areaWarningSoft,
  safetyLine: v2ChartPalette.warning,
  baseInventory: v2ChartPalette.info,
  oosLine: v2ChartPalette.danger,
  simulationInventory: v2ChartPalette.warningDark,
  markerPo: v2ChartPalette.tealSoft,
  markerFo: v2ChartPalette.success,
  markerPhantom: v2ChartPalette.warningDark,
} as const;

export const v2AbcChartColors = {
  paretoLine: v2ChartPalette.info,
  paretoArea: v2ChartPalette.areaBlueSoft,
  thresholdLine: "rgba(26, 46, 75, 0.42)",
} as const;

export const v2ProductsChartColors = {
  seasonalityLine: v2ChartPalette.brandNavy,
  seasonalityPoint: v2ChartPalette.accentGold,
} as const;
