import 'server-only';
import { z } from 'zod';
import { planSchema,writeAppSchema,LIMITS } from '../contracts';
import { getRuntimeConfig } from './config';
import { ApiError } from './errors';

export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type ModelMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
export type ModelResult={message:ModelMessage;call:ToolCall;responseId:string|null;usage:{promptTokens:number|null;completionTokens:number|null;totalTokens:number|null}};
export type ModelObservation=Pick<ModelResult,'responseId'|'usage'>;
export async function readLimitedJson(response:Response,limit:number):Promise<unknown>{
  if(!response.body)throw new ApiError('MODEL_RESPONSE_INVALID','响应内容为空。');
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError('PAYLOAD_TOO_LARGE','响应内容超出限制。');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new ApiError('MODEL_RESPONSE_INVALID','响应不是有效 JSON。');}
}
export function parseModelResponse(value:unknown,name:'plan_app'|'write_app'):ModelResult {
  const envelope=z.object({id:z.string().optional(),choices:z.array(z.object({finish_reason:z.string().nullable(),message:z.object({role:z.literal('assistant'),content:z.string().nullable().optional(),tool_calls:z.array(z.object({id:z.string().min(1),type:z.literal('function'),function:z.object({name:z.string(),arguments:z.string()})})).optional()})})).min(1),usage:z.object({prompt_tokens:z.number().nonnegative().optional(),completion_tokens:z.number().nonnegative().optional(),total_tokens:z.number().nonnegative().optional()}).optional()}).safeParse(value);
  if(!envelope.success)throw new ApiError('MODEL_RESPONSE_INVALID','模型返回了无法识别的响应。');
  const e=envelope.data,c=e.choices[0];
  const observation:ModelObservation={responseId:e.id??null,usage:{promptTokens:e.usage?.prompt_tokens??null,completionTokens:e.usage?.completion_tokens??null,totalTokens:e.usage?.total_tokens??null}};
  if(c.finish_reason==='length')throw Object.assign(new ApiError('MODEL_OUTPUT_TRUNCATED','模型输出达到长度限制，请缩小需求后重试。'),{observation});
  const calls=c.message.tool_calls;
  if(calls?.length!==1||calls[0].function.name!==name)throw Object.assign(new ApiError('MODEL_RESPONSE_INVALID','模型未按指定工具协议生成。'),{observation});
  return {message:{role:'assistant',content:c.message.content??null,tool_calls:calls},call:calls[0],...observation};
}
export async function callModel(name:'plan_app'|'write_app',messages:ModelMessage[],signal:AbortSignal):Promise<ModelResult>{
  const c=getRuntimeConfig();if(!c.DEEPSEEK_API_KEY)throw new ApiError('CONFIGURATION_REQUIRED','尚未配置模型密钥。');
  const parameters=z.toJSONSchema(name==='plan_app'?planSchema:writeAppSchema);
  let response:Response;
  try{response=await fetch(c.DEEPSEEK_BASE_URL.replace(/\/+$/,'')+'/chat/completions',{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${c.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:c.DEEPSEEK_MODEL,thinking:{type:'disabled'},stream:false,temperature:0.3,max_tokens:name==='plan_app'?1024:8192,messages,tools:[{type:'function',function:{name,description:name==='plan_app'?'整理完整应用需求和本轮变更，不声称功能已经验证。':'提供完整 HTML、CSS 和异步 JS 函数体，等待宿主校验。',parameters}}],tool_choice:{type:'function',function:{name}}})});}
  catch{throw new ApiError('MODEL_UNAVAILABLE','模型连接失败或超时。');}
  if(!response.ok){await response.body?.cancel();throw new ApiError([401,403].includes(response.status)?'MODEL_AUTH_FAILED':'MODEL_UNAVAILABLE','模型服务暂时不可用。');}
  try{return parseModelResponse(await readLimitedJson(response,LIMITS.modelResponseBytes),name);}catch(e){if(e instanceof ApiError&&e.code==='PAYLOAD_TOO_LARGE')throw new ApiError('MODEL_RESPONSE_INVALID','模型响应超出大小限制。');throw e;}
}
