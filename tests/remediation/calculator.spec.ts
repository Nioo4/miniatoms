import { test, expect, chromium, type FrameLocator } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { app, create, modify, ready, unique, waitRuntimeReady } from '../live/helpers';
import { getLiveEvidenceConfig } from '../live/evidence-config.mjs';

// Explicit opt-in only. This suite makes four real generation requests, never retries.
test('R01–R05 real calculator remediation with a persistent browser profile', async ({}, info) => {
  if (process.env.REMEDIATION_APPROVED !== '1') throw new Error('Set REMEDIATION_APPROVED=1 only after candidate approval');
  const base = process.env.LIVE_BASE_URL;
  if (!base) throw new Error('LIVE_BASE_URL is required');
  const healthResponse = await fetch(`${base}/api/health`), health = await healthResponse.json();
  expect(healthResponse.status).toBe(200); expect(health.status).toBe('configured');
  expect(health.commit, 'Pin the explicitly approved candidate commit').toBe(process.env.REMEDIATION_COMMIT);
  const config = getLiveEvidenceConfig();
  const db = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const checkpointPath = process.env.REMEDIATION_CHECKPOINT;
  if (!checkpointPath) throw new Error('REMEDIATION_CHECKPOINT is required to resume without regenerating');
  const saved = await readFile(checkpointPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
  if (saved && (saved.base !== base || saved.commit !== health.commit)) throw new Error('Checkpoint belongs to another candidate');
  const profile: string = saved?.profile ?? await mkdtemp(join(tmpdir(), 'miniatoms-remediation-profile-'));
  const launch = () => chromium.launchPersistentContext(profile, { baseURL: base, headless: true, viewport: { width: 1440, height: 1000 } });
  let context = await launch(), page = await context.newPage(), project: string = saved?.project ?? '';
  context.setDefaultTimeout(15_000);
  const inputs = [
    '帮我做一个中文计算器，支持加减乘除、清空和计算历史，刷新后保留历史记录，适配手机。',
    '增加贪吃蛇游戏，支持开始、暂停、重新开始、方向键控制和分数显示，保留原有计算器、计算历史和数据。',
    '增加一个浅色/深色主题切换按钮，并将页面主色改为蓝绿色；保留四则运算计算器和贪吃蛇的全部功能。',
    '只将计算器标题改为“我的计算器”，保留当前版本的其他功能和数据。',
  ];
  const outcomes: Record<string, { status: string; startedAt: string; reason?: string }> = saved?.outcomes ?? {};
  const historyBaselines: Record<string, string[]> = saved?.historyBaselines ?? {};
  async function checkpoint() { await writeFile(checkpointPath!, JSON.stringify({ base, commit: health.commit, profile, project, outcomes, historyBaselines }, null, 2)); }
  async function settled() { await expect(page.locator('.preview-footer')).not.toContainText(/正在保存|未保存/); }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function snapshot() {
    project ||= page.url().match(/projects\/([a-f0-9-]{36})/)?.[1] ?? '';
    if (!project) return null;
    const queries = {
      projects: 'id,owner_id,title,current_version_id,context_epoch',
      messages: 'id,role,kind,content,run_id,context_epoch,created_at',
      runs: 'id,kind,status,base_version_id,result_version_id,model_calls,error_code,call_records,created_at',
      versions: 'id,number,status,parent_version_id,restored_from_version_id,source_hash,artifact',
      app_data: 'revision,state',
    };
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const [table, fields] of Object.entries(queries)) {
      const query = db.from(table).select(fields).eq(table === 'projects' ? 'id' : 'project_id', project);
      const response = await (['messages', 'runs', 'versions'].includes(table) ? query.order('created_at').order('id') : query);
      if (response.error) throw new Error(`Read-only evidence failed: ${table}`);
      result[table] = response.data as unknown as Record<string, unknown>[];
    }
    return result;
  }
  async function stage(name: string, action: () => Promise<void>) {
    if (outcomes[name]?.status === 'PASS') return;
    const startedAt = new Date().toISOString();
    try { await action(); outcomes[name] = { status: 'PASS', startedAt }; }
    catch (error) { outcomes[name] = { status: 'FAIL', startedAt, reason: String(error) }; throw error; }
    finally {
      project ||= page.url().match(/projects\/([a-f0-9-]{36})/)?.[1] ?? ''; await checkpoint();
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
      await writeFile(info.outputPath(`${name}-ui.txt`), await page.locator('body').ariaSnapshot());
      await writeFile(info.outputPath(`${name}-app-ui.txt`), await app(page).locator('body').ariaSnapshot().catch(() => 'Preview unavailable'));
      await writeFile(info.outputPath(`${name}-evidence.json`), JSON.stringify(await snapshot(), null, 2));
    }
  }
  async function press(frame: FrameLocator, name: RegExp, delay = 0) { await (await unique(frame.getByRole('button', { name }), `计算按键 ${name}`)).click({ delay }); }
  async function arithmetic(frame: FrameLocator, keyDelay = 0) {
    await waitRuntimeReady(frame);
    const calculatorTab = frame.getByRole('navigation').getByRole('button', { name: '计算器', exact: true });
    if (await calculatorTab.count() === 1) await calculatorTab.click();
    const history = await unique(frame.getByRole('region', { name: /计算历史|历史记录/ }), '计算历史');
    for (const [operator, result, expressionOperator] of [[/^(\+|加|加法)$/, '15', '(?:\\+|add)'], [/^(−|-|减|减法)$/, '9', '(?:−|-|subtract)'], [/^(×|\*|乘|乘法)$/, '36', '(?:×|\\*|multiply)'], [/^(÷|\/|除|除法)$/, '4', '(?:÷|/|divide)']] as const) {
      await press(frame, /^(C|AC|清空|清除)$/, keyDelay);
      const labelledDisplay = frame.getByRole('region', { name: /显示|结果/ });
      const display = await unique(await labelledDisplay.count() ? labelledDisplay : frame.getByRole('status'), '计算显示区');
      await expect(display.getByText('0', { exact: true }).first()).toBeVisible();
      const oldEntries = await history.getByRole('listitem').allInnerTexts(); const before = oldEntries.length;
      for (const key of [/^1$/, /^2$/, operator, /^3$/, /^(=|等于|计算)$/]) await press(frame, key, keyDelay);
      await expect(history.getByRole('listitem')).toHaveCount(before + 1);
      await expect(display.getByText(result, { exact: true }).first()).toBeVisible();
      // Multiset subtraction proves the newly added record, including duplicates.
      const unmatched = [...oldEntries], added: string[] = [];
      for (const text of await history.getByRole('listitem').allInnerTexts()) { const index = unmatched.indexOf(text); if (index >= 0) unmatched.splice(index, 1); else added.push(text); }
      expect(unmatched).toEqual([]); expect(added).toHaveLength(1);
      expect(added[0]).toMatch(new RegExp(`12\\s*${expressionOperator}\\s*3\\s*(?:=|＝)\\s*${result}(?:\\D|$)`));
    }
    const count = await history.getByRole('listitem').count();
    await press(frame, /^(C|AC|清空|清除)$/, keyDelay);
    const labelled = frame.getByRole('region', { name: /显示|结果/ });
    const display = await unique(await labelled.count() ? labelled : frame.getByRole('status'), '清空后的计算显示区');
    await expect(display.getByText('0', { exact: true }).first()).toBeVisible();
    await expect(history.getByRole('listitem')).toHaveCount(count);
  }
  async function change(input: string, version: number) {
    const before = (await snapshot())!;
    if (before.versions.some(v => v.number === version && v.status === 'ready')) {
      await ready(page, version);
      const history = await app(page).getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem').allTextContents();
      if (!historyBaselines[version]) throw new Error('Missing saved history baseline for resumed version');
      for (const entry of historyBaselines[version]) expect(history).toContain(entry); return;
    }
    if (before.messages.some(message => message.role === 'user' && message.content === input)) throw new Error('This generation was already submitted but produced no ready target version; inspect its run, do not automatically resubmit');
    const historyBefore = await app(page).getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem').allTextContents();
    historyBaselines[version] = historyBefore; await checkpoint();
    await modify(page, input, version); await checkpoint();
    const historyAfter = await app(page).getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem').allTextContents();
    for (const entry of historyBefore) expect(historyAfter).toContain(entry);
    await writeFile(info.outputPath(`v${version}-history-preservation.json`), JSON.stringify({ before: before.app_data, after: (await snapshot())!.app_data, historyBefore, historyAfter }, null, 2));
  }
  async function snake() {
    const frame = app(page);
    const gameTab = frame.getByRole('navigation').getByRole('button', { name: '贪吃蛇', exact: true });
    if (await gameTab.count() === 1) await gameTab.click();
    const game = await unique(frame.getByRole('region', { name: /贪吃蛇/ }), '贪吃蛇区域');
    const board = await unique(game.locator('canvas'), '贪吃蛇棋盘');
    const state = (await snapshot())!, current = state.versions.find(v => v.id === state.projects[0].current_version_id)!;
    const source = String((current.artifact as Record<string, unknown>).js);
    // Read-only measurement adapter grounded in this real model's rendering code.
    let headColor = source.match(/i\s*===?\s*0\s*\?\s*["'](#[a-f\d]{6})/i)?.[1];
    const headVariable = source.match(/headColor\s*=\s*readThemeColor\(["'](--[\w-]+)["']/)?.[1];
    if (!headColor && headVariable) headColor = (await board.evaluate((el, variable) => getComputedStyle(el).getPropertyValue(variable).trim(), headVariable));
    if (!headColor) throw new Error('Inspect generated canvas head rendering before choosing a pixel measurement');
    const head = () => board.evaluate((canvas, color) => { const c = canvas as HTMLCanvasElement, data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); let x = 0, y = 0, count = 0; for (let i = 0; i < data.length; i += 4) { if (rgb.every((value, channel) => Math.abs(data[i + channel] - value) <= 2)) { x += (i / 4) % c.width; y += Math.floor(i / 4 / c.width); count++; } } if (!count) throw new Error('Snake head pixels missing'); return { x: x / count, y: y / count }; }, headColor);
    await (await unique(game.getByRole('button', { name: /^开始(?:游戏)?$/ }), '开始游戏')).click();
    const before = await head();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await head()).y, { timeout: 3000, intervals: [50] }).toBeGreaterThan(before.y);
    const down = await head();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await head()).x, { timeout: 3000, intervals: [50] }).toBeLessThan(down.x);
    await (await unique(game.getByRole('button', { name: /^暂停(?:游戏)?$/ }), '暂停游戏')).click();
    await expect(game.getByText(/已暂停|暂停中/)).toBeVisible();
    const paused = await board.screenshot(); await page.waitForTimeout(500); expect((await board.screenshot()).equals(paused)).toBe(true); await page.waitForTimeout(500); expect((await board.screenshot()).equals(paused)).toBe(true);
    await writeFile(info.outputPath(`snake-v${current.number}.json`), JSON.stringify({ headColor, before, down, pausedStableMs: 1000 }, null, 2));
    await (await unique(game.getByRole('button', { name: /^(重新开始|重开)(?:游戏)?$/ }), '重新开始')).click();
    await expect(game.getByText(/已暂停|暂停中/)).toBeHidden();
    await (await unique(game.getByRole('button', { name: /^暂停(?:游戏)?$/ }), '暂停游戏')).click();
    const calc = frame.getByRole('navigation').getByRole('button', { name: '计算器', exact: true }); if (await calc.count() === 1) await calc.click();
  }
  async function source(artifact: Record<string, unknown>) {
    await page.getByRole('button', { name: '源码', exact: true }).click();
    for (const [key, label] of [['html', 'index.html'], ['css', 'styles.css'], ['js', 'app.js']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      expect(await page.locator('.code-panel pre code').textContent()).toBe(String(artifact[key]));
    }
    await page.getByRole('button', { name: '预览', exact: true }).click(); await waitRuntimeReady(app(page));
  }
  try {
    await checkpoint();
    if (project) { await page.goto(`/projects/${project}`); const existing = (await snapshot())!; const versions = existing.versions.filter(v => v.status === 'ready'); if (!versions.length) throw new Error('Existing project has no published version; inspect its original run without regenerating'); const latest = Math.max(...versions.map(v => Number(v.number))); await ready(page, latest); }
    await stage('R01', async () => { if (!project) { project = await create(page, inputs[0]); await checkpoint(); } await arithmetic(app(page)); await settled(); const before = (await snapshot())!.app_data; const history = await app(page).getByRole('region', { name: /计算历史|历史记录/ }).ariaSnapshot(); await page.reload(); await ready(page, 1); expect((await snapshot())!.app_data).toEqual(before); expect(await app(page).getByRole('region', { name: /计算历史|历史记录/ }).ariaSnapshot()).toBe(history); });
    await stage('R02-v2', async () => {
      await change(inputs[1], 2); await arithmetic(app(page));
      await snake();
    });
    await stage('R02-v3', async () => {
      await change(inputs[2], 3); await arithmetic(app(page));
      await snake();
      const theme = await unique(app(page).getByRole('button', { name: /主题|深色|浅色/ }), '主题切换');
      const styles = () => app(page).locator('body > #app').evaluate(el => [el, ...el.querySelectorAll('section,input,button')].map(node => { const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color }; }));
      const before = await styles(), revision = (await snapshot())!.app_data[0].revision; await theme.click();
      await expect.poll(styles).not.toEqual(before);
      const after = await styles(); expect(after.some((value, i) => value.background !== before[i]?.background)).toBe(true); expect(after.some((value, i) => value.color !== before[i]?.color)).toBe(true);
      await expect.poll(async () => (await snapshot())!.app_data[0].revision).toBeGreaterThan(Number(revision));
      await writeFile(info.outputPath('R02-theme-styles.json'), JSON.stringify({ before, after }, null, 2));
    });
    await stage('R03', async () => {
      await settled();
      const before = (await snapshot())!; const current = before.versions.find(v => v.id === before.projects[0].current_version_id)!;
      await source(current.artifact as Record<string, unknown>);
      const previewBefore = await app(page).getByRole('region', { name: /计算历史|历史记录/ }).ariaSnapshot();
      await context.close(); // closes the dedicated browser process; no storageState copy
      context = await launch(); context.setDefaultTimeout(15_000); page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const ownerResponse = page.waitForResponse(response => response.url() === `${base}/api/projects/${project}` && response.request().method() === 'GET');
      await page.goto(`/projects/${project}`); expect((await ownerResponse).status()).toBe(200); await ready(page, 3);
      const after = (await snapshot())!;
      expect(after).toEqual(before);
      await expect(await unique(page.getByRole('navigation', { name: '我的项目' }).getByRole('button').filter({ hasText: String(before.projects[0].title) }), '已恢复项目导航')).toBeVisible();
      for (const input of inputs.slice(0, 3)) await expect(page.getByText(input, { exact: true })).toBeVisible();
      expect(await app(page).getByRole('region', { name: /计算历史|历史记录/ }).ariaSnapshot()).toBe(previewBefore);
      await source(current.artifact as Record<string, unknown>);
      const revision = Number(after.app_data[0].revision); await arithmetic(app(page)); await settled(); expect(Number((await snapshot())!.app_data[0].revision)).toBeGreaterThan(revision);
    });
    await stage('R04-restore', async () => {
      await settled();
      const before = (await snapshot())!, v1 = before.versions.find(v => v.number === 1)!;
      await page.getByRole('button', { name: '版本', exact: true }).click();
      await page.locator('.version-card').filter({ has: page.locator('.version-number', { hasText: /^v1$/ }) }).click();
      const history = page.frameLocator('iframe[title="历史版本预览（操作不保存）"]'); await waitRuntimeReady(history);
      const historical = await history.locator('body').ariaSnapshot();
      await history.owner().screenshot({ path: info.outputPath('R04-v1-preview.png'), animations: 'disabled' });
      if (!before.versions.some(v => v.number === 4)) { page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '恢复此版本', exact: true }).click(); }
      else await page.getByRole('button', { name: '返回当前', exact: true }).click();
      await ready(page, 4);
      const restored = (await snapshot())!, v4 = restored.versions.find(v => v.number === 4)!;
      expect(v4.artifact).toEqual(v1.artifact); expect(v4.source_hash).toBe(v1.source_hash); expect(v4.restored_from_version_id).toBe(v1.id);
      expect(restored.app_data).toEqual(before.app_data); expect(await app(page).locator('body').ariaSnapshot()).toBe(historical);
      await source(v1.artifact as Record<string, unknown>); await arithmetic(app(page));
    });
    await stage('R04-followup', async () => {
      const v4 = (await snapshot())!.versions.find(v => v.number === 4)!;
      await change(inputs[3], 5); const after = (await snapshot())!, v5 = after.versions.find(v => v.number === 5)!;
      expect(v5.parent_version_id).toBe(v4.id); expect(after.runs.find(r => r.result_version_id === v5.id)?.base_version_id).toBe(v4.id);
      await expect(app(page).getByRole('heading', { name: '我的计算器', exact: true })).toBeVisible();
      await expect(app(page).getByRole('region', { name: /贪吃蛇/ })).toHaveCount(0); await expect(app(page).getByRole('button', { name: /主题|深色|浅色/ })).toHaveCount(0);
      await source(v5.artifact as Record<string, unknown>); await arithmetic(app(page));
    });
    await stage('R05', async () => {
      await settled();
      const before = (await snapshot())!; const download = page.waitForEvent('download'); await page.getByRole('button', { name: /导出 HTML/ }).click();
      const path = join(await mkdtemp(join(tmpdir(), 'miniatoms-remediation-export-')), 'export.html'); await (await download).saveAs(path);
      const html = await readFile(path, 'utf8');
      const unsafe = html.includes(config.serviceKey) || /sb_secret_|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(html);
      expect(unsafe, 'Export contains no credential material').toBe(false);
      const secondProfile = process.env.REMEDIATION_ISOLATION_PROFILE, secondUrl = process.env.REMEDIATION_ISOLATION_PROJECT_URL;
      if (!secondProfile || !secondUrl || secondUrl.endsWith(project)) throw new Error('A separate already-generated owned project/profile is required for export namespace isolation');
      const second = await chromium.launchPersistentContext(secondProfile, { headless: true });
      let secondHtml: string;
      try {
        const tab = await second.newPage(); await tab.goto(secondUrl); await ready(tab, 1);
        const pending = tab.waitForEvent('download'); await tab.getByRole('button', { name: /导出 HTML/ }).click();
        const secondPath = join(await mkdtemp(join(tmpdir(), 'miniatoms-other-export-')), 'export.html'); await (await pending).saveAs(secondPath); secondHtml = await readFile(secondPath, 'utf8');
      } finally { await second.close(); }
      const standalone = await chromium.launch(); const isolated = await standalone.newContext();
      await isolated.addInitScript(() => {
        const records: { time: number; ok: boolean; code?: string }[] = [];
        Object.defineProperty(window, '__testBridgeResults', { value: records });
        window.addEventListener('message', event => { const data = event.data; if (data?.namespace === 'miniatoms' && data?.type === 'store.result') records.push({ time: performance.now(), ok: data.ok, code: data.error?.code }); });
      });
      const exported = await isolated.newPage();
      try {
        await exported.goto(pathToFileURL(path).href); const f = exported.frameLocator('iframe'); await waitRuntimeReady(f);
        await expect(f.getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem')).toHaveCount(0);
        await arithmetic(f, 100); expect((await snapshot())!.app_data).toEqual(before.app_data);
        await exported.screenshot({ path: info.outputPath('R05-independent-file.png'), animations: 'disabled' });
        const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(request.url === '/other' ? secondHtml : html); });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const address = server.address(); if (!address || typeof address === 'string') throw new Error('Export server missing');
          await exported.goto(`http://127.0.0.1:${address.port}`); await waitRuntimeReady(f);
          await expect(f.getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem')).toHaveCount(0);
          await arithmetic(f, 100); await exported.reload(); await waitRuntimeReady(f);
          await expect(f.getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem')).toHaveCount(4);
          await exported.goto(`http://127.0.0.1:${address.port}/other`); await waitRuntimeReady(f);
          await expect(f.getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem')).toHaveCount(0);
          await arithmetic(f, 100);
          const history = f.getByRole('region', { name: /计算历史|历史记录/ });
          await (await unique(f.getByRole('button', { name: /清空(?:全部)?历史|清除(?:全部)?历史/ }), '清空历史')).click();
          const dialog = f.getByRole('dialog').filter({ visible: true });
          await expect.poll(async () => await dialog.count() > 0 || await history.getByRole('listitem').count() === 0).toBe(true);
          if (await dialog.count()) {
            await dialog.getByRole('button', { name: /^取消$/ }).click(); await expect(history.getByRole('listitem')).toHaveCount(4);
            await (await unique(f.getByRole('button', { name: /清空(?:全部)?历史|清除(?:全部)?历史/ }), '清空历史')).click();
            await dialog.getByRole('button', { name: /确认|确定/ }).click();
          }
          await expect(history.getByRole('listitem')).toHaveCount(0);
          await exported.reload(); await waitRuntimeReady(f); await expect(history.getByRole('listitem')).toHaveCount(0);
          await exported.goto(`http://127.0.0.1:${address.port}`); await waitRuntimeReady(f);
          await expect(f.getByRole('region', { name: /计算历史|历史记录/ }).getByRole('listitem')).toHaveCount(4);
          expect((await snapshot())!.app_data).toEqual(before.app_data);
        } finally { server.close(); }
      } finally {
        await exported.screenshot({ path: info.outputPath('R05-export-last.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
        await writeFile(info.outputPath('R05-export-last-ui.txt'), await exported.frameLocator('iframe').locator('body').ariaSnapshot().catch(() => 'Export unavailable'));
        await writeFile(info.outputPath('R05-export-local-data.json'), JSON.stringify(await exported.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('miniatoms')))).catch(() => ({})), null, 2));
        await writeFile(info.outputPath('R05-export-bridge-results.json'), JSON.stringify(await exported.frameLocator('iframe').locator('body').evaluate(() => (window as unknown as { __testBridgeResults: unknown }).__testBridgeResults).catch(() => []), null, 2));
        await standalone.close();
      }
      const anonymous = await chromium.launch();
      try {
        const other = await anonymous.newContext(), stranger = await other.newPage();
        const denied = stranger.waitForResponse(response => response.url() === `${base}/api/projects/${project}` && response.request().method() === 'GET');
        await stranger.goto(`${base}/projects/${project}`); expect((await denied).status()).toBe(404);
        await writeFile(info.outputPath('R05-anonymous-denied.json'), JSON.stringify({ url: `${base}/api/projects/${project}`, httpStatus: 404, storageStateCopied: false }));
      } finally { await anonymous.close(); }
    });
    expect(errors).toEqual([]);
  } finally {
    await writeFile(info.outputPath('result.json'), JSON.stringify({ health, browser: context.browser()?.version(), inputs, project, exportKeyDelayMs: 100, outcomes, errors, evidence: await snapshot() }, null, 2));
    await context.close();
  }
});
