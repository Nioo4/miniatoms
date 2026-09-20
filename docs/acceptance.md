# 验收记录

日期：2026-09-20。已发布 https://miniatoms.vercel.app，生产后端已配置，独立LIVE-11已通过。官方 DeepSeek 已完成真实连接与 plan_app 工具调用，HTTP 200 / deepseek-flash / 541 tokens / 1202ms；该smoke只证明连接；后续本地LIVE-01～10已按下述两组真实运行完成验收。代码层证据仍使用明确fixture。

## 已执行的证据

**最近完成的代码验收：PASS。** [完整 CI 35476530187](https://github.com/Nioo4/miniatoms/actions/runs/35476530187)，代码提交 `91ccda8c53766282ee9c15d4b09d756dfb652576`，Ubuntu / Node 24 / Chromium 153 / 本地 Supabase `http://127.0.0.1:54321`。104 单元、73 SQL 断言、15 Supabase 集成、19 预览浏览器、25 离线检查（21 录制源码回放 + 4 Run 等待回归）、18 客户端浏览器、15 完整工作台浏览器全部通过；lint、typecheck、无凭证生产构建通过。模型为 fixture；真实模型验收另行判断。后续测试定位调整不自动继承尚未完成的 CI 结果。

历史 f4ceebb 完整工作台的测试名称、耗时、Run/Version ID、数据 revision、原生后台事件及 6 张阶段截图已保留在 [脱敏 fixture 证据](../artifacts/verification/ci-35468543560/results.json)，避免只依赖有保留期限的 CI 下载文件。截图使用明确标识的本地模型 fixture，不能作为 DeepSeek 生成质量证明。主 agent 已检查桌面/手机生成、深色修改、恢复后的 6 张实际截图。

以下为历史检查过程，最新汇总以上述 CI 为准：

- Node 24.15.0 / npm 11.12.1 / Windows，类型检查、ESLint、无凭证生产构建通过。
- 单元测试：contracts、client、server、Agent、HTTP/RPC契约，结果以当前命令输出为准。
- `npm run test:sql`：PostgreSQL/PGlite 0.5.8，73 个断言 PASS；Auth shim，不是 Supabase Auth/REST/并发验收。
- `npm run test:e2e`：Chromium 153，13 项预览内核测试已逐项通过（新增正常表单、GET/POST 阻断、rejection/空页面、旧 iframe 消息），数据库是内存 fixture，模型调用 0。
- 无配置界面：1440px/390px 首页/项目/抽屉截图在 artifacts/screenshots；这只验证配置失败分支，不证明完整业务布局验收。
- `test:integration`：GitHub Actions [35465265115](https://github.com/Nioo4/miniatoms/actions/runs/35465265115)，commit 5408dd4，真实 Linux Supabase 14/14 PASS。该轮完整工作台 6 项均在候选发布处 FAIL；布局修正后待 CI 复验。本机 Docker 仍不可用。
- 后续 CI [35466774250](https://github.com/Nioo4/miniatoms/actions/runs/35466774250) / 680289f：70 单元、73 SQL 断言、13 预览、6 客户端生命周期、生产构建与真实 Supabase 14 项通过；完整工作台 11 项均因首次登录重建视图清空输入而 FAIL。该回归已在 f833c2a 修复，本地客户端生命周期 8/8 通过；完整工作台仍等待新一轮证据，不提前标 PASS。
- `test:live`：缺 LIVE_BASE_URL/真实服务配置明确退出失败，没有发起模型请求。

## 用例状态

PASS 只用于所列实际验证范围。NOT_RUN 表示完整用例尚未执行，括号中的局部证据不替代它。本轮 U/D/B 代码层结果已按 CI 和实际产物更新，LIVE 和交付项独立判断。

| ID | 状态 | 模式 | 实际证据 / 待完成 |
|---|---|---|---|
| U-01 | PASS | fixture | contracts.test.ts：未知字段、Unicode、JSON边界 |
| U-02 | PASS | fixture | contracts.test.ts：源码哈希与state规范化 |
| U-03 | PASS | fixture | server.test.ts：严格包装、语法、模块语句、闭合标签 |
| U-04 | PASS | fixture | client-sse.test.ts：UTF-8逐字节、CRLF、多行数据 |
| U-05 | PASS | fixture | contracts/server-agent：状态边、4调用/3write |
| U-06 | PASS | fixture | server.test.ts：错误工具、截断、参数、响应上限 |
| D-01 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-02 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-03 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-04 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-05 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-06 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-07 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-08 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-09 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-10 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-11 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-12 | PASS | fixture/real Supabase | 本轮集成验证start/feedback清理；expiry.spec另经实际Next GET返回timed_out、0调用、迟到worker applied=false |
| D-13 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| D-14 | PASS | fixture/real Supabase | CI 35468543560 / f4ceebb / integration.json（15项）实际通过 |
| B-01 | PASS | browser fixture | Chromium 153：parent DOM/cookie/localStorage 隔离，真实 fetch 与表单 GET/POST 均被 CSP 阻断，SDK 保存成功 |
| B-02 | PASS | browser fixture | 其他 window、跨 iframe 错误 channel、销毁后旧 iframe 均无写入 |
| B-03 | PASS | browser fixture | probe/history 的实际 setState 均只改临时副本，正式 state/revision 不变 |
| B-04 | PASS | browser fixture | 本轮预览覆盖 throw、awaited/unawaited rejection、空页面；完整工作台覆盖启动修复与三次失败，旧代码/数据保留 |
| B-05 | PASS | browser fixture | 本轮完整工作台：反馈提交后丢响应，GET确认并刷新恢复同一成功版本，不重复调用 |
| B-06 | PASS | browser fixture | 本轮真实 CAS、PUT 网络失败、超64KiB拒绝且保留输入；缩减后仅一次PUT成功、数据库revision+1 |
| B-07 | PASS | browser fixture | 本轮1440/390均完成生成、保存两条记录、修改、刷新、历史恢复，数据库和截图核对 |
| B-08 | PASS | browser fixture | 特殊闭合标签、file独立交互、HTTP刷新保存 |
| B-09 | PASS | browser fixture | 本轮真实旧frame发出的PUT延迟至新版本发布/切换项目后，409 ACTIVE_VERSION_CHANGED；两项目数据不变；预览套件另测销毁frame消息拒绝 |
| B-10 | PASS | browser fixture | 本轮独立headed Chromium/noDefaults + Xvfb，原生可信hidden/visible；后台8.5秒不反馈/不修复，前台同候选新channel通过，deadline不变 |
| B-11 | PASS | browser fixture | 本轮完整工作台：真实nonce故障，平台错误未消耗模型修复名额 |
| B-12 | PASS | browser client fixture | 本轮18项：首次登录前输入保留；同userId token刷新不清空输入、不卸载frame |
| B-13 | PASS | browser client fixture | 本轮18项：身份切换后历史销毁，旧创建/取消/消息/历史请求与初始化的成功/失败/finally不污染新视图 |
| B-14 | PASS | browser client fixture | 本轮18项：首段断流/首次GET失败、GET404继续确认、可取消、245秒终止确认、明确4xx不残留；不新建第二个Run |
| B-15 | PASS | unit/browser client fixture | 本轮outbox7项与React反馈链路：队列串行不丢、原body/id重传、数据变化换id重检、同步scope作废、GET确认成功后不再显示旧传输错误 |
| LIVE-01 | PASS | live | 2236e1a，真实生成；1440/390预览、表单及无横向溢出通过 |
| LIVE-02 | PASS | live | 2236e1a，看板CRUD、筛选统计、刷新及关闭重开持久化通过 |
| LIVE-03 | PASS | live | 2236e1a，公司搜索、深色修改与原数据保留通过 |
| LIVE-04 | PASS | live | 2236e1a，第二轮日期排序修改，搜索/深色/数据保留通过 |
| LIVE-05 | PASS | live | 2236e1a，历史查看、恢复为新版本及数据保留通过 |
| LIVE-06 | PASS | live | 2236e1a，恢复后继续修改，旧分支功能未错误复活通过 |
| LIVE-07 | PASS | live | 2236e1a，独立导出file/HTTP交互及HTTP刷新持久化通过 |
| LIVE-08 | PASS | live | ef591ce，独立真实运行：记账新增、月份筛选、收入支出结余、删除与刷新持久化通过 |
| LIVE-09 | PASS | live | ef591ce，独立真实运行：新增两习惯、完成与撤销、统计及刷新持久化通过 |
| LIVE-10 | PASS | live | ef591ce，独立真实运行：新建owner A看板与owner B记账/打卡；owner200/other404、工作台拒绝、切回原项目及数据隔离通过 |
| LIVE-11 | PASS | live production | 91ccda8；全新Chromium匿名访问、一次生成请求、任务新增/勾选完成/刷新持久化通过，2真实模型调用；不代表三类应用全套在生产重跑 |
| DEL-01 | PASS | delivery | 5b7c55a：无登录 Chromium 访问公开仓库 HTTP 200，生产 health commit 与源码一致；391 个 tracked 文件未包含当前配置凭证或私有题目文件，见 delivery-5b7c55a 证据。当时生产后端未配置；后续独立LIVE-11已在91ccda8通过 |
| DEL-02 | PASS | delivery | 本轮CI干净checkout执行npm ci/lint/typecheck/build，隔离Supabase迁移、权限和完整工作台测试通过 |
| DEL-03 | BLOCKED | delivery | 本地真实演示已录制；姓名及最终提交材料未完成 |

## 完成层级

- CODE_VERIFIED：最近通过代码提交91ccda8，CI35476530187；包含真实本地Supabase和明确模型fixture，不能代替LIVE。
- LIVE_VERIFIED：本地PASS，LIVE-01～07来自2236e1a，LIVE-08～10来自ef591ce；产品src与迁移树相同。并非单次全量运行PASS；生产LIVE-11在91ccda8独立PASS，不将其扩展为全套三类应用生产验收。
- DELIVERY_COMPLETE：尚未达到。

真实用例执行时追加：commit、URL/DB标识、完整输入与操作、实际结果、runId/versionId、耗时、截图/trace/日志。不得把两次模型输出拼成同一次成功证据。

首轮真实验收：[CI35469717734](https://github.com/Nioo4/miniatoms/actions/runs/35469717734)，[完整脱敏结果与生成物](../artifacts/verification/live-35469717734/live-results.json)。三类生成共6次官方调用、24637 tokens；整体FAIL。主agent已核对四张桌面/手机截图，测试定位问题不能作为业务已通过的依据，修正后必须重新进行真实操作。

远程数据库历史真实验收：[5f1ac89完整脱敏结果与生成物](../artifacts/verification/live-remote-5f1ac89/live-results.json)。localhost工作台、真实官方DeepSeek与专用远程Supabase；整体FAIL，LIVE-01/02/08通过。另有[1487d1f历史完整记录](../artifacts/verification/live-remote-1487d1f/live-results.json)，仅该轮LIVE-09通过；不能拼接不同轮次的结果宣布整轮成功。

**本地真实验收已分组通过。** [2236e1a主流程记录](../artifacts/verification/live-remote-2236e1a/live-results.json)保留LIVE-01～07同一看板v1～v5链；该运行整体FAIL的原始结论不改写。[ef591ce独立记录](../artifacts/verification/live-remote-ef591ce/live-results.json)只执行LIVE-08/09/10且全部PASS，01～07仍记NOT_RUN；独立运行新建真实模型owner A看板、owner B记账/打卡与匿名身份，不复用旧源码或身份。

[分组验收汇总](../artifacts/verification/live-acceptance-summary.json)核对两组产品src树均为 `9d8cde7575e9a3e2a00add876e3e5d3aafa201d6`，迁移树均为 `c53bc7c9639bece34f191cff43e2057fe42cf370`；变更限于测试helper、执行范围及文档。逐用例证据支持本地LIVE_VERIFIED，不宣称同一次全量PASS，不替代公开生产LIVE-11或交付验收。

代码回归补充：5f1ac89 / CI35472331715 曾完整工作台8 FAIL / 7 PASS；新增inert门槛使旧测试在初始化前fill返回却未输入。真实浏览器复现后，测试增加等待当前应用inert=false，业务断言不变；9f48138完整CI已复验15/15通过。

历史82a9ef6 / CI35474571826已SUCCESS；最新2236e1a / CI35474895178也已完整SUCCESS。

91ccda8 / CI35476530187已completed/success，为最新完整CODE_VERIFIED证据。

## 已录制的本地真实演示

交付检查补充：[DEL-01 证据](../artifacts/verification/delivery-5b7c55a/result.json)与[无登录仓库截图](../artifacts/verification/delivery-5b7c55a/anonymous-repository.png)。该项仅证明公开访问、所测提交部署一致性及公开文件边界；该历史结果不替代后续91ccda8独立生产LIVE-11。

约3分钟视频已录制，8个业务阶段PASS；浏览器解码时长179.92秒、1440×1000，已完成取样核查，见[脱敏录像元数据](../artifacts/verification/local-demo/summary.json)。交付包文件名 `MiniAtoms-本地真实模型演示.webm`，配套字幕随包提供；公开Git不保存视频或私有绝对路径。录像使用真实DeepSeek与远程Supabase，v1生成、一次修改v2、恢复v3共4次模型调用；保存两条虚构记录、筛选、刷新、独立导出及390px展示均实际操作。该独立演示不是v1～v5完整验收链，也不是生产LIVE-11。生产LIVE-11已另行通过；姓名、收题时间尚待用户回复，最终提交由本人处理，DEL-03及DELIVERY_COMPLETE不提升；最新已通过CI为91ccda8 / 35476530187。

## 独立生产 LIVE-11：PASS

[生产脱敏证据与截图](../artifacts/verification/live-production-91ccda8/)：https://miniatoms.vercel.app 的health为HTTP 200/configured、commit=91ccda8。全新Chromium 153.0.8010.12匿名访问后，一次真实生成请求产生2次模型调用（plan 1382 + write 5823 = 7205 tokens），Run `041bb8ae-e4d9-427f-ab23-c72899a78474` succeeded，ready v1 `5a843ce9-b116-41f7-999c-fd2339a5a5ac`，项目 `90400663-d3dc-4350-a3a1-d40305193fb9`。实际新增虚构任务、checkbox勾选完成、刷新后保持；数据库revision=2、done=true，刷新前后相同。

这项证据独立验证生产匿名生成与保存链，不声称三类应用全套在生产重跑。本地LIVE-01～10分组来源不变，本地演示视频也不是生产录屏。
