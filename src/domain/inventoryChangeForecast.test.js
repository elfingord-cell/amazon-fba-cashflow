import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInventoryChange,
  bridgeBwaErgebnis,
} from "./inventoryChangeForecast.js";

// Hilfs-Rundung für EUR-Vergleiche (Float-Toleranz).
function round2(value) {
  return Math.round(value * 100) / 100;
}

// 1) LAGERABBAU: nur Absatz, keine Zugänge.
//    Bestandsveränderung muss jeden Monat NEGATIV sein, und die Summe der
//    Bestandsveränderungen muss exakt = -(Snapshot-Wert der abverkauften Ware) sein.
test("Lagerabbau: jede Bestandsveränderung negativ, Summe = -abverkaufter Snapshot-Wert", () => {
  const landedCostBySku = { A: 10, B: 4 };
  const snapshotUnitsBySku = { A: 100, B: 50 }; // opening = 100*10 + 50*4 = 1200
  const res = computeInventoryChange({
    snapshotUnitsBySku,
    snapshotDateISO: "2026-01-31",
    monthsAhead: 3,
    salesForecastBySkuMonth: {
      A: { "2026-02": 20, "2026-03": 20, "2026-04": 20 },
      B: { "2026-02": 10, "2026-03": 10, "2026-04": 10 },
    },
    arrivalsBySkuMonth: {},
    landedCostBySku,
  });

  assert.equal(res.openingInventoryEur, 1200);
  assert.equal(res.rows.length, 3);

  // Jede Bestandsveränderung negativ (reiner Abbau).
  res.rows.forEach((row) => {
    assert.ok(
      row.bestandsveraenderungEur < 0,
      `erwarte negative Bestandsveränderung in ${row.month}, war ${row.bestandsveraenderungEur}`,
    );
  });

  // Summe der Bestandsveränderungen = Wert der abverkauften Ware (negativ).
  // Abverkauft: A 60 St. * 10 + B 30 St. * 4 = 600 + 120 = 720 -> -720.
  const sumDelta = res.rows.reduce((acc, r) => acc + r.bestandsveraenderungEur, 0);
  assert.equal(round2(sumDelta), -720);
});

// 2) LAGERAUFBAU: großer Zugang, wenig Absatz.
//    Bestandsveränderung im Zugangsmonat POSITIV.
test("Lageraufbau: positive Bestandsveränderung im Zugangsmonat", () => {
  const landedCostBySku = { A: 10 };
  const res = computeInventoryChange({
    snapshotUnitsBySku: { A: 10 }, // opening = 100
    snapshotDateISO: "2026-01-31",
    monthsAhead: 2,
    salesForecastBySkuMonth: { A: { "2026-02": 5, "2026-03": 5 } },
    arrivalsBySkuMonth: { A: { "2026-02": 500 } }, // großer Zugang in 02
    landedCostBySku,
  });

  const feb = res.rows.find((r) => r.month === "2026-02");
  assert.ok(feb, "Februar-Zeile muss existieren");
  // opening Feb = 100; closing Feb = (10 + 500 - 5) * 10 = 5050; Delta = +4950.
  assert.ok(feb.bestandsveraenderungEur > 0, "Zugangsmonat muss positiv sein");
  assert.equal(round2(feb.bestandsveraenderungEur), 4950);
});

// 3) BRÜCKE: rohe BWA eines Bestandsaufbau-Monats + positive Bestandsveränderung
//    -> bereinigtes Ergebnis > rohe BWA. Konkret nachrechenbar.
test("bridgeBwaErgebnis: Bestandsaufbau hebt das rohe BWA-Ergebnis an", () => {
  const landedCostBySku = { X: 100 };
  // Snapshot 0 Stück (opening = 0). Zugang 200 Stück in 02, Absatz 55.
  // closing 02 = (0 + 200 - 55) * 100 = 14500. Delta = +14500.
  const inv = computeInventoryChange({
    snapshotUnitsBySku: { X: 0 },
    snapshotDateISO: "2026-01-31",
    monthsAhead: 1,
    salesForecastBySkuMonth: { X: { "2026-02": 55 } },
    arrivalsBySkuMonth: { X: { "2026-02": 200 } },
    landedCostBySku,
  });

  const feb = inv.rows.find((r) => r.month === "2026-02");
  assert.equal(round2(feb.bestandsveraenderungEur), 14500);

  // Rohe BWA im Aufbau-Monat künstlich gedrückt: -14505.
  const bridged = bridgeBwaErgebnis({
    bwaErgebnisByMonth: { "2026-02": -14505 },
    inventoryChangeRows: inv.rows,
  });

  const row = bridged.find((r) => r.month === "2026-02");
  assert.equal(row.roheBwaErgebnisEur, -14505);
  assert.equal(round2(row.bestandsveraenderungEur), 14500);
  // bereinigt = -14505 + 14500 = -5.
  assert.equal(round2(row.bereinigtesErgebnisEur), -5);
  // Und vor allem: bereinigt > roh.
  assert.ok(row.bereinigtesErgebnisEur > row.roheBwaErgebnisEur);
});

test("bridgeBwaErgebnis: Monat ohne BWA-Wert -> roh und bereinigt null", () => {
  const inv = computeInventoryChange({
    snapshotUnitsBySku: { X: 10 },
    snapshotDateISO: "2026-01-31",
    monthsAhead: 2,
    salesForecastBySkuMonth: { X: { "2026-02": 2, "2026-03": 2 } },
    arrivalsBySkuMonth: {},
    landedCostBySku: { X: 100 },
  });
  const bridged = bridgeBwaErgebnis({
    bwaErgebnisByMonth: { "2026-02": -1000 }, // 03 fehlt absichtlich
    inventoryChangeRows: inv.rows,
  });
  const mar = bridged.find((r) => r.month === "2026-03");
  assert.equal(mar.roheBwaErgebnisEur, null);
  assert.equal(mar.bereinigtesErgebnisEur, null);
});

// 4) DATEV-KALIBRIERUNG (Re-Anchoring).
//    Für einen Monat mit DATEV-Ist ist closing exakt = DATEV-Wert (source "datev").
//    Der Folgemonat baut auf dem Anker auf (source "calibrated").
test("DATEV-Kalibrierung: closing == Ist-Wert, Folgemonat re-basiert", () => {
  const landedCostBySku = { A: 10 };
  const res = computeInventoryChange({
    snapshotUnitsBySku: { A: 100 }, // opening = 1000
    snapshotDateISO: "2026-01-31",
    monthsAhead: 3,
    salesForecastBySkuMonth: {
      A: { "2026-02": 10, "2026-03": 10, "2026-04": 10 },
    },
    arrivalsBySkuMonth: {},
    landedCostBySku,
    datevClosingInventoryByMonth: { "2026-02": 2222 }, // Ist weicht von Projektion ab
  });

  const feb = res.rows.find((r) => r.month === "2026-02");
  const mar = res.rows.find((r) => r.month === "2026-03");
  const apr = res.rows.find((r) => r.month === "2026-04");

  // DATEV-Monat: closing exakt = Ist, source "datev".
  assert.equal(feb.closingInventoryEur, 2222);
  assert.equal(feb.source, "datev");

  // Folgemonat: re-basiert (source "calibrated") und opening = DATEV-closing.
  assert.equal(mar.source, "calibrated");
  assert.equal(mar.openingInventoryEur, 2222);

  // Projizierte Bestandsveränderung 03 = -10 St * 10 = -100, auf Anker:
  // closing 03 = 2222 - 100 = 2122.
  assert.equal(round2(mar.closingInventoryEur), 2122);
  assert.equal(round2(mar.bestandsveraenderungEur), -100);

  // April bleibt ebenfalls calibrated (Anker wirkt fort).
  assert.equal(apr.source, "calibrated");
  assert.equal(round2(apr.closingInventoryEur), 2022);
});

test("DATEV-Kalibrierung: Monate vor dem ersten Anker bleiben 'projected'", () => {
  const res = computeInventoryChange({
    snapshotUnitsBySku: { A: 100 },
    snapshotDateISO: "2026-01-31",
    monthsAhead: 3,
    salesForecastBySkuMonth: {
      A: { "2026-02": 10, "2026-03": 10, "2026-04": 10 },
    },
    arrivalsBySkuMonth: {},
    landedCostBySku: { A: 10 },
    datevClosingInventoryByMonth: { "2026-03": 5000 }, // Anker erst in 03
  });
  const feb = res.rows.find((r) => r.month === "2026-02");
  const mar = res.rows.find((r) => r.month === "2026-03");
  const apr = res.rows.find((r) => r.month === "2026-04");
  assert.equal(feb.source, "projected");
  assert.equal(mar.source, "datev");
  assert.equal(mar.closingInventoryEur, 5000);
  assert.equal(apr.source, "calibrated");
  assert.equal(apr.openingInventoryEur, 5000);
});

// 5) VORZEICHEN-IDENTITÄT: über einen geschlossenen Zeitraum gilt
//    Σ Bestandsveränderung = closing(letzter) - opening(erster).
test("Identität: Σ Bestandsveränderung = closing(letzter) - opening(erster)", () => {
  const res = computeInventoryChange({
    snapshotUnitsBySku: { A: 80, B: 30 },
    snapshotDateISO: "2026-01-31",
    monthsAhead: 4,
    salesForecastBySkuMonth: {
      A: { "2026-02": 15, "2026-03": 25, "2026-04": 10, "2026-05": 5 },
      B: { "2026-02": 5, "2026-03": 8, "2026-04": 3, "2026-05": 2 },
    },
    arrivalsBySkuMonth: {
      A: { "2026-03": 100 },
      B: { "2026-04": 40 },
    },
    landedCostBySku: { A: 12, B: 7 },
  });

  const sumDelta = res.rows.reduce((acc, r) => acc + r.bestandsveraenderungEur, 0);
  const firstOpening = res.rows[0].openingInventoryEur;
  const lastClosing = res.rows[res.rows.length - 1].closingInventoryEur;

  assert.equal(round2(sumDelta), round2(lastClosing - firstOpening));
  // Erster Opening muss exakt dem Eröffnungs-Lagerwert entsprechen.
  assert.equal(firstOpening, res.openingInventoryEur);
});

// Zusatz: Eröffnungswert-Bildung defensiv (Strings / de-Dezimal).
test("Eröffnungswert: defensive Zahl-Konvertierung", () => {
  const res = computeInventoryChange({
    snapshotUnitsBySku: { A: "100", B: 50 },
    snapshotDateISO: "2026-01-31",
    monthsAhead: 1,
    salesForecastBySkuMonth: {},
    arrivalsBySkuMonth: {},
    landedCostBySku: { A: "10,5", B: 4 }, // de-Dezimal "10,5"
  });
  // 100 * 10.5 + 50 * 4 = 1050 + 200 = 1250.
  assert.equal(round2(res.openingInventoryEur), 1250);
});
