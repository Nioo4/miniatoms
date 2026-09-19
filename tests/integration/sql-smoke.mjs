// Optional PostgreSQL WASM verification. This is NOT Supabase/Auth/REST/concurrency acceptance.
// PGLITE_MODULE optionally selects an independently installed PGlite entry file.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const actor = randomUUID(), other = randomUUID();
const plan = { title: 'SQL fixture', brief: 'SQL fixture', features: ['test'], changeSummary: 'test' };
const artifact = { html: '<button>test</button>', css: '', js: 'await appStore.getState();' };
const hash = createHash('sha256').update(JSON.stringify([artifact.html, artifact.css, artifact.js])).digest('hex');
const diag = [{ code: 'FIXTURE', message: 'test', file: 'preview', line: null, column: null }];
let assertions = 0;
function check(value, expected) { assert.deepEqual(value, expected); assertions++; }
async function rejects(action, code) { await assert.rejects(action, e => e.message === code); assertions++; }
async function rpc(name, args) {
  const keys = Object.keys(args);
  const values = Object.values(args).map(x => x !== null && typeof x === 'object' ? JSON.stringify(x) : x);
  return (await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`, values)).rows[0].value;
}
const row = async (table, id, key = 'id') => (await db.query(`select * from public.${table} where ${key}=$1`, [id])).rows[0];
async function makeProject(who = actor) { return (await rpc('ma_create_project', { p_actor: who, p_project_id: randomUUID(), p_title: 'SQL fixture', p_fingerprint: randomUUID() })).project; }
const startArgs = (p, options = {}) => ({ p_actor: actor, p_run_id: randomUUID(), p_project_id: p.id, p_kind: 'generate', p_prompt: 'SQL fixture', p_input_diagnostics: [], p_base_version_id: p.current_version_id, p_restore_target_version_id: null, p_fingerprint: randomUUID(), ...options });
const start = (p, options) => rpc('ma_start_run', startArgs(p, options));
const update = (r, status, patch) => rpc('ma_update_run', { p_actor: actor, p_run_id: r.run.id, p_token: r.token, p_expected_status: r.run.status, p_next_status: status, p_patch: patch });
async function reserve(r, purpose, limit = 1000000) {
  return rpc('ma_reserve_model_call', { p_actor: actor, p_run_id: r.run.id, p_token: r.token, p_purpose: purpose, p_user_daily_limit: limit, p_global_daily_limit: limit });
}
async function model(r, purpose) {
  r = await reserve(r, purpose);
  const records = structuredClone(r.run.call_records);
  Object.assign(records.at(-1), { status: 'ok', finishedAt: new Date().toISOString() });
  return update(r, r.run.status, { callRecords: records });
}
async function stage(p, r) {
  r ??= await start(p);
  if (r.run.kind === 'generate') {
    if (r.run.status === 'planning') r = await update(await model(r, 'plan'), 'generating', { plan });
    r = await model(r, 'write');
    r = await update(r, 'validating', { agentMessages: [...r.run.agent_messages, { role: 'assistant', tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'write_app', arguments: '{}' } }] }] });
  }
  return rpc('ma_stage_candidate', { p_actor: actor, p_run_id: r.run.id, p_token: r.token, p_artifact: artifact, p_plan: plan, p_summary: 'SQL fixture', p_source_hash: hash, p_agent_messages: r.run.agent_messages });
}
const feedbackArgs = (c, options = {}) => ({ p_actor: actor, p_run_id: c.run.id, p_candidate_version_id: c.candidate.id, p_source_hash: hash, p_feedback_request_id: randomUUID(), p_fingerprint: randomUUID(), p_outcome: 'ready', p_data_revision: 0, p_diagnostics: [], ...options });
const feedback = (c, options) => rpc('ma_accept_feedback', feedbackArgs(c, options));
const cancel = id => rpc('ma_cancel_run', { p_actor: actor, p_run_id: id, p_reason: 'user' });
const putArgs = (p, version, options = {}) => ({ p_actor: actor, p_project_id: p.id, p_request_id: randomUUID(), p_version_id: version, p_expected_revision: 0, p_state: { records: ['preserved'] }, p_fingerprint: randomUUID(), ...options });

try {
  // These minimal auth objects are only a test shim; no Supabase service is impersonated.
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated;");
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)', [actor, other]);
  await db.exec('set role service_role');
  const p = await makeProject(), args = startArgs(p), r = await rpc('ma_start_run', args);
  check((await rpc('ma_start_run', args)).action, 'duplicate');
  check((await rpc('ma_start_run', args)).token, null);
  await rejects(() => rpc('ma_start_run', { ...args, p_fingerprint: 'changed' }), 'IDEMPOTENCY_CONFLICT');
  await rejects(() => start(p), 'RUN_IN_PROGRESS');
  await rejects(() => rpc('ma_get_run_context', { p_actor: other, p_run_id: r.run.id }), 'RESOURCE_NOT_FOUND');
  await rejects(() => update(r, 'succeeded', {}), 'RUN_STATE_CONFLICT');
  await rejects(() => update(r, 'planning', { modelCalls: 0 }), 'INVALID_REQUEST');
  check((await update({ ...r, token: null }, 'planning', {})).applied, false);
  await rejects(() => reserve(r, 'plan', 0), 'QUOTA_EXCEEDED');
  check((await row('runs', r.run.id)).model_calls, 0);
  const c = await stage(p, r);
  check(c.run.status, 'awaiting_preview');
  const errorArgs = feedbackArgs(c, { p_outcome: 'errors', p_diagnostics: diag });
  const repair = await rpc('ma_accept_feedback', errorArgs);
  check(repair.action, 'repair');
  check((await rpc('ma_accept_feedback', errorArgs)).token, null);
  check(repair.run.agent_messages.filter(m => m.role === 'tool').length, 1);
  const c2 = await stage(p, repair);
  await rejects(() => feedback(c), 'CANDIDATE_STALE');
  const readyArgs = feedbackArgs(c2), ready = await rpc('ma_accept_feedback', readyArgs);
  check(ready.action, 'committed'); check(ready.candidate.number, 1);
  check(ready.run.agent_messages.filter(m => m.role === 'tool').length, 2);
  check((await rpc('ma_start_run', args)).action, 'duplicate');
  check((await cancel(ready.run.id)).run.status, 'succeeded');
  const dataArgs = putArgs(p, ready.candidate.id), data = await rpc('ma_put_app_data', dataArgs);
  check(data.result.revision, 1);
  check((await rpc('ma_put_app_data', dataArgs)).result, data.result);
  check((await rpc('ma_accept_feedback', readyArgs)).action, 'duplicate');
  await rejects(() => rpc('ma_put_app_data', putArgs(p, ready.candidate.id)), 'DATA_REVISION_CONFLICT');
  await rejects(() => rpc('ma_put_app_data', { ...dataArgs, p_fingerprint: 'changed' }), 'IDEMPOTENCY_CONFLICT');
  const next = await stage(ready.project);
  await rejects(() => feedback(next), 'PREVIEW_DATA_CHANGED');
  check((await row('versions', next.candidate.id)).preview_feedback, null);
  const v2 = await feedback(next, { p_data_revision: 1 });
  await rejects(() => rpc('ma_put_app_data', putArgs(p, ready.candidate.id, { p_expected_revision: 1 })), 'ACTIVE_VERSION_CHANGED');
  const restore = await start(v2.project, { p_kind: 'restore', p_prompt: '', p_restore_target_version_id: ready.candidate.id });
  const v3 = await feedback(await stage(v2.project, restore), { p_data_revision: 1 });
  check(v3.project.context_epoch, 1); check(v3.candidate.number, 3); check(v3.run.model_calls, 0);
  check(v3.candidate.parent_version_id, v2.candidate.id); check(v3.candidate.restored_from_version_id, ready.candidate.id);
  check((await row('app_data', p.id, 'project_id')).state, { records: ['preserved'] });
  const afterRestore = await start(v3.project), context = await rpc('ma_get_run_context', { p_actor: actor, p_run_id: afterRestore.run.id });
  check(context.messages.every(m => m.context_epoch === 1), true);
  check(context.currentVersion.id, v3.candidate.id);
  await cancel(afterRestore.run.id);
  check((await update(afterRestore, 'generating', { plan })).applied, false);
  const badRestore = await start(v3.project, { p_kind: 'restore', p_prompt: '', p_restore_target_version_id: ready.candidate.id });
  const failed = await feedback(await stage(v3.project, badRestore), { p_data_revision: 1, p_outcome: 'errors', p_diagnostics: diag });
  check(failed.run.error_code, 'RESTORE_PREVIEW_FAILED'); check(failed.run.model_calls, 0);
  check((await row('projects', p.id)).current_version_id, v3.candidate.id);

  // Test real PostgreSQL role/column enforcement, separately from unexecuted REST/Auth tests.
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`);
  check((await db.query('select id from public.projects')).rows.length, 0);
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false);`);
  check((await db.query('select id from public.projects')).rows.length, 1);
  await rejects(() => db.query('select execution_token from public.runs'), 'permission denied for table runs');
  await rejects(() => db.query('select * from public.runs'), 'permission denied for table runs');
  await rejects(() => db.query('update public.projects set title=title'), 'permission denied for table projects');
  await rejects(() => rpc('ma_get_run_context', { p_actor: actor, p_run_id: r.run.id }), 'permission denied for function ma_get_run_context');
  await db.exec('reset role');

  const exp = await start(v3.project);
  await db.query("update public.runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [exp.run.id]);
  const replacement = await start(v3.project);
  check((await row('runs', exp.run.id)).status, 'timed_out');
  check((await update(exp, 'generating', { plan })).applied, false);
  await cancel(replacement.run.id);
  const pc = await makeProject(), rollback = await stage(pc);
  const before = await row('runs', rollback.run.id);
  await db.exec(`create function public.test_abort() returns trigger language plpgsql as $$begin if NEW.run_id='${rollback.run.id}'::uuid and NEW.kind='result' then raise exception 'forced rollback'; end if; return NEW; end$$; create trigger test_abort before insert on public.messages for each row execute function public.test_abort();`);
  await rejects(() => feedback(rollback), 'forced rollback');
  await db.exec('drop trigger test_abort on public.messages; drop function public.test_abort();');
  check((await row('projects', pc.id)).current_version_id, null);
  check((await row('projects', pc.id)).next_version_number, 1);
  check((await row('versions', rollback.candidate.id)).preview_feedback, null);
  check(await row('runs', rollback.run.id), before);
  await feedback(rollback);

  const exhaustedProject = await makeProject();
  let attempt = await stage(exhaustedProject);
  for (let i = 0; i < 2; i++) {
    const repairAttempt = await feedback(attempt, { p_outcome: 'errors', p_diagnostics: diag });
    check(repairAttempt.action, 'repair');
    attempt = await stage(exhaustedProject, repairAttempt);
  }
  const exhausted = await feedback(attempt, { p_outcome: 'errors', p_diagnostics: diag });
  check(exhausted.run.error_code, 'REPAIR_EXHAUSTED'); check(exhausted.run.model_calls, 4); check(exhausted.run.draft_attempt, 3);
  check(exhausted.run.agent_messages.filter(m => m.role === 'tool').length, 3);
  check((await row('projects', exhaustedProject.id)).current_version_id, null);
  const expiredCandidate = await stage(exhaustedProject);
  await db.query("update public.runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expiredCandidate.run.id]);
  const expiredFeedback = await feedback(expiredCandidate);
  check(expiredFeedback.action, 'terminal'); check(expiredFeedback.run.status, 'timed_out'); check(expiredFeedback.candidate.status, 'rejected');

  const quotaProject = await makeProject(), unreserved = await start(quotaProject), reserved = await reserve(unreserved, 'plan');
  await rejects(() => reserve(reserved, 'plan'), 'RUN_STATE_CONFLICT');
  await rejects(() => update(reserved, 'planning', { callRecords: [] }), 'INVALID_REQUEST');
  const changedIdentity = structuredClone(reserved.run.call_records); changedIdentity[0].purpose = 'write';
  await rejects(() => update(reserved, 'planning', { callRecords: changedIdentity }), 'INVALID_REQUEST');
  const badStatus = structuredClone(reserved.run.call_records); badStatus[0].status = null;
  await rejects(() => update(reserved, 'planning', { callRecords: badStatus }), 'INVALID_REQUEST');
  const fakeResult = [{ role: 'tool', tool_call_id: 'never-issued', content: '{}' }];
  await rejects(() => update(reserved, 'planning', { agentMessages: fakeResult }), 'INVALID_REQUEST');
  await cancel(reserved.run.id);

  // Composite FKs prevent a service-role programming error from linking a different project.
  await assert.rejects(() => db.query('update public.projects set current_version_id=$1 where id=$2', [ready.candidate.id, quotaProject.id]), e => e.code === '23503'); assertions++;
  const invalidState = putArgs(p, v3.candidate.id, { p_expected_revision: 1, p_state: { constructor: 'forbidden' } });
  await rejects(() => rpc('ma_put_app_data', invalidState), 'INVALID_REQUEST');
  await rejects(() => rpc('ma_put_app_data', { ...invalidState, p_state: { value: 'x'.repeat(65536) } }), 'PAYLOAD_TOO_LARGE');
  check((await row('app_data', p.id, 'project_id')).revision, 1);

  // Sequential capacity boundary supplements (but does not replace) the concurrent create test.
  while ((await db.query('select count(*)::int as n from public.projects where owner_id=$1', [actor])).rows[0].n < 20) await makeProject();
  await rejects(() => makeProject(), 'RESOURCE_LIMIT');
  console.info(JSON.stringify({ result: 'PASS', assertions, engine: 'PostgreSQL/PGlite', auth: 'explicit test shim', model: 'fixture/no network', supabaseIntegration: 'NOT_RUN', concurrency: 'NOT_RUN' }));
} finally { await db.close(); }
