# Recruit Candidate → Person identity

基线：`d3769264a9f1db233c0f35c38f1f59599c6fc3fa` / `release-20260929-234232`；修改前本地、GitHub `master`、线上 `admin.html` 和 27 个 CRM 云函数（129 个源码/配置文件）一致。生产环境 `crm-d1gkae8ddc930d151`，仅操作 `public` schema。

只读盘点发现 `public.recruit_candidates` 共 16 条（活跃 13 条），其中 15 条可通过 `customer_id → persons.legacy_customer_id` 关联到 Person，活跃候选人 #17 缺失关联。`persons` 初始回填只是快照；后来新增的两个客户缺 Person，其中只有客户 #785 对应候选人。本轮只为有候选人关联的客户补齐身份，没有按姓名猜测或合并 Person，没有批量同步全部客户。

已应用迁移 [20260929160746_recruit_candidate_person.sql](../../cloudbase/migrations/20260929160746_recruit_candidate_person.sql)（CloudBase task `task-b1142a39`）。`recruit_candidates` 保留原表与 `customer_id`，新增不可空 `person_id`、Person 外键和 `(customer_id, person_id)` 复合外键；16 条历史候选人按明确客户 ID 回填。迁移只给缺口客户 #785 生成一条 Person，原客户及候选人字段不改。数据库触发器在候选人新增/更换客户时同事务解析或创建客户对应的 Person，阻止独立改写 `person_id`。触发器为限定 `public` 对象的 `SECURITY DEFINER`，取消公共直接执行权限；现有匿名云函数无需取得 `persons` 表权限。`persons` 的 RLS/grants 保持 `service_role` 专用。

两个原招募视图仅在原列尾部追加 `person_id`，保留 `security_invoker=true`、匿名只读与原有字段顺序；`v_action_center`、`v_funnel_stats` 的现有列均显式选取，不依赖新列，已检查且未改。旧 `recruit_candidates` 函数、增员列表/详情、阶段、画像、动机、顾虑、潜力评分、职业规划、回收站以及旧页面/路由均保留；没有创建 `recruit_profiles`。本轮没有修改或部署页面/云函数源码。新增 Person ID 会出现在原招募列表、详情与回收站返回中，其他字段保持兼容。

配套 [rollback](../../cloudbase/rollbacks/20260929160746_recruit_candidate_person.sql) 会还原两个招募视图、触发器、外键和列；如后来有对象依赖新视图列，`DROP VIEW` 会拒绝回滚，不使用 `CASCADE`。回滚保留已创建的 Person 身份，避免删除后续可能被引用的真实身份记录。回滚前应另行评估这些数据关系。

验证：迁移后 16/16 候选人有正确 Person 外键，0 条错配，0 条活跃候选人指向已删除 Person；候选人 #17 关联到客户 #785 的 Person。`stage`、`motivation`、`concerns`、`potential_score`、`career_plan`、`profile` 在基表及活跃视图中仍可读；两个视图的 RLS 调用模式和授权与基线一致。隔离事务测试覆盖新增候选人自动创建 Person、客户更换、禁止独立改写 Person ID、旧画像字段读取与清理。旧 `recruit_candidates.create/get` 真实云函数写入测试通过（RequestId `fed013b1-b6ff-4491-bf3f-ac7d163a9f56`、`92bb4219-185e-4400-b54c-d0ff7bddc5a8`）；`list` 返回 13 条且均有 Person ID，`trashList` 返回 3 条且均有 Person ID，`funnel` 返回 13 条。回收站删除批次线上测试通过。所有 `[CRM_TEST_ONLY]` 客户、候选人、Person 和里程碑测试记录读回均为 0。完整隔离回归 81 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、招募、活动、Today、漏斗和回收站。首次沙箱浏览器启动超时，允许 Edge 正常启动后重跑通过。

边界：没有候选人的客户 #786 仍无 Person；`person_roles` 的 `recruit` 角色仍是旧快照，不在本轮自动同步。此次目标是候选人可解析到 Person，不开发独立 Recruit Profile、Person 360 招募卡片或全量客户身份同步。
