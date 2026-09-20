# MiniAtoms

通过自然语言生成、修改和保存前端小应用的工作台。DeepSeek 生成真实 HTML、CSS 和 JavaScript，候选代码通过静态与浏览器启动检查后，才原子切换当前成果。

> [线上应用](https://miniatoms.vercel.app) 已完成生产配置与独立 LIVE-11 验收：全新浏览器匿名访问、真实生成、任务保存与刷新持久化通过。官方 DeepSeek 与专用 Supabase 实际接通；本地 LIVE-01～10 已分组通过。详细证据与边界见 [验收记录](docs/acceptance.md) 和 [人工前置事项](docs/manual-todos.md)。

最近完成的代码验收：[CI 35476530187](https://github.com/Nioo4/miniatoms/actions/runs/35476530187)，代码提交 `91ccda8`。104 单元、73 SQL 断言、15 真实本地 Supabase 集成、19 预览、25 离线检查（21 录制源码回放 + 4 Run 等待回归）、18 客户端生命周期、15 完整工作台测试均通过。[历史脱敏测试证据与阶段截图](artifacts/verification/ci-35468543560/results.json) 使用明确的模型 fixture；本地真实模型业务验收已另行分组通过，独立生产LIVE-11也已通过，最终提交仍待本人处理。

**本地 LIVE_VERIFIED：PASS（分组验收）。** [2236e1a主流程](artifacts/verification/live-remote-2236e1a/live-results.json)的LIVE-01～07保留同一看板v1～v5连续证据；[ef591ce独立运行](artifacts/verification/live-remote-ef591ce/live-results.json)新建真实模型应用及匿名身份，LIVE-08/09/10全部PASS。两组产品源码与迁移树相同，详见[分组汇总](artifacts/verification/live-acceptance-summary.json)。这不是同一次全量运行PASS；独立[生产LIVE-11](artifacts/verification/live-production-91ccda8/)也已通过；个人字段已在私有提交副本补齐，最终提交仍由本人处理。

本地真实模型演示已录制，约3分钟（浏览器解码179.92秒，1440×1000；见[脱敏录像元数据](artifacts/verification/local-demo/summary.json)）。交付包文件为 `MiniAtoms-本地真实模型演示.webm` 及 `MiniAtoms-本地真实模型演示.zh-CN.srt` 字幕；视频不进入公开Git。录像覆盖v1生成→一次修改v2→恢复v3，共4次真实模型调用，另演示保存、筛选、刷新、导出和手机视图；不替代验收主链v1～v5或生产LIVE-11。

## 功能与边界

- 匿名身份、项目、对话、不可变源码版本、业务数据持久化。
- 两工具 Agent、SSE 阶段通知、最多两次修复、取消和超时。
- 对话修改失败保留旧成果；断线查询数据库结果。
- 历史恢复创建新版本，保留业务数据，并切换后续模型上下文。
- 预览 / 源码 / 历史、桌面 / 手机视图、单文件 HTML 导出。

生成范围：原生单页前端应用；不生成后端、React 工程、npm 依赖或任意网络调用。导出从空业务数据开始，不包含平台已有记录。

## 运行

Node 24.x、npm 11.x。新 checkout：

~~~powershell
npm.cmd ci
Copy-Item .env.example .env.local
# 在本地编辑 .env.local
npm.cmd run dev
~~~

打开 http://localhost:3000。空配置仍可构建，界面会提示缺少配置，不能真实生成。

| 配置 | 用途 |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | 项目地址及公开 key |
| SUPABASE_SERVICE_ROLE_KEY | 服务端事务权限，严禁暴露前端 |
| DEEPSEEK_API_KEY | 服务端模型调用 |
| DEEPSEEK_BASE_URL / DEEPSEEK_MODEL | 默认官方地址 / deepseek-flash |
| APP_ORIGIN | 精确工作台 Origin，本地 http://localhost:3000 |
| APP_COMMIT_SHA | 可选部署提交号；健康检查在空值时读取 Vercel Git commit |
| LLM_USER_DAILY_LIMIT / LLM_GLOBAL_DAILY_LIMIT | UTC 日调用名额，默认 20 / 100；0 暂停调用 |
| AI_TEST_MODE | 正常 off；fixture 仅允许本地开发测试 |

NEXT_PUBLIC_* 在构建时注入，更新后必须重新构建。密钥只放本地环境文件或服务商密钥界面。

## 数据库与部署

现有 Vercel 项目的逐项配置与验收入口见 [部署说明](docs/deployment.md)。

1. 创建 Supabase 项目，启用 Anonymous Sign-ins。
2. 依次执行 supabase/migrations 中 SQL；包括表、复合外键、RLS、列授权及服务端 RPC。
3. Vercel 使用仓库根、Node 24、npm ci、npm run build。生成/反馈/恢复 Route Handler 的 maxDuration=300，业务任务总上限 240 秒。
4. 生产和每个 preview 环境各配置精确 APP_ORIGIN；生产使用 HTTPS，不能开放通配 Origin。
5. 生产链接允许无需 Vercel/GitHub 登录的无痕访问，仍保留产品内匿名身份。
6. 用真实浏览器验证生成、数据操作和刷新；/api/health 只检查配置和 commit，不证明服务连通。

## 验证

~~~powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:sql
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run test:e2e:client
npm.cmd run build

# 需要可用 Docker；仅使用隔离的 miniatoms-test
npm.cmd run db:start
npm.cmd run db:reset:test
npm.cmd run test:integration
npm.cmd run test:e2e:workbench

# 有模型费用，不在默认 CI 中运行
npm.cmd run test:live
~~~

| 命令 | 证据边界 |
|---|---|
| test:unit | schema、哈希、SSE、认证、Agent、模型协议、接口契约 |
| test:sql | PGlite PostgreSQL 迁移/顺序断言；Auth 是显式 shim，不验证 Supabase Auth/REST/并发 |
| test:e2e | 真实 Chromium 的预览隔离、fixture 存储、启动错误和独立导出 |
| test:e2e:client | 真实 React/浏览器生命周期；Auth、HTTP、预览挂载为显式 fixture，验证断流与身份切换 |
| test:integration | 本地真实 Supabase 的权限、并发、事务与幂等 |
| test:e2e:workbench | 本地真实 Supabase + 实际 Next UI/API + 明确 DeepSeek HTTP fixture |
| test:live | 真实服务浏览器验收入口，缺配置明确失败，不跳过后宣称全绿 |

GitHub Actions 在临时 Linux Docker 中启动测试 Supabase，不使用生产密钥。测试重置脚本拒绝非本地地址和其他项目。

Linux 完整工作台测试使用 `xvfb-run -a npm run test:e2e:workbench`；后台标签页用例必须实际运行 headed Chromium 并观察可信 visibilitychange，不能以模拟 document.hidden 代替验收。

## 架构

React 工作台 → Next Route Handlers → DeepSeek / Supabase PostgreSQL。

生成 iframe → 受限 postMessage → 工作台存储适配器 → 鉴权 API。

服务器验证匿名 access_token 后，用用户 client 读取 RLS 数据；写入经管理 client 调用 RPC，事务再次校验 actor。客户端没有表写权限或管理 RPC 执行权。内部接口见 [RPC.md](supabase/RPC.md)。

数据库事务锁定项目，保证一个活动 Run、额度预留、基础版本校验和原子发布。候选提交同时更新版本、项目指针、消息和 Run；幂等重放不重复领取 worker。SSE 是通知，数据库是结果依据。

生成代码不在服务端执行。预览 sandbox 仅允许脚本和表单事件，无同源权限；CSP `form-action 'none'` 阻断表单导航，`connect-src 'none'` 阻断直接网络请求。表单通过 JS 接管 submit 并调用存储 SDK。存储接口仅绑定当前项目，不提供任意 URL、SQL 或用户选择器。

## 已知限制

- 启动检查不能证明业务正确，仍需真实操作验收。
- iframe 不是 CPU/内存硬隔离，无限循环可能阻塞页面；不承诺阻止所有自身导航。
- 清除匿名浏览器身份后没有账号找回功能。
- 多标签数据冲突需重新载入，不自动合并或覆盖。
- 关闭页面不保证后台继续；失败、取消、过期保留旧版本。
- 调用名额包含失败请求；正常生成通常两次，修复额外计数。
- file: 下 localStorage 因浏览器而异；不可用时明确显示内存模式，HTTP 下验证持久化。

后续：应用分享发布 → React 多文件与专用执行环境 → 全栈生成。

详见 [工程记录](docs/engineering-log.md)、[人工待办](docs/manual-todos.md)、[演示脚本](docs/demo-script.md)。

评审快速阅读：[项目简要说明](docs/project-brief.md)，包含用户场景、实现取舍、完成范围与后续优先级。
