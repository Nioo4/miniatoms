import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

export const EMAIL_AUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_EMAIL_AUTH === "true";
const RECOVERY_STATUS_KEY = "miniatoms_email_recovery_status";
export type RecoveryStatus = "none" | "email_pending" | "password_pending" | "ready";
export type AuthIdentity = {
  id: string;
  isAnonymous: boolean;
  email: string | null;
  pendingEmail: string | null;
  recoveryStatus: RecoveryStatus;
};

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

function readRecoveryStatus(user: User): RecoveryStatus {
  const value = user.user_metadata?.[RECOVERY_STATUS_KEY];
  const serverConfirmed = !!user.email_confirmed_at && user.is_anonymous !== true && !user.new_email;
  if (value === "ready") return serverConfirmed ? "ready" : "none";
  if (value === "password_pending") return serverConfirmed ? "password_pending" : user.new_email ? "email_pending" : "none";
  if (value === "email_pending") return serverConfirmed ? "password_pending" : "email_pending";
  return "none";
}

export function authIdentity(session: Session | null): AuthIdentity | null {
  const user = session?.user;
  if (!user) return null;
  return {
    id: user.id,
    isAnonymous: user.is_anonymous === true,
    email: user.email ?? null,
    pendingEmail: user.new_email ?? null,
    recoveryStatus: readRecoveryStatus(user),
  };
}

function mergeRecoveryMetadata(user: User, status: RecoveryStatus) {
  return { ...user.user_metadata, [RECOVERY_STATUS_KEY]: status };
}

function authActionError(error: { message?: string; code?: string; status?: number }, fallback: string) {
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (detail.includes("manual linking") || detail.includes("identity") || detail.includes("linking")) {
    return new Error("邮箱绑定暂不可用，请在 Supabase Auth 开启 Allow manual linking 后重试。");
  }
  if (detail.includes("email") && (detail.includes("confirm") || detail.includes("verification"))) {
    return new Error("邮箱尚未确认，请先完成邮件中的 6 位验证码验证。");
  }
  return new Error(fallback);
}

async function currentUser() {
  const result = await getAuthClient().auth.getUser();
  if (result.error || !result.data.user) throw new Error("当前会话不可用，请重新载入页面。");
  return result.data.user;
}

export async function linkEmail(email: string) {
  if (!EMAIL_AUTH_ENABLED) throw new Error("邮箱保护尚未启用。");
  const user = await currentUser();
  if (user.is_anonymous !== true) throw new Error("当前身份已经是永久账号，无需重复绑定。");
  const result = await getAuthClient().auth.updateUser({ email, data: mergeRecoveryMetadata(user, "email_pending") });
  if (result.error || !result.data.user) throw authActionError(result.error ?? {}, "邮箱绑定请求失败，请稍后重试。");
  if (result.data.user.id !== user.id) throw new Error("邮箱绑定未保留原身份，已停止后续操作。");
  return result.data.user;
}

export async function verifyEmailOtp(email: string, token: string) {
  if (!EMAIL_AUTH_ENABLED) throw new Error("邮箱保护尚未启用。");
  const before = await currentUser();
  const pendingEmail = before.new_email?.trim().toLowerCase();
  if (!pendingEmail || pendingEmail !== email.trim().toLowerCase()) {
    throw new Error("当前待确认邮箱与验证码不匹配，请重新发送确认邮件。");
  }
  const previousId = before.id;
  const result = await getAuthClient().auth.verifyOtp({ email, token, type: "email_change" });
  if (result.error || !result.data.user) throw authActionError(result.error ?? {}, "验证码无效或已过期，请重新发送确认邮件。");
  const user = result.data.user;
  if (user.id !== previousId) throw new Error("验证码切换了用户身份，已停止后续操作；当前匿名项目未迁移。");
  if (!user.email_confirmed_at || user.is_anonymous === true || user.new_email) {
    throw new Error("邮箱验证码尚未完成当前匿名身份的确认，请重新载入后重试。");
  }
  const metadata = mergeRecoveryMetadata(user, "password_pending");
  const marked = await getAuthClient().auth.updateUser({ data: metadata });
  if (marked.error || !marked.data.user) throw authActionError(marked.error ?? {}, "邮箱已验证，但验证状态未能保存，请重新载入后继续设置密码。");
  if (marked.data.user.id !== user.id) throw new Error("邮箱验证未保留原身份，已停止后续操作。");
  return marked.data.user;
}

export async function setRecoveryPassword(password: string) {
  if (!EMAIL_AUTH_ENABLED) throw new Error("邮箱保护尚未启用。");
  const user = await currentUser();
  const status = readRecoveryStatus(user);
  if (status !== "password_pending" || user.is_anonymous === true || !user.email_confirmed_at || user.new_email) {
    throw new Error("请先完成邮箱验证码验证。");
  }
  const result = await getAuthClient().auth.updateUser({ password, data: mergeRecoveryMetadata(user, "ready") });
  if (result.error || !result.data.user) throw authActionError(result.error ?? {}, "密码设置失败，请稍后重试。");
  if (result.data.user.id !== user.id) throw new Error("密码设置未保留原身份，已停止后续操作。");
  if (result.data.user.is_anonymous === true || !result.data.user.email_confirmed_at || result.data.user.new_email) {
    throw new Error("密码设置未完成邮箱账号转换，请重新载入后重试。");
  }
  return result.data.user;
}

export async function signInWithPassword(email: string, password: string) {
  if (!EMAIL_AUTH_ENABLED) throw new Error("邮箱登录尚未启用。");
  const result = await getAuthClient().auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) throw authActionError(result.error ?? {}, "邮箱或密码不正确，或邮箱尚未确认。");
  return result.data.session;
}

export async function signOutLocal() {
  if (!EMAIL_AUTH_ENABLED) throw new Error("邮箱登录尚未启用。");
  const result = await getAuthClient().auth.signOut({ scope: "local" });
  if (result.error) throw authActionError(result.error, "退出当前账号失败，请稍后重试。");
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
