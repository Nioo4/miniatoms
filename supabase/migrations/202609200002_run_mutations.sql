-- Validate persisted protocol results so repair cannot append the same tool result twice.
create function ma_private.valid_messages(p_messages jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(p_messages)<>'array' then false else
    not exists(select 1 from jsonb_array_elements(p_messages) m where m->>'role'='tool'
      group by m->>'tool_call_id' having count(*)>1 or m->>'tool_call_id' is null)
    and not exists(select 1 from jsonb_array_elements(p_messages) t where t->>'role'='tool' and not exists(
      select 1 from jsonb_array_elements(p_messages) m
      cross join lateral jsonb_array_elements(coalesce(m->'tool_calls','[]')) c
      where m->>'role'='assistant' and c->>'id'=t->>'tool_call_id'))
  end
$$;

create function public.ma_update_run(p_actor uuid,p_run_id uuid,p_token uuid,p_expected_status text,p_next_status text,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs; v_key text; v_old jsonb; v_new jsonb; v_i integer;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  if r.finished_at is not null or p_token is null or r.execution_token is null or p_token<>r.execution_token then
    return jsonb_build_object('applied',false,'run',to_jsonb(r));
  end if;
  if r.expires_at<=clock_timestamp() then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
    return jsonb_build_object('applied',false,'run',to_jsonb(r));
  end if;
  if p_expected_status is distinct from r.status or p_next_status is null or not (
    p_next_status=r.status or
    (r.kind='generate' and ((r.status='planning' and p_next_status='generating') or
    (r.status in ('generating','repairing') and p_next_status='validating') or
    (r.status='validating' and p_next_status='repairing' and r.draft_attempt<3)))
  ) then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then perform ma_private.fail('INVALID_REQUEST'); end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('plan','agentMessages','diagnostics','callRecords') then perform ma_private.fail('INVALID_REQUEST'); end if;
  end loop;
  if p_patch ? 'plan' and (jsonb_typeof(p_patch->'plan')<>'object' or char_length(p_patch->'plan'->>'title') not between 1 and 60) then perform ma_private.fail('INVALID_REQUEST'); end if;
  if r.kind='restore' and p_patch ? 'plan' and p_patch->'plan' is distinct from r.plan then perform ma_private.fail('INVALID_REQUEST'); end if;
  if p_next_status='generating' and coalesce(p_patch->'plan',r.plan) is null then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  if p_patch ? 'agentMessages' and not ma_private.valid_messages(p_patch->'agentMessages') then perform ma_private.fail('INVALID_REQUEST'); end if;
  if p_patch ? 'callRecords' then
    if jsonb_typeof(p_patch->'callRecords')<>'array' or jsonb_array_length(p_patch->'callRecords')<>jsonb_array_length(r.call_records) then perform ma_private.fail('INVALID_REQUEST'); end if;
    for v_i in 0..jsonb_array_length(r.call_records)-1 loop
      v_old:=r.call_records->v_i; v_new:=p_patch->'callRecords'->v_i;
      if (v_new-'finishedAt'-'status'-'providerResponseId'-'promptTokens'-'completionTokens'-'totalTokens') is distinct from
         (v_old-'finishedAt'-'status'-'providerResponseId'-'promptTokens'-'completionTokens'-'totalTokens') or
         not (v_new ?& array['index','purpose','startedAt','finishedAt','status','providerResponseId','promptTokens','completionTokens','totalTokens']) or
         jsonb_typeof(v_new->'status')<>'string' or v_new->>'status' not in ('reserved','ok','error','aborted') or
         jsonb_typeof(v_new->'finishedAt') not in ('null','string') or
         jsonb_typeof(v_new->'providerResponseId') not in ('null','string') or
         (v_old->>'status'<>'reserved' and v_new is distinct from v_old) or
         ((v_new->>'status'='reserved') <> (v_new->>'finishedAt' is null)) then perform ma_private.fail('INVALID_REQUEST'); end if;
      for v_key in select unnest(array['promptTokens','completionTokens','totalTokens']) loop
        if jsonb_typeof(v_new->v_key)<>'null' and (jsonb_typeof(v_new->v_key)<>'number' or (v_new->>v_key)::numeric<0 or (v_new->>v_key)::numeric<>trunc((v_new->>v_key)::numeric)) then perform ma_private.fail('INVALID_REQUEST'); end if;
      end loop;
    end loop;
  end if;
  if r.plan is null and p_patch ? 'plan' then
    insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch)
      values(r.project_id,p_actor,r.id,'assistant','plan',p_patch->'plan'->>'brief',r.context_epoch) on conflict do nothing;
  end if;
  update public.runs set status=p_next_status,plan=coalesce(p_patch->'plan',plan),
    agent_messages=coalesce(p_patch->'agentMessages',agent_messages),diagnostics=coalesce(p_patch->'diagnostics',diagnostics),
    call_records=coalesce(p_patch->'callRecords',call_records),revision=revision+1 where id=r.id returning * into r;
  return jsonb_build_object('applied',true,'run',to_jsonb(r),'token',r.execution_token);
end $$;

create function public.ma_reserve_model_call(p_actor uuid,p_run_id uuid,p_token uuid,p_purpose text,p_user_daily_limit integer,p_global_daily_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs; v_day date; v_now timestamptz; v_global integer; v_user integer;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  if r.finished_at is not null or p_token is null or r.execution_token is null or p_token<>r.execution_token then
    return jsonb_build_object('applied',false,'run',to_jsonb(r));
  end if;
  v_now:=clock_timestamp();
  if r.expires_at<=v_now then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
    return jsonb_build_object('applied',false,'run',to_jsonb(r));
  end if;
  if p_user_daily_limit is null or p_global_daily_limit is null or p_user_daily_limit not between 0 and 1000000 or p_global_daily_limit not between 0 and 1000000 then perform ma_private.fail('INVALID_REQUEST'); end if;
  if r.kind<>'generate' or p_purpose is null or p_purpose not in ('plan','write') or r.model_calls>=4 or
    exists(select 1 from jsonb_array_elements(r.call_records) c where c->>'status'='reserved') or
    (p_purpose='plan' and (r.status<>'planning' or r.model_calls<>0)) or
    (p_purpose='write' and (r.status not in ('generating','repairing') or r.plan is null or r.draft_attempt>=3)) then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  v_day:=(v_now at time zone 'UTC')::date;
  insert into public.usage_daily(day,scope) values(v_day,'global') on conflict do nothing;
  select calls into v_global from public.usage_daily where day=v_day and scope='global' for update;
  insert into public.usage_daily(day,scope) values(v_day,'user:'||p_actor::text) on conflict do nothing;
  select calls into v_user from public.usage_daily where day=v_day and scope='user:'||p_actor::text for update;
  -- Recheck the actual clock after waiting on shared quota locks.
  v_now:=clock_timestamp();
  if r.expires_at<=v_now then
    -- No version lock after quota locks. A worker reservation cannot own a candidate.
    update public.runs set status='timed_out',error_code='RUN_TIMEOUT',error_message='运行已超时，请重试。',execution_token=null,finished_at=v_now,revision=revision+1 where id=r.id returning * into r;
    insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch) values(r.project_id,p_actor,r.id,'assistant','result',r.error_message,r.context_epoch) on conflict do nothing;
    return jsonb_build_object('applied',false,'run',to_jsonb(r));
  end if;
  if (v_now at time zone 'UTC')::date<>v_day then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  if v_global>=p_global_daily_limit or v_user>=p_user_daily_limit then
    perform ma_private.fail('QUOTA_EXCEEDED',jsonb_build_object('resetAt',(v_day+1)::timestamp at time zone 'UTC'));
  end if;
  update public.usage_daily set calls=calls+1 where day=v_day and scope in ('global','user:'||p_actor::text);
  update public.runs set model_calls=model_calls+1,draft_attempt=draft_attempt+case when p_purpose='write' then 1 else 0 end,
    call_records=call_records||jsonb_build_array(jsonb_build_object('index',model_calls+1,'purpose',p_purpose,'startedAt',v_now,'finishedAt',null,'status','reserved','providerResponseId',null,'promptTokens',null,'completionTokens',null,'totalTokens',null)),
    revision=revision+1 where id=r.id returning * into r;
  return jsonb_build_object('applied',true,'run',to_jsonb(r),'token',r.execution_token);
end $$;

create function public.ma_stage_candidate(p_actor uuid,p_run_id uuid,p_token uuid,p_artifact jsonb,p_plan jsonb,p_summary text,p_source_hash text,p_agent_messages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs; v public.versions; v_target public.versions;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  if r.finished_at is not null or p_token is null or r.execution_token is null or p_token<>r.execution_token then return jsonb_build_object('applied',false,'run',to_jsonb(r),'candidate',null); end if;
  if r.expires_at<=clock_timestamp() then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
    return jsonb_build_object('applied',false,'run',to_jsonb(r),'candidate',null);
  end if;
  if r.status<>'validating' then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  if not ma_private.valid_messages(p_agent_messages) then perform ma_private.fail('INVALID_REQUEST'); end if;
  if p_artifact is null or jsonb_typeof(p_artifact)<>'object' or
    not (p_artifact ?& array['html','css','js']) or (p_artifact-'html'-'css'-'js')<>'{}'::jsonb or
    jsonb_typeof(p_artifact->'html')<>'string' or jsonb_typeof(p_artifact->'css')<>'string' or jsonb_typeof(p_artifact->'js')<>'string' or
    char_length(p_artifact->>'html')=0 or char_length(p_artifact->>'js')=0 or
    octet_length(p_artifact->>'html')+octet_length(p_artifact->>'css')+octet_length(p_artifact->>'js')>131072 then perform ma_private.fail('INVALID_REQUEST'); end if;
  if r.kind='restore' then
    select * into v_target from public.versions where id=r.restore_target_version_id;
    if p_artifact is distinct from v_target.artifact or p_plan is distinct from v_target.plan or p_source_hash is distinct from v_target.source_hash then perform ma_private.fail('INVALID_REQUEST'); end if;
  end if;
  insert into public.versions(project_id,owner_id,run_id,status,parent_version_id,restored_from_version_id,artifact,plan,summary,source_hash)
    values(r.project_id,p_actor,r.id,'candidate',r.base_version_id,r.restore_target_version_id,p_artifact,p_plan,p_summary,p_source_hash) returning * into v;
  update public.runs set candidate_version_id=v.id,status='awaiting_preview',execution_token=null,agent_messages=p_agent_messages,revision=revision+1 where id=r.id returning * into r;
  return jsonb_build_object('applied',true,'run',to_jsonb(r),'candidate',to_jsonb(v));
end $$;

create function public.ma_finish_run(p_actor uuid,p_run_id uuid,p_token uuid,p_terminal_status text,p_error jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  if r.finished_at is not null or p_token is null or r.execution_token is null or p_token<>r.execution_token then return jsonb_build_object('applied',false,'run',to_jsonb(r)); end if;
  if p_terminal_status is null or p_terminal_status not in ('failed','cancelled','timed_out') or p_error->>'code' is null or p_error->>'message' is null then perform ma_private.fail('INVALID_REQUEST'); end if;
  if r.expires_at<=clock_timestamp() then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
  else
    if p_terminal_status='timed_out' then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
    r:=ma_private.terminal(p_actor,r.id,p_terminal_status,p_error->>'code',p_error->>'message');
  end if;
  return jsonb_build_object('applied',true,'run',to_jsonb(r));
end $$;

create function public.ma_cancel_run(p_actor uuid,p_run_id uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  if r.finished_at is not null then return jsonb_build_object('applied',false,'run',to_jsonb(r)); end if;
  if p_reason is null or p_reason not in ('user','navigation','preview_unavailable') then perform ma_private.fail('INVALID_REQUEST'); end if;
  if r.expires_at<=clock_timestamp() then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
  else
    r:=ma_private.terminal(p_actor,r.id,'cancelled',case when p_reason='preview_unavailable' then 'PREVIEW_UNAVAILABLE' else 'USER_CANCELLED' end,'运行已取消。');
  end if;
  return jsonb_build_object('applied',true,'run',to_jsonb(r));
end $$;
