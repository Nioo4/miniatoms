# 人工前置事项

此清单只记录需要账户、凭证或用户身份信息的事项，不阻断独立开发。请通过本地环境文件或服务商密钥界面配置秘密，不在聊天或公开仓库粘贴。

| 事项 | 当前证据与用途 | 受影响验收 | 可以继续的工作 |
|---|---|---|---|
| DeepSeek key 与可用余额 | 本次进程未配置 DEEPSEEK_API_KEY；实际模型尚未调用 | LIVE-01..11 | Agent 与 fixture 验证 |
| Supabase 项目与匿名登录 | 未配置 URL、公开 key、service-role key | LIVE-01..11 | SQL、RLS、事务、本地测试准备 |
| 修复 Docker Desktop 启动 | backend 日志显示 initializing Inference manager 时无法移除本机残留 dockerInference socket；桌面进程立即退出，Linux engine pipe 不存在。仅清理该 socket 的操作被自动审批审查以 blocked by policy 拒绝，未执行；需用户通过 Docker 支持方式修复启动，勿重置已有数据 | D-01..14、完整 Supabase fixture 浏览器链路 | 单元测试、独立浏览器预览、PostgreSQL WASM 迁移验证、生产构建 |
| Vercel 登录与项目权限 | 未发现 VERCEL_TOKEN，控制台会话尚未核实 | LIVE-11、DEL-01 | 部署配置与本地生产构建 |
| 姓名、收到题目时间、最终提交 | 尚未提供，不推测截止时间或代发 HR | DEL-03 | 脱敏 README、演示脚本 |

GitHub CLI 已有可用账户会话；尚未创建或发布仓库。在线链接、真实模型验收和演示视频均未完成。
