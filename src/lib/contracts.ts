import { z } from "zod";

export const LIMITS = Object.freeze({
  runMs: 240_000, modelMs: 90_000, probeMs: 8_000, quietMs: 1_500,
  bridgeMs: 10_000, artifactBytes: 128 * 1024, stateBytes: 64 * 1024,
  requestBytes: 256 * 1024, modelResponseBytes: 512 * 1024,
  stateDepth: 20, modelCalls: 4, writeAttempts: 3, projects: 20, versions: 100,
});
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type AppState = { [key: string]: Json };
export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
export const codePoints = (value: string): number => Array.from(value).length;
const text = (min: number, max: number) => z.string().refine(
  (s) => codePoints(s) >= min && codePoints(s) <= max,
  { message: `长度必须为 ${min}–${max} 个字符` },
);
export const uuidSchema = z.uuid().transform((s) => s.toLowerCase());
export const timestampSchema = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Shared across SDK, bridge and HTTP. Reject cycles and non-JSON prototypes too. */
export function isAppState(value: unknown): value is AppState {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const seen = new Set<object>();
  function valid(node: unknown, depth: number): boolean {
    // Keep this function self-contained: its exact code also runs in exported frames.
    if (depth > 20) return false;
    if (node === null || typeof node === "boolean" || typeof node === "string") return true;
    if (typeof node === "number") return Number.isFinite(node);
    if (typeof node !== "object" || seen.has(node)) return false;
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) return false;
    seen.add(node);
    const result = Array.isArray(node)
      ? Array.from(node).every((entry) => valid(entry, depth + 1))
      : Reflect.ownKeys(node).every((key) => typeof key === "string"
        && !["__proto__", "prototype", "constructor"].includes(key)
        && valid((node as Record<string, unknown>)[key], depth + 1));
    seen.delete(node);
    return result;
  }
  try { return valid(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536; }
  catch { return false; }
}
export const appStateSchema = z.custom<AppState>(isAppState, "数据必须为不超过 64 KiB、深度不超过 20 的安全 JSON 对象");
export const artifactSchema = z.strictObject({ html: text(1, LIMITS.artifactBytes), css: z.string(), js: text(1, LIMITS.artifactBytes) })
  .refine((a) => utf8Bytes(a.html) + utf8Bytes(a.css) + utf8Bytes(a.js) <= LIMITS.artifactBytes, "源码不能超过 128 KiB");
export type Artifact = z.infer<typeof artifactSchema>;
export const planSchema = z.strictObject({
  title: text(1, 60), brief: text(1, 1000), features: z.array(text(1, 120)).min(1).max(6), changeSummary: text(1, 500),
});
export type Plan = z.infer<typeof planSchema>;
export const writeAppSchema = z.strictObject({ html: text(1, LIMITS.artifactBytes), css: z.string(), js: text(1, LIMITS.artifactBytes), summary: text(1, 500) });
export type WriteAppArgs = z.infer<typeof writeAppSchema>;
export const diagnosticSchema = z.strictObject({
  code: text(1, 120), message: text(1, 2000), file: z.enum(["html", "css", "js", "preview"]),
  line: z.number().int().positive().nullable(), column: z.number().int().positive().nullable(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export const diagnosticsSchema = z.array(diagnosticSchema).max(5);
export const runStatusSchema = z.enum(["planning", "generating", "validating", "awaiting_preview", "repairing", "succeeded", "failed", "cancelled", "timed_out"]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runKindSchema = z.enum(["generate", "restore"]);
export type RunKind = z.infer<typeof runKindSchema>;
export const versionStatusSchema = z.enum(["candidate", "ready", "rejected"]);
export type VersionStatus = z.infer<typeof versionStatusSchema>;
export const isTerminal = (status: RunStatus): boolean => ["succeeded", "failed", "cancelled", "timed_out"].includes(status);
export function canTransition(from: RunStatus, to: RunStatus, kind: RunKind = "generate"): boolean {
  if (isTerminal(from)) return false;
  if (["failed", "cancelled", "timed_out"].includes(to)) return true;
  if (from === to) return true;
  if (kind === "restore") return (from === "validating" && to === "awaiting_preview") || (from === "awaiting_preview" && to === "succeeded");
  const edges: Partial<Record<RunStatus, RunStatus[]>> = {
    planning: ["generating"], generating: ["validating"], repairing: ["validating"],
    validating: ["awaiting_preview", "repairing"], awaiting_preview: ["succeeded", "repairing"],
  };
  return edges[from]?.includes(to) ?? false;
}
export const projectSchema = z.strictObject({
  id: uuidSchema, title: text(1, 60), brief: text(0, 1000), currentVersionId: uuidSchema.nullable(),
  contextEpoch: revision, createdAt: timestampSchema, updatedAt: timestampSchema,
});
export type ProjectDto = z.infer<typeof projectSchema>;
export const versionMetaSchema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, runId: uuidSchema, number: z.number().int().positive().nullable(),
  status: versionStatusSchema, parentVersionId: uuidSchema.nullable(), restoredFromVersionId: uuidSchema.nullable(),
  summary: text(1, 500), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestampSchema, committedAt: timestampSchema.nullable(),
});
export type VersionMeta = z.infer<typeof versionMetaSchema>;
export const versionDetailSchema = versionMetaSchema.extend({ artifact: artifactSchema, plan: planSchema });
export type VersionDetail = z.infer<typeof versionDetailSchema>;
export const runSchema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, kind: runKindSchema, status: runStatusSchema, revision,
  baseVersionId: uuidSchema.nullable(), candidateVersionId: uuidSchema.nullable(), resultVersionId: uuidSchema.nullable(),
  modelCalls: z.number().int().min(0).max(4), draftAttempt: z.number().int().min(0).max(3), plan: planSchema.nullable(),
  diagnostics: diagnosticsSchema, error: z.strictObject({ code: text(1, 120), message: text(1, 2000) }).nullable(),
  createdAt: timestampSchema, expiresAt: timestampSchema, finishedAt: timestampSchema.nullable(),
});
export type RunDto = z.infer<typeof runSchema>;
export const messageSchema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, runId: uuidSchema.nullable(), role: z.enum(["user", "assistant"]),
  kind: z.enum(["request", "plan", "result", "restore"]), content: z.string(), contextEpoch: revision, createdAt: timestampSchema,
});
export type MessageDto = z.infer<typeof messageSchema>;
export const projectDetailSchema = z.strictObject({
  project: projectSchema, currentVersion: versionDetailSchema.nullable(), versions: z.array(versionMetaSchema).max(100),
  messages: z.array(messageSchema).max(50), nextBeforeMessageId: uuidSchema.nullable(), activeRun: runSchema.nullable(),
  latestRun: runSchema.nullable(), candidateVersion: versionDetailSchema.nullable(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export const runDetailSchema = z.strictObject({ run: runSchema, candidateVersion: versionDetailSchema.nullable(), resultVersion: versionDetailSchema.nullable() });
export type RunDetail = z.infer<typeof runDetailSchema>;
export const appDataSchema = z.strictObject({ state: appStateSchema, revision, currentVersionId: uuidSchema.nullable() });
export type AppData = z.infer<typeof appDataSchema>;
export const createProjectSchema = z.strictObject({ requestId: uuidSchema, title: z.string().trim().pipe(text(1, 60)).default("未命名应用") });
export const startRunSchema = z.strictObject({
  requestId: uuidSchema, prompt: z.string().trim().pipe(text(1, 4000)), baseVersionId: uuidSchema.nullable(), diagnostics: diagnosticsSchema.default([]),
});
export const cancelRunSchema = z.strictObject({ reason: z.enum(["user", "navigation", "preview_unavailable"]).default("user") });
export const feedbackSchema = z.strictObject({
  requestId: uuidSchema, candidateVersionId: uuidSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  dataRevision: revision, outcome: z.enum(["ready", "errors"]), diagnostics: diagnosticsSchema,
}).refine((v) => v.outcome === "ready" ? v.diagnostics.length === 0 : v.diagnostics.length > 0, "检查结果与诊断不一致");
export type Feedback = z.infer<typeof feedbackSchema>;
export const restoreSchema = z.strictObject({ requestId: uuidSchema, targetVersionId: uuidSchema, baseVersionId: uuidSchema });
export const putDataSchema = z.strictObject({ requestId: uuidSchema, versionId: uuidSchema, expectedRevision: revision, state: appStateSchema });

export const ERROR_STATUS = {
  INVALID_REQUEST: 400, INVALID_CURSOR: 400, AUTH_REQUIRED: 401, AUTH_EXPIRED: 401, ORIGIN_DENIED: 403,
  RESOURCE_NOT_FOUND: 404, BASE_VERSION_CONFLICT: 409, RUN_IN_PROGRESS: 409, IDEMPOTENCY_CONFLICT: 409,
  RUN_STATE_CONFLICT: 409, CANDIDATE_STALE: 409, PREVIEW_DATA_CHANGED: 409, ACTIVE_VERSION_CHANGED: 409,
  DATA_REVISION_CONFLICT: 409, ALREADY_CURRENT: 409, RESOURCE_LIMIT: 409, PAYLOAD_TOO_LARGE: 413,
  QUOTA_EXCEEDED: 429, MODEL_AUTH_FAILED: 502, MODEL_UNAVAILABLE: 502, MODEL_RESPONSE_INVALID: 502,
  MODEL_OUTPUT_TRUNCATED: 502, CONFIGURATION_REQUIRED: 503, DATABASE_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details?: Record<string, Json> } }

export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export const normalizedDiagnostics = (items: Diagnostic[]) => items.map((d) => [d.code, d.message, d.file, d.line, d.column]);
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const sourceHash = (a: Artifact): Promise<string> => sha256(JSON.stringify([a.html, a.css, a.js]));

const bridgeBase = { v: z.literal(1), namespace: z.literal("miniatoms"), channelId: uuidSchema };
export const childMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...bridgeBase, type: z.literal("preview.booted") }),
  z.strictObject({ ...bridgeBase, type: z.literal("preview.ready") }),
  z.strictObject({ ...bridgeBase, type: z.literal("preview.error"), diagnostic: diagnosticSchema }),
  z.strictObject({ ...bridgeBase, type: z.literal("store.get"), requestId: uuidSchema }),
  z.strictObject({ ...bridgeBase, type: z.literal("store.set"), requestId: uuidSchema, state: appStateSchema }),
]);
export type ChildMessage = z.infer<typeof childMessageSchema>;
export const parentMessageSchema = z.union([
  z.strictObject({ ...bridgeBase, type: z.literal("store.result"), requestId: uuidSchema, ok: z.literal(true), revision, state: appStateSchema.optional() }),
  z.strictObject({ ...bridgeBase, type: z.literal("store.result"), requestId: uuidSchema, ok: z.literal(false), error: z.strictObject({ code: z.string(), message: z.string() }) }),
]);
export type ParentMessage = z.infer<typeof parentMessageSchema>;
export type SseEventName = "snapshot" | "stage" | "plan" | "candidate" | "committed" | "terminal" | "stream_end";
export interface SseEnvelope<T = unknown> { v: 1; streamId: string; seq: number; runId: string; revision: number; at: string; data: T }
export const sseEnvelopeSchema = z.strictObject({
  v: z.literal(1), streamId: uuidSchema, seq: z.number().int().positive(), runId: uuidSchema,
  revision, at: timestampSchema, data: z.unknown(),
});
