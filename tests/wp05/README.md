# WP05 复跑

`npm run test:wp05` 运行 6 项只读服务夹具与 2 项隔离浏览器场景，含 360/390/768px 布局、旧编辑入口、失效/重试及测试数据联系禁用。Windows 浏览器使用 C 盘临时目录。没有真实业务写入。

`npm run test:wp01` 同时纳入上述检查；权限和 WP04 身份快照按 WP01 README 重新采集。任何失败阻断发布。

真实账号：先运行 `node tests/wp03/live.cjs`，由用户在隔离窗口登录 prtest，不收集密码、不修改登录超时。新模块必须在此服务启动前存在。

`node tests/wp05/live.cjs` 仅展示 dry-run、打开旧编辑框后取消；`node tests/wp05/live.cjs --save` 仅在 WP05 专项已批准后使用。它核对已登记场景、固定虚构姓名和空联系方式，通过原 UI 保存 occupation=`【系统测试·勿联系】虚构资料验收职业`，核对其他资料未变、往返刷新及 10/2/3 计数。无新增业务行或 AI 调用。报告保存在被忽略的 `tests/security/.results/wp05-live.json`；不是实体手机验收。

若失败立即停止，保留报告，不重复写入。必要时按报告 dryRun.before，在同一旧表单恢复职业；不得直接批量回滚数据。
