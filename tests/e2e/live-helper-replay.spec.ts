import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Artifact } from '../../src/lib/contracts';
import { addJob, dark, choose, erase, field, labelPattern, metric, openForm, row, save, stageFilter, unique, waitRuntimeReady } from '../live/helpers';

// Offline locator regression against recorded real output, with an explicit in-memory
// store. No DeepSeek/Supabase calls and absolutely no live acceptance claim.
const roots = process.env.LIVE_HELPER_ARTIFACT_DIR ? [process.env.LIVE_HELPER_ARTIFACT_DIR] : [
  'artifacts/verification/live-35469717734',
  'artifacts/verification/live-remote-1487d1f',
  'artifacts/verification/live-remote-8b6757f',
  'artifacts/verification/live-remote-5f1ac89',
  'artifacts/verification/live-remote-9f48138',
];
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}
const cases = roots.flatMap(root => files(root).filter(file => (/5f1ac89|9f48138/.test(root) ? /LIVE-09-source-and-evidence\.json$/ : /LIVE-(01|08|09)-source-and-evidence\.json$/).test(file)).map(file => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return { name: `${root.includes('9f48138') ? '9f48138' : root.includes('5f1ac89') ? '5f1ac89' : root.includes('8b6757f') ? '8b6757f' : root.includes('1487') ? '1487' : 'first-ci'}-${basename(file).slice(0, 7)}`, artifact: data.versions.find((v: {status: string}) => v.status === 'ready').artifact as Artifact };
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
    if (recorded.name.startsWith('9f48138')) {
      const checkbox = (await row(frame, '定位阅读')).getByRole('checkbox');
      await checkbox.check(); await metric(frame, '今日完成', 1, 2);
      await expect(metric(frame, '今日完成', 1, 3)).rejects.toThrow('统计 今日完成');
      await checkbox.uncheck(); await metric(frame, '今日完成', 0, 2);
    }
  }
});

async function renderWithState(page: import('@playwright/test').Page, artifact: Artifact, state: Record<string, unknown>) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(origin);
  await page.evaluate(initial => {
    (window as unknown as { harness: { create(a: Artifact): string } }).harness.create({ html: '<p>Fixture store setup</p>', css: '', js: `await appStore.setState(${JSON.stringify(initial)});` });
  }, state);
  await expect.poll(() => page.evaluate(() => (window as unknown as { harness: { snapshot(): { revision: number } } }).harness.snapshot().revision)).toBeGreaterThan(0);
  await page.evaluate(source => {
    const harness = (window as unknown as { harness: { destroy(index: number): void; create(a: Artifact): string } }).harness;
    harness.destroy(0); document.querySelector('iframe')!.remove();
    const id = harness.create(source); const iframe = document.getElementById(id)!;
    iframe.style.width = '818px'; iframe.style.height = '780px';
  }, artifact);
  const frame = page.frameLocator('iframe'); await waitRuntimeReady(frame); return frame;
}
function recordedEvidence(directory: string, step: string) {
  const path = files(directory).find(file => file.endsWith(`${step}-source-and-evidence.json`));
  if (!path) throw new Error(`Missing recorded regression evidence: ${directory}/${step}`);
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  return { artifact: evidence.versions.filter((version: {status:string}) => version.status === 'ready').at(-1).artifact as Artifact,
    state: evidence.data.state as Record<string, unknown> };
}
for (const [name, css, expected] of [
  ['rendered dark gradient', '#app{background:linear-gradient(#11243c,#050b12);color:white}', true],
  ['white canvas with small dark cards', '#app{background:white}.card{background:#11243c;color:white;width:40%;height:100px}', false],
] as const) test(`OFFLINE pixel classifier: ${name}`, async ({ page }) => {
  const frame = await renderWithState(page, { html: '<div class="card">Fixture visual sample</div>', css, js: 'await appStore.getState();' }, {});
  if (expected) await dark(frame, true); else await expect(dark(frame, true)).rejects.toThrow('实际渲染像素诊断');
});
for (const [commit, expected] of [['5f1ac89', false], ['9bbf4ee', true]] as const) test(`OFFLINE actual rendered theme ${commit} with archived business data`, async ({ page }, info) => {
  const evidence = recordedEvidence(`artifacts/verification/live-remote-${commit}`, 'LIVE-03');
  const frame = await renderWithState(page, evidence.artifact, evidence.state);
  await expect(frame.getByText('星河科技', { exact: true })).toBeVisible();
  await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
  if (expected) await info.attach('pixel-diagnostics.json', { body: JSON.stringify(await dark(frame, true)), contentType: 'application/json' });
  else await expect(dark(frame, true)).rejects.toThrow('实际渲染像素诊断');
});
test('OFFLINE 9bb income/expense/balance summary excludes record labels', async ({ page }) => {
  const evidence = recordedEvidence('artifacts/verification/live-remote-9bbf4ee', 'LIVE-08');
  const frame = await renderWithState(page, evidence.artifact, evidence.state);
  await metric(frame, '收入', 1000); await metric(frame, '支出', 200); await metric(frame, '结余', 800);
});
test('OFFLINE 9b612eb stage filter ignores identically named statistic buttons', async ({ page }) => {
  const evidence = recordedEvidence('artifacts/verification/live-remote-9b612eb', 'LIVE-02');
  const frame = await renderWithState(page, evidence.artifact, evidence.state);
  await expect(frame.getByText('星河科技', { exact: true })).toBeVisible();
  await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
  await stageFilter(frame, '面试中');
  await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
  await expect(frame.getByText('星河科技', { exact: true })).toBeHidden();
  await stageFilter(frame, '全部');
  await expect(frame.getByText('星河科技', { exact: true })).toBeVisible();
  await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
  await metric(frame, '全部', 2); await metric(frame, '已投递', 1); await metric(frame, '面试中', 1);
});
test('OFFLINE 9b612eb currency totals do not confuse auxiliary transaction counts', async ({ page }) => {
  const evidence = recordedEvidence('artifacts/verification/live-remote-9b612eb', 'LIVE-08');
  const frame = await renderWithState(page, evidence.artifact, evidence.state);
  await metric(frame, '收入', 1000); await metric(frame, '支出', 200); await metric(frame, '结余', 800);
  // The same income card also renders “1 笔”; that must never satisfy amount=1.
  await expect(metric(frame, '收入', 1)).rejects.toThrow('统计 收入');
});
test('OFFLINE 82a9ef6 monthly currency labels follow the selected month', async ({ page }) => {
  const evidence = recordedEvidence('artifacts/verification/live-remote-82a9ef6', 'LIVE-08');
  const frame = await renderWithState(page, evidence.artifact, evidence.state);
  const month = frame.getByLabel('查看月份', { exact: true });
  await month.fill('2026-09');
  await metric(frame, '收入', 1000); await metric(frame, '支出', 200); await metric(frame, '结余', 800);
  await month.fill('2026-08');
  await metric(frame, '收入', 0); await metric(frame, '支出', 0); await metric(frame, '结余', 0);
  await month.fill('2026-09');
  await metric(frame, '收入', 1000); await metric(frame, '支出', 200); await metric(frame, '结余', 800);
});
