# Amazon FBA Cashflow

Vite + React App mit V2 Shared-Workspace-Sync auf Supabase (Auth + RPC + Realtime/Presence) und Runtime-Konfiguration ueber `/api/config`.

## Lokal starten

```bash
npm install
npm run dev
```

Die App laeuft standardmaessig auf `http://localhost:5173`.

## Build

```bash
npm run build
```

## Runtime-Konfiguration

Das Frontend liest produktiv keine Supabase-Werte aus `import.meta.env`, sondern ueber den Runtime-Endpoint:

- `GET /api/config`

Serverseitig benoetigte Variablen:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- optional: `REALTIME_ENABLED`
- optional: `PRESENCE_HEARTBEAT_MS`
- optional: `FALLBACK_POLL_MS`
- optional: `EDIT_GRACE_MS`

## Datenbank

Supabase SQL:

- `supabase/schema.sql` (kanonische Gesamtsicht)
- `supabase/migrations/20260210_workspace_sync.sql`
- `supabase/migrations/20260212_client_rpc_auth.sql`
- `supabase/migrations/20260213_rls_realtime_presence.sql`

## Deployment

Vercel-only Deployment und 2-User Workspace Setup sind in `DEPLOY.md` dokumentiert.
