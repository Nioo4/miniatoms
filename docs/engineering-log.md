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

## 2026-09-20 — 首次身份初始化回归

- CI 35466774250 / 680289f：代码 job 全部通过（70 单元、13 预览、6 React 生命周期、73 SQL断言、生产 build），真实 Supabase 14 项通过；完整工作台 11 项均 FAIL，全部在首页开始按钮前终止，没有进入生成。
- 失败截图和网络日志确认：输入框在异步首次匿名登录完成时被清空，只有项目 GET，没有项目创建 POST。身份切换隔离以 identity 作为组件 key，错误地将首次初始化也视作换号重建。修复需保留首次登录前输入，只在已建立身份后发生真正变化时清空，同时仍阻止旧身份请求回写；不得通过让测试延后输入掩盖产品问题。
- 生产已自动更新至 680289f，HTTP health 返回同一提交号且仍为 configuration_required。完整业务验收未通过，不升级 CODE_VERIFIED。

## 2026-09-20 — 真实链路复验与竞态补测

- CI 35467916172 / f833c2a：代码 job 通过，真实 Supabase 14 项通过，完整工作台 12/13 通过。两种尺寸下生成、真实数据写入、修改、刷新、历史恢复全部通过；唯一失败 B-10 尚未进入 hidden，不能将其写成后台验收通过。
- B-10 根因在测试环境：Playwright 默认启用 focus emulation，在普通 launch 创建的页面中，另开 CDP session 设置 false 不能解除原 session 的模拟。使用独立测试 profile 启动 Chromium，通过官方 `connectOverCDP({noDefaults:true})` 连接默认 context；本地独立诊断已观察到原生 hidden/visible 和 isTrusted=true。完整工作台仍待 Linux Xvfb CI。依据：[Playwright noDefaults](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp-option-no-defaults)，以及本地锁定版本 coreBundle 中默认 setFocusEmulationEnabled 的调用。
- Astra medium 补测先复现旧创建/取消/消息/历史请求在访客切换后污染新视图，再加作用域守卫；已提交但反馈响应丢失时，以 GET 的新终态/候选清除旧网络错误。保留真实身份切换隔离与首次登录输入。
- 增强 D-01：先证明 INSERT fixture 满足数据库约束，再明确断言权限错误；新增有效 UPDATE 拒绝和数据不变。D-09 分别独立验证 global/user 限制，避免另一个限制掩盖失效。新增真实 Next GET 触发过期清理的用例。
- 本地静态检查、83 单元、14 预览内核浏览器用例通过；新增未 await rejection、cookie 读取拒绝、全部请求边界和非法工具参数分支。完整工作台补充超限后缩减保存和三阶段截图；截图与报告明确标为 fixture，报告使用真实 Git SHA。

## 2026-09-20 — 代码层完整验收通过

- CI 35468543560 / f4ceebbc953338619f14a6fe5ef6b7ce6ec04040 两个job全部成功：84单元、73 SQL断言、15真实Supabase集成、14预览、18客户端、14完整工作台；静态检查及生产build通过。最后增加的第84项验证React清理前旧feedback队列也会因同步scope失效而停止。
- 主agent下载并核对日志、integration.json及完整工作台报告，检查6张1440/390截图。B-10附件实际记录可信hidden/visible、8500ms后台观察、两个不同probe channel、同候选与2次模型fixture调用；D-12真实GET附件记录timed_out、0调用、旧worker被拒绝。脱敏结果及截图长期保存于artifacts/verification/ci-35468543560。
- CODE_VERIFIED成立，LIVE_VERIFIED和DELIVERY_COMPLETE仍不成立。Vercel已自动部署f4ceebb，公开HTTP health仍是503 configuration_required、database/model均false；不能把上线外壳作为可用真实Demo。缺配置和视频/个人材料继续保留在人工清单。

## 2026-09-20 — 官方模型接入与真实验收通路

- 用户通过仓库外的私有文件提供官方 DeepSeek 凭证，并明确要求真实模型验收。凭证仅写入被忽略的本地环境文件和 GitHub 加密 Secret；不进入源码、报告或命令参数。
- 官方 deepseek-flash / thinking disabled / plan_app 强制工具调用真实返回 HTTP 200，用量541 tokens、耗时1202ms。它是连接验证，不计为完整应用验收。
- 新增仅 workflow_dispatch 可触发的真实验收：Linux 真实 Supabase + Next UI + 官方 DeepSeek，默认20/100额度。浏览器实际操作看板、记账、打卡、连续修改、恢复、导出与隔离；逐条记录 PASS/FAIL/NOT_RUN，生产 LIVE-11 单独判定。原有自动push CI继续使用fixture。
- 审查修正测试本身的 Run 路由假404、重开页面后截图指向旧页、导出失败文件可能进入公共artifact等问题。真实测试执行结果待 CI，不因脚本存在或静态检查通过而提升验收状态。

## 2026-09-20 — 真实输出与远程数据库联调

- 首轮真实CI35469717734：看板、记账、打卡均真实生成，合计6调用24637 tokens。完整业务整体FAIL：控件文案及统计定位过窄，证据保留在artifacts/verification/live-35469717734。后续测试允许应聘岗位、金额（元）、今天已完成等实际语义，业务数值断言保留；空数据要求显式写入需求。
- 用户提供专用远程Supabase配置，修正控制台URL为API URL后，PG连接/管理密钥/匿名登录逐项实际验证。空库预检后事务应用3份迁移，保留标准迁移历史；7表RLS、11RPC及列权限验证通过，无reset/drop。本地工作台已接入真实远程数据库。
- 本地真实运行1338717发现冷页面hydration前输入被清空。独立延迟Next JS复现，修复为React接管前禁用输入，接管后认证等待期间允许输入。真实Next延迟JS/认证回归及18项客户端回归通过。
- 同轮记账真实生成2次调用8702 tokens，但js只声明async function main而未执行初始化，HTML非空让基础检查通过，控件没有事件。该结果不算业务通过。将顶层main绑定声明和不受沙箱支持的原生模态弹窗调用加入AST协议检查，错误进入既有有限修复流程；不自动执行或重写模型代码。测试操作增加15秒超时，避免缺失选项导致整个套件长时间等待。
- 真实远程2cf3f53复验：LIVE-01/02通过，完成看板CRUD、筛选统计、刷新与重开。LIVE-03实际截图为深色，但测试只检查body浅层，已改按真实可见背景采样；LIVE-08发现生成CSS display:flex覆盖hidden使遮罩阻断操作，公共外壳添加hidden基础规则，预览/导出两条先红后绿回归及全部16条预览通过。LIVE-09统计为整句“今天已完成1/2个习惯”，测试兼容整句仍严格核对1/0及分母2。整体验收仍FAIL。
- 证据管理问题：执行默认preview测试时，其默认根输出目录清理了上述本地live截图，未伪造恢复。执行结果保留于会话工具日志及远程版本数据，截图标记缺失。修正preview输出为独立子目录；remote live runner在每次完整结束后自动归档到被忽略的private目录。下一轮重新执行完整真实验收并保存证据。

## 2026-09-20 — 匿名登录复查与真实打卡验收

- 用户确认启用匿名登录后再次实测：schema/admin/anonymousLogin 均 HTTP 200，isAnonymous=true；PostgreSQL 连接成功且 projects 表存在。探测创建的空匿名账户已清理，正式验收项目保留。
- 1487d1f 远程真实模型验收中 LIVE-09 PASS：新增阅读和运动，完成阅读后统计1/2，刷新仍为1/2，撤销后0/2，再刷新仍为0/2。主 agent 检查实际截图、ARIA 和数据库证据；不据此提升其余用例状态。
- 同轮 LIVE-01 因按钮实际名称“＋ 新增投递”与定位表达式不兼容而 FAIL；LIVE-08 因“类型”和“类型筛选”同时匹配宽泛定位而 FAIL；依赖步骤 NOT_RUN，整体仍 FAIL。真实生成源码、用量、界面和结果已通过凭证扫描并保留于 artifacts/verification/live-remote-1487d1f；原始输出另自动归档至忽略的 private 目录。
- Vercel 所需10项生产环境变量已整理在仓库外的私有文件，等待导入 Production 并重新部署；文件不包含数据库密码，不能提交到 Git。
- CI35471342619/1487d1f 完成且两个 job 全绿：104单元、73SQL断言、15真实Supabase集成、16预览、18客户端、15完整工作台；lint/typecheck/无凭证生产构建通过。模型仍为 fixture。

## 2026-09-20 — 真实初始化竞态

- 8b6757f 真实复验三类业务均 FAIL，证据已扫描并保存于 artifacts/verification/live-remote-8b6757f。看板实际存在内联表单；离线回放又证实包装label的原始文本含前导换行，ARIA归一化后可读但原有getByLabel正则匹配失败。定位同时补齐前后空白和真实初始化等待，不能简单归因于按钮文案或只归因于启动时序。
- 同轮记账的初始化 await 存储后才绑定 onchange，过早勾选收入后分类仍停留在支出；习惯首次输入也在初始化期间丢失，最终仅保留第二项运动。正式 iframe 可见不代表生成应用已可交互，属于真实用户也可能触发的启动时序缺口。
- 修复方案为所有生成应用根节点初始 inert，主脚本初始化与启动观察完成后才开放交互；沿用真实错误上报、原有8秒窗口和隔离边界。验收等待平台自身的启动完成状态，不用固定 sleep 掩盖竞态。录制的真实生成物仅用于离线定位回归时必须标记 fixture，不得算作新一轮真实模型通过。
- 修复后同轮完整19项预览和104项单元测试通过；9份历史真实源码的离线控件回放通过，接入普通CI且不调用模型。早期记账源码使用被禁止的原生confirm，离线回放明确只验证新增、标注删除限制；不能追认为旧真实验收通过。
- 后台成功初始化允许解除交互锁，但不发送后台preview.ready；候选仍沿用前台重检。该新增active/history/export后台解锁分支未单独做原生后台验收，不混用既有B-10候选后台证据。

## 2026-09-20 — 看板与记账真实操作通过

- 5f1ac89 真实完整复验：LIVE-01/02/08 PASS，主agent检查手机表单、桌面看板CRUD结果和实际深色修改截图。LIVE-03 FAIL为真实主题不完整：模型仅将卡片变暗，声明背景变量却未应用，整体画布仍白色；不降低颜色断言，不手改生成物，补充通用主题生成指引再走真实模型。
- LIVE-09 FAIL为测试遗漏“新增习惯”标签；其余依赖步骤NOT_RUN，整体仍FAIL。扩展明确的等价标签并限制为真正输入控件，避免删除按钮的aria-label被误认。脱敏完整证据保留于artifacts/verification/live-remote-5f1ac89。
- 390px截图的手机tab底色与显示区域看似不一致，源码二者由同一状态生成；尚未确认是否捕获时序或视觉状态问题，保留待复查，不据截图推测修改产品。
