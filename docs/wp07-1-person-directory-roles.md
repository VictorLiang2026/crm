# WP07.1｜Person 主档、人物目录与角色转换

起点：`38172b69f436557982d3382d5de8d0f0ccc35882` / `release-20261004-082600`。本包不实施 WP08；`public` 以外对象不参与。主迁移：`cloudbase/migrations/20261004011800_person_directory_roles.sql`；安全补充迁移：`cloudbase/migrations/20261004031500_test_identity_command_guard.sql`；各自的同名回滚文件位于 `cloudbase/rollbacks/`。

## 字段归属和兼容

| 事实 | 主档 | 兼容行为 |
| --- | --- | --- |
| 姓名、联系方式、性别、生日、职业、机构、教育 | `public.persons` | 已明确关联的旧客户字段继续供旧页使用；旧客户表单修改共享字段时，同事务同步到 Person。历史差异不批量回填。 |
| 客户阶段、销售优先级、客户画像 | `public.customers` | 只有人工选择客户角色才建立兼容客户行，旧 `#/customer/:id` 保留。 |
| 增员阶段、评估、下一步 | `public.recruit_candidates` | `customer_id` 可空，`person_id` 必填；旧客户增员仍走原客户视图和旧接口。Person-only 行由已登录的 `person_360` 受限只读接口补入旧招募列表/详情/回收站。 |
| 嘉宾资料 | `public.activity_speakers` | 新嘉宾先核实 Person；原嘉宾路径保留。 |
| 互动、行动、承诺 | 各自业务表 | 以 Person ID 关联；WP07 V2 的灰度、预览、确认和幂等路径保持。 |

影响页面：`#/people`、Person 360、Legacy 快速记录新人/嘉宾、招募列表/详情/回收站，以及已关联客户资料显示。服务接口：`person_360` 新增 `listPeople`、`resolveIdentity`、`previewIdentity`、`executeIdentity` 及 Person-only 增员只读方法。新增 `public.person_identity_commands`、3 个仅服务角色可执行的 RPC、2 个仅服务角色可读的 Person-only 视图。客户表同步触发器和 `crm_delete_batch` 兼容 Person-only 增员；旧招募视图保留原列契约。新建 Person 默认没有客户或增员角色；转客户、转增员分别由服务端预览和人工确认执行，收据与账号绑定，15 分钟过期，重放返回原 ID。

## 发布与验证记录

- 2026-10-04：修复迁移文件重复索引。首次失败的迁移未生效；相同版本重新执行成功，任务 `task-e3d71cde`。迁移后核对 Person 780、客户 781、候选人 16、Person-only 候选人 0，均与迁移前一致；初始测试台账仍为 10 行。
- 只读目录审计：新增 7 个对象，现有对象权限无漂移；新增命令表及 Person-only 视图的 anon/authenticated 直接 SELECT 均为 false；3 个 RPC 的 anon/authenticated EXECUTE 均为 false。旧身份例外仍为 3 个客户、3 个活动参与者，未自动修复。
- 自动回归：`npm test` 94 PASS、0 FAIL、5 预设 SKIP；WP07.1/WP07 聚焦测试 13 PASS；WP05 8 PASS；安全单测 4 PASS。`npm run test:wp01` 发布门槛 `PASS_WITH_LIMITATIONS`，匿名网关 54/54 PASS。隔离测试不能替代真实写入和真机测试。
- 真实测试账号只读复验：人物目录服务端第 1/2 页、编号升降序、50 条限制、无效排序拒绝、测试标记搜索、同名候选不自动选择、七列表头与 390px 横向滚动共 13 项 PASS。测试标记搜索曾被校验拒绝，已放行必要的 `【】` 字符并重发函数后复验通过。
- 首次 Git 阶段发布在 CloudBase 源码下载时因 `D:` 空间耗尽（`ENOSPC`）中止，尚未提交。仅清理核实位于 `D:\Temp` 的旧 `crm-cloud-audit-*` 临时下载副本后恢复空间。`tools/sync-check.ps1` 增加可选 `CRM_SYNC_AUDIT_ROOT`，本轮改用 `C:` 的本机临时目录保存新证据，再运行原发布流程；不改变核对项目或放宽门槛。
- 已发布 `person_360` 云函数及 `/crm/admin.html`、`/crm/js/modules/phase14-hubs.js`、`/crm/css/phase14-navigation.css`。本包的阶段提交/标签与最终验收结果以发布报告为准。
- 阶段提交 `cc111e70fd604ea384f7aabb8b72ffd686fdf66e`、标签 `release-20261004-104500` 已推送；本地、GitHub、云端的 22 个可访问静态产物和 28 个 CRM 函数、163 个文件通过一致性核对。
- 真实测试账号曾用未带完整标记的“张三（测试）”建立预览，执行返回 `Test account must use fictional marked Person`；只有一条未执行命令记录，没有 Person/客户/候选人业务行。随后人工选择带标记的“【系统测试·勿联系】虚构独立增员甲”，命令 `5b54466e-f301-4594-85de-ff8f6ce823bc` 建立 Person #784；当时无任何角色、客户或增员记录，测试台账记录为 `persons:784`，初始业务行仍为 10。
- 同一测试 Person 先经命令 `dee428b4-cf4d-4e0a-997a-11f2f61612dc` 独立转增员，结果 `recruitId=19, customerId=null`；再经 `e54ac48c-14eb-4101-84ae-cc4fd1b68b06` 转客户，结果 `customerId=791`。现在 #784 有 `recruit` 与 `customer` 两个角色，候选人 #19 精确关联 Person #784，客户 #791 与两条衍生记录均有测试台账。
- 安全补充迁移任务 `task-9dc2b586` 已成功：测试账号的身份命令必须使用完整标记；选择现有 Person 时还须有同批次测试台账 ID。触发器在预览插入和执行状态更新前检查，原有未执行、无标记预览也不能绕过。anon/authenticated 无函数执行权。真实账号只读复验增加“无标记新建”和“无标记现有 Person 转增员”两条拒绝路径，15/15 PASS，未产生预览或业务行。
- 安全补充后，完整回归一次因 Today 晨间简报按钮等待超时而得 93 PASS/1 FAIL；失败快照已出现按钮。单独重跑发布门槛得 94 PASS/0 FAIL/5 预设 SKIP，匿名网关 54/54，门槛 `PASS_WITH_LIMITATIONS`。首次网关探针受本地网络沙箱阻断，获网络权限后通过；隔离浏览器也在沙箱外重开后完成只读复验。
- 第二阶段提交 `4b11d70ff0700b9e0d0fc223a69c1439f9ef03b3`、标签 `release-20261004-113000` 已推送；本地/GitHub/云端 22 个可访问页面资源与 28 个 CRM 函数、163 个源码/配置文件一致。该阶段只发布数据库安全补充及测试/报告，云端静态页面与函数源码未重新上传。
- Legacy 快速记录新人经人工确认命令 `a1638e10-9dbd-4d4a-a9e5-192edb0b26f2` 建立 Person #785 与互动 #8，客户/增员均未创建；之后独立转客户命令 `de53751a-5b96-40c9-a3d5-996c916a2219` 建客户 #792，保持无增员。Legacy 快速记录嘉宾命令 `7cbc21a1-0d82-4e2d-b79b-6615d7d85947` 人工选择已有 #785，建立嘉宾 #11 与互动 #9，沿用客户 #792，无重复 Person。上述衍生行均有测试台账，初始行仍为 10。
- 一次人工操作把页面标题填入姓名，命令 `98cb4e55-f4c7-45fc-b54e-fc82aea0d45b` 建立了带标记的虚构 Person #786，姓名为“【系统测试·勿联系】虚构快速记录乙 · Person 360”。它没有自动合并到 #785，也没有自动建客户；该事实保留在台账和本报告，不静默改名或删除。后续人工确认命令 `6d1dae43-24c7-49f2-97c6-8637eb0e6aaa` 将 #786 单独转增员，候选人 #20 的 `customer_id` 保持 `NULL`，首条阶段记录有台账。旧招募列表、详情及受限 Person-only 服务均读取 #20 成功；Legacy 快速记录写入虚构增员跟进 #3，候选人仍没有客户。
- 人物目录的服务端跨页升降序、50 条上限、七列表头、手机宽度横向滚动、无标记姓名/现有人物拒绝等真实测试账号只读检查 15/15 PASS。已执行的 Person 新建收据重放返回原 #784，伪造收据被拒绝，记录数未增加。
- Person-only 候选人详情的删除确认文案按 `customer_id` 显示“人物主档保留”或原有“客户记录保留”，只上传 `/crm/admin.html`。新增服务角色限定的触发器函数已依据新采集的 `public` 权限目录精确登记到安全基线，匿名/普通登录执行权均为 false；94 项回归 0 失败、匿名网关 54/54、WP01 门槛 `PASS_WITH_LIMITATIONS`。软删除与恢复的真实账号复验仍待完成。

## 回滚与未验证

代码回滚以起点标签生成新的恢复提交并仅重发受影响产物，不强推。安全补充迁移可单独移除其触发器及函数；主数据库回滚文件有防护：现在已有 Person-only 候选人和有效身份预览，执行前必须评估并保留衍生数据。不要静默删除或改写客户数据。Person-only 候选人软删除与恢复、手机真机及部分旧 AI 增员动作仍需逐项验收；Legacy AI 解析未单独证明会产生 AI Gateway task/run/result 审计，WP07 V2 的审计与灰度回归保持通过，不把隔离夹具当作这些路径的成功证据。
