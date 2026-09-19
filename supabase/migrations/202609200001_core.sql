-- Database is the authority for ownership, serialization and publication.
create schema if not exists ma_private;
revoke all on schema ma_private from public, anon, authenticated;
grant usage on schema ma_private to service_role;

create table public.projects (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  create_fingerprint text not null, title text not null check(char_length(title) between 1 and 60),
  brief text not null default '', current_version_id uuid,
  context_epoch integer not null default 0 check(context_epoch >= 0),
  next_version_number integer not null default 1 check(next_version_number > 0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(id,owner_id)
);
create table public.runs (
  id uuid primary key, project_id uuid not null, owner_id uuid not null,
  kind text not null check(kind in ('generate','restore')), request_fingerprint text not null,
  prompt text not null, input_diagnostics jsonb not null default '[]', base_version_id uuid, restore_target_version_id uuid,
  context_epoch integer not null check(context_epoch >= 0),
  status text not null check(status in ('planning','generating','validating','awaiting_preview','repairing','succeeded','failed','cancelled','timed_out')),
  revision bigint not null default 1 check(revision > 0), execution_token uuid,
  model_calls integer not null default 0 check(model_calls between 0 and 4),
  draft_attempt integer not null default 0 check(draft_attempt between 0 and 3),
  plan jsonb, agent_messages jsonb not null default '[]', call_records jsonb not null default '[]',
  candidate_version_id uuid, result_version_id uuid, diagnostics jsonb not null default '[]',
  error_code text, error_message text,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  finished_at timestamptz,
  unique(id,project_id,owner_id), foreign key(project_id,owner_id) references public.projects(id,owner_id),
  check((status in ('succeeded','failed','cancelled','timed_out')) = (finished_at is not null)),
  check(kind <> 'restore' or (model_calls=0 and draft_attempt=0)),
  check(jsonb_typeof(agent_messages)='array'),
  check(jsonb_typeof(call_records)='array' and jsonb_array_length(call_records)<=4),
  check(jsonb_typeof(diagnostics)='array' and jsonb_array_length(diagnostics)<=5),
  check(jsonb_typeof(input_diagnostics)='array' and jsonb_array_length(input_diagnostics)<=5)
);
create table public.versions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, owner_id uuid not null, run_id uuid not null,
  number integer, status text not null check(status in ('candidate','ready','rejected')),
  parent_version_id uuid, restored_from_version_id uuid, artifact jsonb not null, plan jsonb not null,
  summary text not null, source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'), preview_feedback jsonb,
  created_at timestamptz not null default clock_timestamp(), committed_at timestamptz,
  unique(id,project_id,owner_id), unique(project_id,number),
  foreign key(project_id,owner_id) references public.projects(id,owner_id),
  foreign key(run_id,project_id,owner_id) references public.runs(id,project_id,owner_id),
  foreign key(parent_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id),
  foreign key(restored_from_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id),
  check((status='ready' and number is not null and number > 0 and committed_at is not null) or (status<>'ready' and number is null and committed_at is null)),
  check(jsonb_typeof(artifact)='object' and jsonb_typeof(plan)='object')
);
alter table public.projects add foreign key(current_version_id,id,owner_id) references public.versions(id,project_id,owner_id) deferrable initially immediate;
alter table public.runs add foreign key(base_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id);
alter table public.runs add foreign key(restore_target_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id);
alter table public.runs add foreign key(candidate_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id);
alter table public.runs add foreign key(result_version_id,project_id,owner_id) references public.versions(id,project_id,owner_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, owner_id uuid not null, run_id uuid,
  role text not null check(role in ('user','assistant')), kind text not null check(kind in ('request','plan','result','restore')),
  content text not null, context_epoch integer not null check(context_epoch >= 0), created_at timestamptz not null default clock_timestamp(),
  foreign key(project_id,owner_id) references public.projects(id,owner_id),
  foreign key(run_id,project_id,owner_id) references public.runs(id,project_id,owner_id)
);
create table public.app_data (
  project_id uuid primary key, owner_id uuid not null, state jsonb not null default '{}',
  revision bigint not null default 0 check(revision>=0), updated_at timestamptz not null default clock_timestamp(),
  foreign key(project_id,owner_id) references public.projects(id,owner_id),
  check(jsonb_typeof(state)='object' and octet_length(state::text)<=65536)
);
create table public.usage_daily (
  day date not null, scope text not null check(scope='global' or scope ~ '^user:[0-9a-f-]{36}$'),
  calls integer not null default 0 check(calls>=0), primary key(day,scope)
);
create table public.operation_receipts (
  owner_id uuid not null, project_id uuid not null, request_id uuid not null,
  kind text not null default 'data_put' check(kind='data_put'), fingerprint text not null, response jsonb not null,
  created_at timestamptz not null default clock_timestamp(), primary key(owner_id,request_id),
  foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create unique index messages_run_kind on public.messages(run_id,kind) where run_id is not null;
create unique index runs_one_active on public.runs(project_id) where status in ('planning','generating','validating','awaiting_preview','repairing');
create index projects_owner_updated on public.projects(owner_id,updated_at desc,id);
create index messages_project_created on public.messages(project_id,created_at,id);
create index versions_project_number on public.versions(project_id,number desc);
create index runs_project_created on public.runs(project_id,created_at desc);

alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.versions enable row level security;
alter table public.runs enable row level security;
alter table public.app_data enable row level security;
alter table public.usage_daily enable row level security;
alter table public.operation_receipts enable row level security;
create policy owner_read on public.projects for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_read on public.messages for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_read on public.versions for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_read on public.runs for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_read on public.app_data for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.projects,public.messages,public.versions,public.runs,public.app_data,public.usage_daily,public.operation_receipts from public,anon,authenticated;
grant select on public.projects,public.messages,public.versions,public.app_data to authenticated;
grant select(id,project_id,owner_id,kind,status,revision,base_version_id,candidate_version_id,result_version_id,model_calls,draft_attempt,plan,diagnostics,error_code,error_message,created_at,expires_at,finished_at) on public.runs to authenticated;
grant select,insert,update on public.projects,public.messages,public.versions,public.runs,public.app_data,public.usage_daily,public.operation_receipts to service_role;

create function ma_private.fail(p_code text,p_details jsonb default '{}') returns void
language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='P0001',message=p_code,detail=p_details::text; end $$;

create function ma_private.lock_project(p_actor uuid,p_project_id uuid) returns public.projects
language plpgsql security invoker set search_path='' as $$
declare v public.projects;
begin
  select * into v from public.projects where id=p_project_id and owner_id=p_actor for update;
  if not found then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
  return v;
end $$;

create function ma_private.lock_run(p_actor uuid,p_run_id uuid) returns public.runs
language plpgsql security invoker set search_path='' as $$
declare v public.runs; v_project uuid;
begin
  select project_id into v_project from public.runs where id=p_run_id and owner_id=p_actor;
  if not found then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
  perform ma_private.lock_project(p_actor,v_project);
  select * into v from public.runs where id=p_run_id and owner_id=p_actor for update;
  return v;
end $$;

create function ma_private.terminal(p_actor uuid,p_run_id uuid,p_status text,p_code text,p_message text) returns public.runs
language plpgsql security invoker set search_path='' as $$
declare v public.runs;
begin
  v:=ma_private.lock_run(p_actor,p_run_id);
  if v.finished_at is not null then return v; end if;
  if p_status not in ('failed','cancelled','timed_out') then perform ma_private.fail('INVALID_REQUEST'); end if;
  update public.versions set status='rejected' where id=v.candidate_version_id and status='candidate';
  update public.runs set status=p_status,error_code=p_code,error_message=p_message,execution_token=null,
    finished_at=clock_timestamp(),revision=revision+1 where id=v.id returning * into v;
  insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch)
    values(v.project_id,v.owner_id,v.id,'assistant','result',p_message,v.context_epoch) on conflict do nothing;
  return v;
end $$;

create function public.ma_create_project(p_actor uuid,p_project_id uuid,p_title text,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v public.projects;
begin
  perform pg_advisory_xact_lock(hashtextextended('ma:create:'||p_actor::text,0));
  select * into v from public.projects where id=p_project_id;
  if found then
    if v.owner_id<>p_actor then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
    if v.create_fingerprint<>p_fingerprint then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('applied',false,'action','duplicate','project',to_jsonb(v));
  end if;
  if (select count(*) from public.projects where owner_id=p_actor)>=20 then perform ma_private.fail('RESOURCE_LIMIT'); end if;
  if p_title is null or char_length(p_title) not between 1 and 60 or p_fingerprint is null then perform ma_private.fail('INVALID_REQUEST'); end if;
  insert into public.projects(id,owner_id,title,create_fingerprint) values(p_project_id,p_actor,p_title,p_fingerprint) returning * into v;
  insert into public.app_data(project_id,owner_id) values(v.id,p_actor);
  return jsonb_build_object('applied',true,'action','created','project',to_jsonb(v));
exception when unique_violation then
  -- Different actors do not share the create advisory lock. A colliding UUID must not leak a SQL error.
  select * into v from public.projects where id=p_project_id;
  if not found then raise; end if;
  if v.owner_id<>p_actor then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
  if v.create_fingerprint is distinct from p_fingerprint then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
  return jsonb_build_object('applied',false,'action','duplicate','project',to_jsonb(v));
end $$;

create function public.ma_expire_project_runs(p_actor uuid,p_project_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v public.runs; v_rows jsonb:='[]';
begin
  perform ma_private.lock_project(p_actor,p_project_id);
  for v in select * from public.runs where project_id=p_project_id and finished_at is null order by id for update loop
    if v.expires_at<=clock_timestamp() then
      v:=ma_private.terminal(p_actor,v.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
      v_rows:=v_rows||jsonb_build_array(to_jsonb(v));
    end if;
  end loop;
  return jsonb_build_object('applied',jsonb_array_length(v_rows)>0,'runs',v_rows);
end $$;

create function public.ma_start_run(p_actor uuid,p_run_id uuid,p_project_id uuid,p_kind text,p_prompt text,p_input_diagnostics jsonb,p_base_version_id uuid,p_restore_target_version_id uuid,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.projects; r public.runs; v public.versions; v_active uuid; v_now timestamptz;
begin
  p:=ma_private.lock_project(p_actor,p_project_id);
  select * into r from public.runs where id=p_run_id;
  if found then
    if r.owner_id<>p_actor then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
    if r.request_fingerprint<>p_fingerprint or r.project_id<>p_project_id then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
    perform public.ma_expire_project_runs(p_actor,p_project_id);
    select * into r from public.runs where id=p_run_id;
    return jsonb_build_object('applied',false,'action','duplicate','run',to_jsonb(r),'token',null);
  end if;
  perform public.ma_expire_project_runs(p_actor,p_project_id);
  v_now:=clock_timestamp();
  if p.current_version_id is distinct from p_base_version_id then perform ma_private.fail('BASE_VERSION_CONFLICT',jsonb_build_object('currentVersionId',p.current_version_id)); end if;
  select id into v_active from public.runs where project_id=p_project_id and finished_at is null;
  if found then perform ma_private.fail('RUN_IN_PROGRESS',jsonb_build_object('activeRunId',v_active)); end if;
  if (select count(*) from public.versions where project_id=p_project_id and status='ready')>=100 or
     (select count(*) from public.runs where project_id=p_project_id and created_at >= date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC')>=50 then perform ma_private.fail('RESOURCE_LIMIT'); end if;
  if p_kind not in ('generate','restore') or p_kind is null or p_fingerprint is null then perform ma_private.fail('INVALID_REQUEST'); end if;
  if p_kind='restore' then
    select * into v from public.versions where id=p_restore_target_version_id and project_id=p_project_id and owner_id=p_actor and status='ready';
    if not found then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
    if v.id=p.current_version_id then perform ma_private.fail('ALREADY_CURRENT'); end if;
  elsif p_restore_target_version_id is not null or p_prompt is null or char_length(p_prompt) not between 1 and 4000 then perform ma_private.fail('INVALID_REQUEST');
  end if;
  insert into public.runs(id,project_id,owner_id,kind,request_fingerprint,prompt,input_diagnostics,base_version_id,restore_target_version_id,context_epoch,status,execution_token,plan,created_at,expires_at)
    values(p_run_id,p_project_id,p_actor,p_kind,p_fingerprint,coalesce(p_prompt,''),coalesce(p_input_diagnostics,'[]'),p_base_version_id,p_restore_target_version_id,p.context_epoch,
      case when p_kind='restore' then 'validating' else 'planning' end,gen_random_uuid(),v.plan,v_now,v_now+interval '240 seconds') returning * into r;
  insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch)
    values(p_project_id,p_actor,r.id,'user','request',case when p_kind='restore' then '恢复版本 '||v.number else p_prompt end,p.context_epoch);
  return jsonb_build_object('applied',true,'action','created','run',to_jsonb(r),'token',r.execution_token);
exception when unique_violation then
  -- A request UUID can collide across projects, whose project locks are intentionally independent.
  select * into r from public.runs where id=p_run_id;
  if not found then raise; end if;
  if r.owner_id<>p_actor then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
  if r.request_fingerprint is distinct from p_fingerprint or r.project_id<>p_project_id then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
  return jsonb_build_object('applied',false,'action','duplicate','run',to_jsonb(r),'token',null);
end $$;

create function public.ma_get_run_context(p_actor uuid,p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs; p public.projects; v_current jsonb; v_restore jsonb; v_messages jsonb;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  select * into p from public.projects where id=r.project_id;
  select to_jsonb(v) into v_current from public.versions v where v.id=p.current_version_id;
  select to_jsonb(v) into v_restore from public.versions v where v.id=r.restore_target_version_id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') into v_messages from (
    select m.* from public.messages m join public.runs rr on rr.id=m.run_id
    where m.project_id=p.id and m.context_epoch=p.context_epoch and m.kind in ('request','result') and rr.status='succeeded'
    order by m.created_at desc,m.id desc limit 6
  ) m;
  return jsonb_build_object('applied',true,'run',to_jsonb(r),'project',to_jsonb(p),'token',r.execution_token,'currentVersion',v_current,'restoreVersion',v_restore,'messages',v_messages);
end $$;
