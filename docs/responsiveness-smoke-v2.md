# Responsiveness Smoke V2

Stand: 2026-02-12

## Ziel
- Nachweis fuer die zentralen V2-Flows auf Desktop und Mobile.
- Trennung zwischen automatisierbaren CLI-Smokes und visuellen Interaktionschecks.

## Gepruefter Umfang
- `#v2/dashboard`
- `#v2/products` (inkl. Edit-Modal)
- `#v2/forecast`
- `#v2/inventory`
- `#v2/payments-export`

## CLI-Smoke (ausgefuehrt)
- `npm run test:parity:responsive` -> PASS
- `npx tsc --noEmit` -> PASS

## Manuelle Viewport-Checkliste (auszufuehren im Browser)
- Desktop `>= 1280px`: Sider sichtbar, Header einzeilig, Tabellen horizontal scrollbar falls noetig.
- Tablet `~1024px`: Header zweizeilig erlaubt, keine abgeschnittenen Bedien-Elemente.
- Mobile `<= 430px`: Navigation ueber Drawer-Button oeffnen/schliessen, Toolbar-Elemente umbrechen ohne Ueberlauf.
- Products-Modal auf Mobile: Formularzeilen einspaltig, alle Felder erreichbar.
- Forecast/Inventory Toolbars: Inputs/Buttons umbrechen, keine unbedienbaren Controls.
- Payments Export: Monats-/Scope-/Format-Felder umbrechen, Export-Buttons sichtbar bedienbar.

## Ergebnis
- Automatisierter Responsiveness-Smoke ist gruen.
- Visueller Browser-Check bleibt bewusst als manueller Abnahmeschritt offen.
