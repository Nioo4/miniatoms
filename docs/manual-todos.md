# 人工前置事项

此清单只记录需要账户、凭证或用户身份信息的事项，不阻断独立开发。请通过本地环境文件或服务商密钥界面配置秘密，不在聊天或公开仓库粘贴。

| 事项 | 当前证据与用途 | 受影响验收 | 可以继续的工作 |
|---|---|---|---|
| DeepSeek key 与可用余额 | 本次进程未配置 DEEPSEEK_API_KEY；实际模型尚未调用 | LIVE-01..11 | Agent 与 fixture 验证 |
| Supabase 项目与匿名登录 | 未配置 URL、公开 key、service-role key；已实查控制台停在登录页。请用户完成登录/必要条款，并配置专用 MiniAtoms 项目及匿名登录 | LIVE-01..11 | 真实 Linux 本地 Supabase 已在 CI 完成 14 项数据库验收 |
| 修复 Docker Desktop 启动（仅本机开发需要） | backend 日志显示 initializing Inference manager 时无法移除本机残留 dockerInference socket；桌面进程立即退出，Linux engine pipe 不存在。仅清理该 socket 的操作被自动审批审查以 blocked by policy 拒绝，未执行；需用户通过 Docker 支持方式修复启动，勿重置已有数据 | 本机 Supabase 开发；CI 已可替代执行数据库与浏览器测试 | GitHub Actions Linux Docker 正常，D-01..14 已通过；不阻断远程 CI |
| Vercel 生产变量配置 | 已实查 nioo4's projects Hobby 会话有效，MiniAtoms 项目已创建并启动构建。仍缺 Supabase 三项变量及 DeepSeek key；其他非秘密配置由开发者完成 | LIVE-11、DEL-01 | 可部署无配置外壳、验证构建和公开网络访问 |
| 姓名、收到题目时间、最终提交 | 尚未提供，不推测截止时间或代发 HR | DEL-03 | 脱敏 README、演示脚本 |

公开源码已发布：[Nioo4/miniatoms](https://github.com/Nioo4/miniatoms)。真实模型验收和演示视频尚未完成；未配置后端的网页外壳不能算作可用 Demo。
