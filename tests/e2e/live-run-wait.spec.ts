import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { ready } from '../live/helpers';

// Offline helper regression: loopback HTTP fixtures and real Chromium only.
// No Supabase, model calls, or claims of real-model acceptance.
const runId = '12345678-1234-1234-1234-123456789abc';
type Run = { id: string; status: string; error?: { code: string } };
async function fixture(page: Page, runs: Run[]) {
  const reads: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === `/api/runs/${runId}`) {
      reads.push(request.url);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ run: runs[Math.min(reads.length - 1, runs.length - 1)] }));
    } else if (request.method === 'POST') {
      response.writeHead(204).end();
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<div class="run-card">新版本已保存</div><div class="preview-toolbar">v1 · 基础检查通过</div><iframe title="应用预览" srcdoc="<div id=app inert>Fixture</div>"></iframe>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await page.goto(origin);
  const [submitted] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST'),
    page.evaluate(async id => {
      await fetch(`/api/projects/${id}/runs`, {
        method: 'POST', headers: { authorization: 'Bearer offline-fixture-only', 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: id }),
      });
    }, runId),
  ]);
  return { submitted, reads, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

for (const status of ['failed', 'cancelled', 'timed_out']) {
  test(`OFFLINE run wait fails fast for current ${status}`, async ({ page }) => {
    test.setTimeout(10_000);
    const state = await fixture(page, [{ id: runId, status, error: { code: 'MODEL_OUTPUT_INVALID' } }]);
    try {
      const started = Date.now();
      await expect(ready(page, 2, state.submitted)).rejects.toThrow(`本次任务 ${runId} 终态 ${status} (MODEL_OUTPUT_INVALID)`);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(state.reads).toEqual([`/api/runs/${runId}`]);
    } finally { await state.close(); }
  });
}

test('OFFLINE run wait ignores stale terminal and pending, then requires target version and runtime readiness', async ({ page }) => {
  const state = await fixture(page, [
    { id: 'previous-run', status: 'failed' },
    { id: runId, status: 'generating' },
    { id: runId, status: 'succeeded' },
  ]);
  try {
    let settled = false;
    const waiting = ready(page, 2, state.submitted).then(() => { settled = true; });
    await expect.poll(() => state.reads.length).toBe(3);
    await page.locator('iframe').evaluate(el => { (el as HTMLIFrameElement).contentDocument!.querySelector<HTMLElement>('#app')!.inert = false; });
    await page.waitForTimeout(250);
    expect(settled).toBe(false);
    // Succeeded run alone cannot substitute for the requested version UI.
    await page.locator('iframe').evaluate(el => { (el as HTMLIFrameElement).contentDocument!.querySelector<HTMLElement>('#app')!.inert = true; });
    await page.locator('.preview-toolbar').evaluate(el => { el.textContent = 'v2 · 基础检查通过'; });
    await expect(page.frameLocator('iframe').locator('#app')).toHaveJSProperty('inert', true);
    await page.waitForTimeout(250);
    expect(settled).toBe(false);
    await page.locator('iframe').evaluate(el => { (el as HTMLIFrameElement).contentDocument!.querySelector<HTMLElement>('#app')!.inert = false; });
    await waiting;
    expect(settled).toBe(true);
    expect(state.reads).toEqual(Array(3).fill(`/api/runs/${runId}`));
  } finally { await state.close(); }
});
