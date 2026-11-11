# 活动报名模块发布验证

## 2026-11-11 应用凭证隔离与日志验收

正式部署暂停在日志安全验收阶段。最后核对的 GitHub master 为 `a0aa045`（`release-20261111-232240`）；已将这一基线并入本地报名候选分支。本节结果仅针对本地候选和明确列出的线上只读请求。

最终串行执行 40 项专项及相邻回归，40 项通过、0 项跳过，包含桌面、iPad、iPhone 的公开报名和后台审核浏览器流程。早先的并行运行有 5 个浏览器用例失败，包含 Edge 调试进程启动超时；所有用例均重新执行。两份函数包及共享模块检查通过。第二条只读标记请求 `3a9e4364-4fe7-432e-b048-cecb45d8812d` 的 CLS 记录也保留了测试 nonce 与一次性签名头；按此设计，签名密钥无需离开服务端。该请求没有调用生产签名验证器。

| 项目 | 实测结果 |
|---|---|
| 隔离数据库的虚构活动 | 用两份随机生成的应用凭证分别提交报名、审核。数据库拒绝交叉操作。分别停用每一份凭证后，该入口拒绝请求，另一入口仍可用。匿名角色没有报名或凭证表的读取权。 |
| 生产网关日志 | 一条带无效合成标记的请求只查询 `public.activity_registration_pages` 的 id，限制返回 0 行。网关返回 401 / `DATABASE_42501`。按请求 ID `3732accd-31aa-4e3e-9208-9ee0303aba8f` 查到 CLS 的 `extraInfo` 保存了自定义凭证头及标记的原值。未发送有效业务凭证或报名人资料。可复用的固定请求头凭证未通过验收。 |
| 浏览器进出云函数 | 测试先复现：候选版本虽加密返回值，但管理链接凭证和表单字段仍在请求里。本地候选对非公开内容使用加密请求并沿用加密返回。用虚构标记验证 SDK 发出的请求与收到的返回中都没有标记明文。加密解决内容保密；业务重放、重试去重还需在接入写事务时验证。 |
| 签名替代方案（隔离库） | Node 使用 HMAC-SHA-256 签名固定受众、入口、操作、负载、时间及随机 nonce。数据库核对签名，拒绝篡改、过期、交叉使用及已消费的 nonce。单独停用公开签名身份后员工身份仍能通过。仅使用随机夹具密钥。 |
| 数据库扩展 | 产线上 `pgcrypto` 1.3 可安装，尚未安装。隔离安装会在 `public` 新建 37 个函数，默认全部对测试 anon 可执行。候选 migration 在同一事务中收回扩展函数执行权限，并逐项确认 anon、authenticated、service_role 没有执行权；隔离测试验证 migration 及带归属检查的 RESTRICT rollback。未触及线上扩展和授权。 |

下一阶段涉及实例级扩展和新增签名验证材料。候选 migration 为 `20261111234500_activity_registration_crypto`。启用前需要确认扩展影响。上线前还需将签名核验绑定到两组固定的业务 RPC，在同一事务内消费 nonce，验证失败与重试的幂等行为、员工身份和设备资格。签名密钥须经受保护的配置渠道注入，避免出现在带参数的 SQL、函数返回或部署日志中。验证真实云端的经过与错误路径后重跑发布门禁。当前云函数内的数据库传输仍是上一候选的实现，不可发布。

## 2026-11-11 接手验证

| 检查 | 证据 |
|---|---|
| 发布基线 | 本地、GitHub master 和生产文件核对到 `be8931a`，对应 `release-20261111-222024`。发布前一致性检查覆盖 106 个静态文件和 30 个函数的 334 个源码或配置文件。|
| 专项和相邻回归 | 37 项通过。公开页及后台操作各覆盖桌面 1440×900、iPad 820×1180、iPhone 390×844 的浏览器视口。覆盖报名、待审修改、审核、显式关联人物，并回归活动、签到相关操作、伴手礼入口和设备校验。|
| 数据一致性 | 隔离 PostgreSQL 引擎以虚构数据验证三条迁移及反向回滚、容量、同组链接轮换、状态限制、审核关联和审计的一致性。|
| 云端数据库现状 | 前两条迁移已在线逐条核对。四张报名表为空，均启用并强制 RLS。第三条迁移及 rollback 随候选分支提供。|
| 云端凭证 | 现有五个服务端 API Key 名额已用满，分别由知识库、助手检索、活动复盘、今日教练和 Person 360 使用。|
| 发布门禁 | WP01 最终通过，阻断项 0。全量回归 104 通过、0 失败、5 跳过。一次前置运行中 Person 360 旧页面夹具过早读取元素，保留该次结果。相同源码完整重跑通过。 |
| 本次投产状态 | 已请求创建报名专用服务端 Key，接口返回失败。随后重新查询仍是五把原有 Key，没有报名专用 Key。两只报名函数、公开路由、静态页及第三条迁移尚未部署。 |
| 待生产验收 | 员工真实登录、实机和生产报名闭环仍待发布后验收。|

本次测试不写入生产报名数据。获得可用的报名专用服务身份后，重新核对基线，应用第三条迁移，按线上实测核对和登记新数据库函数的执行权限，再运行发布门禁。先验证两个函数，再开放精确的公开路由、上传本包静态文件、核对三端和 GitHub 发布标签。

### 隔离复验

从仓库根目录运行。若 PGlite 独立安装，将 `CRM_PGLITE_MODULE` 指向其 CommonJS 入口。

```powershell
node --test --test-concurrency=2 tests/activity-registration/*.cjs tests/pc16/*.cjs tests/pc17/*.cjs tests/pc18/*.cjs tests/pc11/person-gifts-navigation.browser.cjs tests/security/device-delegation.test.cjs tests/tooling/cloudbase-sdk-pins.cjs
npm run test:wp01
npm run check:release-gate
```

## 2026-11-10 首次验证记录

## 产物

- 数据库 migrations：`20261110110000_activity_registration`、`20261110160000_activity_registration_shared_token`；均有 rollback，并已备份至本地 CloudBase migrations 目录。
- 函数包：`activity_registration`（员工后台）及 `activity_registration_public`（受限公开 handler），Nodejs20.19；包源码哈希一致。
- 权限方案：`cloudbase/permissions/activity-registration.rego` 仅开放公开函数路径；rollback 文件保留既有 OPA 内容。两者尚未部署。
- 静态页：`/crm/activity-registration.html`、对应 CSS/公开模块；后台入口位于活动工作台。

## 本地验证

| 场景 | 结果 |
|---|---|
| 活动报名测试（Console、服务契约、双语、iPhone/iPad 浏览器流程） | 10/10 通过 |
| PC16/17/18 活动相邻回归 | 11/11 通过 |
| public security catalog 单元测试 | 8/8 通过 |
| 模块化前端门禁、云函数语法、JSON 配置、共享副本哈希 | 通过；64 份共享副本 / 32 个函数匹配 |
| WP01 发布门禁 | **阻断**：安全目录发现未入当前发布基线的设备委托/文件上传对象，详细见下文 |

## 云端与回归

- 两条活动报名 migration 均已应用；执行器误报 `MIGRATION_NOT_APPLIED` 后，通过 migration history、migration detail、表结构和索引只读确认成功。四张表均启用并强制 RLS，只给 `service_role` 授权，匿名与 authenticated 权限为空；表当前无报名数据。
- 最新 WP01 catalog SQL 快照在 `tests/security/.results/wp01-catalog.json`。除本模块新增表/序列外，仍发现五个未批准对象：`public.crm_device_delegations`、`public.crm_device_file_parts`、`public.crm_device_file_uploads`、`public.crm_device_delegate_v1(p_op text, p_args jsonb)`、`public.crm_device_file_stage_v1(p_op text, p_actor text, p_fp text, p jsonb)`。发布基线仅按本模块实际核验结果增加了本模块四表和两序列；未把设备对象加入基线。目录显示 `crm_device_delegate_v1` 是 SECURITY DEFINER 且 anon 可执行。WP01 因此失败并跳过其余 release-gate 自动采集；`npm run check:release-gate` 明确阻断。
- 本轮尚未创建服务 API key、部署两个函数、变更线上 OPA、上传静态页或提交/推送/打发布标签。安全目录核查和发布门禁阻止公开入口发布。
- 不创建生产报名测试数据；线上服务角色 CRUD、真实员工登录、真实 iPhone/iPad 实机验收均未执行。浏览器尺寸回归为隔离测试环境。
- 活动报名真实数据库写入/审核闭环尚未因功能未发布而验证。

## 回滚

若恢复本地代码发布，先禁用公开函数入口/页面，再评估数据导出和保留；shared-token rollback 仅在没有重复管理凭证时可运行；初始 migration rollback 仅当四表均为空时可运行。函数/API key 的撤销由 CloudBase 管理配置单独执行，未记录凭证值。因当前尚未创建 API key 或部署函数，本轮无需撤销它们。
