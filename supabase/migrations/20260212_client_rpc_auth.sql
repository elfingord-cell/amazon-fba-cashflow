create or replace function app_auth_session_client()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_role text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNAUTHENTICATED');
  end if;

  select workspace_id, role
    into v_workspace_id, v_role
  from app_auth_session(v_user_id)
  limit 1;

  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_MEMBER');
  end if;

  return jsonb_build_object(
    'ok', true,
    'userId', v_user_id,
    'workspaceId', v_workspace_id,
    'role', v_role
  );
end;
$$;

create or replace function app_bootstrap_client(
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := p_workspace_id;
  v_role text;
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNAUTHENTICATED');
  end if;

  if v_workspace_id is null then
    select workspace_id, role
      into v_workspace_id, v_role
    from app_auth_session(v_user_id)
    limit 1;
  else
    v_role := app_member_role(v_workspace_id, v_user_id);
  end if;

  if v_workspace_id is null or v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_MEMBER');
  end if;

  v_result := app_bootstrap(v_workspace_id, v_user_id);
  if coalesce((v_result->>'ok')::boolean, false) is true then
    v_result := v_result || jsonb_build_object('workspaceId', v_workspace_id);
  end if;
  return v_result;
end;
$$;

create or replace function app_sync_client(
  p_if_match_rev text,
  p_state jsonb,
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := p_workspace_id;
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNAUTHENTICATED');
  end if;

  if v_workspace_id is null then
    select workspace_id
      into v_workspace_id
    from app_auth_session(v_user_id)
    limit 1;
  end if;

  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_MEMBER');
  end if;

  v_result := app_sync(v_workspace_id, v_user_id, p_if_match_rev, p_state);
  if coalesce((v_result->>'ok')::boolean, false) is true then
    v_result := v_result || jsonb_build_object('workspaceId', v_workspace_id);
  end if;
  return v_result;
end;
$$;

create or replace function app_migrate_import_client(
  p_state jsonb,
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := p_workspace_id;
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNAUTHENTICATED');
  end if;

  if v_workspace_id is null then
    select workspace_id
      into v_workspace_id
    from app_auth_session(v_user_id)
    limit 1;
  end if;

  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_MEMBER');
  end if;

  v_result := app_migrate_import(v_workspace_id, v_user_id, p_state);
  if coalesce((v_result->>'ok')::boolean, false) is true then
    v_result := v_result || jsonb_build_object('workspaceId', v_workspace_id);
  end if;
  return v_result;
end;
$$;

revoke all on function app_auth_session_client() from public;
revoke all on function app_bootstrap_client(uuid) from public;
revoke all on function app_sync_client(text, jsonb, uuid) from public;
revoke all on function app_migrate_import_client(jsonb, uuid) from public;

grant execute on function app_auth_session_client() to authenticated;
grant execute on function app_bootstrap_client(uuid) to authenticated;
grant execute on function app_sync_client(text, jsonb, uuid) to authenticated;
grant execute on function app_migrate_import_client(jsonb, uuid) to authenticated;

grant execute on function app_auth_session_client() to service_role;
grant execute on function app_bootstrap_client(uuid) to service_role;
grant execute on function app_sync_client(text, jsonb, uuid) to service_role;
grant execute on function app_migrate_import_client(jsonb, uuid) to service_role;
