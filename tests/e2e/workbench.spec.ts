import { test,expect,chromium,type Page,type TestInfo } from '@playwright/test';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { localConfig } from '../integration/local-config.mjs';

// These tests use actual Next routes, Supabase Anonymous Auth, RLS and RPCs.
// Only DeepSeek HTTP is a named local fixture, started by scripts/e2e-workbench.mjs.
let database:SupabaseClient,databaseUrl:string;
test.beforeAll(async()=>{
  const config=localConfig();databaseUrl=config.url;
  if(process.env.AI_TEST_MODE!=='fixture'||!process.env.DEEPSEEK_BASE_URL?.startsWith('http://127.0.0.1:'))throw new Error('BLOCKED: launch through npm run test:e2e:workbench with the local fixture upstream.');
  database=createClient(config.url,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await database.from('projects').select('id').limit(0);
  if(error)throw new Error('BLOCKED: real local Supabase/schema unavailable; no workbench tests passed.');
});
const app=(page:Page)=>page.frameLocator('iframe[title="应用预览"]');
async function create(page:Page,prompt='做一个中文求职投递看板，支持保存记录。'){
  await page.goto('/');
  await page.getByLabel('描述应用需求').fill(prompt);
  await expect(page.getByRole('button',{name:/开始创造/})).toBeEnabled();
  await page.getByRole('button',{name:/开始创造/}).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]{36}$/);
  const id=page.url().split('/').at(-1)!;
  await saved(page,1);return id;
}
async function saved(page:Page,number:number){
  if((page.viewportSize()?.width??1440)<768)await page.getByRole('button',{name:'应用成果',exact:true}).click();
  await expect(page.locator('.preview-toolbar')).toContainText(`v${number} · 基础检查通过`);
  await expect(page.locator('.run-card')).toContainText('新版本已保存');
  await expect(app(page).getByRole('heading',{name:'求职投递看板'})).toBeVisible();
}
async function send(page:Page,prompt:string){
  if((page.viewportSize()?.width??1440)<768)await page.getByRole('button',{name:'需求与对话',exact:true}).click();
  await page.getByLabel('应用需求或修改意见').fill(prompt);
  await expect(page.getByRole('button',{name:'发送需求',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'发送需求',exact:true}).click();
}
async function add(page:Page,company:string,count:number){
  const frame=app(page);
  await frame.getByLabel('公司',{exact:true}).fill(company);
  await frame.getByLabel('岗位',{exact:true}).fill('全栈工程师');
  await frame.getByLabel('当前阶段').selectOption('已投递');
  await frame.getByLabel('备注',{exact:true}).fill('等待反馈');
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(frame.locator('#jobs li')).toHaveCount(count);
  await expect(frame.locator('#save-message')).toHaveText('记录已保存');
}
async function snapshot(projectId:string){
  const project=await database.from('projects').select('id,current_version_id,context_epoch').eq('id',projectId).single();
  const run=await database.from('runs').select('id,kind,status,model_calls,draft_attempt,error_code,candidate_version_id,result_version_id,expires_at,agent_messages,call_records').eq('project_id',projectId).order('created_at',{ascending:false}).limit(1).single();
  const data=await database.from('app_data').select('state,revision').eq('project_id',projectId).single();
  if(project.error||run.error||data.error)throw new Error('Fixture evidence read failed against local Supabase.');
  const versions=await database.from('versions').select('id,number,status,source_hash,restored_from_version_id').eq('project_id',projectId).eq('status','ready').order('number');
  if(versions.error)throw new Error('Fixture version evidence read failed.');
  return {project:project.data,run:run.data,data:data.data,versions:versions.data};
}
async function evidence(info:TestInfo,page:Page,projectId:string){
  const state=await snapshot(projectId);
  await info.attach('fixture-evidence.json',{contentType:'application/json',body:JSON.stringify({mode:'fixture',database:databaseUrl,baseUrl:'http://localhost:3001',model:'miniatoms-local-fixture',commit:process.env.APP_COMMIT_SHA??'local',browser:page.context().browser()?.version(),projectId,run:{id:state.run.id,kind:state.run.kind,status:state.run.status,modelCalls:state.run.model_calls,draftAttempt:state.run.draft_attempt},versions:state.versions,dataRevision:state.data.revision},null,2)});
}

for(const width of [1440,390])test(`B-07 fixture ${width}px: generate → persist records → modify → refresh → history restore keeps data`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const id=await create(page);await add(page,'星河科技',1);await add(page,'云杉软件',2);
  const first=await snapshot(id);expect(first.run.model_calls).toBe(2);expect(first.run.status).toBe('succeeded');expect(first.data.revision).toBe(2);
  await send(page,'增加公司名称搜索，并改成深色风格，保留已有记录和功能。');await saved(page,2);
  await expect(app(page).getByLabel('公司搜索')).toBeVisible();await app(page).getByLabel('公司搜索').fill('星河');
  await expect(app(page).locator('#jobs li')).toHaveCount(1);await expect(app(page).locator('#jobs')).toContainText('星河科技');
  await expect(app(page).locator('body')).toHaveCSS('background-color','rgb(17, 24, 39)');
  await page.reload();await saved(page,2);await expect(app(page).locator('#jobs li')).toHaveCount(2);
  const modified=await snapshot(id);expect(modified.data.state).toEqual(first.data.state);
  await page.getByRole('button',{name:'版本',exact:true}).click();
  await page.locator('.version-card').filter({has:page.locator('.version-number',{hasText:/^v1$/})}).click();
  await expect(page.locator('.history-banner')).toContainText('操作不保存');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复此版本',exact:true}).click();
  await saved(page,3);await expect(app(page).getByLabel('公司搜索')).toHaveCount(0);
  await expect(app(page).locator('#jobs li')).toHaveCount(2);await expect(app(page).locator('body')).toHaveCSS('background-color','rgb(248, 250, 252)');
  const restored=await snapshot(id);expect(restored.run.kind).toBe('restore');expect(restored.run.model_calls).toBe(0);expect(restored.run.draft_attempt).toBe(0);
  expect(restored.data).toEqual(first.data);expect(restored.versions).toHaveLength(3);
  expect(restored.versions[2].source_hash).toBe(first.versions[0].source_hash);expect(restored.versions[2].restored_from_version_id).toBe(first.versions[0].id);expect(restored.project.context_epoch).toBe(1);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'应用成果',exact:true}).click();
  await expect(app(page).getByRole('heading',{name:'求职投递看板'})).toBeVisible();
  await page.getByRole('button',{name:'手机预览',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'版本',exact:true}).click();await expect(page.locator('.version-card')).toHaveCount(3);
  await evidence(info,page,id);
});

test('fixture: static error repairs with real protocol messages and preserves current data',async({page},info)=>{
  const id=await create(page);await add(page,'保留公司',1);
  await send(page,'保留已有功能，增加搜索。[fixture:static-once]');await saved(page,2);
  const state=await snapshot(id);expect(state.run.model_calls).toBe(3);expect(state.run.draft_attempt).toBe(2);expect(state.data.state.jobs).toHaveLength(1);
  const tools=state.run.agent_messages.filter((m:{role:string})=>m.role==='tool');
  expect(tools.some((m:{content:string})=>JSON.parse(m.content).stage==='static')).toBe(true);
  expect(new Set(tools.map((m:{tool_call_id:string})=>m.tool_call_id)).size).toBe(tools.length);
  await evidence(info,page,id);
});

test('fixture: browser startup error resumes repair via feedback request',async({page},info)=>{
  const id=await create(page);await send(page,'增加搜索并保持数据。[fixture:startup-once]');await saved(page,2);
  const state=await snapshot(id);expect(state.run.model_calls).toBe(3);expect(state.run.draft_attempt).toBe(2);
  const results=state.run.agent_messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:string})=>JSON.parse(m.content));
  expect(results.some((r:{stage?:string;ok:boolean})=>r.stage==='preview'&&!r.ok)).toBe(true);
  expect(results.at(-1)).toEqual({ok:true,stage:'preview',versionId:state.project.current_version_id});
  await evidence(info,page,id);
});

test('fixture: three startup failures terminate and keep prior code plus business data',async({page},info)=>{
  const id=await create(page);await add(page,'不会丢失',1);const before=await snapshot(id);
  await send(page,'保持功能。[fixture:startup-always]');
  await expect(page.locator('.run-card')).toContainText('本次生成未完成');
  await expect(page.locator('.run-card')).toContainText('模型调用 4/4');
  const after=await snapshot(id);expect(after.run.status).toBe('failed');expect(after.run.error_code).toBe('REPAIR_EXHAUSTED');expect(after.run.draft_attempt).toBe(3);
  expect(after.project.current_version_id).toBe(before.project.current_version_id);expect(after.versions).toEqual(before.versions);expect(after.data).toEqual(before.data);
  await expect(app(page).locator('#jobs')).toContainText('不会丢失');await evidence(info,page,id);
});

test('fixture: cancellation aborts delayed model output and keeps current version',async({page},info)=>{
  const id=await create(page);const before=await snapshot(id);
  await send(page,'增加搜索。[fixture:delay]');
  await expect.poll(async()=> (await snapshot(id)).run.status).toBe('generating');
  await expect.poll(async()=> (await snapshot(id)).run.model_calls).toBe(2);
  await page.getByRole('button',{name:'取消任务',exact:true}).click();
  await expect(page.locator('.run-card')).toContainText('任务已取消');
  const after=await snapshot(id);expect(after.run.status).toBe('cancelled');expect(after.project.current_version_id).toBe(before.project.current_version_id);expect(after.versions).toEqual(before.versions);
  await page.reload();await expect(page.locator('.run-card')).toContainText('任务已取消');await expect(app(page).getByRole('heading',{name:'求职投递看板'})).toBeVisible();
  await evidence(info,page,id);
});

test('fixture: lost feedback response after real commit recovers via GET without a second model call',async({page},info)=>{
  const id=await create(page);let dropped=false;
  await page.route('**/api/runs/*/feedback',async route=>{
    if(dropped){await route.continue();return;}
    const response=await route.fetch();
    await response.body(); // The actual HTTP request and database publication complete first.
    expect(response.status()).toBe(200);dropped=true;await route.abort('failed');
  });
  await send(page,'增加搜索并保留记录。');await saved(page,2);
  expect(dropped).toBe(true);const state=await snapshot(id);
  expect(state.run.status).toBe('succeeded');expect(state.run.model_calls).toBe(2);expect(state.versions).toHaveLength(2);
  await page.reload();await saved(page,2);await expect(app(page).getByLabel('公司搜索')).toBeVisible();
  const reloaded=await snapshot(id);expect(reloaded.run.id).toBe(state.run.id);expect(reloaded.run.model_calls).toBe(2);expect(reloaded.versions).toHaveLength(2);
  await evidence(info,page,id);
});

test('B-11 fixture: blocked probe bootstrap reports platform failure without model repair',async({page},info)=>{
  const id=await create(page),before=await snapshot(id);
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
    if(!descriptor?.set)throw new Error('Fixture requires the native iframe srcdoc setter');
    const originalSet=descriptor.set;
    Reflect.set(window,'__fixtureNonceFaultCount',0);
    Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{
      ...descriptor,
      set(value:string){
        let source=String(value);
        if(this.title==='候选启动检查'){
          source=source.replace(/<script nonce="[^"]*"/,'<script nonce="fixture-intentionally-invalid"');
          Reflect.set(window,'__fixtureNonceFaultCount',Number(Reflect.get(window,'__fixtureNonceFaultCount'))+1);
        }
        originalSet.call(this,source);
      },
    });
  });
  await page.reload();await saved(page,1);
  await send(page,'增加搜索并保留当前数据。');
  await expect(page.getByRole('alert').filter({hasText:'预览通信尚未就绪，请重新检查。'})).toBeVisible();
  expect(await page.evaluate(()=>Reflect.get(window,'__fixtureNonceFaultCount'))).toBeGreaterThan(0);
  const blocked=await snapshot(id);expect(blocked.run.status).toBe('awaiting_preview');expect(blocked.run.model_calls).toBe(2);expect(blocked.run.draft_attempt).toBe(1);
  expect(blocked.run.call_records.map((r:{purpose:string})=>r.purpose)).toEqual(['plan','write']);
  expect(blocked.project.current_version_id).toBe(before.project.current_version_id);expect(blocked.versions).toEqual(before.versions);
  await page.getByRole('button',{name:'取消任务',exact:true}).click();await expect(page.locator('.run-card')).toContainText('任务已取消');
  const cancelled=await snapshot(id);expect(cancelled.run.status).toBe('cancelled');expect(cancelled.run.model_calls).toBe(2);await evidence(info,page,id);
});

test('B-06 fixture: real data CAS conflict reports unsaved input and freezes stale frame writes',async({page},info)=>{
  const id=await create(page);await add(page,'原有记录',1);
  // Simulate another same-user tab through the authorized HTTP API. The token stays
  // inside the browser; it is never returned to the test process or evidence files.
  const remote=await page.evaluate(async projectId=>{
    const sessionKey=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'));
    if(!sessionKey)throw new Error('Existing anonymous session is required for the CAS fixture');
    const token=JSON.parse(localStorage.getItem(sessionKey)!).access_token;
    if(typeof token!=='string')throw new Error('Existing session has no access token');
    const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
    const response=await fetch(`/api/projects/${projectId}/data`,{headers});
    if(!response.ok)throw new Error('CAS fixture could not read current app data');
    const current=await response.json();
    const state={...current.state,jobs:[...current.state.jobs,{id:crypto.randomUUID(),company:'另一窗口的新记录',position:'后端工程师',date:'2026-09-20',stage:'面试中',notes:'外部写入保留'}]};
    const write=await fetch(`/api/projects/${projectId}/data`,{method:'PUT',headers,body:JSON.stringify({requestId:crypto.randomUUID(),versionId:current.currentVersionId,expectedRevision:current.revision,state})});
    return {status:write.status,result:await write.json()};
  },id);
  expect(remote.status).toBe(200);expect(remote.result.revision).toBe(2);
  const afterRemote=await snapshot(id),frame=app(page);let writes=0;
  const countWrite=(request:import('@playwright/test').Request)=>{if(request.method()==='PUT'&&request.url().endsWith(`/api/projects/${id}/data`))writes++;};
  page.on('request',countWrite);
  await frame.getByLabel('公司',{exact:true}).fill('尚未保存的输入');await frame.getByLabel('岗位',{exact:true}).fill('工程师');
  const conflict=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith(`/api/projects/${id}/data`));
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();expect((await conflict).status()).toBe(409);
  await expect(frame.locator('#save-message')).toContainText('未保存');await expect(page.locator('.preview-footer')).toContainText('数据已在其他窗口更新');
  await expect(frame.getByLabel('公司',{exact:true})).toHaveValue('尚未保存的输入');expect(writes).toBe(1);
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();await expect(frame.locator('#save-message')).toContainText('未保存');
  // The second operation fails in the frozen bridge, before another PUT can be sent.
  expect(writes).toBe(1);const after=await snapshot(id);expect(after.data).toEqual(afterRemote.data);
  expect(after.data.state.jobs).toHaveLength(2);expect(after.run.model_calls).toBe(2);
  page.off('request',countWrite);await evidence(info,page,id);
});

test('B-06 fixture: failed PUT transport keeps unsaved input and blocks following writes',async({page},info)=>{
  const id=await create(page);await add(page,'原有记录',1);const before=await snapshot(id);
  let writes=0;
  await page.route(`**/api/projects/${id}/data`,async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    writes++;await route.abort('failed');
  });
  const frame=app(page);
  await frame.getByLabel('公司',{exact:true}).fill('网络失败保留输入');await frame.getByLabel('岗位',{exact:true}).fill('工程师');
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(frame.locator('#save-message')).toContainText('未保存：网络连接失败');
  await expect(page.locator('.preview-footer')).toContainText('未保存：网络连接失败');
  await expect(frame.getByLabel('公司',{exact:true})).toHaveValue('网络失败保留输入');expect(writes).toBe(1);
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(frame.locator('#save-message')).toContainText('未保存：数据保存结果需要确认');expect(writes).toBe(1);
  const after=await snapshot(id);expect(after.data).toEqual(before.data);expect(after.project.current_version_id).toBe(before.project.current_version_id);
  await evidence(info,page,id);
});

test('B-06 fixture: oversized business state is rejected by SDK without sending PUT',async({page},info)=>{
  const id=await create(page);const before=await snapshot(id);let writes=0;
  const countWrite=(request:import('@playwright/test').Request)=>{if(request.method()==='PUT'&&request.url().endsWith(`/api/projects/${id}/data`))writes++;};
  page.on('request',countWrite);
  const frame=app(page),notes='中'.repeat(23000); // 69,000 UTF-8 bytes before the remaining state fields.
  await frame.getByLabel('公司',{exact:true}).fill('超限输入保留');await frame.getByLabel('岗位',{exact:true}).fill('工程师');await frame.getByLabel('备注',{exact:true}).fill(notes);
  await frame.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(frame.locator('#save-message')).toHaveText('未保存：应用数据格式、大小或嵌套层数不符合要求。');
  await expect(frame.getByLabel('公司',{exact:true})).toHaveValue('超限输入保留');await expect(frame.getByLabel('备注',{exact:true})).toHaveValue(notes);
  expect(writes).toBe(0);const after=await snapshot(id);expect(after.data).toEqual(before.data);expect(after.run.model_calls).toBe(2);
  page.off('request',countWrite);await evidence(info,page,id);
});

test('B-09 fixture: a late old-frame write cannot overwrite a newly published version or another project',async({page,context},info)=>{
  const id=await create(page);await add(page,'保留记录',1);const before=await snapshot(id);
  let release!:()=>void,received!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{received=resolve;});
  let lateStatus:number|undefined,lateCode:string|undefined;
  await page.route(`**/api/projects/${id}/data`,async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    received();await gate;
    // The old frame emitted this real authenticated PUT before publication. Delay
    // delivery, not the SQL transaction; the old versionId must now be rejected.
    const response=await route.fetch();lateCode=(await response.json()).error?.code;lateStatus=response.status();await route.fulfill({response});
  });
  const editor=await context.newPage();
  try{
    await app(page).getByLabel('公司',{exact:true}).fill('旧预览晚到写入');await app(page).getByLabel('岗位',{exact:true}).fill('不能覆盖');
    await app(page).getByRole('button',{name:'保存记录',exact:true}).click();await arrived;
    await editor.goto(`/projects/${id}`);await saved(editor,1);
    await send(editor,'增加公司搜索，保留记录。');await saved(editor,2);
    const committed=await snapshot(id);expect(committed.project.current_version_id).not.toBe(before.project.current_version_id);expect(committed.data).toEqual(before.data);
    // React unmounts the old iframe while its delayed HTTP request is still pending.
    await page.getByRole('button',{name:/新建应用/}).click();
    await expect(page).not.toHaveURL(new RegExp(`/projects/${id}$`));
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]{36}$/);const otherId=page.url().split('/').at(-1)!;
    await expect(page.locator('iframe[title="应用预览"]')).toHaveCount(0);
    release();await expect.poll(()=>lateStatus).toBe(409);expect(lateCode).toBe('ACTIVE_VERSION_CHANGED');
    const after=await snapshot(id);expect(after.data).toEqual(before.data);expect(after.project.current_version_id).toBe(committed.project.current_version_id);
    const other=await database.from('app_data').select('state,revision').eq('project_id',otherId).single();
    expect(other.error).toBeNull();expect(other.data).toEqual({state:{},revision:0});
    await expect(app(editor).locator('#jobs')).toContainText('保留记录');await expect(app(editor).locator('#jobs')).not.toContainText('旧预览晚到写入');
    await evidence(info,editor,id);
  }finally{release();await editor.close();}
});

test('B-10 fixture: native background visibility pauses candidate feedback and foreground checks the same candidate',async({},info)=>{
  if(process.platform==='linux'&&!process.env.DISPLAY)throw new Error('NOT_RUN B-10: real headed Chromium requires DISPLAY; launch Linux acceptance using xvfb-run -a. No background acceptance claimed.');
  const browser=await chromium.launch({headless:false,ignoreDefaultArgs:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const context=await browser.newContext({baseURL:'http://localhost:3001',viewport:{width:1440,height:1000}}),page=await context.newPage();
  try{
    const id=await create(page);let feedbackRequests=0;
    page.on('request',request=>{if(request.method()==='POST'&&/\/api\/runs\/[^/]+\/feedback$/.test(request.url()))feedbackRequests++;});
    const cover=await context.newPage();await cover.goto('about:blank');await page.bringToFront();
    await page.evaluate(()=>{
      Reflect.set(window,'__fixtureNativeVisibility',[]);
      Reflect.set(window,'__fixtureProbeChannels',[]);
      document.addEventListener('visibilitychange',event=>{
        Reflect.get(window,'__fixtureNativeVisibility').push({hidden:document.hidden,state:document.visibilityState,trusted:event.isTrusted,at:Date.now()});
      });
      window.addEventListener('message',event=>{
        const probe=document.querySelector<HTMLIFrameElement>('iframe[title="候选启动检查"]');
        if(event.source===probe?.contentWindow&&event.data?.namespace==='miniatoms'&&event.data?.type==='preview.booted')Reflect.get(window,'__fixtureProbeChannels').push(event.data.channelId);
      });
    });
    await send(page,'增加搜索。[fixture:slow-start]');
    // Observe a real probe boot before moving focus away; the fixture startup
    // awaits 3 seconds, leaving time to background it before the quiet window.
    await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__fixtureProbeChannels').length)).toBe(1);
    await cover.bringToFront();
    await expect.poll(()=>page.evaluate(()=>({hidden:document.hidden,state:document.visibilityState})),{timeout:5000}).toEqual({hidden:true,state:'hidden'});
    await expect.poll(async()=>(await snapshot(id)).run.status).toBe('awaiting_preview');
    const candidate=await snapshot(id);
    // Stay genuinely backgrounded longer than the complete 8-second probe window.
    // This is a real wall-clock observation, not a fake timer or visibility event.
    await new Promise(resolve=>setTimeout(resolve,8500));
    expect(await page.evaluate(()=>document.hidden)).toBe(true);
    const hidden=await snapshot(id);expect(hidden.run.status).toBe('awaiting_preview');expect(hidden.run.candidate_version_id).toBe(candidate.run.candidate_version_id);
    expect(hidden.run.model_calls).toBe(2);expect(hidden.run.draft_attempt).toBe(1);expect(hidden.run.expires_at).toBe(candidate.run.expires_at);expect(feedbackRequests).toBe(0);
    await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hidden)).toBe(false);await saved(page,2);
    const finished=await snapshot(id);expect(finished.run.id).toBe(candidate.run.id);expect(finished.run.result_version_id).toBe(candidate.run.candidate_version_id);
    expect(finished.run.expires_at).toBe(candidate.run.expires_at);expect(finished.run.model_calls).toBe(2);expect(feedbackRequests).toBe(1);
    const visibility=await page.evaluate(()=>Reflect.get(window,'__fixtureNativeVisibility'));
    const channels=await page.evaluate(()=>Reflect.get(window,'__fixtureProbeChannels'));
    expect(channels).toHaveLength(2);expect(channels[1]).not.toBe(channels[0]);
    expect(visibility).toEqual(expect.arrayContaining([expect.objectContaining({hidden:true,state:'hidden',trusted:true}),expect.objectContaining({hidden:false,state:'visible',trusted:true})]));
    await info.attach('native-background-evidence.json',{contentType:'application/json',body:JSON.stringify({mode:'fixture',browser:browser.version(),visibility,probeChannels:channels,hiddenObservationMs:8500,runId:finished.run.id,candidateId:candidate.run.candidate_version_id,modelCalls:finished.run.model_calls,expiresAt:finished.run.expires_at},null,2)});
    await evidence(info,page,id);
  }finally{
    const observation=await page.evaluate(()=>({hidden:document.hidden,state:document.visibilityState,events:Reflect.get(window,'__fixtureNativeVisibility')??[],channels:Reflect.get(window,'__fixtureProbeChannels')??[]})).catch(()=>({pageUnavailable:true}));
    await info.attach('native-visibility-observation.json',{contentType:'application/json',body:JSON.stringify({browser:browser.version(),headed:true,displayConfigured:!!process.env.DISPLAY,observation},null,2)});
    await browser.close();
  }
});
