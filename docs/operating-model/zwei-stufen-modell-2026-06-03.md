# 2-Stufen-Bestellmodell + Robustheit Jun–Dez 2026 (Stand 2026-06-03)

## Modell-Entscheidung (GF Pierre)
Phantom-FO als eigener, halb-zählender Zustand wird abgeschafft. Es gibt nur noch zwei Stufen:

| Stufe | Bedeutung | Quelle | Treibt Cashflow | Zählt für Robustheit |
|---|---|---|---|---|
| **PO** | platzierte Bestellung, Geld committed | VentoryOne (sync) | ✓ | ✓ |
| **FO** | jede geplante Nachbestellung darüber hinaus (revidierbar) | Claude (plausibilisiert) | ✓ | ✓ |

Die Phantom-Engine (`buildPhantomFoSuggestions`) bleibt als **Reorder-Radar** (KPI „Offene
Reorder-Vorschläge"), treibt aber weder Cashflow noch Robustheit. Behebt das Split-Brain
(Phantom trieb Cashflow, zählte aber nicht für Robustheit → Linie gestrichelt trotz Order-Kosten
im Cashflow).

**Code-Refactor** (commit `20e3d1bd`, main): `showPhantomFoInChart`-Toggle + „PFO Simulation"-Serie
+ Setting entfernt; `dashboardSeriesState` ohne Phantom-Injektion. Build + tsc + volle v2-Parity-Suite grün.

## Robustheits-Mechanik (verstanden)
Ein Monat ist robust nur wenn alle 5 `sku_coverage`-Checks bestehen (Bestand/Bestellpflicht, Cash-In,
Fixkosten, VAT, Revenue). Der **90-Tage-Lookahead** bedeutet: „Dez robust" verlangt gesicherte Coverage
bis ~Ende März 2027. Darum muss die Reorder-Pipeline bis Q1 2027 als FO geplant sein.

## Reorder-Pipeline (commit-Daten, rev ~02a17975)
- Prelaunch-Accepts (unvermeidbare 0-Bestand-Lücke vor Launch, stock_oos): 035.001 Jun; 034.001/021.002/021.003 Jun–Jul.
- 3 Reorder-FOs (021.002, 021.003, I5) + 15 Reorder-FOs (Engine-Coverage, DOH90, Risk ≤ 2027-03).
- Datenfix: PO260005 Saddlebag 1056→1008 (VO-Ist); Food-Pouch-Zeile in PO260006 (500 Stk) ergänzt.

**Ergebnis:** Jun–Dez 2026 = **7/7 robust**, Kontostand-Linie solide bis Dez, ab Jan 2027 ehrlich
gestrichelt (spätere Zyklen bleiben Radar: ~32 offene Vorschläge).

## Policy
Aktiv als FO geplant wird der nächste Reorder-Zyklus bis zum Lookahead-Horizont des Ziels
(für „robust bis Dez" = bis ~Q1 2027). Spätere Zyklen bleiben Reorder-Vorschlag (Radar) und werden
geplant, wenn sie in den Horizont rücken.

---

## Nachtrag: Rollierende 12 Monate robust (2026-06-03)

Ziel war nicht nur „bis Dez", sondern die **rollierenden 12 Monate** (Jun 2026 → Mai 2027) robust.
Ursache, warum 2027 nicht robust war: **nicht** Lead-Time/Lookahead, sondern der Cash-In-Check
(`monthHasCashIn`) las nur `incomings`-Zeilen, die auf das fixe 12-Monats-Fenster (Jan–Dez 2026)
begrenzt waren. Der Cashflow-Mirror leitet 2027-Umsatz längst aus dem Forecast ab (forecastImport
bis 2027-11) — der Check erkannte ihn nur nicht.

**3-Teile-Fix (umgesetzt):**
1. `monthHasCashIn` forecast-bewusst (commit `a539b103`, mit Test): Cash-In-Basis gilt als vorhanden,
   wenn incomings ODER Actuals ODER **Forecast-Umsatz** existiert → an die Cashflow-Berechnung angeglichen.
2. `settings.horizonMonths` 12 → 21 (bis ~Sep 2027): Cashflow/Mirror rechnen 2027 forecast-basiert;
   Bestellpflicht sieht weit genug.
3. Rolling-12 Reorder-Pipeline (+15 FOs, Risk ≤ 2027-06; rev `d4bafc57`).

**Ergebnis (Engine + Live verifiziert):** alle 12 Zukunftsmonate (Jun 2026 → Mai 2027) robust;
Kontostand-Linie durchgehend solide im 12er-Fenster. Keine erfundenen Zahlen — 2027-Umsatz kommt
aus dem vorhandenen Forecast.

### Lead-Time/Lookahead-Befund (Pierre-Frage)
Der Bestand-Lookahead ist flach (DDP 35 / non-DDP 90 T), NICHT lead-time-basiert. Das erzeugt aber
**kein** falsches „robust": die **Bestellpflicht** ist voll lead-time-bewusst (latestOrderDate =
Engpass − Produktion+Logistik, ganzer-Horizont-Scan) und fängt Langläufer (Messerblöcke 105 T) korrekt
ab. Optionale Verbesserung (offen): Lookahead pro Produkt auf die Lead-Time setzen — kosmetisch
konsistenter, ändert die Korrektheit kaum.

### Offen / Nebenbefund
- 2026-`incomings` weichen stark vom aktuellen Forecast ab (Jun 89.270 € vs 133.777 €) → Basis
  vermutlich manuell/veraltet; separat prüfen.
- Lead-time-basierter Lookahead (statt flach 90/35) als optionale Politur.
