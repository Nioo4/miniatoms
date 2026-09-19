import { expect, type Dialog, type FrameLocator, type Locator, type Page, type Request } from '@playwright/test';
export type Surface = FrameLocator;
export const app = (page: Page) => page.frameLocator('iframe[title="应用预览"]');
export async function unique(locator: Locator, description: string) {
  const visible = locator.filter({ visible: true });
  await expect(visible, `无法唯一识别真实生成 UI：${description}`).toHaveCount(1);
  return visible;
}
export function labelPattern(name: RegExp) {
  // Regex label matching preserves whitespace in wrapping <label> text.
  return new RegExp(name.source.replace(/^\^/, '^\\s*').replace(/\$$/, '\\s*$'), name.flags);
}
export async function field(frame: Surface, name: RegExp, value: string) {
  await (await unique(frame.getByLabel(labelPattern(name)).and(frame.locator('input,textarea')), `字段 ${name}`)).fill(value);
}
export async function button(frame: Surface, name: RegExp) {
  await (await unique(frame.getByRole('button', { name }), `按钮 ${name}`)).click();
}
export async function choose(frame: Surface, name: RegExp, value: string) {
  // A page can have both an entry type and a type filter. Select only a
  // labelled control that actually offers the requested exact option.
  const combo = frame.getByRole('combobox', { name }).filter({ visible: true })
    .filter({ has: frame.getByRole('option', { name: value, exact: true, includeHidden: true }) });
  if (await combo.count()) return (await unique(combo, `选项 ${value} 所属控件`)).selectOption({ label: value });
  const radio = frame.getByRole('radio', { name: value, exact: true }).filter({ visible: true });
  if (await radio.count() === 1) {
    const wrappingLabel = radio.locator('xpath=ancestor::label[1]');
    const id = await radio.getAttribute('id');
    const associatedLabels = id ? wrappingLabel.or(frame.locator(`label[for=${JSON.stringify(id)}]`)) : wrappingLabel;
    const visibleLabels = associatedLabels.filter({ visible: true });
    if (await visibleLabels.count()) await (await unique(visibleLabels, `${value} 单选标签`)).click();
    else await radio.check();
    await expect(radio).toBeChecked();
    return;
  }
  await button(frame, new RegExp(`^${value}$`));
}
export async function waitRuntimeReady(frame: Surface) {
  // Platform-owned marker, shared by active/history/export. No generated DOM IDs.
  const root = frame.locator('body > #app');
  await expect(root).toBeAttached({ timeout: 20_000 });
  await expect(root).toHaveJSProperty('inert', false, { timeout: 20_000 });
}
export async function openForm(frame: Surface, label: RegExp) {
  await waitRuntimeReady(frame);
  const fields = frame.getByLabel(labelPattern(label)).and(frame.locator('input,textarea')).filter({ visible: true });
  const openers = frame.getByRole('button', { name: /^[ +＋]*(新增|添加|新建)(投递|记录|习惯|账目)?[ +＋]*$/ }).filter({ visible: true });
  // The platform iframe can be visible before its asynchronously mounted srcdoc.
  // Wait for either legitimate UI shape before deciding inline form vs dialog.
  await expect.poll(async () => (await fields.count()) + (await openers.count()), { message: `等待真实表单或新增入口：${label}` }).toBeGreaterThan(0);
  if (!await fields.count()) await (await unique(openers, '新增入口')).click();
  await expect(await unique(fields, `表单字段 ${label}`)).toBeVisible();
}
export async function save(frame: Surface) { await button(frame, /^(保存|确认|提交|添加|新增)(记录|投递|习惯|账目|修改)?$/); }
export async function row(frame: Surface, text: string) {
  const semanticRows = frame.getByRole('listitem').or(frame.getByRole('row')).filter({ hasText: text });
  await expect.poll(async () => (await semanticRows.count()) + (await frame.getByText(text, { exact: true }).count()), { message: `等待记录 ${text}` }).toBeGreaterThan(0);
  if (await semanticRows.count() === 1) return semanticRows;
  const marker = await unique(frame.getByText(text, { exact: true }), text);
  // Find the smallest semantic row/card with its own edit/delete/check control; no generated IDs.
  const candidates = marker.locator('xpath=ancestor::*[self::tr or self::li or self::article or self::div or self::section][.//button or .//input[@type="checkbox"]][1]');
  return unique(candidates, `${text} 所属记录`);
}
export async function erase(page: Page, frame: Surface, text: string) {
  const accept = (dialog: Dialog) => { void dialog.accept(); };
  page.on('dialog', accept);
  try {
    const record = await row(frame, text);
    await (await unique(record.getByRole('button', { name: /删除|移除/ }), '删除记录')).click();
    const dialog = frame.getByRole('dialog').filter({ visible: true });
    const confirm = (await dialog.count() === 1 ? dialog : frame).getByRole('button', { name: await dialog.count() === 1 ? /^(删除|确认删除|确定删除|确认|确定)$/ : /^(确认删除|确定删除|确认|确定)$/ }).filter({ visible: true });
    if (await confirm.count() === 1) await confirm.click();
    await expect(record).toHaveCount(0);
  } finally { page.off('dialog', accept); }
}
export async function addJob(frame: Surface, company: string, date = '2026-09-20', stage = '已投递', note = '官网提交') {
  await openForm(frame, /^公司(名称)?[：:*\s]*$/);
  await field(frame, /^公司(名称)?[：:*\s]*$/, company);
  await field(frame, /^(应聘)?(岗位|职位)(名称)?[：:*\s]*$/, company === '云杉软件' ? 'AI 应用工程师' : '全栈工程师');
  await field(frame, /^(投递)?日期[：:*\s]*$/, date);
  await choose(frame, /^(当前)?阶段[：:*\s]*$|^状态[：:*\s]*$/, stage);
  await field(frame, /^备注[：:*\s]*$/, note); await save(frame);
  await expect(frame.getByText(company, { exact: true })).toBeVisible();
}
export async function stageFilter(frame: Surface, value: string) {
  const purpose = /筛选|阶段过滤|查看阶段/;
  const groups = frame.getByRole('group', { name: purpose }).filter({ visible: true });
  const regions = frame.getByRole('region', { name: purpose }).filter({ visible: true });
  let scope: Surface | Locator = frame;
  if (await groups.count()) scope = await unique(groups, '阶段筛选组');
  else if (await regions.count()) scope = await unique(regions, '阶段筛选区域');
  const name = new RegExp(`^(?:${value === '全部' ? '全部|全部阶段|所有阶段' : value})(\\s*[（(]?\\d+[）)]?)?$`);
  const select = (scope === frame ? frame.getByRole('combobox', { name: purpose }) : scope.getByRole('combobox')).filter({ visible: true });
  if (await select.count()) {
    const control = await unique(select, '阶段筛选下拉框');
    const option = control.getByRole('option', { name, includeHidden: true });
    await expect(option).toHaveCount(1);
    await control.selectOption({ label: (await option.innerText()).trim() });
    return;
  }
  await (await unique(scope.getByRole('button', { name }), `阶段筛选 ${value}`)).click();
}
export async function verifyDateSort(frame: Surface, newerCompany: string, olderCompany: string) {
  const controls = frame.getByRole('button', { name: /日期|排序|升序|降序/ }).filter({ visible: true });
  const names: string[] = [];
  async function newerAfterOlder() {
    const newer = await frame.getByText(newerCompany, { exact: true }).boundingBox();
    const older = await frame.getByText(olderCompany, { exact: true }).boundingBox();
    expect(newer && older, '排序前后两条业务记录必须可见').toBeTruthy();
    expect(newer!.x !== older!.x || newer!.y !== older!.y, '两条记录必须有可区分位置').toBe(true);
    return newer!.y === older!.y ? newer!.x > older!.x : newer!.y > older!.y;
  }
  if (await controls.count() === 1) {
    const initial = await newerAfterOlder();
    for (const expected of [!initial, initial]) {
      names.push(await controls.ariaSnapshot()); await controls.click();
      await expect.poll(newerAfterOlder, { message: '日期排序切换必须实际反转记录位置' }).toBe(expected);
    }
  } else {
    for (const direction of ['升序', '降序']) {
      const control = await unique(frame.getByRole('button', { name: new RegExp(direction) }).filter({ visible: true }), `${direction}排序`);
      names.push(await control.ariaSnapshot()); await control.click();
      await expect.poll(newerAfterOlder, { message: `${direction}必须产生正确日期顺序` }).toBe(direction === '升序');
    }
  }
  return names;
}
export async function metric(frame: Surface, label: string, value: number, total?: number) {
  const monetary = ['收入', '支出', '结余'].includes(label);
  const labelPattern = label === '今日完成' ? /^(?:今日|今天)(?:已)?完成(?:\s+\d+\s*(?:[/／]\s*\d+)?\s*(?:个习惯|个|项)?)?$/
    : label === '收入' ? /^\s*(收入(?:合计)?|总收入)\s*$/
    : label === '支出' ? /^\s*(支出(?:合计)?|总支出)\s*$/ : new RegExp(`^${label}$`);
  await expect.poll(async () => {
    const region = frame.getByRole('region', { name: /统计|汇总|完成情况/ });
    const inStatsRegion = await region.count() === 1;
    const scope = inStatsRegion ? region : frame;
    let labels = scope.getByText(labelPattern).filter({ visible: true });
    if (label === '今日完成') {
      // Prefer the complete value in a today-statistics region, even when its
      // separate title shares a container with a numeric “remaining” hint.
      const today = frame.getByRole('region', { name: /^(今日|今天).*(统计|完成)/ });
      if (await today.count() === 1) {
        const fractions = today.getByText(/^\s*\d+\s*[/／]\s*\d+(?:\s*(?:个|项)?已完成)?\s*$/).filter({ visible: true });
        if (await fractions.count()) labels = fractions;
      }
    }
    if (monetary && !await labels.count()) {
      const monthly = frame.getByRole('region', { name: '本月统计', exact: true });
      if (await monthly.count() === 1) labels = monthly.getByText(new RegExp(`^\\s*本月${label}\\s*$`)).filter({ visible: true });
    }
    const matched: string[] = [];
    for (const item of await labels.all()) {
      const text = await item.evaluate((el, allowStatButtons) => {
        const record = el.closest('li,tr,article');
        if (record && Array.from(record.querySelectorAll('button')).some(button => /删除|移除/.test(button.textContent ?? button.getAttribute('aria-label') ?? ''))) return null;
        for (let node: Element | null = el; node && node.tagName !== 'BODY'; node = node.parentElement) {
          if (node.matches('select,option,label') || (!allowStatButtons && node.matches('button')) || node.querySelector('input,select,textarea')) return null;
          const text = (node as HTMLElement).innerText?.trim() ?? '';
          if (/\d/.test(text) && text.length < 100) return text;
        }
        return null;
      }, inStatsRegion);
      if (text) matched.push(text);
    }
    if (matched.length !== 1) return { unique: false, candidates: matched.length };
    const text = matched[0].replaceAll(',', '').replaceAll('−', '-');
    if (monetary && /[¥￥]/.test(text)) {
      // Amounts have a currency marker; auxiliary “1 笔” counts do not.
      // Require exactly one complete currency token in this labelled stat card.
      const amounts = text.match(/(?:[-+]\s*)?[¥￥]\s*[-+]?\d+(?:\.\d+)?/g) ?? [];
      if (amounts.length !== 1 || (text.match(/[¥￥]/g) ?? []).length !== 1) return { unique: true, currencyAmounts: amounts.length };
      return { unique: true, numbers: [Number(amounts[0].replace(/[¥￥\s]/g, ''))], scalar: true };
    }
    const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (total !== undefined && /\d\s*[/／]\s*\d/.test(text)) return { unique: true, numbers: numbers?.[1] === total ? [numbers[0]] : numbers, scalar: true };
    if (label === '今日完成' && !/^\s*(?:(?:今日|今天)(?:已)?完成\s*[:：]?\s*\d+\s*(?:个习惯|个|项)?|\d+\s*(?:个|项)?\s*(?:今日|今天)(?:已)?完成)\s*$/.test(text)) {
      return { unique: true, invalidCompletionValue: text };
    }
    return { unique: true, numbers, scalar: true };
  }, { message: `统计 ${label} 必须唯一展示正确数值`, timeout: 15_000 }).toEqual(
    { unique: true, numbers: [value], scalar: true },
  );
}
export async function persisted(page: Page) { await expect(page.locator('.preview-footer')).toContainText('数据已保存'); }
export async function ready(page: Page, version: number, submitted?: Request) {
  const deadline = Date.now() + 245_000;
  if (submitted) {
    // Bind to the request emitted by this click, never the previous run card.
    const id: unknown = submitted.postDataJSON()?.requestId;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('新任务请求缺少有效 requestId');
    const authorization = await submitted.headerValue('authorization');
    if (!authorization) throw new Error('新任务请求缺少身份信息');
    let terminal = '', errorCode = '';
    await expect.poll(async () => {
      // GET is authoritative even if the generation SSE connection is lost.
      // Keep credentials and raw response/error bodies out of evidence output.
      const response = await page.request.get(new URL(`/api/runs/${id}`, submitted.url()).href, {
        headers: { authorization }, timeout: 10_000,
      }).catch(() => null);
      if (!response) return false;
      try {
        if (response.status() !== 200) return false;
        const { run } = await response.json();
        if (run?.id !== id || !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)) return false;
        terminal = run.status;
        errorCode = typeof run.error?.code === 'string' && /^[A-Z0-9_]+$/.test(run.error.code) ? run.error.code : '';
        return true;
      } finally { await response.dispose(); }
    }, { timeout: Math.max(1, deadline - Date.now()), intervals: [500, 1000], message: `等待本次任务 ${id} 终态` }).toBe(true);
    if (terminal !== 'succeeded') throw new Error(`本次任务 ${id} 终态 ${terminal}${errorCode ? ` (${errorCode})` : ''}`);
  }
  await expect(page.locator('.preview-toolbar')).toContainText(`v${version} · 基础检查通过`, { timeout: Math.max(1, deadline - Date.now()) });
  await expect(page.locator('iframe[title="应用预览"]')).toBeVisible();
  await waitRuntimeReady(app(page));
}
export async function create(page: Page, prompt: string) {
  await page.goto('/'); await page.getByLabel('描述应用需求').fill(prompt);
  await expect(page.getByRole('button', { name: /开始创造/ })).toBeEnabled({ timeout: 30_000 });
  const [submitted] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST' && /\/api\/projects\/[a-f0-9-]{36}\/runs$/.test(new URL(request.url()).pathname), { timeout: 30_000 }),
    page.getByRole('button', { name: /开始创造/ }).click(),
  ]);
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]{36}$/);
  const id = page.url().split('/').at(-1)!; await ready(page, 1, submitted); return id;
}
export async function modify(page: Page, prompt: string, version: number) {
  await page.getByLabel('应用需求或修改意见').fill(prompt);
  const projectId = page.url().split('/').at(-1)!;
  const [submitted] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/projects/${projectId}/runs`, { timeout: 30_000 }),
    page.getByRole('button', { name: '发送需求', exact: true }).click(),
  ]);
  await ready(page, version, submitted);
}
export async function dark(frame: Surface, expected: boolean) {
  const owner = frame.owner();
  const png = await owner.screenshot({ animations: 'disabled', scale: 'css' });
  const pixels = await owner.page().evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { width, height } = bitmap;
    const data = context.getImageData(0, 0, width, height).data;
    bitmap.close();
    let darkPixels = 0, lightPixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3] / 255;
      if (alpha < 1) for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(data[offset + channel] * alpha + 255 * (1 - alpha));
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness < 100) darkPixels++;
      if (brightness > 160) lightPixels++;
    }
    const samples: { x: number; y: number; medianBrightness: number }[] = [];
    for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = Math.floor(width * fx), y = Math.floor(height * fy), tile: number[] = [];
      // Median of an 11x11 rendered tile discounts individual text glyphs while
      // retaining actual gradients, images, compositing and the visible canvas.
      for (let py = Math.max(0, y - 5); py <= Math.min(height - 1, y + 5); py++) {
        for (let px = Math.max(0, x - 5); px <= Math.min(width - 1, x + 5); px++) {
          const offset = (py * width + px) * 4;
          tile.push((data[offset] + data[offset + 1] + data[offset + 2]) / 3);
        }
      }
      tile.sort((a, b) => a - b);
      samples.push({ x, y, medianBrightness: tile[Math.floor(tile.length / 2)] });
    }
    return { width, height, samples, darkCoverage: darkPixels / (width * height), lightCoverage: lightPixels / (width * height) };
  }, Array.from(png));
  const matching = pixels.samples.filter(sample => expected ? sample.medianBrightness < 100 : sample.medianBrightness > 160).length;
  const diagnostics = { expected: expected ? 'dark (<100)' : 'light (>160)', matching, total: pixels.samples.length, ...pixels };
  const message = `实际渲染像素诊断：${JSON.stringify(diagnostics)}`;
  // A regular grid can accidentally land entirely on dark cards on a white
  // canvas. Use full-image coverage for the verdict; tiles are diagnostics.
  expect(expected ? pixels.darkCoverage : pixels.lightCoverage, message).toBeGreaterThanOrEqual(0.75);
  return diagnostics;
}
