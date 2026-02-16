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

export interface ForecastVersionStats {
  rowCount: number;
  skuCount: number;
  monthCount: number;
}

export interface ForecastVersion {
  id: string;
  name: string;
  note?: string | null;
  createdAt: string;
  sourceLabel?: string | null;
  importMode?: "merge" | "overwrite" | string | null;
  onlyActiveSkus?: boolean;
  forecastImport: Record<string, unknown>;
  stats: ForecastVersionStats;
}

export interface ForecastFoConflictDecision {
  ignored?: boolean;
  ignoredAt?: string | null;
  ignoredBy?: string | null;
  reason?: string | null;
}

export interface ForecastImpactSummary {
  comparedAt: string;
  fromVersionId: string | null;
  fromVersionName: string | null;
  toVersionId: string | null;
  toVersionName: string | null;
  flaggedSkus: number;
  flaggedAB: number;
  foConflictsTotal: number;
  foConflictsOpen: number;
}

export interface ForecastState extends UnknownRecord {
  items?: UnknownRecord[];
  settings?: UnknownRecord;
  forecastImport?: Record<string, unknown>;
  forecastManual?: Record<string, unknown>;
  versions?: ForecastVersion[];
  activeVersionId?: string | null;
  lastImpactSummary?: ForecastImpactSummary | null;
  foConflictDecisionsByVersion?: Record<string, Record<string, ForecastFoConflictDecision>>;
  lastImportAt?: string | null;
  importSource?: string | null;
  importCadence?: "monthly";
  lastDriftSummary?: ForecastDriftSummary | null;
  lastDriftReviewedAt?: string | null;
  lastDriftReviewedComparedAt?: string | null;
}

export interface PoItem extends UnknownRecord {
  id?: string;
  sku: string;
  units: number;
  unitCostUsd: number;
  unitExtraUsd?: number;
  extraFlatUsd?: number;
  prodDays: number;
  transitDays: number;
  freightEur?: number;
}

export interface PoRecordV2 extends UnknownRecord {
  id: string;
  poNo: string;
  supplierId: string;
  orderDate?: string | null;
  etdManual?: string | null;
  etaManual?: string | null;
  arrivalDate?: string | null;
  items?: PoItem[];
  sku?: string;
  units?: number;
  prodDays?: number;
  transitDays?: number;
  freightEur?: number;
  milestones?: UnknownRecord[];
  paymentLog?: Record<string, UnknownRecord>;
}

export interface AppStateV2 extends UnknownRecord {
  schemaVersion: 2;
  legacyMeta: LegacyMeta;
  settings?: UnknownRecord;
  products?: UnknownRecord[];
  planProducts?: UnknownRecord[];
  planProductMappings?: UnknownRecord[];
  suppliers?: UnknownRecord[];
  productSuppliers?: UnknownRecord[];
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
