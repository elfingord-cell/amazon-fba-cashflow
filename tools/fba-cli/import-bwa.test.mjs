// node --test tools/fba-cli/import-bwa.test.mjs
// Testet computeVoForecastBrutto + computeCalibration (Blend + Fallback) mit Mini-State.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVoForecastBrutto, computeCalibration } from "./import-bwa.mjs";

// --- Synthetischer Mini-State: 2 SKUs, Preise, Forecast (manual+import) -----
function makeState() {
  return {
    products: [
      { sku: "A", avgSellingPriceGrossEUR: 10 },
      { sku: " B ", avgSellingPriceGrossEUR: 20 }, // mit Whitespace -> muss getrimmt matchen
      { sku: "NOPRICE" }, // ohne Preis -> 0 Beitrag
    ],
    forecast: {
      forecastManual: {
        // A: manual hat Vorrang über import in 2026-04
        A: { "2026-04": 5 },
      },
      forecastImport: {
        A: {
          "2026-04": { units: 999 }, // wird von manual überschrieben
          "2026-05": { units: 3 },
        },
        B: {
          "2026-04": { units: 2 },
        },
        NOPRICE: {
          "2026-04": { units: 100 }, // 0 Beitrag (kein Preis)
        },
      },
    },
  };
}

// Minimal-CSV-rows: 1 Ist-Monat (2026-01) + Basisjahr-Monate (2025) für niveauFaktor/saisonAnteil.
function makeRows() {
  const rows = [];
  // Basisjahr 2025: alle 12 Monate je 1000, JAHR 12000.
  for (let m = 1; m <= 12; m += 1) {
    rows.push({ periode: `2025-${String(m).padStart(2, "0")}`, umsatz: 1000, ergebnisVorSteuern: 100, quelle: "" });
  }
  rows.push({ periode: "2025-JAHR", umsatz: 12000, ergebnisVorSteuern: 1500, quelle: "vorl.Ergebnis 1200" });
  // Forecast-Jahr 2026: nur Januar als Ist (netto 50000), Q1-kum als Stichtag-Träger.
  rows.push({ periode: "2026-01", umsatz: 50000, ergebnisVorSteuern: 5000, quelle: "DATEV netto" });
  rows.push({ periode: "2026-Q1-kum", umsatz: 50000, ergebnisVorSteuern: 5000, quelle: "kum" });
  return rows;
}

test("computeVoForecastBrutto: Σ units×Bruttopreis, manual>import, SKU ohne Preis=0", () => {
  const vo = computeVoForecastBrutto(makeState(), 2026);
  // 2026-04: A manual 5×10=50, B 2×20=40, NOPRICE 0 -> 90
  assert.equal(vo["2026-04"], 90);
  // 2026-05: A import 3×10=30
  assert.equal(vo["2026-05"], 30);
  // alle 12 Monate vorhanden
  assert.equal(Object.keys(vo).length, 12);
  assert.equal(vo["2026-12"], 0);
});

test("computeVoForecastBrutto: VOs revenueEur hat Vorrang vor units×Preis", () => {
  const state = {
    products: [{ sku: "A", avgSellingPriceGrossEUR: 10 }],
    forecast: {
      forecastManual: {},
      forecastImport: {
        A: {
          // revenueEur (55) gewinnt gegen units×Preis (3×10=30)
          "2026-05": { units: 3, revenueEur: 55 },
          // ohne revenueEur -> Fallback units×Preis (4×10=40)
          "2026-06": { units: 4 },
        },
      },
    },
  };
  const vo = computeVoForecastBrutto(state, 2026);
  assert.equal(vo["2026-05"], 55, "revenueEur muss Vorrang haben");
  assert.equal(vo["2026-06"], 40, "ohne revenueEur Fallback units×Preis");
});

test("computeVoForecastBrutto: manual übersteuert auch revenueEur", () => {
  const state = {
    products: [{ sku: "A", avgSellingPriceGrossEUR: 10 }],
    forecast: {
      forecastManual: { A: { "2026-05": 7 } }, // manual 7×10=70
      forecastImport: { A: { "2026-05": { units: 3, revenueEur: 55 } } },
    },
  };
  const vo = computeVoForecastBrutto(state, 2026);
  assert.equal(vo["2026-05"], 70, "manual (units×Preis) übersteuert revenueEur");
});

test("computeCalibration Blend: Ist + VO/Faktor, brutto=netto×Faktor", () => {
  const cal = computeCalibration(makeRows(), 2025, 2026, "test.csv", { state: makeState() });
  assert.equal(cal.prognoseMethode, "blend_ist_vo");
  assert.equal(cal.bruttoNettoFaktor, 1.367);

  // Erwartung netto = Ist(50000, Jan) + VO-netto: (90/1.367) + (30/1.367)
  const voNetto = 90 / 1.367 + 30 / 1.367;
  const erwartetNetto = 50000 + voNetto;
  assert.ok(Math.abs(cal.jahrUmsatzPrognose - erwartetNetto) < 1e-6, `netto ${cal.jahrUmsatzPrognose} != ${erwartetNetto}`);

  // brutto = netto × Faktor
  assert.ok(Math.abs(cal.jahrUmsatzPrognoseBrutto - erwartetNetto * 1.367) < 1e-6);

  // Monats-Quellen: Jan = ist, Apr/Mai = vo, übrige (kein Ist, VO=0) -> netto 0 quelle vo
  assert.equal(cal.monatsForecast["2026-01"].quelle, "ist");
  assert.equal(cal.monatsForecast["2026-01"].netto, 50000);
  assert.equal(cal.monatsForecast["2026-04"].quelle, "vo");
  assert.ok(Math.abs(cal.monatsForecast["2026-04"].netto - 90 / 1.367) < 1e-6);
  assert.equal(cal.monatsForecast["2026-04"].brutto, (90 / 1.367) * 1.367);

  // Gewinn über strukturelle Basisjahr-Marge (1500/12000 = 0.125) auf netto.
  assert.ok(Math.abs(cal.jahrErgebnisVorSteuernPrognose - erwartetNetto * (1500 / 12000)) < 1e-6);
});

test("computeCalibration Fallback ohne state: Saison-Faktor", () => {
  const cal = computeCalibration(makeRows(), 2025, 2026, "test.csv");
  assert.equal(cal.prognoseMethode, "saison_faktor");
  assert.equal(cal.monatsForecast, null);
  // Saison-Faktor: istUmsatzAbgeschlossen(50000, Q1=Jan-Mrz; aber nur Jan vorhanden im Ist)
  // saisonAnteil = basisUmsatzGleicherZeitraum(3×1000=3000)/12000 = 0.25
  // jahrUmsatzPrognose = 50000/0.25 = 200000
  assert.ok(Math.abs(cal.jahrUmsatzPrognose - 200000) < 1e-6, `fallback ${cal.jahrUmsatzPrognose}`);
  assert.ok(cal.jahrUmsatzPrognoseBrutto != null);
});
