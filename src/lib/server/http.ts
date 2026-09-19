import 'server-only';
import { z } from 'zod';
import { createProjectSchema,startRunSchema,restoreSchema,feedbackSchema,putDataSchema,cancelRunSchema,uuidSchema,normalizedDiagnostics,canonicalJson,sha256,LIMITS,type Json,type SseEventName } from '../contracts';
import { authenticate,type AuthContext } from './auth';
import { getRuntimeConfig } from './config';
import { ApiError,errorResponse } from './errors';
import { readLimitedJson } from './deepseek';
import { rpc,readOne,getRun,getVersion,runColumns,activeStatuses,runDto,projectDto,versionDto,versionMeta,messageDto,type Row,type RpcResult } from './db';
import { executeAgent } from './agent';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function body<T>(request:Request,schema:z.ZodType<T>):Promise<T>{
  let value:unknown;
  try{value=await readLimitedJson(new Response(request.body),LIMITS.requestBytes);}catch(e){if(e instanceof ApiError&&e.code==='PAYLOAD_TOO_LARGE')throw e;throw new ApiError('INVALID_REQUEST','请求不是有效 JSON。');}
  const result=schema.safeParse(value);if(!result.success)throw new ApiError('INVALID_REQUEST','请求字段不符合要求。');return result.data;
}
async function list(auth:AuthContext,table:string,projectId?:string,columns='*'){
  let query=auth.client.from(table).select(columns);if(projectId)query=query.eq('project_id',projectId);
  const result=await query;if(result.error)throw new ApiError('DATABASE_UNAVAILABLE','数据库读取失败。');return (result.data??[]) as Row[];
}
const fingerprint=(values:unknown[])=>sha256(JSON.stringify(values));
export async function handle(request:Request,params:Record<string,string>={},kind:string):Promise<Response>{
  const requestId=crypto.randomUUID();
  try{
    if(kind==='health'){
      let configured=false,model=false;
      try{const c=getRuntimeConfig();configured=true;model=Boolean(c.DEEPSEEK_API_KEY);}catch{}
      return json({status:configured&&model?'configured':'configuration_required',checks:{databaseConfigured:configured,modelConfigured:model},commit:process.env.APP_COMMIT_SHA||process.env.VERCEL_GIT_COMMIT_SHA||'local'},configured&&model?200:503);
    }
    const auth=await authenticate(request);
    const parsed:Record<string,string>={};for(const [key,value]of Object.entries(params)){const p=uuidSchema.safeParse(value);if(!p.success)throw new ApiError('INVALID_REQUEST','资源 ID 不合法。');parsed[key]=p.data;}
    const id=parsed.id;
    if(kind==='projects'){
      if(request.method==='GET'){
        const result=await auth.client.from('projects').select('*').order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(20);
        if(result.error)throw new ApiError('DATABASE_UNAVAILABLE','无法读取项目。');return json({projects:(result.data??[]).map(projectDto)});
      }
      const b=await body(request,createProjectSchema),result=await rpc('ma_create_project',{p_actor:auth.actor,p_project_id:b.requestId,p_title:b.title,p_fingerprint:await fingerprint([b.title])});
      return json({project:projectDto(result.project!)},result.action==='created'?201:200);
    }
    if(kind==='project'){
      await readOne(auth,'projects',id);await rpc('ma_expire_project_runs',{p_actor:auth.actor,p_project_id:id});
      const project=await readOne(auth,'projects',id);
      const before=new URL(request.url).searchParams.get('beforeMessageId');
      let cursor:Row|null=null;
      if(before){const p=uuidSchema.safeParse(before);if(!p.success)throw new ApiError('INVALID_CURSOR','消息游标不合法。');const {data,error}=await auth.client.from('messages').select('id,project_id,created_at').eq('id',p.data).eq('project_id',id).maybeSingle();if(error)throw new ApiError('DATABASE_UNAVAILABLE','无法读取消息游标。');if(!data)throw new ApiError('INVALID_CURSOR','消息游标不属于当前项目。');cursor=data;}
      let mq=auth.client.from('messages').select('*').eq('project_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51);
      if(cursor)mq=mq.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      const results=await Promise.all([mq,auth.client.from('versions').select('id,project_id,run_id,number,status,parent_version_id,restored_from_version_id,summary,source_hash,created_at,committed_at').eq('project_id',id).eq('status','ready').order('number',{ascending:false}).limit(100),auth.client.from('runs').select(runColumns).eq('project_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1),auth.client.from('runs').select(runColumns).eq('project_id',id).in('status',activeStatuses).limit(1)]);
      for(const r of results)if(r.error)throw new ApiError('DATABASE_UNAVAILABLE','无法读取项目详情。');
      const messages=(results[0].data??[]) as Row[],versions=(results[1].data??[]) as Row[],latest=results[2].data?.[0] as Row|undefined,active=results[3].data?.[0] as Row|undefined;
      const page=messages.slice(0,50);
      const current=project.current_version_id?await getVersion(auth,id,project.current_version_id):null;
      const candidate=active?.status==='awaiting_preview'?await getVersion(auth,id,active.candidate_version_id):null;
      return json({project:projectDto(project),currentVersion:current?versionDto(current):null,versions:versions.map(versionMeta),messages:page.reverse().map(messageDto),nextBeforeMessageId:messages.length>50?page[0].id:null,activeRun:active?runDto(active):null,latestRun:latest?runDto(latest):null,candidateVersion:candidate?versionDto(candidate):null});
    }
    if(kind==='version')return json({version:versionDto(await getVersion(auth,id,parsed.versionId))});
    if(kind==='data'){
      if(request.method==='GET'){
        const project=await readOne(auth,'projects',id),data=(await list(auth,'app_data',id))[0];
        if(!data)throw new ApiError('RESOURCE_NOT_FOUND','未找到应用数据。');return json({state:data.state,revision:data.revision,currentVersionId:project.current_version_id});
      }
      const b=await body(request,putDataSchema),f=await sha256(canonicalJson([id,b.versionId,b.expectedRevision,b.state] as Json));
      const result=await rpc('ma_put_app_data',{p_actor:auth.actor,p_project_id:id,p_request_id:b.requestId,p_version_id:b.versionId,p_expected_revision:b.expectedRevision,p_state:b.state,p_fingerprint:f});
      const r=result.result!;return json({revision:r.revision,savedAt:r.savedAt??r.updatedAt??r.updated_at});
    }
    if(kind==='run'){
      const run=await getRun(auth,id);
      return json({run:runDto(run),candidateVersion:run.status==='awaiting_preview'?versionDto(await getVersion(auth,run.project_id,run.candidate_version_id)):null,resultVersion:run.status==='succeeded'?versionDto(await getVersion(auth,run.project_id,run.result_version_id)):null});
    }
    if(kind==='cancel'){
      const b=await body(request,cancelRunSchema),result=await rpc('ma_cancel_run',{p_actor:auth.actor,p_run_id:id,p_reason:b.reason});return json({run:runDto(result.run!)});
    }
    let result:RpcResult;
    if(kind==='feedback'){
      const b=await body(request,feedbackSchema);
      result=await rpc('ma_accept_feedback',{p_actor:auth.actor,p_run_id:id,p_candidate_version_id:b.candidateVersionId,p_source_hash:b.sourceHash,p_feedback_request_id:b.requestId,p_fingerprint:await fingerprint([b.candidateVersionId,b.sourceHash,b.dataRevision,b.outcome,normalizedDiagnostics(b.diagnostics)]),p_outcome:b.outcome,p_data_revision:b.dataRevision,p_diagnostics:b.diagnostics});
    }else if(kind==='start'||kind==='restore'){
      if(kind==='start'){
        const b=await body(request,startRunSchema);
        result=await rpc('ma_start_run',{p_actor:auth.actor,p_run_id:b.requestId,p_project_id:id,p_kind:'generate',p_prompt:b.prompt,p_input_diagnostics:b.diagnostics,p_base_version_id:b.baseVersionId,p_restore_target_version_id:null,p_fingerprint:await fingerprint(['generate',id,b.prompt,b.baseVersionId,normalizedDiagnostics(b.diagnostics)])});
      }else{
        const b=await body(request,restoreSchema);
        result=await rpc('ma_start_run',{p_actor:auth.actor,p_run_id:b.requestId,p_project_id:id,p_kind:'restore',p_prompt:'',p_input_diagnostics:[],p_base_version_id:b.baseVersionId,p_restore_target_version_id:b.targetVersionId,p_fingerprint:await fingerprint(['restore',id,b.targetVersionId,b.baseVersionId])});
      }
    }else throw new ApiError('RESOURCE_NOT_FOUND','未找到此接口。');
    return stream(request,auth,result,requestId);
  }catch(error){return errorResponse(error,requestId);}
}

function stream(request:Request,auth:AuthContext,initial:RpcResult,requestId:string){
  const streamId=crypto.randomUUID(),encoder=new TextEncoder(),abort=new AbortController();let seq=0,closed=false;
  const disconnect=()=>abort.abort();request.signal.addEventListener('abort',disconnect,{once:true});
  const readable=new ReadableStream<Uint8Array>({
    async start(controller){
      let run=initial.run!;
      const emit=(event:SseEventName,current:Row,data:unknown)=>{run=current;if(closed||abort.signal.aborted)return;const payload={v:1,streamId,seq:++seq,runId:current.id,revision:current.revision,at:new Date().toISOString(),data};try{controller.enqueue(encoder.encode(`id: ${streamId}:${seq}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));}catch{disconnect();}};
      const ping=setInterval(()=>{if(!closed&&!abort.signal.aborted)try{controller.enqueue(encoder.encode(': ping\n\n'));}catch{disconnect();}},10000);
      try{
        emit('snapshot',run,{run:runDto(run)});
        const worker=Boolean(initial.token)&&(initial.action==='created'||initial.action==='repair');
        if(worker)run=await executeAgent(auth.actor,initial,abort.signal,emit);
        // A duplicate command is read-only and cannot acquire a worker token.
        if(run.status==='awaiting_preview'&&!worker){const v=await getVersion(auth,run.project_id,run.candidate_version_id);emit('candidate',run,{run:runDto(run),version:versionDto(v)});}
        if(run.status==='succeeded'){
          const project=await readOne(auth,'projects',run.project_id),version=await getVersion(auth,run.project_id,run.result_version_id);
          emit('committed',run,{run:runDto(run),project:projectDto(project),version:versionDto(version)});
        }else if(['failed','cancelled','timed_out'].includes(run.status))emit('terminal',run,{run:runDto(run)});
        emit('stream_end',run,{run:runDto(run)});
      }catch(error){
        console.error(JSON.stringify({requestId,code:error instanceof ApiError?error.code:'INTERNAL_ERROR'}));
        // If a transaction response was lost, GET is the authority. Closing without stream_end tells the client to recover.
        try{run=await getRun(auth,run.id);if(['failed','cancelled','timed_out'].includes(run.status))emit('terminal',run,{run:runDto(run)});}catch{}
      }finally{clearInterval(ping);closed=true;request.signal.removeEventListener('abort',disconnect);try{controller.close();}catch{}}
    },
    cancel(){closed=true;disconnect();},
  });
  return new Response(readable,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no'}});
}
