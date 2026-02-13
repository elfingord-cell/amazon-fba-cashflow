# DB Sync Supabase (V2 Shared Workspace)

Die V2 nutzt Supabase als Shared-Workspace-Backend mit:

- Auth (Email/Password)
- RPC fuer Bootstrap/Sync
- Realtime + Presence fuer Live-Updates und Soft-Lock Hinweise
- RLS auf allen Shared-Tabellen

## Relevante SQL Dateien

- `supabase/schema.sql` (kanonischer Vollstand)
- `supabase/migrations/20260210_workspace_sync.sql`
- `supabase/migrations/20260212_client_rpc_auth.sql`
- `supabase/migrations/20260213_rls_realtime_presence.sql`

## Runtime-Konfiguration

Die App laedt Supabase-Konfig produktiv aus:

- `GET /api/config`

Noetige Server-Variablen:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Optional:

- `REALTIME_ENABLED`
- `PRESENCE_HEARTBEAT_MS`
- `FALLBACK_POLL_MS`
- `EDIT_GRACE_MS`

Vollstaendige Deploy- und Seed-Anleitung siehe `DEPLOY.md`.
