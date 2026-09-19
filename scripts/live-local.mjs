import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { localConfig } from '../tests/integration/local-config.mjs';

const children = [];
function launch(args, env, stdio) {
  const child = spawn(process.execPath, args, { env, stdio, windowsHide: true, detached: process.platform !== 'win32' });
  children.push(child);
  child.on('error', () => {});
  return child;
}
async function stop() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') await new Promise(resolve => {
      const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('exit', resolve); kill.on('error', resolve);
    });
    else try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().finally(() => process.exit(1)); });

try {
  // Never load api.txt or another project's credentials. CI supplies this one secret.
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error('BLOCKED: DEEPSEEK_API_KEY is required; no real model acceptance was executed.');
  const c = localConfig();
  try {
    for (const [path, token] of [['/auth/v1/health', c.anonKey], ['/rest/v1/projects?select=id&limit=0', c.serviceKey]]) {
      const response = await fetch(c.url + path, { headers: { apikey: token, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      await response.body?.cancel();
    }
  } catch { throw new Error('BLOCKED: local Supabase Auth/schema unavailable; run db:start and db:reset:test.'); }
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('BLOCKED: localhost:3001 is occupied; refusing to test an unknown application.')));
    probe.listen(3001, 'localhost', () => probe.close(resolve));
  });
  let commit = process.env.GITHUB_SHA || process.env.APP_COMMIT_SHA;
  if (!commit) try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { commit = 'local'; }
  const env = { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', AI_TEST_MODE: 'off',
    APP_ORIGIN: 'http://localhost:3001', LIVE_BASE_URL: 'http://localhost:3001', APP_COMMIT_SHA: commit,
    NEXT_PUBLIC_SUPABASE_URL: c.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.anonKey, SUPABASE_SERVICE_ROLE_KEY: c.serviceKey,
    SUPABASE_TEST_URL: c.url, SUPABASE_TEST_ANON_KEY: c.anonKey, SUPABASE_TEST_SERVICE_ROLE_KEY: c.serviceKey,
    DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-flash',
    LLM_USER_DAILY_LIMIT: '20', LLM_GLOBAL_DAILY_LIMIT: '100' };
  delete env.VERCEL;
  console.log(JSON.stringify({ mode: 'live', origin: env.APP_ORIGIN, model: env.DEEPSEEK_MODEL, commit, userDailyLimit: 20, globalDailyLimit: 100 }));
  // Suppress raw Next/upstream logs; browser evidence contains public DTOs and generated source only.
  const next = launch(['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', '--port', '3001'], env, 'ignore');
  let ready = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (next.exitCode !== null) throw new Error('BLOCKED: Next exited before readiness; raw server logs are withheld.');
    try {
      const response = await fetch(env.APP_ORIGIN + '/api/health', { signal: AbortSignal.timeout(2000) });
      const health = await response.json();
      if (response.ok && health.status === 'configured' && health.commit === commit) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('BLOCKED: real Next application failed readiness; no model acceptance claimed.');
  const testEnv = { ...env, NODE_ENV: 'test' };
  delete testEnv.DEEPSEEK_API_KEY;
  const test = launch(['scripts/live.mjs'], testEnv, 'inherit');
  process.exitCode = await new Promise(resolve => { test.once('exit', code => resolve(code ?? 1)); test.once('error', () => resolve(1)); });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('BLOCKED:') ? error.message : 'BLOCKED: local live acceptance setup failed; sensitive diagnostic details withheld.');
  process.exitCode = 1;
} finally { await stop(); }
