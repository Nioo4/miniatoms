# 人工前置事项

此清单只记录需要账户、凭证或用户身份信息的事项，不阻断独立开发。请通过本地环境文件或服务商密钥界面配置秘密，不在聊天或公开仓库粘贴。

| 事项 | 当前证据与用途 | 受影响验收 | 可以继续的工作 |
|---|---|---|---|
| DeepSeek 生产环境配置 | 已完成Vercel Secret配置；生产LIVE-11真实plan/write共7205 tokens通过 | LIVE-11已PASS | 后续密钥轮换按部署说明处理 |
| Supabase 生产环境接入 | 迁移、匿名登录与生产真实读写已通过；任务完成状态刷新后保持，revision=2 | LIVE-11已PASS | 不重复初始化或reset |
| 修复 Docker Desktop 启动（仅本机开发需要） | backend 日志显示 initializing Inference manager 时无法移除本机残留 dockerInference socket；桌面进程立即退出，Linux engine pipe 不存在。仅清理该 socket 的操作被自动审批审查以 blocked by policy 拒绝，未执行；需用户通过 Docker 支持方式修复启动，勿重置已有数据 | 本机 Supabase 开发；CI 已可替代执行数据库与浏览器测试 | GitHub Actions Linux Docker 正常，D-01..14 已通过；不阻断远程 CI |
| Vercel 生产变量配置 | 两条NEXT_PUBLIC为Config，服务端凭证为Secret；Production重部署后health200 configured/91ccda8，真实业务LIVE-11 PASS | LIVE-11、DEL-01已PASS | 保持精确APP_ORIGIN，后续变更重新验证 |
| 姓名、收到题目时间、最终提交 | 已向用户询问，尚未收到答复；最终提交待本人处理，不推测截止时间或代发HR | DEL-03 | 已准备脱敏文档、本地真实视频和证据 |

公开源码已发布：[Nioo4/miniatoms](https://github.com/Nioo4/miniatoms)。本地真实模型业务验收已分组完成；生产独立LIVE-11也已通过；本地真实演示已录制，最终提交仍待本人处理。

具体配置步骤见 [生产配置与最终验收](deployment.md)。私有工作目录已准备题目提交草稿，姓名等保留待填，视频已录制并准备交付包；不将题目副本发布到此仓库。

最近完成的代码层证据：[CI 35476530187 / 91ccda8](https://github.com/Nioo4/miniatoms/actions/runs/35476530187) 全部通过，包括104单元、73 SQL断言、15真实本地Supabase集成、19预览、25离线检查（21录制源码回放+4 Run等待回归）、18客户端、15完整工作台测试。

本地LIVE_VERIFIED已达到：[2236e1a主流程](../artifacts/verification/live-remote-2236e1a/live-results.json)的01～07与[ef591ce独立运行](../artifacts/verification/live-remote-ef591ce/live-results.json)的08～10逐用例通过，产品src及迁移树一致，详见[分组汇总](../artifacts/verification/live-acceptance-summary.json)。这不是同一次全量PASS。生产独立[LIVE-11证据](../artifacts/verification/live-production-91ccda8/)已通过；剩余事项为姓名、收到题目时间及本人最终提交；DELIVERY_COMPLETE尚未达到。约3分钟本地真实演示已录制，交付包为 `MiniAtoms-本地真实模型演示.webm` 及 `MiniAtoms-本地真实模型演示.zh-CN.srt` 字幕；最终时长见[脱敏元数据](../artifacts/verification/local-demo/summary.json)。公开仓库不包含视频；录像只覆盖v1→v2→恢复v3和4次真实模型调用，不是生产LIVE-11。
