import { test, expect, type Page } from "@playwright/test";

async function generate(page: Page, prompt: string) {
  await page.goto("/");
  const input = page.getByLabel("描述应用需求");
  await input.fill(prompt);
  await expect(page.getByRole("button", { name: /开始创造/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: /开始创造/ }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
  await expect(page.locator(".run-card strong")).toHaveText("新版本已保存", { timeout: 245_000 });
  await expect(page.locator('iframe[title="应用预览"]')).toBeVisible();
  return page.frameLocator('iframe[title="应用预览"]');
}
test("LIVE job-board generation and one actual persistent record", async ({ page }, testInfo) => {
  const frame = await generate(page, "帮我做一个中文求职投递看板。记录公司、岗位、投递日期、当前阶段和备注。阶段包括待投递、已投递、面试中、已结束。支持新增、编辑、删除、按阶段筛选，以及各阶段数量统计。使用简洁的蓝白配色，适配手机。记录要在刷新后保留。");
  const company = frame.getByLabel(/公司/).first();
  if (!await company.isVisible()) await frame.getByRole("button", { name: /新增|添加/ }).first().click();
  await company.fill("星河科技");
  await frame.getByLabel(/岗位|职位/).first().fill("全栈工程师");
  await frame.getByLabel(/日期/).first().fill("2026-09-20");
  await frame.getByLabel(/备注/).first().fill("官网提交");
  const stage = frame.getByLabel(/阶段|状态/).first();
  if (await stage.evaluate((element) => element.tagName) === "SELECT") await stage.selectOption({ label: "已投递" });
  await frame.getByRole("button", { name: /保存|提交|添加|新增/ }).last().click();
  await expect(frame.getByText("星河科技", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".preview-footer")).toContainText("数据已保存");
  await page.reload();
  await expect(page.frameLocator('iframe[title="应用预览"]').getByText("星河科技", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("job-board-persistent.png"), fullPage: true });
  await testInfo.attach("evidence-boundary", { body: JSON.stringify({ mode: "live", projectUrl: page.url(),
    verified: ["真实生成", "新增一条记录", "刷新保持"], stillRequiresFullAcceptance: ["编辑删除筛选统计", "连续修改两轮", "历史恢复与恢复后修改", "导出", "访客隔离"] }, null, 2), contentType: "application/json" });
});
test("LIVE expense app generates and presents real interactive controls", async ({ page }, testInfo) => {
  const frame = await generate(page, "做一个中文个人记账本，支持录入日期、收入或支出、分类、金额和备注，能删除记录，按月份筛选，显示收入、支出和结余，刷新后保留。");
  await expect(frame.getByText(/收入/).first()).toBeVisible();
  await expect(frame.getByText(/支出/).first()).toBeVisible();
  await expect(frame.getByRole("button").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("expense-generated.png"), fullPage: true });
  await testInfo.attach("evidence-boundary", { body: "live generation smoke only; LIVE-08 arithmetic/CRUD/persistence still requires actual recorded operations.", contentType: "text/plain" });
});
test("LIVE habit app generates and presents real interactive controls", async ({ page }, testInfo) => {
  const frame = await generate(page, "做一个中文习惯打卡应用，可以新增习惯，勾选或取消今天的完成状态，显示今天完成了几个，刷新后保留，不需要账号。");
  await expect(frame.getByText(/习惯/).first()).toBeVisible();
  await expect(frame.getByRole("button").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("habit-generated.png"), fullPage: true });
  await testInfo.attach("evidence-boundary", { body: "live generation smoke only; LIVE-09 add/check/undo/persistence still requires actual recorded operations.", contentType: "text/plain" });
});

