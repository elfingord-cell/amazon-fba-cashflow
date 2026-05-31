// inventoryChangeForecast.js
//
// Zweck: monatliche Warenbestandsveränderung (Lagerwert-Delta in EUR)
// projizieren und damit eine periodengerechte Brücke für die DATEV-BWA bauen.
//
// Hintergrund (Buchhaltung):
//   Die reale DATEV-BWA bucht im GESAMTKOSTENVERFAHREN: der gesamte Wareneinkauf
//   eines Monats landet sofort als Aufwand, unabhängig davon, ob die Ware schon
//   verkauft wurde. Das verzerrt das Monatsergebnis — Lageraufbau drückt das
//   Ergebnis künstlich nach unten, Lagerabbau hebt es künstlich an.
//
//   Die periodengerechte Korrektur ist die Bestandsveränderung:
//     bereinigtesErgebnis = roheBwaErgebnis + bestandsveraenderungEur
//
//   VORZEICHEN-KONVENTION (kritisch — ein Vorzeichenfehler wäre ein echter
//   Buchhaltungsfehler):
//     bestandsveraenderung(Monat) = closing(Monat) - closing(Monat-1)
//     - Lageraufbau  (closing > opening) -> POSITIV  -> hebt das Ergebnis
//       (gekaufte, noch nicht verkaufte Ware wird aktiviert statt als Aufwand
//        gezählt).
//     - Lagerabbau   (closing < opening) -> NEGATIV  -> senkt das Ergebnis.
//
//   WICHTIG: Dieses Modul greift NICHT in die CFP-Plan-GuV ein. Die Plan-GuV
//   rechnet bereits im UMSATZKOSTENVERFAHREN (COGS = Wareneinsatz) und ist damit
//   periodengerecht; eine Bestandsveränderung dort wäre Doppelzählung. Dieses
//   Modul korrigiert ausschließlich die reale BWA-Seite.

import { computeInventoryProjection } from "./inventoryProjection.js";

// Defensive Zahl-Konvertierung (analog zur projektweiten toNum-Konvention,
// inkl. de-Dezimal "10,5").
function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function normalizeMonthKey(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  return raw;
}

// Eröffnungs-Monatsschlüssel aus einem ISO-Datum (snapshotDateISO -> "YYYY-MM").
function monthKeyFromISO(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonthsToMonthKey(monthKey, offset) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + Number(offset || 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Lagerwert (EUR) aus Einheiten je SKU x Landed-Cost je SKU.
function valuateUnits(unitsBySku, landedCostBySku) {
  let total = 0;
  const units = unitsBySku && typeof unitsBySku === "object" ? unitsBySku : {};
  Object.keys(units).forEach((skuRaw) => {
    const sku = normalizeSku(skuRaw);
    if (!sku) return;
    const qty = toNum(units[skuRaw]);
    const unitCost = toNum(landedCostBySku?.[sku] ?? landedCostBySku?.[skuRaw]);
    total += qty * unitCost;
  });
  return total;
}

// Bridge-Adapter: liefert je Monat den projizierten End-Lagerwert (EUR).
// Wir akzeptieren beide möglichen Rückgabeformen von computeInventoryProjection:
//   (a) { valuation: [{ month, endEur }] }  (dokumentierte V1-Valuation-Form)
//   (b) { months, perSkuMonth, ... }        (aktuelle Repo-Form, Einheiten je SKU)
// In Form (b) bewerten wir die Monats-End-Einheiten selbst mit landedCostBySku.
function projectedClosingByMonth({ projection, months, landedCostBySku }) {
  const closingByMonth = {};
  if (projection && Array.isArray(projection.valuation)) {
    projection.valuation.forEach((entry) => {
      const month = normalizeMonthKey(entry?.month);
      if (!month) return;
      closingByMonth[month] = toNum(entry.endEur);
    });
    return closingByMonth;
  }
  if (projection && projection.perSkuMonth instanceof Map && projection.perSkuMonth.size) {
    months.forEach((month) => {
      // Nur Monate übernehmen, die die Projektion auch tatsächlich abdeckt
      // (mindestens eine SKU hat eine Zeile für diesen Monat). Sonst bliebe ein
      // künstlicher 0-Wert stehen und der Self-Contained-Fallback würde nie
      // greifen, obwohl die externe Projektion den Monat gar nicht kennt.
      let total = 0;
      let covered = false;
      projection.perSkuMonth.forEach((monthMap, skuRaw) => {
        const row = monthMap.get(month);
        if (!row) return;
        covered = true;
        const endUnits = toNum(row?.endAvailable);
        const unitCost = toNum(landedCostBySku?.[skuRaw] ?? landedCostBySku?.[normalizeSku(skuRaw)]);
        total += endUnits * unitCost;
      });
      if (covered) closingByMonth[month] = total;
    });
  }
  return closingByMonth;
}

// Erzeugt die Monatsliste ab dem ersten Forecast-Monat (= Snapshot-Monat + 1)
// über monthsAhead Monate.
function buildMonthList(snapshotMonth, monthsAhead) {
  const months = [];
  const count = Math.max(0, Math.floor(toNum(monthsAhead)));
  for (let i = 1; i <= count; i += 1) {
    const m = addMonthsToMonthKey(snapshotMonth, i);
    if (m) months.push(m);
  }
  return months;
}

/**
 * computeInventoryChange
 *
 * @param {Object}   p
 * @param {Object}   p.snapshotUnitsBySku   { sku: units } am snapshotDateISO
 * @param {string}   p.snapshotDateISO      ISO-Datum des Snapshots
 * @param {number}   p.monthsAhead          Projektionshorizont (Monate)
 * @param {Object}   p.salesForecastBySkuMonth   { sku: { "YYYY-MM": units } }
 * @param {Object}   p.arrivalsBySkuMonth        { sku: { "YYYY-MM": units } }
 * @param {Object}   p.landedCostBySku           { sku: EUR/Stück }
 * @param {Object}   [p.settings]                durchgereicht an die Projektion
 * @param {Object}   [p.datevClosingInventoryByMonth]  { "YYYY-MM": EUR } Ist-Lagerwerte (DATEV-SuSa Konto 3980)
 *
 * @returns {{ openingInventoryEur:number,
 *             rows: Array<{ month:string,
 *                           openingInventoryEur:number,
 *                           closingInventoryEur:number,
 *                           bestandsveraenderungEur:number,
 *                           source: "datev"|"projected"|"calibrated" }> }}
 *
 * Kalibrierung (Re-Anchoring): Liegt für einen Monat ein DATEV-Ist-Lagerwert vor,
 * wird der closing dieses Monats hart auf den Ist-Wert gesetzt (source "datev").
 * Ab dem LETZTEN Monat mit DATEV-Ist erbt die reine Projektion diesen Anker:
 * statt vom Snapshot zu laufen, wird die projizierte Bestandsveränderung
 * (closing_proj(m) - closing_proj(m-1)) auf den re-basierten closing addiert.
 * Diese Folge-Monate werden mit source "calibrated" markiert; Monate ohne jeden
 * DATEV-Anker davor bleiben "projected".
 */
export function computeInventoryChange({
  snapshotUnitsBySku,
  snapshotDateISO,
  monthsAhead,
  salesForecastBySkuMonth,
  arrivalsBySkuMonth,
  landedCostBySku,
  settings,
  datevClosingInventoryByMonth,
} = {}) {
  const snapshotMonth = monthKeyFromISO(snapshotDateISO);
  const months = buildMonthList(snapshotMonth, monthsAhead);

  // Eröffnungs-Lagerwert = Snapshot-Einheiten x Landed-Cost.
  const openingInventoryEur = valuateUnits(snapshotUnitsBySku, landedCostBySku);

  // Reine Projektion (Einheiten) -> End-Lagerwert je Monat.
  let projection = null;
  try {
    projection = computeInventoryProjection({
      snapshotUnitsBySku,
      snapshotDateISO,
      monthsAhead,
      salesForecastBySkuMonth,
      arrivalsBySkuMonth,
      landedCostBySku,
      settings,
    });
  } catch {
    projection = null;
  }

  let projClosing = projectedClosingByMonth({ projection, months, landedCostBySku });

  // Fallback: liefert die Projektion nichts Verwertbares, projizieren wir selbst
  // aus Einheiten-Mechanik (opening + arrivals - sales), bewertet mit Landed-Cost.
  // (Die aktuelle Repo-Signatur von computeInventoryProjection unterscheidet sich
  //  von der hier durchgereichten; dieser Fallback hält das Modul robust.)
  const hasProjectionValues = months.some((m) => Number.isFinite(projClosing[m]));
  if (!hasProjectionValues) {
    projClosing = {};
    const runningUnits = {};
    Object.keys(snapshotUnitsBySku || {}).forEach((skuRaw) => {
      runningUnits[normalizeSku(skuRaw)] = toNum(snapshotUnitsBySku[skuRaw]);
    });
    const allSkus = new Set(Object.keys(runningUnits));
    Object.keys(arrivalsBySkuMonth || {}).forEach((s) => allSkus.add(normalizeSku(s)));
    Object.keys(salesForecastBySkuMonth || {}).forEach((s) => allSkus.add(normalizeSku(s)));
    months.forEach((month) => {
      allSkus.forEach((sku) => {
        const arrived = toNum(arrivalsBySkuMonth?.[sku]?.[month]);
        const sold = toNum(salesForecastBySkuMonth?.[sku]?.[month]);
        const prev = toNum(runningUnits[sku]);
        runningUnits[sku] = prev + arrived - sold;
      });
      projClosing[month] = valuateUnits(runningUnits, landedCostBySku);
    });
  }

  const datev = datevClosingInventoryByMonth && typeof datevClosingInventoryByMonth === "object"
    ? datevClosingInventoryByMonth
    : {};

  // Re-Anchoring: bestimme je Monat den effektiven closing.
  // anchorOffsetEur verschiebt die reine Projektion so, dass sie ab dem letzten
  // DATEV-Anker auf dem Ist-Wert aufsetzt.
  const rows = [];
  let prevClosing = openingInventoryEur; // closing(Monat-1); für M1 = Eröffnungswert
  let sawDatevAnchor = false;            // gab es bereits einen DATEV-Anker?
  let anchorOffsetEur = 0;               // Ist-minus-Projektion am letzten Anker

  months.forEach((month) => {
    const hasDatev = Object.prototype.hasOwnProperty.call(datev, month)
      && datev[month] != null
      && String(datev[month]).trim() !== "";

    const rawProj = Number.isFinite(projClosing[month]) ? projClosing[month] : prevClosing;

    let closing;
    let source;
    if (hasDatev) {
      // Harter Ist-Anker: closing == DATEV-Wert. Offset für Folgemonate merken.
      closing = toNum(datev[month]);
      anchorOffsetEur = closing - rawProj;
      sawDatevAnchor = true;
      source = "datev";
    } else if (sawDatevAnchor) {
      // Projiziert, aber ab DATEV-Anker re-basiert.
      closing = rawProj + anchorOffsetEur;
      source = "calibrated";
    } else {
      // Reine Projektion, kein Anker davor.
      closing = rawProj;
      source = "projected";
    }

    const openingThisMonth = prevClosing;
    const bestandsveraenderungEur = closing - openingThisMonth;

    rows.push({
      month,
      openingInventoryEur: openingThisMonth,
      closingInventoryEur: closing,
      bestandsveraenderungEur,
      source,
    });

    prevClosing = closing;
  });

  return { openingInventoryEur, rows };
}

/**
 * bridgeBwaErgebnis
 *
 * Periodengerechte Brücke: addiert die monatliche Bestandsveränderung auf das
 * rohe (im Gesamtkostenverfahren gebuchte) BWA-Ergebnis-vor-Steuern.
 *
 *   bereinigtesErgebnisEur = roheBwaErgebnisEur + bestandsveraenderungEur
 *
 * @param {Object}   p
 * @param {Object}   p.bwaErgebnisByMonth   { "YYYY-MM": EUR } rohes BWA-Ergebnis vor Steuern
 * @param {Array}    p.inventoryChangeRows  rows aus computeInventoryChange
 *
 * @returns {Array<{ month:string,
 *                    roheBwaErgebnisEur:number|null,
 *                    bestandsveraenderungEur:number,
 *                    bereinigtesErgebnisEur:number|null }>}
 *
 * Monate ohne BWA-Wert werden mit roheBwaErgebnisEur=null und
 * bereinigtesErgebnisEur=null markiert (keine erfundene Korrektur).
 */
export function bridgeBwaErgebnis({ bwaErgebnisByMonth, inventoryChangeRows } = {}) {
  const bwa = bwaErgebnisByMonth && typeof bwaErgebnisByMonth === "object"
    ? bwaErgebnisByMonth
    : {};
  const rows = Array.isArray(inventoryChangeRows) ? inventoryChangeRows : [];

  return rows.map((row) => {
    const month = row?.month;
    const bestandsveraenderungEur = toNum(row?.bestandsveraenderungEur);
    const hasBwa = Object.prototype.hasOwnProperty.call(bwa, month)
      && bwa[month] != null
      && String(bwa[month]).trim() !== "";
    const roheBwaErgebnisEur = hasBwa ? toNum(bwa[month]) : null;
    const bereinigtesErgebnisEur = roheBwaErgebnisEur == null
      ? null
      : roheBwaErgebnisEur + bestandsveraenderungEur;
    return {
      month,
      roheBwaErgebnisEur,
      bestandsveraenderungEur,
      bereinigtesErgebnisEur,
    };
  });
}
