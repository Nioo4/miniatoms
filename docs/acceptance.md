# 验收记录

日期：2026-09-20。已发布 https://miniatoms.vercel.app；当前没有真实模型调用，生产显示后端待配置。所有模型/业务样例使用明确 fixture，不能宣称 LIVE 通过。

## 已执行的证据

- Node 24.15.0 / npm 11.12.1 / Windows，类型检查、ESLint、无凭证生产构建通过。
- 单元测试：contracts、client、server、Agent、HTTP/RPC契约，结果以当前命令输出为准。
- `npm run test:sql`：PostgreSQL/PGlite 0.5.8，73 个断言 PASS；Auth shim，不是 Supabase Auth/REST/并发验收。
- `npm run test:e2e`：Chromium 153，13 项预览内核测试已逐项通过（新增正常表单、GET/POST 阻断、rejection/空页面、旧 iframe 消息），数据库是内存 fixture，模型调用 0。
- 无配置界面：1440px/390px 首页/项目/抽屉截图在 artifacts/screenshots；这只验证配置失败分支，不证明完整业务布局验收。
- `test:integration`：GitHub Actions [35465265115](https://github.com/Nioo4/miniatoms/actions/runs/35465265115)，commit 5408dd4，真实 Linux Supabase 14/14 PASS。该轮完整工作台 6 项均在候选发布处 FAIL；布局修正后待 CI 复验。本机 Docker 仍不可用。
- 后续 CI [35466774250](https://github.com/Nioo4/miniatoms/actions/runs/35466774250) / 680289f：70 单元、73 SQL 断言、13 预览、6 客户端生命周期、生产构建与真实 Supabase 14 项通过；完整工作台 11 项均因首次登录重建视图清空输入而 FAIL。该回归已在 f833c2a 修复，本地客户端生命周期 8/8 通过；完整工作台仍等待新一轮证据，不提前标 PASS。
- `test:live`：缺 LIVE_BASE_URL/真实服务配置明确退出失败，没有发起模型请求。

## 用例状态

PASS 只用于所列实际验证范围。NOT_RUN 表示完整用例尚未执行，括号中的局部证据不替代它。远程 CI 结果确认后再更新。

| ID | 状态 | 模式 | 实际证据 / 待完成 |
|---|---|---|---|
| U-01 | PASS | fixture | contracts.test.ts：未知字段、Unicode、JSON边界 |
| U-02 | PASS | fixture | contracts.test.ts：源码哈希与state规范化 |
| U-03 | PASS | fixture | server.test.ts：严格包装、语法、模块语句、闭合标签 |
| U-04 | PASS | fixture | client-sse.test.ts：UTF-8逐字节、CRLF、多行数据 |
| U-05 | PASS | fixture | contracts/server-agent：状态边、4调用/3write |
| U-06 | PASS | fixture | server.test.ts：错误工具、截断、参数、响应上限 |
| D-01 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-02 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-03 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-04 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-05 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-06 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-07 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-08 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-09 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-10 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-11 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-12 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-13 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| D-14 | PASS | fixture/real Supabase | CI 35465265115 / commit 5408dd4 / integration.json 实际通过 |
| B-01 | PASS | browser fixture | Chromium 153：parent DOM/cookie/localStorage 隔离，真实 fetch 与表单 GET/POST 均被 CSP 阻断，SDK 保存成功 |
| B-02 | PASS | browser fixture | 其他 window、跨 iframe 错误 channel、销毁后旧 iframe 均无写入 |
| B-03 | PASS | browser fixture | probe/history 的实际 setState 均只改临时副本，正式 state/revision 不变 |
| B-04 | NOT_RUN | browser fixture | 启动throw已验证；完整Agent浏览器重试待CI |
| B-05 | PASS | browser fixture | CI 35465957126 / 2b0e022：反馈提交后丢响应，GET确认并刷新恢复同一成功版本，不重复调用 |
| B-06 | NOT_RUN | browser fixture | 保存失败、跨标签冲突完整用例待执行 |
| B-07 | NOT_RUN | browser fixture | 无配置1440/390外壳已检查；完整操作待CI |
| B-08 | PASS | browser fixture | 特殊闭合标签、file独立交互、HTTP刷新保存 |
| B-09 | NOT_RUN | browser fixture | 旧frame在版本切换后晚到写待执行 |
| B-10 | NOT_RUN | browser fixture | 后台节流与前台重检待执行 |
| B-11 | PASS | browser fixture | CI 35465957126 / 2b0e022：真实 nonce 故障，平台错误未消耗模型修复名额 |
| B-12 | NOT_RUN | browser client fixture | 延迟首次登录保留输入已通过；同 userId token 刷新完整证据待补 |
| B-13 | NOT_RUN | browser client fixture | 身份切换销毁历史和晚到初始化成功不解锁已通过；其他旧异步分支审查中 |
| B-14 | PASS | browser client fixture | f833c2a 本地 8 项中：首段断流/首次 GET 失败、GET 404 继续确认、可取消、245 秒终止确认、明确 4xx 不残留；不新建第二个 Run |
| B-15 | NOT_RUN | unit/browser client fixture | 队列、精确 body/id 重传与数据变化单元已通过；完整 React 反馈链路待核对 |
| LIVE-01 | BLOCKED | live | 缺真实服务；首次看板生成 |
| LIVE-02 | BLOCKED | live | 真实数据操作/刷新/重开 |
| LIVE-03 | BLOCKED | live | 搜索/深色修改 |
| LIVE-04 | BLOCKED | live | 第二轮日期排序修改 |
| LIVE-05 | BLOCKED | live | 历史恢复与数据保留 |
| LIVE-06 | BLOCKED | live | 恢复后继续修改 |
| LIVE-07 | BLOCKED | live | 真实生成物独立导出 |
| LIVE-08 | BLOCKED | live | 记账CRUD/1000-200=800 |
| LIVE-09 | BLOCKED | live | 习惯新增/打卡/撤销 |
| LIVE-10 | BLOCKED | live | 两访客/多项目隔离 |
| LIVE-11 | BLOCKED | live | 生产无痕访问与生成 |
| DEL-01 | NOT_RUN | delivery | 公开仓库及生产commit一致性 |
| DEL-02 | NOT_RUN | delivery | 干净checkout与隔离迁移完整验证 |
| DEL-03 | BLOCKED | delivery | 真实演示视频/姓名提交材料未完成 |

## 完成层级

- CODE_VERIFIED：尚未达到；真实 Supabase 已通过，完整 fixture 浏览器用例待修正后复验。
- LIVE_VERIFIED：尚未达到。
- DELIVERY_COMPLETE：尚未达到。

真实用例执行时追加：commit、URL/DB标识、完整输入与操作、实际结果、runId/versionId、耗时、截图/trace/日志。不得把两次模型输出拼成同一次成功证据。
