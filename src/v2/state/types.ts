export type UnknownRecord = Record<string, unknown>;

export interface LegacyMeta {
  unmapped: Record<string, unknown>;
  importHistory: Array<{
    id: string;
    appliedAt: string;
    mode: string;
    sourceVersion: string;
  }>;
}

export interface ForecastDriftTopItem {
  sku: string;
  month: string;
  abcClass: "A" | "B" | "C";
  prevUnits: number;
  nextUnits: number;
  deltaUnits: number;
  deltaPct: number;
  prevRevenue: number;
  nextRevenue: number;
  deltaRevenue: number;
}

export interface ForecastDriftSummary {
  comparedAt: string;
  thresholdProfile: "medium";
  flaggedSkuCount: number;
  flaggedABCount: number;
  flaggedMonthCount: number;
  topItems: ForecastDriftTopItem[];
}

export interface ForecastState extends UnknownRecord {
  items?: UnknownRecord[];
  settings?: UnknownRecord;
  forecastImport?: Record<string, unknown>;
  forecastManual?: Record<string, unknown>;
  lastImportAt?: string | null;
  importSource?: string | null;
  importCadence?: "monthly";
  lastDriftSummary?: ForecastDriftSummary | null;
}

export interface AppStateV2 extends UnknownRecord {
  schemaVersion: 2;
  legacyMeta: LegacyMeta;
  settings?: UnknownRecord;
  products?: UnknownRecord[];
  suppliers?: UnknownRecord[];
  pos?: UnknownRecord[];
  fos?: UnknownRecord[];
  payments?: UnknownRecord[];
  productCategories?: UnknownRecord[];
  inventory?: UnknownRecord;
  forecast?: ForecastState;
  monthlyActuals?: Record<string, unknown>;
  incomings?: UnknownRecord[];
  extras?: UnknownRecord[];
  dividends?: UnknownRecord[];
  fixcosts?: UnknownRecord[];
  fixcostOverrides?: UnknownRecord;
}

export type ImportMode = "replace_workspace" | "merge_upsert";
