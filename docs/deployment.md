# 生产配置与最终验收

当前项目已关联公开 GitHub 仓库的 main 分支，Vercel 会随 push 部署。生产地址为 https://miniatoms.vercel.app 。首次上线与构建成功不能代替真实生成验收。

## 1. Supabase 专用项目

在已登录的 Supabase 控制台创建或选择专用于 MiniAtoms 的项目。不要将测试 reset 命令指向此项目。账户条款、必要验证和数据库密码由本人处理。

依次执行 `supabase/migrations/202609200001_core.sql`、`202609200002_run_mutations.sql`、`202609200003_feedback_data.sql`。在 Authentication 配置中启用 Anonymous Sign-ins；前端使用项目公开 anon key，服务端使用 service-role key。管理员凭证不得用于任何 NEXT_PUBLIC_ 变量。

## 2. Vercel 环境变量

在 MiniAtoms 项目的 Settings → Environment Variables 中配置以下值，作用域选择 Production。导入页面自动检测到的空值不是可用配置，必须填写或纠正；不要在聊天或仓库中上传秘密。

| 变量 | 必须值 |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | 专用 Supabase 项目的 HTTPS URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 对应项目的公开 anon key |
| SUPABASE_SERVICE_ROLE_KEY | 对应项目的服务端 key，仅服务端可用 |
| DEEPSEEK_API_KEY | 本人的可用 DeepSeek key |
| DEEPSEEK_BASE_URL | `https://api.deepseek.com` |
| DEEPSEEK_MODEL | `deepseek-flash`；真实账户可用性必须实际验证，不静默降级 |
| LLM_USER_DAILY_LIMIT | `20` |
| LLM_GLOBAL_DAILY_LIMIT | `100` |
| APP_ORIGIN | `https://miniatoms.vercel.app`（末尾没有斜杠） |
| AI_TEST_MODE | `off` |
| APP_COMMIT_SHA | 留空时健康检查使用 VERCEL_GIT_COMMIT_SHA；不要填写陈旧提交号 |

预览部署需要独立的精确 APP_ORIGIN；未配置的随机 preview URL 不作为验收入口，不使用通配 Origin。修改 NEXT_PUBLIC_ 变量后必须重新构建部署，不能只重启函数。

## 3. 确认与验收

1. Redeploy 当前 main，确认部署状态 Ready。
2. 无登录访问 `/api/health`：应为 HTTP 200、status=configured，commit 与目标提交一致。这仅证明变量有效，不证明数据库、模型实际连通。
3. 无痕进入首页，通过匿名登录创建一个真实项目；确认不会要求 Vercel 或 GitHub 账号。
4. 按 `docs/demo-script.md` 和 `docs/acceptance.md` 执行全部 LIVE 用例，包括三类应用、两轮修改、恢复后修改、刷新/重开、导出、访客隔离。
5. 可运行 `LIVE_BASE_URL=https://miniatoms.vercel.app npm run test:live` 的相应终端环境变量形式。该脚本会实际收费调用模型；现有自动化只覆盖生成 smoke 和部分看板操作，不能替代完整人工用例。
6. 每条记录真实输入、步骤、实际输出、版本、耗时和截图；未执行仍记 NOT_RUN，前置条件缺失记 BLOCKED。真实业务通过后再录制 3–5 分钟演示。

本地 `.env.local` 已由样例创建且被 Git 忽略，便于本人安全填写同样的凭证。本地 APP_ORIGIN 保持 `http://localhost:3000`；本地与生产使用不同数据库时，不复制或合并真实业务数据。
