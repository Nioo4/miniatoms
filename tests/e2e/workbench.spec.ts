import { test,expect,type Page,type TestInfo } from '@playwright/test';
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
  await expect(page.locator('.preview-toolbar')).toContainText(`v${number} · 基础检查通过`);
  await expect(page.locator('.run-card')).toContainText('新版本已保存');
  await expect(app(page).getByRole('heading',{name:'求职投递看板'})).toBeVisible();
}
async function send(page:Page,prompt:string){
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
  const run=await database.from('runs').select('id,kind,status,model_calls,draft_attempt,error_code,result_version_id,agent_messages,call_records').eq('project_id',projectId).order('created_at',{ascending:false}).limit(1).single();
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

test('fixture: generate → persist records → modify → refresh → history restore keeps data',async({page},info)=>{
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
