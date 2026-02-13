# DEPLOY (Vercel + Supabase Shared Workspace)

## 1) Supabase vorbereiten

1. Supabase Projekt erstellen.
2. Im SQL Editor nacheinander ausfuehren:
   - `supabase/migrations/20260210_workspace_sync.sql`
   - `supabase/migrations/20260212_client_rpc_auth.sql`
   - `supabase/migrations/20260213_rls_realtime_presence.sql`
3. Optional stattdessen alles in einem Schritt:
   - `supabase/schema.sql`

## 2) Auth Users anlegen

In Supabase Auth zwei Benutzer anlegen (Owner + Editor), z. B.:

- `owner@example.com`
- `editor@example.com`

Die `user_id` (UUID) aus der Auth-Userliste notieren.

## 3) Workspace + Membership seeden

Beispiel-SQL:

```sql
insert into workspaces (id, name, created_by)
values ('00000000-0000-0000-0000-000000000001', 'Main Workspace', '<OWNER_USER_ID>'::uuid)
on conflict (id) do update set name = excluded.name;

insert into workspace_members (workspace_id, user_id, role)
values
  ('00000000-0000-0000-0000-000000000001', '<OWNER_USER_ID>'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000001', '<EDITOR_USER_ID>'::uuid, 'editor')
on conflict (workspace_id, user_id) do update
set role = excluded.role;
```

## 4) Vercel Projekt einrichten

1. Repo in Vercel importieren.
2. Build Settings:
   - Framework: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. `vercel.json` ist bereits vorbereitet (SPA rewrites + API route).

## 5) Vercel Env Vars setzen

Pflicht:

- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_ANON_KEY=<anon-key>`

Optional:

- `REALTIME_ENABLED=true`
- `PRESENCE_HEARTBEAT_MS=20000`
- `FALLBACK_POLL_MS=15000`
- `EDIT_GRACE_MS=1200`

## 6) Supabase Auth Redirects

In Supabase Auth:

- `Site URL` auf deine Vercel-Produktionsdomain setzen.
- Preview-Domains (falls genutzt) als Additional Redirect URLs eintragen.

## 7) Runtime-Config validieren

Nach Deploy:

1. `https://<deine-domain>/api/config` aufrufen.
2. Erwartet wird JSON mit:
   - `syncBackend: "db"`
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `realtimeEnabled`
   - `presenceHeartbeatMs`
   - `fallbackPollMs`
   - `editGraceMs`

## 8) Einmaliger Import (wenn lokal Daten vorhanden)

Wenn ein User mit bestehendem lokalen Browser-State erstmalig in einen leeren Workspace einsteigt, erscheint ein einmaliger Import-Dialog.

- `OK` => lokaler Stand wird initial nach Supabase geschrieben.
- `Abbrechen` => kein Import, Marker verhindert Wiederholung im selben Browser.

## 9) Smoke-Test (2 Browser Sessions)

1. Browser A mit Owner anmelden.
2. Browser B mit Editor anmelden.
3. Beide sehen denselben Workspace.
4. In A Feld fokussieren (z. B. Produkt bearbeiten) -> in B erscheint Presence-Hinweis.
5. In A speichern -> B aktualisiert automatisch (Realtime).
6. In B Netz kurz trennen -> Fallback-Polling uebernimmt, nach Reconnect wieder Realtime.
7. User ohne Membership:
   - Login funktioniert.
   - UI zeigt `no_access`.
   - Kein Shared-Write moeglich.

## 10) Sicherheitshinweise

- Kein `service_role` Key im Frontend.
- Frontend nutzt nur `SUPABASE_URL` + `SUPABASE_ANON_KEY` via `/api/config`.
- Tabellenzugriff ist durch RLS und Workspace-Membership eingeschraenkt.
