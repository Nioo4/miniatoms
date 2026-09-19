import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Artifact } from '../../src/lib/contracts';
import { addJob, choose, erase, field, labelPattern, metric, openForm, row, save, stageFilter, unique } from '../live/helpers';

// Offline locator regression against recorded real output, with an explicit in-memory
// store. No DeepSeek/Supabase calls and absolutely no live acceptance claim.
const roots = process.env.LIVE_HELPER_ARTIFACT_DIR ? [process.env.LIVE_HELPER_ARTIFACT_DIR] : [
  'artifacts/verification/live-35469717734',
  'artifacts/verification/live-remote-1487d1f',
  'artifacts/verification/live-remote-8b6757f',
  'artifacts/verification/live-remote-5f1ac89',
];
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}
const cases = roots.flatMap(root => files(root).filter(file => (root.includes('5f1ac89') ? /LIVE-09-source-and-evidence\.json$/ : /LIVE-(01|08|09)-source-and-evidence\.json$/).test(file)).map(file => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return { name: `${root.includes('5f1ac89') ? '5f1ac89' : root.includes('8b6757f') ? '8b6757f' : root.includes('1487') ? '1487' : 'first-ci'}-${basename(file).slice(0, 7)}`, artifact: data.versions.find((v: {status: string}) => v.status === 'ready').artifact as Artifact };
}));
let server: Server, origin: string;
test.beforeAll(async () => {
  const compiled = await build({ entryPoints: ['tests/fixtures/preview-harness.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/bundle.js' ? compiled.outputFiles[0].text : '<!doctype html><script src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
for (const recorded of cases) test(`OFFLINE helper replay ${recorded.name}`, async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(artifact => {
    const harness = (window as unknown as {harness:{create(a:Artifact, mode:string, writeDelay:number):string}}).harness;
    harness.create(artifact, 'active', 100);
  }, recorded.artifact);
  const frame = page.frameLocator('iframe');
  // openForm must await the platform runtime marker itself, including startup
  // writes delayed by the explicit in-memory fixture transport.
  if (recorded.name.endsWith('01')) {
    await addJob(frame, '定位回放公司', '2026-09-20', '已投递', '离线定位记录');
    await expect(await row(frame, '定位回放公司')).toBeVisible();
    await stageFilter(frame, '已投递');
    // The first archived source seeds one applied record; subsequent sources
    // start empty. Expectations are fixed from those recorded source contracts.
    const count = recorded.name.startsWith('first-ci') ? 2 : 1;
    await metric(frame, '已投递', count);
    await erase(page, frame, '定位回放公司');
  } else if (recorded.name.endsWith('08')) {
    await openForm(frame, /^金额(?:[（(]元[）)])?[：:*\s]*$/);
    await choose(frame, /类型|收支/, '收入');
    const category = await unique(frame.getByLabel(labelPattern(/^分类[：:*\s]*$/)), '分类');
    if (await category.evaluate(el => el.tagName) === 'SELECT') await category.selectOption({ label: '工资' }); else await category.fill('工资');
    await field(frame, /^(记账)?日期[：:*\s]*$/, '2026-09-20');
    await field(frame, /^金额(?:[（(]元[）)])?[：:*\s]*$/, '1000');
    await field(frame, /^备注[：:*\s]*$/, '离线定位收入'); await save(frame);
    await expect(await row(frame, '离线定位收入')).toBeVisible();
    if (recorded.name.startsWith('first-ci')) {
      test.info().annotations.push({ type: 'known-source-limitation', description: 'Original expense artifact uses window.confirm, blocked by production sandbox; deletion is not claimed by this locator regression.' });
    } else await erase(page, frame, '离线定位收入');
  } else {
    for (const name of ['定位阅读', '定位运动']) {
      await openForm(frame, /^(习惯名称|新习惯|新增习惯|习惯)[：:*\s]*$/); await field(frame, /^(习惯名称|新习惯|新增习惯|习惯)[：:*\s]*$/, name); await save(frame); await expect(await row(frame, name)).toBeVisible();
    }
    await metric(frame, '今日完成', 0, 2);
  }
});
