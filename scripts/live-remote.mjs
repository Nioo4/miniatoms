import { execFileSync, spawnSync } from 'node:child_process';
import { getLiveEvidenceConfig } from '../tests/live/evidence-config.mjs';

try {
  process.loadEnvFile('.env.local');
  // Explicit runner opts into read-only evidence from this named remote project.
  // The running Next server owns all real model calls and UI mutations.
  const env = { ...process.env, AI_TEST_MODE: 'off', LIVE_ALLOW_REMOTE_EVIDENCE: '1', LIVE_BASE_URL: 'http://localhost:3000' };
  getLiveEvidenceConfig(env);
  env.APP_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  delete env.DEEPSEEK_API_KEY;
  const result = spawnSync(process.execPath, ['scripts/live.mjs'], { env, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} catch {
  console.error('BLOCKED: remote live prerequisites invalid. Set LIVE_SUPABASE_PROJECT_REF to the authorized project ref; .env.local must configure that exact HTTPS Supabase project. No reset or direct database writes were attempted.');
  process.exitCode = 1;
}
