import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { localConfig } from './local-config.mjs';

let admin, sql, config;
const plan = { title: '数据库测试', brief: '明确标识的数据库 fixture', features: ['保存'], changeSummary: '测试' };
const artifact = { html: '<button>测试</button>', css: '', js: 'await appStore.getState();' };
const hash = createHash('sha256').update(JSON.stringify([artifact.html, artifact.css, artifact.js])).digest('hex');
const diagnostics = [{ code: 'PREVIEW_ERROR', message: 'fixture error', file: 'preview', line: null, column: null }];
const fingerprint = () => randomUUID();
async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { details: error.details, code: error.code });
  return data;
}
async function user() {
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { id: data.user.id, client };
}
async function project(actor) {
  return (await rpc('ma_create_project', { p_actor: actor, p_project_id: randomUUID(), p_title: 'fixture', p_fingerprint: fingerprint() })).project;
}
function startArgs(actor, p, options = {}) {
  return { p_actor: actor, p_project_id: p.id, p_run_id: randomUUID(), p_kind: 'generate', p_prompt: 'fixture request', p_input_diagnostics: [], p_base_version_id: p.current_version_id, p_restore_target_version_id: null, p_fingerprint: fingerprint(), ...options };
}
const start = (actor, p, options) => rpc('ma_start_run', startArgs(actor, p, options));
async function update(actor, ctx, status, patch = {}) {
  return rpc('ma_update_run', { p_actor: actor, p_run_id: ctx.run.id, p_token: ctx.token, p_expected_status: ctx.run.status, p_next_status: status, p_patch: patch });
}
async function call(actor, ctx, purpose) {
  ctx = await rpc('ma_reserve_model_call', { p_actor: actor, p_run_id: ctx.run.id, p_token: ctx.token, p_purpose: purpose, p_user_daily_limit: 1000000, p_global_daily_limit: 1000000 });
  const records = structuredClone(ctx.run.call_records);
  Object.assign(records.at(-1), { status: 'ok', finishedAt: new Date().toISOString(), providerResponseId: 'fixture' });
  return update(actor, ctx, ctx.run.status, { callRecords: records });
}
async function candidate(actor, p, ctx) {
  ctx ??= await start(actor, p);
  if (ctx.run.kind === 'generate') {
    if (ctx.run.status === 'planning') {
      ctx = await call(actor, ctx, 'plan');
      ctx = await update(actor, ctx, 'generating', { plan });
    }
    ctx = await call(actor, ctx, 'write');
    const messages = [...ctx.run.agent_messages, { role: 'assistant', content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'write_app', arguments: JSON.stringify(artifact) } }] }];
    ctx = await update(actor, ctx, 'validating', { agentMessages: messages });
  }
  let source = { artifact, plan, source_hash: hash, summary: 'fixture version' };
  if (ctx.run.kind === 'restore') source = (await rpc('ma_get_run_context', { p_actor: actor, p_run_id: ctx.run.id })).restoreVersion;
  return rpc('ma_stage_candidate', { p_actor: actor, p_run_id: ctx.run.id, p_token: ctx.token, p_artifact: source.artifact, p_plan: source.plan, p_summary: source.summary, p_source_hash: source.source_hash, p_agent_messages: ctx.run.agent_messages });
}
function feedbackArgs(actor, ctx, options = {}) {
  return { p_actor: actor, p_run_id: ctx.run.id, p_candidate_version_id: ctx.candidate.id, p_source_hash: ctx.candidate.source_hash, p_feedback_request_id: randomUUID(), p_fingerprint: fingerprint(), p_outcome: 'ready', p_data_revision: 0, p_diagnostics: [], ...options };
}
const feedback = (actor, ctx, options) => rpc('ma_accept_feedback', feedbackArgs(actor, ctx, options));
async function published(actor, p) { return feedback(actor, await candidate(actor, p)); }
function putArgs(actor, p, version, options = {}) {
  return { p_actor: actor, p_project_id: p.id, p_request_id: randomUUID(), p_version_id: version, p_expected_revision: 0, p_state: { jobs: ['fixture'] }, p_fingerprint: fingerprint(), ...options };
}
const cancel = (actor, id) => rpc('ma_cancel_run', { p_actor: actor, p_run_id: id, p_reason: 'user' });
async function row(table, id, key = 'id') {
  const { data, error } = await admin.from(table).select('*').eq(key, id).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  config = localConfig();
  admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  sql = new pg.Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 10000 });
  await sql.query('select 1');
  let commit = 'local';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  console.info(JSON.stringify({ suite: 'D-01..D-14', baseUrl: config.url, database: 'miniatoms-test/local', commit, model: 'none', mode: 'fixture', browser: 'not-applicable' }));
}, 30000);
afterAll(async () => { await sql?.end(); });

describe('real local Supabase permissions and transactions', () => {
  test('D-01 authenticated owner reads only; direct writes and private run columns denied', async () => {
    const a = await user(), b = await user(), p = await project(a.id), ctx = await published(a.id, p);
    for (const [table, columns] of [['projects', '*'], ['versions', '*'], ['messages', '*'], ['app_data', '*'], ['runs', 'id,owner_id,status']]) {
      const key = table === 'projects' ? 'id' : 'project_id';
      const own = await a.client.from(table).select(columns).eq(key, p.id);
      expect(own.error).toBeNull(); expect(own.data.length).toBeGreaterThan(0);
      const other = await b.client.from(table).select(columns).eq(key, p.id);
      expect(other.error).toBeNull(); expect(other.data).toEqual([]);
      expect((await a.client.from(table).insert({ owner_id: a.id })).error).not.toBeNull();
      expect((await a.client.from(table).delete().eq(key, p.id)).error).not.toBeNull();
    }
    for (const column of ['*', 'execution_token', 'agent_messages', 'request_fingerprint', 'input_diagnostics', 'call_records']) {
      expect((await a.client.from('runs').select(column).eq('id', ctx.run.id)).error).not.toBeNull();
    }
    for (const table of ['usage_daily', 'operation_receipts']) expect((await a.client.from(table).select('*')).error).not.toBeNull();
    const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    expect((await anon.from('projects').select('*')).error).not.toBeNull();
  });

  test('D-02 only service role executes RPC, and actor ownership is still enforced', async () => {
    const a = await user(), b = await user(), p = await project(a.id), ctx = await start(a.id, p);
    const args = { p_actor: a.id, p_run_id: ctx.run.id };
    expect((await a.client.rpc('ma_get_run_context', args)).error).not.toBeNull();
    const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    expect((await anon.rpc('ma_get_run_context', args)).error).not.toBeNull();
    await expect(rpc('ma_get_run_context', { ...args, p_actor: b.id })).rejects.toThrow('RESOURCE_NOT_FOUND');
    await expect(cancel(b.id, ctx.run.id)).rejects.toThrow('RESOURCE_NOT_FOUND');
    await cancel(a.id, ctx.run.id);
  });

  test('D-03 concurrent distinct starts serialize to one active run', async () => {
    const a = await user(), p = await project(a.id);
    const results = await Promise.allSettled([start(a.id, p), start(a.id, p)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.message).toBe('RUN_IN_PROGRESS');
    await cancel(a.id, results.find(r => r.status === 'fulfilled').value.run.id);
  });

  test('D-04 concurrent replay has one worker; successful replay precedes base check; create cap serializes', async () => {
    const a = await user(), p = await project(a.id), args = startArgs(a.id, p);
    const results = await Promise.all([rpc('ma_start_run', args), rpc('ma_start_run', args)]);
    expect(results.map(r => r.action).sort()).toEqual(['created', 'duplicate']);
    expect(results.filter(r => r.token)).toHaveLength(1);
    await publishedFromStart();
    expect((await rpc('ma_start_run', args)).action).toBe('duplicate');
    await expect(rpc('ma_start_run', { ...args, p_fingerprint: 'changed', p_prompt: 'changed' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const { data } = await admin.from('messages').select('id').eq('run_id', args.p_run_id).eq('kind', 'request');
    expect(data).toHaveLength(1);
    for (let i = 0; i < 18; i++) await project(a.id);
    const caps = await Promise.allSettled([project(a.id), project(a.id)]);
    expect(caps.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(caps.find(r => r.status === 'rejected').reason.message).toBe('RESOURCE_LIMIT');
    async function publishedFromStart() { await feedback(a.id, await candidate(a.id, p, results.find(r => r.action === 'created'))); }
  });

  test('D-05 errors duplicate claims one repair token; ready replay survives changed data; tool result atomic', async () => {
    const a = await user(), p = await project(a.id), c = await candidate(a.id, p);
    const args = feedbackArgs(a.id, c, { p_outcome: 'errors', p_diagnostics: diagnostics });
    const results = await Promise.all([rpc('ma_accept_feedback', args), rpc('ma_accept_feedback', args)]);
    expect(results.map(r => r.action).sort()).toEqual(['duplicate', 'repair']);
    expect(results.filter(r => r.token)).toHaveLength(1);
    const repair = results.find(r => r.action === 'repair');
    expect(repair.run.agent_messages.filter(m => m.role === 'tool')).toHaveLength(1);
    const c2 = await candidate(a.id, p, repair), readyArgs = feedbackArgs(a.id, c2);
    const ready = await rpc('ma_accept_feedback', readyArgs);
    expect(ready.run.model_calls).toBe(3); expect(ready.run.draft_attempt).toBe(2);
    const toolMessages = ready.run.agent_messages.filter(m => m.role === 'tool');
    expect(new Set(toolMessages.map(m => m.tool_call_id)).size).toBe(2);
    expect(JSON.parse(toolMessages.at(-1).content)).toEqual({ ok: true, stage: 'preview', versionId: c2.candidate.id });
    await rpc('ma_put_app_data', putArgs(a.id, p, ready.candidate.id));
    expect((await rpc('ma_accept_feedback', readyArgs)).action).toBe('duplicate');
    await expect(rpc('ma_accept_feedback', { ...readyArgs, p_fingerprint: 'different' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  test('D-06 cancellation invalidates old worker; a committed version survives later cancellation', async () => {
    const a = await user(), p = await project(a.id), ctx = await start(a.id, p);
    await cancel(a.id, ctx.run.id);
    expect((await update(a.id, ctx, 'generating', { plan })).applied).toBe(false);
    expect((await rpc('ma_finish_run', { p_actor: a.id, p_run_id: ctx.run.id, p_token: ctx.token, p_terminal_status: 'failed', p_error: { code: 'GENERATION_FAILED', message: 'late' } })).applied).toBe(false);
    expect((await row('projects', p.id)).current_version_id).toBeNull();
    const ready = await published(a.id, p);
    expect((await cancel(a.id, ready.run.id)).run.status).toBe('succeeded');
    expect((await row('projects', p.id)).current_version_id).toBe(ready.candidate.id);
  });

  test('D-07 old candidate cannot supersede newer candidate, but original errors report replays', async () => {
    const a = await user(), p = await project(a.id), c = await candidate(a.id, p);
    const args = feedbackArgs(a.id, c, { p_outcome: 'errors', p_diagnostics: diagnostics });
    const repair = await rpc('ma_accept_feedback', args), next = await candidate(a.id, p, repair);
    await expect(feedback(a.id, c)).rejects.toThrow('CANDIDATE_STALE');
    expect((await rpc('ma_accept_feedback', args)).action).toBe('duplicate');
    expect((await row('runs', c.run.id)).candidate_version_id).toBe(next.candidate.id);
    await cancel(a.id, c.run.id);
  });

  test('D-08 publication failure rolls back pointers, numbers, feedback, tool results, run and message', async () => {
    const a = await user(), p = await project(a.id), c = await candidate(a.id, p);
    const beforeRun = await row('runs', c.run.id);
    await sql.query(`create function public.ma_test_abort_result() returns trigger language plpgsql as $f$ begin if NEW.run_id='${c.run.id}'::uuid and NEW.kind='result' then raise exception 'fixture forced rollback'; end if; return NEW; end $f$; create trigger ma_test_abort_result before insert on public.messages for each row execute function public.ma_test_abort_result();`);
    try { await expect(feedback(a.id, c)).rejects.toThrow('fixture forced rollback'); }
    finally { await sql.query('drop trigger ma_test_abort_result on public.messages; drop function public.ma_test_abort_result();'); }
    const afterProject = await row('projects', p.id), afterVersion = await row('versions', c.candidate.id);
    expect(afterProject.current_version_id).toBeNull(); expect(afterProject.next_version_number).toBe(1);
    expect(afterVersion.status).toBe('candidate'); expect(afterVersion.preview_feedback).toBeNull();
    expect(await row('runs', c.run.id)).toEqual(beforeRun);
    expect((await admin.from('messages').select('id').eq('run_id', c.run.id).eq('kind', 'result')).data).toEqual([]);
    await feedback(a.id, c);
  });

  test('D-09 concurrent quota reservations never exceed global/user limits and remain consistent', async () => {
    const a = await user(), p1 = await project(a.id), p2 = await project(a.id), r1 = await start(a.id, p1), r2 = await start(a.id, p2);
    const day = new Date().toISOString().slice(0, 10);
    const { rows } = await sql.query('select scope,calls from public.usage_daily where day=$1 and scope in ($2,$3)', [day, 'global', `user:${a.id}`]);
    const globalBefore = rows.find(r => r.scope === 'global')?.calls || 0, userBefore = rows.find(r => r.scope === `user:${a.id}`)?.calls || 0;
    const reserve = r => rpc('ma_reserve_model_call', { p_actor: a.id, p_run_id: r.run.id, p_token: r.token, p_purpose: 'plan', p_global_daily_limit: globalBefore + 1, p_user_daily_limit: userBefore + 1 });
    const results = await Promise.allSettled([reserve(r1), reserve(r2)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.message).toBe('QUOTA_EXCEEDED');
    const after = (await sql.query('select scope,calls from public.usage_daily where day=$1 and scope in ($2,$3)', [day, 'global', `user:${a.id}`])).rows;
    expect(after.find(r => r.scope === 'global').calls).toBe(globalBefore + 1);
    expect(after.find(r => r.scope === `user:${a.id}`).calls).toBe(userBefore + 1);
    expect((await row('runs', r1.run.id)).model_calls + (await row('runs', r2.run.id)).model_calls).toBe(1);
    await cancel(a.id, r1.run.id); await cancel(a.id, r2.run.id);
  });

  test('D-10 data CAS permits one concurrent update; receipt returns exact original response', async () => {
    const a = await user(), p = await project(a.id), ready = await published(a.id, p);
    const args = putArgs(a.id, p, ready.candidate.id), other = putArgs(a.id, p, ready.candidate.id);
    const results = await Promise.allSettled([rpc('ma_put_app_data', args), rpc('ma_put_app_data', other)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.message).toBe('DATA_REVISION_CONFLICT');
    const index = results.findIndex(r => r.status === 'fulfilled'), original = results[index].value;
    const replay = await rpc('ma_put_app_data', [args, other][index]);
    expect(replay.action).toBe('duplicate'); expect(replay.result).toEqual(original.result);
    expect((await row('app_data', p.id, 'project_id')).revision).toBe(1);
    await expect(rpc('ma_put_app_data', { ...[args, other][index], p_fingerprint: 'changed' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  test('D-11 old version data write and old data preview both conflict without consuming report', async () => {
    const a = await user(), p = await project(a.id), v1 = await published(a.id, p), c = await candidate(a.id, v1.project);
    await rpc('ma_put_app_data', putArgs(a.id, p, v1.candidate.id));
    const args = feedbackArgs(a.id, c);
    await expect(rpc('ma_accept_feedback', args)).rejects.toThrow('PREVIEW_DATA_CHANGED');
    expect((await row('versions', c.candidate.id)).preview_feedback).toBeNull();
    expect((await row('runs', c.run.id)).status).toBe('awaiting_preview');
    await feedback(a.id, c, { p_data_revision: 1 });
    await expect(rpc('ma_put_app_data', putArgs(a.id, p, v1.candidate.id, { p_expected_revision: 1 }))).rejects.toThrow('ACTIVE_VERSION_CHANGED');
  });

  test('D-12 expiry cleanup releases active slot and discards late worker', async () => {
    const a = await user(), p = await project(a.id), ctx = await start(a.id, p);
    await sql.query("update public.runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [ctx.run.id]);
    const next = await start(a.id, p);
    expect((await row('runs', ctx.run.id)).status).toBe('timed_out');
    expect((await update(a.id, ctx, 'generating', { plan })).applied).toBe(false);
    await cancel(a.id, next.run.id);
    const probe = await candidate(a.id, p);
    await sql.query("update public.runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [probe.run.id]);
    expect((await feedback(a.id, probe)).action).toBe('terminal');
    expect((await row('versions', probe.candidate.id)).status).toBe('rejected');
  });

  test('D-13 restoration creates new version/epoch, preserves data and excludes abandoned dialogue', async () => {
    const a = await user(), p = await project(a.id), v1 = await published(a.id, p), v2 = await published(a.id, v1.project);
    await rpc('ma_put_app_data', putArgs(a.id, p, v2.candidate.id));
    const ctx = await start(a.id, v2.project, { p_kind: 'restore', p_prompt: '', p_restore_target_version_id: v1.candidate.id });
    const restored = await feedback(a.id, await candidate(a.id, v2.project, ctx), { p_data_revision: 1 });
    expect(restored.candidate.number).toBe(3); expect(restored.candidate.parent_version_id).toBe(v2.candidate.id);
    expect(restored.candidate.restored_from_version_id).toBe(v1.candidate.id); expect(restored.candidate.artifact).toEqual(v1.candidate.artifact);
    expect(restored.project.context_epoch).toBe(1); expect(restored.run.model_calls).toBe(0);
    expect((await row('app_data', p.id, 'project_id')).state).toEqual({ jobs: ['fixture'] });
    const next = await start(a.id, restored.project), context = await rpc('ma_get_run_context', { p_actor: a.id, p_run_id: next.run.id });
    expect(context.currentVersion.id).toBe(restored.candidate.id);
    expect(context.messages.every(m => m.context_epoch === 1 && ![v1.run.id, v2.run.id].includes(m.run_id))).toBe(true);
    await cancel(a.id, next.run.id);
  });

  test('D-14 failed restoration preserves current code and business state with zero model calls', async () => {
    const a = await user(), p = await project(a.id), v1 = await published(a.id, p), v2 = await published(a.id, v1.project);
    await rpc('ma_put_app_data', putArgs(a.id, p, v2.candidate.id));
    const before = await row('app_data', p.id, 'project_id');
    const ctx = await start(a.id, v2.project, { p_kind: 'restore', p_prompt: '', p_restore_target_version_id: v1.candidate.id });
    const result = await feedback(a.id, await candidate(a.id, v2.project, ctx), { p_outcome: 'errors', p_diagnostics: diagnostics, p_data_revision: 1 });
    expect(result.action).toBe('terminal'); expect(result.run.status).toBe('failed'); expect(result.run.error_code).toBe('RESTORE_PREVIEW_FAILED');
    expect(result.run.model_calls).toBe(0); expect(result.run.draft_attempt).toBe(0);
    expect((await row('projects', p.id)).current_version_id).toBe(v2.candidate.id);
    expect(await row('app_data', p.id, 'project_id')).toEqual(before);
  });
});
