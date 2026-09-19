import { accessToken, refreshSession } from "./auth";

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: Record<string, unknown>, public status?: number) { super(message); }
}

export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  let token = await accessToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init.headers, Authorization: `Bearer ${token}` } }); }
    catch (error) {
      if (init.signal?.aborted) throw new ApiError("REQUEST_TIMEOUT", "请求已中断或超时，保存结果需要重新确认。");
      throw new ApiError("NETWORK_ERROR", error instanceof Error ? "网络连接失败，请检查连接后重新载入。" : "请求失败，请重试。");
    }
    if (response.status === 401 && attempt === 0) { token = (await refreshSession()).access_token; continue; }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? "请求失败，请稍后重试。", body?.error?.details, response.status);
    }
    return response;
  }
  throw new ApiError("AUTH_EXPIRED", "访客会话已失效。");
}

export async function apiJson<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await authenticatedFetch(path, { method: body === undefined ? "GET" : method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return response.json();
}

export function readableError(error: unknown): string {
  if (error instanceof ApiError && error.code === "QUOTA_EXCEEDED") {
    const reset = error.details?.resetAt;
    return `${error.message}${typeof reset === "string" ? ` 下次重置：${new Date(reset).toLocaleString("zh-CN")}` : ""}`;
  }
  return error instanceof Error ? error.message : "请求失败，请重试。";
}
