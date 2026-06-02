<!-- Generiert aus dem Analyse-Workflow wrgp9nwxi (9 Agenten) am 2026-06-02. -->

# CFP-Synthese: Lese-Dashboard-Modell, FO/PFO, Datenquellen-Autonomie, Datenverlust

> Stand 2026-06-02 · Repo `amazon-fba-cashflow`, Branch `main` · Quellen: Modul-Inventar (32 Module/Engines), FO/PFO-Architektur-Audit, Datenquellen-/Provenienz-Analyse (`src/domain/provenanceRules.js`, `docs/operating-model/herkunfts-ledger.md`), Datenverlust-Review des Vertrauens-Fundaments (Commits `44d49dbf`, `4874777f`, `5bf29474`).

---

## 1. Funktions-Wegweiser — wo landet jede bisherige Funktion?

**Leitidee des neuen Modells:** Das Dashboard wird zum **Lese-Cockpit** (Berechnung anschauen, Szenario-Schalter umlegen — aber keine Geschäftsdaten dort eintippen). Geschäftsdaten kommen aus **automatischen Spiegelungen** (VO/Holvi/Sellerboard/BWA) plus wenigen menschlichen Eingaben. Jede Spalte „Ziel" sagt eindeutig, was mit dem Modul passiert.

**Legende Ziel-Status:**
- **BLEIBT (Schreib-UI)** = bleibt voll editierbar, ist eine bewusst-menschliche Eingabe oder Policy.
- **BLEIBT read-only** = Anzeige/Auswertung, schreibt schon heute nichts.
- **WIRD read-only** = schreibt heute, soll künftig primär von einer Routine gefüttert werden; manuelle Eingabe bleibt als Fallback/Korrektur.
- **ZUSAMMENGELEGT** = Funktion geht in einem anderen Modul/Layer auf.

### 1a. Cockpit

| Modul / Funktion | Route | Zweck | Schreibt heute | Ziel im Lese-Dashboard-Modell |
|---|---|---|---|---|
| **Dashboard** (Cockpit) | `/v2/dashboard` | Kontostand-/Cashflow-Verlauf + PnL-Matrix; Berechnungsbasis live umstellen | `settings.cashIn*`, `dashboardShowPhantomFoInChart`, `lastUpdatedAt` | **BLEIBT (Schreib-UI, aber nur Rechenregel-Schalter)** — kein Geschäftsdaten-Write. Die 4 Schalter (Scope/Umsatzbasis/Quote/PFO) sind Methodik, keine Belege. **Auflage:** kaputten `resetCalculationCockpit()` (Z.1798–1804, ReferenceError) fixen oder entfernen. |
| **Monatsplanung** | `/v2/monatsplanung` | Blocker je Monat abarbeiten bis „robust" | `phantomFoShortageAcceptBySku`, `fos[]`, FO-Konflikt-Entscheidungen | **BLEIBT (Schreib-UI)** — Kernworkflow für Bestell-/Risiko-Entscheidungen (Mensch). Genau die menschliche Disposition, die nicht automatisiert wird. |
| **Soll vs. Ist** | `/v2/soll-ist` | Plan vs. Realität; Monatsabschluss-Istwerte erfassen | `monthlyActuals.real*`, `realFixkostenEUR` | **WIRD read-only (Anzeige bleibt, Eingabe wird Routine-gefüttert)** — `realRevenueEUR/realPayout*` soll künftig der **Sellerboard-Import** schreiben, `realFixkostenEUR` der **Holvi-Ingest**. Manuelles „Monat abschließen" bleibt als Fallback. BWA-Naht ist schon read-only. |

### 1b. Operations — Orders / Forecast / Inventory

| Modul / Funktion | Route | Zweck | Schreibt heute | Ziel im Lese-Dashboard-Modell |
|---|---|---|---|---|
| **Forecast** | `/v2/forecast` | Versionierter VO-CSV-Forecast, Impact, FO-Konflikte, „Umsatz übertragen" | `forecast.*`, `incomings[]`, `fos[]` | **BLEIBT (Schreib-UI)** — Import + Baseline-Wechsel + manuelle Overrides. Import-Quelle ist VO (`vo-forecast-export`); manuelle Override-Zelle bleibt bewusst Mensch (schlägt VO, markiert). |
| **Inventory: Snapshot** | `/v2/inventory/bestand` | Monats-Bestandssnapshot erfassen, Paste-Import 3PL/FBA, VO-Reconciliation | `inventory.snapshots[]` | **WIRD read-only (Anzeige + Reconcile bleiben)** — Snapshot wird vom Skill `cfp-monats-bestandssnapshot` (cron 1.) geschrieben. Manuelle Erfassung/Paste bleibt als Korrektur-Fallback. **VO-Reconciliation-Panel bleibt** (read-only Abgleich). |
| **Inventory: Projektion** | `/v2/inventory/projektion` | Bestandsprojektion, Safety/OOS, Reorder/FO-Intent, PFO-Worklist, Stale-POs | `phantomFoShortageAcceptBySku`, `pos[].archived` | **BLEIBT read-only + (Schreib-UI für Dispo-Aktionen)** — Projektion ist Anzeige; „Risiko akzeptieren" und „Stale-PO archivieren" sind menschliche Dispo-Entscheidungen, bleiben. |
| **Orders (Tab-Container)** | `/v2/orders` | Bündelt PO/FO/PFO/Ghost-FO/SKU/Lieferantenausblick; Zahlungsprotokoll | — (read-only Container) | **BLEIBT read-only** — reiner Container, keine eigenen Writes. |
| **Orders · PO** (eingebettet) | `/v2/orders/po` | Echte Bestellungen (VentoryOne) | `pos[]`, `payments[]` | **WIRD teil-read-only** — PO-Sach-/Empfangsdaten via `sync-po-status` (VO-führend); **Zahlungs-/Paid-Status künftig Holvi-Ingest** statt Hand. Zahlungsplan/Meilensteine (CFP-eigen) bleiben editierbar. |
| **Orders · FO** (eingebettet) | `/v2/orders/fo` | Forecast Orders (Planobjekte, cashflow-wirksam) | `fos[]` | **BLEIBT (Schreib-UI)** — FO ist die persistente Pipeline-Bestellung (Mensch legt an / aus PFO konvertiert). Siehe §2. |
| **Orders · PFO-Liste** | `/v2/orders/pfo` | Abgeleitete Bestellvorschläge (nie persistiert) | — | **BLEIBT read-only** + Umbenennung „Empfohlene Bestellungen". |
| **Orders · Ghost-FO** | `/v2/orders/ghost-fo` | Verwaiste echte FOs (durch PO gedeckt) bereinigen | `fos[].status=CONVERTED` | **BLEIBT (Schreib-UI)** + **Umbenennung „Verwaiste FOs / FO-Bereinigung"** (Phantom/Ghost-Kollision auflösen, §2). |
| **Orders · SKU-Timeline** | `/v2/orders/sku` | Gantt je SKU (PO/FO/Phantom) | — | **BLEIBT read-only** — Navigationshilfe. |
| **Orders · Lieferantenausblick** | `/v2/orders/lieferantenausblick` | Lieferantensicherer Mengen-Ausblick, einfrieren, XLSX/PDF-Export | `supplierOutlooks[]` | **BLEIBT (Schreib-UI)** — Kommunikations-Layer, eigener bewusster Mensch-Workflow. |

### 1c. Stammdaten

| Modul / Funktion | Route | Zweck | Schreibt heute | Ziel im Lese-Dashboard-Modell |
|---|---|---|---|---|
| **SKU-Planung** | `/v2/sku-planung` | Pro-SKU-Verlauf, PFO-Simulation, Shortage-Akzeptanz | `phantomFoShortageAcceptBySku` | **BLEIBT read-only + (Dispo-Akzeptanz)** — Simulation ist UI-only (nicht cashflow-wirksam), bleibt so. |
| **Cash-in Setup** | `/v2/abschluss/eingaben` | Umsatzbasis/Quote/Kalibrierung pflegen, Extras, Quoten-Startprofil | viele `settings.cashIn*`, `incomings[]`, `extras[]`, `dividends[]`, `monthlyActuals` | **BLEIBT (Schreib-UI)** — Transparenz-/Pflege-Layer für Cash-in-Annahmen. `incomings` aus Forecast-Transfer; Quote/Kalibrierung = Policy (Mensch). |
| **Neue Produkte (Plan)** | `/v2/plan-products` | Plan-Produkte + Saisonalität + Takeover in Live-SKU | `planProducts[]`, `products[]`, `planProductMappings[]` | **BLEIBT (Schreib-UI)** — Pre-SKU-Planung ist bewusst menschlich. |
| **Produkte** | `/v2/products` | Live-SKU-Stammdaten, Completeness, Bulk-Edit | `products[]` | **WIRD teil-read-only** — EK USD (`unitPriceUsd`) & Landed Cost (`landedUnitCostEur`) sind **VO-führend** (`po-einstandskosten-sync`, semi-auto via Chrome). Stammdaten (Alias/HS/FNSKU/Kategorie/Bucket) bleiben Mensch. **Lead-Times: noch keine Provenienz-Regel — Lücke (§3).** |
| **Suppliers** | `/v2/suppliers` | Lieferanten + Payment-Terms | `suppliers[]` | **BLEIBT (Schreib-UI)** — Stammdaten + Zahlungskonditionen (Mensch). |

### 1d. Finanzen

| Modul / Funktion | Route | Zweck | Schreibt heute | Ziel im Lese-Dashboard-Modell |
|---|---|---|---|---|
| **Fixkosten** | `/v2/abschluss/fixkosten` | Stammdaten + Monatsinstanzen, Paid/Override | `fixcosts[]`, `fixcostOverrides`, `status.*` | **BLEIBT (Schreib-UI) für Stammdaten; Monats-Ist WIRD read-only** — `fixcostOverrides` (realer Betrag) soll **Holvi-Ingest** füttern. Frequenz/Anker/Plan = Mensch. |
| **Steuern (Dachmodul)** | `/v2/abschluss/steuern` | Tab-Hülle USt/OSS/Ertragsteuern | — | **BLEIBT read-only** (Hülle). |
| **Steuern · Ertragsteuern** | `?tab=ertragsteuern` | KSt/GewSt-Quartalsplanung | `taxes.ertragsteuern.*` | **BLEIBT (Schreib-UI)** — Vorauszahlungs-Termine/Beträge = Mensch; BWA kalibriert nur den Forecast (`import-bwa`), nicht diese Felder. |
| **Steuern · OSS** | `?tab=oss` | OSS-Proxy (20,3 %) | `taxes.oss` | **BLEIBT (Schreib-UI)** — DE-Anteil = menschliche Annahme. |
| **Buchhalter Export** | `/v2/abschluss/buchhalter` | Monatspaket PDF+XLSX | — (read-only) | **BLEIBT read-only** — reiner Export aus aktuellem State. |
| **Dividendenplanung** | `/v2/abschluss/dividendenplanung` | Plan-GuV, ausschüttungsfähiger Betrag, Reife-Ampel | `dividendPlanning.*` | **BLEIBT (Schreib-UI)** — GF-Entscheidung, bewusst manuell. |

### 1e. System-Engine

| Modul / Funktion | Route | Zweck | Schreibt heute | Ziel im Lese-Dashboard-Modell |
|---|---|---|---|---|
| **Methodik & Regeln** | `/v2/methodik` | Globale Rechenregeln (Forecast/Quote/Kalibrierung) + Erklär-Tabellen | `settings.cashIn*`, `forecast.settings.useForecast` | **BLEIBT (Schreib-UI)** — zentraler Policy-Ort. **Empfehlung:** hier die FO/PFO-Richtungsentscheidung dokumentieren (§5, Q1). |
| **Settings** | `/v2/settings` | Globale Defaults, Kategorien, Team, Data-Health | viele `settings.*`, `productCategories[]`, `products[].categoryId` | **BLEIBT (Schreib-UI)** — Defaults/Stammdaten. Data-Health-Panel ist read-only. |
| **Export / Import** | `/v2/export-import` | Workspace-JSON Export/Import, Legacy-Migration | **GESAMTER `state_json`** | **BLEIBT (Schreib-UI, gefährlich)** — Vollimport ersetzt State. Bestätigungs-Gates beibehalten. |
| **Sandbox** | `/v2/sandbox` | Was-wäre-wenn Quote/Umsatz | **KEINE** | **BLEIBT read-only** — reines Szenario. |
| **ABC Insights** | `/v2/abc-insights` | Pareto/ABC-Analyse | **KEINE** | **BLEIBT read-only**. |
| **Debug / Werkzeuge** | `/v2/tools/debug` | Seed/Wipe/Undo, ABC-Debug | **GESAMTER `state_json`** | **BLEIBT (Schreib-UI, gefährlich)** — Dev-only, Confirm-Gates. |
| **Engine `cashflow.js`** | (keine Route) | `computeSeries`, Bestands-Cap, Orphan-Guard | **KEINE (reine Funktion)** | **BLEIBT read-model** — Herzstück, persistiert nie. |
| **Engine `planProducts.js`** | (keine Route) | Plan-Brücke, virtuelle Produkte | **KEINE** | **BLEIBT read-model**. |
| **Engine `portfolioBuckets.js`** | (keine Route) | Reifegrad/Bucket, `discontinued`-Marker | **KEINE** | **BLEIBT read-model**. |
| **Engine `phantomFo.ts`** | (keine Route) | PFO-Vorschläge | **KEINE (In-Memory)** | **BLEIBT read-model** — siehe §2 (Engine-Konsolidierung). |

**Kernaussage für „wo ist X geblieben?":** Es verschwindet **kein** Modul. Drei Eingabe-Flächen wandern von „Mensch tippt" zu „Routine spiegelt, Mensch korrigiert": **Bestands-Snapshot**, **Umsatz-/Payout-Ist (Soll-vs-Ist)** und **Fixkosten-Monats-Ist**. EK/Landed-Cost in Produkte sind schon VO-führend (semi-auto). Alles andere bleibt exakt wo es ist.

---

## 2. FO/PFO-Empfehlung (kompakt) — VO-Pipeline-Prinzip

**Urteil: KEEP (kein Rebuild).** Die 3-Stufen-Trennung ist strukturell sauber und bildet das VO-Pipeline-Prinzip korrekt ab:

- **PO** (`state.pos`) = einzige reale Bestellung, die in **VentoryOne** existiert. Treibt den Cashflow immer.
- **FO** (`state.fos`, Status DRAFT/ACTIVE) = persistente Planobjekte. **Treiben den Cashflow immer** (`cashflow.js` Z.2137).
- **PFO / Phantom-FO** = **nicht persistiert**, bei jedem Render aus den Coverage-Lücken neu berechnet (`buildPhantomFoSuggestions`). Iterative Pipeline je SKU (gedeckelt 12/SKU), idempotent, sauber dedupliziert.

Konversions-Lebenszyklus **PFO → echte FO → PO** ist konsistent (Decision-Flag `phantomFoWorklistDecisionById` verhindert Doppelvorschläge). **Auslaufend/`discontinued`** wird in beiden Generatoren konsequent vom Nachschub ausgenommen. **`voPipelineHonored: true`.**

**Der einzige echte Bruch ist NICHT strukturell, sondern ein Default-Schalter:** PFOs treiben den Cashflow nur, wenn `settings.dashboardShowPhantomFoInChart === true` — **Default AUS** (true nur in `src/ui/debug.js`). Heute trägt die Pipeline also der Mensch über manuell angelegte echte FOs, nicht die Auto-PFOs.

**Chirurgische Änderungen (kein Neubau):**
1. **Richtungsentscheidung (DER Hebel, → §5 Q1):** Empfehlung **(a)** `dashboardShowPhantomFoInChart` auf `true` defaulten + PFO-Beträge im Chart **visuell als „Forecast/unbestätigt" separieren** (eigene Serie/Schraffur), und `phantom:true` in `cashflow.js` (Z.2147 ff.) auf die Cashflow-Entries durchreichen. Alternative **(b):** beibehalten + in Methodik dokumentieren „nur echte FOs sind cashflow-wirksam".
2. **Lead-Time deduplizieren:** `phantomFo.resolveLeadTime` (Default 14/21) vs. `dashboardRobustness.resolveLeadTimeForProduct` (Default 45/45) in **eine** Funktion (`orderUtils`/`masterDataHierarchy`) — sonst divergieren Bestelldatum (PFO-Liste) und Order-Duty-Trigger.
3. **Begriffe entkoppeln:** „Ghost-FO"-Tab → **„Verwaiste FOs / FO-Bereinigung"**, „PFO/Phantom-FO" → **„Empfohlene Bestellung (Vorschlag)"**. Nur UI-Labels.
4. **Provenienz beim PFO→FO mitnehmen:** `phantomMeta` (phantomId, firstRiskMonth, reason, source) als `origin`-Felder in den echten FO-Record übernehmen (heute geht die Herkunft verloren — relevant für den Herkunfts-Ledger).
5. **PFO-Berechnung memoisieren:** läuft heute pro Seite mehrfach (Dashboard, Inventory, PfoListView, SkuTimeline, SupplierOutlook). Ein gemeinsamer gecachter Selector reduziert die iterative Vollberechnung und garantiert identische PFO-Mengen über alle Views.

**Zweite, parallele Inkonsistenz** (aus der Datenquellen-Analyse, blockiert FO/PFO-Autonomie): es existieren **zwei divergierende PFO-Engines** — `orderDutyIssues` vs. `buildPhantomFoSuggestions`. Eine muss kanonisch werden, sonst weichen Vorschläge auseinander.

---

## 3. Datenquellen-Autonomie-Plan

### 3a. Was wird (oder kann) automatisch gespiegelt — Ist-Stand

| Feld | Führend (`provenanceRules.js`) | Routine heute | Autonomie |
|---|---|---|---|
| **Bestand (Snapshot)** | VentoryOne | `cfp-monats-bestandssnapshot` → `build-snapshot-from-ventory.mjs`, **cron 1.**, Dry-Run-Gate, Backup, Telegram | **auto** ✅ (reifster Pfad) |
| **Forecast-Umsatz** | VO-Forecast-Export | `vo-forecast-export` (Skill) + Import + Bestands-Cap | **auto-fähig**, aber manueller Trigger |
| **PO Status/Empfang/Kosten** | VentoryOne | `sync-po-status.mjs` (robust: ARCHIVE/RECEIVE_UNPAID/MAP), `po-einstandskosten-sync` | **semi** (manuell getriggert, kein cron) |
| **EK USD / Landed Cost** | VO-Einstandspreis-Rechner | `po-einstandskosten-sync` (Chrome, mahona-Profil) | **semi** (VO-Write nur per Browser, Pierre-Bestätigung) |
| **Steuer/BWA-Kalibrierung** | DATEV-BWA | `import-bwa.mjs` (Dry-Run/Commit/Backup) | **semi** (CSV manuell aus DATEV) |
| **Eröffnungssaldo** | Holvi | `cli set-setting openingBalance` | **manual** (selten) |
| **Zahlungen (paid + Datum)** | Holvi | — | **manual** ❌ größte Lücke |
| **Fixkosten-Monats-Ist** | Holvi | — | **manual** ❌ |
| **Umsatz-/Payout-Ist** | Sellerboard | — (Hand im Soll-vs-Ist-Tab) | **manual** ❌ |
| **Lead Times** | VO (keine Prov-Regel!) | beiläufig in `po-einstandskosten-sync` | **manual** ❌ |
| **FO/PFO** | rechnerisch | Engine + `audit.mjs` (Plausi) | bewusst Mensch (Bestellentscheidung) |
| **Dividende** | Mensch | — | bewusst Mensch ✅ |

### 3b. Die echten Lücken
1. **Holvi hat KEINE genutzte API/CLI-Anbindung.** Drei Holvi-führende Felder (Zahlungen, Fixkosten-Ist, Eröffnungssaldo) fließen nicht programmatisch in den State. `mahona-monatsabschluss` liest nur den Holvi-Export in eine Reco-Excel — nicht in den CFP. **Größte Autonomie-Lücke.**
2. **Sellerboard** hat keinen Export-Skill — Umsatz-/Payout-Ist wird jeden Monat von Hand eingetippt.
3. **Kein Orchestrator:** robuste CLIs existieren, aber nur der Snapshot läuft scheduled. `sync-po-status`, `import-bwa`, `audit`, `vo-forecast-export` nur auf manuellen Trigger.
4. **PO-ETA hat keinen Sync** (VO↔Planner getrennt) → verzerrt Bestandsprojektion + „überfällig"-Liste.
5. **Lead Times** ohne Sync und ohne Provenienz-Regel.
6. **Audit-Lücke:** `credibilityAudit` deckt nur 6 Checks (`snapshot_fresh`, `forecast_current`, `pfo_complete`, `fo_plausible`, `revenue_realistic`, `provenance_coverage`). Keine Ampel für payment/fixcost/tax/openingBalance — manuell gepflegte Felder veralten unbemerkt.
7. **Provenienz-Stempelung unvollständig:** `build-snapshot-from-ventory`, `sync-po-status`, `import-bwa` stempeln beim Commit (noch) **keine** Provenienz → `provenance_coverage` künstlich niedrig trotz frischer Daten.

### 3c. Benötigte neue Routinen / Skills (priorisiert)

| Prio | Routine | Was sie tut | Schließt |
|---|---|---|---|
| **1** | **`tools/fba-cli/sync-holvi.mjs`** (Holvi-Ingest-CLI) | Liest Holvi-Export (XLSX/CSV oder API) → schreibt (a) `paid`+Datum in `po.paymentLog`/`payments`, (b) Fixkosten-Ist in `fixcostOverrides`, (c) `openingBalance`-Vorschlag. Dry-Run/Commit/Backup, `applyProvenance(source='holvi')` | 3 Felder auf einen Schlag |
| **2** | **Sellerboard-Ist-Import** (Skill + CLI analog `vo-forecast-export`) | Zieht Monats-Umsatz/Auszahlung → `monthlyActuals[m].realRevenueEUR/realPayoutEur/realPayoutRatePct`, `source='sellerboard'` | ersetzt manuelles Eintippen |
| **3** | **„CFP-Monatsabschluss"-Orchestrator** (Scheduled, ~3. des Monats) | Feste Reihenfolge: Snapshot (läuft am 1.) → vo-forecast-export+Import → sync-po-status → sync-holvi → sellerboard-import → import-bwa → `audit --commit`. Je Schritt Dry-Run-Gate + Telegram-Ampel | macht den 6-Schritte-Workflow autonom bis auf Bestell-Entscheidung |
| **4** | **cron-Verdrahtung** | `sync-po-status` (wöchentl.) + `vo-forecast-export`-Refresh (≤30 Tage, damit „Forecast aktuell" nie failt) | beide existieren, brauchen nur Scheduler |
| **5** | **Provenienz-Stempel nachrüsten** | `applyProvenance(entityKeys, source)` bei jedem Commit in `build-snapshot-from-ventory`, `sync-po-status`, `import-bwa` (Helfer existiert in `provenance.mjs`) | macht `provenance_coverage` ehrlich |
| **6** | **Audit-Erweiterung** | Aktualitäts-Checks für payment/fixcost/tax/openingBalance („letzte Holvi-Reco > N Tage", „BWA-Import > N Tage") | rote Ampel für manuell gepflegte Felder |
| **7** | **Lead-Time-Sync VO→CFP** (Patch-Generator) + Frische-Ampel | Liest VO-SKU-LT, schlägt Updates als Dry-Run-Patch vor; Konsistenz-Check im Audit | LT-Drift |
| **8** | **FO/PFO-Engine-Konsolidierung** (Code) + Verwaiste-FO-Detektor als CLI | `orderDutyIssues` + `buildPhantomFoSuggestions` auf eine kanonische Quelle; CLI findet ACTIVE-FOs ohne PO | Voraussetzung, FO/PFO von „manual" auf „semi" zu heben |

**Hartes Limit (bleibt dauerhaft semi):** EK- und Landed-Cost-**Writes** müssen in die VO-Stammdaten **per Chrome** (mahona-Profil) erfolgen — keine VO-Schreib-API. Das zwingt diese Felder auf „semi" mit Pierre-Bestätigung.

---

## 4. Datenverlust-Urteil + Auflagen

**Urteil: GRÜN MIT AUFLAGEN.** Das Vertrauens-Fundament (provenance/audit/changeLog) ist sauber **additiv/non-breaking**. Das größte denkbare Risiko — UI-Save überschreibt die CLI-geschriebenen Zusatz-Keys — ist durch den **realen Code belegt entschärft**:

**Warum non-breaking (belegt):**
1. **Full-Replace mit Optimistic-Concurrency:** `app_sync` macht `set state_json = excluded.state_json` (kein Merge). Einzige Schutzschicht = `p_if_match_rev` (REV_MISMATCH). UI (`pushRemoteState`) und CLI (`commitState`) teilen exakt diesen Mechanismus.
2. **UI verliert die Zusatz-Keys NICHT:** `ensureAppStateV2` merged per Spread `{...base, ...input}`, `AppStateV2 extends UnknownRecord` (offene Index-Signatur). Unbekannte Top-Level-Keys (`provenance`/`audit`/`changeLog`) überleben den UI-Lade→Speicher-Roundtrip nachweislich. **Das trägt das ganze Design.**
3. **Keine Feldnamen-Kollision** in `src/`; die Supabase-Tabelle `change_log` ist serverseitiges Log, wird NICHT aus `state_json` materialisiert.
4. **Validator advisory + Allow-List:** lehnt unbekannte Keys nie ab; `commitState` blockiert nur NEU eingeführte Fehler.
5. **`commitState` safe-by-construction:** lädt frisch → `structuredClone` mutieren → validieren → **JSON-Backup des Before-States** (zeitgestempelt, nie gelöscht) → `app_sync` mit `if_match_rev` → bei REV_MISMATCH Reload+Reapply.
6. **Keine DB-Migration nötig** — reine `state_json`-Felder (jsonb ohne Schema-Constraint). Kein `ALTER TABLE`, keine Rückwärts-Inkompatibilität.
7. Phase 1 ist committed (`44d49dbf`), 20 Parity-Tests grün.

**Auflagen (vor/bei Phase 3 = Task 9, und nach Deploy):**

| # | Auflage | Schwere |
|---|---|---|
| **A1** | **Task 9 exakt verdrahten:** `applyProvenance(next, {...})` **nach** `mutate(draft)`, **vor** Validierung/Backup/Write, und **innerhalb** der Retry-Schleife (Z.104–155) — sonst Stempel bei REV_MISMATCH-Retry verworfen. **Unstimmigkeit auflösen:** `targetRev` existiert erst nach erfolgreichem `app_sync` (Plan-Skizze nennt ihn im Step 5 davor) → entweder mit `rev=null` stempeln und nachreichen. Heute liest `commitState` `opts.provenance` gar nicht (Bug latent, aktuell harmlos). CLI-Write-Test ergänzen: nach Commit `state.provenance[key].rev == neuer rev`. | medium |
| **A2** | **Concurrency-Fenster CLI vs. UI:** Schreibt der Auto-Audit während jemand in der UI editiert, bumpt der rev → nächster UI-Save trifft REV_MISMATCH, lokaler Edit nicht persistiert (kein stilles Überschreiben, aber gefühlter Datenverlust). **Auto-Audit auf Mo 07:00** (außerhalb Arbeitszeit); prüfen, dass `saveWith`/`storageAdapters` eine **sichtbare Fehlermeldung + Retry** zeigt; bei On-demand-Audit Pierre hinweisen, nicht gleichzeitig zu speichern; Audit-Commit klein halten (nur `s.audit`). | medium |
| **A3** | **Roundtrip-Test nach Task 9 + UI-Phase 4:** CLI `audit --commit` → in UI Kleinigkeit speichern → CLI `get state` → prüfen, dass `audit/provenance/changeLog` noch da sind. (Code-Analyse sagt: bleiben — einmal real bestätigen.) | — |
| **A4** | **Non-Regression-Test:** `computeSeries(state)` mit vs. ohne `provenance/audit/changeLog` **identisch** (Spec verlangt ihn, Plan listet ihn nicht). | — |
| **A5** | **Stale-Audit-Snapshot (low):** `runAudit` lädt State 2× → geschriebenes `state.audit` kann marginal älteren Stand beschreiben. Akzeptabel (self-healing nächster Lauf); für exakte Konsistenz Report **innerhalb** `commitState`-mutate berechnen. | low |
| **A6** | **Materialisierungs-Annahme dokumentieren (low):** `app_materialize_state` kennt `provenance/audit/changeLog` **nicht** → existieren nur in `state_json`, nicht in den Einzeltabellen. In `docs/operating-model/herkunfts-ledger.md` festhalten, damit niemand sie später in den Tabellen sucht. | low |
| **A7** | **Backfill-Guard (low):** Task 10 muss `if (!state.provenance[key])` beibehalten (nur fehlende Stempel füllen, vorhandene nie überschreiben); vor `--commit` Dry-Run-Diff prüfen. | low |

---

## 5. Offene Entscheidungen für Pierre

1. **FO/PFO-Cashflow-Richtung (DER Hebel fürs VO-Pipeline-Prinzip).** Treiben Auto-PFOs den Kontostand-Verlauf, oder nur manuell angelegte FOs?
   - **(a)** `dashboardShowPhantomFoInChart` auf `true` defaulten + PFO-Beträge visuell als „Forecast/unbestätigt" separieren (Empfehlung). → Pipeline wird ehrlich sichtbar, ohne Schätz-Cash mit Ist zu vermischen.
   - **(b)** Beibehalten (nur echte FOs cashflow-wirksam) + in `/v2/methodik` dokumentieren „künftige Bestellungen müssen als FO angelegt werden". → weniger Arbeit, aber Pipeline-Cashflow bleibt manuell getragen.

2. **Holvi-Anbindung: API oder Export-Datei?** Hat Holvi eine nutzbare API, oder bleibt es beim XLSX/CSV-Export, den `sync-holvi.mjs` parst? (Bestimmt Bauaufwand der Prio-1-Routine und ob der Monats-Orchestrator wirklich autonom läuft oder einen manuellen Export-Download braucht.)

3. **Wie weit soll der „CFP-Monatsabschluss"-Orchestrator autonom committen?** Voll-autonom mit `--commit` (Dry-Run-Gate + Telegram, nur bei sauberem Lauf) — oder Dry-Run + Pierre gibt frei? (Snapshot läuft schon voll-autonom; die Frage ist, ob Zahlungen/Umsatz-Ist denselben Vertrauensgrad bekommen.)

4. **Umbenennung Ghost-FO / PFO durchziehen?** „Verwaiste FOs / FO-Bereinigung" und „Empfohlene Bestellung (Vorschlag)" — nur UI-Labels, Code-Namen bleiben. (Kleiner Eingriff, beseitigt die Phantom/Ghost-Verwechslung.)

5. **Welche Eingabe-Flächen dürfen nach Routine-Anbindung als Fallback editierbar bleiben?** Konkret: Bleibt „Monat abschließen" (Soll-vs-Ist) und die manuelle Snapshot-Erfassung als Korrektur-Fallback aktiv, oder soll die UI nach erfolgreicher Sellerboard-/VO-Spiegelung read-only werden (Konflikt-Schutz)?

6. **Lead-Times: eigene Provenienz-Regel + Sync, oder bewusst manuell lassen?** Heute beiläufig im PO-Sync gepflegt, kein Audit-Check. (Niedrige Frequenz — lohnt der VO→CFP-Sync, oder reicht eine Frische-Ampel?)

7. **`resetCalculationCockpit()`-Fix:** Der „Zurücksetzen"-Button im Dashboard (Z.1798–1804) wirft beim Klick einen ReferenceError (Setter/Werte nicht definiert). Reparieren oder Button entfernen? (Toter/kaputter Code, unabhängig vom Rest — sollte so oder so weg.)
