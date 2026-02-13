# UI-Reset Findings (V2-Only)

## Stand
- Datum: 2026-02-13
- Quelle: reale V2-Abnahme nach dem Hardening-Pass.
- Schema: `id`, `route`, `severity`, `expected`, `actual-before`, `status-now`.

## Blocker/High
- Keine offenen Blocker.
- Keine offenen High-Issues.

## Resolved Findings
1. `id`: `V2UI-001`
- `route`: `#/v2/*`
- `severity`: `high`
- `expected`: pro Tabelle nur ein sichtbarer Rahmen (Single-Frame).
- `actual-before`: gemischte Legacy/V2-Wrapper erzeugten doppelte graue Rahmen.
- `status-now`: **resolved** (V2-only Wrapper-Contract, TanStackGrid/AntD harmonisiert).

2. `id`: `V2UI-002`
- `route`: `#/v2/*`
- `severity`: `medium`
- `expected`: keine technischen Titeltexte in der UI.
- `actual-before`: mehrere Seiten zeigten Suffixe wie `(V2)` oder `(V2 Native)`.
- `status-now`: **resolved** (Suffixe entfernt, Topbar ohne Seitentitel).

3. `id`: `V2UI-003`
- `route`: `#/v2/po`
- `severity`: `high`
- `expected`: rechte Aktionsspalte komplett sichtbar und klickbar.
- `actual-before`: Actions wurden geclippt oder abgeschnitten.
- `status-now`: **resolved** (breitere Action-Column + `nowrap`).

4. `id`: `V2UI-004`
- `route`: `#/v2/suppliers`
- `severity`: `medium`
- `expected`: Actions in einer Zeile ohne unnoetige Zeilenhoehe.
- `actual-before`: Umbruch in der Actions-Zelle fuehrte zu hohen Zeilen.
- `status-now`: **resolved** (`v2-actions-nowrap`, kompakte Actions).

5. `id`: `V2UI-005`
- `route`: `#/v2/inventory`
- `severity`: `medium`
- `expected`: kompakte, sinnvolle DOH-Spaltenbreiten.
- `actual-before`: DOH-Spalten waren zu breit und wirkten instabil.
- `status-now`: **resolved** (gezielte Breiten + `tableLayout="auto"`).

6. `id`: `V2UI-006`
- `route`: `#/v2/fixcosts`
- `severity`: `medium`
- `expected`: globale Expand/Collapse-Aktionen in einheitlicher Sprache.
- `actual-before`: keine durchgaengigen globalen Expand/Collapse-Actions.
- `status-now`: **resolved** (`Alles auf` / `Alles zu` integriert).

## Offene Low-Risiken
1. `id`: `V2UI-R1`
- `severity`: `low`
- `note`: abschliessender manueller Sichtcheck auf echten 390px/768px Geraeten bleibt sinnvoll (automatisierte Responsive-Parity ist gruen).

2. `id`: `V2UI-R2`
- `severity`: `low`
- `note`: Vite meldet weiterhin Chunk-Size-Warnungen, funktional ohne Einfluss auf UI-Konsolidierung.

## Inkrement-Commit-Saetze
1. `V2-UI-Fundament auf kompakten Single-Frame-Standard umgestellt und TanStackGrid-Contract vereinheitlicht.`
2. `V2-Topbar auf kompakten Modus ohne Seitentitel umgestellt und alle Modul-Titel von technischen Suffixen bereinigt.`
3. `V2-Tabellen auf reinen V2-Wrapper-Contract migriert und Legacy-Style-Mischungen entfernt.`
4. `V2-Toolbars und Controls tabuebergreifend auf einen gemeinsamen kompakten Bedienstandard harmonisiert.`
5. `Kritische V2-Tabellen-Hotspots in PO, Suppliers, Inventory, Fixkosten und VAT auf robuste kompakte Interaktion korrigiert.`
6. `Alle verbleibenden V2-Module auf denselben kompakten Layout-, Tabellen- und Action-Standard vereinheitlicht.`
7. `V2-Responsive- und Scroll-Verhalten auf Desktop und Mobile final geglaettet.`
8. `V2-UI-Abnahme und Go/No-Go-Dokumentation auf reale Befunde aktualisiert und Build/Parity neu verifiziert.`
