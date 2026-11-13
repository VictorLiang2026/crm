# 活动标题与编号显示发布记录

日期：2026-11-13（Asia/Shanghai）
基线：`d0abdd2beb891ae016ab22571e55d9d152673aed`（`release-20261113-091744`）
目标环境：`crm-d1gkae8ddc930d151`

## 范围

- Console 活动详情标题显示活动实际名称和活动编号；标题数据复用详情读取结果。
- 筹备任务新增/编辑抽屉、Legacy 活动跟进弹窗及保存提示显示活动名称和编号。
- 从 AI 搜索活动证据引用补充只读活动名称，仍显示活动编号；查询只选择 `public.activities.id,name`，过滤已软删除记录，不改数据库结构和权限。
- 新界面文案加入 Console 中英文 i18n 字典。
- 没有数据库 migration、rollback、权限或业务数据变更。

## 验证

- 变更 JS 和测试文件 `node --check`：通过。
- assistant 搜索服务与 iPad 中英文浏览器回归：17 项通过。
- WP04 公开身份审计及离线回归：通过；参与者独立花名册规则符合当前语义。
- WP01：`PASS_WITH_LIMITATIONS`，无阻断；目录快照 1,514 项检查通过，匿名只读探针 104/104 通过，隔离回归 102 项通过、5 项历史预设跳过。
- WP01 留有明确未验证项：真实账号交互登录、service_role 运行时/写入、生产 CRUD/AI/外发、真机移动端。本轮没有访问或修改真实业务记录。
- 已检查 assistant 变更：活动 ID 仅接受正整数、最多 500 个；REST 查询只读、只取 `id,name`，不返回请求头、环境变量或密钥。
- `_shared` 公共副本检查：60 份、30 个函数均与母本一致；本轮仅需部署 `assistant`。
- 发布前以基线提交 `d0abdd2beb891ae016ab22571e55d9d152673aed` 为准；提交/推送/标签和 GitHub 核对结果见本节更新。

## 回滚

恢复到基线 `release-20261113-091744`，重新部署本记录中涉及的静态文件与 `assistant` 云函数，再创建恢复提交和发布标签。无数据库回滚步骤。

## 部署后核对

- 静态托管上传成功：`/crm/admin.html`、活动详情、活动写入、Console 搜索页、i18n 字典（共 5 个文件）。线上入口：[CRM Admin](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。
- 云函数 `assistant` 更新成功；`tools/sync-check.ps1 -CloudOnly` 核对主页面 HTTP 200 且 SHA-256 一致、102 个可达页面/模块/样式一致、30 个函数的 335 个源码/配置文件一致。
- 通过 CloudBase MCP 直接调用 `assistant` 做无写入探针时，运行时设备授权守卫返回 `DEVICE_ACCESS_DENIED`（1 ms）；该 MCP 调用没有用户浏览器的已授权设备上下文，因而未进入搜索处理逻辑。部署上传和源码一致性已验证，真实授权会话中的搜索结果功能仍由隔离回归覆盖，未以该调用冒充生产业务验收。
- GitHub 发布提交与标签以本轮 `tools/release.ps1` 执行结果为准。


