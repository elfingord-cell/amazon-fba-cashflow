# V2 Clean UI Skin

## Zweck
- Der neue V2-Look wird ueber `settings.featureFlags.cleanUiV2` gesteuert.
- Fokus: Design-Update, keine Engine- oder Datenlogik-Aenderung.

## Flag-Verhalten
- `cleanUiV2` fehlt oder `true` -> neuer Clean-Skin aktiv.
- `cleanUiV2: false` -> vorheriger V2-Skin (Fallback) aktiv.

## Beispiel
```json
{
  "settings": {
    "featureFlags": {
      "cleanUiV2": false
    }
  }
}
```

## Technische Umsetzung
- Theme-Umschaltung in `/Users/pierre/Library/CloudStorage/GoogleDrive-pierre.debotmiliau@gmail.com/.shortcut-targets-by-id/1t9g7LuoILhoKYwDrvKSQ9CSVvAGBBLD1/mahona/(24) Softwareprojekte/(01) Amazon FBA Cashflow/amazon-fba-cashflow/src/v2/app/StandaloneV2App.tsx`.
- Layout-Scope ueber `data-v2-skin` in `/Users/pierre/Library/CloudStorage/GoogleDrive-pierre.debotmiliau@gmail.com/.shortcut-targets-by-id/1t9g7LuoILhoKYwDrvKSQ9CSVvAGBBLD1/mahona/(24) Softwareprojekte/(01) Amazon FBA Cashflow/amazon-fba-cashflow/src/v2/app/V2Shell.tsx`.
- Clean-Overrides in `/Users/pierre/Library/CloudStorage/GoogleDrive-pierre.debotmiliau@gmail.com/.shortcut-targets-by-id/1t9g7LuoILhoKYwDrvKSQ9CSVvAGBBLD1/mahona/(24) Softwareprojekte/(01) Amazon FBA Cashflow/amazon-fba-cashflow/src/v2/app/v2-shell.css`.
- Gemeinsame Chart-Palette in `/Users/pierre/Library/CloudStorage/GoogleDrive-pierre.debotmiliau@gmail.com/.shortcut-targets-by-id/1t9g7LuoILhoKYwDrvKSQ9CSVvAGBBLD1/mahona/(24) Softwareprojekte/(01) Amazon FBA Cashflow/amazon-fba-cashflow/src/v2/app/chartPalette.ts`.

## Incident-Fallback
1. `settings.featureFlags.cleanUiV2` auf `false` setzen.
2. V2-Tab neu laden.
3. Verifizieren, dass Layout und Controls wieder im alten V2-Skin erscheinen.
