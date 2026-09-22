# public 权限验证与修复

## 最终状态（2026-09-22）

用户明确同意后，迁移 `20260922003000_public_permission_hardening` 已成功应用，CloudBase task `task-c09b3193`，远端历史核验成功。以下“修复前”内容作为历史证据保留，以本节为当前结论。

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| policy_review_reports RLS | false | true；19 张表全部启用 |
| 10 个视图 security_invoker | 未设置 | 全部 true |
| authenticated 对 19 表、10 视图的表级授权 | ALL | 全部撤销；87 条角色/对象授权复核确认 |
| anon / service_role | 原有授权 | 保持不变；service_role 仍具 BYPASSRLS |
| 视图定义、字段、业务代码 | 原有实现 | 未修改 |

迁移：`cloudbase/migrations/20260922003000_public_permission_hardening.sql`。
回滚：`cloudbase/rollbacks/20260922003000_public_permission_hardening.sql`。
二者已备份至 `C:/Users/victor/cloudbase/migrations/`。迁移带事务、锁超时及逐对象基线检查；回滚恢复原 RLS、视图 options 及 authenticated 的精确权限集合，不改业务数据。回滚会重新打开原风险，因此仅提供脚本，未在线执行回滚演练。

**权限实测：** authenticated 对客户、报告及 10 个视图的 12 次直连全部返回 DATABASE_42501；anon 公开 Key 对客户、报告及客户视图均返回 0 行（修复前后两者曾可读）。现有客户云函数更新隔离记录成功，报告更新并读回标记成功。

**线上接口 smoke：** customers.list/trashList、recruit_candidates.list/trashList、funnel_insight.stats、today_coach.cockpit、activities.list 全部成功，只记录状态和响应字段，不导出业务内容。证据为同目录 `public-permissions-browser-after.json`、`public-permissions-anonymous-after.json`。测试使用真实有效 SDK 登录会话；原页面 5 分钟闲置锁仍生效，接口探针直接使用 SDK，不把它当作超时解锁 UI 测试。

**旧功能回归：** 40 PASS、1 FAIL、5 SKIP。失败仍为既有 activity-readonly（读取详情尝试更新参与人），没有顺便修复。证据 `public-permissions-regression.json`。未进行全部线上页面人工点击、真实服务角色 Key 网关测试、AI 生成、删除/恢复写入测试；服务器 JWT 未直接观测，兼容结论基于真实接口成功和有效授权事实。

**收尾：** 本轮测试记录已精确清理。数据库权限变更已生效，页面和云函数无需部署；因既有回归失败，遵守 AGENTS.md 停止 Git 发布收尾，未提交/推送/打新标签。不能将数据库迁移成功等同整个发布完成。

## 修复前证据与验证过程

更新：2026-09-22。环境 `crm-d1gkae8ddc930d151`。基线 HEAD `147bd60a91406c37fa0556824485cebf14a2f1f9`，标签 `release-20260921-110000`。

## 已验证事实

- public 共 19 张表、10 个视图；18 张表启用 RLS，`policy_review_reports` 未启用。该表已有 fn_only 策略，但 RLS 关闭时不生效。
- 10 个视图均未设置 security_invoker，按 owner 权限访问底表。
- 表的 anon 有 SELECT/INSERT/UPDATE/DELETE；authenticated 和 service_role 有包括 TRUNCATE 在内的全部表级权限。service_role 的 BYPASSRLS=true，其余两角色为 false。以上是数据库有效授权，不代表网关暴露所有 SQL 操作；未执行 TRUNCATE 等破坏性验证。
- 9 个视图授予 anon SELECT，photos_view 未授予；authenticated/service_role 对 10 个视图有全部表级权限。
- 当前 fn_only 策略适用于 anon，要求 JWT role=anon 且 sub 缺失。真实测试账号 JWT 为 authenticated 且有 sub；公开 Key 为 anon 且有 sub。不得将公开 Key 与云函数服务器身份混为一谈。

## 隔离记录实测

只针对负数 ID `-2026092101`、标记 `[CRM_PERMISSION_TEST]20260921-rls-a` 的合成客户及合成报告。创建时均已软删除；无真实客户数据作为测试输入。直接查询只投影合成主键。

| 路径 | customers 基表 | policy_review_reports | customers_view |
| --- | --- | --- | --- |
| 真实登录账号直接 RDB | 0 行 | 1 行（风险复现） | 1 行（绕过底表 RLS） |
| 公开 Key 的匿名 REST | 0 行 | 1 行（风险复现） | 1 行（绕过底表 RLS） |

登录账号对其余 9 个视图查询没有权限错误，均为 0 行；缺少匹配隔离记录，因此不能声称这 9 个视图逐个完成了数据可见性验证。

现有 `policy_review_reports.get` 云函数能读取该隔离报告，标记和 ID 匹配。代码中服务器以 `cloudbase.init({env:process.env.TCB_ENV}).rdb()` 访问数据库，没有显式转发浏览器 token。服务器实际 JWT/数据库角色尚未直接观测，不能把代码推断当成实测身份。

浏览器 SDK 正确查询形式为 `app.rdb().schema('public').from(table)`。早期验证脚本的 `from('public.' + table)` 导致双 public 前缀和 PGRST205；该轮错误不计入权限结论。已修正测试脚本，未修改业务页面。

## 修复方案及闸门

候选最小修复：启用报告表现有 RLS；为 10 个视图设置 security_invoker；在证实现有云函数服务器路径不依赖 authenticated 授权后，收紧 authenticated 对 public 业务对象的权限。保留云函数需要的 anon 授权和现有策略，保留 service_role 后台能力，不引入新的业务调用路径。

影响：阻止绕过 callFn 直接访问的客户端；页面仍通过原 callFn 入口。需要覆盖登录、客户列表/详情、跟进、今日、漏斗、活动、增员、回收站，以及云函数对隔离记录的写入和读回。

尚未生成或执行 migration/rollback：用户要求先验证现有云函数兼容；AGENTS.md 要求影响已有访问行为时，在实现前明确确认。实际修改将依据本次完整 ACL、RLS、视图 options 快照生成精确 rollback，不使用 CASCADE。

当前线上权限、视图定义、页面和云函数代码均未修改。修复后差异和修复后权限结果尚不存在，不报告为通过。

## 当前阻塞及回归

2026-09-22 用户重新手动登录后，重新创建两条标记记录并完成云函数兼容性探针：`customers.update` 返回 ok=true、updated=1，说明现有云函数能写入已启用 RLS 的客户基表；`policy_review_reports.update` 后 `get` 读回合成标记成功。直接浏览器客户基表仍返回 0 行，而客户视图和报告表各返回 1 行，风险再次复现。该结果证实当前云函数访问通道可用，但没有直接观测服务器 JWT，且不替代变更后的验证。

进入实现前仍须遵守 AGENTS.md 的明确确认要求：拟启用报告表 RLS、设置 10 个视图 security_invoker，并在确认实际服务器授权依赖后收紧 authenticated 的直接数据库权限；保持页面 callFn、业务字段及软删除语义。迁移与精确 rollback 将在确认后生成，执行后必须再验证隔离读写与旧页面。

本轮重复验证的两条隔离记录已精确清理，并核对客户、报告测试记录计数均为 0。

2026-09-22 重跑完整离线回归：40 PASS、1 FAIL、5 SKIP。唯一业务失败为 `backend.activity-readonly`：活动详情读取会尝试更新缺姓名的参与人，属于既有问题，本轮未修复。首次受限环境浏览器无法启动，允许启动隐藏本地浏览器后完整重跑得出上述结果。离线通过不等于线上权限兼容通过。

因权限行为变更尚待明确确认且既有回归失败，未提交、推送、打标签或发布，不宣称修复完成。

## 复现材料

- `tests/permissions/01`—`05`：只读事实、授权、字段、依赖验证。
- `06-create-fixture.sql` / `07-cleanup-fixture.sql` / `08-fixture-check.sql`：固定标记测试记录的创建、精确清理与计数。
- `login-probe.cjs`：独立浏览器手动登录，复用当前前端登录代码，不记录密码或 token。
- `run-browser-probe.cjs`：显式 public 的真实登录查询；`--fixture-write` 仅允许固定隔离 ID 的云函数写入及读回。
- `anonymous-probe.cjs`：公开 Key 的只读、固定隔离 ID 查询。
- 本地 `.results` 被 Git 忽略。凭据不得进入报告或 Git；服务角色真实网关测试未执行，不创建或泄露后台 Key。

官方访问路径参考：[CloudBase PostgreSQL 连接文档](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)。以上风险结论来自本环境实测，不仅来自文档。
