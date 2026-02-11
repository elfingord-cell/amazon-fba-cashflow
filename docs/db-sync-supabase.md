# DB Sync Migration (Supabase + Netlify Functions)

## 1) Supabase vorbereiten

1. Neues Supabase Projekt erstellen.
2. SQL aus `supabase/migrations/20260210_workspace_sync.sql` im SQL Editor ausfuehren.
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

## 2) Netlify Env Vars setzen

Server-seitig (Functions):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SYNC_BACKEND=db` (optional auch `VITE_SYNC_BACKEND=db`)

Client-seitig (Vite):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3) Optional: bestehende JSON einmalig importieren

1. In der App JSON exportieren.
2. Mit Auth-Token einen POST auf `/.netlify/functions/db-migrate-import` senden:

```json
{
  "state": { "...": "bestehender App State" }
}
```

Die Function schreibt den Snapshot in `workspace_state`, incrementiert `rev` und materialisiert die normalisierten Tabellen.

## 4) Backend-Fallback

- `VITE_SYNC_BACKEND=db` -> neue DB Endpunkte (`db-bootstrap`, `db-sync`)
- `VITE_SYNC_BACKEND=blobs` -> altes Blob-Verhalten (`state-get`, `state-put`)

So kannst du bei Problemen jederzeit auf Blob-Sync zurueckschalten.
