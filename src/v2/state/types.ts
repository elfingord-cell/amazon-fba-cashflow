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
