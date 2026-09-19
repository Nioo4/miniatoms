import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { localConfig } from '../integration/local-config.mjs';
import { app, addJob, button, choose, create, dark, erase, field, metric, modify, openForm, persisted, ready, row, save, stageFilter, unique, type Surface } from './helpers';

const prompts = {
  board: '帮我做一个中文求职投递看板。记录公司、岗位、投递日期、当前阶段和备注。阶段包括待投递、已投递、面试中、已结束。支持新增、编辑、删除、按阶段筛选，以及各阶段数量统计。使用简洁的蓝白配色，适配手机。记录要在刷新后保留。',
  expense: '做一个中文个人记账本，支持录入日期、收入或支出、分类、金额和备注，能删除记录，按月份筛选，显示收入、支出和结余，刷新后保留。',
  habit: '做一个中文习惯打卡应用，可以新增习惯，勾选或取消今天的完成状态，显示今天完成了几个，刷新后保留，不需要账号。',
};

test('LIVE-01..10 real DeepSeek business acceptance (LIVE-11 separately blocked)', async ({ browser }, info) => {
  test.setTimeout(35 * 60_000);
  if (process.env.AI_TEST_MODE !== 'off') throw new Error('BLOCKED: real acceptance requires AI_TEST_MODE=off');
  const config = localConfig();
  const db = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const contextOptions = { baseURL: process.env.LIVE_BASE_URL, viewport: { width: 1440, height: 1000 } };
  const a = await browser.newContext(contextOptions), b = await browser.newContext(contextOptions);
  let page = await a.newPage(); const visitor = await b.newPage();
  let board = '', expense = '', habit = '';
  const results: Record<string, { status: string; reason?: string; projectUrl?: string; startedAt?: string; durationMs?: number; inputs?: unknown }> = Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`LIVE-${String(i + 1).padStart(2, '0')}`, { status: i === 10 ? 'BLOCKED' : 'NOT_RUN', ...(i === 10 ? { reason: '本套件仅隔离本地真实供应商验收；公开生产部署未验收。' } : {}) }]),
  );
  const inputs: Record<string, unknown> = {
    'LIVE-01': prompts.board,
    'LIVE-02': { records: [['星河科技', '全栈工程师', '2026-09-20', '已投递', '官网提交'], ['云杉软件', 'AI 应用工程师', '2026-09-19', '面试中', '准备技术面']], edit: '星河科技备注改为等待反馈', remove: '临时验证公司', filter: '面试中', persistence: '刷新及同context关闭页面重开' },
    'LIVE-03': '增加按公司名称搜索，将界面改为深色风格，保留现有功能和已经录入的数据。',
    'LIVE-04': '增加按投递日期升序或降序排列的切换按钮，保留已有的搜索、筛选、统计、深色风格和记录。',
    'LIVE-05': { history: 'v1', temporaryRecord: '历史临时公司', restore: 'v1 → v4' },
    'LIVE-06': '只将页面标题改为“我的投递进度”，其余内容保持不变。',
    'LIVE-07': { version: 5, fileRecord: '文件模式验证公司', httpRecord: '独立导出公司' },
    'LIVE-08': { prompt: prompts.expense, entries: [['2026-09-20', '收入', '工资', 1000, '虚构工资'], ['2026-09-20', '支出', '餐饮', 200, '虚构餐费']], filter: ['2026-08', '2026-09'], delete: '虚构餐费' },
    'LIVE-09': { prompt: prompts.habit, habits: ['阅读', '运动'], toggle: ['阅读完成', '刷新', '阅读撤销', '刷新'] },
    'LIVE-10': '两个独立匿名context；owner同资源200、other404；项目数据互不包含；恢复原项目仍可读',
  };
  async function snapshot(id: string) {
    const [project, runs, versions, data] = await Promise.all([
      db.from('projects').select('id,current_version_id,context_epoch').eq('id', id).single(),
      db.from('runs').select('id,kind,status,model_calls,draft_attempt,error_code,base_version_id,result_version_id,call_records').eq('project_id', id).order('created_at'),
      db.from('versions').select('id,number,status,source_hash,parent_version_id,restored_from_version_id,artifact').eq('project_id', id).order('number'),
      db.from('app_data').select('state,revision').eq('project_id', id).single(),
    ]);
    for (const result of [project, runs, versions, data]) if (result.error) throw new Error(`Evidence read failed: ${result.error.code}`);
    return { project: project.data!, runs: runs.data!, versions: versions.data!, data: data.data! };
  }
  async function report() {
    await writeFile(info.outputPath('live-results.json'), JSON.stringify({ mode: 'live', commit: process.env.APP_COMMIT_SHA ?? 'unknown', baseURL: process.env.LIVE_BASE_URL, database: config.url, browser: browser.version(), results }, null, 2));
  }
  async function step(id: string, target: Page, action: () => Promise<void>, dependencies: string[] = []) {
    if (dependencies.some(dependency => results[dependency].status !== 'PASS')) { results[id].reason = `前置步骤未通过：${dependencies.join(', ')}`; await report(); return; }
    const started = Date.now();
    try { await test.step(id, action); if (target.isClosed()) target = page; results[id] = { status: 'PASS', projectUrl: target.url() }; }
    catch (error) { results[id] = { status: 'FAIL', reason: error instanceof Error ? error.message : String(error), projectUrl: target.url() }; }
    finally {
      if (target.isClosed()) target = page;
      results[id].startedAt = new Date(started).toISOString(); results[id].durationMs = Date.now() - started;
      results[id].inputs = inputs[id];
      await target.screenshot({ path: info.outputPath(`${id}.png`), fullPage: true }).catch(() => {});
      await writeFile(info.outputPath(`${id}-ui.txt`), await target.locator('body').ariaSnapshot().catch(() => 'Page unavailable'));
      const projectId = target.url().match(/\/projects\/([a-f0-9-]{36})/)?.[1];
      if (projectId) {
        try { await writeFile(info.outputPath(`${id}-source-and-evidence.json`), JSON.stringify(await snapshot(projectId), null, 2)); }
        catch (error) { results[id] = { status: 'FAIL', reason: `证据采集失败：${String(error)}` }; }
        await writeFile(info.outputPath(`${id}-generated-ui.txt`), await app(target).locator('body').ariaSnapshot().catch(() => 'Active preview unavailable'));
      }
      await report();
    }
  }
  async function records(frame: Surface) {
    await expect(frame.getByText('星河科技', { exact: true })).toBeVisible();
    await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
    await expect(frame.getByText('等待反馈', { exact: true })).toBeVisible();
    await expect(frame.getByText('准备技术面', { exact: true })).toBeVisible();
  }
  async function boardStats(frame: Surface) {
    for (const [label, value] of [['待投递', 0], ['已投递', 1], ['面试中', 1], ['已结束', 0]] as const) await metric(frame, label, value);
  }
  async function filtering(frame: Surface) {
    await stageFilter(frame, '面试中'); await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
    await expect(frame.getByText('星河科技', { exact: true })).toBeHidden();
    const all = frame.getByRole('combobox', { name: /筛选|阶段过滤|查看阶段/ }).filter({ visible: true });
    if (await all.count() === 1) await all.selectOption({ label: await all.locator('option').filter({ hasText: /全部|所有/ }).innerText() });
    else await button(frame, /^(全部|全部阶段|所有阶段)(\s*[（(]?\d+[）)]?)?$/);
    await records(frame);
  }
  try {
    await report();
    await step('LIVE-01', page, async () => {
      board = await create(page, prompts.board);
      const state = await snapshot(board);
      expect(state.runs[0].model_calls).toBeGreaterThan(0);
      expect(state.runs[0].call_records.some((call: { providerResponseId?: string; totalTokens?: number }) => call.providerResponseId && (call.totalTokens ?? 0) > 0)).toBe(true);
      expect(state.versions.filter(v => v.status === 'ready')).toHaveLength(1);
      await openForm(app(page), /^公司(名称)?[：:*\s]*$/);
      await expect(app(page).getByLabel(/^公司(名称)?[：:*\s]*$/)).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '应用成果', exact: true }).click();
      await expect(page.locator('iframe[title="应用预览"]')).toBeVisible();
      expect(await app(page).locator('body').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath('LIVE-01-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await step('LIVE-02', page, async () => {
      await addJob(app(page), '星河科技'); await persisted(page);
      await addJob(app(page), '云杉软件', '2026-09-19', '面试中', '准备技术面'); await persisted(page);
      await (await unique((await row(app(page), '星河科技')).getByRole('button', { name: /编辑|修改/ }), '编辑星河科技')).click();
      await field(app(page), /^备注[：:*\s]*$/, '等待反馈'); await save(app(page)); await persisted(page);
      await addJob(app(page), '临时验证公司'); await persisted(page); await erase(page, app(page), '临时验证公司'); await persisted(page);
      await filtering(app(page)); await boardStats(app(page));
      await page.reload(); await ready(page, 1); await records(app(page)); await boardStats(app(page));
      const url = page.url(); await page.close(); page = await a.newPage(); await page.goto(url); await ready(page, 1); await records(app(page));
    }, ['LIVE-01']);
    await step('LIVE-03', page, async () => {
      await modify(page, '增加按公司名称搜索，将界面改为深色风格，保留现有功能和已经录入的数据。', 2);
      await records(app(page)); await dark(app(page), true); await boardStats(app(page)); await filtering(app(page));
      await field(app(page), /搜索/, '星河'); await expect(app(page).getByText('星河科技', { exact: true })).toBeVisible();
      await expect(app(page).getByText('云杉软件', { exact: true })).toBeHidden(); await field(app(page), /搜索/, '');
    }, ['LIVE-02']);
    await step('LIVE-04', page, async () => {
      await modify(page, '增加按投递日期升序或降序排列的切换按钮，保留已有的搜索、筛选、统计、深色风格和记录。', 3);
      await records(app(page)); await dark(app(page), true); await boardStats(app(page)); await filtering(app(page));
      for (const direction of ['升序', '降序']) {
        await button(app(page), new RegExp(direction));
        const first = await app(page).getByText('星河科技', { exact: true }).boundingBox();
        const second = await app(page).getByText('云杉软件', { exact: true }).boundingBox();
        expect(first && second).toBeTruthy(); expect(first!.y > second!.y).toBe(direction === '升序');
      }
      await field(app(page), /搜索/, '星河'); await expect(app(page).getByText('云杉软件', { exact: true })).toBeHidden(); await field(app(page), /搜索/, '');
    }, ['LIVE-03']);
    await step('LIVE-05', page, async () => {
      const before = await snapshot(board);
      await page.getByRole('button', { name: '版本', exact: true }).click();
      await page.locator('.version-card').filter({ has: page.locator('.version-number', { hasText: /^v1$/ }) }).click();
      const history = page.frameLocator('iframe[title="历史版本预览（操作不保存）"]');
      await addJob(history, '历史临时公司'); expect((await snapshot(board)).data).toEqual(before.data);
      page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '恢复此版本', exact: true }).click(); await ready(page, 4);
      await records(app(page)); await expect(app(page).getByText('历史临时公司', { exact: true })).toHaveCount(0);
      const after = await snapshot(board); const versions = after.versions.filter(v => v.status === 'ready');
      expect(versions).toHaveLength(4); expect(versions[3].restored_from_version_id).toBe(versions[0].id); expect(versions[3].source_hash).toBe(versions[0].source_hash);
      expect(after.runs.at(-1)?.model_calls).toBe(0); expect(after.data).toEqual(before.data);
    }, ['LIVE-04']);
    await step('LIVE-06', page, async () => {
      await modify(page, '只将页面标题改为“我的投递进度”，其余内容保持不变。', 5);
      await expect(app(page).getByRole('heading', { name: '我的投递进度', exact: true })).toBeVisible(); await records(app(page)); await dark(app(page), false);
      await expect(app(page).getByLabel(/搜索/)).toHaveCount(0); await expect(app(page).getByRole('button', { name: /升序|降序/ })).toHaveCount(0);
      const state = await snapshot(board); const versions = state.versions.filter(v => v.status === 'ready');
      expect(versions[4].parent_version_id).toBe(versions[3].id); expect(state.runs.at(-1)?.base_version_id).toBe(versions[3].id);
    }, ['LIVE-05']);
    await step('LIVE-07', page, async () => {
      const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: /导出 HTML/ }).click();
      const download = await downloadPromise; const privateDirectory = await mkdtemp(join(tmpdir(), 'miniatoms-live-export-'));
      const path = join(privateDirectory, 'export.html'); await download.saveAs(path); const html = await readFile(path, 'utf8');
      const containsSession = await page.evaluate(source => Object.keys(localStorage).filter(key => /^sb-.*-auth-token$/.test(key)).some(key => {
        const session = JSON.parse(localStorage.getItem(key)!);
        return [session.access_token, session.refresh_token].some(value => typeof value === 'string' && source.includes(value));
      }), html);
      const unsafe = containsSession || html.includes(config.serviceKey) || /星河科技|云杉软件|等待反馈|官网提交|service_role|sk-[a-zA-Z0-9]{20}|sb_secret_|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(html);
      if (unsafe) { await rm(privateDirectory, { recursive: true, force: true }); throw new Error('导出隐私检查失败；未经审查的 HTML 不进入 artifact。'); }
      await writeFile(info.outputPath('export.html'), html);
      const server = createServer((_, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Export HTTP server unavailable');
      const standalone = await browser.newContext(); const exported = await standalone.newPage(); const requests: string[] = [];
      exported.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      try {
        await exported.goto(pathToFileURL(path).href); await addJob(exported.frameLocator('iframe'), '文件模式验证公司');
        await exported.goto(`http://127.0.0.1:${address.port}/`); await addJob(exported.frameLocator('iframe'), '独立导出公司');
        await expect.poll(() => exported.evaluate(() => Object.values(localStorage).join(''))).toContain('独立导出公司');
        await exported.reload(); await expect(exported.frameLocator('iframe').getByText('独立导出公司', { exact: true })).toBeVisible();
        await expect(exported.frameLocator('iframe').getByText('文件模式验证公司', { exact: true })).toHaveCount(0);
        expect(requests.every(url => url.startsWith(`http://127.0.0.1:${address.port}/`))).toBe(true);
        await exported.screenshot({ path: info.outputPath('LIVE-07-standalone.png'), fullPage: true });
        await writeFile(info.outputPath('LIVE-07-network.json'), JSON.stringify(requests));
      } finally { await standalone.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(privateDirectory, { recursive: true, force: true }); }
    }, ['LIVE-06']);
    await step('LIVE-08', visitor, async () => {
      expense = await create(visitor, prompts.expense);
      for (const [kind, amount, category, note] of [['收入', '1000', '工资', '虚构工资'], ['支出', '200', '餐饮', '虚构餐费']]) {
        await openForm(app(visitor), /^金额[：:*\s]*$/); await field(app(visitor), /^(记账)?日期[：:*\s]*$/, '2026-09-20');
        await choose(app(visitor), /类型|收支/, kind);
        const categoryField = await unique(app(visitor).getByLabel(/分类/), '分类');
        if (await categoryField.evaluate(el => el.tagName) === 'SELECT') await categoryField.selectOption({ label: category }); else await categoryField.fill(category);
        await field(app(visitor), /^金额[：:*\s]*$/, amount); await field(app(visitor), /^备注[：:*\s]*$/, note); await save(app(visitor)); await persisted(visitor);
      }
      await metric(app(visitor), '收入', 1000); await metric(app(visitor), '支出', 200); await metric(app(visitor), '结余', 800);
      const month = await unique(app(visitor).getByLabel(/月份|按月/), '月份筛选');
      if (await month.evaluate(el => el.tagName) === 'SELECT') await month.selectOption('2026-08'); else await month.fill('2026-08');
      await expect(app(visitor).getByText('虚构工资', { exact: true })).toBeHidden(); await expect(app(visitor).getByText('虚构餐费', { exact: true })).toBeHidden();
      if (await month.evaluate(el => el.tagName) === 'SELECT') await month.selectOption('2026-09'); else await month.fill('2026-09');
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '结余', 800);
      await erase(visitor, app(visitor), '虚构餐费'); await persisted(visitor); await metric(app(visitor), '收入', 1000); await metric(app(visitor), '支出', 0); await metric(app(visitor), '结余', 1000);
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '结余', 1000);
    });
    await step('LIVE-09', visitor, async () => {
      habit = await create(visitor, prompts.habit);
      for (const name of ['阅读', '运动']) { await openForm(app(visitor), /习惯名称|新习惯|^习惯$/); await field(app(visitor), /习惯名称|新习惯|^习惯$/, name); await save(app(visitor)); await persisted(visitor); }
      async function toggle() {
        const item = await row(app(visitor), '阅读'); const checkbox = item.getByRole('checkbox');
        if (await checkbox.count() === 1) await checkbox.click(); else await (await unique(item.getByRole('button', { name: /打卡|完成|撤销|取消/ }), '阅读打卡')).click();
        await persisted(visitor);
      }
      await toggle(); await metric(app(visitor), '今日完成', 1);
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '今日完成', 1);
      await expect(app(visitor).getByText('运动', { exact: true })).toBeVisible();
      await toggle(); await metric(app(visitor), '今日完成', 0); await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '今日完成', 0);
    });
    await step('LIVE-10', visitor, async () => {
      // Read-only authenticated requests use each existing browser's own session in-page;
      // neither token nor storage state crosses into the test process or artifacts.
      async function statuses(target: Page, paths: string[]) {
        return target.evaluate(async urls => {
          const key = Object.keys(localStorage).find(name => /^sb-.*-auth-token$/.test(name));
          if (!key) throw new Error('Anonymous session unavailable');
          const token = JSON.parse(localStorage.getItem(key)!).access_token;
          return Promise.all(urls.map(async url => (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status));
        }, paths);
      }
      const aState = await snapshot(board), expenseState = await snapshot(expense), habitState = await snapshot(habit);
      const paths = (id: string, state: typeof aState) => [`/api/projects/${id}`, `/api/projects/${id}/data`, `/api/projects/${id}/versions/${state.versions.find(v => v.status === 'ready')!.id}`, `/api/runs/${state.runs[0].id}`];
      expect(await statuses(page, paths(board, aState))).toEqual([200, 200, 200, 200]);
      expect(await statuses(visitor, [...paths(expense, expenseState), ...paths(habit, habitState)])).toEqual(Array(8).fill(200));
      expect(await statuses(visitor, paths(board, aState))).toEqual([404, 404, 404, 404]);
      expect(await statuses(page, [...paths(expense, expenseState), ...paths(habit, habitState)])).toEqual(Array(8).fill(404));
      expect(JSON.stringify(expenseState.data.state)).not.toMatch(/阅读|运动|星河科技|云杉软件/);
      expect(JSON.stringify(habitState.data.state)).not.toMatch(/虚构工资|虚构餐费|星河科技|云杉软件/);
      await visitor.goto(`/projects/${board}`); await expect(visitor.getByText(/项目不存在|无权访问|找不到项目/)).toBeVisible({ timeout: 30_000 });
      await visitor.goto(`/projects/${expense}`); await ready(visitor, 1); await metric(app(visitor), '结余', 1000);
      await page.goto(`/projects/${board}`); await ready(page, 5); await records(app(page));
    }, ['LIVE-06', 'LIVE-08', 'LIVE-09']);
  } finally {
    await report(); await a.close(); await b.close();
  }
  expect(Object.entries(results).filter(([id, result]) => id !== 'LIVE-11' && result.status !== 'PASS'), '所有本地真实业务验收必须 PASS；详细状态见 live-results.json').toEqual([]);
});
