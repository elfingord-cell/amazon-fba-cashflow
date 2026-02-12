# DB Sync Setup (Direkt gegen Supabase)

## 1) Supabase vorbereiten

1. Neues Supabase Projekt erstellen.
2. SQL aus beiden Migrationen im SQL Editor ausfuehren:
   - `supabase/migrations/20260210_workspace_sync.sql`
   - `supabase/migrations/20260212_client_rpc_auth.sql`
3. Einen Workspace und den Owner-User anlegen:

```sql
insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Main Workspace')
on conflict (id) do nothing;

insert into workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-0000-000000000001', '<OWNER_USER_ID>', 'owner')
on conflict (workspace_id, user_id) do update set role = excluded.role;
```

4. Zweiten User als Editor eintragen:

```sql
insert into workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-0000-000000000001', '<EDITOR_USER_ID>', 'editor')
on conflict (workspace_id, user_id) do update set role = excluded.role;
```

`<OWNER_USER_ID>` und `<EDITOR_USER_ID>` bekommst du in Supabase Auth Users.

## 2) Client Env Vars setzen (Vite)

- `VITE_SYNC_BACKEND=db`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Damit funktioniert Login + Shared Sync direkt aus dem Browser (z. B. bei Vercel oder Netlify Static Hosting), ohne Netlify Functions als Pflicht-Komponente.

## 3) Deployment-Hinweise

- Stelle sicher, dass die drei `VITE_*` Variablen im Deployment gesetzt sind.
- In Supabase Auth sollte deine Deployment-Domain unter `Site URL` / Redirects erlaubt sein (wichtig fuer Magic Link).
- Bei mehreren Workspaces wird ohne explizite Auswahl der erste Membership-Workspace verwendet.

## 4) Optional: bestehende JSON einmalig importieren

Die App publisht den lokalen Stand automatisch in den Shared State, sobald ein Workspace vorhanden ist. Ein separater Import-Endpunkt ist damit in der Regel nicht noetig.

## 5) Backend-Fallback

- `VITE_SYNC_BACKEND=db` -> Supabase Auth + Supabase RPC Sync
- `VITE_SYNC_BACKEND=blobs` -> altes Blob-Verhalten (`state-get`, `state-put`)

So kannst du bei Problemen jederzeit auf Blob-Sync zurueckschalten.
