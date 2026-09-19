import { spawnSync } from "node:child_process";
const raw = process.env.LIVE_BASE_URL || process.env.APP_ORIGIN;
if (!raw) throw new Error("BLOCKED: 请设置 LIVE_BASE_URL 为已经配置真实服务的工作台 Origin。未执行任何模型调用。");
const url = new URL(raw);
if (url.origin !== raw || url.username || !["https:", "http:"].includes(url.protocol)
  || (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)))
  throw new Error("LIVE_BASE_URL 必须是精确 HTTPS Origin 或本地 HTTP Origin。");
if (process.env.AI_TEST_MODE === "fixture") throw new Error("BLOCKED: 真实验收拒绝 fixture 模式。");
let response, health;
try {
  response = await fetch(url.origin + "/api/health", { signal: AbortSignal.timeout(10000) });
  health = await response.json();
} catch {
  throw new Error("BLOCKED: 10 秒内无法读取目标健康检查；请检查网络及服务地址。没有开始真实生成。");
}
if (!response.ok || health.status !== "configured") throw new Error("BLOCKED: 目标服务配置未完成。没有开始真实生成。");
console.info(JSON.stringify({ mode: "live", origin: url.origin, commit: health.commit, warning: "将调用真实模型，消耗目标服务配额。此套件不覆盖尚未执行的人工用例。" }));
const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.live.config.ts"], {
  stdio: "inherit", env: { ...process.env, LIVE_BASE_URL: url.origin },
});
process.exit(result.status ?? 1);
