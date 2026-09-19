# 人工前置事项

此清单只记录需要账户、凭证或用户身份信息的事项，不阻断独立开发。请通过本地环境文件或服务商密钥界面配置秘密，不在聊天或公开仓库粘贴。

| 事项 | 当前证据与用途 | 受影响验收 | 可以继续的工作 |
|---|---|---|---|
| DeepSeek 生产环境配置 | 用户已提供官方 API 凭证；本地忽略环境文件及 GitHub 加密 Secret 已配置。真实 deepseek-flash 工具调用 HTTP 200，541 tokens，尚未配置到 Vercel | LIVE-11 | 本地LIVE-01～10已分组通过；生产LIVE-11仍需配置，普通CI不消耗模型额度 |
| Supabase 生产环境接入 | 已收到配置，项目API、管理密钥、PG连接和匿名登录均真实验证PASS；三份迁移及权限验证完成。本地工作台已接入此项目，Vercel变量尚需配置 | LIVE-11、DEL-01 | 本地真实浏览器验收已分组通过，继续生产配置与LIVE-11 |
| 修复 Docker Desktop 启动（仅本机开发需要） | backend 日志显示 initializing Inference manager 时无法移除本机残留 dockerInference socket；桌面进程立即退出，Linux engine pipe 不存在。仅清理该 socket 的操作被自动审批审查以 blocked by policy 拒绝，未执行；需用户通过 Docker 支持方式修复启动，勿重置已有数据 | 本机 Supabase 开发；CI 已可替代执行数据库与浏览器测试 | GitHub Actions Linux Docker 正常，D-01..14 已通过；不阻断远程 CI |
| Vercel 生产变量配置 | 导入所需10项变量已备妥于仓库外私有vercel-production.env，待导入Production并重新部署。Supabase schema/admin/匿名登录/PG均通过；最新生产health实测503 configuration_required，commit=5b7c55a，databaseConfigured/modelConfigured均false。浏览器控制连接仍不可用，暂不能继续控制台配置 | LIVE-11、DEL-01 | 代码及本地真实业务验收已通过，整理交付材料 |
| 姓名、收到题目时间、最终提交 | 尚未提供，不推测截止时间或代发 HR | DEL-03 | 脱敏 README、演示脚本 |

公开源码已发布：[Nioo4/miniatoms](https://github.com/Nioo4/miniatoms)。本地真实模型业务验收已分组完成；生产验收尚未完成；本地真实演示已录制；未配置后端的网页外壳不能算作可用 Demo。

具体配置步骤见 [生产配置与最终验收](deployment.md)。私有工作目录已准备题目提交草稿，姓名等保留待填，视频已录制并准备交付包；不将题目副本发布到此仓库。

最近完成的代码层证据：[CI 35475465477 / ef591ce](https://github.com/Nioo4/miniatoms/actions/runs/35475465477) 全部通过，包括104单元、73 SQL断言、15真实本地Supabase集成、19预览、25离线检查（21录制源码回放+4 Run等待回归）、18客户端、15完整工作台测试。

本地LIVE_VERIFIED已达到：[2236e1a主流程](../artifacts/verification/live-remote-2236e1a/live-results.json)的01～07与[ef591ce独立运行](../artifacts/verification/live-remote-ef591ce/live-results.json)的08～10逐用例通过，产品src及迁移树一致，详见[分组汇总](../artifacts/verification/live-acceptance-summary.json)。这不是同一次全量PASS。剩余事项为生产配置/无痕真实LIVE-11、姓名及最终提交材料；DELIVERY_COMPLETE尚未达到。约3分钟本地真实演示已录制，交付包为 `MiniAtoms-本地真实模型演示.webm` 及 `MiniAtoms-本地真实模型演示.zh-CN.srt` 字幕；最终时长见[脱敏元数据](../artifacts/verification/local-demo/summary.json)。公开仓库不包含视频；录像只覆盖v1→v2→恢复v3和4次真实模型调用，不是生产LIVE-11。
