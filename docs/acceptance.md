# 验收记录

日期：2026-09-20。已发布 https://miniatoms.vercel.app，生产后端待配置。官方 DeepSeek 已完成真实连接与 plan_app 工具调用，HTTP 200 / deepseek-flash / 541 tokens / 1202ms；这只证明模型接入可用，不能替代完整 LIVE 验收。下列既有代码层证据使用明确 fixture。

## 已执行的证据

**最近完成的代码验收：PASS。** [完整 CI 35473020018](https://github.com/Nioo4/miniatoms/actions/runs/35473020018)，代码提交 `9f4813868e679aba423643327a48bb78171f6b59`，Ubuntu / Node 24 / Chromium 153 / 本地 Supabase `http://127.0.0.1:54321`。104 单元、73 SQL 断言、15 Supabase 集成、19 预览浏览器、15 录制源码离线回放、18 客户端浏览器、15 完整工作台浏览器全部通过；lint、typecheck、无凭证生产构建通过。模型为 fixture；真实模型验收另行判断。后续测试定位调整不自动继承尚未完成的 CI 结果。

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
| LIVE-01 | PASS | live | 9b612eb，真实模型生成；1440/390预览、表单及横向无溢出检查通过 |
| LIVE-02 | FAIL | live | 9b612eb，筛选与统计两个区域均有面试中按钮，测试未限定筛选区域而中断 |
| LIVE-03 | NOT_RUN | live | 前置未通过，当前轮搜索和深色修改未执行 |
| LIVE-04 | NOT_RUN | live | 前置未通过，当前轮日期排序修改未执行 |
| LIVE-05 | NOT_RUN | live | 前置未通过，历史恢复与数据保留未执行 |
| LIVE-06 | NOT_RUN | live | 前置未通过，恢复后继续修改未执行 |
| LIVE-07 | NOT_RUN | live | 前置未通过，真实生成物独立导出未执行 |
| LIVE-08 | FAIL | live | 9b612eb，收入合计/支出合计标签及统计卡中的笔数未被测试正确处理；完整操作中断 |
| LIVE-09 | PASS | live | 9b612eb，真实新增两习惯、完成1/2、撤销0/2和两次刷新持久化均通过 |
| LIVE-10 | NOT_RUN | live | 前置未通过，两访客/多项目隔离未执行 |
| LIVE-11 | BLOCKED | live | 生产无痕访问与生成 |
| DEL-01 | NOT_RUN | delivery | 公开仓库及生产commit一致性 |
| DEL-02 | PASS | delivery | 本轮CI干净checkout执行npm ci/lint/typecheck/build，隔离Supabase迁移、权限和完整工作台测试通过 |
| DEL-03 | BLOCKED | delivery | 真实演示视频/姓名提交材料未完成 |

## 完成层级

- CODE_VERIFIED：最近通过代码提交9f48138，CI35473020018；包含真实本地Supabase和明确模型fixture，不能代替LIVE。
- LIVE_VERIFIED：尚未达到。
- DELIVERY_COMPLETE：尚未达到。

真实用例执行时追加：commit、URL/DB标识、完整输入与操作、实际结果、runId/versionId、耗时、截图/trace/日志。不得把两次模型输出拼成同一次成功证据。

首轮真实验收：[CI35469717734](https://github.com/Nioo4/miniatoms/actions/runs/35469717734)，[完整脱敏结果与生成物](../artifacts/verification/live-35469717734/live-results.json)。三类生成共6次官方调用、24637 tokens；整体FAIL。主agent已核对四张桌面/手机截图，测试定位问题不能作为业务已通过的依据，修正后必须重新进行真实操作。

远程数据库历史真实验收：[5f1ac89完整脱敏结果与生成物](../artifacts/verification/live-remote-5f1ac89/live-results.json)。localhost工作台、真实官方DeepSeek与专用远程Supabase；整体FAIL，LIVE-01/02/08通过。另有[1487d1f历史完整记录](../artifacts/verification/live-remote-1487d1f/live-results.json)，仅该轮LIVE-09通过；不能拼接不同轮次的结果宣布整轮成功。

最新真实轮次为[9b612eb完整记录](../artifacts/verification/live-remote-9b612eb/live-results.json)：LIVE-01/09 PASS；LIVE-02/08 因语义定位不足中断，依赖步骤NOT_RUN，整体FAIL。16384输出预算已被真实API接受，但第二轮修改尚需复验。历史[9f48138完整记录](../artifacts/verification/live-remote-9f48138/live-results.json)中LIVE-01/02/03/08 PASS，LIVE-04输出截断后v2保持不变；[9bbf4ee记录](../artifacts/verification/live-remote-9bbf4ee/live-results.json)须连同[人工复核](../artifacts/verification/live-remote-9bbf4ee/manual-review.json)阅读，不拼接跨轮次结果。

代码回归补充：5f1ac89 / CI35472331715 曾完整工作台8 FAIL / 7 PASS；新增inert门槛使旧测试在初始化前fill返回却未输入。真实浏览器复现后，测试增加等待当前应用inert=false，业务断言不变；9f48138完整CI已复验15/15通过。
