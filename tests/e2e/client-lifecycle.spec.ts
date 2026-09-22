import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";

let server: Server, baseUrl: string;
test.beforeAll(async () => {
  const bundled = await build({ entryPoints: ["tests/fixtures/client-lifecycle-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", plugins: [{ name: "explicit-client-fixtures", setup(builder) {
    builder.onResolve({ filter: /auth$/ }, args => args.path === "@/lib/client/auth" || args.importer.includes("lib/client/") || args.importer.includes("lib\\client\\") ? { path: "auth", namespace: "fixture" } : undefined);
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    builder.onResolve({ filter: /lib\/preview\/mount$/ }, () => ({ path: "preview", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "auth" ? "const enabled=new URLSearchParams(location.search).get('scenario')==='email-auth';const status=(u)=>{const m=u.user_metadata?.miniatoms_email_recovery_status;const confirmed=!!u.email_confirmed_at&&!u.is_anonymous&&!u.new_email;return m==='ready'&&confirmed?'ready':(m==='password_pending'&&confirmed)||(m==='email_pending'&&confirmed)?'password_pending':m==='email_pending'?'email_pending':'none'};export const EMAIL_AUTH_ENABLED=enabled,initializeSession=(...a)=>window.__clientFixtureAuth.initializeSession(...a),accessToken=(...a)=>window.__clientFixtureAuth.accessToken(...a),refreshSession=(...a)=>window.__clientFixtureAuth.refreshSession(...a),getAuthClient=(...a)=>window.__clientFixtureAuth.getAuthClient(...a),authIdentity=(s)=>({id:s.user.id,isAnonymous:s.user.is_anonymous===true,email:s.user.email||null,pendingEmail:s.user.new_email||null,recoveryStatus:status(s.user)}),linkEmail=(...a)=>window.__clientFixtureAuth.linkEmail(...a),verifyEmailOtp=(...a)=>window.__clientFixtureAuth.verifyEmailOtp(...a),setRecoveryPassword=(...a)=>window.__clientFixtureAuth.setRecoveryPassword(...a),signInWithPassword=(...a)=>window.__clientFixtureAuth.signInWithPassword(...a),signOutLocal=(...a)=>window.__clientFixtureAuth.signOutLocal(...a);" : args.path === "router" ? "export const useRouter=()=>({push(){}});" : "export function mountPreview(frame,options){frame.dataset.version=options.versionId;frame.dataset.mode=options.mode;window.__clientFixture.mounts.push(options.versionId);if(options.mode===\"probe\")window.__clientFixture.probeReady=()=>options.onReady(window.__clientFixture.dataRevision);return {destroy(){frame.removeAttribute('data-version');},freezeWrites(){},resumeWrites(){},async drainWrites(){}}}" }));
  } }] });
  server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/bundle.js" ? bundled.outputFiles[0].text : '<!doctype html><html><head><title>Client lifecycle fixture</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test("first anonymous login preserves a prompt entered before authentication completes", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=delayed-home`);
  const prompt = page.getByLabel("描述应用需求");
  await prompt.fill("登录完成前已经输入的求职看板需求");
  await expect(page.getByRole("button", { name: "开始创造" })).toBeDisabled();
  await page.evaluate(() => window.__clientFixture.releaseInitialAuth());
  await expect(page.getByRole("button", { name: "开始创造" })).toBeEnabled();
  await expect(prompt).toHaveValue("登录完成前已经输入的求职看板需求");
});

test("late initial reload cannot re-enable a view after its identity changed", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=initial-read-switch`);
  await expect.poll(() => page.evaluate(() => window.__clientFixture.counters.projectLists)).toBe(1);
  await page.evaluate(() => window.__clientFixture.changeIdentity());
  await expect(page.getByText(/访客身份发生变化/)).toBeVisible();
  await page.getByLabel("应用需求或修改意见").fill("新身份尚未载入，不应允许提交");
  await page.evaluate(async () => {
    window.__clientFixture.releaseInitialRead();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByRole("button", { name: "发送需求" })).toBeDisabled();
  await expect(page.getByText(/访客身份发生变化/)).toBeVisible();
});

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

test("same-user token refresh preserves entered text and the mounted preview", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=identity`);
  await expect(page.locator("iframe[data-version]")).toHaveCount(1);
  const input = page.getByLabel("应用需求或修改意见");
  await input.fill("刷新 token 时保留这段输入");
  const mounts = await page.evaluate(() => window.__clientFixture.mounts.length);
  await page.evaluate(() => window.__clientFixture.refreshIdentity());
  await expect(input).toHaveValue("刷新 token 时保留这段输入");
  expect(await page.evaluate(() => window.__clientFixture.mounts.length)).toBe(mounts);
  await expect(page.getByRole("button", { name: "发送需求" })).toBeEnabled();
});

test("enabled email fixture moves pending recovery to password without clearing the same UID project", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=email-auth`);
  await expect(page.getByText("匿名访客", { exact: true })).toBeVisible();
  const originalId = await page.evaluate(() => window.__clientFixtureAuth.initializeSession().then(value => value.user.id));
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
  await page.getByRole("button", { name: "绑定邮箱", exact: true }).click();
  await expect(page.getByText("尚未完成绑定", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /生命周期测试/ })).toBeVisible();
  await page.getByLabel("邮件验证码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "确认邮箱", exact: true }).click();
  await expect(page.getByText("邮箱已确认，还需设置密码", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__clientFixtureAuth.emailEnabled)).toBe(true);
  expect(await page.evaluate(() => window.__clientFixtureAuth.initializeSession().then(value => value.user.id))).toBe(originalId);
  await expect(page.getByRole("button", { name: /生命周期测试/ })).toBeVisible();
});

test("a history request rejected after identity change cannot replace the new identity warning", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=identity-history-error`);
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await page.getByRole("button", { name: /旧身份历史源码/ }).click();
  // Release in the same JS turn: protection must use the hook scope, not wait for view cleanup.
  await page.evaluate(async () => { window.__clientFixture.changeIdentity(); window.__clientFixture.releaseOperation(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await expect(page.getByText(/访客身份发生变化/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("old creation success cannot navigate the new identity to the old project", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=hook-create-success`);
  await expect.poll(() => page.evaluate(() => window.__clientFixture.hook?.ready)).toBe(true);
  await page.evaluate(() => { void window.__clientFixture.hook!.createProject().then(value => window.__clientFixture.results.push(value)); });
  await page.evaluate(() => window.__clientFixture.changeIdentity());
  await page.evaluate(() => window.__clientFixture.releaseOperation());
  await expect.poll(() => page.evaluate(() => window.__clientFixture.results)).toEqual([null]);
  expect(await page.evaluate(() => window.__clientFixture.hook?.error)).toContain("访客身份发生变化");
});

test("old creation catch and finally cannot replace the new scope error or busy state", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=hook-create-error`);
  await expect.poll(() => page.evaluate(() => window.__clientFixture.hook?.ready)).toBe(true);
  await page.evaluate(() => { void window.__clientFixture.hook!.createProject().then(value => window.__clientFixture.results.push(value)); });
  await page.evaluate(() => window.__clientFixture.changeIdentity());
  await expect.poll(() => page.evaluate(() => window.__clientFixture.hook?.identity)).toBe("30000000-0000-4000-8000-000000000002");
  // Exercise the hook boundary with a newer in-flight operation; the old finally must not finish it.
  await page.evaluate(() => { void window.__clientFixture.hook!.createProject(); });
  await expect.poll(() => page.evaluate(() => window.__clientFixture.hook?.busy)).toBe(true);
  await page.evaluate(() => window.__clientFixture.releaseOperation());
  await expect.poll(() => page.evaluate(() => window.__clientFixture.results.length)).toBe(1);
  expect(await page.evaluate(() => window.__clientFixture.hook?.busy)).toBe(true);
  expect(await page.evaluate(() => window.__clientFixture.hook?.error)).toBe("");
  await page.evaluate(() => window.__clientFixture.releaseInitialRead());
});

for (const scenario of ["hook-cancel-success", "hook-cancel-error", "hook-earlier-error"]) {
  test(`${scenario}: late completion cannot repopulate or replace a changed identity`, async ({ page }) => {
    await page.goto(`${baseUrl}/?scenario=${scenario}`);
    await expect.poll(() => page.evaluate(() => window.__clientFixture.hook?.ready)).toBe(true);
    if (scenario.startsWith("hook-cancel")) {
      await page.evaluate(() => window.__clientFixture.hook!.generate("测试旧取消"));
      await page.evaluate(() => { void window.__clientFixture.hook!.cancel().then(value => window.__clientFixture.results.push(value)); });
      await expect.poll(() => page.evaluate(() => window.__clientFixture.counters.cancels)).toBe(1);
    } else {
      await page.evaluate(() => { void window.__clientFixture.hook!.earlier().then(value => window.__clientFixture.results.push(value ?? null)); });
    }
    await page.evaluate(() => window.__clientFixture.changeIdentity());
    await page.evaluate(() => window.__clientFixture.releaseOperation());
    await expect.poll(() => page.evaluate(() => window.__clientFixture.results.length)).toBe(1);
    expect(await page.evaluate(() => window.__clientFixture.hook?.run)).toBeNull();
    expect(await page.evaluate(() => window.__clientFixture.hook?.error)).toContain("访客身份发生变化");
    expect(await page.evaluate(() => window.__clientFixture.hook?.detail)).toBeNull();
  });
}

test("uncertain feedback retry sends the identical receipt and body through the actual UI", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=feedback-replay`);
  await expect.poll(() => page.evaluate(() => !!window.__clientFixture.probeReady)).toBe(true);
  await page.evaluate(() => window.__clientFixture.probeReady!());
  await expect(page.getByRole("button", { name: "重试检查", exact: true })).toBeVisible();
  const first = await page.evaluate(() => window.__clientFixture.reports[0]);
  const mounts = await page.evaluate(() => window.__clientFixture.mounts.length);
  await page.getByRole("button", { name: "重试检查", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__clientFixture.mounts.length)).toBeGreaterThan(mounts);
  await page.evaluate(() => { window.__clientFixture.dataRevision = 42; window.__clientFixture.probeReady!(); });
  await expect(page.getByText("新版本已保存", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__clientFixture.reports)).toEqual([first, first]);
});

test("explicit data revision conflict alone replaces the retained feedback receipt", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=feedback-data-change`);
  await expect.poll(() => page.evaluate(() => !!window.__clientFixture.probeReady)).toBe(true);
  await page.evaluate(() => window.__clientFixture.probeReady!());
  await expect(page.getByRole("button", { name: "重试检查", exact: true })).toBeVisible();
  const first = await page.evaluate(() => window.__clientFixture.reports[0]);
  let mounts = await page.evaluate(() => window.__clientFixture.mounts.length);
  await page.getByRole("button", { name: "重试检查", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__clientFixture.mounts.length)).toBeGreaterThan(mounts);
  mounts = await page.evaluate(() => window.__clientFixture.mounts.length);
  await page.evaluate(() => window.__clientFixture.probeReady!());
  await expect.poll(() => page.evaluate(() => window.__clientFixture.mounts.length)).toBeGreaterThan(mounts);
  await page.evaluate(() => { window.__clientFixture.dataRevision = 2; window.__clientFixture.probeReady!(); });
  await expect(page.getByText("新版本已保存", { exact: true })).toBeVisible();
  const reports = await page.evaluate(() => window.__clientFixture.reports);
  expect(reports.slice(0, 2)).toEqual([first, first]);
  expect(reports[2].requestId).not.toBe(first.requestId);
  expect(reports[2].dataRevision).toBe(2);
});

test("a lost feedback response cannot paint a failure over an authoritative committed result", async ({ page }) => {
  await page.goto(`${baseUrl}/?scenario=feedback-late-error`);
  await expect.poll(() => page.evaluate(() => !!window.__clientFixture.probeReady)).toBe(true);
  await page.evaluate(() => window.__clientFixture.probeReady!());
  await expect(page.getByText("新版本已保存", { exact: true })).toBeVisible();
  await expect(page.getByText("网络连接失败，请检查连接后重新载入。", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__clientFixture.reports.length)).toBe(1);
});
