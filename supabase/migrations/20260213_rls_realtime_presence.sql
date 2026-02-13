create extension if not exists "pgcrypto";

create or replace function app_is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  )
$$;

create or replace function app_workspace_role(p_workspace_id uuid)
returns text
language sql
stable
as $$
  select wm.role
  from workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid()
  limit 1
$$;

create or replace function app_can_edit_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(app_workspace_role(p_workspace_id), '') in ('owner', 'editor')
$$;

create or replace function app_is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(app_workspace_role(p_workspace_id), '') = 'owner'
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'workspace_meta',
    'workspace_state',
    'settings',
    'product_categories',
    'suppliers',
    'products',
    'pos',
    'po_items',
    'fos',
    'payments',
    'forecast_manual',
    'forecast_import',
    'incomings',
    'extras',
    'fixcosts',
    'fixcost_overrides',
    'dividends',
    'monthly_actuals',
    'inventory_snapshots'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop trigger if exists trg_%1$s_set_updated_at on %1$I', v_table);
    execute format('create trigger trg_%1$s_set_updated_at before update on %1$I for each row execute function set_updated_at()', v_table);
  end loop;
end
$$;

do $$
declare
  v_table text;
  v_workspace_tables text[] := array[
    'workspace_meta',
    'workspace_state',
    'change_log',
    'settings',
    'product_categories',
    'suppliers',
    'products',
    'pos',
    'po_items',
    'fos',
    'payments',
    'forecast_manual',
    'forecast_import',
    'incomings',
    'extras',
    'fixcosts',
    'fixcost_overrides',
    'dividends',
    'monthly_actuals',
    'inventory_snapshots'
  ];
begin
  execute 'alter table workspaces enable row level security';
  execute 'alter table workspace_members enable row level security';

  foreach v_table in array v_workspace_tables loop
    execute format('alter table %I enable row level security', v_table);
  end loop;
end
$$;

-- workspaces policies
drop policy if exists workspaces_read_member on workspaces;
drop policy if exists workspaces_insert_authenticated on workspaces;
drop policy if exists workspaces_update_owner on workspaces;
drop policy if exists workspaces_delete_owner on workspaces;

create policy workspaces_read_member
  on workspaces
  for select
  using (app_is_workspace_member(id));

create policy workspaces_insert_authenticated
  on workspaces
  for insert
  with check (auth.uid() is not null and (created_by is null or created_by = auth.uid()));

create policy workspaces_update_owner
  on workspaces
  for update
  using (app_is_workspace_owner(id))
  with check (app_is_workspace_owner(id));

create policy workspaces_delete_owner
  on workspaces
  for delete
  using (app_is_workspace_owner(id));

-- workspace_members policies
drop policy if exists workspace_members_read_member on workspace_members;
drop policy if exists workspace_members_manage_owner on workspace_members;

create policy workspace_members_read_member
  on workspace_members
  for select
  using (app_is_workspace_member(workspace_id));

create policy workspace_members_manage_owner
  on workspace_members
  for all
  using (app_is_workspace_owner(workspace_id))
  with check (app_is_workspace_owner(workspace_id));

-- shared workspace policies

do $$
declare
  v_table text;
  v_tables text[] := array[
    'workspace_meta',
    'workspace_state',
    'change_log',
    'settings',
    'product_categories',
    'suppliers',
    'products',
    'pos',
    'po_items',
    'fos',
    'payments',
    'forecast_manual',
    'forecast_import',
    'incomings',
    'extras',
    'fixcosts',
    'fixcost_overrides',
    'dividends',
    'monthly_actuals',
    'inventory_snapshots'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop policy if exists %1$s_read_member on %1$I', v_table);
    execute format('drop policy if exists %1$s_insert_editor on %1$I', v_table);
    execute format('drop policy if exists %1$s_update_editor on %1$I', v_table);
    execute format('drop policy if exists %1$s_delete_editor on %1$I', v_table);

    execute format(
      'create policy %1$s_read_member on %1$I for select using (app_is_workspace_member(workspace_id))',
      v_table
    );
    execute format(
      'create policy %1$s_insert_editor on %1$I for insert with check (app_can_edit_workspace(workspace_id))',
      v_table
    );
    execute format(
      'create policy %1$s_update_editor on %1$I for update using (app_can_edit_workspace(workspace_id)) with check (app_can_edit_workspace(workspace_id))',
      v_table
    );
    execute format(
      'create policy %1$s_delete_editor on %1$I for delete using (app_can_edit_workspace(workspace_id))',
      v_table
    );
  end loop;
end
$$;

-- grants for authenticated clients (RLS still applies)
grant usage on schema public to authenticated;
grant select, insert, update, delete on workspaces to authenticated;
grant select, insert, update, delete on workspace_members to authenticated;
grant select, insert, update, delete on workspace_meta to authenticated;
grant select, insert, update, delete on workspace_state to authenticated;
grant select, insert, update, delete on change_log to authenticated;
grant select, insert, update, delete on settings to authenticated;
grant select, insert, update, delete on product_categories to authenticated;
grant select, insert, update, delete on suppliers to authenticated;
grant select, insert, update, delete on products to authenticated;
grant select, insert, update, delete on pos to authenticated;
grant select, insert, update, delete on po_items to authenticated;
grant select, insert, update, delete on fos to authenticated;
grant select, insert, update, delete on payments to authenticated;
grant select, insert, update, delete on forecast_manual to authenticated;
grant select, insert, update, delete on forecast_import to authenticated;
grant select, insert, update, delete on incomings to authenticated;
grant select, insert, update, delete on extras to authenticated;
grant select, insert, update, delete on fixcosts to authenticated;
grant select, insert, update, delete on fixcost_overrides to authenticated;
grant select, insert, update, delete on dividends to authenticated;
grant select, insert, update, delete on monthly_actuals to authenticated;
grant select, insert, update, delete on inventory_snapshots to authenticated;

-- Realtime publication for workspace shared sync
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'workspace_state',
    'workspace_meta',
    'settings',
    'product_categories',
    'suppliers',
    'products',
    'pos',
    'po_items',
    'fos',
    'payments',
    'forecast_manual',
    'forecast_import',
    'incomings',
    'extras',
    'fixcosts',
    'fixcost_overrides',
    'dividends',
    'monthly_actuals',
    'inventory_snapshots'
  ];
begin
  foreach v_table in array v_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table %I', v_table);
    end if;
  end loop;
end
$$;
