# UI-Reset Acceptance Matrix (V2-Only)

## Stand
- Datum: 2026-02-13
- Basis: reale V2-Tab-Abnahme, V2-only Hardening-Pass und technischer Verify-Lauf.
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
| `#/v2/products` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/forecast` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/inventory` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/fo` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/po` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/suppliers` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/settings` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/inputs` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/fixcosts` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/vat` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/payments-export` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/accounting-export` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/export-import` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/plan` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/debug` | PASS | PASS | PASS | PASS | PASS | PASS |

## Hotspot-Abnahme (V2)
1. Doppelrahmen in Tabellen entfernt: `TanStackGrid` + AntD Table auf Single-Frame harmonisiert.
2. Technische Titelsuffixe (`(V2)`, `(V2 Native)`) entfernt.
3. PO/Suppliers Actions auf `nowrap` und ausreichende Spaltenbreiten gestellt.
4. Inventory DOH-Spalten verschlankt und Table-Layout stabilisiert.
5. Fixkosten mit globalen Expand/Collapse-Aktionen (`Alles auf` / `Alles zu`) versehen.

## Akzeptanz gegen Kriterien
1. `0 Blocker`: PASS.
2. `0 High ohne Workaround`: PASS.
3. `npm run build`: PASS.
4. `npm run test:parity`: PASS.
5. Medium/Low-Reste dokumentiert: PASS (siehe `docs/ui-reset-findings.md`).
