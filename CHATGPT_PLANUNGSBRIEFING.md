# ChatGPT-Planungsbriefing: Amazon FBA Cashflow Tool

## Zweck dieser Datei
Diese Datei ist eine Uebergabe fuer einen neuen Chat, der das Tool noch nicht kennt. Sie soll genug Produkt-, Fach- und Technik-Kontext liefern, damit der neue Chat sofort in Sparring, Priorisierung und Planungsarbeit einsteigen kann, ohne erst die Codebasis rekonstruieren zu muessen.

## Empfohlene Nutzung im neuen Chat
Du kannst den neuen Chat mit dieser Datei starten und sinngemaess sagen:

> Das ist der aktuelle Stand meines Amazon-FBA-Cashflow-Tools. Nutze diese Datei als Arbeitsgrundlage. Bitte arbeite mit mir als Produkt-/UX-/Prozess-Sparringspartner, stelle kritische Rueckfragen, hilf bei Priorisierung, Informationsarchitektur, Workflows und Roadmap-Entscheidungen. Wenn etwas unklar ist, formuliere zuerst Annahmen statt zu halluzinieren.

## Kurzueberblick
- Es handelt sich um ein Planungs- und Steuerungstool fuer ein Amazon-FBA-Business.
- Schwerpunkt: Liquiditaetsplanung, Forecast, Bestandsprojektion, Bestellungen, Fixkosten, USt-Vorschau, Soll-vs-Ist und Buchhalter-Export.
- Die aktive App ist die neue V2-Oberflaeche unter `#/v2/...`.
- Eine Legacy-Oberflaeche existiert noch im Repo, ist aber nicht der primaere Produktpfad.
- V2 arbeitet mit Shared Workspace Sync ueber Supabase: Auth, Workspace-Membership, Realtime, Presence, Fallback-Polling, Local Cache.

## Aktiver Produktstand
- Standard-Einstieg ist V2; ohne Hash setzt die App auf `#/v2/dashboard`.
- Routing und Hauptnavigation leben in `src/v2/app/routeCatalog.ts`.
- Die App ist fachlich schon weit ausgebaut und nicht nur ein MVP.
- Es gibt Paritaets- und Fachtests zwischen Legacy-Logik und V2.
- Stand der dokumentierten Paritaetsmatrix: 2026-02-12.
- Responsiveness ist teilweise automatisiert, aber nicht in allen Punkten voll abgeschlossen.

## Produktziel
Das Tool soll die operative und finanzielle Steuerung eines Amazon-FBA-Geschaefts in einem System zusammenfuehren:

1. Umsatz- und Cashflow-Planung.
2. Forecast-Import und Forecast-Versionierung.
3. Bestandsueberwachung und Bestellbedarf.
4. FO-/PO-Planung inklusive Zahlungen und Terminen.
5. Steuer-/Abschluss-nahe Auswertungen.
6. Zusammenarbeit mehrerer Nutzer in einem gemeinsamen Workspace.

## Zentrale Begriffe
- `PO`: Purchase Order. Reale Bestellung, persistiert in `state.pos`.
- `FO`: Forecast Order. Planungsobjekt je SKU, persistiert in `state.fos`.
- `PFO`: Phantom Forecast Order. Keine echte persistierte Order, sondern abgeleitete Empfehlung aus Bestands-/Robustheitslogik.
- `DOH`: Days on Hand.
- `OOS`: Out of Stock.
- `DDP`: Delivered Duty Paid.
- `EUSt`: Einfuhrumsatzsteuer.

## Sehr wichtige fachliche Wahrheit
PFOs sind aktuell **keine** First-Class-Entitaet im State.

- Es gibt **kein** `state.pfos`.
- Phantom/PFO-Objekte sind abgeleitete Vorschlaege.
- Wenn ein Nutzer aus einem PFO eine echte Order speichert, entsteht eine normale FO in `state.fos`.
- Risiko-Akzeptanzen und Worklist-Entscheidungen werden separat in `settings` gespeichert.

Das ist wichtig fuer jede spaetere Produktplanung: Wenn man PFOs ausbauen will, ist das nicht nur ein UI-Thema, sondern ein echtes Datenmodell-/Workflow-Thema.

## Hauptnavigation der V2

### 1. Uebersicht & Analyse
- `dashboard` -> Dashboard
- `sandbox` -> Sandbox
- `methodik` -> Methodik & Regeln
- `soll-ist` -> Soll vs. Ist
- `abc-insights` -> ABC Insights
- `abschluss/ust` -> USt Vorschau

### 2. Operatives Geschaeft
- `forecast` -> Absatzprognose
- `inventory/snapshot` -> Bestandsaufnahme
- `inventory/projektion` -> Bestandsprojektion
- `sku-planung` -> SKU Planung
- `orders/*` -> Bestellungen
- `plan-products` -> Neue Produkte

### 3. Finanzen & Abschluss
- `abschluss/eingaben` -> Cash-in Setup
- `abschluss/fixkosten` -> Fixkosten
- `abschluss/dividendenplanung` -> Dividendenplanung
- `abschluss/buchhalter` -> Buchhalter Export

### 4. Stammdaten & Tools
- `products` -> Produkte
- `suppliers` -> Suppliers
- `settings` -> Settings
- `export-import` -> Export / Import
- `tools/debug` -> Debug

## Tab-fuer-Tab: Was die Bereiche tun

### Dashboard
- Zentrales Berechnungs-Cockpit fuer Kontostand und Cashflow.
- Zeigt robusten Planungshorizont, Cashflow-Entwicklung, PnL-Matrix und Blocker.
- Hat Monats-Detaildrawer mit Kriterien, Blockern und Deep Links in Fach-Tabs.
- Nutzt je nach Einstellung reale Daten plus optional Phantom-FO-Simulation im Chart.
- Ist eher Cockpit und Entscheidungsoberflaeche als Dateneingabemaske.

### Sandbox
- Transparenzansicht fuer die Amazon-Auszahlungsquote.
- Zeigt, wie sich die empfohlene Quote zusammensetzt: Level, Saisonalitaet, Sicherheitsmarge.
- Dient zum Verstehen und Vergleichen, ueberschreibt aber keine echten Daten.

### Methodik & Regeln
- Globaler Steuerungspunkt fuer zentrale Rechenlogik.
- Aenderungen wirken global auf Dashboard, Soll/Ist, USt und weitere Auswertungen.
- Beispiele:
  - Forecast-Nutzung im Cashflow an/aus
  - Umsatz-Kalibrierung
  - Kalibrierungshorizont
  - Saisonalitaet in der Empfehlung
- Produktstrategisch sehr wichtig, weil hier globale Fachlogik zentralisiert wird.

### Soll vs. Ist
- Vergleicht Plan gegen reale Monatswerte.
- Fokus auf Kontostand, Umsatz und Auszahlung.
- Enthaelt Monatsabschluss-Logik mit Locking abgeschlossener Monate.
- Die Ist-Werte werden pro Monat gepflegt und zur Bewertbarkeit der Planung genutzt.

### ABC Insights
- Klassifiziert SKUs nach Beitrag zur gewaehlten Basis.
- Aktuell: Umsatz 6M oder Units 6M.
- Zeigt Pareto-/ABC-Sicht, Filter nach Klasse und Aktivitaetsstatus.
- Nutzt Forecast-/Produktdaten als analytische Hilfsschicht.

### USt Vorschau
- Vorschau auf USt-/Vorsteuer-/EUSt-Logik nach Monat.
- Konfigurierbar ueber Settings/Monats-Overrides.
- Ist eine projektionale Fachansicht, keine Buchhaltung im engeren Sinne.

### Forecast
- Versionierte Forecast-Imports aus VentoryOne.
- Aktive Baseline wird gefuehrt.
- Hauptbereiche im Modul:
  - Forecast Grid
  - Versionen
  - Impact & FO-Konflikte
- Manuelle Aenderungen im Grid sind moeglich.
- Forecast-Aenderungen koennen offene FOs fachlich in Konflikt bringen; dafuer gibt es einen Konflikt-Workflow.

### Bestandsaufnahme
- Monatliche Snapshot-Erfassung.
- Mit Copy-Forward, Speicherung und CSV-Export.
- Importhilfen fuer FBA- und 3PL-Bestaende via VentoryOne-Paste.
- Ist die Basis fuer Bestandswert und Teile der Bestandslogik.

### Bestandsprojektion
- Risikoampel fuer zukuenftige Bestaende.
- Modi: `Units`, `DOH`, `Plan`.
- Zeigt Inbounds aus PO/FO.
- Enthaelt PFO-Arbeitsliste:
  - priorisiert nach Bestelldatum/Monat
  - ueberfaellige Faelle bleiben sichtbar
  - direkte Aktion: in FO umwandeln oder Risiko fuer 1-2 Monate akzeptieren

### SKU Planung
- Simulations- und Steuerungsansicht pro SKU.
- Kombiniert reale Projektion, Auto-PFO-Vorschlaege und lokale manuelle Phantom-Overlays.
- Dient als fokussierte SKU-Planungsoberflaeche jenseits der grossen Inventory-Projektion.

### Bestellungen
- Gemeinsamer Arbeitsbereich fuer Bestellobjekte.
- Subtabs:
  - `PO`: reale Bestellungen
  - `FO`: Forecast Orders / Planobjekte
  - `PFO`: reine Phantom-/Empfehlungsliste
  - `SKU Sicht`: kombinierte Timeline auf SKU-Ebene
- Im Kopf des Moduls gibt es ein Zahlungsprotokoll mit echten PO-Ist-Zahlungen.
- Wichtige fachliche Regel: Bestaetigte Zahlungen haengen an POs, nicht an FOs.

### PO-Tab
- PO-Stammdaten, Milestones, Auto-Events und Payment-Status.
- Ansichten: Tabelle oder Timeline.
- Filterbar nach Archivstatus, Payment-Status und offenen Zahlungen.

### FO-Tab
- FO ist ein Planobjekt je SKU mit Plan-Meilensteinen.
- Ansichten: Tabelle oder Timeline.
- Mehrere FOs koennen zu einer PO zusammengefuehrt werden.
- Zahlungen werden erst nach PO-Conversion im PO-Flow bestaetigt.

### PFO-Tab
- Read-only Liste synthetischer Phantom Forecast Orders.
- Filter nach Trigger: Unter Safety oder OOS.
- Zeigt vorgeschlagenes Bestelldatum, Ankunftsmonat und Units.
- Heute eher analytisch/unterstuetzend als vollwertiger Workflow-Container.

### SKU Sicht
- Kombinierte Sicht auf PO, FO und Phantom-Signale je SKU.
- Hilfreich fuer Reihenfolge, Inbound-Kette und Planungszusammenhaenge.

### Neue Produkte (Plan-Produkte)
- Pre-SKU-/Pre-Launch-Produktplanung.
- Nutzt Referenzmonat-Baseline und uebernommene Saisonalitaet einer bestehenden SKU.
- Monats-Units werden ueber den Forecast-Horizont berechnet.
- Plan-Produkt kann spaeter in eine Live-SKU ueberfuehrt werden.
- Bei Uebernahme:
  - Plan wird archiviert
  - Mapping bleibt fuer Plan-vs-Ist erhalten
  - operative Live-Logik laeuft danach ueber die echte SKU

### Cash-in Setup
- Transparenzschicht zwischen Forecast, manuellen Eingaben und im Dashboard verwendeten Cash-in-Werten.
- Enthaelt:
  - Monatsende-Projektion des aktuellen Monats
  - manuelle Umsatz-/Auszahlungswerte
  - abgeleitete Quote
  - Kalibrierfaktor-Preview
  - Monatstabelle fuer Umsatz / Auszahlung / Quote
- Wichtig als Bruecke zwischen operativer Eingabe und globaler Rechenlogik.

### Fixkosten
- Erfassung periodischer Fixkosten mit Frequenz, Start/Ende, Proration und Overrides.
- Unterstuetzt automatische Paid-Logik und Instanzsicht je Monat.

### Dividendenplanung
- Jahresplanung mit Plan-GuV, ausschuettungsfaehigem Betrag, Bandbreite und Reifegrad-Ampel.
- Nutzt Forecast-/Cashflow-/Fixkosten-Basis.
- Eher Management-/Owner-Modul als Tagesgeschaeftsmodul.

### Buchhalter Export
- One-Click Monats-Paket fuer die Buchhaltung.
- Enthaelt u. a.:
  - Bericht
  - XLSX
  - Warenbestand CSV
  - Anzahlungen/Wareneingaenge
  - E-Mail-Entwurf
  - optional Zahlungsjournal
- Die Monatslogik ist fachlich klar definiert und bewusst robust gegenueber Datenluecken.

### Produkte
- Zentrale Produktstammdaten fuer Tagesbetrieb und Logistik.
- Fokus auf klare Default-/Override-Herkunft.
- Management- und Logistikmodus.
- Bulk-Editing vorhanden.
- Im Produkt-Modal gibt es u. a.:
  - erweiterte Felder
  - berechnete Saisonalitaet
  - Plan-vs-Ist (Plan -> Live)

### Suppliers
- Lieferantenstammdaten inklusive Default-Zahlungsbedingungen, Lead Time, Incoterm, Waehrung.
- Wichtig als zweite Ebene in der Stammdaten-Hierarchie.

### Settings
- Globale System-Defaults.
- Wichtige Bereiche:
  - Cashflow Basis
  - SKU-Planung (Simulation)
  - Faelligkeits-Defaults FO
  - Faelligkeits-Defaults PO
  - Team-Anzeigenamen
  - Produktkategorien
  - Data Health

### Export / Import
- Zwei Subtabs:
  - Workspace JSON Transfer
  - Legacy Migration Wizard
- Workspace JSON Transfer:
  - sauberer Workspace-Export
  - Backup-Export
  - JSON-Import
  - Validierung + Vorschau
- Legacy Migration Wizard:
  - Dry Run
  - Issues / Mapping-Report
  - Apply mit Backup
  - Modi `replace_workspace` und `merge_upsert`

### Debug
- Seed/Wipe/Undo-Testdaten und ABC-Debug.
- Hilfsbereich fuer Entwicklung und schnelles Testen.

## Zentrales Datenmodell
Die V2-State-Struktur enthaelt vor allem:

- `settings`
- `products`
- `planProducts`
- `planProductMappings`
- `suppliers`
- `productSuppliers`
- `productCategories`
- `pos`
- `fos`
- `payments`
- `inventory`
- `forecast`
- `monthlyActuals`
- `incomings`
- `extras`
- `dividends`
- `fixcosts`
- `fixcostOverrides`
- `legacyMeta`

## Wichtige Daten- und Logikbeziehungen

### 1. Orders
- POs sind reale Beschaffungsobjekte.
- FOs sind Planobjekte.
- PFOs sind abgeleitete Vorschlaege.
- Dashboard, Inventory und SKU-Sichten konsumieren PO/FO teils gemeinsam.

### 2. Forecast-Versionierung
- Jeder groessere Forecast-Import kann als Version gefuehrt werden.
- Es gibt eine aktive Baseline.
- Beim Wechsel bzw. neuen Import koennen FO-Konflikte entstehen.

### 3. Master-Data-Hierarchie
Viele operative Werte werden nicht stumpf aus einem Feld gelesen, sondern ueber eine Hierarchie aufgeloest:

1. Order Override
2. Produkt
3. Lieferant
4. Settings
5. Missing

Das betrifft z. B.:
- Unit Price
- Selling Price
- Margin
- MOQ
- Lead Time
- Transit Time
- Logistics
- Duty / EUSt
- DDP
- Incoterm
- Currency
- FX Rate

Diese Hierarchie ist produktstrategisch wichtig, weil viele UI-/Workflow-Fragen davon abhaengen, wo eine Information "gehoert".

### 4. Inventory-Risiko
Stock-Risiken basieren auf der Projektion.
Praktisch relevante Klassifikation:

- OOS: `endAvailable <= 0`
- Unter Safety: `daysToOos < safetyDays`

### 5. Robustheit von Monaten
Ein Monat gilt nur als robust, wenn mehrere Checks gleichzeitig bestehen, u. a.:
- SKU-Coverage
- Cash-in
- Fixkosten
- VAT
- Revenue-Inputs

Robustheit ist also ein zusammengesetzter Qualitaetsstatus, kein einzelner KPI.

## Zusammenarbeit / Sync / Auth
- Shared Workspace ueber Supabase.
- E-Mail/Passwort-Login.
- Nutzer brauchen Workspace-Membership.
- Presence/Realtime zeigt andere aktive Bearbeiter und Soft-Lock-Hinweise.
- Bei Realtime-Problemen gibt es Fallback-Polling.
- Es gibt einen Supabase-first Storage Adapter mit lokalem Fallback/Cache.
- Wenn der Shared Workspace leer ist, kann lokaler Browser-State einmalig importiert werden.

## Deployment / Laufzeit
- Frontend: Vite + React + Ant Design.
- Routing: React Router.
- Charts: ECharts.
- Tabellen: TanStack Table.
- Backend-Sync: Supabase RPC + Realtime.
- Runtime-Konfiguration kommt produktiv ueber `GET /api/config`.
- Deploy-Ziel ist Vercel.

## Qualitaet / Testabdeckung
Es existieren automatisierte Tests fuer u. a.:
- Migration
- Sync/Auth
- Payments Export
- PO/FO-Logik
- Dashboard-Paritaet
- Performance
- Responsiveness
- Route Load

Wichtige Testskripte:
- `npm run dev`
- `npm run build`
- `npm run test:parity`
- `npm run test:preflight`

## Aktuelle Produktbesonderheiten und Spannungen
Das sind aus Planungssicht besonders wichtige Themenachsen:

### 1. PFO ist fachlich wichtig, aber modellseitig nur halb materialisiert
- Heute stark als abgeleitete Empfehlung gebaut.
- Wenn PFOs kuenftig workflow-staerker werden sollen, stellt sich die Frage:
  - eigene Entitaet?
  - eigener Lifecycle?
  - eigener Entscheidungsstatus?
  - bessere Nachverfolgbarkeit?

### 2. Global-Logik vs. lokale Transparenz
- Methodik, Cash-in Setup, Sandbox und Dashboard greifen auf dieselben Konzepte zu, aber in unterschiedlichen Abstraktionsstufen.
- Das ist maechtig, kann aber mental komplex werden.

### 3. Produkte vs. Plan-Produkte vs. Live-SKU
- Es gibt bereits eine sinnvolle Trennung.
- Gleichzeitig entsteht hier naturgemaess Komplexitaet bei Uebernahme, Forecast, Lessons Learned und Datenhoheit.

### 4. Analytics + Operations in einer App
- Das Tool vereint Cockpit, Stammdaten, operative Planung und Abschluss-nahe Exporte.
- Gute Navigation, klare Ownership und Begriffsdisziplin sind daher besonders wichtig.

### 5. Shared Editing
- Zusammenarbeit ist ein echter Produktbestandteil, nicht nur Technik.
- Presence, Soft Locks und Konflikte beeinflussen UX-Entscheidungen direkt.

## Was ein neuer Chat nicht falsch annehmen sollte
- V2 ist der aktive Produktpfad.
- Legacy-Code existiert, ist aber nicht die primaere Planungsreferenz.
- PFOs sind aktuell keine persistierten Orders.
- Forecast und Cash-in sind eng gekoppelt, aber nicht identisch.
- Nicht jede Ansicht ist Eingabe; einige sind erklaerende oder diagnostische Oberflaechen.
- Das Tool ist kein reines Dashboard und kein reines ERP-Modul, sondern ein hybrides Steuerungswerkzeug.

## Gute Sparring-Fragen fuer den neuen Chat
Ein guter neuer Chat sollte mit mir bei Bedarf ueber diese Fragen arbeiten:

1. Welche Module sind wirklich Kern-Workflow und welche eher Analyse-/Admin-Bereiche?
2. Ist die aktuelle IA/Navigation fuer Owner-Workflows logisch genug?
3. Sollte PFO ein eigener Objekt-Typ mit Lifecycle werden?
4. Wo sind heute die groessten mentalen Spruenge zwischen Analyse, Entscheidung und Aktion?
5. Welche Einstellungen gehoeren in `Methodik`, welche in `Settings`, welche in die Fachmodule?
6. Welche Daten sollten global steuerbar sein und welche naeher am Objekt?
7. Welche UI-Bereiche sollten eher "Cockpit", welche eher "Arbeitsplatz" sein?
8. Welche Bereiche eignen sich fuer Vereinfachung, ohne Fachlichkeit zu verlieren?
9. Welche Roadmap-Reihenfolge bringt am meisten Klarheit und Nutzen?

## Wenn du im neuen Chat direkt produktiv loslegen willst
Arbeite bitte mit folgenden Leitplanken:

1. Hinterfrage Informationsarchitektur, Begriffe und Objektmodell aktiv.
2. Mache Annahmen explizit, statt Details zu erfinden.
3. Denke in Nutzer-Workflows, nicht nur in Screens.
4. Beachte, dass globale Logikaenderungen mehrere Tabs gleichzeitig beeinflussen koennen.
5. Pruefe bei Vorschlaegen immer, ob sie eher ein UI-, Datenmodell-, Workflow- oder Berechtigungsproblem loesen.

## Referenzquellen im Repo
Wenn du tiefer in die Codebasis gehen willst, sind diese Dateien besonders relevant:

- `src/v2/app/routeCatalog.ts`
- `src/v2/app/V2Shell.tsx`
- `src/v2/state/types.ts`
- `src/v2/state/workspace.ts`
- `src/v2/sync/storageAdapters.ts`
- `src/storage/remoteState.js`
- `src/v2/domain/masterDataHierarchy.ts`
- `src/v2/domain/forecastVersioning.ts`
- `PFO_LOGIC_AUDIT.md`
- `docs/parity-matrix-v2.md`
- `docs/accounting-report-pack.md`
- `docs/db-sync-supabase.md`
- `DEPLOY.md`

## Abschluss
Wenn du diese Datei gelesen hast, solltest du das Tool als V2-Shared-Workspace-System fuer Amazon-FBA-Planung verstehen: mit starkem Fokus auf Cashflow, Forecast, Bestand, Order-Workflows, Abschlussnaehe und teamfaehiger Zusammenarbeit.
