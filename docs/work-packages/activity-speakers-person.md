# 活动嘉宾与 Person 身份关联

本轮为 `public.activity_speakers` 增加可空的 `person_id`，引用 `public.persons(id)`。Speaker 表继续保存专业领域、可分享主题、合作次数、偏好形式、备注及其他旧档案字段；`customer_id`、`recruit_candidate_id`、旧嘉宾函数和旧活动参与者关联保留。没有删除或重命名表、视图、函数或路由。线上没有依赖该表的 public View。

迁移 `20260929133000_activity_speakers_person.sql` 只按已有且未删除的 `customer_id → persons.legacy_customer_id` 明确关系回填，不按姓名猜测。上线时 3 条在用嘉宾全部成功映射。新增的部分唯一索引避免同一 Person 同时拥有多个在用 Speaker Profile；触发器要求只有 `service_role` 能新设或改变 `person_id`，旧匿名云函数仍可写它原有的专业档案字段。原有 RLS 策略保持不变。配套 rollback 会检查是否已有 Person 专属或重新关联的正式嘉宾，避免静默丢失身份关系。

嘉宾资源页增加人工选取现有 Person 的新增入口，以及未关联旧嘉宾的人工关联入口。选人由已有登录保护的 `person_360` 云函数查询并在写入时再次校验姓名与 ID；未选中不得写入。旧新增嘉宾入口继续可用，仍保持原有自动关联客户档案流程。Person 专属新嘉宾的 `customer_id` 可以为空；旧 Quick Capture 的嘉宾沟通记录仍依赖客户档案，因此这一路径需要后续单独做兼容设计，本轮不修改 Quick Capture。

回归：离线完整回归 79 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、机会、Today、漏斗、活动、增员、回收站以及新增的嘉宾人工选人和重复身份校验。线上无登录直调新动作返回 `UNAUTHORIZED`；真实登录后用 `[CRM_TEST_ONLY]` Person 建立嘉宾档案，页面显示 Person 关联，数据库回读 `person_id`、专业、主题、偏好形式均正确。重复创建被拒绝。测试嘉宾与 Person 均已软删除，在用测试记录数为 0；线上仍有 3 位已映射的原嘉宾。旧嘉宾 `list/get` 和活动 `list` 均返回正常。

本轮部署范围：迁移 `20260929133000`、`person_360` 函数代码、`/crm/admin.html`。云端函数入口与本地一致，静态页面下载内容与本地一致。GitHub 提交、发布标签及本地/云端/GitHub 最终一致性以发布命令的核验结果为准。
