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
  forecast?: UnknownRecord;
  monthlyActuals?: Record<string, unknown>;
  incomings?: UnknownRecord[];
  extras?: UnknownRecord[];
  dividends?: UnknownRecord[];
  fixcosts?: UnknownRecord[];
  fixcostOverrides?: UnknownRecord;
}

export type ImportMode = "replace_workspace" | "merge_upsert";
