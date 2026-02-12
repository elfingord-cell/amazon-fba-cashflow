# Parity Matrix V2

Stand: 2026-02-12

## Statuslegende
- `automated`: automatisiert in `node:test` abgedeckt
- `partial`: teilweise automatisiert, Rest als manuelle Smoke/E2E-Pruefung offen
- `pending`: noch nicht automatisiert

## Kriterien
| # | Kriterium | Status | Abdeckung |
|---|---|---|---|
| 1 | JSON Dry-Run zeigt vollständige Statistik und ist reproduzierbar | automated | `tests/v2/migration.parity.test.cjs` (`migration dry-run: report is reproducible ...`) |
| 2 | JSON-Apply `replace_workspace` ergibt exakt gemappten Zielstate | automated | `tests/v2/migration.parity.test.cjs` (`migration apply: replace_workspace ...`) |
| 3 | JSON-Apply `merge_upsert` ueberschreibt keine geschuetzten Felder unerwartet | automated | `tests/v2/migration.parity.test.cjs` (`migration apply: merge_upsert ...`) |
| 4 | Import mit partiell defekten Daten importiert verwertbare Datensätze und reportet Rest | automated | `tests/v2/migration.parity.test.cjs` (`migration dry-run: partial defects ...`) |
| 5 | PO/FO Zahlungslogik liefert gleiche Summen wie Legacy | partial | `src/domain/outflowStack.test.js`, `src/domain/foSuggestion.test.js` |
| 6 | Dashboard Plan/Ist-Werte stimmen gegen Referenzdaten | automated | `src/domain/parity.golden.test.js` (Test `dashboard plan/ist`) |
| 7 | Inventory-Projektion (Units/DOH) stimmt gegen Golden Cases | automated | `src/domain/parity.golden.test.js`, `src/domain/inventoryProjection.test.js` |
| 8 | USt-Vorschau-Rechnung stimmt gegen Golden Cases | automated | `src/domain/parity.golden.test.js`, `src/domain/vatPreview.test.js` |
| 9 | Multi-User Rollen, Login/Logout, Session-Recovery | automated | `tests/v2/auth-session.parity.test.mjs` |
| 10 | Sync-Konfliktfall: Reload/Export/Overwrite Ende-zu-Ende | automated | `tests/v2/sync.parity.test.cjs` (`conflict flow ...`) |
| 11 | Offline-Fallback und Re-Sync nach Reconnect | automated | `tests/v2/sync.parity.test.cjs` (`offline fallback ...`) |
| 12 | Payments Export CSV/PDF enthält konsistente Summen/Status | automated | `tests/v2/payments-export.parity.test.cjs` |
| 13 | Performance bei grosser Produkt-/Forecast-Tabelle bleibt interaktiv | automated | `tests/v2/performance.parity.test.cjs` |
| 14 | Responsiveness zentrale Flows Desktop/Mobile | pending | visuelle/interaction Smoke offen |

## Golden Dataset
- Referenzstate: `src/domain/fixtures/parityGoldenState.js`
- Golden-Assertions: `src/domain/parity.golden.test.js`

## Testprofil
- Paritaetslauf (stabil, ohne bekannte Alt-Failures): `npm run test:parity`
- Migrationsteil einzeln: `npm run test:parity:migration`
- Sync/Auth einzeln: `npm run test:parity:sync`
- Payments Export einzeln: `npm run test:parity:payments`
- Performance einzeln: `npm run test:parity:performance`
