# 跟进建议生成可靠性修复

日期：2026-11-04

## 变更

- 生成 CloudBase 系统建议时，从候选知识来源中排除已确认登记为测试数据的来源；保留的正常来源继续参与策略及产品/服务建议生成。
- provenance 聚合结果或逐条核验无法确认时继续 fail-closed，不调用模型、不保存建议。
- 当异步生成在创建 AI task 前已失败，状态查询现在会读取本次启动时间之后创建的建议记录，返回失败或完成状态，避免界面持续显示“生成中”。
- 前端保留服务端错误码，以中文/英文显示相应的安全核验、测试输出和任务状态提示。

## 影响范围与兼容

- 页面：人物详情中的跟进建议模块。
- 接口：`assistant` 的 `knowledgeLibrary/adviceGenerate` 和 `aiTaskStatus`；保持请求/响应的现有字段，不新增路由。
- 数据：只读取 `public.knowledge_items` provenance，并查询现有 `public.person_followup_advice` 记录；不修改业务数据、schema、权限或 RLS。
- 兼容：没有新建议记录的启动过程继续返回 pending；已有 AI task 的状态逻辑保持原样。只过滤经登记确认的测试知识；不能确认来源安全性时仍拒绝生成。
- 回滚：从本轮发布标签恢复 `assistant` 与三个前端模块，再按项目流程发布恢复提交；无需数据库回滚。

## 验证

- `npm run test:knowledge-library`：87/87 通过，覆盖测试知识来源筛除、provenance fail-closed、异步创建任务前失败状态、错误码透传及中英文界面。
- `npm run test:wp01`：完整回归通过，隔离回归 108 PASS / 0 FAIL / 5 SKIP；权限/结构目录 1,248 项通过；匿名探针 81/81 通过；发布门槛 `PASS_WITH_LIMITATIONS`。门槛列明登录、service runtime、生产写入及 mobile 仍未验证。
- CloudBase 共享文件副本检查通过（60 份）；发布后全量云端核对通过（30 个 CRM 函数 / 243 个源码与配置文件、96 个页面静态资源与本地一致）。
- 生产 Person 800：部署后只读检查仍只有既有失败记录 `public.person_followup_advice#5`（`system_status=failed`，无 task id）；尚未通过真实 CRM 登录会话触发。CloudBase 管理端调用不携带 CRM 用户身份，不能代替用户登录态验证；未伪造 actor 或直接写表。

## 部署范围

- Cloud Function：`assistant`。
- 静态模块：`crm/js/modules/console/data.js`、`crm/js/modules/console/followup-advice.js`、`crm/js/modules/console/i18n.js`。
- 不上传 `admin.html`、未变化的业务文件或整个项目目录。
