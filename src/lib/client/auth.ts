import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
let initialization: Promise<Session> | undefined;
export function getAuthClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("尚未配置匿名登录。请配置 Supabase 公开环境变量并重新构建应用。");
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) },
    });
  }
  return client;
}

export function initializeSession(): Promise<Session> {
  if (!initialization) initialization = (async () => {
    const auth = getAuthClient().auth;
    const existing = await auth.getSession();
    if (existing.error) throw new Error("无法读取原有访客会话，请稍后重试。");
    if (existing.data.session) {
      if ((existing.data.session.expires_at ?? 0) * 1000 > Date.now() + 30000) return existing.data.session;
      return refreshSession();
    }
    const created = await auth.signInAnonymously();
    if (created.error || !created.data.session) throw new Error("访客登录暂不可用，请确认已启用 Supabase Anonymous Sign-ins 后重试。");
    return created.data.session;
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

export async function refreshSession() {
  const result = await getAuthClient().auth.refreshSession();
  if (result.error || !result.data.session) throw new Error("访客会话已失效，无法恢复原身份。请检查登录服务后重试。");
  return result.data.session;
}

export async function accessToken() {
  await initializeSession();
  const result = await getAuthClient().auth.getSession();
  if (result.error || !result.data.session) throw new Error("访客会话不可用，请重新载入页面。");
  return result.data.session.access_token;
}
