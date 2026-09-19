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
  type Pending = { resolve: (value: State | void) => void; reject: (error: Error) => void; kind: string; timer: ReturnType<typeof setTimeout> };
  const pending = new Map<string, Pending>();
  let conclusion = false;
  let writes = Promise.resolve();
  const send = (payload: object) => window.parent.postMessage(
    { v: 1, namespace: "miniatoms", channelId: config.channelId, ...payload }, config.parentOrigin,
  );
  const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
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
    if (!item) return;
    const allowed = data.ok === true ? ["v", "namespace", "channelId", "type", "requestId", "ok", "revision", ...(item.kind === "store.get" ? ["state"] : [])]
      : ["v", "namespace", "channelId", "type", "requestId", "ok", "error"];
    if (Object.keys(data).some((key) => !allowed.includes(key))) return;
    if (data.ok === true && (!Number.isSafeInteger(data.revision) || data.revision < 0 || (item.kind === "store.get" && !safeState(data.state)))) return;
    if (data.ok === false && (!data.error || typeof data.error.code !== "string" || typeof data.error.message !== "string"
      || Object.keys(data.error).some((key) => !["code", "message"].includes(key)))) return;
    if (typeof data.ok !== "boolean") return;
    clearTimeout(item.timer); pending.delete(data.requestId);
    if (data.ok) item.resolve(item.kind === "store.get" ? structuredClone(data.state) : undefined);
    else item.reject(failure(data.error.code, data.error.message));
  });
  function request(kind: string, state?: State): Promise<State | void> {
    if (pending.size >= 10) return Promise.reject(failure("BRIDGE_RATE_LIMIT", "存储请求过多，请等待当前保存完成。"));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId); reject(failure("BRIDGE_TIMEOUT", "保存结果尚未确认，请返回工作台检查。"));
      }, 10000);
      pending.set(requestId, { kind, resolve, reject, timer });
      send({ type: kind, requestId, ...(kind === "store.set" ? { state } : {}) });
    });
  }
  const store = Object.freeze({
    getState: () => request("store.get") as Promise<State>,
    setState: (state: State): Promise<void> => {
      if (!safeState(state)) return Promise.reject(failure("INVALID_APP_STATE", "应用数据格式、大小或嵌套层数不符合要求。"));
      const snapshot = structuredClone(state);
      const next = writes.then(() => request("store.set", snapshot)).then(() => undefined);
      writes = next.catch(() => undefined);
      return next;
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
        if (conclusion || document.hidden) return;
        clearTimeout(startupTimer);
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
    + csp + '"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;min-height:100%;}body{font-family:system-ui,sans-serif;}#app{min-height:100vh;}</style></head><body><div id="app"></div><script nonce="'
    + nonce + '">(' + frameBootstrap.toString() + ')(' + scriptJson(config) + ',(' + isAppState.toString() + '));</script></body></html>';
}
