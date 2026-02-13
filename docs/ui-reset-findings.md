# UI-Reset Findings (V2-Only)

## Stand
- Datum: 2026-02-13
- Quelle: reale V2-Abnahme nach Hardening-Pass und Prozess-IA-Umstellung.
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

7. `id`: `V2UX-007`
- `route`: `#/v2/sidebar`
- `severity`: `high`
- `expected`: workflow-orientierte Navigation ohne starke Kontextspruenge zwischen operativ/stammdaten/abschluss.
- `actual-before`: rein modulgetriebene Navigation ohne klaren Prozesspfad.
- `status-now`: **resolved** (Sektionen `Ueberblick`, `Operative Planung`, `Stammdaten`, `Monatsabschluss`, `Mehr / Tools`).

8. `id`: `V2UX-008`
- `route`: `#/v2/inventory`
- `severity`: `high`
- `expected`: Snapshot und Projektion getrennt nutzbar.
- `actual-before`: gemischter vertikaler Multi-Table-Flow in einer Seite.
- `status-now`: **resolved** (Split in `#/v2/inventory/snapshot` und `#/v2/inventory/projektion`).

9. `id`: `V2UX-009`
- `route`: `#/v2/fo`, `#/v2/po`
- `severity`: `medium`
- `expected`: gemeinsamer Bestellkontext mit schnellem FO/PO-Wechsel.
- `actual-before`: getrennte Seiten ohne gemeinsamen Container.
- `status-now`: **resolved** (`#/v2/orders/fo` und `#/v2/orders/po` unter gemeinsamem `Bestellungen`-Container).

10. `id`: `V2UX-010`
- `route`: `#/v2/products`, `#/v2/forecast`
- `severity`: `medium`
- `expected`: Kategorie-Expand/Collapse bleibt pro Modul zwischen Sessions erhalten.
- `actual-before`: Zustand ging nach Reload verloren.
- `status-now`: **resolved** (persistente `UiPrefsV2.byModule[module].expandedCategoryKeys`).

11. `id`: `V2INV-011`
- `route`: `#/v2/inventory/projektion`
- `severity`: `high`
- `expected`: Projektion startet auf letztem Snapshot statt 0-Baseline und zeigt Fallback eindeutig.
- `actual-before`: Default-Anker lief oft auf `currentMonth` ohne Snapshot, dadurch viele künstliche Negativbestände.
- `status-now`: **resolved** (`resolvedSnapshotMonth` + `snapshotFallbackUsed`, Default auf letzten Snapshot).

12. `id`: `V2INV-012`
- `route`: `#/v2/inventory/projektion`
- `severity`: `high`
- `expected`: Risiken und Inbound-Herkunft (PO/FO) je Monat klar sichtbar.
- `actual-before`: Leerspalte `Bestandsverlauf`, Inbound nur aggregiert als `+X in` ohne PO/FO-Trennung.
- `status-now`: **resolved** (Ankerbestand/Safety/Coverage-Spalten, Risikoampel, getrennte PO/FO-Inbound-Marker mit Detail-Popover).

13. `id`: `V2INV-013`
- `route`: `#/v2/inventory/projektion` -> `#/v2/orders/*`
- `severity`: `high`
- `expected`: Zellklick soll direkt in FO/PO-Anlage mit Prefill führen.
- `actual-before`: Kein direkter Hand-off aus der Projektion in Bestellungen.
- `status-now`: **resolved** (Risikozellen öffnen Bestellassistent; `orders/fo` und `orders/po` parsen URL-Intent und öffnen Create-Modal mit Prefill).

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
