# Assistant：首个可执行命令（Action create）

2026-09-30。基线 `8522c5c0ad60d3f562c86b4906e3ad47af60bf94` / `release-20260930-231409`；开发前本地、GitHub、CloudBase 源码一致。用户明确批准只接入统一 Action 的 create。

## 范围与兼容

- 独立路由 `#/assistant/actions/new`，使用现有登录与 `callFn`，人工从已有 Person 搜索结果中选择身份；不创建 Person。
- 新 `public.assistant_action_commands` 只允许服务端密钥访问。`public.assistant_action_command_v1` 将 plan、preview、confirm、execute 绑定真实登录 UID、服务器预览摘要和 15 分钟有效期；execute 锁定并重新检查 Person，事务内插入一条 `public.actions`，同一命令重试返回原 Action ID。
- 仅允许 Person 关联，支持 `action_type/title/description/due_at/priority`。本轮不关联 opportunity、interaction 或 activity。旧 Action/Today、Quick Capture、客户、增员、活动、回收站逻辑未改；Today 原有统一 Action 数据源会读取新 Action。
- 其他 create/update/close/delete 自然语言命令仍按原安全契约拒绝执行。无 AI 模型调用，无新模型配置；服务端数据库密钥沿用 `assistant` 既有配置，不写入仓库或浏览器。

## 迁移与回滚

迁移：`cloudbase/migrations/20260930233000_assistant_action_create.sql`。回滚：`cloudbase/rollbacks/20260930233000_assistant_action_create.sql`，仅当没有命令审计记录时允许删除新对象；已有 Action 和审计需要人工评估，回滚不会删业务 Action。迁移已在生产 `public` 应用；未触及其他 schema。

## 验证与剩余边界

- `tests/assistant/validate-action-command.sql` 使用明确标记的 Person，通过单条 DO 语句测试未确认拒绝、预览、确认、单次执行、重放和重复 Action 拦截，最后有意抛出 `ACTION_COMMAND_VALIDATED_ROLLED_BACK`，让整条语句回滚。随后只读核对 Person、Action、命令均为 0。
- `tests/assistant/action-create.cjs` 验证登录、结构化命令、字段限制、身份转发和数据库错误归一化。
- 离线浏览器回归检验页面必须依次选择 Person、规划、预览、确认、执行，前三步没有 Action 执行调用；同时回归旧页面。
- `npm test`：84 PASS / 0 FAIL / 5 SKIP；Assistant 定向测试 11 PASS；共享模块 56 份校验一致，模块化前端测试通过。
- 真实登录首次安全探针发现 CloudBase 网关返回 `DATABASE_23503` / `DATABASE_42501`，而适配器只识别原始 SQLSTATE，因而前端得到通用失败码；已在适配器归一化前缀，补充单测并重新部署。旧命令拦截在首次探针中正常。
- CloudBase 发布前源码核对：线上 `admin.html` SHA-256 一致；28 个函数、141 个源码/配置文件一致。新 JS/CSS 与线上静态文件 MD5/ETag 一致。
- 生产真实登录安全探针与发布后的 GitHub 核对结果记录于本轮最终报告。隔离 SQL 测试不等于真实用户端到端操作。
