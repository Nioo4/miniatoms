import 'server-only';
import { z } from 'zod';
import { ApiError } from './errors';

const schema=z.object({
  NEXT_PUBLIC_SUPABASE_URL:z.url(), NEXT_PUBLIC_SUPABASE_ANON_KEY:z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY:z.string().min(1), DEEPSEEK_API_KEY:z.string().optional(),
  DEEPSEEK_BASE_URL:z.url().default('https://api.deepseek.com'), DEEPSEEK_MODEL:z.string().min(1).default('deepseek-flash'),
  LLM_USER_DAILY_LIMIT:z.coerce.number().int().min(0).max(1000000).default(20),
  LLM_GLOBAL_DAILY_LIMIT:z.coerce.number().int().min(0).max(1000000).default(100),
  APP_ORIGIN:z.url().default('http://localhost:3000'), APP_COMMIT_SHA:z.string().default('local'),
  AI_TEST_MODE:z.enum(['off','fixture']).default('off'), NODE_ENV:z.string().optional(), VERCEL:z.string().optional(),
});
export function parseRuntimeConfig(env:Record<string,string|undefined>) {
  const parsed=schema.safeParse(env);
  if(!parsed.success) throw new ApiError('CONFIGURATION_REQUIRED','请先配置服务端环境变量。');
  const c=parsed.data, origin=new URL(c.APP_ORIGIN), base=new URL(c.DEEPSEEK_BASE_URL);
  const local=(hostname:string)=>['localhost','127.0.0.1'].includes(hostname);
  const fixture=c.AI_TEST_MODE==='fixture';
  if(c.APP_ORIGIN!==origin.origin || (fixture && (!['test','development'].includes(c.NODE_ENV??'') || c.VERCEL!==undefined || !local(origin.hostname))) ||
    (!fixture && (base.protocol!=='https:' || local(base.hostname))) || (fixture && base.protocol!=='https:' && !(base.protocol==='http:'&&local(base.hostname))) ||
    (c.VERCEL!==undefined&&origin.protocol!=='https:') ||
    (c.NODE_ENV==='production' && origin.protocol!=='https:' && !local(origin.hostname)))
    throw new ApiError('CONFIGURATION_REQUIRED','服务地址或测试模式配置不合法。');
  return c;
}
let cached:ReturnType<typeof parseRuntimeConfig>|undefined;
export function getRuntimeConfig() { return cached??=parseRuntimeConfig(process.env); }
