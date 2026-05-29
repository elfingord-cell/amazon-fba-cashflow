# Plan-Produkt-Reifegrade im Cashflow-Planner — Design-Spec

**Datum:** 2026-05-29 · **Status:** freigegeben (Pierre, „setze 1-3 um")

## Problem / Kontext
Gemappte Plan-Produkte (echte SKU + archiviertes planProduct) erscheinen widersprüchlich: im Forecast-Grid als „Aktiv" mit 0, der Dashboard-Toggle „Planprodukte" greift nicht, und ihr Plan-Umsatz landet (PO-basiert) im Kernportfolio statt „geplante Produkte". Ursache: zwei Konzepte vermischt — **Reifegrad/Lebenszyklus** und **Forecast-Quelle** — plus PO-basierte Bucket-Hochstufung.

## Modell (zwei Achsen)
- **Reifegrad/Lebenszyklus (= Dashboard-Buckets):** Ideenprodukt(Geplant) → Planprodukt(Prelaunch) → Kernprodukt(Aktiv) → (Inaktiv).
- **Forecast-Quelle (abgeleitet):** Plan-Brücke / VO-Live / manuell.
- **Launch-Trigger (eine Wahrheit):** `forecastImport[sku].units>0` (VO liefert) ⇒ Plan→Kern, Prelaunch→Aktiv, Quelle Plan→VO-Live, Plan-Brücke phast pro Monat aus.

## Phase 1 — Reifegrad-Bucket-Logik + Status
- `src/domain/portfolioBuckets.js` `resolveEffectivePortfolioBucket`: optionaler `isLaunched`. PO→`CORE` nur wenn **nicht** `isLaunched === false` (rückwärtskompatibel; nur Plan-Pfad übergibt das Flag).
- `src/domain/planProducts.js` (~714): `isLaunched: hasLiveForecast` übergeben, wo `hasLiveForecast = Object.values(liveUnitsByMonth).some(u>0)`. → gemapptes, nicht gelauncht­es Produkt bleibt **Planprodukt** (Plan-Umsatz in „geplante Produkte"; Dashboard-Toggle steuert es).
- Daten: 3 Messerblöcke `status: active → prelaunch` (CLI dry-run → Pierre-OK → commit). Kein Funktionsverlust (`prelaunch` ist in isForecastProductActive/Projektion/Completeness enthalten).
- Tests: Parity — Plan-mapped+PO+keine Live → PLAN; mit Live → CORE; Nicht-Plan unverändert.

## Phase 2 — Forecast-Grid
- `src/domain/tableModels.ts` `buildForecastProducts`: **Dedupe** — wenn Live-SKU = Mapping-Ziel eines (auch archivierten) planProducts: Live-Zeile mit `isPlanMapped`, `planProductId`, `plannedUnitsByMonth` anreichern; separate Plan-Zeile für diese SKU entfällt. Reine Plan-Produkte ohne echte SKU unverändert.
- Grid (`src/v2/modules/forecast/index.tsx`): Lebenszyklus-Tag **„Prelaunch"** (abgeleitet: gemappt + kein Live-Forecast); **Quelle pro Monat** — Plan-Monat (kein Live) = ausgegraut + read-only + Marker „Plan"; Live-Monat = editierbar „VO". Edit-Sperre der Plan-Zellen + Affordance/Link „Mengen in ‚Neue Produkte' ändern". Nicht durch VO-Import/manuell überschreibbar.

## Phase 3 — In-Platform-Explainer
- Reifegrad-Tabelle (siehe Modell) als Info-Panel in **Methodik & Regeln**.
- Kompaktes **ⓘ-Tooltip** auf der Dashboard-Karte „Portfolio-Scope" (Kern/Plan/Ideen).

## Non-Goals
- Keine Änderung an reinen Ideen-/Plan-Produkten ohne echte SKU.
- Dashboard-Toggle-Mechanik unverändert (steuert nur Cashflow-Einrechnung).
- Keine VO-API-Abhängigkeit im Planner (Launch = forecastImport>0, self-contained).

## Verifikation
Volle Parity-Suite grün; Live-State-Check (Plan-Umsatz jetzt in „geplante Produkte"; Toggle wirkt); Deploy via Push→Vercel.
