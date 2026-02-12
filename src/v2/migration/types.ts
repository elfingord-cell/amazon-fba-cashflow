import type { AppStateV2, ImportMode } from "../state/types";

export { ImportMode };

export interface ImportIssue {
  code: string;
  severity: "error" | "warning" | "info";
  entityType: string;
  entityId?: string;
  message: string;
}

export interface ImportSectionStats {
  section: string;
  total: number;
  mapped: number;
  normalized: number;
  skipped: number;
  blocked: number;
}

export interface ImportDryRunReport {
  sourceVersion: "legacy_v1" | "unknown";
  targetVersion: "v2";
  sections: ImportSectionStats[];
  issues: ImportIssue[];
  canApply: boolean;
}

export interface ImportApplyResult {
  mode: ImportMode;
  backupId: string;
  report: ImportDryRunReport;
  appliedAt: string;
}

export interface DryRunBundle {
  sourceState: unknown;
  mappedState: AppStateV2;
  report: ImportDryRunReport;
}
