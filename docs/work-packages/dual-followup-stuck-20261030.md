# 双视角建议启动卡住修复

## 范围与基线

- 基线：GitHub `master` `0ee2e1fbbee7b5ca3c0394ee37663606ae79d947`；恢复时只回退本工作包提交，不回退该基线上的其他知识库发布。
- 发布前只读核对：线上 `admin.html`、92 个页面资源及 29 个 CRM 云函数的 231 份源码/配置与该基线一致。
- 影响范围：Console 双视角建议启动/状态轮询；`assistant` 的双视角任务状态查询。
- 数据范围：只读 `public.ai_tasks`、`public.ai_results`；不改表、权限、现有任务状态或客户数据，无数据库迁移。

## 行为

- 双视角启动响应 12 秒内未返回时，页面改为按 Person、任务类型、本次请求开始时间查询持久化任务；已存在的同 Person 运行任务也可继续跟踪。
- 新任务出现后，页面使用受登录态保护的现有任务状态接口。单次状态查询最多等待 10 秒，总等待最多 105 秒；超时会结束页面加载状态并显示现有超时提示。
- 客户摘要不启用启动恢复，保留原有启动与状态轮询行为。同步旧调用、AI 结果内容、双建议人工选择流程保持不变。

## 回滚

- 以本工作包提交的 revert 恢复 `assistant` 与三个 Console JS 文件，再按部署流程重新部署这些产物；保留基线 `0ee2e1fbbee7b5ca3c0394ee37663606ae79d947` 上的其他发布。
- 无数据库变更，无数据库回滚。

## 回归记录

- 定向异步/服务测试：11/11 通过；双视角浏览器回归：1/1 通过。
- 项目回归：108 PASS、0 FAIL、5 SKIP。
- 语法检查：`assistant/index.js`、`knowledge-library-service.js`、Console `data.js`、`dual-followup.js`、`ai-task-polling.mjs` 通过；`git diff --check` 通过。
- WP01 安全门：PASS_WITH_LIMITATIONS；目录校验 1184 项、匿名检查 78/78、WP04 身份审计与 WP02–WP06/PC34 检查通过。保留人工登录、service runtime 写入、线上业务写入及真实移动设备等既定未验证项。
- CloudBase code review：复核登录先于状态查询、任务查询绑定 `public.ai_tasks` 中的 Person/任务类型/请求时间，未增加数据库对象或权限。
- 部署：CloudBase `assistant` 函数更新成功；静态托管仅上传 `/crm/js/modules/console/data.js`、`dual-followup.js`、`ai-task-polling.mjs`，3/3 成功。
- 部署后云端比对：92 个页面资源及 29 个函数的 231 份源码/配置全部与本地基线一致。
- 线上 AI 探针：使用隔离 Edge 测试页登录成功，但 `assistant` 调用返回通用 `REQUEST_FAILED`；对应时间段无云函数调用日志，`public.ai_tasks` 对 Person 783 也无新任务。探针来自 `127.0.0.1`，因此失败原因尚不能归因到修复逻辑或模型网关；线上双视角结果尚未验证。随后通过 CloudBase 直接调用线上 `assistant` 的 `aiTaskStatus`，请求返回预期 `UNAUTHORIZED`（管理侧调用没有用户登录态），调用耗时 3ms，证明部署函数可执行；该检查没有访问 AI 任务或生成建议。未写入业务或 AI 任务数据。

