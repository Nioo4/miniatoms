import { spawn } from 'node:child_process';
import { localConfig } from '../tests/integration/local-config.mjs';
import { startFixtureModelServer } from '../tests/fixtures/model-server.mjs';

const children=[];let fixture;
function launch(args,env){const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true,detached:process.platform!=='win32'});children.push(child);return child;}
async function stop(){
  for(const child of children.reverse()){
    if(child.exitCode!==null)continue;
    if(process.platform==='win32')await new Promise(resolve=>{const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('exit',resolve);kill.on('error',resolve);});
    else try{process.kill(-child.pid,'SIGTERM');}catch{}
  }
  await fixture?.close();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().finally(()=>process.exit(1));});
try{
  const c=localConfig();
  try{for(const [path,key]of [['/auth/v1/health',c.anonKey],['/rest/v1/projects?select=id&limit=0',c.serviceKey]]){
    const response=await fetch(c.url+path,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('unavailable');await response.body?.cancel();
  }}catch{throw new Error('BLOCKED: local Supabase Auth/schema unavailable; run db:start and db:reset:test. No workbench test was passed.');}
  const env={...process.env,NODE_ENV:'development',AI_TEST_MODE:'fixture',APP_ORIGIN:'http://localhost:3001',
    NEXT_PUBLIC_SUPABASE_URL:c.url,NEXT_PUBLIC_SUPABASE_ANON_KEY:c.anonKey,SUPABASE_SERVICE_ROLE_KEY:c.serviceKey,
    SUPABASE_TEST_URL:c.url,SUPABASE_TEST_ANON_KEY:c.anonKey,SUPABASE_TEST_SERVICE_ROLE_KEY:c.serviceKey,
    DEEPSEEK_API_KEY:'explicit-local-fixture-key',DEEPSEEK_MODEL:'miniatoms-local-fixture',LLM_USER_DAILY_LIMIT:'200',LLM_GLOBAL_DAILY_LIMIT:'1000'};
  delete env.VERCEL;process.env.AI_TEST_MODE='fixture';process.env.NODE_ENV='test';delete process.env.VERCEL;
  fixture=await startFixtureModelServer();env.DEEPSEEK_BASE_URL=fixture.url;
  console.log(JSON.stringify({mode:'fixture',baseUrl:env.APP_ORIGIN,database:c.url,model:env.DEEPSEEK_MODEL,commit:env.APP_COMMIT_SHA??'local'}));
  const next=launch(['node_modules/next/dist/bin/next','dev','--hostname','localhost','--port','3001'],env);
  const deadline=Date.now()+120000;let ready=false;
  while(Date.now()<deadline){
    if(next.exitCode!==null)throw new Error('Next fixture server exited before readiness.');
    try{const response=await fetch(env.APP_ORIGIN+'/api/health',{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw new Error('Next fixture server did not become ready.');
  const test=launch(['node_modules/@playwright/test/cli.js','test','--config','playwright.workbench.config.ts'],{...env,NODE_ENV:'test'});
  const code=await new Promise((resolve,reject)=>{test.once('exit',code=>resolve(code??1));test.once('error',reject);});
  process.exitCode=code;
}catch(error){console.error(error instanceof Error?error.message:'Workbench fixture execution failed');process.exitCode=1;}
finally{await stop();}
