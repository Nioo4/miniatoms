import { isAppState, type Artifact } from "@/lib/contracts";
import { buildAppScript, scriptJson } from "./artifact";

interface FrameConfig {
  channelId: string;
  parentOrigin: string;
  nonce: string;
  artifact: Artifact;
  appScript: string;
}

/** This function is serialized into an opaque frame. Keep it self-contained. */
function frameBootstrap(config: FrameConfig, safeState: (value: unknown) => boolean) {
  type State = Record<string, unknown>;
  type Pending = {
    resolve: (value: State | void) => void;
    reject: (error: Error) => void;
    kind: string;
    state?: State;
    enqueuedAt: number;
    sent: boolean;
    timer: ReturnType<typeof setTimeout>;
  };
  const MAX_PENDING = 10;
  const REQUEST_TIMEOUT = 10000;
  const SEND_INTERVAL = 125;
  const pending = new Map<string, Pending>();
  const queue: string[] = [];
  let activeRequestId: string | null = null;
  let nextSendAt = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let writesBlocked: { code: string; message: string } | null = null;
  let conclusion = false;
  const send = (payload: object) => window.parent.postMessage(
    { v: 1, namespace: "miniatoms", channelId: config.channelId, ...payload }, config.parentOrigin,
  );
  const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
  const timeoutError = () => failure("BRIDGE_TIMEOUT", "保存结果尚未确认，请重新载入应用后再保存。");
  const blockedWriteError = () => writesBlocked ? failure(writesBlocked.code, writesBlocked.message) : timeoutError();
  const closedError = () => failure("BRIDGE_TIMEOUT", "预览已关闭，存储请求未发送。");
  function remove(requestId: string, error?: Error, value?: State | void) {
    const item = pending.get(requestId);
    if (!item) return;
    pending.delete(requestId);
    clearTimeout(item.timer);
    if (activeRequestId === requestId) activeRequestId = null;
    if (error) item.reject(error);
    else item.resolve(value);
  }
  function rejectQueuedWrites(error: Error) {
    for (const [requestId, item] of pending) {
      if (!item.sent && item.kind === "store.set") remove(requestId, error);
    }
  }
  function expire(requestId: string) {
    const item = pending.get(requestId);
    if (!item) return;
    const sent = item.sent;
    remove(requestId, timeoutError());
    if (sent && item.kind === "store.set") {
      writesBlocked = { code: "BRIDGE_TIMEOUT", message: "保存结果尚未确认，请重新载入应用后再保存。" };
      rejectQueuedWrites(blockedWriteError());
    }
    pump();
  }
  function schedulePump(delay: number) {
    if (closed) return;
    if (pumpTimer !== undefined) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { pumpTimer = undefined; pump(); }, Math.max(1, delay));
  }
  function pump() {
    if (closed || activeRequestId !== null) return;
    while (queue.length > 0) {
      const requestId = queue.shift()!;
      const item = pending.get(requestId);
      if (!item) continue;
      if (item.kind === "store.set" && writesBlocked) { remove(requestId, blockedWriteError()); continue; }
      const remaining = REQUEST_TIMEOUT - (Date.now() - item.enqueuedAt);
      if (remaining <= 0) { expire(requestId); continue; }
      const wait = nextSendAt - Date.now();
      if (wait > 0) { queue.unshift(requestId); schedulePump(wait); return; }
      item.sent = true;
      activeRequestId = requestId;
      nextSendAt = Date.now() + SEND_INTERVAL;
      try {
        send({ type: item.kind, requestId, ...(item.kind === "store.set" ? { state: item.state } : {}) });
      } catch {
        expire(requestId);
      }
      return;
    }
  }
  function closeQueue() {
    if (closed) return;
    closed = true;
    conclusion = true;
    if (pumpTimer !== undefined) clearTimeout(pumpTimer);
    pumpTimer = undefined;
    queue.length = 0;
    for (const requestId of pending.keys()) remove(requestId, closedError());
  }
  window.addEventListener("pagehide", closeQueue, { once: true });
  function report(error: unknown, line: number | null = null, column: number | null = null) {
    if (conclusion) return;
    conclusion = true;
    const entry = error instanceof Error ? error : new Error(String(error));
    const code = typeof (entry as Error & { code?: string }).code === "string"
      ? (entry as Error & { code: string }).code : "PREVIEW_RUNTIME_ERROR";
    send({ type: "preview.error", diagnostic: { code, message: Array.from(entry.message).slice(0, 2000).join(""),
      file: line ? "js" : "preview", line, column } });
  }
  function appLine(raw: number) {
    const line = raw - 1;
    return line >= 1 && line <= config.artifact.js.split("\n").length ? line : null;
  }
  window.addEventListener("error", (event) => {
    const inApp = event.filename?.includes("miniatoms-app.js");
    report(event.error ?? event.message, inApp ? appLine(event.lineno) : null, inApp && event.colno > 0 ? event.colno : null);
  });
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
  window.addEventListener("securitypolicyviolation", (event) => {
    report(failure("PREVIEW_CSP_VIOLATION", "应用尝试访问被禁止的资源：" + event.violatedDirective));
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || (config.parentOrigin !== "*" && event.origin !== config.parentOrigin)) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.v !== 1 || data.namespace !== "miniatoms"
      || data.channelId !== config.channelId || data.type !== "store.result" || typeof data.requestId !== "string") return;
    const item = pending.get(data.requestId);
    if (!item || !item.sent || activeRequestId !== data.requestId) return;
    const allowed = data.ok === true ? ["v", "namespace", "channelId", "type", "requestId", "ok", "revision", ...(item.kind === "store.get" ? ["state"] : [])]
      : ["v", "namespace", "channelId", "type", "requestId", "ok", "error"];
    if (Object.keys(data).some((key) => !allowed.includes(key))) return;
    if (data.ok === true && (!Number.isSafeInteger(data.revision) || data.revision < 0 || (item.kind === "store.get" && !safeState(data.state)))) return;
    if (data.ok === false && (!data.error || typeof data.error.code !== "string" || typeof data.error.message !== "string"
      || Object.keys(data.error).some((key) => !["code", "message"].includes(key)))) return;
    if (typeof data.ok !== "boolean") return;
    if (data.ok) remove(data.requestId, undefined, item.kind === "store.get" ? structuredClone(data.state) : undefined);
    else {
      const responseError = failure(data.error.code, data.error.message);
      if (item.kind === "store.set" && !["PREVIEW_FROZEN", "BRIDGE_RATE_LIMIT", "INVALID_APP_STATE"].includes(data.error.code)) {
        writesBlocked = { code: data.error.code, message: data.error.message };
        rejectQueuedWrites(responseError);
      }
      remove(data.requestId, responseError);
    }
    pump();
  });
  function request(kind: string, state?: State): Promise<State | void> {
    if (closed) return Promise.reject(closedError());
    if (pending.size >= MAX_PENDING) return Promise.reject(failure("BRIDGE_RATE_LIMIT", "存储请求过多，请等待当前保存完成。"));
    if (kind === "store.set" && writesBlocked) return Promise.reject(blockedWriteError());
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => expire(requestId), REQUEST_TIMEOUT);
      pending.set(requestId, { kind, state, resolve, reject, enqueuedAt: Date.now(), sent: false, timer });
      queue.push(requestId);
      pump();
    });
  }
  const store = Object.freeze({
    getState: () => request("store.get") as Promise<State>,
    setState: (state: State): Promise<void> => {
      if (!safeState(state)) return Promise.reject(failure("INVALID_APP_STATE", "应用数据格式、大小或嵌套层数不符合要求。"));
      const snapshot = structuredClone(state);
      return request("store.set", snapshot).then(() => undefined);
    },
  });
  Object.defineProperty(window, "appStore", { value: store, writable: false, configurable: false });
  const startupTimer = setTimeout(() => report(failure("PREVIEW_TIMEOUT", "应用未在 8 秒内完成启动。")), 8000);
  const runtime = Object.freeze({
    done: async () => {
      try {
        const app = document.getElementById("app")!;
        const visible = (element: Element) => {
          const style = getComputedStyle(element), box = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        };
        const hasContent = visible(app) && Boolean(app.textContent?.trim()) ||
          Array.from(app.querySelectorAll("canvas,svg,input,button,select,textarea,img")).some(visible);
        if (!hasContent) { report(failure("PREVIEW_EMPTY", "应用没有可见内容。")); return; }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        if (conclusion) return;
        clearTimeout(startupTimer);
        app.inert = false;
        if (document.hidden) return;
        // Later interaction errors still need to be observable in active mode.
        send({ type: "preview.ready" });
      } catch (error) { report(error); }
    },
    fail: (error: unknown) => report(error),
  });
  Object.defineProperty(window, "__ma_runtime", { value: runtime, writable: false, configurable: false });
  send({ type: "preview.booted" });
  const style = document.createElement("style");
  style.textContent = config.artifact.css;
  document.head.append(style);
  document.getElementById("app")!.innerHTML = config.artifact.html;
  const script = document.createElement("script");
  script.nonce = config.nonce;
  script.textContent = config.appScript;
  document.body.append(script);
}

export function buildSrcdoc(artifact: Artifact, channelId: string, parentOrigin: string): string {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; media-src 'none'";
  const config: FrameConfig = { artifact, appScript: buildAppScript(artifact.js), channelId, parentOrigin, nonce };
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'
    + csp + '"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;min-height:100%;}body{font-family:system-ui,sans-serif;}#app{min-height:100vh;}[hidden]{display:none!important;}</style></head><body><div id="app" inert></div><script nonce="'
    + nonce + '">(' + frameBootstrap.toString() + ')(' + scriptJson(config) + ',(' + isAppState.toString() + '));</script></body></html>';
}
