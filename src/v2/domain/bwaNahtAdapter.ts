// bwaNahtAdapter.ts
//
// Reiner Adapter zwischen AppStateV2 und der Buchhaltungs-Domäne
// inventoryChangeForecast.js. Extrahiert defensiv die Inputs für
// computeInventoryChange(...) aus dem Workspace-State und liefert die
// periodengerechte BWA-Brücke (bridgeBwaErgebnis) plus den aus dem CLI
// committeten Jahres-Ausblick (state.forecastCalibration) als anzeigefertiges
// Objekt zurück.
//
// WICHTIG (Fachlogik): Dieser Adapter greift NICHT in die Plan-GuV ein. Er
// bereitet nur die reale BWA-Seite auf. Die Vorzeichen-/Bestandslogik liegt
// vollständig in inventoryChangeForecast.js — hier wird nur extrahiert und
// durchgereicht. Die Felder von forecastCalibration werden vom CLI
// tools/fba-cli/import-bwa.mjs committet (state.forecastCalibration).

import { computeInventoryChange, bridgeBwaErgebnis } from "../../domain/inventoryChangeForecast.js";
import type { AppStateV2 } from "../state/types";

export interface BwaNahtForecastCalibration {
  jahrUmsatzPrognose: number | null;
  jahrErgebnisVorSteuernPrognose: number | null;
  jahrVorlaeufigesErgebnisPrognose: number | null;
  niveauFaktor: number | null;
  stichtag: string | null;
  baseYear: number | null;
  forecastYear: number | null;
  abgeschlosseneMonate: string[];
  kalibrierteForecastMonate: Record<string, number>;
  margeVorSteuern: number | null;
  margeNachSteuern: number | null;
  stand: string | null;
}

export interface BwaNahtBridgeRow {
  month: string;
  roheBwaErgebnisEur: number | null;
  bestandsveraenderungEur: number;
  bereinigtesErgebnisEur: number | null;
  source: "datev" | "projected" | "calibrated" | "snapshot" | null;
}

export interface BwaNahtInventoryRow {
  month: string;
  openingInventoryEur: number;
  closingInventoryEur: number;
  bestandsveraenderungEur: number;
  source: "datev" | "projected" | "calibrated" | "snapshot";
}

export interface BwaNahtResult {
  forecastCalibration: BwaNahtForecastCalibration | null;
  bridgeRows: BwaNahtBridgeRow[];
  inventoryRows: BwaNahtInventoryRow[];
  hasInventoryInputs: boolean;
  notes: string[];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// monthlyActuals-Felder liegen entweder flach (Zahl/String) oder als
// versioniertes Cell-Objekt { value, source, confidence } (DATEV-BWA-Import via
// tools/fba-cli/import-bwa.mjs) vor. Beide Formen defensiv auf eine Zahl bringen.
function cellNumberOrNull(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return toNumberOrNull((value as Record<string, unknown>).value);
  }
  return toNumberOrNull(value);
}

function toUnits(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMonthKey(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  return raw;
}

// ISO-Monatsende ("YYYY-MM" -> "YYYY-MM-DD" letzter Tag).
function monthEndISO(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

// Snapshot-Einheiten je SKU: amazonUnits + threePLUnits, sonst legacy units.
function snapshotItemUnits(item: Record<string, unknown>): number {
  const amazon = Number(item.amazonUnits);
  const threePl = Number(item.threePLUnits);
  const hasSplit = Number.isFinite(amazon) || Number.isFinite(threePl);
  if (hasSplit) {
    return (Number.isFinite(amazon) ? amazon : 0) + (Number.isFinite(threePl) ? threePl : 0);
  }
  return toUnits(item.units);
}

// Lagerwert je Monatsende (EUR) aus JEDEM Snapshot:
//   Σ über items( snapshotItemUnits(item) × landedUnitCostEur[sku] ).
// Liefert { "YYYY-MM": EUR }. Snapshots ohne items oder ohne bewertbaren SKU
// tragen 0 bei (ein leerer/unbewertbarer Snapshot ergibt Lagerwert 0).
function snapshotInventoryValueByMonth(
  snapshots: Array<Record<string, unknown>>,
  landedCostBySku: Record<string, number>,
): Record<string, number> {
  const valueByMonth: Record<string, number> = {};
  snapshots.forEach((snap) => {
    const month = normalizeMonthKey(snap.month);
    if (!month) return;
    let total = 0;
    if (Array.isArray(snap.items)) {
      (snap.items as unknown[]).forEach((itemRaw) => {
        const item = toRecord(itemRaw);
        const sku = String(item.sku || "").trim();
        if (!sku) return;
        const units = snapshotItemUnits(item);
        const unitCost = landedCostBySku[sku];
        if (unitCost == null) return;
        total += units * unitCost;
      });
    }
    valueByMonth[month] = total;
  });
  return valueByMonth;
}

function resolvePoEtaMonth(po: Record<string, unknown>): string | null {
  const raw = po.etaManual || po.etaDate || po.eta || po.etaComputed;
  if (!raw) return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function resolveFoArrivalMonth(fo: Record<string, unknown>): string | null {
  const raw = fo.targetDeliveryDate || fo.deliveryDate || fo.etaDate;
  if (!raw) return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addArrivals(
  target: Record<string, Record<string, number>>,
  records: unknown,
  resolveMonth: (record: Record<string, unknown>) => string | null,
): void {
  (Array.isArray(records) ? records : []).forEach((entry) => {
    const record = toRecord(entry);
    const month = resolveMonth(record);
    if (!month) return;
    const items = Array.isArray(record.items) && (record.items as unknown[]).length
      ? (record.items as unknown[])
      : [{ sku: record.sku, units: record.units }];
    items.forEach((itemRaw) => {
      const item = toRecord(itemRaw);
      const sku = String(item.sku || record.sku || "").trim();
      if (!sku) return;
      const units = toUnits(item.units ?? item.qty ?? item.quantity ?? record.units);
      if (!units) return;
      if (!target[sku]) target[sku] = {};
      target[sku][month] = (target[sku][month] || 0) + units;
    });
  });
}

/**
 * buildBwaNaht
 *
 * @param {AppStateV2} state  Workspace-State (V2).
 * @returns {BwaNahtResult}   forecastCalibration (Jahres-Ausblick), bridgeRows
 *   (periodengerechte BWA-Brücke je Monat), inventoryRows (Roh-Bestandsdelta),
 *   hasInventoryInputs (ob Snapshots/Landed-Cost vorhanden) und notes
 *   (Degradations-Hinweise).
 */
export function buildBwaNaht(state: AppStateV2): BwaNahtResult {
  const notes: string[] = [];

  // --- Jahres-Ausblick (aus dem CLI committet) ------------------------------
  const calibrationRaw = (state as unknown as Record<string, unknown>).forecastCalibration;
  let forecastCalibration: BwaNahtForecastCalibration | null = null;
  if (calibrationRaw && typeof calibrationRaw === "object") {
    const c = calibrationRaw as Record<string, unknown>;
    forecastCalibration = {
      jahrUmsatzPrognose: toNumberOrNull(c.jahrUmsatzPrognose),
      jahrErgebnisVorSteuernPrognose: toNumberOrNull(c.jahrErgebnisVorSteuernPrognose),
      jahrVorlaeufigesErgebnisPrognose: toNumberOrNull(c.jahrVorlaeufigesErgebnisPrognose),
      niveauFaktor: toNumberOrNull(c.niveauFaktor),
      stichtag: c.stichtag == null ? null : String(c.stichtag),
      baseYear: toNumberOrNull(c.baseYear),
      forecastYear: toNumberOrNull(c.forecastYear),
      abgeschlosseneMonate: Array.isArray(c.abgeschlosseneMonate)
        ? (c.abgeschlosseneMonate as unknown[]).map((m) => String(m))
        : [],
      kalibrierteForecastMonate: toRecord(c.kalibrierteForecastMonate) as Record<string, number>,
      margeVorSteuern: toNumberOrNull(c.margeVorSteuern),
      margeNachSteuern: toNumberOrNull(c.margeNachSteuern),
      stand: c.stand == null ? null : String(c.stand),
    };
  } else {
    notes.push("Kein BWA-Import gefunden (state.forecastCalibration fehlt) — Jahres-Ausblick nicht verfügbar.");
  }

  // --- Snapshot (jüngster) -> Einheiten je SKU + Eröffnungsdatum ------------
  const inventory = toRecord(state.inventory);
  const snapshots = (Array.isArray(inventory.snapshots) ? inventory.snapshots : [])
    .map((entry) => toRecord(entry))
    .filter((snap) => normalizeMonthKey(snap.month))
    .sort((a, b) =>
      String(normalizeMonthKey(a.month)).localeCompare(String(normalizeMonthKey(b.month))),
    );

  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const snapshotMonth = latestSnapshot ? normalizeMonthKey(latestSnapshot.month) : null;
  const snapshotDateISO = snapshotMonth ? monthEndISO(snapshotMonth) : null;

  const snapshotUnitsBySku: Record<string, number> = {};
  if (latestSnapshot && Array.isArray(latestSnapshot.items)) {
    (latestSnapshot.items as unknown[]).forEach((itemRaw) => {
      const item = toRecord(itemRaw);
      const sku = String(item.sku || "").trim();
      if (!sku) return;
      snapshotUnitsBySku[sku] = snapshotItemUnits(item);
    });
  }

  // --- Landed-Cost je SKU aus den Produkten ---------------------------------
  const landedCostBySku: Record<string, number> = {};
  (Array.isArray(state.products) ? state.products : []).forEach((entry) => {
    const product = toRecord(entry);
    const sku = String(product.sku || "").trim();
    if (!sku) return;
    const landed = toNumberOrNull(product.landedUnitCostEur);
    if (landed != null) landedCostBySku[sku] = landed;
  });

  const hasSnapshots = Boolean(latestSnapshot && Object.keys(snapshotUnitsBySku).length);
  const hasLandedCost = Object.keys(landedCostBySku).length > 0;
  const hasInventoryInputs = hasSnapshots && hasLandedCost;

  // --- Historische Lagerwerte je Snapshot-Monat (Vergangenheit) -------------
  // Für JEDEN Snapshot (nicht nur den jüngsten) den Lagerwert je Monatsende.
  // Daraus ergibt sich die REALE Bestandsveränderung zwischen aufeinander-
  // folgenden Snapshot-Monaten: delta(m) = wert(m) - wert(vorheriger Snapshot).
  const snapshotValueByMonth = hasLandedCost
    ? snapshotInventoryValueByMonth(snapshots, landedCostBySku)
    : {};
  // Geordnete Liste der Snapshot-Monate (chronologisch, snapshots ist bereits sortiert).
  const snapshotMonthsOrdered = snapshots
    .map((snap) => normalizeMonthKey(snap.month))
    .filter((m): m is string => Boolean(m));
  // Reale Bestandsveränderung je Snapshot-Monat. Der erste Snapshot-Monat hat
  // keinen Vorgänger -> bestandsveraenderung = 0 (Eröffnung, source "snapshot").
  const snapshotChangeRows: BwaNahtInventoryRow[] = [];
  snapshotMonthsOrdered.forEach((month, idx) => {
    const closing = snapshotValueByMonth[month];
    if (closing == null) return;
    const prevMonth = idx > 0 ? snapshotMonthsOrdered[idx - 1] : null;
    const opening = prevMonth != null ? snapshotValueByMonth[prevMonth] ?? 0 : closing;
    snapshotChangeRows.push({
      month,
      openingInventoryEur: opening,
      closingInventoryEur: closing,
      bestandsveraenderungEur: closing - opening,
      source: "snapshot",
    });
  });
  const hasMultipleSnapshots = snapshotChangeRows.length >= 2;

  if (!hasSnapshots) {
    notes.push("Keine Lager-Snapshots vorhanden (VO-Snapshots) — Brücke läuft ohne Bestandskorrektur (Bestandsveränderung = 0, bereinigt == roh).");
  }
  if (hasSnapshots && !hasLandedCost) {
    notes.push("Keine Landed-Cost (landedUnitCostEur) an den Produkten — Lagerwert nicht bewertbar, Bestandsveränderung = 0.");
  }

  // --- Arrivals je SKU/Monat aus POs und FOs --------------------------------
  const arrivalsBySkuMonth: Record<string, Record<string, number>> = {};
  addArrivals(arrivalsBySkuMonth, state.pos, resolvePoEtaMonth);
  addArrivals(arrivalsBySkuMonth, state.fos, resolveFoArrivalMonth);

  // --- Absatz-Forecast je SKU/Monat -----------------------------------------
  const forecast = toRecord(state.forecast);
  const forecastManual = toRecord(forecast.forecastManual);
  const forecastImport = toRecord(forecast.forecastImport);
  const salesForecastBySkuMonth: Record<string, Record<string, number>> = {};
  const collectForecastSkus = new Set<string>([
    ...Object.keys(forecastManual),
    ...Object.keys(forecastImport),
  ]);
  collectForecastSkus.forEach((sku) => {
    const manualByMonth = toRecord(forecastManual[sku]);
    const importByMonth = toRecord(forecastImport[sku]);
    const months = new Set<string>([
      ...Object.keys(manualByMonth),
      ...Object.keys(importByMonth),
    ]);
    months.forEach((monthRaw) => {
      const month = normalizeMonthKey(monthRaw);
      if (!month) return;
      const manualValue = toNumberOrNull(manualByMonth[monthRaw]);
      const importValue = toNumberOrNull(toRecord(importByMonth[monthRaw]).units);
      const value = manualValue != null ? manualValue : importValue;
      if (value == null) return;
      if (!salesForecastBySkuMonth[sku]) salesForecastBySkuMonth[sku] = {};
      salesForecastBySkuMonth[sku][month] = value;
    });
  });

  // --- Monatshorizont: bis Jahresende des forecastYear, sonst 12 ------------
  let monthsAhead = 12;
  if (snapshotMonth && forecastCalibration?.forecastYear) {
    const [snapYear, snapMonth] = snapshotMonth.split("-").map(Number);
    const target = forecastCalibration.forecastYear * 12 + 12; // Dez. forecastYear
    const start = snapYear * 12 + snapMonth;
    const diff = target - start;
    monthsAhead = diff > 0 ? diff : 12;
  }

  // --- DATEV-Ist-Lagerwert & rohes BWA-Ergebnis je Monat (aus monthlyActuals)
  const monthlyActuals = toRecord(state.monthlyActuals);
  const datevClosingInventoryByMonth: Record<string, number> = {};
  const bwaErgebnisByMonth: Record<string, number> = {};
  Object.keys(monthlyActuals).forEach((monthRaw) => {
    const month = normalizeMonthKey(monthRaw);
    if (!month) return;
    const entry = toRecord(monthlyActuals[monthRaw]);
    // DATEV-Ist-Lagerwert (Konto 3980). Feldname variiert je Importer-Generation;
    // beide bekannten Schreibweisen akzeptieren (flach oder Cell-Objekt).
    const bestand = cellNumberOrNull(entry.bwaBestandWaren ?? entry.bwaBestandWarenEur);
    if (bestand != null) datevClosingInventoryByMonth[month] = bestand;
    // Rohes BWA-Ergebnis vor Steuern. Der DATEV-BWA-Import (import-bwa.mjs) legt
    // dies als `bwaErgebnis` (Cell-Objekt) ab; ältere/flache Stände als
    // `bwaErgebnisVorSteuern`. Beide Feldnamen + beide Formen akzeptieren.
    const ergebnis = cellNumberOrNull(entry.bwaErgebnisVorSteuern ?? entry.bwaErgebnis);
    if (ergebnis != null) bwaErgebnisByMonth[month] = ergebnis;
  });

  // --- Bestandsveränderung + Brücke ----------------------------------------
  // Vorwärts-Projektion (Zukunft) aus dem JÜNGSTEN Snapshot als Startpunkt.
  let projectedRows: BwaNahtInventoryRow[] = [];
  if (snapshotDateISO) {
    const result = computeInventoryChange({
      snapshotUnitsBySku,
      snapshotDateISO,
      monthsAhead,
      salesForecastBySkuMonth,
      arrivalsBySkuMonth,
      landedCostBySku,
      settings: toRecord(state.settings),
      datevClosingInventoryByMonth,
    }) as { rows: BwaNahtInventoryRow[] };
    projectedRows = Array.isArray(result?.rows) ? result.rows : [];
  } else {
    // Ohne Snapshot: Brücke über die Monate, für die ein BWA-Ergebnis vorliegt,
    // mit Bestandsveränderung = 0 (keine erfundene Korrektur).
    projectedRows = Object.keys(bwaErgebnisByMonth)
      .map((month) => normalizeMonthKey(month) as string)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((month) => ({
        month,
        openingInventoryEur: 0,
        closingInventoryEur: 0,
        bestandsveraenderungEur: 0,
        source: "projected" as const,
      }));
  }

  // --- Merge: REALE Snapshot-Deltas (Vergangenheit) VORRANG, dann Projektion.
  // Die Vorwärts-Projektion startet im Monat NACH dem jüngsten Snapshot
  // (computeInventoryChange beginnt bei Snapshot-Monat + 1). Die Snapshot-Reihe
  // deckt die Snapshot-Monate selbst ab. An der Naht (jüngster Snapshot-Monat)
  // gibt es daher keine Doppelzählung: die Projektion enthält diesen Monat nicht.
  // Sicherheitshalber filtern wir Projektions-Monate, die durch Snapshots bereits
  // abgedeckt sind, heraus (Snapshot hat Vorrang).
  const snapshotMonthSet = new Set(snapshotChangeRows.map((row) => row.month));
  const mergedRows: BwaNahtInventoryRow[] = [
    ...snapshotChangeRows,
    ...projectedRows.filter((row) => !snapshotMonthSet.has(row.month)),
  ].sort((a, b) => a.month.localeCompare(b.month));

  const inventoryRows = mergedRows;

  if (hasMultipleSnapshots) {
    notes.push(
      `Vergangenheits-Bestandsveränderung aus ${snapshotChangeRows.length} Lager-Snapshots abgeleitet.`,
    );
  }

  const sourceByMonth = new Map(inventoryRows.map((row) => [row.month, row.source]));
  const bridge = bridgeBwaErgebnis({
    bwaErgebnisByMonth,
    inventoryChangeRows: inventoryRows,
  }) as Array<{
    month: string;
    roheBwaErgebnisEur: number | null;
    bestandsveraenderungEur: number;
    bereinigtesErgebnisEur: number | null;
  }>;

  const bridgeRows: BwaNahtBridgeRow[] = bridge.map((row) => ({
    month: row.month,
    roheBwaErgebnisEur: row.roheBwaErgebnisEur,
    bestandsveraenderungEur: row.bestandsveraenderungEur,
    bereinigtesErgebnisEur: row.bereinigtesErgebnisEur,
    source: sourceByMonth.get(row.month) ?? null,
  }));

  return {
    forecastCalibration,
    bridgeRows,
    inventoryRows,
    hasInventoryInputs,
    notes,
  };
}
