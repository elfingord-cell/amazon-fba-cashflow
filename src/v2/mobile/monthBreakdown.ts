// Baut die Anzeige-Gruppen des Monats-Detail-Sheets (Eingänge / Ausgänge).
//
// PARITÄT: Die Sektions-Summen UND die Gruppen-Totale werden aus dem
// Modell-Aggregat (row.inflow/row.outflow und row.inflowSplit/row.outflowSplit)
// gespeist — exakt denselben Werten, die der Kopf des Sheets (Start-/Endsaldo)
// verwendet und die das Desktop-Dashboard via aggregateDashboardMonthEntries
// nutzt. Dadurch gilt immer: opening + Σ Eingänge − Σ Ausgänge = closing, und die
// Gruppen summieren sich exakt zur Sektions-Summe (Rest landet in „Sonstiges").
// Die einzelnen Einträge (row.entries) dienen nur als aufklappbare Positionsliste
// und zur Feinaufteilung des „Sonstiges"-Eimers in Importkosten/Dividende.
import {
  isDashboardEntryInBucketScope,
  DASHBOARD_TAX_LABELS,
  type DashboardCashflowEntry,
} from "../domain/dashboardCashflow";
import type { CfpMonthRow } from "../domain/cfpModel";

export interface BreakdownItem {
  label: string;
  sub?: string;
  amount: number;
}

export interface BreakdownGroup {
  key: string;
  label: string;
  total: number;
  items: BreakdownItem[];
}

export interface MonthBreakdown {
  inflows: BreakdownGroup[];
  outflows: BreakdownGroup[];
  inflowTotal: number;
  outflowTotal: number;
}

function entryText(entry: DashboardCashflowEntry): string {
  return `${entry.label || ""} ${entry.group || ""} ${entry.kind || ""} ${entry.tooltip || ""}`.toLowerCase();
}

function isInflowEntry(entry: DashboardCashflowEntry): boolean {
  // Spiegelt aggregateDashboardMonthEntries: nur source 'sales' zählt als Eingang.
  // Steuer-Erstattungen (source 'vat', direction 'in') bleiben in den Ausgängen
  // (negative Steuer) und werden NICHT als Eingang umgeroutet.
  return String(entry.source || "").toLowerCase() === "sales";
}

function isImportEntry(entry: DashboardCashflowEntry): boolean {
  const source = String(entry.source || "").toLowerCase();
  if (source === "extras") return true;
  return /import|fracht|zoll|logist|duty|freight|forto|seefracht|customs|spedition/.test(entryText(entry));
}

function isDividendEntry(entry: DashboardCashflowEntry): boolean {
  const source = String(entry.source || "").toLowerCase();
  if (source === "dividends") return true;
  return /dividend|aussch[üu]ttung/.test(entryText(entry));
}

function itemLabel(entry: DashboardCashflowEntry): { label: string; sub?: string } {
  const number = String(entry.sourceNumber || "").trim();
  const label = String(entry.label || "").trim() || number || "Position";
  if (number && !label.includes(number)) return { label, sub: number };
  return { label };
}

function itemsFor(entries: DashboardCashflowEntry[], predicate: (e: DashboardCashflowEntry) => boolean): BreakdownItem[] {
  return entries
    .filter(predicate)
    .filter((entry) => Math.abs(Number(entry.amount || 0)) > 0)
    .map((entry) => ({ ...itemLabel(entry), amount: Math.abs(Number(entry.amount || 0)) }));
}

export function buildMonthBreakdown(row: CfpMonthRow, bucketScope: Set<string>): MonthBreakdown {
  const inSplit = row.inflowSplit;
  const outSplit = row.outflowSplit;
  const entries = (Array.isArray(row.entries) ? row.entries : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => isDashboardEntryInBucketScope(entry, bucketScope));

  // ---- Eingänge: Totale aus dem Split (amazon + other = row.inflow) ----
  const inflows: BreakdownGroup[] = [];
  if (Math.abs(inSplit.amazon) > 0) {
    inflows.push({ key: "amazon", label: "Amazon-Auszahlung", total: inSplit.amazon, items: itemsFor(entries, isInflowEntry) });
  }
  const otherIn = row.inflow - inSplit.amazon;
  if (Math.abs(otherIn) > 0.5) {
    inflows.push({
      key: "other_in",
      label: "Sonstige Eingänge",
      total: otherIn,
      items: itemsFor(entries, (e) => !isInflowEntry(e) && Number(e.amount || 0) > 0 && String(e.direction || "").toLowerCase() !== "out"),
    });
  }

  // ---- Ausgänge: Totale aus dem Split; Rest als Residual in „Sonstiges" ----
  const supplier = outSplit.po + outSplit.fo + outSplit.phantomFo;
  const fix = outSplit.fixcost;
  const tax = outSplit.tax;

  // 'other'-Eimer per Einträgen in Importkosten/Dividende feinaufteilen
  const otherEntries = entries.filter((e) =>
    !isInflowEntry(e)
    && !["po", "fo", "fixcosts", "vat"].includes(String(e.source || "").toLowerCase())
    && !/steuer|ust|umsatzsteuer|\boss\b|gewerbe|körperschaft|koerperschaft/.test(entryText(e)));
  let importSum = 0;
  let dividendSum = 0;
  for (const e of otherEntries) {
    const amt = Math.abs(Number(e.amount || 0));
    if (amt <= 0) continue;
    if (isImportEntry(e)) importSum += amt;
    else if (isDividendEntry(e)) dividendSum += amt;
  }
  // Residual stellt sicher, dass Σ Ausgänge-Gruppen == row.outflow (Parität zum Kopf).
  const rest = row.outflow - supplier - fix - tax - importSum - dividendSum;

  const taxItems: BreakdownItem[] = Object.entries(outSplit.taxByType || {})
    .filter(([, value]) => Math.abs(Number(value || 0)) > 0.5)
    .map(([key, value]) => ({ label: DASHBOARD_TAX_LABELS[key] || key, amount: Number(value) }));

  const outflows: BreakdownGroup[] = [];
  if (Math.abs(supplier) > 0.5) outflows.push({ key: "supplier", label: "Lieferanten-Zahlungen", total: supplier, items: itemsFor(entries, (e) => ["po", "fo"].includes(String(e.source || "").toLowerCase())) });
  if (Math.abs(importSum) > 0.5) outflows.push({ key: "import", label: "Importkosten", total: importSum, items: itemsFor(otherEntries, isImportEntry) });
  if (Math.abs(fix) > 0.5) outflows.push({ key: "fix", label: "Fixkosten", total: fix, items: itemsFor(entries, (e) => String(e.source || "").toLowerCase() === "fixcosts") });
  if (Math.abs(tax) > 0.5) outflows.push({ key: "tax", label: "Steuern / USt", total: tax, items: taxItems });
  if (Math.abs(dividendSum) > 0.5) outflows.push({ key: "dividend", label: "Dividende", total: dividendSum, items: itemsFor(otherEntries, isDividendEntry) });
  if (Math.abs(rest) > 0.5) outflows.push({ key: "other", label: "Sonstiges", total: rest, items: itemsFor(otherEntries, (e) => !isImportEntry(e) && !isDividendEntry(e)) });

  return { inflows, outflows, inflowTotal: row.inflow, outflowTotal: row.outflow };
}
