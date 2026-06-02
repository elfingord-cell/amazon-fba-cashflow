# Design: Produkt-Lebenszyklus „Auslaufend" (Sell-Through ohne Nachschub)

- **Datum**: 2026-06-02
- **Status**: Genehmigt (Pierre, 2026-06-02)
- **Kontext**: GF-Entscheidung 2026-06-01 — Tamper Stahl/Leder, Messerleiste und Solar werden nicht
  mehr nachbestellt. Sie sollen **ausverkauft** werden: Forecast-Umsatz läuft weiter, solange Bestand
  da ist; bei Bestand 0 fallen sie aus Forecast/Cashflow; **kein** PO/FO/PFO mehr.

## Problem

Heute kennt die Engine nur zwei Zustände, die den Forecast-Umsatz steuern:

- `includeInForecast = true` → voller `forecastImport[sku].revenueEur` fließt monatsweise in den
  Cashflow (`src/domain/cashflow.js` ~Z. 1370–1385). **Keine Bestandsdeckelung.**
- `includeInForecast = false` → Umsatz sofort komplett weg.

Beides trifft „ausverkaufen bis Bestand 0" nicht: `true` bucht Phantom-Umsatz über den real
verfügbaren Bestand hinaus (Stahl forecastet 343 Stk bei real 2 Verkäufen/Jahr und 300 Stk Bestand),
`false` schneidet den legitimen Resterlös sofort ab.

Zusätzlich: Ein `forecastImport`-Eintrag **ohne** zugehöriges Produkt (`019.002-SOLAR-MOUNTING-SET-02`)
fließt heute über den `profileForSku`-Default (`{includeInForecast:true, CORE}`, cashflow.js Z. 1240)
als **CORE-Phantomumsatz von 33.430 €** in den Plan. Solar ist der einzige solche Orphan (1 von 40 Keys).

## Betroffene Produkte (Stand 2026-06-02)

| SKU | Produkt? | Bestand (Snapshot 2026-06) | Forecast ab 2026-06 | Soll-Verhalten |
|---|---|---|---|---|
| `029.001-TAMPER-STEEL` | ja | 300 (Transit→FBA) | 343 Stk / 7.837 € | Cap → tapert ~Sep 2027 auf 0 |
| `025.001-Knife-Bar` (Messerleiste) | ja | 464 (74 FBA + 390 Lager) | 204 Stk / 6.107 € | Bestand > Forecast → voller Lauf |
| `029.003-TAMPER-LEATHER` | ja | 0 (kein Eintrag) | 29 Stk / 285 € | Bestand 0 → sofort 0 |
| `019.002-SOLAR-MOUNTING-SET-02` | **nein** | 0 (kein Produkt) | 1.667 Stk / 33.430 € | Orphan-Guard → 0 + Key löschen |

Keine gespeicherten PO/FO/PFO für die vier SKUs vorhanden (Phantom-FOs werden zur Laufzeit erzeugt).

## Ansatz (gewählt: A — Read-Time-Cap am Bestand)

Die Deckelung wird **beim Rechnen** im Cashflow ermittelt, nicht in die Daten geschrieben. Damit
übersteht sie jeden VentoryOne-Re-Import (kein Überschreiben, keine Import-Sperre, keine zweite
Wahrheitsquelle).

Verworfen: **B — Snapshot-getriebener Auslauf-Plan** (einmalig festen Sell-Through-Plan in
`forecastManual` schreiben + Import sperren). Nachteil: zweite Wahrheitsquelle, Import-Sperre,
fragil bei Bestandsänderungen.

## Komponenten

### 1. Produkt-Flag

Neuer Lebenszyklus-Zustand „Auslaufend", abgebildet am Produkt-Record:

- `discontinued: true` — der maßgebliche Marker (treibt Cap + Anzeige + Reorder-Ausschluss).
- `status: "inactive"` — hält das Produkt aus der Phantom-FO/PFO-Generierung heraus
  (`statusIsActive` in `phantomFo.ts` Z. 131 ist bereits `false`, wenn `status ≠ active`).
- `includeInForecast: true` — bleibt **an**, damit Resterlös fließen darf (der Cap deckelt ihn).
- `discontinuedNote: string` — Klartext-Grund (z. B. „Auslaufend – keine Nachbestellung (GF 2026-06-01)").

### 2. Bestands-Cap im Cashflow-Forecast-Loop (`src/domain/cashflow.js`)

Im Loop über `s.forecast.forecastImport` (~Z. 1371): Für SKUs, deren Produkt `discontinued === true`
ist, wird der Umsatz an verfügbarem Bestand gedeckelt:

1. `availableStock` = Summe `amazonUnits + threePLUnits` aus dem **letzten** Inventar-Snapshot für die
   SKU; kein Eintrag → `0`.
2. Die Forecast-Monate der SKU **chronologisch** durchlaufen (für diese SKUs sortiert statt
   `Object.entries`-Reihenfolge), kumulierte Stück mitführen.
3. Pro Monat:
   - `cumUnits >= availableStock` → Umsatzbeitrag `0`.
   - `cumUnits + units_m <= availableStock` → voller `revenueEur`.
   - sonst (Überlauf) → anteilig: `revenueEur * (availableStock - cumUnits) / units_m`.
   - danach `cumUnits += units_m`.
4. Nicht-`discontinued`-SKUs: unverändert (voller `revenueEur`).

Damit: Knife-Bar läuft voll (464 > 204), Stahl tapert bei ~300 kumuliert auf 0, Leder (0 Bestand) → 0.

### 3. Orphan-Guard im selben Loop

Vor der Umsatzbuchung: Wenn für die forecastImport-SKU **kein** Produkt existiert
(`productProfileBySku.has(key) === false`), Beitrag `0` (skip). Das tötet den Solar-Phantomumsatz
dauerhaft, auch wenn ein künftiger Import den Key neu anlegt. Verifiziert: Solar ist der einzige
betroffene Orphan.

### 4. Datenpflege (einmalig, Produktiv-Commit)

- `029.001`, `029.003`, `025.001` → `discontinued:true`, `status:"inactive"`,
  `includeInForecast:true`, `discontinuedNote`.
- `forecast.forecastImport["019.002-SOLAR-MOUNTING-SET-02"]` löschen (Orphan-Guard schützt zusätzlich
  gegen Wiederkehr).

### 5. Anzeige

- **Forecast-Grid** (`src/v2/modules/forecast/index.tsx`): `discontinued` → oranger Tag „Auslaufend";
  Monatszellen nach Bestands-Depletion ausgegraut / `0` dargestellt (read-only-Optik wie Plan-Brücke).
- **Methodik** (`src/v2/modules/methodik/index.tsx`): bestehende Zeile „(Auslaufend / Inaktiv)" zu
  einem eigenen Zustand „Auslaufend" konkretisieren (Reorder: nein; Forecast-Quelle: VO-Live, am
  Bestand gedeckelt; Übergang → Inaktiv bei Bestand 0).

## Datenfluss

```
forecastImport[sku][month] ──▶ cashflow forecast loop
                                  │
              ┌───────────────────┼───────────────────┐
        kein Produkt?       discontinued?         normal
         (Orphan)            (Cap an Bestand)    (voller revenueEur)
            │                     │                    │
           0           kumuliert ≤ Bestand: voll       │
                       Überlaufmonat: anteilig         │
                       danach: 0                        │
                                  └──────────┬──────────┘
                                       forecastMapLive[month]
```

## Fehlerbehandlung / Edge Cases

- Snapshot fehlt für SKU → `availableStock = 0` → Umsatz 0 (konservativ).
- `units_m` fehlt/0 im forecastImport-Monat, aber `revenueEur` > 0 → kein sinnvoller Stück-Cap
  möglich; Fallback: solange `cumUnits < availableStock` voller Umsatz, sonst 0 (Stück werden mit 0
  kumuliert; vermeidet Division durch 0).
- `discontinued` an einem Produkt **ohne** forecastImport-Eintrag → keine Wirkung (nichts zu kappen).
- Mehrere Snapshots → jüngster gewinnt (gleiche Anker-Logik wie Projektion).

## Testplan (Parity, `tests/v2/`)

1. **Cap-Taper**: discontinued-SKU mit Bestand 100 und Forecast 60/60/60 → Monat1 voll, Monat2 anteilig
   (40/60), Monat3 = 0.
2. **Cap-Voll**: Bestand 500, Forecast 60/60/60 → alle drei voll (Knife-Bar-Fall).
3. **Cap-Null**: Bestand 0 → alle Monate 0 (Leder-Fall).
4. **Orphan-Guard**: forecastImport-SKU ohne Produkt → 0 Beitrag (Solar-Fall).
5. **Kein Phantom-FO**: discontinued-SKU erzeugt keine Phantom-FO-Suggestion.
6. **Nicht-Regression**: nicht-discontinued-SKU unverändert; Gesamt-Parity-Suite grün.

## Nicht im Scope (YAGNI)

- Auto-Flip `discontinued → inactive` bei Bestand 0 (Anzeige zeigt 0; manueller Statuswechsel reicht).
- Reaktivierungs-Workflow.
- Bestands-Cap für nicht-discontinued-Produkte (bewusst nur Auslauf-Fall).
