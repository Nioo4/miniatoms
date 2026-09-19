# 人工前置事项

此清单只记录需要账户、凭证或用户身份信息的事项，不阻断独立开发。请通过本地环境文件或服务商密钥界面配置秘密，不在聊天或公开仓库粘贴。

| 事项 | 当前证据与用途 | 受影响验收 | 可以继续的工作 |
|---|---|---|---|
| DeepSeek key 与可用余额 | 本次进程未配置 DEEPSEEK_API_KEY；实际模型尚未调用 | LIVE-01..11 | Agent 与 fixture 验证 |
| Supabase 项目与匿名登录 | 未配置 URL、公开 key、service-role key；已实查控制台停在登录页。请用户完成登录/必要条款，并配置专用 MiniAtoms 项目及匿名登录 | LIVE-01..11 | 真实 Linux 本地 Supabase 已在 CI 完成 14 项数据库验收 |
| 修复 Docker Desktop 启动（仅本机开发需要） | backend 日志显示 initializing Inference manager 时无法移除本机残留 dockerInference socket；桌面进程立即退出，Linux engine pipe 不存在。仅清理该 socket 的操作被自动审批审查以 blocked by policy 拒绝，未执行；需用户通过 Docker 支持方式修复启动，勿重置已有数据 | 本机 Supabase 开发；CI 已可替代执行数据库与浏览器测试 | GitHub Actions Linux Docker 正常，D-01..14 已通过；不阻断远程 CI |
| Vercel 生产变量配置 | 已部署 https://miniatoms.vercel.app，2026-09-20最近健康检查报告f4ceebb、configuration_required。仍缺 Supabase 三项变量及 DeepSeek key；自动导入的非秘密变量也需按 deployment.md 填写。浏览器控制连接本轮重查仍不可用，暂不能继续控制台配置 | LIVE-11、DEL-01 | 公开HTTP与自动部署已验证；完整代码/fixture验收已通过 |
| 姓名、收到题目时间、最终提交 | 尚未提供，不推测截止时间或代发 HR | DEL-03 | 脱敏 README、演示脚本 |

公开源码已发布：[Nioo4/miniatoms](https://github.com/Nioo4/miniatoms)。真实模型验收和演示视频尚未完成；未配置后端的网页外壳不能算作可用 Demo。

具体配置步骤见 [生产配置与最终验收](deployment.md)。私有工作目录已准备题目提交草稿，姓名和视频等保留待填；不将题目副本发布到此仓库。

当前代码层证据：CI 35468543560 / f4ceebb 全部通过，包括15项真实本地Supabase集成和14项完整工作台测试。无需为了补配置重写产品或绕开权限；填写真实配置、重新部署后，继续执行尚未通过的LIVE验收。
