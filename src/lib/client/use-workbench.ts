"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { projectDetailSchema, runDetailSchema, runSchema, sseEnvelopeSchema, type Diagnostic, type ProjectDetail, type ProjectDto, type RunDto, type VersionDetail } from "@/lib/contracts";
import { ApiError, apiJson, authenticatedFetch, readableError } from "./api";
import { getAuthClient, initializeSession } from "./auth";
import { readSse } from "./sse";

export const terminal = (run: RunDto | null) => !run || ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status);

export function useWorkbench(projectId?: string) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [run, setRun] = useState<RunDto | null>(null);
  const [candidate, setCandidate] = useState<VersionDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState("");
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const [pendingRun, setPendingRun] = useState<{ id: string; confirmUntil: number } | null>(null);
  const pendingRef = useRef<typeof pendingRun>(null);
  const currentRun = useRef<RunDto | null>(null);
  const expectedRun = useRef<string | null>(null);
  const stream = useRef<AbortController | null>(null);
  const scope = useRef(0);
  const updateRun = useCallback((next: RunDto) => {
    if (expectedRun.current && next.id !== expectedRun.current) return false;
    if (currentRun.current?.id === next.id && currentRun.current.revision > next.revision) return false;
    currentRun.current = next; setRun(next);
    if (terminal(next)) { pendingRef.current = null; setPendingRun(null); }
    if (next.status !== "awaiting_preview") setCandidate(null);
    return true;
  }, []);
  const reload = useCallback(async () => {
    const generation = scope.current;
    const [list, raw] = await Promise.all([apiJson<{ projects: ProjectDto[] }>("/api/projects"), projectId ? apiJson(`/api/projects/${projectId}`) : null]);
    const data = raw ? projectDetailSchema.parse(raw) : null;
    if (generation !== scope.current) return;
    setProjects(list.projects);
    if (data) {
      const next = data.activeRun ?? data.latestRun;
      if (next?.id === currentRun.current?.id && next && next.revision < currentRun.current!.revision) return;
      setDetail(data);
      if (terminal(currentRun.current) && !pendingRef.current) expectedRun.current = (data.activeRun ?? data.latestRun)?.id ?? null;
      if (next && updateRun(next)) setCandidate(data.candidateVersion);
    }
  }, [projectId, updateRun]);

  useEffect(() => {
    let live = true;
    const generation = scope.current;
    let unsubscribe: (() => void) | undefined;
    initializeSession().then(async (session) => {
      if (!live || generation !== scope.current) return;
      setIdentity(session.user.id);
      let user = session.user.id;
      unsubscribe = getAuthClient().auth.onAuthStateChange((_event, next) => {
        if (next?.user.id !== user) {
          user = next?.user.id ?? ""; scope.current++; stream.current?.abort();
          setIdentityEpoch(epoch => epoch + 1);
          setIdentity(user); setProjects([]); setDetail(null); setCandidate(null); setRun(null); currentRun.current = null; expectedRun.current = null;
          pendingRef.current = null; setPendingRun(null); setBusy(false);
          setError("访客身份发生变化，已清空旧会话视图。请重新载入页面。"); setReady(false);
        }
      }).data.subscription.unsubscribe;
      await reload(); if (live && generation === scope.current) setReady(true);
    }).catch((e) => { if (live && generation === scope.current) setError(readableError(e)); });
    return () => { live = false;
      // This numeric generation deliberately invalidates all pending requests on unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      scope.current++; unsubscribe?.(); stream.current?.abort(); };
  }, [reload]);

  const reconcile = useCallback(async (id: string) => {
    const generation = scope.current;
    const result = runDetailSchema.parse(await apiJson(`/api/runs/${id}`));
    if (generation !== scope.current || (expectedRun.current && id !== expectedRun.current)) return;
    if (updateRun(result.run)) setCandidate(result.candidateVersion);
    if (terminal(result.run)) { await reload(); setNotice(""); }
  }, [reload, updateRun]);

  useEffect(() => {
    const id = pendingRun?.id ?? (!terminal(run) ? run!.id : null);
    if (!id) return;
    const confirmUntil = run?.id === id ? Date.parse(run.expiresAt) + 5000 : pendingRun!.confirmUntil;
    const generation = scope.current;
    let querying = false;
    const timer = setInterval(() => {
      if (Date.now() > confirmUntil) {
        clearInterval(timer);
        setNotice("暂时无法确认任务最终结果，请重新载入或取消任务。不会自动重新生成。");
        return;
      }
      if (querying) return;
      querying = true;
      void reconcile(id).catch((e) => {
        if (generation !== scope.current) return;
        if (e instanceof ApiError && e.status === 404 && pendingRef.current?.id === id) setNotice("服务器尚未确认任务，正在继续查询；不会重复生成。");
        else setError(readableError(e));
      }).finally(() => { querying = false; });
    }, 2000);
    return () => clearInterval(timer);
  }, [run, pendingRun, reconcile]); // Database snapshots remain authoritative even before the first snapshot.

  const command = useCallback(async (path: string, body: Record<string, unknown>, runId: string) => {
    setBusy(true); setError(""); setNotice("");
    if (!path.endsWith("/feedback")) {
      scope.current++; currentRun.current = null; setRun(null); setCandidate(null);
      const pending = { id: runId, confirmUntil: Date.now() + 245000 };
      pendingRef.current = pending; setPendingRun(pending);
    }
    expectedRun.current = runId;
    const generation = scope.current;
    const controller = new AbortController(); stream.current = controller;
    const remaining = currentRun.current?.id === runId ? Date.parse(currentRun.current.expiresAt) - Date.now() + 5000 : 245000;
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(245000, remaining)));
    const seen = new Map<string, number>();
    let ended = false;
    try {
      const response = await authenticatedFetch(path, { method: "POST", body: JSON.stringify(body), signal: controller.signal });
      await readSse(response, (event, raw) => {
        if (generation !== scope.current || !raw || typeof raw !== "object") return;
        const envelope = sseEnvelopeSchema.parse(raw);
        if (envelope.runId !== runId) throw new Error("任务事件格式无效。");
        if ((seen.get(envelope.streamId) ?? 0) >= envelope.seq) return;
        seen.set(envelope.streamId, envelope.seq);
        if (currentRun.current?.id === runId && envelope.revision < currentRun.current.revision) return;
        const data = envelope.data as { run?: unknown };
        if (data.run) updateRun(runSchema.parse(data.run));
        if (event === "snapshot" || event === "plan") void reload().catch(() => undefined);
        // Candidate source is loaded from a validated snapshot before mounting.
        if (event === "stream_end") ended = true;
      });
      if (!ended) setNotice("连接已中断，正在确认结果");
      await reconcile(runId);
    } catch (e) {
      if (generation !== scope.current) return;
      if (controller.signal.aborted && currentRun.current && terminal(currentRun.current)) return;
      if (e instanceof ApiError && e.code === "PREVIEW_DATA_CHANGED") throw e;
      setError(readableError(e));
      if (!path.endsWith("/feedback") && e instanceof ApiError && e.status && e.status >= 400 && e.status < 500) {
        pendingRef.current = null; setPendingRun(null); expectedRun.current = null;
        if (["BASE_VERSION_CONFLICT", "RUN_IN_PROGRESS"].includes(e.code)) await reload();
        else setNotice("");
        return;
      }
      if (e instanceof ApiError && ["BASE_VERSION_CONFLICT", "RUN_IN_PROGRESS", "CANDIDATE_STALE", "RUN_STATE_CONFLICT"].includes(e.code)) { expectedRun.current = null; await reload(); }
      else { setNotice("连接已中断，正在确认结果"); await reconcile(runId).catch(() => undefined); }
      if (path.endsWith("/feedback") && currentRun.current?.status === "awaiting_preview") throw e;
    } finally { clearTimeout(timeout); if (generation === scope.current) setBusy(false); }
  }, [reconcile, reload, updateRun]);

  async function createProject() {
    setError(""); setBusy(true);
    try { return (await apiJson<{ project: ProjectDto }>("/api/projects", { requestId: crypto.randomUUID(), title: "未命名应用" })).project; }
    catch (e) { setError(readableError(e)); return null; }
    finally { setBusy(false); }
  }
  async function generate(prompt: string, diagnostics: Diagnostic[] = []) {
    if (!projectId || !detail) return;
    const requestId = crypto.randomUUID();
    await command(`/api/projects/${projectId}/runs`, { requestId, prompt, baseVersionId: detail.project.currentVersionId, diagnostics }, requestId);
  }
  async function cancel(reason: "user" | "navigation" | "preview_unavailable" = "user") {
    const id = currentRun.current?.id ?? expectedRun.current;
    if (!id || (currentRun.current && terminal(currentRun.current))) return true;
    try {
      const result = await apiJson<{ run: RunDto }>(`/api/runs/${id}/cancel`, { reason });
      updateRun(result.run); stream.current?.abort(); await reload(); return true;
    } catch { setError("取消未确认，正在查询任务状态。"); await reconcile(id).catch(() => undefined); return false; }
  }
  async function restore(version: VersionDetail) {
    if (!detail) return;
    const requestId = crypto.randomUUID();
    await command(`/api/projects/${projectId}/restore`, { requestId, targetVersionId: version.id, baseVersionId: detail.project.currentVersionId }, requestId);
  }
  async function earlier() {
    if (!detail?.nextBeforeMessageId) return;
    try {
      const data = projectDetailSchema.parse(await apiJson(`/api/projects/${projectId}?beforeMessageId=${detail.nextBeforeMessageId}`));
      setDetail((old) => old ? { ...old, messages: [...data.messages, ...old.messages.filter(m => !data.messages.some(n => n.id === m.id))], nextBeforeMessageId: data.nextBeforeMessageId } : old);
    } catch (e) { setError(readableError(e)); }
  }
  return { projects, detail, run, candidate, error, notice, ready, busy, identity, identityEpoch, pendingRunId: pendingRun?.id ?? null, setError, reload, createProject, generate, cancel, restore, earlier, command };
}
