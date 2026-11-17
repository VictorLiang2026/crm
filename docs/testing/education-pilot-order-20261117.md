# 人物教育资料补全：试点选人排序（2026-11-17）

## 需求与影响

用户确认将未来新建的 50 人教育试点改为按人物入库时间最新优先。人物入库时间使用 `public.persons.created_at`，排序固定为 `created_at DESC, id DESC`；同一入库时间按人物 ID 倒序，确保结果确定。

原规则按 ID 升序。生产只读比较显示：两种规则各选 50 人，集合零重合；旧集合的入库时间都为 2021-12-31，新集合的入库时间为 2026-11-15 至 2026-11-17。筛选条件不变：人物未软删除，毕业院校或院系/专业至少一项为空。

仅影响迁移生效后创建的新批次。已创建批次的 `person_education_items`、候选、预览、审计记录及 Person 字段不会重排或更改；不改变模型、触发器、开关、人工确认、重试和撤销流程。

## Migration 与 rollback

- Migration：`cloudbase/migrations/20261117160700_person_education_pilot_order.sql`，仅 `CREATE OR REPLACE` `public.crm_education_backfill_v1(text,text,jsonb)`，把新批次抽样排序改为最新入库优先。
- 配对 rollback：`cloudbase/migrations/20261117160700_person_education_pilot_order.rollback.sql`，恢复为 ID 升序。不会删除表、批次、任务、候选、预览或人物数据。
- 迁移文件与 rollback 同时备份到 `C:\Users\victor\cloudbase\migrations`。

## 验证

- 基线：提交 `047aca15a7948207194cd700afb3400e7b09b6fd`；修改前完整本地/GitHub/CloudBase sync-check 通过，106 个静态资源、30 个函数的 340 个源码/配置文件一致。云端迁移最新版本为 `20261117103000`。
- `node --test --test-concurrency=1 tests/education-backfill/*.test.cjs`：21 PASS、0 FAIL、0 SKIP。新增隔离 PGlite 用例验证新排序、同时间 ID 倒序、rollback 恢复旧排序、旧批次项目不变且没有人物字段写入。
- 数据库上线后还需只读确认迁移历史、函数排序定义及原 service_role 权限。此工作包不创建生产批次、不触发模型调用、不写 Person。
- 用户须从真实登录的 CRM 会话启动新试点，查看候选原文和前后值并人工确认；此后的生产运行与人工审核结果另行记录。

## 发布状态

- Migration 计划成功。应用调用先报告 `MIGRATION_NOT_APPLIED`，随后 CloudBase 任务详情为 `Succeed`，`listMigrations` 显示总数 204、最新版本 `20261117160700`，`migrationDetail` 返回本文件内排序 SQL；只读查询确认函数定义含 `created_at DESC, id DESC`，权限仍为 service_role 可执行、anon/authenticated 不可执行。未重试或绕过迁移历史。
- 用户在迁移应用前已创建一个批次，创建时间为 2026-11-17 15:46（+08），早于迁移任务 16:12；其 50 位成员的入库时间仍为 2021-12-31，故它是旧排序样本，迁移不会重排。该批次已完成，`calls_used=50`、7 项 `needs_review`、43 项 `no_evidence`；预览 0、人物变更 0。未读取或复制候选原文、姓名、人物编号。
- 迁移应用后尚未创建第二个试点批次，因此尚无生产证据验证新 cohort 的识别质量。下一次由用户在真实登录的 Console 选择试点并新建批次；预期为最近入库的人物。此过程仍不会自动写 Person。
- 教育专项回归：21 PASS、0 FAIL、0 SKIP。新用例覆盖最近入库优先、相同时间 ID 倒序、rollback 恢复旧规则，且断言已有批次与人物字段不变。
- WP01：`PASS_WITH_LIMITATIONS`；目录检查 1,646 项通过，WP04 身份审计无例外，隔离回归 102 PASS、0 FAIL、5 个历史预设 SKIP，匿名权限 113/113。登录、service-runtime、live-writes、mobile 仍为未验证项。
- 本段记录的是首次教育专项检查时的阶段状态；GitHub 发布、标签及互动页面纳入后的完整 CloudBase 核对已在下方“发布闭环”与补记中完成。

## 发布闭环（2026-11-17）

- 提交：`e4834cdb52d7f4cec6025317b15695c9aaff3407`；GitHub `master` 已推送，标签：`release-20261117-161829`。
- 发布前和发布后完整 `sync-check.ps1` 均通过：本地/GitHub/CloudBase 一致；106 个可达静态资源及 30 个函数的 340 个源码/配置文件匹配；线上 `admin.html` HTTP 200 且 SHA-256 相同。云端复核证据目录：`D:\Temp\crm-cloud-audit-9982cd3a7bf949d8aa569fc26b5913c3`。
- 业务产物只包含已执行的 PostgreSQL migration `20261117160700`；未修改或部署云函数、页面资源。远端迁移历史总数 204，最新版本为 `20261117160700`；函数体与 service_role 独占执行权限已只读核实。
- CloudBase 首次 apply 响应一度显示 `MIGRATION_NOT_APPLIED`，但异步任务结果为 Succeed。按流程检查 task、listMigrations 与 migrationDetail 后确认 migration 已登记并生效；未重复 apply、未绕过 migration 历史。
- 发布门禁为 `PASS_WITH_LIMITATIONS`：目录 1,646 项通过，WP04 无例外，回归 102 PASS / 0 FAIL / 5 个历史预设 SKIP，匿名权限 113/113；真实登录、service-runtime、live-writes、mobile 仍未验证。
- 当前最新排序下的第二个生产试点尚未创建。此前 15:46 创建的批次先于 16:12 migration，仍保留旧样本；7 项待审核、43 项无证据，预览和 Person 字段变更为 0。

## 补记：Person 互动日期改动纳入后续发布

- 首次教育发布后的复核发现线上 `i18n.js` 和 `person-interaction.js` 存在日期录入/清除改动；用户随后明确批准纳入本轮，本次跟踪记录见 [person-interaction-followup-dates-20261117.md](person-interaction-followup-dates-20261117.md)。
- CloudBase 迁移历史已含 `20261117170000_person_interaction_followup_dates`，`public.interactions.next_followup_date` 已存在；39 条人工互动中该列当前非空为 0。故本轮不重复 apply，只把与线上 migration/rollback 哈希一致的文件补入 Git。
- CloudBase 两份静态资源已按路径上传；互动日期 browser、旧互动 migration、目录聚合/rollback、教育排序回归及最终 WP01 均已通过。详见互动专项记录。
- GitHub 在期间收到互动功能提交 `23cbe60f5b4373dc1b6b2c60cf83d7d36c1e0fed`；最终闭环提交 `a3ccac5cbfdb5e204fb7bd490712838805966e3d` 已推送，标签为 `release-20261117-173700`。
- 发布后完整 sync-check 通过：本地/GitHub/CloudBase 一致，106 个静态资源、30 个函数的 340 个源码/配置文件匹配，线上 `admin.html` HTTP 200 且 SHA-256 一致。证据目录：`D:\Temp\crm-cloud-audit-8e3d04a81738468dbf3e57ea0e18f19c`。
- 原始 `D:\CRM\crm` 工作区已快进至当前 GitHub `master`，两边提交一致且工作区清洁。
- 第二个最新入库排序的教育试点批次仍未创建；旧批次与 Person 字段保持不变。
