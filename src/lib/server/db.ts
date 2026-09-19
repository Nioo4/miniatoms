import 'server-only';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from './auth';
import { boundedFetch } from './auth';
import { getRuntimeConfig } from './config';
import { ApiError,errorMessage } from './errors';
import { ERROR_STATUS,type RunDto,type ProjectDto,type VersionDetail,type VersionMeta,type MessageDto } from '../contracts';

// Internal RPC records are never forwarded to the browser. Explicit DTO mappings below.
export type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type RpcResult={applied:boolean;action?:string;run?:Row;project?:Row;candidate?:Row;token?:string|null;currentVersion?:Row|null;restoreVersion?:Row|null;current_version?:Row|null;restore_version?:Row|null;messages?:Row[];result?:Row};
let admin:SupabaseClient|undefined;
function getAdmin() {const c=getRuntimeConfig();return admin??=createClient(c.NEXT_PUBLIC_SUPABASE_URL,c.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}});}
export async function rpc(name:string,args:Record<string,unknown>):Promise<RpcResult> {
  let response;
  try{response=await getAdmin().rpc(name,args);}catch{throw new ApiError('DATABASE_UNAVAILABLE','数据库暂时不可用，请查询任务状态。');}
  if(response.error){
    const e=response.error;
    if(e.code==='P0001' && Object.hasOwn(ERROR_STATUS,e.message)) {
      let details:Record<string,unknown>|undefined;
      try { const d=JSON.parse(e.details);details={}; for(const key of ['currentVersionId','activeRunId','revision','resetAt']) if(d[key]!==undefined)details[key]=d[key]; }catch{}
      throw new ApiError(e.message,errorMessage(e.message),details);
    }
    throw new ApiError('DATABASE_UNAVAILABLE','数据库暂时不可用，请查询任务状态。');
  }
  return response.data as RpcResult;
}
export const runColumns='id,project_id,owner_id,kind,status,revision,base_version_id,candidate_version_id,result_version_id,model_calls,draft_attempt,plan,diagnostics,error_code,error_message,created_at,expires_at,finished_at';
export const activeStatuses=['planning','generating','validating','awaiting_preview','repairing'];
export function runDto(r:Row):RunDto {return {id:r.id,projectId:r.project_id,kind:r.kind,status:r.status,revision:r.revision,baseVersionId:r.base_version_id,candidateVersionId:r.candidate_version_id,resultVersionId:r.result_version_id,modelCalls:r.model_calls,draftAttempt:r.draft_attempt,plan:r.plan,diagnostics:r.diagnostics??[],error:r.error_code?{code:r.error_code,message:r.error_message}:null,createdAt:r.created_at,expiresAt:r.expires_at,finishedAt:r.finished_at};}
export function projectDto(r:Row):ProjectDto{return {id:r.id,title:r.title,brief:r.brief,currentVersionId:r.current_version_id,contextEpoch:r.context_epoch,createdAt:r.created_at,updatedAt:r.updated_at};}
export function versionMeta(r:Row):VersionMeta{return {id:r.id,projectId:r.project_id,runId:r.run_id,number:r.number,status:r.status,parentVersionId:r.parent_version_id,restoredFromVersionId:r.restored_from_version_id,summary:r.summary,sourceHash:r.source_hash,createdAt:r.created_at,committedAt:r.committed_at};}
export function versionDto(r:Row):VersionDetail{return {...versionMeta(r),artifact:r.artifact,plan:r.plan};}
export function messageDto(r:Row):MessageDto{return {id:r.id,projectId:r.project_id,runId:r.run_id,role:r.role,kind:r.kind,content:r.content,contextEpoch:r.context_epoch,createdAt:r.created_at};}
export async function readOne(auth:AuthContext,table:string,id:string,columns='*'):Promise<Row>{
  const {data,error}=await auth.client.from(table).select(columns).eq('id',id).maybeSingle();
  if(error)throw new ApiError('DATABASE_UNAVAILABLE','数据库读取失败。');
  if(!data)throw new ApiError('RESOURCE_NOT_FOUND','未找到此资源。');
  return data as Row;
}
export async function getRun(auth:AuthContext,id:string){const r=await readOne(auth,'runs',id,runColumns);await rpc('ma_expire_project_runs',{p_actor:auth.actor,p_project_id:r.project_id});return readOne(auth,'runs',id,runColumns);}
export async function getVersion(auth:AuthContext,projectId:string,id:string){
  const v=await readOne(auth,'versions',id);
  if(v.project_id!==projectId || v.status==='rejected')throw new ApiError('RESOURCE_NOT_FOUND','未找到此版本。');
  if(v.status==='candidate'){const r=await readOne(auth,'runs',v.run_id,runColumns);if(r.status!=='awaiting_preview'||r.candidate_version_id!==id)throw new ApiError('RESOURCE_NOT_FOUND','未找到此版本。');}
  return v;
}
