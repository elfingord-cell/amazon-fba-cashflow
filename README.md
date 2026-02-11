# Amazon FBA Cashflow

Vite + React Frontend mit Netlify Functions als BFF.

## Lokal starten

```bash
npm install
npm run dev
```

Vite startet standardmaessig auf `http://localhost:5173`.

## Build

```bash
npm run build
```

`netlify.toml` nutzt:

- Build command: `npm run build`
- Publish dir: `dist`

## Sync Backends

Per Env steuerbar:

- `VITE_SYNC_BACKEND=blobs` (legacy Blob snapshot sync)
- `VITE_SYNC_BACKEND=db` (Supabase DB sync)
- optional serverseitig: `SYNC_BACKEND=db`

## Supabase DB Sync Setup

Details in:

- `docs/db-sync-supabase.md`
- `supabase/migrations/20260210_workspace_sync.sql`
