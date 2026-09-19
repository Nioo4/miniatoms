// Explicit local test upstream. Never imported by production source or used as a fallback.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function fixtureCompletion(request) {
  const name=request.tool_choice?.function?.name;
  if(!['plan_app','write_app'].includes(name)||request.tools?.length!==1||request.tools[0]?.function?.name!==name||request.thinking?.type!=='disabled'||request.stream!==false)
    throw new Error('Fixture requires the production forced single-tool protocol');
  let prompt='',current=null;
  for(const message of request.messages??[]){
    if(message.role!=='user'||typeof message.content!=='string')continue;
    try{const data=JSON.parse(message.content.slice(message.content.indexOf('{')));if(typeof data.request==='string')prompt=data.request;if(data.artifact)current=data.artifact;}catch{}
  }
  const prior=current?.js?.match(/fixture-features:(\{[^\n]*\})/);
  const features=prior?JSON.parse(prior[1]):{dark:false,search:false,sort:false};
  if(prompt.includes('深色'))features.dark=true;
  if(prompt.includes('搜索'))features.search=true;
  if(prompt.includes('排序'))features.sort=true;
  const plan={title:'求职投递看板',brief:'记录公司、岗位、投递日期、阶段和备注，支持新增、编辑、删除及筛选统计。',features:['记录与编辑','阶段筛选和统计','持久保存'],changeSummary:current?'修改应用并保留已有数据':'创建求职投递看板'};
  const attempt=(request.messages??[]).flatMap(m=>m.tool_calls??[]).filter(c=>c.function?.name==='write_app').length+1;
  let args=name==='plan_app'?plan:{...jobArtifact(features),summary:current?'已修改界面并保留记录':'已创建求职投递看板'};
  if(name==='write_app'){
    if(prompt.includes('[fixture:static-once]')&&attempt===1)args.js='const broken = ;';
    if((prompt.includes('[fixture:startup-once]')&&attempt===1)||prompt.includes('[fixture:startup-always]'))args.js='throw new Error("fixture 启动失败");\n'+args.js;
  }
  return {delayMs:name==='write_app'&&prompt.includes('[fixture:delay]')?20000:0,
    body:{id:'fixture-'+randomUUID(),object:'chat.completion',model:'miniatoms-local-fixture',choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'fixture-call-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}};
}

export function jobArtifact(features={dark:false,search:false,sort:false}){
  return {
    html:`<h1>求职投递看板</h1><p>明确标识的本地模型 fixture</p><form id="job-form">
<label for="company">公司</label><input id="company" required>
<label for="position">岗位</label><input id="position" required>
<label for="date">投递日期</label><input id="date" type="date" value="2026-09-20" required>
<label for="stage">当前阶段</label><select id="stage"><option>待投递</option><option>已投递</option><option>面试中</option><option>已结束</option></select>
<label for="notes">备注</label><input id="notes"><button type="submit">保存记录</button><output id="save-message" aria-live="polite"></output></form>
${features.search?'<label for="search">公司搜索</label><input id="search" placeholder="搜索公司">':''}
<label for="filter">阶段筛选</label><select id="filter"><option>全部</option><option>待投递</option><option>已投递</option><option>面试中</option><option>已结束</option></select>
${features.sort?'<button id="sort">日期升序</button>':''}<p id="stats"></p><ul id="jobs"></ul>`,
    css:`body{margin:0;font-family:system-ui;padding:20px;background:${features.dark?'#111827':'#f8fafc'};color:${features.dark?'#f9fafb':'#172554'}}h1{font-size:24px}form{display:grid;gap:8px;max-width:600px}input,select,button{font:inherit;padding:10px;border:1px solid #94a3b8;border-radius:6px;min-height:44px}button{background:#2563eb;color:white;cursor:pointer}li{padding:12px;margin:8px 0;border:1px solid #94a3b8}li button{margin:8px}label{display:block;margin-top:8px}#save-message{min-height:24px}ul{padding-left:20px}`,
    js:`// fixture-features:${JSON.stringify(features)}
const state = await appStore.getState();
const byId = id => document.getElementById(id);
let editing = null, deleting = null, descending = false;
const jobs = () => Array.isArray(state.jobs) ? state.jobs : [];
const fields = ['company','position','date','stage','notes'];
async function persist(nextJobs) {
  byId('save-message').textContent = '正在保存';
  const next = {...state, jobs: nextJobs};
  try { await appStore.setState(next); Object.assign(state, next); byId('save-message').textContent = '记录已保存'; render(); return true; }
  catch (error) { byId('save-message').textContent = '未保存：' + error.message; return false; }
}
function render() {
  const all=jobs(), filter=byId('filter').value, query=byId('search')?.value.toLowerCase() || '';
  byId('stats').textContent='共 '+all.length+' 条记录；面试中 '+all.filter(j=>j.stage==='面试中').length+' 条';
  const list=byId('jobs');list.replaceChildren();
  let shown=all.filter(j=>(filter==='全部'||j.stage===filter)&&String(j.company).toLowerCase().includes(query));
  if(byId('sort'))shown=shown.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))*(descending?-1:1));
  for(const job of shown){
    const item=document.createElement('li'),text=document.createElement('span');text.textContent=[job.company,job.position,job.date,job.stage,job.notes].join(' · ');item.append(text);
    const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>{editing=job.id;for(const key of fields)byId(key).value=job[key]||'';};item.append(edit);
    const remove=document.createElement('button');remove.textContent=deleting===job.id?'确认删除':'删除';remove.onclick=async()=>{if(deleting!==job.id){deleting=job.id;render();return;}await persist(jobs().filter(j=>j.id!==job.id));deleting=null;};item.append(remove);list.append(item);
  }
}
byId('job-form').addEventListener('submit',async event=>{
  event.preventDefault();const values=Object.fromEntries(fields.map(key=>[key,byId(key).value]));
  const next=editing?jobs().map(job=>job.id===editing?{...job,...values}:job):[...jobs(),{id:crypto.randomUUID(),...values}];
  if(await persist(next)){editing=null;byId('company').value='';byId('position').value='';byId('notes').value='';}
});
byId('filter').addEventListener('change',render);byId('search')?.addEventListener('input',render);
byId('sort')?.addEventListener('click',()=>{descending=!descending;byId('sort').textContent=descending?'日期降序':'日期升序';render();});
render();`,
  };
}

export async function startFixtureModelServer(){
  if(process.env.AI_TEST_MODE!=='fixture'||!['development','test'].includes(process.env.NODE_ENV)||process.env.VERCEL!==undefined)throw new Error('Fixture upstream is restricted to explicit local tests');
  const timers=new Set();
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/chat/completions'){res.writeHead(404).end();return;}
    const chunks=[];let bytes=0;
    try{
      for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
      const result=fixtureCompletion(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const send=()=>{if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result.body));}};
      if(result.delayMs){const timer=setTimeout(()=>{timers.delete(timer);send();},result.delayMs);timers.add(timer);res.on('close',()=>{clearTimeout(timer);timers.delete(timer);});}else send();
    }catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Fixture request protocol invalid'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
