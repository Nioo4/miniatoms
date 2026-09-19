// Explicit browser fixture: real React/UI/client, fake authenticated transport; no model or database.
import { createRoot } from "react-dom/client";
import Workbench from "../../src/components/workbench";
import { sourceHash, type ProjectDto, type RunDto, type VersionDetail } from "../../src/lib/contracts";

const projectId = "10000000-0000-4000-8000-000000000001";
const currentId = "20000000-0000-4000-8000-000000000001";
const oldId = "20000000-0000-4000-8000-000000000002";
const ownerId = "30000000-0000-4000-8000-000000000001";
const scenario = new URLSearchParams(location.search).get("scenario");
const now = new Date().toISOString();
const project: ProjectDto = { id: projectId, title: "生命周期测试", brief: "fixture", currentVersionId: scenario === "identity" ? currentId : null, contextEpoch: 0, createdAt: now, updatedAt: now };
const artifact = { html: "<h1>测试应用</h1>", css: "", js: "console.log('fixture');" };
let current: VersionDetail;
let old: VersionDetail;
let run: RunDto | null = null;
const counters = { starts: 0, runGets: 0, cancels: 0, projectLists: 0 };
const listeners: ((event: string, session: { user: { id: string } }) => void)[] = [];
const session = { user: { id: ownerId }, access_token: "fixture-only" };
let releaseInitialAuth!: () => void;
const initialAuthGate = new Promise<void>(resolve => { releaseInitialAuth = resolve; });
let releaseInitialRead!: () => void;
const initialReadGate = new Promise<void>(resolve => { releaseInitialRead = resolve; });

declare global {
  interface Window {
    __clientFixture: { counters: typeof counters; changeIdentity(): void; releaseInitialAuth(): void; releaseInitialRead(): void; mounts: string[] };
    __clientFixtureAuth: {
      initializeSession: () => Promise<typeof session>;
      accessToken: () => Promise<string>;
      refreshSession: () => Promise<typeof session>;
      getAuthClient: () => { auth: { onAuthStateChange: (callback: typeof listeners[number]) => { data: { subscription: { unsubscribe(): void } } } } };
    };
  }
}
window.__clientFixture = { counters, mounts: [], releaseInitialAuth, releaseInitialRead, changeIdentity() { for (const callback of listeners) callback("SIGNED_IN", { user: { id: "30000000-0000-4000-8000-000000000002" } }); } };
window.__clientFixtureAuth = {
  initializeSession: async () => { if (scenario === "delayed-home") await initialAuthGate; return session; }, accessToken: async () => session.access_token, refreshSession: async () => session,
  getAuthClient: () => ({ auth: { onAuthStateChange: callback => {
    listeners.push(callback);
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); } } } };
  } } }),
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const detail = () => ({ project, currentVersion: project.currentVersionId ? current : null, versions: project.currentVersionId ? [current, old].map(({ artifact: _artifact, plan: _plan, ...meta }) => { void _artifact; void _plan; return meta; }) : [], messages: [], nextBeforeMessageId: null, activeRun: run && !run.finishedAt ? run : null, latestRun: run, candidateVersion: null });
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === "/api/projects") {
    counters.projectLists++;
    if (scenario === "initial-read-switch") await initialReadGate;
    return json({ projects: [project] });
  }
  if (url === `/api/projects/${projectId}`) return json(detail());
  if (url.includes("/versions/")) return json({ version: old });
  if (url.endsWith("/runs")) {
    counters.starts++;
    const body = JSON.parse(String(init?.body));
    if (scenario === "rejected") return json({ error: { code: "INVALID_REQUEST", message: "测试拒绝", requestId: body.requestId } }, 400);
    run = { id: body.requestId, projectId, kind: "generate", status: "planning", revision: 1, baseVersionId: null, candidateVersionId: null, resultVersionId: null, modelCalls: 0, draftAttempt: 0, plan: null, diagnostics: [], error: null, createdAt: now, expiresAt: new Date(Date.now() + 240000).toISOString(), finishedAt: null };
    throw new TypeError("fixture: first response lost before snapshot");
  }
  if (url.endsWith("/cancel")) {
    counters.cancels++;
    if (!run) throw new Error("missing run");
    run = { ...run, status: "cancelled", revision: 2, finishedAt: new Date().toISOString(), error: { code: "USER_CANCELLED", message: "任务已取消" } };
    return json({ run });
  }
  if (url.startsWith("/api/runs/")) {
    counters.runGets++;
    if (scenario === "recover404" && counters.runGets <= 2) return json({ error: { code: "RESOURCE_NOT_FOUND", message: "资源不存在", requestId: projectId } }, 404);
    if (scenario === "cancel" || counters.runGets === 1) throw new TypeError("fixture: confirmation temporarily unreachable");
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
  createRoot(document.getElementById("root")!).render(<Workbench projectId={scenario === "delayed-home" ? undefined : projectId} />);
}
void start();
