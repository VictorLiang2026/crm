# Assistant 命令安全契约

基线：`ac0ac8e0955802b8604479d7f2f7d40c153bd74e` / `release-20260930-221604`。

本轮只约束 AI Assistant 的变更命令，不接入任何业务写入执行器，也不修改旧页面的人工 CRUD、Quick Capture、AI Search 或七种既有 Intent Router 行为。页面、数据库结构、RLS 和密钥配置均不变；只需部署 `assistant` 函数。

## 强制流程

`Command → Plan → Preview → Confirm → Execute`。`create`、`update`、`close`、`delete` 不能因为自然语言指令直接执行。调用方必须显式提交结构化的 `action=command, stage=plan, command={operation,resource,targetId?,changes?}`；服务端检查操作、目标 ID、字段形状与大小，返回不可执行的计划，且不调用模型或读取/写入业务数据。

本阶段尚无具体资源的核实预览。`preview` 阶段返回 `VERIFIED_PREVIEW_REQUIRED`，`confirm` 返回 `SERVER_CONFIRMATION_REQUIRED`，`execute` 返回 `EXECUTOR_NOT_ENABLED`。客户端伪造 `confirmed:true`、预览状态、计划 ID 或确认令牌都不能改变结果；直接传 `action=create/update/close/delete` 会被拒绝。`pr_*` 资源与 SQL 控制字段也被拒绝。真实登录门槛位于命令分发之前。当前计划只列变更字段名，不回显输入内容。

这不是可执行的业务命令功能。未来逐个接入业务对象时，必须先由服务端读取目标当前状态并形成可核实的前后差异预览，将计划与预览绑定到登录身份和有效期，保存一次性人工确认，再在执行时重新检查权限、版本/并发与幂等性；每个对象的执行器仍需单独授权、实现和回归。不能把本轮 `status=planned` 当作已预览、已确认或已执行。

## 验证与发布

新增命令安全测试 5/5 通过，覆盖四种直接变更动作、结构化计划、自然语言/SQL/伪造确认拒绝及匿名身份拒绝。旧 Assistant 路由与 AI Search 合计 9/9 通过；完整离线回归 83 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、机会、Today、活动、增员与回收站。真实测试账号线上调用确认：旧 Assistant 路由仍正常；结构化删除只生成 `executable=false` 的计划；直接删除、伪造确认和执行分别返回 `COMMAND_PLAN_REQUIRED`、`SERVER_CONFIRMATION_REQUIRED`、`EXECUTOR_NOT_ENABLED`。本次未使用真实客户数据做写入测试，亦无业务写入入口。

无数据库 migration/rollback，因为没有数据库变更。回退本轮只需按发布前标签恢复 `assistant` 函数代码及本条契约；不需要回滚业务数据。
