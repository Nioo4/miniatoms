# 工程记录

## 2026-09-20 — 初始化与并行实现

- 依据私有开发 Spec v1.0 建立独立 miniatoms 仓库目录；原题、联系方式、私有 Spec 留在父目录。
- Node 24.15.0 / npm 11.12.1。create-next-app 16.3.5 初始化成功。
- 主 agent 负责公共契约、预览内核、集成与验收；三个 GPT-6 Astra medium 子 agent 分别负责数据库、服务端、工作台。
- 初始化模板默认 React 19.2.8、Node 类型 20；按基线调整 React 19.3.0，并因 Vitest 5 peer constraint 将 @types/node 调整为 24。没有使用 --force/legacy-peer-deps。
- 当前缺真实服务配置，人工事项见 manual-todos.md；不将 fixture 或文档检查算作真实业务通过。

## 2026-09-20 — 首轮 CI 与预览布局修正

- 公开仓库 Nioo4/miniatoms，首轮 commit 5408dd4。GitHub Actions 35465265115：code job PASS；真实 Linux 本地 Supabase D-01..D-14 共 14 项 PASS；完整工作台 6 项均在首次候选发布前 FAIL。
- 真实失败为候选三次启动超时。用实际工作台 CSS 复现：屏幕外 opaque iframe 不能完成两次 requestAnimationFrame。保持同一测试与检查时限，将容器移到视口内、工作台背后后通过；未放宽检查或增加模型调用次数。
- 私有 Spec 第 10.2 节同步修正布局契约；容器 inert/aria-hidden，禁止交互，不改变临时存储与正式发布边界。新增直接加载实际 CSS 的预览回归测试。
- 修复启动 ready 晚于业务写入结果时覆盖“未保存”状态的问题；增加 CSP 实际出站阻断、history 临时数据、跨 iframe 伪造消息、CAS 冲突及 bootstrap 失败用例。
- 本轮本地验证：64 单元测试、8 预览浏览器测试通过；完整工作台需新一轮 CI。ESLint 排除生成的 Playwright 报告与私有下载证据，继续检查应用及测试源码。

## 2026-09-20 — 原生表单与客户端生命周期

- CI 35465957126 / commit 2b0e022：数据库再次通过；工作台 4 PASS / 4 FAIL。所有失败都发生在新增记录，原生 submit 未触发且无 PUT，候选发布已恢复正常。
- Chromium 153 对照脚本 `tests/fixtures/form-diagnostic.mjs` 证明仅 allow-scripts 会阻断 submit 事件。主 agent 决定统一改为 allow-scripts allow-forms，保留 form-action none、connect-src none 及无同源权限；Spec、宿主与导出同步修改。实测 GET/POST 未接管表单无出站请求、未导航，正常表单可调用 SDK 保存和独立导出。依据：[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[CSP form-action](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action)。
- Astra medium 审查发现并修复首个 snapshot 前断流卡住、身份切换仍显示旧历史、连续候选反馈被忙碌标识吞掉三个问题。独立 React 浏览器生命周期 6 项、反馈排队单元 6 项通过；总单元测试 70 项通过，类型检查与 ESLint 通过。
- 完整工作台加入 1440px/390px 两套主流程、旧 frame 晚到写、真实 headed 背景切换；远程 CI 用 Xvfb，不能以模拟可见性伪装后台验收。
- Vercel 已通过现有登录会话创建并部署项目，公开地址 https://miniatoms.vercel.app，首个部署对应 2b0e022。无登录 HTTP health 返回 503 configuration_required（database/model 均 false），符合缺配置状态，不算可用真实 Demo。浏览器连接随后中断；生产非秘密变量与凭证仍需补齐并重新部署。
