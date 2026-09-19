import { describe,it,expect,vi,beforeEach } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),model:vi.fn(),validate:vi.fn()}));
vi.mock('../../src/lib/server/db',()=>({rpc:mocks.rpc,runDto:(r:unknown)=>r,versionDto:(v:unknown)=>v}));
vi.mock('../../src/lib/server/deepseek',()=>({callModel:mocks.model}));
vi.mock('../../src/lib/server/validate-artifact',()=>({validateArtifact:mocks.validate}));
vi.mock('../../src/lib/server/config',()=>({getRuntimeConfig:()=>({DEEPSEEK_API_KEY:'fixture',LLM_USER_DAILY_LIMIT:20,LLM_GLOBAL_DAILY_LIMIT:100})}));
import { executeAgent } from '../../src/lib/server/agent';
type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const plan={title:'应用',brief:'需求',features:['保存'],changeSummary:'创建应用'};
let run:Row;
beforeEach(()=>{
  vi.clearAllMocks();
  run={id:'run',project_id:'project',kind:'generate',status:'planning',execution_token:'token',expires_at:new Date(Date.now()+240000).toISOString(),draft_attempt:0,model_calls:0,agent_messages:[],call_records:[],prompt:'做一个应用'};
  mocks.rpc.mockImplementation(async(name:string,p:Row)=>{
    if(name==='ma_get_run_context')return {run:{...run},token:run.execution_token,messages:[]};
    if(name==='ma_reserve_model_call'){
      expect(p.p_user_daily_limit).toBe(20);expect(p.p_global_daily_limit).toBe(100);
      run.model_calls++;if(p.p_purpose==='write')run.draft_attempt++;
      run.call_records.push({index:run.model_calls,purpose:p.p_purpose,startedAt:new Date().toISOString(),status:'reserved'});
    }else if(name==='ma_update_run'){
      run.status=p.p_next_status;
      for(const [key,value]of Object.entries(p.p_patch))run[({agentMessages:'agent_messages',callRecords:'call_records'} as Row)[key]??key]=value;
    }else if(name==='ma_finish_run'){
      if(run.execution_token!==p.p_token||run.finished_at)return {applied:false,run:{...run}};
      run.status=p.p_terminal_status;run.error=p.p_error;run.execution_token=null;
    }
    else if(name==='ma_stage_candidate'){run.status='awaiting_preview';run.execution_token=null;return {applied:true,run:{...run},candidate:{id:'candidate'}};}
    return {applied:true,run:{...run}};
  });
  mocks.model.mockImplementation(async(name:string)=>{
    const call={id:`actual-${run.model_calls}`,type:'function',function:{name,arguments:JSON.stringify(name==='plan_app'?plan:{html:'<p>应用</p>',css:'',js:'await appStore.getState();',summary:'已创建'})}};
    return {message:{role:'assistant',content:null,tool_calls:[call]},call,responseId:'response',usage:{promptTokens:null,completionTokens:null,totalTokens:null}};
  });
  mocks.validate.mockResolvedValue([]);
});
describe('U-05 bounded agent',()=>{
  it('reserves each actual call, preserves unresolved candidate tool call and stages only',async()=>{
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(result.status).toBe('awaiting_preview');expect(mocks.model).toHaveBeenCalledTimes(2);
    expect(run.agent_messages.at(-1).role).toBe('assistant');
    expect(run.agent_messages.filter((m:Row)=>m.role==='tool')).toHaveLength(1);
    expect(mocks.rpc.mock.calls.some(([name])=>name==='ma_accept_feedback')).toBe(false);
  });
  it('fails after precisely 3 write attempts and 4 total calls',async()=>{
    mocks.validate.mockResolvedValue([{code:'SYNTAX',message:'真实错误',file:'js',line:1,column:1}]);
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(result.status).toBe('failed');expect(result.error.code).toBe('REPAIR_EXHAUSTED');expect(mocks.model).toHaveBeenCalledTimes(4);expect(run.draft_attempt).toBe(3);
    expect(run.agent_messages.filter((m:Row)=>m.role==='tool').map((m:Row)=>m.tool_call_id)).toEqual(['actual-1','actual-2','actual-3','actual-4']);
    expect(mocks.rpc.mock.calls.some(([name])=>name==='ma_stage_candidate')).toBe(false);
  });
  it('does not retry platform/model errors as code repair',async()=>{
    mocks.model.mockRejectedValue(new Error('network failed'));
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(result.status).toBe('failed');expect(mocks.model).toHaveBeenCalledTimes(1);expect(run.draft_attempt).toBe(0);
  });
  it('restores exactly the stored artifact without model reservation or tool messages',async()=>{
    const artifact={html:'<p>旧版</p>',css:'p { color: blue }',js:'await appStore.getState();'};
    run.kind='restore';run.status='validating';run.plan=plan;
    const defaultRpc=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,p:Row)=>name==='ma_get_run_context'?{run:{...run},token:'token',restoreVersion:{artifact,plan,summary:'恢复旧版'}}:defaultRpc(name,p));
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(result.status).toBe('awaiting_preview');expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.filter(([name])=>name==='ma_reserve_model_call')).toHaveLength(0);
    expect(mocks.rpc.mock.calls.find(([name])=>name==='ma_stage_candidate')?.[1]).toMatchObject({p_artifact:artifact,p_plan:plan,p_agent_messages:[]});
    expect(run.model_calls).toBe(0);expect(run.draft_attempt).toBe(0);
  });
  it('resumes preview errors from SQL tool result and never appends a duplicate',async()=>{
    const priorCall={id:'original-write',type:'function',function:{name:'write_app',arguments:'{}'}};
    const result={role:'tool',tool_call_id:'original-write',content:JSON.stringify({ok:false,stage:'preview',diagnostics:[{message:'启动错误'}]})};
    run.status='repairing';run.model_calls=2;run.draft_attempt=1;run.plan=plan;
    run.agent_messages=[{role:'system',content:'protocol'},{role:'assistant',content:null,tool_calls:[priorCall]},result];
    run.call_records=[{index:1,purpose:'plan',status:'ok'},{index:2,purpose:'write',status:'ok'}];
    const completed=await executeAgent('actor',{applied:true,action:'repair',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(completed.status).toBe('awaiting_preview');expect(mocks.model).toHaveBeenCalledTimes(1);expect(mocks.model.mock.calls[0][0]).toBe('write_app');
    expect(run.agent_messages.filter((m:Row)=>m.role==='tool'&&m.tool_call_id==='original-write')).toEqual([result]);
    expect(run.draft_attempt).toBe(2);expect(run.model_calls).toBe(3);
    expect(run.agent_messages.at(-1).role).toBe('assistant');
  });
  it('discards a model result if cancellation revoked the worker token',async()=>{
    const original=mocks.model.getMockImplementation()!;
    mocks.model.mockImplementation(async(name:string)=>{
      const result=await original(name);run.status='cancelled';run.execution_token=null;run.finished_at=new Date().toISOString();return result;
    });
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(result.status).toBe('cancelled');expect(mocks.model).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls.some(([name])=>name==='ma_stage_candidate')).toBe(false);
  });
  it('lets SQL decide timeout instead of using the worker clock to demand a forbidden transition',async()=>{
    run.expires_at=new Date(Date.now()-1000).toISOString();
    const result=await executeAgent('actor',{applied:true,action:'created',run:{...run},token:'token'},new AbortController().signal,vi.fn());
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.find(([name])=>name==='ma_finish_run')?.[1].p_terminal_status).toBe('failed');
    expect(result.error.code).toBe('MODEL_UNAVAILABLE');
  });
});
