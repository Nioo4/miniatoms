import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function assertLocal(value, name) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} must identify a local isolated test service`);
  }
  return value;
}

export function localConfig() {
  if (existsSync('.env.test')) process.loadEnvFile('.env.test');
  const config = readFileSync('supabase/config.toml', 'utf8');
  if (!/^project_id\s*=\s*"miniatoms-test"\s*$/m.test(config)) throw new Error('Test project_id must be miniatoms-test');
  // Validate any configured addresses BEFORE starting a CLI or opening a connection.
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_TEST_URL', 'DATABASE_TEST_URL']) {
    if (process.env[key]) assertLocal(process.env[key], key);
  }
  let status = {};
  if (!process.env.SUPABASE_TEST_ANON_KEY || !process.env.SUPABASE_TEST_SERVICE_ROLE_KEY) {
    try {
      status = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }));
    } catch {
      throw new Error('BLOCKED: local Supabase is unavailable. Run npm run db:start; no tests were passed.');
    }
  }
  const url = assertLocal(process.env.SUPABASE_TEST_URL || status.API_URL || 'http://127.0.0.1:54321', 'Supabase test URL');
  const databaseUrl = assertLocal(process.env.DATABASE_TEST_URL || status.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'Database test URL');
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY || status.ANON_KEY;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || status.SERVICE_ROLE_KEY;
  if (!anonKey || !serviceKey) throw new Error('BLOCKED: local Supabase test keys missing; no tests were passed.');
  return { url, databaseUrl, anonKey, serviceKey };
}
