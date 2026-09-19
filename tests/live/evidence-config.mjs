import { localConfig } from '../integration/local-config.mjs';

export function getLiveEvidenceConfig(env = process.env) {
  if (env.LIVE_ALLOW_REMOTE_EVIDENCE !== '1') return localConfig();
  const ref = env.LIVE_SUPABASE_PROJECT_REF;
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;
  let url;
  try { url = new URL(raw); } catch { throw new Error('BLOCKED: remote evidence Supabase URL is invalid.'); }
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || raw !== `https://${ref}.supabase.co`
    || url.origin !== raw || !env.SUPABASE_SERVICE_ROLE_KEY || env.AI_TEST_MODE !== 'off') {
    throw new Error('BLOCKED: remote evidence requires explicit matching project ref, HTTPS origin, service key and AI_TEST_MODE=off.');
  }
  return { url: raw, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}
