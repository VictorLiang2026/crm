# P1：客户关联机会历史维护归入 Console

日期：2026-10-26。依据 `D:\CRM\CRM-admin与console单入口深度分析-20261026.md` 的 P1 工作包。用户已单项授权生产终态修订与软删除。发布前基线提交 `890701f84968a1efcdd66f3ae7b0f6f4074225bc`，回退标签 `release-20261026-204300`。

## 范围与兼容

- Console 机会详情新增原 ID 的终态字段修订（含重新打开）与软删除；两者均经 `person_360`、`public.crm_legacy_opportunity_maintenance_v1` 服务端预览、人工勾选、执行和回执。15 分钟预览有效期、同操作者幂等键与数据库行版本校验防止旧预览执行。重新打开不改写既有 Outcome，界面提示历史结果仍在。
- 服务端预览列出机会/客户 ID、前后字段、关联 Action 与 Outcome 数量。软删除仅设置机会 `deleted_at`，关联记录保留，与旧 `opportunities.remove` 的数据语义一致。机会没有单项自助恢复入口，界面明确提示。
- Console 新增只读身份异常清单，按原 ID 显示客户/机会的 Person 关联与异常原因；不自动选定、关联或修改 Person。旧客户深链及 `admin.html` 保留，供异常记录兼容维护。
- 不修改既有表、视图、函数或路由；只新增 `public` 命令表与两个数据库函数。无 AI 模型、权限范围或其它 schema 变更。

## 变更文件

`cloudbase/migrations/20261026114000_legacy_opportunity_maintenance.sql` 及配对 rollback；`cloudfunctions/person_360/index.js`、`legacy-opportunity-service.js`；`crm/js/modules/console/data.js`、`i18n.js`、`legacy-opportunity-maintenance.js`、`pages/opportunities.js`；`tests/console/legacy-opportunity-maintenance.*.cjs`。

## 验证与限制

- 本地定向测试：6/6 通过；覆盖服务端输入校验、RPC 路由、预览前无写入、人工勾选、执行后回读、中英文及只读异常清单。
- 跨模块回归：`npm test` 108 PASS / 0 FAIL / 5 既有 SKIP，覆盖登录、客户、跟进、机会、活动、增员、回收站等。
- 生产只读核查：未删除客户关联机会 1 条，终态 0 条，身份异常 0 条；唯一机会已登记为虚构测试记录。未使用真实客户做写入试验。
- 生产 migration `20261026114000_legacy_opportunity_maintenance` 已应用成功；只新增 `public` 命令表与两个 RPC。服务命令表当前 0 行，未修改业务记录。生产对象清单 1122 项检查无漂移。
- WP01 发布门禁 `PASS_WITH_LIMITATIONS`：跨模块回归 108 PASS / 0 FAIL / 5 既有 SKIP，匿名访问探测 76/76 通过；PC34 public 权限、service_role 只读访问、Person 到反馈链路和 iPad 双语检查通过。
- `person_360` 仅部署本函数；从云端下载代码包核对 `index.js` 与 `legacy-opportunity-service.js` SHA-256 均与本地一致。仅上传 Console 的 `data.js`、`i18n.js`、`legacy-opportunity-maintenance.js`、`pages/opportunities.js`，线上 HTTP 字节哈希 4/4 与本地一致。
- 真实账号登录、生产服务运行时和真实写入未验证；当前无终态机会可执行非破坏性验收。未使用真实客户做写入试验。手机页面不在本工作包验收范围。

## 回退

前端与云函数基于上一发布标签重新部署并提交恢复版本，不强推。数据库 rollback 仅在没有已执行维护命令时允许删除本轮新增对象；一旦有执行记录，保留审计，先人工评估业务数据及关联记录，禁止静默回滚。
