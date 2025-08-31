# Amazon FBA · Cashflow Planung (Phase 1, static, local-first)

Technik: Rein statisch (ES-Modules), keine Build-Tools, keine externen APIs.  
State: `localStorage` Namespace `amazon_fba_cashflow_v1`.  
Export/Import: JSON im Reiter „Export/Import“.  
Sync: Schnittstelle vorbereitet (`src/sync/adapter.js`), noch nicht implementiert.

## Schnellstart
1. Alle Dateien in ein neues GitHub-Repo hochladen.
2. Netlify: Add new site → Import from Git → Repo → Build command leer → Publish directory ".".
3. Deploy. Seite lädt ohne Service Worker. Debug-Panel hilft beim Aufräumen.

## Commit/PR
- Commit: `FBA-0001 feat: initial static modular app (no build tools)`  
- PR-Titel: `FBA-0001: Initial static modular app`
