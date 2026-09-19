import { readdir, readFile, lstat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { getLiveEvidenceConfig } from '../tests/live/evidence-config.mjs';

const tokenPattern = /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/g;
function containsSecret(text, secrets) {
  tokenPattern.lastIndex = 0;
  return secrets.some(secret => text.includes(secret)) || tokenPattern.test(text);
}
function safeName(name, secrets) {
  for (const secret of secrets) name = name.replaceAll(secret, '[REDACTED]');
  return name.replace(tokenPattern, '[REDACTED]').replace(/[\r\n\x00-\x1f]/g, '_');
}

async function scan(root, secrets) {
  const rejected = [];
  async function walk(path) {
    const stat = await lstat(path);
    const name = relative(root, path) || '.';
    if (stat.isSymbolicLink() || containsSecret(name, secrets)) { rejected.push(safeName(name, secrets)); return; }
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await walk(join(path, entry));
      return;
    }
    // Reject archives/binary reports rather than assume nested or encoded contents are safe.
    if (!stat.isFile() || !['.txt', '.md', '.json', '.html', '.png'].includes(extname(path).toLowerCase())) { rejected.push(safeName(name, secrets)); return; }
    const bytes = await readFile(path);
    const png = extname(path).toLowerCase() === '.png';
    if (png && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { rejected.push(safeName(name, secrets)); return; }
    let text;
    try { text = png ? bytes.toString('latin1') : new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { rejected.push(safeName(name, secrets)); return; }
    if (containsSecret(text, secrets)) rejected.push(safeName(name, secrets));
  }
  await walk(root);
  return rejected;
}

async function selfTest() {
  const root = await mkdtemp(join(tmpdir(), 'miniatoms-artifact-scan-'));
  const fake = 'synthetic-exact-credential-for-test';
  try {
    await writeFile(join(root, 'safe.json'), '{"mode":"live","status":"PASS"}');
    assert.deepEqual(await scan(root, [fake]), []);
    for (const [name, value] of Object.entries({ 'exact.txt': fake, 'jwt.json': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature123', 'key.html': 'sk-synthetic1234567890', 'supabase.txt': 'sb_secret_synthetic1234567890' })) {
      await writeFile(join(root, name), value);
      assert.deepEqual(await scan(root, [fake]), [name]);
      await rm(join(root, name));
    }
    await writeFile(join(root, 'report.zip'), 'opaque report');
    assert.deepEqual(await scan(root, [fake]), ['report.zip']);
    console.log('Artifact scan self-test PASS: clean text accepted; exact keys, JWT, sk, sb_secret and archives blocked.');
  } finally { await rm(root, { recursive: true, force: true }); }
}

try {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error();
    const c = getLiveEvidenceConfig();
    const secrets = [process.env.DEEPSEEK_API_KEY.trim(), c.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, c.serviceKey];
    if (secrets.some(secret => !secret)) throw new Error();
    const rejected = await scan('test-results/live', secrets);
    if (rejected.length) {
      console.error('BLOCKED: artifact upload rejected; affected files only:');
      for (const name of rejected) console.error(name);
      process.exitCode = 1;
    } else console.log('Live artifact credential scan PASS.');
  }
} catch {
  console.error('BLOCKED: artifact scan prerequisites or file validation failed; upload forbidden.');
  process.exitCode = 1;
}
