create extension if not exists "pgcrypto";

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members(user_id);

create table if not exists workspace_meta (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  rev text null,
  updated_at timestamptz null,
  updated_by uuid null
);

create table if not exists workspace_state (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

create table if not exists change_log (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity text not null,
  entity_id text null,
  op text not null,
  changed_by uuid null,
  changed_at timestamptz not null default now(),
  payload jsonb null
);

create index if not exists change_log_workspace_changed_at_idx
  on change_log(workspace_id, changed_at desc);

create table if not exists settings (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists product_categories (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists suppliers (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists products (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists pos (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists po_items (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists fos (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists payments (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists forecast_manual (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists forecast_import (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists incomings (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists extras (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists fixcosts (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists fixcost_overrides (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists dividends (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists monthly_actuals (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create table if not exists inventory_snapshots (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_id)
);

create or replace function app_member_role(p_workspace_id uuid, p_user_id uuid)
returns text
language sql
stable
as $$
  select wm.role
  from workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
  limit 1
$$;

create or replace function app_auth_session(p_user_id uuid)
returns table (
  workspace_id uuid,
  role text
)
language sql
stable
as $$
  select wm.workspace_id, wm.role
  from workspace_members wm
  where wm.user_id = p_user_id
  order by
    case wm.role when 'owner' then 0 when 'editor' then 1 else 99 end asc,
    wm.created_at asc
  limit 1
$$;

create or replace function app_bootstrap(p_workspace_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_state jsonb := '{}'::jsonb;
  v_rev text := null;
  v_updated_at timestamptz := null;
  v_exists boolean := false;
begin
  v_role := app_member_role(p_workspace_id, p_user_id);
  if v_role is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NOT_A_MEMBER'
    );
  end if;

  select ws.state_json, ws.updated_at
    into v_state, v_updated_at
  from workspace_state ws
  where ws.workspace_id = p_workspace_id;

  if found then
    v_exists := true;
  end if;

  select wm.rev, coalesce(wm.updated_at, v_updated_at)
    into v_rev, v_updated_at
  from workspace_meta wm
  where wm.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'exists', v_exists,
    'state', v_state,
    'rev', v_rev,
    'updatedAt', v_updated_at,
    'role', v_role
  );
end;
$$;

create or replace function app_materialize_state(
  p_workspace_id uuid,
  p_state jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_counts jsonb := '{}'::jsonb;
begin
  delete from settings where workspace_id = p_workspace_id;
  insert into settings (workspace_id, entity_id, payload, updated_at)
  values (
    p_workspace_id,
    'settings',
    case
      when jsonb_typeof(p_state->'settings') = 'object' then p_state->'settings'
      else '{}'::jsonb
    end,
    p_now
  );
  v_counts := v_counts || jsonb_build_object('settings', 1);

  delete from product_categories where workspace_id = p_workspace_id;
  insert into product_categories (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'productCategories') = 'array' then p_state->'productCategories'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('product_categories', v_count);

  delete from suppliers where workspace_id = p_workspace_id;
  insert into suppliers (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'name', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'suppliers') = 'array' then p_state->'suppliers'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('suppliers', v_count);

  delete from products where workspace_id = p_workspace_id;
  insert into products (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'sku', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'products') = 'array' then p_state->'products'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('products', v_count);

  delete from pos where workspace_id = p_workspace_id;
  insert into pos (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'poNumber', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'pos') = 'array' then p_state->'pos'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('pos', v_count);

  delete from po_items where workspace_id = p_workspace_id;
  insert into po_items (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(po.value->>'id', ''), 'po-' || po.ordinality::text)
      || '-item-' || line.ordinality::text,
    line.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'pos') = 'array' then p_state->'pos'
      else '[]'::jsonb
    end
  ) with ordinality as po(value, ordinality)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(po.value->'items') = 'array' then po.value->'items'
      else '[]'::jsonb
    end
  ) with ordinality as line(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('po_items', v_count);

  delete from fos where workspace_id = p_workspace_id;
  insert into fos (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'foNumber', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'fos') = 'array' then p_state->'fos'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('fos', v_count);

  delete from payments where workspace_id = p_workspace_id;
  insert into payments (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'paymentId', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'payments') = 'array' then p_state->'payments'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('payments', v_count);

  delete from forecast_manual where workspace_id = p_workspace_id;
  insert into forecast_manual (workspace_id, entity_id, payload, updated_at)
  select p_workspace_id, item.key, item.value, p_now
  from jsonb_each(
    case
      when jsonb_typeof(p_state#>'{forecast,forecastManual}') = 'object' then p_state#>'{forecast,forecastManual}'
      else '{}'::jsonb
    end
  ) as item(key, value);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('forecast_manual', v_count);

  delete from forecast_import where workspace_id = p_workspace_id;
  insert into forecast_import (workspace_id, entity_id, payload, updated_at)
  select p_workspace_id, item.key, item.value, p_now
  from jsonb_each(
    case
      when jsonb_typeof(p_state#>'{forecast,forecastImport}') = 'object' then p_state#>'{forecast,forecastImport}'
      else '{}'::jsonb
    end
  ) as item(key, value);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('forecast_import', v_count);

  delete from incomings where workspace_id = p_workspace_id;
  insert into incomings (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'month', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'incomings') = 'array' then p_state->'incomings'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('incomings', v_count);

  delete from extras where workspace_id = p_workspace_id;
  insert into extras (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'month', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'extras') = 'array' then p_state->'extras'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('extras', v_count);

  delete from fixcosts where workspace_id = p_workspace_id;
  insert into fixcosts (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'name', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'fixcosts') = 'array' then p_state->'fixcosts'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('fixcosts', v_count);

  delete from fixcost_overrides where workspace_id = p_workspace_id;
  insert into fixcost_overrides (workspace_id, entity_id, payload, updated_at)
  select p_workspace_id, item.key, item.value, p_now
  from jsonb_each(
    case
      when jsonb_typeof(p_state->'fixcostOverrides') = 'object' then p_state->'fixcostOverrides'
      else '{}'::jsonb
    end
  ) as item(key, value);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('fixcost_overrides', v_count);

  delete from dividends where workspace_id = p_workspace_id;
  insert into dividends (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'month', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state->'dividends') = 'array' then p_state->'dividends'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('dividends', v_count);

  delete from monthly_actuals where workspace_id = p_workspace_id;
  insert into monthly_actuals (workspace_id, entity_id, payload, updated_at)
  select p_workspace_id, item.key, item.value, p_now
  from jsonb_each(
    case
      when jsonb_typeof(p_state->'monthlyActuals') = 'object' then p_state->'monthlyActuals'
      else '{}'::jsonb
    end
  ) as item(key, value);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('monthly_actuals', v_count);

  delete from inventory_snapshots where workspace_id = p_workspace_id;
  insert into inventory_snapshots (workspace_id, entity_id, payload, updated_at)
  select
    p_workspace_id,
    coalesce(nullif(item.value->>'id', ''), nullif(item.value->>'month', ''), 'row') || '-' || item.ordinality::text,
    item.value,
    p_now
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_state#>'{inventory,snapshots}') = 'array' then p_state#>'{inventory,snapshots}'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('inventory_snapshots', v_count);

  return v_counts;
end;
$$;

create or replace function app_sync(
  p_workspace_id uuid,
  p_user_id uuid,
  p_if_match_rev text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_meta workspace_meta%rowtype;
  v_now timestamptz := now();
  v_new_rev text;
  v_counts jsonb := '{}'::jsonb;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_STATE');
  end if;

  v_role := app_member_role(p_workspace_id, p_user_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_MEMBER');
  end if;

  if v_role not in ('owner', 'editor') then
    return jsonb_build_object('ok', false, 'reason', 'WRITE_FORBIDDEN');
  end if;

  insert into workspace_meta (workspace_id, rev, updated_at, updated_by)
  values (p_workspace_id, null, null, null)
  on conflict (workspace_id) do nothing;

  select *
    into v_meta
  from workspace_meta
  where workspace_id = p_workspace_id
  for update;

  if v_meta.rev is not null and p_if_match_rev is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'MISSING_IF_MATCH',
      'currentRev', v_meta.rev,
      'updatedAt', v_meta.updated_at
    );
  end if;

  if v_meta.rev is distinct from p_if_match_rev then
    return jsonb_build_object(
      'ok', false,
      'reason', 'REV_MISMATCH',
      'currentRev', v_meta.rev,
      'updatedAt', v_meta.updated_at
    );
  end if;

  v_new_rev := gen_random_uuid()::text;

  insert into workspace_state (workspace_id, state_json, created_at, updated_at, updated_by)
  values (p_workspace_id, p_state, v_now, v_now, p_user_id)
  on conflict (workspace_id) do update
    set state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  update workspace_meta
    set rev = v_new_rev,
        updated_at = v_now,
        updated_by = p_user_id
  where workspace_id = p_workspace_id;

  v_counts := app_materialize_state(p_workspace_id, p_state, v_now);

  insert into change_log (workspace_id, entity, entity_id, op, changed_by, changed_at, payload)
  values (
    p_workspace_id,
    'workspace_state',
    p_workspace_id::text,
    'sync',
    p_user_id,
    v_now,
    jsonb_build_object('rev', v_new_rev, 'counts', v_counts)
  );

  return jsonb_build_object(
    'ok', true,
    'rev', v_new_rev,
    'updatedAt', v_now,
    'counts', v_counts
  );
end;
$$;

create or replace function app_migrate_import(
  p_workspace_id uuid,
  p_user_id uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_rev text := null;
  v_result jsonb;
begin
  select rev
    into v_current_rev
  from workspace_meta
  where workspace_id = p_workspace_id;

  v_result := app_sync(
    p_workspace_id,
    p_user_id,
    v_current_rev,
    p_state
  );

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rev', v_result->>'rev',
    'updatedAt', v_result->'updatedAt',
    'counts', coalesce(v_result->'counts', '{}'::jsonb)
  );
end;
$$;

grant execute on function app_auth_session(uuid) to service_role;
grant execute on function app_bootstrap(uuid, uuid) to service_role;
grant execute on function app_sync(uuid, uuid, text, jsonb) to service_role;
grant execute on function app_migrate_import(uuid, uuid, jsonb) to service_role;
