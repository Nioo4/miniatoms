import { expect, type Dialog, type FrameLocator, type Locator, type Page } from '@playwright/test';
export type Surface = FrameLocator;
export const app = (page: Page) => page.frameLocator('iframe[title="应用预览"]');
export async function unique(locator: Locator, description: string) {
  const visible = locator.filter({ visible: true });
  await expect(visible, `无法唯一识别真实生成 UI：${description}`).toHaveCount(1);
  return visible;
}
export async function field(frame: Surface, name: RegExp, value: string) {
  await (await unique(frame.getByLabel(name), `字段 ${name}`)).fill(value);
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
  if (await radio.count() === 1) return radio.check();
  await button(frame, new RegExp(`^${value}$`));
}
export async function openForm(frame: Surface, label: RegExp) {
  if (!await frame.getByLabel(label).filter({ visible: true }).count()) await button(frame, /^[ +＋]*(新增|添加|新建)(投递|记录|习惯|账目)?[ +＋]*$/);
}
export async function save(frame: Surface) { await button(frame, /^(保存|确认|提交|添加|新增)(记录|投递|习惯|账目|修改)?$/); }
export async function row(frame: Surface, text: string) {
  const semanticRows = frame.getByRole('listitem').or(frame.getByRole('row')).filter({ hasText: text });
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
    const confirm = (await dialog.count() === 1 ? dialog : frame).getByRole('button', { name: /^(删除|确认删除|确定删除|确认|确定)$/ }).filter({ visible: true });
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
  const select = frame.getByRole('combobox', { name: /筛选|阶段过滤|查看阶段/ }).filter({ visible: true });
  if (await select.count() === 1) { await select.selectOption({ label: value }); return; }
  await button(frame, new RegExp(`^${value}(\\s*[（(]?\\d+[）)]?)?$`));
}
export async function metric(frame: Surface, label: string, value: number, total?: number) {
  const labelPattern = label === '今日完成' ? /^(?:今日|今天)(?:已)?完成(?:\s+\d+\s*(?:[/／]\s*\d+)?\s*(?:个习惯|个|项)?)?$/ : new RegExp(`^${label}$`);
  await expect.poll(async () => {
    const region = frame.getByRole('region', { name: /统计|完成情况/ });
    const scope = await region.count() === 1 ? region : frame;
    const labels = scope.getByText(labelPattern).filter({ visible: true });
    const matched: string[] = [];
    for (const item of await labels.all()) {
      const text = await item.evaluate(el => {
        for (let node: Element | null = el; node && node.tagName !== 'BODY'; node = node.parentElement) {
          if (node.matches('button,select,option,label') || node.querySelector('input,select,textarea')) return null;
          const text = (node as HTMLElement).innerText?.trim() ?? '';
          if (/\d/.test(text) && text.length < 100) return text;
        }
        return null;
      });
      if (text) matched.push(text);
    }
    if (matched.length !== 1) return { unique: false, candidates: matched.length };
    const text = matched[0].replaceAll(',', '');
    const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (total !== undefined && /\d\s*[/／]\s*\d/.test(text)) return { unique: true, numbers: numbers?.[1] === total ? [numbers[0]] : numbers, scalar: true };
    return { unique: true, numbers, scalar: true };
  }, { message: `统计 ${label} 必须唯一展示正确数值`, timeout: 15_000 }).toEqual(
    { unique: true, numbers: [value], scalar: true },
  );
}
export async function persisted(page: Page) { await expect(page.locator('.preview-footer')).toContainText('数据已保存'); }
export async function ready(page: Page, version: number) {
  await expect(page.locator('.preview-toolbar')).toContainText(`v${version} · 基础检查通过`, { timeout: 245_000 });
  await expect(page.locator('iframe[title="应用预览"]')).toBeVisible();
}
export async function create(page: Page, prompt: string) {
  await page.goto('/'); await page.getByLabel('描述应用需求').fill(prompt);
  await expect(page.getByRole('button', { name: /开始创造/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: /开始创造/ }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]{36}$/);
  const id = page.url().split('/').at(-1)!; await ready(page, 1); return id;
}
export async function modify(page: Page, prompt: string, version: number) {
  await page.getByLabel('应用需求或修改意见').fill(prompt);
  await page.getByRole('button', { name: '发送需求', exact: true }).click(); await ready(page, version);
}
export async function dark(frame: Surface, expected: boolean) {
  const samples = await frame.locator('body').evaluate(() => {
    const width = window.innerWidth, height = window.innerHeight;
    const samples: { color: string; brightness: number | null; surface: string }[] = [];
    // Sample the visible viewport, not DOM order. Small inputs/buttons must not
    // determine the theme; use the nearest painted surface covering >=20%.
    for (const y of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      let color = [255, 255, 255], remaining = 1, surface = 'browser canvas';
      const layers: { channels: number[]; alpha: number }[] = [];
      let unsupported = false;
      for (let node = document.elementFromPoint(width * x, height * y); node; node = node.parentElement) {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const area = Math.max(0, Math.min(width, rect.right) - Math.max(0, rect.left))
          * Math.max(0, Math.min(height, rect.bottom) - Math.max(0, rect.top));
        if (area < width * height * 0.2) continue;
        // An image/gradient cannot be inferred from its fallback background color.
        if (style.backgroundImage !== 'none') { unsupported = true; surface = node.tagName; break; }
        const values = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
        if (!values || values.length < 3) { unsupported = true; break; }
        const alpha = (values[3] ?? 1) * Number(style.opacity);
        if (!alpha) continue;
        if (!layers.length) surface = node.tagName;
        layers.push({ channels: values.slice(0, 3), alpha }); remaining *= 1 - alpha;
        if (remaining === 0) break;
      }
      for (const layer of layers.reverse()) color = color.map((channel, i) => layer.channels[i] * layer.alpha + channel * (1 - layer.alpha));
      const rounded = color.map(Math.round);
      samples.push({ color: unsupported ? 'unresolved image/gradient/color' : `rgb(${rounded.join(', ')})`,
        brightness: unsupported ? null : rounded.reduce((sum, channel) => sum + channel, 0) / 3, surface });
    }
    return samples;
  });
  const matching = samples.filter(sample => sample.brightness !== null && (expected ? sample.brightness < 100 : sample.brightness > 160)).length;
  const diagnostics = { expected: expected ? 'dark (<100)' : 'light (>160)', matching, total: samples.length,
    colors: [...new Set(samples.map(sample => `${sample.surface}: ${sample.color}`))] };
  expect(matching / samples.length, `实际应用视口背景诊断：${JSON.stringify(diagnostics)}`).toBeGreaterThanOrEqual(0.75);
}
