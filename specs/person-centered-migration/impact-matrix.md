# 影响矩阵（字段 / 函数 / 调用方 / 工作包映射）

用途：跨包追踪每个被修改的字段、表、视图、云函数 action、页面入口的消费者与影响面；修改共享模块前按执行约定 H 先登记全部消费者。PMC-00 无业务变更，PMC-01 完成全量影响盘点，本文件以盘点结果起步，后续每包更新。

## 维护规则

1. 每包涉及字段、表/视图、云函数 action、页面入口变化时，在对应分节追加行：`对象 | 变化类型 | 调用方/消费者 | 所属包 | 状态 | 证据`。
2. 共享模块（db.js / ai.js 副本）变化必须列出全部受影响函数目录及部署清单。
3. 状态取值：计划中 / 已实现 / 已部署 / 已验收 / 已回滚。

---

## PMC-01：全量影响盘点（2026-10-07）

### 一、数据库对象清单（public schema，实测）

| 类别 | 数量 | 明细 |
| --- | --- | --- |
| 基表 | 47 | 全部启用 RLS；41 表单策略，6 表多策略（commitments/knowledge_items/learnings/outcomes/playbooks=3，opportunities=2） |
| 视图 | 12 | 全部 security_invoker=true；无物化视图 |
| 数据库函数 | 33 | 含 3 个 SECURITY DEFINER（crm_test_disclosure_v1、crm_test_track_v1、customer_person_identity_bridge、recruit_candidate_person_sync） |
| 序列 | 36 | — |
| 外键 | 66 | 含 RESTRICT / CASCADE / SET NULL；详见下文 FK 分析 |
| 触发器 | 91 | 含 not-null 检查、guard、sync 等 |

### 二、身份字段重复与缺失统计

| 表 | 身份字段数 | 有 person_id | 有 customer_id | 有 deleted_at | 身份字段明细 |
| --- | --- | --- | --- | --- | --- |
| persons | 9 | — | — | 1 | birthday, display_name, education, gender, occupation, organization, phone, source, wechat |
| customers | 10 | 0 | — | 1 | birthday, customer_name, education, gender, marital_status, mbti, occupation, phone, source, wx_account |
| activity_speakers | 5 | 1 | 1 | 1 | name, organization, phone, source, wechat |
| recruit_candidates | 4 | 1 | 1 | 1 | education, mbti, radar_image_name, winner_report_name |
| opportunities | 1 | 1 | 1 | 1 | referred_name |
| photos | 2 | 0 | 1 | 1 | customer_name, file_name |
| gifts | 2 | 0 | 1 | 1 | customer_name, gift_name |
| followups | 1 | 0 | 1 | 1 | customer_name |
| policy_review_reports | 1 | 0 | 1 | 1 | customer_name |
| ai_recommendations | 1 | 0 | 1 | 0 | customer_name |
| ocr_records | 1 | 0 | 1 | 1 | file_names |
| activity_participants | 1 | 1 | 0 | 1 | person_name |
| products | 1 | 0 | 1 | 1 | customer_name |

### 三、Person 覆盖与一致性统计

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| persons 总行数 | 784 | 含 3 条软删除 |
| persons.legacy_customer_id 非空 | 780 | 780/784 = 99.5% 已映射到 customers |
| customers 总行数 | 783 | 含 1 条软删除 |
| customers 无对应 Person | 3 | 需补查：是否为已删除/未迁移客户 |
| person_alive_customer_deleted | 0 | 无此不一致 |
| person_deleted_customer_alive | 0 | 无此不一致 |
| recruit_candidates.customer_id 孤儿 | 0 | 全部指向有效 customers |
| recruit_candidates.person_id 孤儿 | 0 | 全部指向有效 persons |
| activity_participants.person_id 孤儿 | 0 | 全部指向有效 persons |
| interactions.person_id 孤儿 | 0 | 全部指向有效 persons |
| followups.customer_id 孤儿 | 0 | 全部指向有效 customers |
| opportunities.customer_id 孤儿（按 legacy_customer_id） | 0 | 全部指向有效 persons |
| opportunities.person_id 孤儿 | 0 | 全部指向有效 persons |

### 四、外键约束分析（66 条 FK）

**指向 persons.id 的 FK（19 条）：**
actions.person_id, activity_speakers.person_id, assistant_action_commands.person_id, commitments.person_id, context_items.person_id, crm_activity_review_commands.person_id, crm_activity_review_source_claims.person_id, crm_opportunity_action_links.person_id, crm_opportunity_commands.person_id, crm_work_item_commands.person_id, household_members.person_id, households.anchor_person_id, interactions.person_id, opportunities.person_id, opportunity_candidates.person_id, person_roles.person_id, quick_capture_v2_commands.person_id, relationships.from_person_id/to_person_id/introduced_by_person_id

**指向 customers."Id" 的 FK（8 条）：**
ai_recommendations.customer_id, followups.customer_id, gifts.customer_id, ocr_records.customer_id, photos.customer_id, policy_review_reports.customer_id, products.customer_id, recruit_candidates.customer_id

**复合 FK（customer_id + person_id → persons(legacy_customer_id, id)）：**
opportunities, recruit_candidates

**指向 persons.legacy_customer_id 的 FK：**
persons.legacy_customer_id（自引用）

**无 FK 约束的身份列：**
- activity_participants.person_id（仅 canonical_person_id 有 FK）
- activity_speakers.customer_id（无 FK，仅 person_id 有 FK）

### 五、视图依赖分析

| 视图 | 数据来源 | 身份字段来源 |
| --- | --- | --- |
| v_recruit_candidates | recruit_candidates JOIN customers | 从 customers 读取 customer_name/phone/occupation 等 |
| v_recruit_candidates_trash | recruit_candidates JOIN customers | 同上 |
| v_recruit_candidates_person_only | persons | 仅 persons |
| v_recruit_candidates_person_only_trash | persons | 仅 persons |
| v_funnel_stats | customers + opportunities + recruit_candidates | 从 customers 读取 |
| v_action_center | customers + followups + opportunities + recruit_candidates + recruit_followups + activity_tasks + activities | 从 customers 读取 |
| customers_view | customers | 直接映射 |
| followups_view | followups JOIN customers | 从 customers 读取 |
| gifts_view | gifts JOIN customers | 从 customers 读取 |
| photos_view | photos JOIN customers | 从 customers 读取 |
| products_view | products JOIN customers | 从 customers 读取 |
| ai_recommendations_view | ai_recommendations JOIN customers | 从 customers 读取 |

### 六、云函数 × action 矩阵

#### 6.1 客户域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| customers | list | admin.html #/customers | customers_view（RPC crm_customers_page_v1） | — | customer_id (int) | customers | persons | anon 可调 RPC | 需修改 | 视图依赖 customers 字段 |
| customers | get | admin.html #/customer/:id | customers + 子表（followups/gifts/photos/products/policy_review_reports/ai_recommendations/recruit_candidates） | — | customer_id | customers | persons | authenticated | 需修改 | 子表均通过 customer_id 关联 |
| customers | create | admin.html | — | customers | customer_name/phone 等 | customers | persons | authenticated | 需修改 | 新建客户需同步创建 Person |
| customers | update | admin.html / OCR 恢复 | — | customers | customer_id | customers | persons | authenticated | 需修改 | OCR 删除后前端调 customers.update 恢复快照 |
| customers | remove | admin.html 回收站 | — | customers.deleted_at | customer_id | customers | persons | authenticated | 需修改 | 软删除需级联 persons |
| customers | trashList | admin.html 回收站 | customers WHERE deleted_at IS NOT NULL | — | customer_id | customers | persons | authenticated | 需修改 | — |
| customers | restore | admin.html 回收站 | — | customers.deleted_at=NULL | customer_id | customers | persons | authenticated | 需修改 | 恢复需级联 persons |
| followups | list | admin.html | followups JOIN customers | — | customer_id | customers | persons | authenticated | 需修改 | 通过 customer_id 关联 |
| followups | create | admin.html | — | followups | customer_id/customer_name | customers | persons | authenticated | 需修改 | — |
| followups | update | admin.html | — | followups | customer_id | customers | persons | authenticated | 需修改 | — |
| followups | remove | admin.html | — | followups.deleted_at | customer_id | customers | persons | authenticated | 需修改 | — |
| gifts | list/create/update/remove | admin.html | gifts JOIN customers / gifts | gifts | customer_id/customer_name | customers | persons | authenticated | 需修改 | 4 个 action 同构 |
| photos | list/get/create/update/remove | admin.html | photos JOIN customers / photos | photos | customer_id/customer_name | customers | persons | authenticated | 需修改 | 5 个 action 同构 |
| products | list/upsert/remove | admin.html | products JOIN customers / products | products | customer_id/customer_name | customers | persons | authenticated | 需修改 | 3 个 action 同构 |
| policy_review_reports | list/get/generate/update/remove | admin.html | policy_review_reports JOIN customers / 子表 | policy_review_reports | customer_id/customer_name | customers | persons | authenticated | 需修改 | 5 个 action 同构 |
| ocr_records | list/create/update/remove | admin.html | ocr_records | ocr_records | customer_id | customers | persons | authenticated | 需修改 | remove 返回 customer_snapshot，前端调 customers.update 恢复 |
| ai_recommendations | list/listAll/get/create/update/update_status | admin.html | ai_recommendations JOIN customers | ai_recommendations | customer_id/customer_name | customers | persons | authenticated | 需修改 | 6 个 action 同构 |

#### 6.2 Person 域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person_360 | get | Console person 页 | persons + 子表 | — | person_id (bigint) | persons | persons | service_role (CRM_PERSON360_DB_API_KEY) | 已核实无影响 | Person 原生 |
| person_360 | listPeople | Console people 页 | persons（RPC person_directory_page_v1） | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | search | Console 快速记录 | persons | — | person_id/display_name | persons | persons | service_role | 已核实无影响 | — |
| person_360 | resolveIdentity | Console 快速记录 | persons | — | person_id | persons | persons | service_role | 已核实无影响 | resolveName 服务端解析 |
| person_360 | previewIdentity | Console 快速记录 | — | person_identity_commands | person_id | persons | persons | service_role | 已核实无影响 | RPC person_identity_preview_v1 |
| person_360 | executeIdentity | Console 快速记录 | person_identity_commands | persons | person_id | persons | persons | service_role | 已核实无影响 | RPC person_identity_execute_v1 |
| person_360 | resolveQuickCaptureName | Console 快速记录 | persons | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | commitQuickCaptureV2 | Console 快速记录 | quick_capture_v2_commands | interactions/context_items | person_id | persons | persons | service_role | 已核实无影响 | RPC quick_capture_v2_command_v1/commit |
| person_360 | listInteractions | Console person 页 | interactions | — | person_id | persons | persons | service_role | 已核实无影响 | interactions RLS 仅 service_role |
| person_360 | getTimelinePage | Console person 页 | interactions | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | getContextGroups | Console person 页 | context_items | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | getInsuranceContext | Console person 页 | context_items | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | getMeetingPrepContext | Console person 页 | persons + interactions + context_items | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listOpportunities | Console person 页 | opportunities | — | person_id | persons | persons | service_role | 已核实无影响 | Person 专属机会 |
| person_360 | listOpportunityDirectory | Console 机会页 | opportunities | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listPendingOpportunityCandidates | Console 机会页 | opportunity_candidates | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | previewOpportunity | Console 机会页 | crm_opportunity_commands | — | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_opportunity_preview_v1 |
| person_360 | executeOpportunity | Console 机会页 | crm_opportunity_commands → opportunities | opportunities | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_opportunity_execute_v1 |
| person_360 | createOpportunity | Console 机会页 | — | opportunities | person_id | persons | persons | service_role | 已核实无影响 | 经 preview/execute 流程 |
| person_360 | updateOpportunity | Console 机会页 | — | opportunities | person_id | persons | persons | service_role | 已核实无影响 | 同上 |
| person_360 | closeOpportunity | Console 机会页 | — | opportunities | person_id | persons | persons | service_role | 已核实无影响 | 同上 |
| person_360 | removeOpportunity | Console 机会页 | — | opportunities | person_id | persons | persons | service_role | 已核实无影响 | 同上 |
| person_360 | getOpportunityLinks | Console 机会页 | crm_opportunity_action_links | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listUnlinkedOpportunityActions | Console 机会页 | actions | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listRecruitContext | Console person 页 | recruit_candidates + recruit_followups | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | getCustomerProfile | Console person 页 | customers（经 legacy_customer_id） | — | person_id | customers | persons | service_role | 需修改 | 桥接查询，目标为纯 Person |
| person_360 | lookupCustomer | Console person 页 | customers | — | customer_id | customers | persons | service_role | 需修改 | 兼容入口，目标为 Person 直查 |
| person_360 | listPersonOnlyRecruits | Console 招募页 | persons（RPC） | — | person_id | persons | persons | service_role | 已核实无影响 | v_recruit_candidates_person_only |
| person_360 | getPersonOnlyRecruit | Console 招募页 | persons | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listPersonOnlyRecruitTrash | Console 招募页 | persons | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | removePersonOnlyRecruit | Console 招募页 | — | recruit_candidates.deleted_at | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_person_only_recruit_delete_v1 |
| person_360 | restorePersonOnlyRecruit | Console 招募页 | — | recruit_candidates.deleted_at=NULL | person_id | persons | persons | service_role | 已核实无影响 | 同上 |
| person_360 | listDueCommitments | Console 今日页 | commitments | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listPersonWorkItems | Console person 页 | actions + commitments | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listTodayWorkItems | Console 今日页 | actions + commitments | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | previewWorkItem | Console 今日页 | crm_work_item_commands | — | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_work_item_preview_v1 |
| person_360 | executeWorkItem | Console 今日页 | crm_work_item_commands → actions/commitments | actions/commitments | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_work_item_execute_v1 |
| person_360 | saveFacts | Console person 页 | context_items | context_items | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | addMember | Console person 页 | household_members | household_members | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | removeMember | Console person 页 | household_members | household_members.deleted_at | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | getRelationshipDecay | Console person 页 | relationships | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listActivityData | Console 活动页 | activity_participants + activity_speakers | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | listActivityOutcomes | Console 活动页 | outcomes | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | recordActivityInteraction | Console 活动页 | — | interactions | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | previewActivityReview | Console 活动页 | crm_activity_review_commands | — | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_activity_review_preview_v1 |
| person_360 | executeActivityReview | Console 活动页 | crm_activity_review_commands | activity_participants | person_id | persons | persons | service_role | 已核实无影响 | RPC crm_activity_review_execute_v1 |
| person_360 | addCanonicalParticipant | Console 活动页 | activity_participants | activity_participants | person_id/canonical_person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | linkSpeakerPerson | Console 活动页 | activity_speakers | activity_speakers.person_id | person_id | persons | persons | service_role | 已核实无影响 | — |
| person_360 | createSpeakerProfile | Console 活动页 | activity_speakers | activity_speakers | person_id | persons | persons | service_role | 已核实无影响 | — |

#### 6.3 活动域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| activities | list/get/create/update/remove/updateStatus | admin.html #/activity | activities | activities | activity_id | — | — | authenticated | 仅回归 | 无身份字段 |
| activities | addParticipant | admin.html 活动详情 | activity_participants | activity_participants | person_id/person_type | persons | persons | authenticated | 需修改 | person_id 无 FK |
| activities | linkParticipant | admin.html 活动详情 | activity_participants | activity_participants.canonical_person_id | canonical_person_id | persons | persons | authenticated | 需修改 | canonical_person_id 有 FK |
| activities | updateParticipant | admin.html 活动详情 | activity_participants | activity_participants | person_id | persons | persons | authenticated | 需修改 | — |
| activities | removeParticipant | admin.html 活动详情 | activity_participants | activity_participants.deleted_at | person_id | persons | persons | authenticated | 需修改 | — |
| activities | searchPerson | admin.html 活动详情 | persons | — | person_id | persons | persons | authenticated | 已核实无影响 | Person 原生搜索 |
| activities | listByPerson | Console 活动页 | activity_participants | — | person_id | persons | persons | authenticated | 需修改 | — |
| activities | getSummary | admin.html 活动详情 | activities + activity_participants | — | — | — | — | authenticated | 仅回归 | — |
| activities | applyTopics | admin.html 活动详情 | activity_topics | activities.topic_ids | — | — | — | authenticated | 仅回归 | — |
| activities | getActivityData | Console 活动页 | activities + activity_participants + activity_speakers | — | person_id | persons | persons | authenticated | 需修改 | 含参与者/嘉宾身份 |
| activity_speakers | list/get/create/update/remove/search | admin.html 嘉宾管理 | activity_speakers + customers（create 时按姓名查）/ v_recruit_candidates | activity_speakers | customer_id/person_id | customers | persons | authenticated | 需修改 | create 自动建 customers；customer_id 无 FK |
| activity_tasks | list/get/create/update/complete/skip/remove | admin.html 活动任务 | activity_tasks + activities + customers + v_recruit_candidates | activity_tasks | related_id | — | — | authenticated | 仅回归 | related_type=customer 时需适配 |
| activity_topics | list/get/create/update/remove/search | admin.html 活动主题 | activity_topics | activity_topics | — | — | — | authenticated | 仅回归 | 无身份字段 |
| activity_reports | customer/recruit | admin.html 活动报告 | 多表（customers/followups/gifts/photos/products/policy_review_reports/ai_recommendations/recruit_candidates/recruit_followups/recruit_milestones/ocr_records） | — | customer_id | customers | persons | authenticated | 需修改 | 读取客户域全量子表 |

#### 6.4 招募域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recruit_candidates | list | admin.html #/recruit | v_recruit_candidates（JOIN customers） | — | customer_id | customers | persons | authenticated | 需修改 | 视图依赖 customers |
| recruit_candidates | get | admin.html #/recruit/:id | v_recruit_candidates | — | customer_id | customers | persons | authenticated | 需修改 | — |
| recruit_candidates | create | admin.html | — | recruit_candidates + persons（触发器自动建） | customer_id/person_id | customers | persons | authenticated | 需修改 | 触发器 recruit_candidate_person_sync |
| recruit_candidates | update | admin.html | — | recruit_candidates | customer_id | customers | persons | authenticated | 需修改 | — |
| recruit_candidates | remove | admin.html 回收站 | — | recruit_candidates.deleted_at | customer_id | customers | persons | authenticated | 需修改 | RPC crm_delete_batch |
| recruit_candidates | trashList | admin.html 回收站 | v_recruit_candidates_trash | — | customer_id | customers | persons | authenticated | 需修改 | — |
| recruit_candidates | restore | admin.html 回收站 | — | recruit_candidates.deleted_at=NULL | customer_id | customers | persons | authenticated | 需修改 | RPC crm_delete_batch |
| recruit_candidates | funnel | admin.html 漏斗 | recruit_candidates | — | — | — | — | authenticated | 仅回归 | 聚合统计 |
| recruit_candidates | rcMap | admin.html 雷达图 | recruit_candidates | — | customer_id | customers | persons | authenticated | 需修改 | — |
| recruit_followups | list/create/update/remove | admin.html 招募跟进 | recruit_followups | recruit_followups | candidate_id | recruit_candidates | persons | authenticated | 需修改 | 通过 candidate_id 间接关联 |
| recruit_goals | listGoals/saveGoals/getProgress/listBenchmarks/saveBenchmarks | admin.html 招募目标 | recruit_goals + recruit_goal_benchmarks + recruit_milestones | recruit_goals + recruit_goal_benchmarks | — | — | — | authenticated | 仅回归 | RPC crm_recruit_goals_save_v1 |
| recruit_score | （固定入口） | admin.html 增员评分 | v_recruit_candidates | recruit_candidates.potential_score/potential_reason | customer_id | customers | persons | authenticated | 需修改 | 读取视图含 customers 字段 |
| recruit_recommend | （固定入口） | admin.html 增员推荐 | v_recruit_candidates | — | customer_id | customers | persons | authenticated | 需修改 | 同上 |

#### 6.5 机会域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| opportunities | list | admin.html 机会列表 | opportunities + customers | — | customer_id/person_id | customers | persons | authenticated | 需修改 | 双轨 FK 过渡期 |
| opportunities | create | admin.html | — | opportunities | customer_id/person_id | customers | persons | authenticated | 需修改 | — |
| opportunities | update | admin.html | — | opportunities | customer_id/person_id | customers | persons | authenticated | 需修改 | — |
| opportunities | close | admin.html | — | opportunities | customer_id/person_id | customers | persons | authenticated | 需修改 | — |
| opportunities | remove | admin.html | — | opportunities.deleted_at | customer_id/person_id | customers | persons | authenticated | 需修改 | — |

#### 6.6 AI 域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| assistant | search | Console 搜索 | persons | — | person_id | persons | persons | service_role (CRM_ASSISTANT_DB_API_KEY) | 已核实无影响 | — |
| assistant | summarize | Console person 页 | persons + 子表 | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | meetingPrep | Console person 页 | persons + interactions | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | conversationPlaybook | Console person 页 | persons + playbooks | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | conversationPlaybookHistory | Console person 页 | ai_tasks/ai_results | — | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | quickCaptureV2 | Console 快速记录 | persons | quick_capture_v2_commands | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | opportunityCandidate | Console 机会页 | opportunity_candidates + ai_results | opportunity_candidates | person_id | persons | persons | service_role | 已核实无影响 | preview/edit/reject/confirm/execute |
| assistant | command | Console 命令 | assistant_action_commands | assistant_action_commands | person_id | persons | persons | service_role | 已核实无影响 | — |
| assistant | testSamples | admin.html 测试 | crm_test_records | crm_test_records | — | — | — | service_role | 仅回归 | 测试工具 |
| ai_parse | quick_capture | Console 快速记录 | — | — | — | — | — | AI Gateway | 已核实无影响 | 纯 AI 解析，不读写 DB |
| ai_parse | （默认 parse） | admin.html OCR | — | — | — | — | — | AI Gateway | 仅回归 | — |
| ai_followup | analyze_profile | admin.html 客户详情 | customers + followups | ai_recommendations | customer_id | customers | persons | AI Gateway | 需修改 | 读取 customers |
| ai_followup | analyze_recruit_profile | admin.html 招募详情 | recruit_candidates + recruit_followups | — | candidate_id | recruit_candidates | persons | AI Gateway | 需修改 | — |
| ai_recommend | （固定入口） | admin.html AI 推荐 | customers + followups + products + gifts + activity_participants + opportunities | ai_recommendations | customer_id | customers | persons | AI Gateway | 需修改 | — |
| ai_referral | （固定入口） | admin.html 转介绍 | customers + followups + products + gifts + activity_participants + opportunities | — | customer_id | customers | persons | AI Gateway | 需修改 | — |
| ai_activity | activity_review | admin.html 活动复盘 | activities + activity_participants + activity_speakers | — | activity_id | — | — | AI Gateway + service_role (CRM_ACTIVITY_REVIEW_DB_API_KEY) | 需修改 | 读取参与者身份 |
| ai_activity | meeting_prep | admin.html 会前准备 | persons + interactions | — | person_id | persons | persons | AI Gateway | 已核实无影响 | — |
| ai_activity | person_basic | admin.html | persons | — | person_id | persons | persons | AI Gateway | 已核实无影响 | — |
| ai_activity | quick_capture | admin.html | — | — | — | — | — | AI Gateway | 仅回归 | — |
| ai_activity | recruit_coach | admin.html 招募教练 | recruit_candidates | — | candidate_id | recruit_candidates | persons | AI Gateway | 需修改 | — |
| ai_activity | today_coach | admin.html | customers + followups + opportunities + recruit_candidates + activities + v_action_center | — | customer_id | customers | persons | AI Gateway | 需修改 | 读取多表含 customers |
| today_coach | candidates | admin.html Dashboard | customers + followups + opportunities + recruit_candidates + activities + v_action_center | — | customer_id | customers | persons | service_role (CRM_TODAY_DB_API_KEY) | 需修改 | 读取 customers |
| today_coach | generate | admin.html Dashboard | 同上 | — | customer_id | customers | persons | service_role | 需修改 | — |
| today_coach | daily_review | admin.html 复盘 | 同上 | — | customer_id | customers | persons | service_role | 需修改 | — |
| today_coach | cockpit | admin.html 驾驶舱 | 同上 | — | customer_id | customers | persons | service_role | 需修改 | — |
| funnel_insight | stats | admin.html 漏斗 | v_funnel_stats | — | — | customers | persons | authenticated | 需修改 | 视图依赖 customers |
| funnel_insight | explain | admin.html 漏斗 | v_funnel_stats | — | — | customers | persons | authenticated | 需修改 | 同上 |

### 七、专项调用链核查结果

#### 7.1 嘉宾创建过程中直接查询或创建 customers

**已核实**：`activity_speakers` 云函数 `create` action 在未传 `customer_id` 时，按姓名查询 `customers` 表，无匹配则自动 `insert` 建档，并将 `customer_id` 写入 `activity_speakers`。

- 文件：`cloudfunctions/activity_speakers/index.js` L119-L148
- 状态：**需修改**——嘉宾建档应先走 `PersonService.resolveName()`，人工确认后再创建 Person，不自动建 customers
- 影响：admin.html 嘉宾管理页

#### 7.2 OCR 删除后由前端取快照再次调用 customers.update

**已核实**：`ocr_records` 云函数 `remove` action 删除前读取 `customer_snapshot` 返回前端；前端解析快照后调用 `callFn('customers', {action:'update', id, data:restoreData})` 恢复客户信息。

- 云函数：`cloudfunctions/ocr_records/index.js` L73-L82
- 前端：`crm/admin.html` L3372-L3383
- 状态：**需修改**——OCR 恢复逻辑依赖 customers 表字段，迁移后需改为恢复 Person 字段

#### 7.3 漏斗和招募函数通过视图间接读取客户字段

**已核实**：
- `funnel_insight` 只读取 `v_funnel_stats` 视图，该视图从 `customers` 读取
- `recruit_candidates` 列表走 `v_recruit_candidates` 视图，该视图 JOIN `customers` 读取 `customer_name` 等字段

- `v_funnel_stats` 定义：`cloudbase/migrations/20260910120000_funnel_stats_view.sql`
- `v_recruit_candidates` 定义：`cloudbase/migrations/20260905130000_recruit_view_files.sql` L32-L34
- 状态：**需修改**——视图需改为从 persons 读取身份字段

#### 7.4 Quick Capture、新旧 Person 服务和后台维护写入

**已核实**：
- Quick Capture V2：`assistant/quick-capture-v2-service.js` L35-L47 只读 persons，写入经 RPC `quick_capture_v2_plan_v1`/`quick_capture_v2_command_v1`/`quick_capture_v2_commit`
- Person 身份预览/执行：`person_360/index.js` L277-L340 经 RPC `person_identity_preview_v1`/`person_identity_execute_v1`
- 状态：**已核实无影响**——新链路已以 Person 为中心

#### 7.5 共享模块是否只修改母本而遗漏函数目录副本

**已核实**：`_shared/db.js` 和 `_shared/ai.js` 在 28 个函数目录各持副本（56 份）；各函数通过 `require('./db')` 使用本地副本。sync-check 已验证 56 份全部一致。

- 母本：`cloudfunctions/_shared/db.js`、`cloudfunctions/_shared/ai.js`
- 状态：**已核实无影响**——当前一致；未来修改须经 `npm run build:shared` + `check:shared` 并逐函数部署

### 八、前端入口清单

#### 8.1 Legacy（admin.html）

| 函数 | 调用 action |
| --- | --- |
| customers | list, create, update, remove, get, trashList, restore |
| recruit_candidates | rcMap, funnel, list, trashList, restore, create, get, update |
| today_coach | candidates, generate, daily_review, cockpit |
| person_360 | listDueCommitments, lookupCustomer, listPersonOnlyRecruits, listPersonOnlyRecruitTrash, restorePersonOnlyRecruit, recordActivityInteraction, resolveQuickCaptureName, addCanonicalParticipant, linkSpeakerPerson, previewIdentity, executeIdentity |
| funnel_insight | stats, explain |
| ai_followup | analyze_profile, analyze_recruit_profile |
| followups | remove, update, create |
| opportunities | list, close, remove, update, create |
| ai_recommendations | create, update_status, update |
| products | upsert |
| policy_review_reports | generate, update, remove |
| gifts | remove, update, create |
| photos | create, get, remove, update |
| ocr_records | list, remove, update, create |
| activities | list, remove, update, create, get, updateStatus, removeParticipant, searchPerson, updateParticipant, addParticipant, linkParticipant, applyTopics |
| ai_activity | analyze, recommendSpeakers, recommendTopics, participantReview, postReview, learning |
| activity_tasks | list, complete, skip, remove, update, create |
| activity_speakers | list, remove, update |
| activity_topics | list, update, remove, create |
| recruit_followups | create, list, remove, update |
| recruit_goals | listGoals, saveGoals, getProgress, saveBenchmarks |
| ai_parse | quick_capture |
| assistant | testSamples |
| ai_referral | （固定入口） |
| ai_recommend | （固定入口） |
| recruit_recommend | （固定入口，传 candidate_id） |
| recruit_score | （固定入口，传 candidate_id） |

#### 8.2 Console（crm/js/modules/console/）

| 模块 | 调用 |
| --- | --- |
| data.js | person_360(listTodayWorkItems/listDueCommitments/listPendingOpportunityCandidates/listOpportunityDirectory/listPeople/get/getCustomerProfile/listPersonWorkItems/listInteractions/getTimelinePage/getContextGroups/getInsuranceContext/listOpportunities/listRecruitContext/lookupCustomer), today_coach(cockpit/daily_review), assistant(search/summarize/meetingPrep/conversationPlaybook/conversationPlaybookHistory), activities(list/get/getActivityData), activity_tasks(list), ai_activity(postReviewV2), recruit_candidates(list/funnel), recruit_goals(getProgress) |
| write.js | person_360(previewWorkItem/executeWorkItem/previewOpportunity/executeOpportunity/get/search/resolveQuickCaptureName/previewIdentity/executeIdentity/commitQuickCaptureV2), assistant(opportunityCandidate), ai_parse(quick_capture) |
| pages/settings.js | requestPasswordReset |

### 九、未知项与补查任务

| # | 未知项 | 影响 | 补查任务 | 优先级 |
| --- | --- | --- | --- | --- |
| U1 | ~~3 个 customers 无对应 Person 的具体原因~~ **已补查（PMC-02，2026-10-07）**：#786/#789/#790 均活跃未删、近期经 legacy `customers.create` 建档（该路径不建 Person，1 条跟进/无子记录），无嘉宾/机会/招募关联 | 处置方案入 D2（data-model.md §8）：建议走身份命令流程补建 Person（人工确认）后回填 | 无需再查；待 D2 批准 | 高 → 已查明 |
| U2 | `activity_participants.person_id` 无 FK 约束的原因 | 可能导致孤儿参与者记录 | 检查是否为历史遗留，是否需要补 FK | 中 |
| U3 | `activity_speakers.customer_id` 无 FK 约束的原因 | 可能导致孤儿嘉宾记录 | 同上 | 中 |
| U4 | `persons.legacy_customer_id` 自引用 FK 的语义 | 需确认是否允许 NULL | 检查约束定义是否允许 NULL | 低 |
| U5 | `opportunities` 双 FK 约束（customer_id+person_id → persons(legacy_customer_id,id)）的迁移计划 | 阻塞机会域 Person 化 | 确认何时可以移除 customer_id 列 | 高 |
| U6 | `recruit_candidates` 双 FK 约束同上 | 阻塞招募域 Person 化 | 同上 | 高 |
| U7 | `ai_recommendations` 无 deleted_at 列 | 与其他表软删除不一致 | 确认是否需要补 deleted_at | 低 |
| U8 | `ai_tasks`/`ai_runs`/`ai_results` 无 deleted_at 列 | 同上 | 同上 | 低 |

---

## PMC-00 基线：无业务变更记录

| 对象 | 变化类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `tools/tcb.ps1` | 修改：增加显式子命令守卫（拒绝无命令/首参为 flag 的裸调用） | sync-check.ps1（`fn code download`）、deploy-function.ps1（`fn code update`）、人工只读命令（`fn list`） | PMC-00 缺口处置 | 已部署（Git，本地工具；云端无关） | evidence/PMC-00.md 第九节 G2 |
| `tools/sync-migration-backup.ps1` | 新增：迁移双备份非破坏性同步脚本（归档旧稿→镜像→哈希校验，含 -DryRun） | 发布迁移包前的外部备份同步；后续涉及数据库的 PMC 包 | PMC-00 缺口处置 | 已执行并独立复核：外部 82/82 哈希一致，25 旧稿归档 `_archive-20261007/` | evidence/PMC-00.md 第九节 G1 |
| `tools/pg-readonly.cjs` | 新增：Trae/Codex 共用只读 PG 查询（SELECT/WITH 单语句，拒绝 DDL/DML/多语句） | PMC 各包只读证据采集（替代临时候选脚本） | PMC-00 缺口处置 | 已验证（persons=784 + 3 类拒绝路径） | evidence/PMC-00.md 第九节 G3 |
| `tests/wp01/static.cjs` | 无变更（核实 console.html 入口早已存在） | sync-check / WP01 gate | PMC-00 缺口处置 | 已核实：50 资产含 48 console 链 | evidence/PMC-00.md 第九节 G4 |

## PMC-03：迁移验证及恢复基线（2026-10-08，仅测试/工具/文档）

| 对象 | 变化类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `tools/migration-check.sql` | 新增：只读 WITH→snapshot JSON（counts/mappings/orphans/roles/softdeleteCross/multiRole/nulls/pagination，无 PII） | migration-check.cjs、PMC 实施包迁移前后核对 | PMC-03 | 代码就绪待执行 | evidence/PMC-03.md §2 |
| `tools/migration-check.cjs` | 新增：经 pg-readonly 通道执行 SQL+评估 failures+写报告 | PMC 实施包、发布前核对 | PMC-03 | 代码就绪待执行 | 同上 |
| `tests/pmc/risk-cases.test.cjs` | 新增：R1–R10+R-ID1 离线契约测试（fixture，不触线上） | PMC 测试套件（独立运行，不接入 release gate） | PMC-03 | 代码就绪待执行 | evidence/PMC-03.md §3 |
| `tests/pmc/shared-copy-drift.test.cjs` | 新增：R11 文件哈希漂移检测（person-service.js 三份副本） | PMC 测试套件 | PMC-03 | 代码就绪待执行 | 同上 |
| `tests/pmc/README.md` | 新增：运行方法+覆盖矩阵+限制声明 | 人工/工具执行参考 | PMC-03 | 完成 | — |
| `specs/.../pmc-03-verification.md` | 新增：测试映射+核对项+风险用例+恢复 runbook+隔离限制+WP01 核实+验收对照 | PMC 实施包设计依据 | PMC-03 | 完成 | — |
| **R11 发现**：`tools/sync-shared.cjs` MODULES 仅 db.js/ai.js | **缺口（未修）** | person-service.js 三份副本（_shared/person_360/assistant）不受 sync-shared 追踪 | PMC-03 记录、扩展属 PMC-04+ | 已登记缺口 | evidence/PMC-03.md §3 |
| `tools/conflict-check.sql` | 新增：只读冲突检测（缺失/一对多/多对一/孤立/软删除/字段冲突/同名不同人；脱敏 ID+差异标记+哈希） | PMC-05+ 实施包回填前重核 | PMC-04 | 已落盘 | evidence/PMC-04.md §2 |
| `tools/conflict-check-detail.sql` | 新增：深查（无 legacy Person 角色引用+同名组 phone/wechat 哈希比对） | PMC-06 纠错包消费 | PMC-04 | 已落盘 | evidence/PMC-04.md §2 |
| `specs/.../pmc-04-confirmation.md` | 新增：五分类确认清单（已确认可迁移/保留原值/不迁移/待确认/存在阻塞）+版本约束+后续消费方式 | PMC-05+ person_id 回填 + PMC-06 纠错 + D5 退出条件 | PMC-04 | 已落盘 | evidence/PMC-04.md §1 |
| **PMC-04 阻断**：同名不同人 E1–E7（7 组 14 人，基础资料全空） | **阻断 D5**（customers UNIQUE(customer_name) 退出） | D5 退出前须 7 组全部人工确认 | PMC-04 登记、解除属 PMC-06 | 已登记 | pmc-04-confirmation.md §3.4.D + §4 |

## 已知共享模块消费者基线（接管时事实）

- `cloudfunctions/_shared/db.js`、`ai.js`：28 个 CRM 函数目录各持副本，共 56 份；2026-10-07 sync-check 全部与 `_shared` 一致（SHA-256：db.js `124c6ac6…`、ai.js `6fa94a41…`）。任何修改须经 `npm run build:shared` + `check:shared` 并逐函数部署。
- `cloudfunctions/_shared/person-service.js`：**未被 sync-shared.cjs 追踪**（MODULES 不含）；三份副本 `_shared`/`person_360`/`assistant`，漂移检测由 PMC-03 `tests/pmc/shared-copy-drift.test.cjs` 覆盖；是否扩展 MODULES 属 PMC-04+（共享模块改造单独授权）。
- `crm/js/modules/console/i18n.js`：Console 全部页面消费；新增界面文本必须入字典（AGENTS.md 规则 17）。
- 视图依赖：任何基表加列/改列前，用 `pg-view-rebuild-check` skill 核对依赖视图清单（2026-10-07 基线：12 个视图全部 security_invoker）。

## 各领域当前调用方速查（PMC-01 盘点后更新）

| 领域 | Legacy 入口（admin.html 路由） | Console 入口（crm/js/modules/console/） | 主云函数 | 备注 |
| --- | --- | --- | --- | --- |
| 客户 | #/customers、#/customer/:id | customers 等页面 | customers / followups / products / gifts / photos | 回收站级联靠同一 deleted_at 时间戳 |
| Person 360 | （旧详情 #/customer/:id 保留） | person 页 | person_360 | interactions 查询经 person_360 委托（service_role） |
| 机会 | （旧 customer 机会） | opportunities 页 | opportunities | Person 专属与旧 customer 机会权限隔离 |
| 活动 | #/activity/customer | activities 页 | activities / activity_reports / activity_tasks / activity_topics / activity_speakers | 活动详情互动/名单/机会候选页签已上线 |
| 招募 | #/recruit、#/recruit/:id | — | recruit_candidates / recruit_followups / recruit_goals / recruit_score / recruit_recommend | WP13 未实施；Person-only 招募待设计 |
| AI | #/ai-suggestions | assistant 相关页面 | assistant / ai_parse / ai_recommend / ai_recommendations / ai_activity / ai_followup / today_coach / funnel_insight / ai_referral | 模型由 AI Gateway 配置 |

---

## PMC-05：数据库结构扩展（2026-10-08）

| 对象 | 变更类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `public.customers.person_id` | 新增列 bigint NULLABLE | 阶段 2 双写（待 PMC-06+）；当前无消费者 | PMC-05 | 已应用 | evidence/PMC-05.md §3 |
| `idx_customers_person_id` | 新建部分索引（WHERE person_id IS NOT NULL） | 查询优化器；当前空索引 | PMC-05 | 已应用 | evidence/PMC-05.md §3 |
| `customers_person_id_key` | UNIQUE(person_id) 约束 | 回填时保证一对一 | PMC-05 | 已应用 | evidence/PMC-05.md §3 |
| `customers_person_id_fkey` | FK→persons(id) ON DELETE RESTRICT | D10：删客户角色不级联删 Person | PMC-05 | 已应用 | evidence/PMC-05.md §3 |
| `tools/migration-apply.cjs` | 新增：migration 执行工具（经 cloudbase-mcp，支持 DDL） | PMC-05+ 后续 migration | PMC-05 | 已落盘（MCP 认证失效未用上；实际用 tcb db execute） | evidence/PMC-05.md §6 |
| `cloudbase/migrations/20261008120000_customers_person_id.sql` | 新增：主 migration（4 步） | 数据库 | PMC-05 | 已应用 | evidence/PMC-05.md §2 |
| `cloudbase/rollbacks/20261008120000_customers_person_id.sql` | 新增：回滚（4 步） | 数据库 | PMC-05 | 已落盘 | evidence/PMC-05.md §6 |
| **不变项**：customers.customer_name UNIQUE（客户列表_姓名_key） | 保留（D5 退出条件未满足） | 客户建档流程 | PMC-05+ | 保留 | evidence/PMC-05.md §3 |
| **不变项**：legacy_customer_id 列及复合 FK | 保留（D8 退出条件未满足） | 桥接查询 | PMC-05+ | 保留 | evidence/PMC-05.md §3 |
| **不变项**：RLS 策略 | 不修改（C7 权限不变） | security_invoker 视图 | PMC-05 | 不变 | evidence/PMC-05.md §4 |
| **不变项**：12 个视图 | 不重建（显式列名；视图重建属阶段 3） | 查询路径 | PMC-05 | 不变 | evidence/PMC-05.md §5 |
