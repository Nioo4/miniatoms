import { isAppState, uuidSchema, versionDetailSchema, type VersionDetail } from "@/lib/contracts";
import { scriptJson } from "./artifact";
import { buildSrcdoc } from "./srcdoc";

interface ExportConfig { projectId: string; channelId: string; originMarker: string; srcdoc: string }
function exportBootstrap(config: ExportConfig, safeState: (value: unknown) => boolean) {
  const frame = document.querySelector("iframe")!;
  const notice = document.getElementById("notice")!;
  const key = "miniatoms:export:" + config.projectId;
  let state: Record<string, unknown> = {}, revision = 0, persistent = true;
  const seen = new Set<string>();
  let rateCount = 0, rateStart = Date.now();
  const memoryNotice = () => { notice.textContent = "当前环境不能持久保存，本次数据仅保留到关闭页面。"; notice.hidden = false; };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      if (safeState(saved.state) && Number.isSafeInteger(saved.revision) && saved.revision >= 0) {
        state = saved.state; revision = saved.revision;
      } else throw new Error("Invalid saved data");
    }
    // Probe writes on a separate key. Do not silently overwrite an existing saved app.
    const probeKey = key + ":probe:" + config.channelId;
    localStorage.setItem(probeKey, "1"); localStorage.removeItem(probeKey);
  } catch { persistent = false; memoryNotice(); }
  const reply = (requestId: string, value: object) => frame.contentWindow?.postMessage({
    v: 1, namespace: "miniatoms", channelId: config.channelId, type: "store.result", requestId, ...value,
  }, "*");
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.v !== 1 || data.namespace !== "miniatoms" || data.channelId !== config.channelId) return;
    if (data.type === "preview.error") {
      notice.textContent = "应用运行错误：" + String(data.diagnostic?.message ?? "未知错误"); notice.hidden = false; return;
    }
    if (!["store.get", "store.set"].includes(data.type) || typeof data.requestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId)) return;
    const allowed = ["v", "namespace", "channelId", "type", "requestId", ...(data.type === "store.set" ? ["state"] : [])];
    if (Object.keys(data).some((field) => !allowed.includes(field)) || seen.has(data.requestId)) return;
    seen.add(data.requestId);
    if (Date.now() - rateStart >= 1000) { rateStart = Date.now(); rateCount = 0; }
    if (++rateCount > 10) { reply(data.requestId, { ok: false, error: { code: "BRIDGE_RATE_LIMIT", message: "请求过于频繁。" } }); return; }
    if (data.type === "store.get") { reply(data.requestId, { ok: true, state: structuredClone(state), revision }); return; }
    if (!safeState(data.state)) { reply(data.requestId, { ok: false, error: { code: "INVALID_APP_STATE", message: "数据格式或大小不符合要求。" } }); return; }
    const nextState = structuredClone(data.state), nextRevision = revision + 1;
    if (persistent) {
      try { localStorage.setItem(key, JSON.stringify({ state: nextState, revision: nextRevision })); }
      catch { persistent = false; memoryNotice(); }
    }
    state = nextState; revision = nextRevision;
    reply(data.requestId, { ok: true, revision });
  });
  const origin = window.location.protocol === "file:" ? "*" : window.location.origin;
  frame.srcdoc = config.srcdoc.replace(JSON.stringify(config.originMarker), JSON.stringify(origin));
}

export function buildExportHtml(projectId: string, version: VersionDetail): string {
  uuidSchema.parse(projectId);
  versionDetailSchema.parse(version);
  if (version.status !== "ready" || version.projectId !== projectId) throw new Error("只能导出本项目已发布版本");
  const channelId = crypto.randomUUID(), originMarker = "__ma_origin_" + crypto.randomUUID();
  const config: ExportConfig = { projectId, channelId, originMarker, srcdoc: buildSrcdoc(version.artifact, channelId, originMarker) };
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>MiniAtoms · 独立应用</title><style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif}body{display:flex;flex-direction:column}#notice{padding:10px 16px;background:#fff1ca;color:#603d00;font-size:14px}iframe{flex:1;width:100%;border:0;min-height:0}</style></head><body>'
    + '<div id="notice" role="status" hidden></div><iframe title="独立应用" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe><script>('
    + exportBootstrap.toString() + ')(' + scriptJson(config) + ',(' + isAppState.toString() + '));</script></body></html>';
}

