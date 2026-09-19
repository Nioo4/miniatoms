create function public.ma_accept_feedback(p_actor uuid,p_run_id uuid,p_candidate_version_id uuid,p_source_hash text,p_feedback_request_id uuid,p_fingerprint text,p_outcome text,p_data_revision bigint,p_diagnostics jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.runs; p public.projects; d public.app_data; v public.versions;
  v_now timestamptz; v_action text; v_tool_id text; v_tool_result jsonb; v_messages jsonb;
begin
  r:=ma_private.lock_run(p_actor,p_run_id);
  select * into p from public.projects where id=r.project_id;
  select * into d from public.app_data where project_id=r.project_id for update;
  select * into v from public.versions where id=p_candidate_version_id and run_id=r.id and project_id=r.project_id and owner_id=p_actor for update;
  if not found then perform ma_private.fail('RESOURCE_NOT_FOUND'); end if;
  -- A consumed report is replayable even after publication, data writes or further candidates.
  if v.preview_feedback is not null then
    if v.preview_feedback->>'requestId'=p_feedback_request_id::text then
      if v.preview_feedback->>'fingerprint' is distinct from p_fingerprint then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
      return jsonb_build_object('applied',false,'action','duplicate','run',to_jsonb(r),'project',to_jsonb(p),'candidate',to_jsonb(v),'token',null);
    end if;
    perform ma_private.fail('CANDIDATE_STALE');
  end if;
  if r.candidate_version_id is distinct from v.id or v.status<>'candidate' then perform ma_private.fail('CANDIDATE_STALE'); end if;
  if r.status<>'awaiting_preview' then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
  v_now:=clock_timestamp();
  if r.expires_at<=v_now then
    r:=ma_private.terminal(p_actor,r.id,'timed_out','RUN_TIMEOUT','运行已超时，请重试。');
    select * into v from public.versions where id=v.id;
    return jsonb_build_object('applied',true,'action','terminal','run',to_jsonb(r),'project',to_jsonb(p),'candidate',to_jsonb(v),'token',null);
  end if;
  if p.current_version_id is distinct from r.base_version_id then perform ma_private.fail('BASE_VERSION_CONFLICT',jsonb_build_object('currentVersionId',p.current_version_id)); end if;
  if p_source_hash is distinct from v.source_hash then perform ma_private.fail('CANDIDATE_STALE'); end if;
  if p_data_revision is distinct from d.revision then perform ma_private.fail('PREVIEW_DATA_CHANGED',jsonb_build_object('revision',d.revision)); end if;
  if p_outcome is null or p_outcome not in ('ready','errors') or p_feedback_request_id is null or p_fingerprint is null or
    p_diagnostics is null or jsonb_typeof(p_diagnostics)<>'array' or jsonb_array_length(p_diagnostics)>5 or
    (p_outcome='ready' and jsonb_array_length(p_diagnostics)<>0) or (p_outcome='errors' and jsonb_array_length(p_diagnostics)=0) then perform ma_private.fail('INVALID_REQUEST'); end if;
  -- Capacity rejection is not an accepted ready report: do not append a false success tool result.
  if p_outcome='ready' and (select count(*) from public.versions where project_id=p.id and status='ready')>=100 then
    r:=ma_private.terminal(p_actor,r.id,'failed','RESOURCE_LIMIT','已达到版本容量上限。');
    select * into v from public.versions where id=p_candidate_version_id;
    return jsonb_build_object('applied',true,'action','terminal','run',to_jsonb(r),'project',to_jsonb(p),'candidate',to_jsonb(v),'token',null);
  end if;
  v_messages:=r.agent_messages;
  if r.kind='generate' then
    select c.call->>'id' into v_tool_id
      from jsonb_array_elements(r.agent_messages) with ordinality as m(msg,pos)
      cross join lateral jsonb_array_elements(coalesce(m.msg->'tool_calls','[]')) c(call)
      where m.msg->>'role'='assistant' and c.call->'function'->>'name'='write_app' and c.call->>'id' is not null
      and not exists(select 1 from jsonb_array_elements(r.agent_messages) t where t->>'role'='tool' and t->>'tool_call_id'=c.call->>'id')
      order by m.pos desc limit 1;
    if v_tool_id is null then perform ma_private.fail('RUN_STATE_CONFLICT'); end if;
    v_tool_result:=case when p_outcome='ready' then jsonb_build_object('ok',true,'stage','preview','versionId',v.id)
      else jsonb_build_object('ok',false,'stage','preview','diagnostics',p_diagnostics) end;
    v_messages:=v_messages||jsonb_build_array(jsonb_build_object('role','tool','tool_call_id',v_tool_id,'content',v_tool_result::text));
  end if;
  update public.versions set preview_feedback=jsonb_build_object('requestId',p_feedback_request_id,'fingerprint',p_fingerprint,'outcome',p_outcome,'dataRevision',p_data_revision,'receivedAt',v_now) where id=v.id;
  if p_outcome='ready' then
      update public.versions set status='ready',number=p.next_version_number,committed_at=v_now where id=v.id returning * into v;
      update public.projects set current_version_id=v.id,next_version_number=next_version_number+1,title=v.plan->>'title',brief=v.plan->>'brief',updated_at=v_now,
        context_epoch=context_epoch+case when r.kind='restore' then 1 else 0 end where id=p.id returning * into p;
      update public.runs set status='succeeded',result_version_id=v.id,execution_token=null,finished_at=v_now,agent_messages=v_messages,diagnostics='[]',revision=revision+1 where id=r.id returning * into r;
      insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch)
        values(p.id,p_actor,r.id,'assistant','result',v.summary,p.context_epoch) on conflict do nothing;
      if r.kind='restore' then
        insert into public.messages(project_id,owner_id,run_id,role,kind,content,context_epoch)
          values(p.id,p_actor,r.id,'assistant','restore','已从历史版本恢复，后续修改以此版本为准。',p.context_epoch) on conflict do nothing;
      end if;
      v_action:='committed';
  else
    update public.versions set status='rejected' where id=v.id;
    if r.kind='generate' and r.draft_attempt<3 then
      update public.runs set status='repairing',execution_token=gen_random_uuid(),diagnostics=p_diagnostics,agent_messages=v_messages,revision=revision+1 where id=r.id returning * into r;
      v_action:='repair';
    else
      update public.runs set diagnostics=p_diagnostics,agent_messages=v_messages,revision=revision+1 where id=r.id returning * into r;
      r:=ma_private.terminal(p_actor,r.id,'failed',case when r.kind='restore' then 'RESTORE_PREVIEW_FAILED' else 'REPAIR_EXHAUSTED' end,
        case when r.kind='restore' then '历史版本与当前数据未通过启动检查。' else '应用在三次尝试后仍未通过检查。' end);
      v_action:='terminal';
    end if;
  end if;
  select * into v from public.versions where id=p_candidate_version_id;
  return jsonb_build_object('applied',true,'action',v_action,'run',to_jsonb(r),'project',to_jsonb(p),'candidate',to_jsonb(v),'token',case when v_action='repair' then r.execution_token else null end);
end $$;

create function ma_private.valid_json(p_value jsonb,p_depth integer default 0) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare v_key text; v_item jsonb;
begin
  if p_depth>20 then return false; end if;
  if jsonb_typeof(p_value)='object' then
    for v_key,v_item in select key,value from jsonb_each(p_value) loop
      if v_key in ('__proto__','prototype','constructor') or not ma_private.valid_json(v_item,p_depth+1) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if not ma_private.valid_json(v_item,p_depth+1) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create function public.ma_put_app_data(p_actor uuid,p_project_id uuid,p_request_id uuid,p_version_id uuid,p_expected_revision bigint,p_state jsonb,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.projects; d public.app_data; receipt public.operation_receipts; v_response jsonb;
begin
  p:=ma_private.lock_project(p_actor,p_project_id);
  select * into d from public.app_data where project_id=p.id for update;
  select * into receipt from public.operation_receipts where owner_id=p_actor and request_id=p_request_id for update;
  if found then
    if receipt.fingerprint is distinct from p_fingerprint or receipt.project_id<>p.id then perform ma_private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('applied',false,'action','duplicate','result',receipt.response);
  end if;
  if p.current_version_id is null or p.current_version_id is distinct from p_version_id then perform ma_private.fail('ACTIVE_VERSION_CHANGED'); end if;
  if d.revision is distinct from p_expected_revision then perform ma_private.fail('DATA_REVISION_CONFLICT',jsonb_build_object('revision',d.revision)); end if;
  if p_state is null or jsonb_typeof(p_state)<>'object' or not ma_private.valid_json(p_state) then perform ma_private.fail('INVALID_REQUEST'); end if;
  if octet_length(p_state::text)>65536 then perform ma_private.fail('PAYLOAD_TOO_LARGE'); end if;
  update public.app_data set state=p_state,revision=revision+1,updated_at=clock_timestamp() where project_id=p.id returning * into d;
  v_response:=jsonb_build_object('revision',d.revision,'savedAt',d.updated_at);
  insert into public.operation_receipts(owner_id,project_id,request_id,fingerprint,response) values(p_actor,p.id,p_request_id,p_fingerprint,v_response) on conflict do nothing;
  if not found then
    -- Same actor/request used concurrently on another project: rollback this entire write.
    perform ma_private.fail('IDEMPOTENCY_CONFLICT');
  end if;
  return jsonb_build_object('applied',true,'action','updated','result',v_response);
end $$;

-- Revoke PostgreSQL's default PUBLIC execute grant, including internal helpers.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='ma_private' or (n.nspname='public' and p.proname like 'ma\_%' escape '\') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
