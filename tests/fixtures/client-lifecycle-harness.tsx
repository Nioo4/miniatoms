// Explicit browser fixture: real React/UI/client, fake authenticated transport; no model or database.
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import Workbench from "../../src/components/workbench";
import { useWorkbench } from "../../src/lib/client/use-workbench";
import { sourceHash, type Feedback, type ProjectDto, type RunDto, type VersionDetail } from "../../src/lib/contracts";

const projectId = "10000000-0000-4000-8000-000000000001";
const currentId = "20000000-0000-4000-8000-000000000001";
const oldId = "20000000-0000-4000-8000-000000000002";
const ownerId = "30000000-0000-4000-8000-000000000001";
const scenario = new URLSearchParams(location.search).get("scenario");
const now = new Date().toISOString();
const project: ProjectDto = { id: projectId, title: "生命周期测试", brief: "fixture", currentVersionId: scenario?.startsWith("identity") ? currentId : null, contextEpoch: 0, createdAt: now, updatedAt: now };
const artifact = { html: "<h1>测试应用</h1>", css: "", js: "console.log('fixture');" };
let current: VersionDetail;
let old: VersionDetail;
let candidate: VersionDetail | null = null;
let run: RunDto | null = null;
const counters = { starts: 0, runGets: 0, cancels: 0, projectLists: 0 };
const listeners: ((event: string, session: { user: { id: string } }) => void)[] = [];
const session = { user: { id: ownerId }, access_token: "fixture-only" };
let releaseInitialAuth!: () => void;
const initialAuthGate = new Promise<void>(resolve => { releaseInitialAuth = resolve; });
let releaseInitialRead!: () => void;
const initialReadGate = new Promise<void>(resolve => { releaseInitialRead = resolve; });
let releaseOperation!: () => void;
const operationGate = new Promise<void>(resolve => { releaseOperation = resolve; });
let currentOwner = ownerId;

declare global {
  interface Window {
    __clientFixture: { counters: typeof counters; changeIdentity(): void; refreshIdentity(): void; releaseInitialAuth(): void; releaseInitialRead(): void; releaseOperation(): void; mounts: string[]; results: unknown[]; reports: Feedback[]; dataRevision: number; probeReady?: () => void; hook?: ReturnType<typeof useWorkbench> };
    __clientFixtureAuth: {
      initializeSession: () => Promise<typeof session>;
      accessToken: () => Promise<string>;
      refreshSession: () => Promise<typeof session>;
      getAuthClient: () => { auth: { onAuthStateChange: (callback: typeof listeners[number]) => { data: { subscription: { unsubscribe(): void } } } } };
    };
  }
}
window.__clientFixture = { counters, mounts: [], results: [], reports: [], dataRevision: 0, releaseInitialAuth, releaseInitialRead, releaseOperation,
  refreshIdentity() { for (const callback of listeners) callback("TOKEN_REFRESHED", { user: { id: currentOwner } }); },
  changeIdentity() { currentOwner = "30000000-0000-4000-8000-000000000002"; for (const callback of listeners) callback("SIGNED_IN", { user: { id: currentOwner } }); },
};
window.__clientFixtureAuth = {
  initializeSession: async () => { if (scenario === "delayed-home") await initialAuthGate; return session; }, accessToken: async () => session.access_token, refreshSession: async () => session,
  getAuthClient: () => ({ auth: { onAuthStateChange: callback => {
    listeners.push(callback);
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); } } } };
  } } }),
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const detail = () => ({ project, currentVersion: project.currentVersionId ? current : null, versions: project.currentVersionId ? [current, old].map(({ artifact: _artifact, plan: _plan, ...meta }) => { void _artifact; void _plan; return meta; }) : [], messages: [], nextBeforeMessageId: scenario?.startsWith("hook-earlier") ? currentId : null, activeRun: run && !run.finishedAt ? run : null, latestRun: run, candidateVersion: candidate });
function commitFeedback() {
  current = { ...candidate!, status: "ready", number: 1, committedAt: now };
  candidate = null; project.currentVersionId = current.id;
  run = { ...run!, status: "succeeded", revision: run!.revision + 1, candidateVersionId: null, resultVersionId: current.id, finishedAt: now };
}
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === "/api/projects") {
    if (init?.method === "POST") {
      const owner = currentOwner;
      if (scenario?.startsWith("hook-create") && owner === ownerId) {
        await operationGate;
        if (scenario === "hook-create-error") return json({ error: { code: "RESOURCE_LIMIT", message: "旧身份创建失败", requestId: projectId } }, 409);
      }
      if (scenario === "hook-create-error" && owner !== ownerId) await initialReadGate;
      return json({ project });
    }
    counters.projectLists++;
    if (scenario === "initial-read-switch") await initialReadGate;
    return json({ projects: [project] });
  }
  if (url === `/api/projects/${projectId}`) return json(detail());
  if (url.includes("beforeMessageId=")) {
    await operationGate;
    if (scenario === "hook-earlier-error") return json({ error: { code: "INVALID_CURSOR", message: "旧身份历史读取失败", requestId: projectId } }, 400);
    return json({ ...detail(), messages: [{ id: "50000000-0000-4000-8000-000000000001", projectId, runId: null, role: "user", kind: "request", content: "旧身份消息", contextEpoch: 0, createdAt: now }] });
  }
  if (url.includes("/versions/")) {
    if (scenario === "identity-history-error") { await operationGate; return json({ error: { code: "RESOURCE_NOT_FOUND", message: "旧身份源码读取失败", requestId: projectId } }, 404); }
    return json({ version: old });
  }
  if (url.endsWith("/feedback")) {
    const body = JSON.parse(String(init?.body)) as Feedback;
    window.__clientFixture.reports.push(body);
    if (scenario === "feedback-late-error") { commitFeedback(); throw new TypeError("fixture: committed response lost"); }
    if (window.__clientFixture.reports.length === 1) throw new TypeError("fixture: uncertain feedback response");
    if (scenario === "feedback-data-change" && window.__clientFixture.reports.length === 2) return json({ error: { code: "PREVIEW_DATA_CHANGED", message: "测试数据已改变", requestId: projectId, details: { revision: 2 } } }, 409);
    commitFeedback();
    const streamId = crypto.randomUUID();
    const events = ["committed", "stream_end"].map((event, index) => `event: ${event}\ndata: ${JSON.stringify({ v: 1, streamId, seq: index + 1, runId: run!.id, revision: run!.revision, at: now, data: event === "committed" ? { run, project, version: current } : { run } })}\n\n`).join("");
    return new Response(events, { headers: { "content-type": "text/event-stream" } });
  }
  if (url.endsWith("/runs")) {
    counters.starts++;
    const body = JSON.parse(String(init?.body));
    if (scenario === "rejected") return json({ error: { code: "INVALID_REQUEST", message: "测试拒绝", requestId: body.requestId } }, 400);
    run = { id: body.requestId, projectId, kind: "generate", status: "planning", revision: 1, baseVersionId: null, candidateVersionId: null, resultVersionId: null, modelCalls: 0, draftAttempt: 0, plan: null, diagnostics: [], error: null, createdAt: now, expiresAt: new Date(Date.now() + 240000).toISOString(), finishedAt: null };
    throw new TypeError("fixture: first response lost before snapshot");
  }
  if (url.endsWith("/cancel")) {
    counters.cancels++;
    if (scenario?.startsWith("hook-cancel")) { await operationGate; if (scenario === "hook-cancel-error") throw new TypeError("old cancel failure"); }
    if (!run) throw new Error("missing run");
    run = { ...run, status: "cancelled", revision: 2, finishedAt: new Date().toISOString(), error: { code: "USER_CANCELLED", message: "任务已取消" } };
    return json({ run });
  }
  if (url.startsWith("/api/runs/")) {
    counters.runGets++;
    if (scenario?.startsWith("feedback-")) return json({ run, candidateVersion: candidate, resultVersion: run?.status === "succeeded" ? current : null });
    if (scenario === "recover404" && counters.runGets <= 2) return json({ error: { code: "RESOURCE_NOT_FOUND", message: "资源不存在", requestId: projectId } }, 404);
    if (scenario === "cancel" || scenario?.startsWith("hook-cancel") || counters.runGets === 1) throw new TypeError("fixture: confirmation temporarily unreachable");
    if (!run) return json({ error: { code: "RESOURCE_NOT_FOUND", message: "资源不存在", requestId: projectId } }, 404);
    run = { ...run, status: "failed", revision: 2, finishedAt: new Date().toISOString(), error: { code: "CLIENT_DISCONNECTED", message: "连接中断，已保留原版本" } };
    return json({ run, candidateVersion: null, resultVersion: null });
  }
  throw new Error(`Unexpected fixture path: ${url}`);
};

async function start() {
  const hash = await sourceHash(artifact);
  current = { id: currentId, projectId, runId: "40000000-0000-4000-8000-000000000001", number: 2, status: "ready", parentVersionId: oldId, restoredFromVersionId: null, summary: "当前版本", sourceHash: hash, createdAt: now, committedAt: now, artifact, plan: { title: "测试应用", brief: "测试", features: ["测试"], changeSummary: "测试" } };
  old = { ...current, id: oldId, number: 1, parentVersionId: null, summary: "旧身份历史源码" };
  if (scenario?.startsWith("feedback-")) {
    candidate = { ...current, id: "20000000-0000-4000-8000-000000000003", status: "candidate", number: null, committedAt: null, parentVersionId: null };
    run = { id: current.runId, projectId, kind: "generate", status: "awaiting_preview", revision: 2, baseVersionId: null, candidateVersionId: candidate.id, resultVersionId: null, modelCalls: 2, draftAttempt: 1, plan: current.plan, diagnostics: [], error: null, createdAt: now, expiresAt: new Date(Date.now() + 240000).toISOString(), finishedAt: null };
  }
  createRoot(document.getElementById("root")!).render(scenario?.startsWith("hook-") ? <HookProbe /> : <Workbench projectId={scenario === "delayed-home" ? undefined : projectId} />);
}
function HookProbe() {
  const value = useWorkbench(projectId);
  useEffect(() => { window.__clientFixture.hook = value; });
  return <output>{JSON.stringify({ ready: value.ready, busy: value.busy, error: value.error, identity: value.identity, notice: value.notice, run: value.run, detail: value.detail })}</output>;
}
void start();
