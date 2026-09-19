# 工程记录

## 2026-09-20 — 初始化与并行实现

- 依据私有开发 Spec v1.0 建立独立 miniatoms 仓库目录；原题、联系方式、私有 Spec 留在父目录。
- Node 24.15.0 / npm 11.12.1。create-next-app 16.3.5 初始化成功。
- 主 agent 负责公共契约、预览内核、集成与验收；三个 GPT-6 Astra medium 子 agent 分别负责数据库、服务端、工作台。
- 初始化模板默认 React 19.2.8、Node 类型 20；按基线调整 React 19.3.0，并因 Vitest 5 peer constraint 将 @types/node 调整为 24。没有使用 --force/legacy-peer-deps。
- 当前缺真实服务配置，人工事项见 manual-todos.md；不将 fixture 或文档检查算作真实业务通过。
