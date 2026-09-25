# AI Skill Registry 工作包

基线提交与回滚标签：`b1d6937aecfb24168fc21cfddb4e982337f4fac5` / `release-20260925-205614`。改动前本地、GitHub、线上页面及 26 个 CRM 云函数的 108 个源码/配置文件一致。

新增 10 个版本化 Skill 和 Ajv JSON Schema 校验；Gateway 默认按 Registry 校验输入、上下文及输出并记录 Skill 版本。新增依赖 `ajv`、`ajv-formats` 和离线测试；更新架构文档。未修改页面、历史 AI 云函数、数据库对象、权限或模型配置，也未部署新共享文件到任何函数。现有源码同步仍只治理 `db.js`、`ai.js`；本轮云端产物无变化。回滚只需恢复本轮 Git 文件，线上业务无需回滚。

验证：Skill Registry 测试 6 PASS；Gateway 测试 10 PASS，包含默认 Registry 接线、先验拒绝和版本审计。完整旧功能离线回归 `npm test` 为 57 PASS / 0 FAIL / 5 SKIP；`npm run check:shared` 确认原有 52 份副本一致，语法与 `git diff --check` 通过。依赖精确版本为 Ajv 8.20.0、ajv-formats 3.0.1；仓库既有约定忽略 `package-lock.json`，故以 `package.json` 固定这两个直接依赖。发布后云端一致性由发布脚本再次核验。未进行真实模型调用、生产数据库写入、真实上下文装配或人工确认 UI 测试。

发布标签：`release-20260925-230653`。提交由发布脚本生成；发布后核对本地、GitHub 与线上既有产物。
