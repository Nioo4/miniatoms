import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let server: Server, baseUrl: string, exported = "";
const counter = {
  html: '<h1>独立计数</h1><output id="count">0</output><button id="add">增加</button>',
  css: "body{padding:24px}button{padding:12px}",
  js: 'const state = await appStore.getState(); const render=()=>document.getElementById("count").textContent=String(state.count||0); render(); document.getElementById("add").onclick=async()=>{const next={...state,count:(state.count||0)+1};await appStore.setState(next);Object.assign(state,next);render();};',
};
// A fixture transport for the preview kernel only. No Supabase / live-model claim.
type HarnessWindow = Window & { harness: {
  create(a: typeof counter, mode?: "active" | "probe" | "history", delay?: number, containerSelector?: string): string;
  events: { type: string; value: unknown }[]; snapshot(): { state: Record<string, unknown>; revision: number };
  writes(): number; freeze(i?: number): void; drain(i?: number): Promise<void>; destroy(i?: number): void; export(a: typeof counter): Promise<string>;
} };
test.beforeAll(async () => {
  const compiled = await build({ entryPoints: ["tests/fixtures/preview-harness.ts"], bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", minify: true });
  server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html; charset=utf-8");
    res.end(req.url === "/bundle.js" ? compiled.outputFiles[0].text : req.url === "/export" ? exported : '<!doctype html><title>Preview fixture</title><script src="/bundle.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); });
test.beforeEach(async ({ page }) => { await page.goto(baseUrl); });
async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.filter((e) => e.type === "ready").length)).toBeGreaterThan(0);
}

test("candidate checks complete inside the actual workbench probe layout", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  await page.addStyleTag({ content: await readFile("src/app/globals.css", "utf8") });
  await page.evaluate((artifact) => {
    const container = document.createElement("div");
    container.className = "probe-container";
    container.setAttribute("aria-hidden", "true");
    container.inert = true;
    document.body.append(container);
    (window as unknown as HarnessWindow).harness.create(artifact, "probe", 0, ".probe-container");
  }, counter);
  await ready(page);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some(e => e.type === "diagnostic"))).toBe(false);
});

test("active SDK persists confirmed writes; frame cannot read parent credentials", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact), counter);
  await ready(page);
  const frame = page.frameLocator("#frame-0");
  await frame.getByRole("button", { name: "增加" }).click();
  await expect(frame.locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({ count: 1 });
  expect(await frame.locator("body").evaluate(() => {
    try { void window.parent.document; return "unsafe"; } catch { return "blocked"; }
  })).toBe("blocked");
  expect(await frame.locator("body").evaluate(() => {
    try { localStorage.setItem("secret", "x"); return "unsafe"; } catch { return "blocked"; }
  })).toBe("blocked");
  expect(await frame.locator("body").evaluate(() => {
    try { void document.cookie; return "unsafe"; } catch { return "blocked"; }
  })).toBe("blocked");
});

test("native form submit saves through SDK and exported application", async ({page}) => {
  const form = { html: '<form><label>名称<input name="name" required></label><button>保存</button></form><output></output>', css: '',
    js: 'const form=document.querySelector("form");document.querySelector("output").textContent=(await appStore.getState()).name||"";form.addEventListener("submit",async e=>{e.preventDefault();const name=new FormData(form).get("name");await appStore.setState({name});document.querySelector("output").textContent=name;});' };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), form);
  await ready(page);
  await page.frameLocator("#frame-0").getByRole("textbox",{name:"名称"}).fill("表单记录");
  await page.frameLocator("#frame-0").getByRole("button",{name:"保存"}).click();
  await expect(page.frameLocator("#frame-0").locator("output")).toHaveText("表单记录");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({name:"表单记录"});
  exported = await page.evaluate(a => (window as unknown as HarnessWindow).harness.export(a), form);
  await page.goto(baseUrl + "/export");
  await page.frameLocator("iframe").getByRole("textbox",{name:"名称"}).fill("导出表单");
  await page.frameLocator("iframe").getByRole("button",{name:"保存"}).click();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("导出表单");
  await page.reload();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("导出表单");
});

for (const method of ["get", "post"]) test(`CSP blocks native ${method} form navigation`, async ({page}) => {
  const outbound: string[] = [];
  page.on("request", request => { if(request.url().startsWith("https://example.com")) outbound.push(request.url()); });
  await page.evaluate(({artifact, method}) => (window as unknown as HarnessWindow).harness.create({ ...artifact,
    html: '<form method="'+method+'" action="https://example.com/forbidden"><input name="data" value="fixture"><button>提交</button></form>', js: ''
  }), {artifact:counter, method});
  await ready(page);
  await page.frameLocator("#frame-0").getByRole("button",{name:"提交"}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some(e => e.type === "diagnostic"))).toBe(true);
  expect(outbound).toEqual([]);
  expect(page.frames()[1].url()).toBe("about:srcdoc");
});

test("probe and history writes stay in the temporary snapshot", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact, "probe"), counter);
  await ready(page);
  await page.frameLocator("#frame-0").getByRole("button", { name: "增加" }).click();
  await expect(page.frameLocator("#frame-0").locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot())).toMatchObject({ state: {}, revision: 0 });
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.writes())).toBe(0);
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact, "history"), counter);
  await page.frameLocator("#frame-1").getByRole("button", { name: "增加" }).click();
  await expect(page.frameLocator("#frame-1").locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot())).toMatchObject({ state: {}, revision: 0 });
});

test("cross-window forged messages never reach the data writer", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact), counter);
  await ready(page);
  await page.evaluate(() => window.postMessage({ v: 1, namespace: "miniatoms", channelId: crypto.randomUUID(), type: "store.set", requestId: crypto.randomUUID(), state: { forged: true } }, "*"));
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.writes())).toBe(0);
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact), counter);
  await expect(page.frameLocator("#frame-1").getByRole("button", { name: "增加" })).toBeVisible();
  const channel = await page.locator("#frame-1").getAttribute("srcdoc").then((doc) => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await page.frameLocator("#frame-0").locator("body").evaluate((_element, channelId) => {
    window.parent.postMessage({ v: 1, namespace: "miniatoms", channelId, type: "store.set", requestId: crypto.randomUUID(), state: { forged: true } }, "*");
  }, channel);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.writes())).toBe(0);
});

test("CSP blocks an actual generated fetch before it leaves the iframe", async ({ page }) => {
  const outbound: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith("https://example.com")) outbound.push(request.url()); });
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create({ ...artifact, js: 'await fetch("https://example.com/private-fixture");' }, "probe"), counter);
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some((e) => e.type === "diagnostic"))).toBe(true);
  expect(outbound).toEqual([]);
});

test("real startup exceptions reject the candidate and never emit ready", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create({ ...artifact, js: 'throw new Error("fixture-startup-failure");' }, "probe"), counter);
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.filter((e) => e.type === "diagnostic").length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some((e) => e.type === "ready"))).toBe(false);
});

test("startup rejection and empty application never pass initial checks", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create({ ...artifact, js: 'await Promise.reject(new Error("fixture-rejection"));' }, "probe"), counter);
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.filter(e => e.type === "diagnostic").length)).toBe(1);
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create({ ...artifact, html: "<div></div>", js: "" }, "probe"), counter);
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.filter(e => e.type === "diagnostic").length)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some(e => e.type === "ready"))).toBe(false);
});

test("destroyed iframe messages cannot mutate the active application", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact), counter);
  await ready(page);
  const channel = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await page.evaluate((artifact) => {
    const h = (window as unknown as HarnessWindow).harness;
    h.destroy(0);
    h.create(artifact);
  }, counter);
  await page.frameLocator("#frame-0").locator("body").evaluate((_element, channelId) => {
    window.parent.postMessage({ v: 1, namespace: "miniatoms", channelId, type: "store.set", requestId: crypto.randomUUID(), state: { obsolete: true } }, "*");
  }, channel);
  await expect(page.frameLocator("#frame-1").getByRole("button", {name: "增加"})).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.writes())).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({});
});

test("freezing blocks new writes but drains a write already accepted", async ({ page }) => {
  await page.evaluate((artifact) => (window as unknown as HarnessWindow).harness.create(artifact, "active", 400), counter);
  await ready(page);
  await page.frameLocator("#frame-0").getByRole("button", { name: "增加" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some((e) => e.type === "save" && e.value === "saving"))).toBe(true);
  await page.evaluate(async () => { const h = (window as unknown as HarnessWindow).harness; h.freeze(); await h.drain(); });
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({ count: 1 });
});

test("export survives script closing text and persists on independent HTTP and file", async ({ page, context }) => {
  const artifact = { ...counter, js: 'const closing = "</script><script>window.parent.pwned=true</script>";\n' + counter.js };
  exported = await page.evaluate((a) => (window as unknown as HarnessWindow).harness.export(a), artifact);
  const separate = await context.newPage();
  await separate.goto(baseUrl + "/export");
  await separate.frameLocator("iframe").getByRole("button", { name: "增加" }).click();
  await expect(separate.frameLocator("iframe").locator("#count")).toHaveText("1");
  await separate.reload();
  await expect(separate.frameLocator("iframe").locator("#count")).toHaveText("1");
  expect(await separate.evaluate(() => "pwned" in window)).toBe(false);
  const directory = await mkdtemp(join(tmpdir(), "miniatoms-export-"));
  const file = join(directory, "app.html"); await writeFile(file, exported, "utf8");
  await separate.goto(pathToFileURL(file).href);
  await separate.frameLocator("iframe").getByRole("button", { name: "增加" }).click();
  await expect(separate.frameLocator("iframe").locator("#count")).toHaveText("1");
  await separate.close();
});
