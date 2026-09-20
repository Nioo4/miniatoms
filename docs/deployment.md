# 生产配置与最终验收

当前项目已关联公开 GitHub 仓库的 main 分支，Vercel 会随 push 部署。生产地址为 https://miniatoms.vercel.app 。首次上线与构建成功不能代替真实生成验收。

## 1. Supabase 专用项目

在已登录的 Supabase 控制台创建或选择专用于 MiniAtoms 的项目。不要将测试 reset 命令指向此项目。账户条款、必要验证和数据库密码由本人处理。

当前专用项目已经完成三份迁移及匿名登录验证，不要重复执行初始化迁移或 reset。仅在配置全新空数据库时，依次执行 `supabase/migrations/202609200001_core.sql`、`202609200002_run_mutations.sql`、`202609200003_feedback_data.sql`，并在 Authentication 配置中启用 Anonymous Sign-ins。已有项目先核对迁移记录，只执行尚未应用的新增迁移；重新部署 Vercel 不需要重建数据库。前端使用项目公开 anon key，服务端使用 service-role key。管理员凭证不得用于任何 NEXT_PUBLIC_ 变量。

## 2. Vercel 环境变量

在 MiniAtoms 项目的 Settings → Environment Variables 中配置以下值，生产至少选择 Production。更新已有变量时保留其必要作用域；本次实际配置保留了 Production / Preview。导入页面自动检测到的空值不是可用配置，必须填写或纠正；不要在聊天或仓库中上传秘密。

| 变量 | 必须值 | Vercel 类型 |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | 专用 Supabase 项目的 HTTPS URL | **Config** |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 对应项目的公开 anon key | **Config** |
| SUPABASE_SERVICE_ROLE_KEY | 对应项目的服务端 key，仅服务端可用 | **Secret** |
| DEEPSEEK_API_KEY | 本人的可用 DeepSeek key | **Secret** |
| DEEPSEEK_BASE_URL | `https://api.deepseek.com` | Config；已有 Secret 可保持 |
| DEEPSEEK_MODEL | `deepseek-flash`；真实账户可用性必须实际验证，不静默降级 | Config；已有 Secret 可保持 |
| LLM_USER_DAILY_LIMIT | `20` | Config；已有 Secret 可保持 |
| LLM_GLOBAL_DAILY_LIMIT | `100` | Config；已有 Secret 可保持 |
| APP_ORIGIN | `https://miniatoms.vercel.app`（生产主域名，末尾没有斜杠） | Config；已有 Secret 可保持 |
| AI_TEST_MODE | 严格为 `off`，生产禁止 fixture | Config；已有 Secret 可保持 |
| APP_COMMIT_SHA | 留空时健康检查使用 VERCEL_GIT_COMMIT_SHA；不要填写陈旧提交号 | 如设置，可用 Config |

两条 `NEXT_PUBLIC_` 值会进入浏览器构建，必须使用 Config；公开 anon key 不能换成 service-role key。重复导入不会替代正确的更新操作：存在同名变量时编辑已有值，核对项目、环境作用域和值，避免重复创建。服务端凭证保持 Secret；其余非敏感变量没有必要仅为类型统一而重建。

本次控制台实测：旧的两条 `NEXT_PUBLIC_` 变量被建为 Secret，界面禁止直接改成 Config，也拒绝保存带公开前缀的 Secret。遇到此情况，先确认已安全掌握正确值、原作用域和重建计划，取得明确授权后，再删除错误条目并立即按相同作用域重建为 Config；不能只删除而留下缺项。本项目已按此方式修复两条公开变量，其余8项按已验证文件更新并保持 Secret。

预览部署需要独立的精确 APP_ORIGIN；即使变量保留 Preview 作用域，Production 主域名也不会自动适用于随机 preview URL。未配置对应 Origin 的预览不作为验收入口，不使用通配 Origin。修改 NEXT_PUBLIC_ 变量后必须重新构建部署，不能只重启函数。

## 3. 确认与验收

1. Redeploy 当前 main，目标选择 Production；本次公开变量类型和值修复后使用不复用 Build Cache 的重新部署，确认状态 Ready。
2. 无登录访问 `/api/health`：应为 HTTP 200、status=configured，commit 与目标提交一致。这仅证明变量有效，不证明数据库、模型实际连通。
3. 无痕进入首页，通过匿名登录创建一个真实项目；确认不会要求 Vercel 或 GitHub 账号。
4. 按 `docs/demo-script.md` 和 `docs/acceptance.md` 执行全部 LIVE 用例，包括三类应用、两轮修改、恢复后修改、刷新/重开、导出、访客隔离。
5. 当前自动化完整真实验收通过 GitHub Actions 的 **Real DeepSeek acceptance → Run workflow** 手动触发。它使用真实本地 Supabase、真实官方 DeepSeek 和浏览器，要求仓库加密 Secret `DEEPSEEK_API_KEY`；普通 push CI 仍使用 fixture。也可在具备隔离本地 Supabase 的机器上设置该密钥后运行 `npm run test:live:local`。默认额度保持每访客20次、平台100次，失败不退回调用名额。该套件读取本地数据库核对版本和用量，禁止指向生产数据库；生产 LIVE-11 另按上述公开链接完成验收。
6. 每条记录真实输入、步骤、实际输出、版本、耗时和截图；未执行仍记 NOT_RUN，前置条件缺失记 BLOCKED。已录制的约3分钟本地真实演示见 `docs/demo-script.md`，不能代替生产 LIVE-11。

本次配置修复后的 Production 部署为 `DUqqf4aFNFFqW1jtQxkXfZSdVCuH`，生产 `/api/health` 已实测 HTTP 200、`configured`，提交为 `91ccda8`。健康检查本身只证明配置与部署身份；随后独立[生产LIVE-11](../artifacts/verification/live-production-91ccda8/)已实际通过：全新浏览器匿名生成、添加任务、勾选完成、刷新持久化，2次真实模型调用。该结果不表示三类应用全套在生产重跑，也不替代姓名与最终提交。

本地 `.env.local` 已由样例创建且被 Git 忽略，便于本人安全填写同样的凭证。本地 APP_ORIGIN 保持 `http://localhost:3000`；本地与生产使用不同数据库时，不复制或合并真实业务数据。

已有专用远程项目时，可先在本地工作台验证真实服务：启动已配置 `.env.local` 的 `npm run dev`，在另一 PowerShell 中设置 `$env:LIVE_SUPABASE_PROJECT_REF='你的项目编号'`，运行 `npm run test:live:remote`。它显式校验项目身份，只读数据库证据，所有业务写入经真实UI进行；不会reset数据库。测试会创建虚构项目和匿名访客并消耗真实模型额度。该入口仍不替代公开Vercel的LIVE-11验收。
