# UI-Reset Acceptance Matrix (Legacy + V2)

## Stand
- Datum: 2026-02-12
- Basis: reale Tab-Abnahme (Screenshots + UI-Hardening-Pass) und technischer Verify-Lauf.
- Scope: Layoutbreite, Table-Shell, Header/Row-Dichte, Scroll-Verhalten, Sticky-Spalten, Action-Buttons.

## Prueffelder
- `Layout`: konsistente constrained Content-Breite, kein routeweises Vollbreit-Springen.
- `Controls`: einheitliche Input/Button/Checkbox-Dichte.
- `Table-Shell`: einheitliche Rahmen, Header-Hintergruende, Row-Height.
- `H-Scroll`: native dezente horizontale Scrollbars als Default.
- `Sticky`: keine Ueberlappung oder visueller Gap an Sticky-Seams.

## Legacy Matrix
| Route | Layout | Controls | Table-Shell | H-Scroll | Sticky | Ergebnis |
|---|---|---|---|---|---|---|
| `#dashboard` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#produkte` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#forecast` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#inventory` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#fo` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#po` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#suppliers` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#settings` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#eingaben` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#fixkosten` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#ust` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#payments-export` | PASS | PASS | PASS | PASS | N/A | PASS |

## V2 Matrix
| Route | Layout | Controls | Table-Shell | H-Scroll | Sticky | Ergebnis |
|---|---|---|---|---|---|---|
| `#/v2/dashboard` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/products` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/forecast` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/inventory` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/fo` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/po` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/suppliers` | PASS | PASS | PASS | PASS | PASS | PASS |
| `#/v2/settings` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#/v2/inputs` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#/v2/fixcosts` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#/v2/vat` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#/v2/payments-export` | PASS | PASS | PASS | PASS | N/A | PASS |
| `#/v2/export-import` | PASS | PASS | PASS | PASS | N/A | PASS |

## Spezifische Hotspots
1. Forecast Sticky Gap: behoben (`data-sticky-owner="manual"` + explizite seam/width-Regeln).
2. Dashboard Zell-Ueberlappung: behoben (feste Spaltenbreiten + tree-cell overflow/ellipsis).
3. Inventory Snapshot/Projection Overlap: behoben (getrennte Sticky-Offsets je Tabelle).
4. PO Actions rechts abgeschnitten: behoben (breitere Actions-Spalte + nowrap actions).
5. Suppliers Actions untereinander: behoben (`ui-table-actions-nowrap`, kompakte Buttons).

## Akzeptanz gegen Kriterien
1. `0 Blocker`: PASS.
2. `0 High ohne Workaround`: PASS.
3. `Build grün`: PASS.
4. `Parity-Suiten grün`: PASS.
5. `Medium/Low dokumentiert`: PASS (siehe Findings-Dokument).
