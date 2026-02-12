# UI-Reset Findings (Legacy + V2)

## Stand
- Datum: 2026-02-12
- Quelle: reale Tab-Befunde aus den bereitgestellten Screenshots + Nachfixes im UI-Hardening-Pass.
- Schema: `id`, `route`, `severity`, `expected`, `actual-before`, `status-now`.

## Batch A (Blocker / High)
- Keine offenen Blocker oder High-Issues.

## Batch B (Medium / Low)

1. `id`: `UIR3-001`
- `route`: `#dashboard`
- `severity`: `medium`
- `expected`: keine Label/Zell-Ueberlappung zwischen Tree-Spalte und erstem Monatsfeld.
- `actual-before`: `Amazon Auszahlungen` ragte visuell in die erste Monatszelle.
- `status-now`: **resolved** (feste Tree-/Monatsspalten + overflow/ellipsis + manuelles Sticky-Ownering).

2. `id`: `UIR3-002`
- `route`: `#forecast`
- `severity`: `high`
- `expected`: kein weisser Gap zwischen erster Sticky-Spalte und erstem Monatsfeld.
- `actual-before`: sichtbarer Spalt an der Sticky-Seam.
- `status-now`: **resolved** (`manual` sticky owner + Forecast-spezifische Seam- und Width-Regeln).

3. `id`: `UIR3-003`
- `route`: `#inventory`
- `severity`: `high`
- `expected`: keine Header/Cell-Ueberlappung in Snapshot/Projection, kompakte DOH-Spalten.
- `actual-before`: Ueberlappungen (`Amazon Units`) und ueberbreite `Safety/Coverage DOH`.
- `status-now`: **resolved** (separate Sticky-Offset-Vertraege fuer Snapshot/Projection, DOH-Spalten verschlankt).

4. `id`: `UIR3-004`
- `route`: `#po`
- `severity`: `high`
- `expected`: rechte Actions komplett sichtbar und erreichbar beim horizontalen Scroll.
- `actual-before`: Actions rechts abgeschnitten/ellipsed.
- `status-now`: **resolved** (Actions-Spalte verbreitert, nowrap Actions, clipping entfernt).

5. `id`: `UIR3-005`
- `route`: `#suppliers`
- `severity`: `medium`
- `expected`: Actions nebeneinander, normale Zeilenhoehe.
- `actual-before`: Action-Buttons untereinander, dadurch hohe Zeilen.
- `status-now`: **resolved** (`ui-table-actions-nowrap` + kompakte `sm` Buttons).

6. `id`: `UIR3-006`
- `route`: `#produkte`
- `severity`: `medium`
- `expected`: kompakte Toolbar ohne ueberlange volle Input-Zeilen; native dezentes Scroll.
- `actual-before`: Filterfelder wirkten plump/untereinander; custom dual scroll rails.
- `status-now`: **resolved** (Toolbar-Feldbreiten begrenzt, native Scroll-Default ohne dual custom rails).

7. `id`: `UIR3-007`
- `route`: `#ust`
- `severity`: `low`
- `expected`: Bearbeiten-Action im gleichen sichtbaren Button-Stil wie andere Tabellen.
- `actual-before`: Action wirkte randlos bis Hover.
- `status-now`: **resolved** (`btn secondary sm`).

## Rest-Risiken
1. `UIR3-R1` (low): Modal-Close/Reset-Buttons nutzen teils weiter `ghost`; funktional korrekt, aber visuell bewusst leichter als Primaraktionen.
2. `UIR3-R2` (low): Endgueltige Feinabnahme auf echten 390px/768px Screens bleibt als manueller letzter Sichtcheck sinnvoll.

## Batch-Commit-Saetze
1. `Globale UI-Basistokens und Form-/Table-Contracts vereinheitlicht, inklusive kompakter Dichte und konsistenter Checkbox-Steuerung.`
2. `Legacy-Topbar auf Single-Title-Prinzip umgestellt, sodass Seitentitel nur noch im Inhaltsbereich erscheinen.`
3. `Dashboard auf den kompakten UI-Standard umgestellt und die Zell-/Sticky-Ueberlappung in der Haupttabelle beseitigt.`
4. `Forecast-Tree-Table stabilisiert, den Sticky-Gap entfernt und die Toolbar auf den gemeinsamen Kompaktstandard gebracht.`
5. `Inventory-, PO- und Suppliers-Tabellenlayout korrigiert: Sticky-Offsets, Aktionsspalten und Zeilenhoehe jetzt konsistent und vollstaendig nutzbar.`
6. `Alle verbleibenden Legacy-Tabs auf einen gemeinsamen Kompakt-UI-Standard mit einheitlichen Controls, Tabellen und Aktionen konsolidiert.`
7. `V2-Shell und TanStack-Tabellen auf denselben Kompakt- und Table-Standard wie Legacy harmonisiert.`
8. `UI-Reset-Abnahme auf reale Tab-Befunde aktualisiert und Build/Parity als Go-No-Go-Nachweis neu verifiziert.`
