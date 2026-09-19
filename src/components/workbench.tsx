"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { versionDetailSchema, type Diagnostic, type VersionDetail } from "@/lib/contracts";
import { apiJson, readableError } from "@/lib/client/api";
import { terminal, useWorkbench } from "@/lib/client/use-workbench";
import { FeedbackOutbox } from "@/lib/client/feedback-outbox";
import { buildExportHtml } from "@/lib/preview/export";
import { Preview, type PreviewControl } from "./preview";

// SSR controls stay inert until React has installed their event handlers.
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

const examples = [
  { icon: "▦", title: "求职投递看板", detail: "整理机会，跟踪每一步进展", prompt: "帮我做一个中文求职投递看板。记录公司、岗位、投递日期、当前阶段和备注。支持新增、编辑、删除、按阶段筛选和数量统计，适配手机，刷新后保留。" },
  { icon: "↗", title: "个人记账本", detail: "让每一笔收支清晰可见", prompt: "做一个中文个人记账本，支持录入日期、收入或支出、分类、金额和备注，能删除记录，按月份筛选，显示收入、支出和结余，刷新后保留。" },
  { icon: "✓", title: "习惯打卡", detail: "把小小坚持变成日常", prompt: "做一个中文习惯打卡应用，可以新增习惯，勾选或取消今天的完成状态，显示今天完成了几个，刷新后保留，不需要账号。" },
];
const labels = { planning: "正在理解需求", generating: "正在生成应用", validating: "正在检查源码", awaiting_preview: "正在检查候选应用", repairing: "正在修复启动问题", succeeded: "新版本已保存", failed: "本次生成未完成", cancelled: "任务已取消", timed_out: "任务已超时" };

export default function Workbench({ projectId }: { projectId?: string }) {
  const w = useWorkbench(projectId);
  return <WorkbenchView key={w.identityEpoch} projectId={projectId} w={w} />;
}

function WorkbenchView({ projectId, w }: { projectId?: string; w: ReturnType<typeof useWorkbench> }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const captureScope = w.captureScope;
  const [prompt, setPrompt] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [mobileTab, setMobileTab] = useState("chat");
  const [tab, setTab] = useState("preview");
  const [codeTab, setCodeTab] = useState<"html" | "css" | "js">("html");
  const [phone, setPhone] = useState(false);
  const [history, setHistory] = useState<VersionDetail | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [probeKey, setProbeKey] = useState(0);
  const [visible, setVisible] = useState(true);
  const [probeError, setProbeError] = useState("");
  const [save, setSave] = useState("尚无应用数据");
  const [runtimeErrors, setRuntimeErrors] = useState<Diagnostic[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const activeFrame = useRef<PreviewControl | null>(null);
  const [feedbackOutbox] = useState(() => new FeedbackOutbox({
    send: (runId, body) => w.command(`/api/runs/${runId}/feedback`, body, runId),
    dataChanged: () => setProbeKey(n => n + 1),
    error: e => setProbeError(readableError(e)),
  }));
  const sentInitial = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const version = history ?? w.detail?.currentVersion;
  const active = !!w.pendingRunId || !terminal(w.run) || (w.busy && !!projectId);
  const probing = !!w.candidate && active;

  useEffect(() => {
    feedbackOutbox.setContext({ identity: w.identity, projectId: projectId ?? "", runId: w.run?.id ?? "", candidateId: w.candidate?.id ?? null, active: !!w.run && !terminal(w.run), isCurrent: captureScope() });
  }, [feedbackOutbox, projectId, w.identity, w.run, w.candidate?.id, captureScope]);
  useEffect(() => () => feedbackOutbox.dispose(), [feedbackOutbox]);

  useEffect(() => {
    const update = () => { setVisible(!document.hidden); if (!document.hidden) setProbeKey(n => n + 1); };
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (!active || !w.run) return;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(w.run!.createdAt)) / 1000)));
    const timer = setInterval(tick, 1000); tick(); return () => clearInterval(timer);
  }, [active, w.run]);
  useEffect(() => {
    if (!probing) activeFrame.current?.resumeWrites();
  }, [probing]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (active) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [active]);

  async function leave() {
    if (!active) return true;
    if (!window.confirm("离开会取消当前任务。确定继续吗？")) return false;
    return w.cancel("navigation");
  }
  async function navigate(path: string) {
    const isCurrent = w.captureScope();
    if (await leave() && isCurrent()) { setDrawer(false); router.push(path); }
  }
  async function create() {
    const isCurrent = w.captureScope();
    if (!await leave() || !isCurrent()) return;
    const project = await w.createProject();
    if (project && isCurrent()) router.push(`/projects/${project.id}`);
  }
  async function send() {
    const text = prompt.trim();
    if (!text || Array.from(text).length > 4000 || active || w.busy) return;
    if (!projectId) {
      const isCurrent = w.captureScope();
      const project = await w.createProject();
      if (project && isCurrent()) { sessionStorage.setItem(`miniatoms:draft:${project.id}`, text); router.push(`/projects/${project.id}`); }
      return;
    }
    setHistory(null); setRuntimeErrors([]); setProbeError(""); await w.generate(text);
  }
  useEffect(() => {
    if (!projectId || !w.ready || sentInitial.current) return;
    const isCurrent = w.captureScope();
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      const draft = sessionStorage.getItem(`miniatoms:draft:${projectId}`);
      if (draft && !sentInitial.current) {
        sentInitial.current = true;
        sessionStorage.removeItem(`miniatoms:draft:${projectId}`);
        setPrompt(draft); void w.generate(draft);
      }
    }, 0);
    return () => clearTimeout(timer);
    // One explicit home-page submission is consumed after authentication and project loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, w.ready]);
  async function showHistory(id: string) {
    const isCurrent = w.captureScope();
    if (!await leave() || !isCurrent()) return;
    try {
      const data = await apiJson<{ version: unknown }>(`/api/projects/${projectId}/versions/${id}`);
      if (!isCurrent()) return;
      setHistory(versionDetailSchema.parse(data.version)); setTab("preview"); setMobileTab("result");
    } catch (e) { if (isCurrent()) w.setError(readableError(e)); }
  }
  async function retryPreview() {
    const isCurrent = w.captureScope();
    try {
      await w.reload();
      if (!isCurrent()) return;
      setProbeError(""); setProbeKey(n => n + 1); setFrameKey(n => n + 1);
    } catch (e) { if (isCurrent()) w.setError(readableError(e)); }
  }
  async function copySource() {
    const isCurrent = w.captureScope();
    try {
      await navigator.clipboard.writeText(version?.artifact[codeTab] ?? "");
      if (!isCurrent()) return;
      setCopied(true); setTimeout(() => { if (isCurrent()) setCopied(false); }, 1500);
    } catch { if (isCurrent()) w.setError("无法复制，请手动选择源码。"); }
  }
  function feedback(revision: number, diagnostics: Diagnostic[]) {
    if (document.hidden || !w.candidate || !w.run) return;
    feedbackOutbox.submit({ requestId: crypto.randomUUID(), candidateVersionId: w.candidate.id, sourceHash: w.candidate.sourceHash, dataRevision: revision, outcome: diagnostics.length ? "errors" : "ready", diagnostics });
  }
  function download() {
    const current = w.detail?.currentVersion;
    if (!current) return;
    const url = URL.createObjectURL(new Blob([buildExportHtml(projectId!, current)], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `miniatoms-${projectId}-v${current.number}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const sourceNames = { html: "index.html", css: "styles.css", js: "app.js" };

  return <div className={`workspace ${projectId ? "is-studio" : "is-home"}`}>
    {drawer && <button className="drawer-backdrop" aria-label="点击遮罩关闭项目列表" onClick={() => setDrawer(false)} />}
    <aside className={`sidebar ${drawer ? "open" : ""}`}>
      <button className="drawer-close" aria-label="关闭项目列表" onClick={() => setDrawer(false)}>×</button>
      <button className="brand" onClick={() => void navigate("/")}><span className="brand-mark">✳</span><span>MiniAtoms<span className="brand-sub">从一个想法开始</span></span></button>
      <button className="new-project" onClick={() => void create()} disabled={!w.ready || w.busy}><span>＋</span> 新建应用 <span className="arrow">↗</span></button>
      <div className="sidebar-label">我的项目 <span>{w.projects.length.toString().padStart(2, "0")}</span></div>
      <nav className="project-list" aria-label="我的项目">{w.projects.length ? w.projects.map(project => <button key={project.id} className={`project-item ${project.id === projectId ? "selected" : ""}`} onClick={() => void navigate(`/projects/${project.id}`)}><span className="project-icon">▧</span><span>{project.title}<small>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small></span></button>) : <p className="empty-projects">灵感值得被实现。<br />你的第一个应用会出现在这里。</p>}</nav>
      <div className="sidebar-bottom"><span className="avatar">访</span><div>匿名访客<small>{w.identity ? "会话保存在此浏览器" : "正在准备工作空间"}</small></div><span className={`connection-dot ${w.ready ? "connected" : ""}`} /></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="menu-button" onClick={() => setDrawer(true)} aria-label="打开项目列表">☰</button><span className="muted">工作空间</span><span className="separator">/</span><strong>{w.detail?.project.title ?? "创造新应用"}</strong></div><span className="model-badge"><i /> DeepSeek 驱动</span></header>
      {w.error && <div className="global-error" role="alert"><span>{w.error.includes("不存在") ? "404 · 项目不存在或无权访问。" : w.error}</span><button onClick={() => window.location.reload()}>重新载入</button></div>}
      {!projectId ? <section className="home-content">
        <div className="hero-eyebrow"><span>✦</span> 让想法，成为可以使用的应用</div>
        <h1>你想创造<span>什么？</span></h1><p className="hero-description">描述你的需求，AI 为你构建。<br className="mobile-break" /> 预览、迭代，让每一个好想法落地。</p>
        <div className="home-composer"><label className="sr-only" htmlFor="home-prompt">描述应用需求</label><textarea disabled={!hydrated} id="home-prompt" ref={promptRef} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="例如：帮我做一个求职投递看板，记录每一次机会…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-footer"><span>✧ 自然语言 → 可交互应用</span><button className="primary" onClick={() => void send()} disabled={!w.ready || !prompt.trim() || w.busy || Array.from(prompt).length > 4000}>开始创造 <span>↗</span></button></div></div>
        <div className="ideas-heading"><span>从这些灵感开始</span><span>点击填入，自由修改</span></div>
        <div className="ideas-grid">{examples.map(example => <button disabled={!hydrated} className="idea-card" key={example.title} onClick={() => { setPrompt(example.prompt); promptRef.current?.focus(); }}><span className="idea-icon">{example.icon}</span><strong>{example.title}<span>↗</span></strong><small>{example.detail}</small></button>)}</div>
        <div className="home-note"><span>◇ 自动保存版本</span><span>▣ 隔离交互预览</span><span>↓ 随时导出源码</span></div>
        <p className="session-note">无需注册 · 项目绑定当前浏览器访客身份，清除浏览器数据后可能无法找回</p>
      </section> : <>
        <div className="mobile-main-tabs"><button className={mobileTab === "chat" ? "selected" : ""} onClick={() => setMobileTab("chat")}>需求与对话</button><button className={mobileTab === "result" ? "selected" : ""} onClick={() => setMobileTab("result")}>应用成果</button></div>
        <div className={`studio-grid mobile-${mobileTab}`}>
          <section className="conversation"><div className="panel-heading"><strong>与想法对话</strong><span className="tiny-badge">AI BUILDER</span></div>
            <div className="messages" aria-live="polite">{w.detail?.nextBeforeMessageId && <button className="text-button" onClick={() => void w.earlier()}>加载更早的对话</button>}
              {!w.detail?.messages.length && <div className="chat-welcome"><span className="assistant-mark">✳</span><h2>从想法到第一版</h2><p>告诉我你想做什么、给谁使用，以及需要哪些功能。你可以随时继续对话来完善它。</p><div className="suggestion">试试说：<br />“做一个可以记录和筛选收支的记账本”</div></div>}
              {w.pendingRunId && !w.run && <div className="run-card running"><strong><span className="spinner" />正在确认任务状态</strong><p>请求已发送，正在读取服务器结果。</p><button className="text-button" onClick={() => void w.cancel()}>取消任务</button></div>}
              {w.detail?.messages.map(message => <article className={`message ${message.role}`} key={message.id}><span className="message-author">{message.role === "user" ? "你" : "✳ MiniAtoms"}{message.contextEpoch !== w.detail?.project.contextEpoch && <small>历史分支</small>}</span><div>{message.content}</div></article>)}
              {w.run && <div className={`run-card ${active ? "running" : ""}`}><strong>{active && <span className="spinner" />}{labels[w.run.status]}</strong><small>{active ? `${seconds} 秒 · ` : ""}{w.run.kind === "restore" ? "历史恢复 · 无模型调用" : `模型调用 ${w.run.modelCalls}/4 · 代码尝试 ${w.run.draftAttempt}/3`}</small>{w.run.plan && active && <p>{w.run.plan.changeSummary}</p>}{w.run.error && <p className="error-text">{w.run.error.message}</p>}{w.run.diagnostics.map((d, i) => <p className="error-text" key={i}>{d.message}</p>)}{active && <button className="text-button" onClick={() => void w.cancel()}>取消任务</button>}</div>}
              {w.notice && <p className="notice">{w.notice}</p>}
            </div>
            <div className="chat-compose"><label htmlFor="studio-prompt" className="sr-only">应用需求或修改意见</label><textarea disabled={!hydrated} id="studio-prompt" ref={promptRef} placeholder={w.detail?.currentVersion ? "描述你想做的修改…" : "描述你的应用想法…"} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-footer"><small>{Array.from(prompt).length}/4000 · Shift+Enter 换行</small><button className="primary send-button" aria-label="发送需求" disabled={!w.ready || active || w.busy || !prompt.trim() || Array.from(prompt).length > 4000} onClick={() => void send()}>↑</button></div><p>关闭页面可能中断生成；成果以已保存版本为准。</p></div>
          </section>
          <section className="result-panel"><div className="result-toolbar"><div className="view-tabs">{[["preview", "预览"], ["code", "源码"], ["history", "版本"]].map(([key, name]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}>{name}</button>)}</div><button className="export-button" onClick={download} disabled={!w.detail?.currentVersion}>↓ <span>导出 HTML</span></button></div>
            {history && <div className="history-banner"><span>历史 v{history.number} · 操作不保存</span><button onClick={() => { setHistory(null); setFrameKey(n => n + 1); }}>返回当前</button><button disabled={active} onClick={() => { if (window.confirm("将创建一个恢复版本；已有业务数据不会倒退。确定恢复吗？")) { const target = history; setHistory(null); void w.restore(target); } }}>恢复此版本</button></div>}
            {tab === "preview" && <><div className="preview-toolbar"><span><i className="status-dot" />{version ? `v${version.number} · ${history ? "历史预览" : "基础检查通过"}` : "等待第一版应用"}</span><div className="device-switch"><button aria-label="桌面预览" className={!phone ? "selected" : ""} onClick={() => setPhone(false)}>▱</button><button aria-label="手机预览" className={phone ? "selected" : ""} onClick={() => setPhone(true)}>▯</button><button aria-label="重新载入应用" onClick={() => { setFrameKey(n => n + 1); setRuntimeErrors([]); setSave("正在载入数据"); }} disabled={!version}>↻</button></div></div>
              {runtimeErrors.length > 0 && <div className="runtime-error" role="alert"><strong>应用运行遇到问题</strong><p>{runtimeErrors.map(d => d.message).join("；")}</p><button disabled={active} onClick={() => void w.generate("修复当前应用的运行错误，保留原有功能与业务数据。", runtimeErrors)}>让 AI 修复</button></div>}
              <div className={`preview-stage ${phone ? "phone" : ""}`}><div className="preview-viewport">{version ? <Preview key={`${version.id}:${frameKey}`} version={version} mode={history ? "history" : "active"} control={activeFrame} onError={setProbeError} onResult={() => setSave("数据已载入")} onDiagnostic={d => setRuntimeErrors(old => [...old, d].slice(0, 5))} onSaveStatus={(status, message) => setSave(status === "saving" ? "正在保存…" : status === "saved" ? "数据已保存" : `未保存：${message ?? "请重新载入应用"}`)} /> : <div className="empty-preview"><div className="empty-illustration"><div /><div /><div /><span>✧</span></div><h2>你的应用，即将在这里诞生</h2><p>在左侧描述需求，生成后即可交互体验。<br />每一次修改都会保留为一个新版本。</p><span className="empty-label">IDEA → BUILD → ITERATE</span></div>}{probing && <div className="probe-overlay"><span className="spinner" /> 正在检查新版本，暂时停止编辑</div>}</div></div>
              <footer className="preview-footer"><span>{history ? "历史操作只保留在临时副本" : save}</span><span>隔离预览 · {phone ? "390px" : "桌面"}</span></footer></>}
            {tab === "code" && <div className="code-panel"><div className="code-tabs">{(Object.keys(sourceNames) as (keyof typeof sourceNames)[]).map(key => <button className={codeTab === key ? "selected" : ""} key={key} onClick={() => setCodeTab(key)}>{sourceNames[key]}</button>)}<button disabled={!version} onClick={() => void copySource()}>{copied ? "已复制" : "复制"}</button></div><pre><code>{version?.artifact[codeTab] ?? "生成应用后，这里会显示真实源码。"}</code></pre></div>}
            {tab === "history" && <div className="versions"><h2>每一个版本，都有迹可循</h2><p>预览历史不会写入业务数据。恢复会创建新版本。</p>{w.detail?.versions.length ? w.detail.versions.map(item => <button className="version-card" key={item.id} onClick={() => void showHistory(item.id)}><span className="version-number">v{item.number}</span><span><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")}{item.restoredFromVersionId ? " · 恢复版本" : ""}</small></span><span>{item.id === w.detail?.project.currentVersionId ? "当前" : "预览 →"}</span></button>) : <div className="empty-list">生成第一个应用后，版本会保存在这里。</div>}</div>}
            {probeError && <div className="global-error" role="alert"><span>{probeError}</span><button onClick={() => void retryPreview()}>{w.candidate ? "重试检查" : "重新载入应用"}</button></div>}
          </section>
        </div>
      </>}
    </main>
    {probing && visible && !probeError && w.candidate && <div className="probe-container" aria-hidden="true" inert><Preview key={`${w.candidate.id}:${probeKey}`} version={w.candidate} mode="probe" beforeStart={async () => { activeFrame.current?.freezeWrites(); await activeFrame.current?.drainWrites(); }} onResult={(revision, diagnostics) => void feedback(revision, diagnostics)} onError={setProbeError} /></div>}
  </div>;
}
