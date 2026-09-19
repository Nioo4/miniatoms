import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localConfig } from '../integration/local-config.mjs';

// Actual browser Auth, Next GET route and PostgreSQL transaction; only the
// deadline is injected into the isolated test database. No model call is needed.
test('D-12: authenticated GET expires a run and rejects the late worker',async({page},info)=>{
  if(process.env.AI_TEST_MODE!=='fixture')throw new Error('Use the isolated workbench fixture launcher.');
  const config=localConfig();
  const database=createClient(config.url,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  await page.goto('/');
  await page.getByLabel('描述应用需求').fill('过期任务读取验证');
  await expect(page.getByRole('button',{name:/开始创造/})).toBeEnabled();
  const projectId=await page.evaluate(async()=>{
    const key=Object.keys(localStorage).find(name=>name.startsWith('sb-')&&name.endsWith('-auth-token'));
    if(!key)throw new Error('Missing fixture anonymous session');
    const token=JSON.parse(localStorage.getItem(key)!).access_token;
    const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({requestId:crypto.randomUUID(),title:'过期读取测试'})});
    if(!response.ok)throw new Error('Fixture project creation failed');
    return (await response.json()).project.id as string;
  });
  const project=await database.from('projects').select('owner_id,current_version_id').eq('id',projectId).single();
  expect(project.error).toBeNull();
  const actor=project.data!.owner_id,runId=crypto.randomUUID();
  const started=await database.rpc('ma_start_run',{p_actor:actor,p_run_id:runId,p_project_id:projectId,p_kind:'generate',p_prompt:'期限测试',p_input_diagnostics:[],p_base_version_id:null,p_restore_target_version_id:null,p_fingerprint:'isolated-expiry-fixture'});
  expect(started.error).toBeNull();expect(started.data.run.status).toBe('planning');
  const expired=await database.from('runs').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',runId);
  expect(expired.error).toBeNull();
  const read=await page.evaluate(async id=>{
    const key=Object.keys(localStorage).find(name=>name.startsWith('sb-')&&name.endsWith('-auth-token'))!;
    const token=JSON.parse(localStorage.getItem(key)!).access_token;
    const response=await fetch(`/api/runs/${id}`,{headers:{Authorization:`Bearer ${token}`}});
    return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
  },runId);
  expect(read.status).toBe(200);expect(read.cache).toContain('no-store');
  expect(read.body.run.status).toBe('timed_out');expect(read.body.run.error.code).toBe('RUN_TIMEOUT');
  expect(read.body.run.modelCalls).toBe(0);expect(read.body.candidateVersion).toBeNull();expect(read.body.resultVersion).toBeNull();
  const late=await database.rpc('ma_update_run',{p_actor:actor,p_run_id:runId,p_token:started.data.token,p_expected_status:'planning',p_next_status:'generating',p_patch:{plan:{title:'迟到结果',brief:'不应发布',features:['测试'],changeSummary:'迟到'}}});
  expect(late.error).toBeNull();expect(late.data.applied).toBe(false);expect(late.data.run.status).toBe('timed_out');
  const final=await database.from('projects').select('current_version_id').eq('id',projectId).single();
  expect(final.error).toBeNull();expect(final.data!.current_version_id).toBeNull();
  // Explicit public DTO evidence only: never attach execution tokens or sessions.
  await info.attach('expiry-get-evidence.json',{contentType:'application/json',body:JSON.stringify({mode:'fixture',commit:process.env.APP_COMMIT_SHA??'local',database:config.url,projectId,runId,status:read.body.run.status,modelCalls:0,lateWorkerApplied:false,browser:page.context().browser()?.version()},null,2)});
});
