import { appDataSchema, appStateSchema, childMessageSchema, LIMITS, type AppData, type AppState, type Artifact, type Diagnostic } from "@/lib/contracts";
import { buildSrcdoc } from "./srcdoc";

export type PreviewMode = "active" | "probe" | "history";
export interface PreviewOptions {
  artifact: Artifact;
  mode: PreviewMode;
  projectId: string;
  versionId: string;
  readData: () => Promise<AppData>;
  writeData: (input: { requestId: string; versionId: string; expectedRevision: number; state: AppState }) => Promise<{ revision: number; savedAt: string }>;
  onReady?: (dataRevision: number) => void;
  onDiagnostic?: (diagnostic: Diagnostic, dataRevision: number) => void;
  onPlatformError?: (error: { code: string; message: string }) => void;
  onSaveStatus?: (status: "saving" | "saved" | "error", message?: string) => void;
}
export interface PreviewHandle {
  destroy(): void;
  freezeWrites(): void;
  resumeWrites(): void;
  drainWrites(): Promise<void>;
}
function errorInfo(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object") {
    const value = error as { code?: string; message?: string };
    return { code: value.code ?? "DATABASE_UNAVAILABLE", message: value.message ?? "预览存储暂时不可用。" };
  }
  return { code: "DATABASE_UNAVAILABLE", message: "预览存储暂时不可用。" };
}
const platformCodes = new Set(["DATABASE_UNAVAILABLE", "AUTH_UNAVAILABLE", "AUTH_EXPIRED", "AUTH_REQUIRED", "CONFIGURATION_REQUIRED",
  "BRIDGE_TIMEOUT", "ACTIVE_VERSION_CHANGED", "DATA_REVISION_CONFLICT", "PREVIEW_FROZEN", "NETWORK_ERROR", "REQUEST_TIMEOUT"]);

export function mountPreview(iframe: HTMLIFrameElement, options: PreviewOptions): PreviewHandle {
  const channelId = crypto.randomUUID();
  let destroyed = false, frozen = false, conflicted = false, booted = false, concluded = false;
  let cache: AppData | null = null, snapshotRevision = 0;
  let queue = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rateStart = Date.now(), rateCount = 0, pending = 0;
  const seen = new Set<string>();
  iframe.setAttribute("sandbox", "allow-scripts allow-forms");
  iframe.referrerPolicy = "no-referrer";
  const boundWindow = iframe.contentWindow;
  function reply(requestId: string, value: object) {
    if (destroyed || boundWindow !== iframe.contentWindow) return;
    boundWindow?.postMessage({ v: 1, namespace: "miniatoms", channelId, type: "store.result", requestId, ...value }, "*");
  }
  function platform(error: { code: string; message: string }) {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    if (options.mode === "probe") concluded = true;
    options.onPlatformError?.(error);
  }
  function diagnostic(entry: Diagnostic) {
    if (destroyed || document.hidden || (options.mode === "probe" && concluded)) return;
    if (platformCodes.has(entry.code)) { platform(entry); return; }
    if (timer) clearTimeout(timer);
    if (options.mode === "probe") concluded = true;
    options.onDiagnostic?.(entry, snapshotRevision);
  }
  async function storage(message: Extract<ReturnType<typeof childMessageSchema.parse>, { type: "store.get" | "store.set" }>) {
    if (destroyed || !cache) return;
    if (message.type === "store.get") {
      reply(message.requestId, { ok: true, state: structuredClone(cache.state), revision: cache.revision });
      return;
    }
    if (conflicted) {
      reply(message.requestId, { ok: false, error: { code: "DATA_REVISION_CONFLICT",
        message: "数据保存结果需要确认，请重新载入应用。" } });
      return;
    }
    const nextState = appStateSchema.parse(message.state);
    if (options.mode !== "active") {
      cache = { ...cache, state: structuredClone(nextState), revision: cache.revision + 1 };
      reply(message.requestId, { ok: true, revision: cache.revision });
      return;
    }
    options.onSaveStatus?.("saving");
    const input = { requestId: message.requestId, versionId: options.versionId, expectedRevision: cache.revision, state: nextState };
    try {
      const saved = await options.writeData(input);
      if (destroyed) return;
      cache = { ...cache, state: structuredClone(nextState), revision: saved.revision };
      reply(message.requestId, { ok: true, revision: saved.revision });
      options.onSaveStatus?.("saved");
    } catch (error) {
      if (destroyed) return;
      // An uncertain write must not let a following full-state replacement hide lost data.
      conflicted = true;
      const info = errorInfo(error);
      reply(message.requestId, { ok: false, error: info });
      options.onSaveStatus?.("error", info.message);
      if (["DATA_REVISION_CONFLICT", "ACTIVE_VERSION_CHANGED"].includes(info.code)) platform(info);
    }
  }
  function listener(event: MessageEvent) {
    if (destroyed || event.source !== boundWindow || boundWindow !== iframe.contentWindow) return;
    const parsed = childMessageSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channelId !== channelId) return;
    const message = parsed.data;
    if (Date.now() - rateStart >= 1000) { rateStart = Date.now(); rateCount = 0; }
    if (++rateCount > 10) {
      if ("requestId" in message) reply(message.requestId, { ok: false, error: { code: "BRIDGE_RATE_LIMIT", message: "请求过于频繁，请稍后重试。" } });
      return;
    }
    if (message.type === "preview.booted") { booted = true; return; }
    if (message.type === "preview.error") { diagnostic(message.diagnostic); return; }
    if (message.type === "preview.ready") {
      if (!booted || document.hidden || concluded) return;
      clearTimeout(timer);
      if (options.mode === "probe") concluded = true;
      options.onReady?.(snapshotRevision);
      return;
    }
    if (seen.has(message.requestId)) return;
    seen.add(message.requestId);
    if (message.type === "store.set" && frozen) {
      reply(message.requestId, { ok: false, error: { code: "PREVIEW_FROZEN", message: "正在检查候选版本，请稍后再编辑。" } });
      return;
    }
    if (pending >= 10) {
      reply(message.requestId, { ok: false, error: { code: "BRIDGE_RATE_LIMIT", message: "当前存储请求过多。" } }); return;
    }
    pending++;
    queue = queue.then(() => storage(message)).catch((error) => {
      reply(message.requestId, { ok: false, error: errorInfo(error) });
    }).finally(() => { pending--; });
  }
  window.addEventListener("message", listener);
  void options.readData().then((result) => {
    if (destroyed) return;
    cache = structuredClone(appDataSchema.parse(result));
    if (options.mode === "active" && cache.currentVersionId !== options.versionId) {
      platform({ code: "ACTIVE_VERSION_CHANGED", message: "当前版本已经改变，请重新载入应用。" }); return;
    }
    snapshotRevision = cache.revision;
    iframe.srcdoc = buildSrcdoc(options.artifact, channelId, window.location.origin);
    timer = setTimeout(() => {
      if (destroyed || document.hidden || concluded) return;
      if (!booted) platform({ code: "PREVIEW_UNAVAILABLE", message: "预览通信尚未就绪，请重新检查。" });
      else diagnostic({ code: "PREVIEW_TIMEOUT", message: "应用未在 8 秒内完成启动。", file: "preview", line: null, column: null });
    }, LIMITS.probeMs);
  }).catch((error) => platform(errorInfo(error)));
  return {
    destroy() {
      destroyed = true; clearTimeout(timer); window.removeEventListener("message", listener);
      iframe.removeAttribute("srcdoc");
    },
    freezeWrites() { frozen = true; },
    resumeWrites() { if (!conflicted) frozen = false; },
    async drainWrites() { await queue; },
  };
}
