import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),execute:vi.fn(),read:vi.fn(),version:vi.fn()}));
vi.mock('../../src/lib/server/auth',()=>({authenticate:mocks.auth,boundedFetch:fetch}));
vi.mock('../../src/lib/server/agent',()=>({executeAgent:mocks.execute}));
vi.mock('../../src/lib/server/db',async importOriginal=>({...await importOriginal<typeof import('../../src/lib/server/db')>(),rpc:mocks.rpc,readOne:mocks.read,getVersion:mocks.version}));
import { handle } from '../../src/lib/server/http';
import { ApiError } from '../../src/lib/server/errors';
const id='a93899bd-0a5e-4c22-9da0-4f74c82c9258';
const run={id,project_id:id,kind:'generate',status:'planning',revision:1,base_version_id:null,candidate_version_id:null,result_version_id:null,model_calls:0,draft_attempt:0,plan:null,diagnostics:[],created_at:new Date().toISOString(),expires_at:new Date(Date.now()+240000).toISOString(),finished_at:null};
const request=(payload:unknown)=>new Request('http://localhost:3000/api/projects/'+id+'/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({actor:'verified-actor',client:{}});});
describe('HTTP request validation and idempotent streams',()=>{
  it('rejects unknown ownerId before any database mutation',async()=>{
    const result=await handle(request({requestId:id,prompt:'需求',baseVersionId:null,ownerId:'other'}),{id},'start');
    expect(result.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('limits actual request bytes independent of content-length',async()=>{
    const result=await handle(request({prompt:'中'.repeat(90000)}),{id},'start');
    expect(result.status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('never trusts request identity or exposes auth internals',async()=>{
    mocks.auth.mockRejectedValue(new ApiError('AUTH_EXPIRED','会话过期。'));
    const result=await handle(request({requestId:id,prompt:'需求',baseVersionId:null}),{id},'start');
    expect(result.status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect((await result.json()).error.requestId).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('same start replay only emits snapshot and stream_end without a worker',async()=>{
    mocks.rpc.mockResolvedValue({applied:false,action:'duplicate',run,token:null});
    const result=await handle(request({requestId:id.toUpperCase(),prompt:'  需求  ',baseVersionId:null}),{id:id.toUpperCase()},'start');
    const text=await result.text();
    expect(result.headers.get('content-type')).toContain('text/event-stream');expect(text).toContain('event: snapshot');expect(text).toContain('event: stream_end');expect(text).not.toContain('event: committed');expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_actor:'verified-actor',p_run_id:id,p_project_id:id,p_prompt:'需求'});
    expect(text).not.toContain('execution_token');expect(text).not.toContain('agent_messages');
  });
  it('streams SQL-committed feedback without a follow-up tool-result write',async()=>{
    const completed={...run,status:'succeeded',result_version_id:id,revision:8,finished_at:new Date().toISOString()};
    mocks.rpc.mockResolvedValue({applied:true,action:'committed',run:completed,token:null});
    mocks.read.mockResolvedValue({id,title:'项目',brief:'需求',current_version_id:id,context_epoch:0,created_at:run.created_at,updated_at:run.created_at});
    mocks.version.mockResolvedValue({id,project_id:id,run_id:id,number:1,status:'ready',parent_version_id:null,restored_from_version_id:null,summary:'完成',source_hash:'a'.repeat(64),created_at:run.created_at,committed_at:run.created_at,artifact:{html:'<p>完成</p>',css:'',js:'void 0;'},plan:{title:'项目',brief:'需求',features:['界面'],changeSummary:'创建'}});
    const response=await handle(request({requestId:id,candidateVersionId:id,sourceHash:'a'.repeat(64),dataRevision:0,outcome:'ready',diagnostics:[]}),{id},'feedback');
    const text=await response.text();expect(text).toContain('event: committed');expect(text).toContain('"revision":8');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls[0][0]).toBe('ma_accept_feedback');expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('replayed error feedback cannot claim a second repair worker',async()=>{
    mocks.rpc.mockResolvedValue({applied:false,action:'duplicate',run:{...run,status:'repairing'},token:null});
    const response=await handle(request({requestId:id,candidateVersionId:id,sourceHash:'a'.repeat(64),dataRevision:0,outcome:'errors',diagnostics:[{code:'PREVIEW',message:'启动失败',file:'preview',line:null,column:null}]}),{id},'feedback');
    expect(await response.text()).toContain('event: stream_end');expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('cancellation after commit returns the successful SQL state unchanged',async()=>{
    mocks.rpc.mockResolvedValue({applied:false,run:{...run,status:'succeeded',result_version_id:id,finished_at:run.created_at}});
    const response=await handle(request({reason:'user'}),{id},'cancel');
    expect((await response.json()).run.status).toBe('succeeded');expect(mocks.execute).not.toHaveBeenCalled();
  });
});
