import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './config';
import { ApiError } from './errors';

export const boundedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(10000),...(init?.signal?[init.signal]:[])])});
export async function authenticate(request:Request) {
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token) throw new ApiError('AUTH_REQUIRED','请先建立访客会话。');
  const c=getRuntimeConfig();
  if(request.method!=='GET' && request.method!=='HEAD') {
    const origin=request.headers.get('origin');
    if(origin!==null && origin!==c.APP_ORIGIN) throw new ApiError('ORIGIN_DENIED','请求来源不被允许。');
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw new ApiError('INVALID_REQUEST','请求必须使用 JSON。');
  }
  const client=createClient(c.NEXT_PUBLIC_SUPABASE_URL,c.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:boundedFetch}});
  let result;
  try {result=await client.auth.getUser(token);}catch {throw new ApiError('AUTH_UNAVAILABLE','身份服务暂时不可用。');}
  if(result.error) throw new ApiError(result.error.status && result.error.status<500?'AUTH_EXPIRED':'AUTH_UNAVAILABLE','访客会话验证失败，请重试。');
  if(!result.data.user) throw new ApiError('AUTH_EXPIRED','访客会话已过期。');
  return {actor:result.data.user.id,client};
}
export type AuthContext=Awaited<ReturnType<typeof authenticate>>;
