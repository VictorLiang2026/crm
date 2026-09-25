# Provider-neutral AI Gateway 共享模块工作包

基线：`c6c8c65f04ba130babfd3be77732361e9b3d8227` / `release-20260925-195101`。改动前本地、GitHub、线上页面及 26 个 CRM 云函数的 108 个源码/配置文件一致。

本轮新增 `cloudfunctions/_shared/ai-gateway.js` 和隔离测试，增加 `npm run test:ai-gateway`，不改任何现有云函数入口、`db.js`、`ai.js`、数据库对象、权限、页面或路由。实现方式与接入边界见 `docs/architecture/ai-gateway.md`。回滚本轮仓库文件即可；云端业务产物未改变，无需云函数回滚。

权限事实：生产 `public.ai_tasks`、`ai_runs`、`ai_results` 已存在，均启用 RLS；`anon`、`authenticated` 无 SELECT，`service_role` 有 SELECT。Gateway 需要服务端特权 RDB，不能直接接现有匿名通道。本轮不配置或分发密钥，也不开放新权限。

验证：`npm run test:ai-gateway` 9 PASS / 0 FAIL，覆盖结构化结果与实际用量落库、临时错误逐次记录和重试、超时不重试、错误结果拒绝、审计故障停止、`AI_MODEL` 兼容回退、落库拒绝先于模型调用、schema 拒绝和固定表名。`node --check`、`git diff --check`、`npm run check:shared` 通过。完整旧功能离线回归在允许启动隔离浏览器的环境中为 57 PASS / 0 FAIL / 5 SKIP；首次受限进程环境中的浏览器启动超时，重跑后恢复通过。发布后云端一致性由发布流程再次核验。

未验证：CloudBase 真实模型调用、生产三表写入、真实服务端 API Key、用户确认流程。只读资源预检未发现有效 Token Credits 资源包；本轮没有真实 AI 用量或测试数据。共享模块尚未复制到任何业务函数，因此没有线上调用入口。

发布标签：`release-20260925-205614`。提交由发布脚本生成，发布后核对本地、GitHub 与云端产物。
