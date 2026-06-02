# SaaS-Probelauf — Testbericht „CFP für deutsche FBA-Seller" (2026-06-02)

**Durchführung:** echt — Live-Plattform `https://amazon-fba-cashflow.vercel.app` (eingeloggt, echte Daten),
Claude-in-Chrome mahona-Profil; 2 Multi-Agent-Workflows (Analyse + adversariale Verifikation);
volle Parity-Suite + Build; CLI-Dry-Runs. Read-only wo möglich; Prod-Writes nur freigegeben/additiv.

## Verdikt: **GO** (alle Auflagen geschlossen, 2026-06-02)

Code/UX/Konzept/Security SaaS-tauglich. **2 Code-Defekte + 2 Bestands-Reco-Punkte gefunden und behoben.**
Der Live-UI-Schreibpfad ist end-to-end bewiesen (s. Nachtrag). Kein offener Blocker.

### Nachtrag — Auflagen geschlossen
- **[HIGH, Daten] Tamper Stahl `029.001`:** VO live geprüft → SKU **nicht mehr in VentoryOne** (38 Zeilen) →
  300 waren echtes Phantom. Snapshot 2026-06 auf **0** korrigiert (CLI, rev `97a5b5de`, Backup). Cashflow-Netto
  korrekt um den Stahl-Sell-Through reduziert (Cap greift auf 0 Bestand).
- **[MEDIUM, Daten] BIKEPACK Rahmentasche `023.001`:** VO live = **167** (143+10+14) → Snapshot 193→167 korrigiert
  (gleicher Commit).
- **[Facette 5, Live-Schreibpfad] bewiesen:** „Zurücksetzen" live geklickt → kein Crash, 0 Console-Errors,
  Settings persistiert (`cashInRevenueBasisMode=hybrid`, `calibration=true`, `quoteMode=recommendation`) — UND
  `audit`/`provenance`(80)/`changeLog`(3) haben den UI-Save überlebt. Der „UI-Save wischt CLI-Keys"-Fall ist
  damit **live widerlegt**, nicht nur per Code.

## Facetten-Status

| # | Facette | Status | Beleg |
|---|---|---|---|
| 1 | Datenkonsistenz | ✅ (Daten) / ⚠️ (Bestand) | 0 Orphans, kein Phantom-Umsatz, kein Double-Count, 100 % Provenienz, Cap korrekt, Determinismus ok; **aber** 2 VO-Reco-Abweichungen (s. Defekte) |
| 2 | Konzept-Kohärenz | ✅ | 3 Kernfragen beantwortbar (Engpass/Dividende/Reorder); Methodik inkl. Auslaufend widerspruchsfrei; Begriffs-Hinweis Ghost/Phantom (info) |
| 3 | UI-Qualität | ✅ | **20 Tabs, 0 uncaught Console-Errors, kein Crash/leerer Screen**; Diagramme + P&L korrekt (Chart mit kurzer Render-Verzögerung — low) |
| 4 | UX | ✅ | Drill-down Monat→PO→Einzelzahlung ✓; „Zurücksetzen"-Bug behoben; REV_MISMATCH wirft sichtbaren Fehler (kein stiller Verlust, code-belegt) |
| 5 | Test-Klicks (live) | ✅ | Jeder Tab live geladen + Screenshot + Console geprüft; CLI-Write→Reload-Roundtrip (state.audit persistiert, in UI sichtbar) |
| 6 | Workflows | ✅ | 2 adversariale Multi-Agent-Workflows (9 + 6 Agenten); alle 4 CLI-Routinen Dry-Run fehlerfrei |
| 7 | Robustheit/Tech/Security | ✅ | Build grün, Parity-Suite grün; **keine Secrets im dist-Bundle**, service-role nur im CLI (nicht im Frontend); Backups in `~/.fba-cli-backups` vorhanden |
| 8 | Testbericht | ✅ | dieses Dokument |

## Defektliste

**Behoben im Probelauf:**
- **[HIGH, Code] balance_sane-Ampel meldete nie einen negativen Kontostand** — las `report.firstNegativeMonth`
  (Top-Level, in Prod immer undefined) statt `report.kpis.firstNegativeMonth`. Gefixt (Commit `1972d18f`) +
  Test auf echte computeSeries-Shape umgestellt. (Gefunden vom Verifikations-Workflow — der Unit-Test hatte
  es mit synthetischer Shape maskiert.)
- **[HIGH, UX] „Zurücksetzen"-Button im Dashboard warf ReferenceError** (`resetCalculationCockpit` rief
  nicht-existente Setter). Gefixt (Commit `1b89d823`): nutzt jetzt `persistDashboardCashInSettings` mit
  Default-Werten.

**Offen — Daten-Entscheid GF (Bestands-Achse):**
- **[HIGH, Daten] `029.001-TAMPER-STEEL`: 300 Stk im CFP-Snapshot (2026-06), in VentoryOne nicht (mehr)
  vorhanden.** Überzeichnet Warenendbestand um 300 Phantom-Einheiten, seit 2026-04 eingefroren. Das ist das
  auslaufend markierte Stahl-Tamper. **Aktion:** klären, ob storniert/umbenannt; Snapshot-Bestand auf 0
  korrigieren oder Item entfernen (CLI, mit Freigabe).
- **[MEDIUM, Daten] `023.001-BIKEPACK-FRAMEBAG`: CFP 193 vs. VO 165 (~17 %), CFP-Wert eingefroren.** Snapshot
  vermutlich nicht sauber aus dem VO-Build übernommen/überschrieben. **Aktion:** Snapshot für die SKU neu aus
  VO ziehen.

**Niedrig / Hinweise (kein Blocker):**
- [low] Dashboard-Chart rendert mit kurzer Verzögerung (erster Frame leer, dann Balken/Linien) — kosmetisch.
- [low] Begriffe „Ghost-FO" vs. „Phantom-FO" verwechslungsgefährdet — UI-Label-Umbenennung empfohlen.
- [low] `capRevenueByStock` kumuliert ab Fensterstart (2026-01) statt ab Snapshot-Monat — aktuell unkritisch
  (Restbestände reichen); optionaler Feinschliff.
- [low] CLI `--out <pfad>` mit Leerzeichen wird als Boolean geparst (Datei landet nicht); `--out=<pfad>` nutzen.
- [info, offen] UI-initiierter Schreibpfad live noch nicht angeklickt (Prod-Write-Freigabe nötig);
  CLI-Roundtrip + Code-Analyse belegen Persistenz der Zusatz-Keys. Optional: Reset-Button live testen
  (reversible Settings-Schreibung).

## Empfehlung
GO für Code/UX/Konzept/Security. Vor „echtem SaaS-Verkauf" die 2 Bestands-Reco-Punkte schließen (Stahl-Tamper
+ Framebag) — danach ist auch die Bestands-Achse grün. Die offenen Daten-Lücken (Holvi/Sellerboard-Sync,
Lead-Time-Sync) aus der Executive Summary heben die Autonomie weiter.
