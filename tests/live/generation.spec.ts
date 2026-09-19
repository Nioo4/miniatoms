import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { getLiveEvidenceConfig } from './evidence-config.mjs';
import { app, addJob, choose, create, dark, erase, field, labelPattern, metric, modify, openForm, persisted as footerPersisted, ready, row, save, stageFilter, unique, verifyDateSort, type Surface } from './helpers';

const prompts = {
  board: '帮我做一个中文求职投递看板。记录公司、岗位、投递日期、当前阶段和备注。阶段包括待投递、已投递、面试中、已结束。支持新增、编辑、删除、按阶段筛选，以及各阶段数量统计。使用简洁的蓝白配色，适配手机。记录要在刷新后保留。首次打开从空数据开始，不预置示例记录。',
  expense: '做一个中文个人记账本，支持录入日期、收入或支出、分类、金额和备注，能删除记录，按月份筛选，显示收入、支出和结余，刷新后保留。首次打开从空数据开始，不预置示例记录。',
  habit: '做一个中文习惯打卡应用，可以新增习惯，勾选或取消今天的完成状态，显示今天完成了几个，刷新后保留，不需要账号。首次打开从空数据开始，不预置示例习惯。',
};

const scope = process.env.LIVE_SCOPE ?? 'full';
if (!['full', 'independent'].includes(scope)) throw new Error('LIVE_SCOPE must be full or independent');
const selectedCases = Array.from({ length: scope === 'full' ? 10 : 3 }, (_, i) => `LIVE-${String(i + (scope === 'full' ? 1 : 8)).padStart(2, '0')}`);
test(`Real DeepSeek acceptance: ${scope} (LIVE-11 separately blocked)`, async ({ browser }, info) => {
  test.setTimeout(35 * 60_000);
  if (process.env.AI_TEST_MODE !== 'off') throw new Error('BLOCKED: real acceptance requires AI_TEST_MODE=off');
  const config = getLiveEvidenceConfig();
  const db = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const contextOptions = { baseURL: process.env.LIVE_BASE_URL, viewport: { width: 1440, height: 1000 } };
  const a = await browser.newContext(contextOptions), b = await browser.newContext(contextOptions);
  for (const context of [a, b]) { context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(30_000); }
  let page = await a.newPage(); const visitor = await b.newPage();
  let board = '', expense = '', habit = '';
  const results: Record<string, { status: string; reason?: string; projectUrl?: string; startedAt?: string; durationMs?: number; inputs?: unknown }> = Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`LIVE-${String(i + 1).padStart(2, '0')}`, { status: i === 10 ? 'BLOCKED' : 'NOT_RUN', ...(i === 10 ? { reason: '本套件工作台运行于本地；公开生产部署尚未验收。' } : {}) }]),
  );
  const inputs: Record<string, unknown> = {
    'LIVE-01': prompts.board,
    'LIVE-02': { records: [['星河科技', '全栈工程师', '2026-09-20', '已投递', '官网提交'], ['云杉软件', 'AI 应用工程师', '2026-09-19', '面试中', '准备技术面']], edit: '星河科技备注改为等待反馈', remove: '临时验证公司', filter: '面试中', persistence: '刷新及同context关闭页面重开' },
    'LIVE-03': '增加按公司名称搜索，将界面改为深色风格，保留现有功能和已经录入的数据。',
    'LIVE-04': '增加按投递日期升序或降序排列的切换按钮，保留已有的搜索、筛选、统计、深色风格和记录。',
    'LIVE-05': { history: 'v1', temporaryRecord: '历史临时公司', restore: 'v1 → v4' },
    'LIVE-06': '只将页面标题改为“我的投递进度”，其余内容保持不变。',
    'LIVE-07': { version: 5, fileRecord: '文件模式验证公司', httpRecord: '独立导出公司' },
    'LIVE-08': { prompt: prompts.expense, entries: [['2026-09-20', '收入', '工资', 1000, '虚构工资'], ['2026-09-20', '支出', '餐饮', 200, '虚构餐费']], filter: ['2026-08', '2026-09'], delete: ['跨月临时支出', '虚构餐费'], temporaryEntry: ['2026-08-15', '支出', 1, '跨月临时支出'] },
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
  const savedRevisions = new Map<string, number>();
  async function persisted(target: Page) {
    const id = target.url().split('/').at(-1)!;
    const previous = savedRevisions.get(id) ?? 0;
    await expect.poll(async () => (await snapshot(id)).data.revision, { timeout: 15_000, message: '本次业务写入必须推进数据库 revision' }).toBeGreaterThan(previous);
    await footerPersisted(target);
    savedRevisions.set(id, (await snapshot(id)).data.revision);
  }
  async function report() {
    await writeFile(info.outputPath('live-results.json'), JSON.stringify({ mode: 'live', scope, selectedCases, commit: process.env.APP_COMMIT_SHA ?? 'unknown', baseURL: process.env.LIVE_BASE_URL, database: config.url, browser: browser.version(), results }, null, 2));
  }
  async function step(id: string, target: Page, action: () => Promise<void>, dependencies: string[] = []) {
    if (!selectedCases.includes(id)) { results[id].reason = '不在本次独立用例执行范围内；不继承其他运行的结果'; return; }
    if (dependencies.some(dependency => results[dependency].status !== 'PASS')) { results[id].reason = `前置步骤未通过：${dependencies.join(', ')}`; await report(); return; }
    const started = Date.now();
    try { await test.step(id, action); if (target.isClosed()) target = page; results[id] = { status: 'PASS', projectUrl: target.url() }; }
    catch (error) { results[id] = { status: 'FAIL', reason: error instanceof Error ? error.message : String(error), projectUrl: target.url() }; }
    finally {
      if (target.isClosed()) target = page;
      results[id].startedAt = new Date(started).toISOString(); results[id].durationMs = Date.now() - started;
      results[id].inputs = inputs[id];
      await target.screenshot({ path: info.outputPath(`${id}.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
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
    const totalLabels = frame.getByRole('region', { name: /统计/ }).getByText(/^(全部|总计|总数|总记录)$/).filter({ visible: true });
    if (await totalLabels.count()) {
      const totalLabel = await unique(totalLabels, '总记录数统计');
      await metric(frame, (await totalLabel.innerText()).trim(), 2);
    }
    for (const [label, value] of [['待投递', 0], ['已投递', 1], ['面试中', 1], ['已结束', 0]] as const) await metric(frame, label, value);
  }
  async function filtering(frame: Surface) {
    await stageFilter(frame, '面试中'); await expect(frame.getByText('云杉软件', { exact: true })).toBeVisible();
    await expect(frame.getByText('星河科技', { exact: true })).toBeHidden();
    await stageFilter(frame, '全部');
    await records(frame);
  }
  try {
    await report();
    await step('LIVE-01', page, async () => {
      board = await create(page, prompts.board);
      const state = await snapshot(board);
      savedRevisions.set(board, state.data.revision);
      expect(state.runs[0].model_calls).toBeGreaterThan(0);
      expect(state.runs[0].call_records.some((call: { providerResponseId?: string; totalTokens?: number }) => call.providerResponseId && (call.totalTokens ?? 0) > 0)).toBe(true);
      expect(state.versions.filter(v => v.status === 'ready')).toHaveLength(1);
      await openForm(app(page), /^公司(名称)?[：:*\s]*$/);
      await expect(app(page).getByRole('textbox', { name: /^公司(名称)?[：:*\s]*$/ })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '应用成果', exact: true }).click();
      await expect(page.locator('iframe[title="应用预览"]')).toBeVisible();
      expect(await app(page).locator('body').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath('LIVE-01-mobile.png'), fullPage: true, animations: 'disabled' });
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
      inputs['LIVE-04'] = { prompt: inputs['LIVE-04'], observedSortControls: await verifyDateSort(app(page), '星河科技', '云杉软件') };
      await records(app(page)); await boardStats(app(page));
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
      standalone.setDefaultTimeout(15_000); standalone.setDefaultNavigationTimeout(30_000);
      exported.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      try {
        await exported.goto(pathToFileURL(path).href); await addJob(exported.frameLocator('iframe'), '文件模式验证公司');
        await exported.goto(`http://127.0.0.1:${address.port}/`); await addJob(exported.frameLocator('iframe'), '独立导出公司');
        await expect.poll(() => exported.evaluate(() => Object.values(localStorage).join(''))).toContain('独立导出公司');
        await exported.reload(); await expect(exported.frameLocator('iframe').getByText('独立导出公司', { exact: true })).toBeVisible();
        await expect(exported.frameLocator('iframe').getByText('文件模式验证公司', { exact: true })).toHaveCount(0);
        expect(requests.every(url => url.startsWith(`http://127.0.0.1:${address.port}/`))).toBe(true);
        await exported.screenshot({ path: info.outputPath('LIVE-07-standalone.png'), fullPage: true, animations: 'disabled' });
        await writeFile(info.outputPath('LIVE-07-network.json'), JSON.stringify(requests));
      } finally { await standalone.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(privateDirectory, { recursive: true, force: true }); }
    }, ['LIVE-06']);
    await step('LIVE-08', visitor, async () => {
      expense = await create(visitor, prompts.expense);
      savedRevisions.set(expense, (await snapshot(expense)).data.revision);
      async function addExpense(date: string, kind: string, amount: string, category: string, note: string) {
        await openForm(app(visitor), /^金额(?:[（(]元[）)])?[：:*\s]*$/); await field(app(visitor), /^(记账)?日期[：:*\s]*$/, date);
        await choose(app(visitor), /类型|收支/, kind);
        const categoryField = await unique(app(visitor).getByLabel(labelPattern(/^分类[：:*\s]*$/)), '分类');
        if (await categoryField.evaluate(el => el.tagName) === 'SELECT') await categoryField.selectOption({ label: category }); else await categoryField.fill(category);
        await field(app(visitor), /^金额(?:[（(]元[）)])?[：:*\s]*$/, amount); await field(app(visitor), /^备注[：:*\s]*$/, note); await save(app(visitor)); await persisted(visitor);
        await expect(await row(app(visitor), note)).toBeVisible();
      }
      await addExpense('2026-09-20', '收入', '1000', '工资', '虚构工资');
      await addExpense('2026-09-20', '支出', '200', '餐饮', '虚构餐费');
      await metric(app(visitor), '收入', 1000); await metric(app(visitor), '支出', 200); await metric(app(visitor), '结余', 800);
      const incomeRow = await row(app(visitor), '虚构工资'), expenseRow = await row(app(visitor), '虚构餐费');
      await addExpense('2026-08-15', '支出', '1', '餐饮', '跨月临时支出');
      const month = await unique(app(visitor).getByLabel(/月份|按月/), '月份筛选');
      if (await month.evaluate(el => el.tagName) === 'SELECT') await month.selectOption('2026-08'); else await month.fill('2026-08');
      await expect(incomeRow).toBeHidden(); await expect(expenseRow).toBeHidden();
      await expect(app(visitor).getByText(/跨月临时支出/)).toBeVisible();
      await erase(visitor, app(visitor), '跨月临时支出'); await persisted(visitor);
      if (await month.evaluate(el => el.tagName) === 'SELECT') await month.selectOption('2026-09'); else await month.fill('2026-09');
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '结余', 800);
      await erase(visitor, app(visitor), '虚构餐费'); await persisted(visitor); await metric(app(visitor), '收入', 1000); await metric(app(visitor), '支出', 0); await metric(app(visitor), '结余', 1000);
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '结余', 1000);
    });
    await step('LIVE-09', visitor, async () => {
      habit = await create(visitor, prompts.habit);
      savedRevisions.set(habit, (await snapshot(habit)).data.revision);
      for (const name of ['阅读', '运动']) { await openForm(app(visitor), /^(习惯名称|新习惯|新增习惯|习惯)[：:*\s]*$/); await field(app(visitor), /^(习惯名称|新习惯|新增习惯|习惯)[：:*\s]*$/, name); await save(app(visitor)); await persisted(visitor); }
      async function toggle() {
        const item = await row(app(visitor), '阅读'); const checkbox = item.getByRole('checkbox');
        if (await checkbox.count() === 1) await checkbox.click(); else await (await unique(item.getByRole('button', { name: /打卡|完成|撤销|取消/ }), '阅读打卡')).click();
        await persisted(visitor);
      }
      await toggle(); await metric(app(visitor), '今日完成', 1, 2);
      await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '今日完成', 1, 2);
      await expect(app(visitor).getByText('运动', { exact: true })).toBeVisible();
      await toggle(); await metric(app(visitor), '今日完成', 0, 2); await visitor.reload(); await ready(visitor, 1); await metric(app(visitor), '今日完成', 0, 2);
    });
    await step('LIVE-10', visitor, async () => {
      if (scope === 'independent') {
        // Fresh model-generated owner-A project, not a copied fixture or a
        // project borrowed from the previously accepted main workflow.
        board = await create(page, prompts.board);
        savedRevisions.set(board, (await snapshot(board)).data.revision);
        await addJob(app(page), '星河科技', '2026-09-20', '已投递', '等待反馈'); await persisted(page);
        await addJob(app(page), '云杉软件', '2026-09-19', '面试中', '准备技术面'); await persisted(page);
        inputs['LIVE-10'] = { boundary: inputs['LIVE-10'], ownerASetupPrompt: prompts.board, ownerASetupRecords: [
          ['星河科技', '全栈工程师', '2026-09-20', '已投递', '等待反馈'],
          ['云杉软件', 'AI 应用工程师', '2026-09-19', '面试中', '准备技术面'],
        ] };
      }
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
      const access = {
        ownerA: await statuses(page, paths(board, aState)),
        ownerB: await statuses(visitor, [...paths(expense, expenseState), ...paths(habit, habitState)]),
        visitorBToA: await statuses(visitor, paths(board, aState)),
        visitorAToB: await statuses(page, [...paths(expense, expenseState), ...paths(habit, habitState)]),
      };
      await writeFile(info.outputPath('LIVE-10-access.json'), JSON.stringify({ mode: 'live', projects: { board, expense, habit }, resourceOrder: ['project', 'data', 'version', 'run'], access }, null, 2));
      expect(access.ownerA).toEqual([200, 200, 200, 200]);
      expect(access.ownerB).toEqual(Array(8).fill(200));
      expect(access.visitorBToA).toEqual([404, 404, 404, 404]);
      expect(access.visitorAToB).toEqual(Array(8).fill(404));
      expect(JSON.stringify(expenseState.data.state)).not.toMatch(/阅读|运动|星河科技|云杉软件/);
      expect(JSON.stringify(habitState.data.state)).not.toMatch(/虚构工资|虚构餐费|星河科技|云杉软件/);
      await visitor.goto(`/projects/${board}`); await expect(visitor.getByRole('alert').filter({ hasText: '未找到此资源。' })).toBeVisible({ timeout: 30_000 });
      await visitor.goto(`/projects/${expense}`); await ready(visitor, 1); await metric(app(visitor), '结余', 1000);
      await page.goto(`/projects/${board}`); await ready(page, scope === 'independent' ? 1 : 5); await records(app(page));
      expect((await snapshot(board)).data).toEqual(aState.data);
      expect((await snapshot(expense)).data).toEqual(expenseState.data);
      expect((await snapshot(habit)).data).toEqual(habitState.data);
    }, scope === 'independent' ? ['LIVE-08', 'LIVE-09'] : ['LIVE-06', 'LIVE-08', 'LIVE-09']);
  } finally {
    await report(); await a.close(); await b.close();
  }
  expect(Object.entries(results).filter(([id, result]) => selectedCases.includes(id) && result.status !== 'PASS'), '本次选定真实用例必须全部 PASS；未执行用例不算通过，详细范围见 live-results.json').toEqual([]);
});
