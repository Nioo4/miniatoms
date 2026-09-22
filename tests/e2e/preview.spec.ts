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

for (const mode of ['preview', 'export'] as const) test(`startup remains inert until initialized and quiet in ${mode}`, async ({page}) => {
  const artifact = {
    html: '<form><label>收入<input id="income" type="radio" name="kind" value="income"></label><label>备注<input id="note"></label><button>保存</button></form><output>尚未保存</output>',
    css: 'label,button{display:block;padding:12px}',
    js: 'await appStore.getState();document.getElementById("app").dataset.phase="waiting";await new Promise(resolve=>document.addEventListener("fixture-initialize",resolve,{once:true}));document.querySelector("form").onsubmit=async event=>{event.preventDefault();await appStore.setState({income:document.getElementById("income").checked,note:document.getElementById("note").value});document.querySelector("output").textContent="保存完成";};document.getElementById("app").dataset.phase="initialized";',
  };
  if(mode==='preview') await page.evaluate(a=>(window as unknown as HarnessWindow).harness.create(a),artifact);
  else { exported=await page.evaluate(a=>(window as unknown as HarnessWindow).harness.export(a),artifact);await page.goto(baseUrl+'/export'); }
  const frame=page.frameLocator('iframe'), root=frame.locator('#app');
  await expect(root).toHaveAttribute('data-phase','waiting');
  const tryInteraction=async()=>{
    // Real pointer/keyboard input bypasses Playwright's wait-for-actionability retry.
    for(const selector of ['#income','#note','button']){
      const box=await frame.locator(selector).boundingBox();expect(box).not.toBeNull();
      await page.mouse.click(box!.x+box!.width/2,box!.y+box!.height/2);
      if(selector==='#note')await page.keyboard.type('过早输入');
    }
    await expect(root).toHaveAttribute('inert','');
    await expect(frame.locator('#income')).not.toBeChecked();
    await expect(frame.locator('#note')).toHaveValue('');
    await expect(frame.locator('output')).toHaveText('尚未保存');
  };
  await tryInteraction();
  await root.evaluate(()=>document.dispatchEvent(new Event('fixture-initialize')));
  await expect(root).toHaveAttribute('data-phase','initialized');
  await tryInteraction(); // Event handlers exist, but the startup quiet window still gates input.
  if(mode==='preview')expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.writes())).toBe(0);
  else expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('miniatoms:export:')))).toEqual([]);
  await expect(root).not.toHaveAttribute('inert');
  await frame.getByRole('radio',{name:'收入'}).check();
  await frame.getByRole('textbox',{name:'备注'}).fill('已初始化');
  await frame.getByRole('button',{name:'保存'}).click();
  await expect(frame.locator('output')).toHaveText('保存完成');
  if(mode==='preview'){
    expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({income:true,note:'已初始化'});
    expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.writes())).toBe(1);
  }else{
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('miniatoms:export:'))!)!).state)).toEqual({income:true,note:'已初始化'});
  }
});

test('failed initialization reports diagnostic and keeps application inert',async({page})=>{
  await page.evaluate(a=>(window as unknown as HarnessWindow).harness.create(a),{...counter,js:'await appStore.getState();throw new Error("初始化失败");'});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as HarnessWindow).harness.events.filter(event=>event.type==='diagnostic').length)).toBe(1);
  await expect(page.frameLocator('iframe').locator('#app')).toHaveAttribute('inert','');
  expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.events.filter(event=>event.type==='ready').length)).toBe(0);
});

test("active SDK persists confirmed writes; frame cannot read parent credentials", async ({ page }) => {
  await page.context().addCookies([{name:'miniatoms-host-cookie',value:'fixture-host-cookie-secret',url:baseUrl}]);
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
  expect(await page.evaluate(()=>document.cookie)).toContain('fixture-host-cookie-secret');
  expect(await frame.locator('body').evaluate(()=>{
    try{return {read:true,value:document.cookie};}catch(error){return {read:false,error:error instanceof DOMException?error.name:'unexpected'};}
  })).toEqual({read:false,error:'SecurityError'});
  expect(await frame.locator("body").evaluate(() => {
    try { void document.cookie; return "unsafe"; } catch { return "blocked"; }
  })).toBe("blocked");
});

for (const mode of ["preview", "export"] as const) test(`SDK smooths a short get/set burst in ${mode}`, async ({ page }) => {
  const artifact = {
    html: '<h1>连续保存</h1><output id="sequence"></output>', css: '',
    js: 'const sequence=[];for(let i=0;i<4;i++){const before=await appStore.getState();await appStore.setState({...before,count:i});const after=await appStore.getState();sequence.push(String(after.count));}document.getElementById("sequence").textContent=sequence.join(",");',
  };
  if (mode === "preview") {
    await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), artifact);
    await ready(page);
  } else {
    exported = await page.evaluate(a => (window as unknown as HarnessWindow).harness.export(a), artifact);
    await page.goto(baseUrl + "/export");
    await expect(page.frameLocator("iframe").locator("#sequence")).toHaveText("0,1,2,3");
  }
  const frame = page.frameLocator(mode === "preview" ? "#frame-0" : "iframe");
  await expect(frame.locator("#sequence")).toHaveText("0,1,2,3");
  if (mode === "preview") {
    expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({ count: 3 });
    expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.writes())).toBe(4);
    expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some(e => e.type === "diagnostic"))).toBe(false);
  } else {
    const key = await page.evaluate(() => Object.keys(localStorage).find(value => value.startsWith("miniatoms:export:"))!);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, key)).toEqual({ count: 3 });
  }
});

test("SDK bounds queued storage requests at ten without dropping accepted work", async ({ page }) => {
  const artifact = {
    html: '<h1>请求上限</h1><output id="rejected"></output>', css: '',
    js: 'const results=await Promise.allSettled(Array.from({length:11},()=>appStore.getState()));document.getElementById("rejected").textContent=String(results.filter(result=>result.status==="rejected"&&result.reason.code==="BRIDGE_RATE_LIMIT").length);',
  };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), artifact);
  await ready(page);
  await expect(page.frameLocator("#frame-0").locator("#rejected")).toHaveText("1");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.events.some(e => e.type === "diagnostic"))).toBe(false);
});

test("a parent write error rejects later queued writes without sending them", async ({ page }) => {
  await page.evaluate(() => {
    (window as Window & { fixtureSets?: unknown[] }).fixtureSets = [];
    window.addEventListener("message", event => {
      if (event.data?.type === "store.set") (window as unknown as Window & { fixtureSets: unknown[] }).fixtureSets.push(event.data);
    });
  });
  const blocked = {
    html: '<h1>等待保存</h1><output id="phase"></output>', css: '',
    js: 'const initial=await appStore.getState();document.getElementById("phase").textContent="waiting";await new Promise(resolve=>document.addEventListener("fixture-save",resolve,{once:true}));const errors=await Promise.all([1,2].map(value=>appStore.setState({...initial,value}).then(()=>"ok",error=>error.code)));document.getElementById("phase").textContent=errors.join(",");',
  };
  const writer = { html: '<h1>并发写入</h1>', css: '', js: 'await appStore.getState();await appStore.setState({other:1});' };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), blocked);
  await expect(page.frameLocator("#frame-0").locator("#phase")).toHaveText("waiting");
  const blockedChannel = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), writer);
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({ other: 1 });
  await page.frameLocator("#frame-0").locator("body").evaluate(() => document.dispatchEvent(new Event("fixture-save")));
  await expect(page.frameLocator("#frame-0").locator("#phase")).toHaveText("DATA_REVISION_CONFLICT,DATA_REVISION_CONFLICT");
  expect(await page.evaluate(channel => (window as unknown as Window & { fixtureSets: { channelId: string }[] }).fixtureSets.filter(message => message.channelId === channel).length, blockedChannel)).toBe(1);
});

test("a response for a queued request is ignored until that request is sent", async ({ page }) => {
  const artifact = {
    html: '<h1>响应顺序</h1><output id="result"></output>', css: '',
    js: 'const original=crypto.randomUUID.bind(crypto);Object.defineProperty(crypto,"randomUUID",{configurable:true,value:()=>{const id=original();window.fixtureIds=(window.fixtureIds||[]).concat(id);return id;}});const first=appStore.setState({first:true});const second=appStore.getState();const results=await Promise.allSettled([first,second]);document.getElementById("result").textContent=results[1].status==="fulfilled"&&results[1].value.spoofed?"spoofed":"real";',
  };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a, "active", 400), artifact);
  const frame = page.frameLocator("#frame-0");
  await expect.poll(() => frame.locator("body").evaluate(() => (window as Window & { fixtureIds?: string[] }).fixtureIds?.length ?? 0)).toBe(2);
  const requestId = await frame.locator("body").evaluate(() => (window as unknown as Window & { fixtureIds: string[] }).fixtureIds[1]);
  const channelId = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await page.evaluate(({ channel, requestId }) => {
    const frame = document.querySelector("#frame-0") as HTMLIFrameElement;
    frame.contentWindow?.postMessage({ v: 1, namespace: "miniatoms", channelId: channel, type: "store.result",
      requestId, ok: true, state: { spoofed: true }, revision: 999 }, "*");
  }, { channel: channelId, requestId });
  await expect(frame.locator("#result")).toHaveText("real");
});

test("destroying a frame clears unsent SDK requests", async ({ page }) => {
  await page.evaluate(() => {
    (window as Window & { fixtureSets?: unknown[] }).fixtureSets = [];
    window.addEventListener("message", event => {
      if (event.data?.type === "store.set") (window as unknown as Window & { fixtureSets: unknown[] }).fixtureSets.push(event.data);
    });
  });
  const artifact = {
    html: '<h1>销毁排队</h1>', css: '',
    js: 'const first=appStore.setState({step:1});const second=appStore.setState({step:2});const read=appStore.getState();await Promise.allSettled([first,second,read]);',
  };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a, "active", 400), artifact);
  const channelId = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await expect.poll(() => page.evaluate(channel => (window as unknown as Window & { fixtureSets: { channelId: string }[] }).fixtureSets.filter(message => message.channelId === channel).length, channelId)).toBe(1);
  await page.evaluate(() => (window as unknown as HarnessWindow).harness.destroy(0));
  await page.waitForTimeout(600);
  expect(await page.evaluate(channel => (window as unknown as Window & { fixtureSets: { channelId: string }[] }).fixtureSets.filter(message => message.channelId === channel).length, channelId)).toBe(1);
});

test("an unsent request expires at ten seconds and a late write ack cannot unblock the SDK", async ({ page }) => {
  await page.evaluate(() => {
    (window as Window & { fixtureSets?: unknown[] }).fixtureSets = [];
    window.addEventListener("message", event => {
      if (event.data?.type === "store.set") (window as unknown as Window & { fixtureSets: unknown[] }).fixtureSets.push(event.data);
    });
  });
  const artifact = {
    html: '<h1>超时保存</h1><button id="save">连续保存</button><button id="retry">再次保存</button><output id="status">未执行</output>', css: '',
    js: 'await appStore.getState();const status=document.getElementById("status");document.getElementById("save").onclick=async()=>{const errors=await Promise.all([1,2,3].map(value=>appStore.setState({value}).then(()=>"ok",error=>error.code)));status.textContent=errors.join(",");};document.getElementById("retry").onclick=async()=>{try{await appStore.setState({value:4});status.dataset.retry="ok";}catch(error){status.dataset.retry=error.code;}};',
  };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a, "active", 11000), artifact);
  await ready(page);
  const frame = page.frameLocator("#frame-0");
  const channelId = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await frame.getByRole("button", { name: "连续保存" }).click();
  await expect(frame.locator("#status")).toHaveText("BRIDGE_TIMEOUT,BRIDGE_TIMEOUT,BRIDGE_TIMEOUT", { timeout: 15_000 });
  await frame.getByRole("button", { name: "再次保存" }).click();
  await expect(frame.locator("#status")).toHaveAttribute("data-retry", "BRIDGE_TIMEOUT");
  await page.waitForTimeout(1500);
  await expect(frame.locator("#status")).toHaveText("BRIDGE_TIMEOUT,BRIDGE_TIMEOUT,BRIDGE_TIMEOUT");
  await frame.locator("#status").evaluate(element => element.removeAttribute("data-retry"));
  await frame.getByRole("button", { name: "再次保存" }).click();
  await expect(frame.locator("#status")).toHaveAttribute("data-retry", "BRIDGE_TIMEOUT");
  expect(await page.evaluate(channel => (window as unknown as Window & { fixtureSets: { channelId: string }[] }).fixtureSets.filter(message => message.channelId === channel).length, channelId)).toBe(1);
});

test("direct forged storage messages still hit the parent rate limit", async ({ page }) => {
  const artifact = {
    html: '<h1>直接消息</h1><output id="limited">0</output>', css: '',
    js: 'await appStore.getState();window.addEventListener("message",event=>{const data=event.data;if(data?.type==="store.result"&&data.ok===false&&data.error?.code==="BRIDGE_RATE_LIMIT")document.getElementById("limited").textContent=String(Number(document.getElementById("limited").textContent)+1);});',
  };
  await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), artifact);
  await ready(page);
  const channelId = await page.locator("#frame-0").getAttribute("srcdoc").then(doc => /"channelId":"([a-f0-9-]+)"/.exec(doc!)![1]);
  await page.frameLocator("#frame-0").locator("body").evaluate((_, channel) => {
    for (let i = 0; i < 10; i++) window.parent.postMessage({
      v: 1, namespace: "miniatoms", channelId: channel, type: "store.get", requestId: crypto.randomUUID(),
    }, "*");
  }, channelId);
  await expect(page.frameLocator("#frame-0").locator("#limited")).toHaveText("1");
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
  await expect(page.frameLocator("iframe").locator("#app")).not.toHaveAttribute("inert");
  await page.frameLocator("iframe").getByRole("textbox",{name:"名称"}).fill("导出表单");
  await page.frameLocator("iframe").getByRole("button",{name:"保存"}).click();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("导出表单");
  await page.reload();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("导出表单");
});

for (const mode of ["preview", "export"] as const) test(`hidden overlays obey HTML visibility through repeated ${mode} interactions`, async ({ page }) => {
  // Reproduce generated modal CSS overriding the browser's normal [hidden] rule.
  const artifact = {
    html: '<button id="add">新增记录</button><output id="records"></output><div id="dialog-mask" class="dialog-mask" hidden><form><label>名称<input name="name" required></label><button>确认新增</button></form></div>',
    css: '.dialog-mask{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}form{padding:20px;background:white}',
    js: 'const state=await appStore.getState();const records=Array.isArray(state.records)?state.records:[];const mask=document.getElementById("dialog-mask");const form=document.querySelector("form");const render=()=>document.getElementById("records").textContent=records.join("、");render();document.getElementById("add").onclick=()=>{mask.hidden=false;};form.onsubmit=async event=>{event.preventDefault();const next=[...records,new FormData(form).get("name")];await appStore.setState({...state,records:next});records.splice(0,records.length,...next);render();mask.hidden=true;form.reset();};',
  };
  if (mode === "preview") {
    await page.evaluate(a => (window as unknown as HarnessWindow).harness.create(a), artifact);
    await ready(page);
  } else {
    exported = await page.evaluate(a => (window as unknown as HarnessWindow).harness.export(a), artifact);
    await page.goto(baseUrl + "/export");
  }
  const frame = page.frameLocator("iframe");
  const mask = frame.locator("#dialog-mask");
  await expect(mask).toHaveAttribute("hidden", "");
  await expect(mask).toBeHidden();
  await expect(mask).toHaveCSS("display", "none");
  expect(await page.locator("iframe").getAttribute("sandbox")).not.toContain("allow-modals");
  for (const [index, name] of ["第一条", "第二条"].entries()) {
    // No force click: an incorrectly visible overlay must make this operation fail.
    await frame.getByRole("button", { name: "新增记录", exact: true }).click();
    await expect(mask).not.toHaveAttribute("hidden");
    await expect(mask).toBeVisible();
    await expect(mask).toHaveCSS("display", "flex");
    await frame.getByRole("textbox", { name: "名称" }).fill(name);
    await frame.getByRole("button", { name: "确认新增", exact: true }).click();
    await expect(frame.locator("#records")).toHaveText(index ? "第一条、第二条" : "第一条");
    await expect(mask).toHaveAttribute("hidden", "");
    await expect(mask).toBeHidden();
    await expect(mask).toHaveCSS("display", "none");
  }
  if (mode === "preview") {
    expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.snapshot().state)).toEqual({ records: ["第一条", "第二条"] });
  } else {
    await page.reload();
    await expect(frame.locator("#records")).toHaveText("第一条、第二条");
    await expect(mask).toBeHidden();
    await frame.getByRole("button", { name: "新增记录", exact: true }).click();
    await expect(mask).toBeVisible();
  }
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

test('unawaited rejected promise triggers the native unhandledrejection listener',async({page})=>{
  const js='window.addEventListener("unhandledrejection",event=>{window.fixtureUnhandled={trusted:event.isTrusted,message:event.reason.message};}); void Promise.reject(new Error("fixture-native-unhandled"));';
  await page.evaluate(artifact=>(window as unknown as HarnessWindow).harness.create(artifact,'probe'),{...counter,js});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as HarnessWindow).harness.events.filter(e=>e.type==='diagnostic').length)).toBe(1);
  expect(await page.frameLocator('#frame-0').locator('body').evaluate(()=>Reflect.get(window,'fixtureUnhandled'))).toEqual({trusted:true,message:'fixture-native-unhandled'});
  expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.events.find(e=>e.type==='diagnostic')?.value)).toMatchObject({message:'fixture-native-unhandled'});
  expect(await page.evaluate(()=>(window as unknown as HarnessWindow).harness.events.some(e=>e.type==='ready'))).toBe(false);
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
