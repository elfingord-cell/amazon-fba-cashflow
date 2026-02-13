# UI-Reset Acceptance Matrix (V2-Only)

## Stand
- Datum: 2026-02-13
- Basis: reale V2-Tab-Abnahme nach Prozess-IA-Rearchitektur, V2-only Hardening-Pass und technischer Verify-Lauf.
- Scope: nur `#/v2/**`, kein Legacy.

## Prueffelder
- `Header/Titel`: kompakte Topbar ohne Seitentitel, Seitentitel nur im Inhaltsbereich.
- `Controls`: kompakte, einheitliche Inputs/Buttons/Checkboxen.
- `Table-Shell`: Single-Frame-Prinzip (genau ein sichtbarer Rahmen je Tabelle).
- `Actions`: keine abgeschnittenen oder umbrechenden Kernaktionen.
- `Scroll/Responsive`: stabile horizontale Scrollbarkeit und mobile Nutzung.

## V2 Matrix
| Route | Header/Titel | Controls | Table-Shell | Actions | Scroll/Responsive | Ergebnis |
|---|---|---|---|---|---|---|
| `#/v2/dashboard` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/forecast` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/inventory/snapshot` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/inventory/projektion` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/orders/fo` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/orders/po` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/plan` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/products` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/suppliers` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/settings` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/abschluss/eingaben` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/abschluss/fixkosten` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/abschluss/ust` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/abschluss/payments` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/abschluss/buchhalter` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/export-import` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/tools/debug` | PASS | PASS | PASS | PASS | PASS | PASS |

## Hotspot-Abnahme (V2)
1. Doppelrahmen in Tabellen entfernt: `TanStackGrid` + AntD Table auf Single-Frame harmonisiert.
2. Technische Titelsuffixe (`(V2)`, `(V2 Native)`) entfernt.
3. PO/Suppliers Actions auf `nowrap` und ausreichende Spaltenbreiten gestellt.
4. Inventory DOH-Spalten verschlankt und Table-Layout stabilisiert.
5. Fixkosten mit globalen Expand/Collapse-Aktionen (`Alles auf` / `Alles zu`) versehen.
6. Prozess-IA umgesetzt: Operations/Masterdata/Monatsabschluss/Tools getrennt, `Plan` sichtbar, `Debug` unter Tools.
7. Routing-Kompatibilität aktiv: alte V2-Pfade (`fo`, `po`, `inputs`, `fixcosts`, `vat`, `payments-export`, `accounting-export`, `inventory`) redirecten auf neue Zielrouten.
8. Inventory-Projektion nutzt Snapshot-Anker aus letztem verfügbaren Snapshot und zeigt Fallback transparent an.
9. Inventory-Projektion zeigt Risiko-KPI (`Unter Safety`, `OOS`, `kritischster Monat`, `fehlende ETA`) plus PO/FO-Inbound je Monat.
10. Zellklick auf Risikozellen öffnet Bestellassistent und übergibt Prefill-Intent direkt nach `#/v2/orders/fo` oder `#/v2/orders/po`.
11. Produkte-Grid hat zwei Betriebsmodi: `Management` (operative Kernkennzahlen) und `Logistik` (`HS-Code`, `Warenbeschreibung`, Copy pro SKU).
12. Produktmaske ist in `Basis`, `Preise & Kosten (operativ)`, `Lieferzeit` und `Erweitert` geschnitten; MOQ nur noch in `Erweitert`.
13. Defaults/Overrides werden mit klarer Quelle angezeigt; nicht gesetzte Policies fallen auf Settings/Supplier zurueck statt irrefuehrender `0`.
14. FX in Settings ist vereinheitlicht: `USD je EUR` editierbar, `EUR je USD` read-only abgeleitet.
15. V2-Formen zeigen keine sichtbaren Doppelrahmen mehr in AntD-Modals/Inputs.
16. Kollaboration v3: Settings speichern auto on blur/change (kein manueller Block-Save), Realtime-Push triggert unmittelbaren Pull in anderen Sessions.
17. Kollaboration v3: Products/PO/FO/Suppliers zeigen bei Dual-Modal einen Rollenbanner (`Editor` vs `Lesemodus`) und erlauben kontrollierte `Bearbeitung uebernehmen`.
18. Kollaboration v3: Modal-Entwuerfe werden live gespiegelt; finaler Persist bleibt explizit auf `OK`.
19. Kollaboration v3: Presence-Hinweise verwenden zentral gepflegte Anzeigenamen (`Settings -> Team Anzeige-Namen`) mit E-Mail-Fallback.

## Akzeptanz gegen Kriterien
1. `0 Blocker`: PASS.
2. `0 High ohne Workaround`: PASS.
3. `npm run build`: PASS.
4. `npm run test:parity`: PASS.
5. Medium/Low-Reste dokumentiert: PASS (siehe `docs/ui-reset-findings.md`).

## Kollaboration Smoke (2 Browser)
1. Browser A fokussiert Feld in Settings -> Browser B sieht orange Presence inkl. Name/E-Mail.
2. Browser A aendert `Air (Tage)` -> Browser B sieht Wert ohne Tab-Wechsel.
3. Browser A oeffnet Produkt-Modal -> Browser B oeffnet gleiches Produkt und startet in Lesemodus mit Hinweisbanner.
4. Browser B klickt `Bearbeitung uebernehmen` -> Rollen wechseln sichtbar in beiden Modals.
5. Browser A tippt in Modal-Feld -> Browser B sieht Draft-Wert live markiert; `OK` persistiert final fuer beide.
