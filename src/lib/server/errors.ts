import 'server-only';
import { ERROR_STATUS, type ErrorCode } from '../contracts';

const messages:Record<ErrorCode,string>={
  INVALID_REQUEST:'请求字段不符合要求，请检查输入。',
  INVALID_CURSOR:'消息游标无效，请重新加载对话。',
  AUTH_REQUIRED:'请先建立访客会话。',AUTH_EXPIRED:'访客会话已过期，请重新验证。',
  ORIGIN_DENIED:'请求来源不被允许，请检查应用地址配置。',
  RESOURCE_NOT_FOUND:'未找到此资源。',
  BASE_VERSION_CONFLICT:'项目已有新版本，请刷新后重新确认修改。',
  RUN_IN_PROGRESS:'此项目已有任务正在运行，请等待完成或取消已有任务。',
  IDEMPOTENCY_CONFLICT:'此请求编号已用于不同内容，请停止重传并重新操作。',
  RUN_STATE_CONFLICT:'任务状态已经改变，请查询最新状态。',
  CANDIDATE_STALE:'此候选版本已失效，请加载最新任务状态。',
  PREVIEW_DATA_CHANGED:'应用数据已改变，请重新读取数据并检查同一候选版本。',
  ACTIVE_VERSION_CHANGED:'当前应用版本已改变，请重新载入应用后保存。',
  DATA_REVISION_CONFLICT:'数据已在其他窗口更新，请重新载入应用。',
  ALREADY_CURRENT:'所选历史版本已经是当前版本，无需恢复。',
  RESOURCE_LIMIT:'已达到项目数、历史版本数或项目当日任务容量上限。',
  PAYLOAD_TOO_LARGE:'请求内容超出大小限制，请减少内容后重试。',
  QUOTA_EXCEEDED:'今日模型调用额度已用完，请在额度重置后重试。',
  MODEL_AUTH_FAILED:'模型服务鉴权失败，请检查服务端模型配置。',
  MODEL_UNAVAILABLE:'模型服务暂时不可用，原版本已保留。',
  MODEL_RESPONSE_INVALID:'模型响应不符合生成协议，原版本已保留。',
  MODEL_OUTPUT_TRUNCATED:'模型输出达到长度限制，请缩小需求后重试。',
  CONFIGURATION_REQUIRED:'应用尚未完成服务端配置。',
  DATABASE_UNAVAILABLE:'数据库暂时不可用，请稍后查询任务状态。',
  AUTH_UNAVAILABLE:'身份服务暂时不可用，请稍后重试。',
  INTERNAL_ERROR:'服务暂时无法完成请求。',
};
export const errorMessage=(code:string):string=>messages[code as ErrorCode]??messages.INTERNAL_ERROR;
export class ApiError extends Error {
  constructor(public code:string, message=errorMessage(code), public details?:Record<string,unknown>) { super(message); }
  get status() { return ERROR_STATUS[this.code as ErrorCode] ?? 500; }
}
export function safeError(error:unknown):ApiError { return error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR','服务暂时无法完成请求。'); }
export function errorResponse(error:unknown, requestId:string) {
  const e=safeError(error);
  // Log only allowlisted metadata; never payloads, upstream bodies or credentials.
  console.error(JSON.stringify({requestId,code:e.code}));
  return Response.json({error:{code:e.code,message:e.message,requestId,...(e.details?{details:e.details}:{})}}, {status:e.status,headers:{'Cache-Control':'private, no-store'}});
}
