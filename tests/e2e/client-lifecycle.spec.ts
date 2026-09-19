import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";

let server: Server, baseUrl: string;
test.beforeAll(async () => {
  const bundled = await build({ entryPoints: ["tests/fixtures/client-lifecycle-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", plugins: [{ name: "explicit-client-fixtures", setup(builder) {
    builder.onResolve({ filter: /^\.\/auth$/ }, args => args.importer.includes("lib/client/") || args.importer.includes("lib\\client\\") ? { path: "auth", namespace: "fixture" } : undefined);
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    builder.onResolve({ filter: /lib\/preview\/mount$/ }, () => ({ path: "preview", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "auth" ? "export const initializeSession=(...a)=>window.__clientFixtureAuth.initializeSession(...a),accessToken=(...a)=>window.__clientFixtureAuth.accessToken(...a),refreshSession=(...a)=>window.__clientFixtureAuth.refreshSession(...a),getAuthClient=(...a)=>window.__clientFixtureAuth.getAuthClient(...a);" : args.path === "router" ? "export const useRouter=()=>({push(){}});" : "export function mountPreview(frame,options){frame.dataset.version=options.versionId;frame.dataset.mode=options.mode;window.__clientFixture.mounts.push(options.versionId);return {destroy(){frame.removeAttribute('data-version');},freezeWrites(){},resumeWrites(){},async drainWrites(){}}}" }));
  } }] });
  server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/bundle.js" ? bundled.outputFiles[0].text : '<!doctype html><html><head><title>Client lifecycle fixture</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test("lost first snapshot and failed first query recover without a second start", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=recover`);
  await page.getByLabel("应用需求或修改意见").fill("测试首次断流");
  await page.getByRole("button", { name: "发送需求" }).click();
  await expect(page.getByText("正在确认任务状态", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消任务" })).toBeVisible();
  await expect(page.getByText("本次生成未完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__clientFixture.counters)).toMatchObject({ starts: 1, runGets: 2 });
});
test("a command awaiting its first snapshot remains cancellable", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=cancel`);
  await page.getByLabel("应用需求或修改意见").fill("测试取消");
  await page.getByRole("button", { name: "发送需求" }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByRole("button", { name: "取消任务" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__clientFixture.counters)).toMatchObject({ starts: 1, cancels: 1 });
});
test("uncertain-start GET 404 keeps confirming instead of declaring a missing project", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=recover404`);
  await page.getByLabel("应用需求或修改意见").fill("测试查询暂时404");
  await page.getByRole("button", { name: "发送需求" }).click();
  await expect(page.getByText("服务器尚未确认任务，正在继续查询；不会重复生成。", { exact: true })).toBeVisible();
  await expect(page.getByText("本次生成未完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__clientFixture.counters)).toMatchObject({ starts: 1, runGets: 3 });
});
test("unconfirmed starts stop querying at the confirmation deadline but retain cancellation", async ({ page }) => {
  await page.clock.install();
  await page.goto(`${baseUrl}/?scenario=cancel`);
  await page.getByLabel("应用需求或修改意见").fill("测试确认窗口");
  await page.getByRole("button", { name: "发送需求" }).click();
  await expect.poll(() => page.evaluate(() => window.__clientFixture.counters.runGets)).toBe(1);
  await page.clock.fastForward(246000);
  await expect(page.getByText("暂时无法确认任务最终结果，请重新载入或取消任务。不会自动重新生成。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消任务" })).toBeVisible();
  const count = await page.evaluate(() => window.__clientFixture.counters.runGets);
  await page.clock.fastForward(20000);
  expect(await page.evaluate(() => window.__clientFixture.counters)).toMatchObject({ starts: 1, runGets: count });
});
test("a definite pre-stream rejection does not retain an unknown active task", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=rejected`);
  await page.getByLabel("应用需求或修改意见").fill("测试明确拒绝");
  await page.getByRole("button", { name: "发送需求" }).click();
  await expect(page.getByText("测试拒绝", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消任务" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__clientFixture.counters)).toMatchObject({ starts: 1, runGets: 0 });
});
test("switching visitor identity unmounts the old history iframe and source", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=identity`);
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await page.getByRole("button", { name: /旧身份历史源码/ }).click();
  await expect(page.locator('iframe[data-mode="history"]')).toHaveCount(1);
  await page.evaluate(() => window.__clientFixture.changeIdentity());
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("历史 v1 · 操作不保存", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/访客身份发生变化/)).toBeVisible();
});

