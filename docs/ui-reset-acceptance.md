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

## Akzeptanz gegen Kriterien
1. `0 Blocker`: PASS.
2. `0 High ohne Workaround`: PASS.
3. `npm run build`: PASS.
4. `npm run test:parity`: PASS.
5. Medium/Low-Reste dokumentiert: PASS (siehe `docs/ui-reset-findings.md`).
