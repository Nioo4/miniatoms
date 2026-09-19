import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertLocal } from './local-config.mjs';

try { process.loadEnvFile('.env.test'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_TEST_URL', 'DATABASE_TEST_URL']) {
  if (process.env[key]) assertLocal(process.env[key], key);
}
if (!/^project_id\s*=\s*"miniatoms-test"\s*$/m.test(readFileSync('supabase/config.toml', 'utf8'))) throw new Error('Refusing reset: not the isolated miniatoms-test project');
// --local is mandatory: no --linked / --db-url and no user-supplied CLI arguments.
execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'db', 'reset', '--local', '--no-seed'], { stdio: 'inherit', timeout: 120_000 });
