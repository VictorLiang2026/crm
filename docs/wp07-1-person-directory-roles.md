# WP07.1｜Person 主档、人物目录与角色转换

起点：`38172b69f436557982d3382d5de8d0f0ccc35882` / `release-20261004-082600`。本包不实施 WP08；`public` 以外对象不参与。迁移：`cloudbase/migrations/20261004011800_person_directory_roles.sql`；回滚：`cloudbase/rollbacks/20261004011800_person_directory_roles.sql`。

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

## 回滚与未验证

代码回滚以起点标签生成新的恢复提交并仅重发以上产物，不强推。数据库回滚文件有防护：存在 Person-only 候选人或有效身份预览时停止，须先评估并保留衍生数据，再执行。不要静默删除或改写客户数据。真实登录、Person-only 写入与恢复、不同角色转换、手机真机及部分旧 AI 增员动作仍需逐项验收；不把自动夹具当作这些路径的成功证据。
