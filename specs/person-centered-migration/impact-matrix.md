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
| v_recruit_candidates | recruit_candidates LEFT JOIN customers + LEFT JOIN persons（G-PMC11-2 结构；PMC-12 读切换） | 人物基础 7 列 Person 优先、customers 回退：customer_name=COALESCE(p.display_name, c.customer_name)，gender/birthday/phone/occupation/education=COALESCE(p.x, c.x)，wx_account=COALESCE(p.wechat, c.wx_account)；annual_income/mbti/source/marital_status/hobbies/additional_info 保持 customers（客户域权威） |
| v_recruit_candidates_trash | 同上（LEFT JOIN 结构） | customer_name/phone/occupation 同规则 Person 优先切换（PMC-12）；customer_deleted_at 保留「随客户删除」标识 |
| v_recruit_candidates_person_only | persons | 仅 persons |
| v_recruit_candidates_person_only_trash | persons | 仅 persons |
| v_funnel_stats | customers + opportunities + recruit_candidates | 从 customers 读取 |
| v_action_center | customers + followups + opportunities + recruit_candidates + recruit_followups + activity_tasks + activities（5 个人物分支 LEFT JOIN persons，PMC-10） | persons.display_name COALESCE 回退 customer_name（展示名；过滤/排序/分桶不变） |
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
| policy_review_reports | list/get/generate/update/remove | admin.html | policy_review_reports JOIN customers / 子表 + persons（PMC-11） | policy_review_reports | customer_id/customer_name | customers+persons | persons | authenticated | PMC-11 已验收（2026-10-09 用户最终确认）（generate ctx 基础 8 字段取 Person、落库快照名取 Person；家庭/保单业务字段仍取 customers；list/get/update/remove 不变） | evidence/PMC-11.md |
| ocr_records | list/create/update/remove | admin.html | ocr_records | ocr_records | customer_id | customers | persons | authenticated | 需修改 | remove 返回 customer_snapshot，前端调 customers.update 恢复 |
| ai_recommendations | list/listAll/get/create/update/update_status | admin.html | ai_recommendations JOIN customers + persons（PMC-11） | ai_recommendations | customer_id/customer_name | customers+persons | persons | authenticated | PMC-11 已验收（2026-10-09 用户最终确认）（**非模型入口**：create 手工保存快照名取 Person 当前名；listAll 关键词双名匹配 Person 当前名+行内历史快照名；历史行不批量改写；list/get/update/update_status 不变） | evidence/PMC-11.md |

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
| activities | addParticipant | admin.html 活动详情 | activity_participants + customers/v_recruit_candidates/activity_speakers（按 person_type 回填名） | activity_participants（person_id=业务表主键+person_name 快照；**不写 canonical**，guard 服务端独占） | person_id（业务表主键：customer→customers."Id"、recruit→candidates.id、speaker→activity_speakers.id）+person_type | persons（canonical 层） | persons | authenticated | PMC-14 已核实语义+回归（person_id 业务表语义不变；暂存行 person_id=null 快照名落库） | evidence/PMC-14.md |
| activities | linkParticipant | admin.html 活动详情 | activity_participants + 按类型业务表（回填名） | activity_participants.person_id/person_name（**不动 canonical**，guard 拦截非 service_role 写） | person_id（业务表主键） | persons（canonical 层） | persons | authenticated | PMC-14 已核实+回归（同活动同类型同人去重保留） | evidence/PMC-14.md |
| activities | updateParticipant | admin.html 活动详情 | activity_participants | activity_participants | participant_id | persons（canonical 层） | persons | authenticated | 仅回归（PMC-14：状态留参与记录，语义不变） | — |
| activities | removeParticipant | admin.html 活动详情 | activity_participants | activity_participants.deleted_at | participant_id | persons（canonical 层） | persons | authenticated | 仅回归（软删语义不变） | — |
| activities | searchPerson | admin.html 活动详情 | persons | — | person_id | persons | persons | authenticated | 已核实无影响 | Person 原生搜索 |
| activities | listByPerson | Console 活动页 | activity_participants | — | canonical_person_id | persons | persons | authenticated | 已核实无影响（按 canonical 读，PMC-14 复核） | — |
| activities | getSummary | admin.html 活动详情 | activities + activity_participants | — | — | — | — | authenticated | 仅回归 | — |
| activities | get（enrichParticipants） | admin.html 活动详情 | activity_participants + persons + 按类型业务表 | —（仅返回值，不写库） | canonical_person_id（输出字符串 R-ID1） | persons（展示名 Person 优先，软删回退业务表回填名/快照名；D6 快照不可变） | persons | authenticated | PMC-14 已实施（待用户验收）（canonicalPersonId 新增返回+展示名 Person 优先） | evidence/PMC-14.md |
| activities | applyTopics | admin.html 活动详情 | activity_topics | activities.topic_ids | — | — | — | authenticated | 仅回归 | — |
| activities | getActivityData | Console 活动页 | 委托 person_360 listActivityData | — | canonical_person_id | persons | persons | authenticated | 已核实无影响（PMC-14 复核读取方语义） | — |
| activity_speakers | list/get/create/update/remove/search | admin.html 嘉宾管理 | activity_speakers + persons（PMC-13 enrichIdentity Person 优先读）+ customers/v_recruit_candidates（回退） | activity_speakers | customer_id/person_id | persons（PMC-13） | persons | authenticated | PMC-13 已实施（待用户验收）（enrichIdentity Person 优先读 name/phone/wechat/organization+linked_person 字段；create 去掉自动建 Person+customers 分支，嘉宾身份不自动代表销售客户） | evidence/PMC-13.md |
| activity_tasks | list/get/create/update/complete/skip/remove | admin.html 活动任务 | activity_tasks + activities + customers + persons + v_recruit_candidates | activity_tasks | related_id | — | — | authenticated | PMC-10 已切换（related_type=customer 的 related_name 经 persons 取名，customer_name 回退） | evidence/PMC-10.md |
| activity_topics | list/get/create/update/remove/search | admin.html 活动主题 | activity_topics | activity_topics | — | — | — | authenticated | 仅回归 | 无身份字段 |
| activity_reports | customer/recruit | admin.html 活动报告 | 多表（customers/followups/gifts/photos/products/policy_review_reports/ai_recommendations/recruit_candidates/recruit_followups/recruit_milestones/ocr_records）+ persons | — | customer_id | customers | persons | authenticated | PMC-10 已切换（展示名经 persons 覆盖；totals/daily 统计字段不动） | evidence/PMC-10.md |

#### 6.4 招募域

| 函数 | action | 入口 | 读取表 | 写入表 | 身份 ID 类型 | 当前权威来源 | 目标来源 | 权限上下文 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recruit_candidates | list | admin.html #/recruit | v_recruit_candidates | — | candidate_id（字符串） | 视图（PMC-12：Person 优先+customers 回退） | persons | authenticated | PMC-12 已实施（待用户验收） | evidence/PMC-12.md |
| recruit_candidates | get | admin.html #/recruit/:id | v_recruit_candidates | — | candidate_id（字符串，candidateIdOf 校验非法拒绝） | 视图（PMC-12 读切换） | persons | authenticated | PMC-12 已实施（待用户验收） | evidence/PMC-12.md |
| recruit_candidates | create | admin.html | — | recruit_candidates + persons（触发器自动建） | customer_id/person_id（返回字符串化 id/person_id） | customers | persons | authenticated | PMC-12 已实施（待用户验收）（仍强制 customer_id=R-ID1、裁决③；existing_id 幂等；AI 复盘 B 类采纳改 confirmRecruitConversion 预览人工确认，裁决②） | evidence/PMC-12.md |
| recruit_candidates | update | admin.html | — | recruit_candidates | candidate_id（字符串） | customers（业务列） | persons | authenticated | PMC-12 已实施（待用户验收）（字符串 ID 精确命中+非法拒绝；业务列写语义不变） | evidence/PMC-12.md |
| recruit_candidates | remove | admin.html 回收站 | — | recruit_candidates.deleted_at | candidate_id（字符串） | customers | persons | authenticated | PMC-12 已实施（待用户验收）（RPC recruit 分支零改动，不动 customers/persons） | evidence/PMC-12.md |
| recruit_candidates | trashList | admin.html 回收站 | v_recruit_candidates_trash | — | candidate_id（字符串） | 视图（PMC-12：3 列 Person 优先切换） | persons | authenticated | PMC-12 已实施（待用户验收） | evidence/PMC-12.md |
| recruit_candidates | restore | admin.html 回收站 | — | recruit_candidates.deleted_at=NULL | candidate_id（字符串） | customers | persons | authenticated | PMC-12 已实施（待用户验收）（恢复不动 customers/persons 其他角色） | evidence/PMC-12.md |
| recruit_candidates | funnel | admin.html 漏斗 | recruit_candidates | — | — | — | — | authenticated | 仅回归 | 聚合统计；PMC-12 随 S2 浏览器回归 PASS |
| recruit_candidates | rcMap | admin.html 雷达图 | recruit_candidates | — | customer_id | customers | persons | authenticated | PMC-12 核实不涉及（雷达图业务列，无人物基础字段读写） | — |
| recruit_followups | list/create/update/remove | admin.html 招募跟进 | recruit_followups | recruit_followups | candidate_id | recruit_candidates | persons | authenticated | PMC-12 核实不涉及（无人物基础字段读写） | 通过 candidate_id 间接关联 |
| recruit_goals | listGoals/saveGoals/getProgress/listBenchmarks/saveBenchmarks | admin.html 招募目标 | recruit_goals + recruit_goal_benchmarks + recruit_milestones | recruit_goals + recruit_goal_benchmarks | — | — | — | authenticated | 仅回归 | RPC crm_recruit_goals_save_v1；PMC-12 核实不涉及 |
| recruit_score | （固定入口） | admin.html 增员评分 | v_recruit_candidates + persons（PMC-11） | recruit_candidates.potential_score/potential_reason | customer_id/person_id | customers+persons | persons | authenticated | PMC-11 已验收（2026-10-09 用户最终确认）（评分 prompt 姓名/性别/出生/职业/学历取 Person；年收入/MBTI/动机/顾虑仍取候选人域；分数回写路径不变）；PMC-12 增量：candidate_id 字符串透传（R-ID2），回写仍仅 potential_score/potential_reason/updated_at | evidence/PMC-11.md；evidence/PMC-12.md |
| recruit_recommend | （固定入口） | admin.html 增员推荐 | v_recruit_candidates + persons（PMC-11） | — | customer_id/person_id | customers+persons | persons | authenticated | PMC-11 已验收（2026-10-09 用户最终确认）（facts 基础字段取 Person + identity 回传；不持久化；业务字段仍取视图）；PMC-12 增量：candidate_id 字符串透传（R-ID2） | evidence/PMC-11.md；evidence/PMC-12.md |

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
| ai_followup | analyze_profile / parse | admin.html 客户详情 | customers + followups + persons（PMC-11） | —（只返回不写库） | customer_id/person_id | customers+persons | persons | AI Gateway | PMC-11 已验收（2026-10-09 用户最终确认）（parse/analyze_profile 基础字段取 Person；爱好/婚况/客户阶段仍取 customers；冲突/未映射前置标注） | evidence/PMC-11.md |
| ai_followup | analyze_recruit_profile | admin.html 招募详情 | recruit_candidates + recruit_followups + persons（PMC-11） | — | candidate_id/person_id | recruit+persons | persons | AI Gateway | PMC-11 已验收（2026-10-09 用户最终确认）（候选人基础字段取 Person；年收入/婚况仍取候选人域） | evidence/PMC-11.md |
| ai_recommend | （固定入口） | admin.html AI 推荐 | customers + followups + products + gifts + activity_participants + opportunities + persons（PMC-11） | ai_recommendations（快照名取 Person，PMC-11） | customer_id/person_id | customers+persons | persons | AI Gateway | PMC-11 已验收（2026-10-09 用户最终确认）（ctx 基础字段取 Person；销售域不动；历史行不改写；返回 identity）；真实模型链路未实测（隔离验证） | evidence/PMC-11.md |
| ai_referral | （固定入口） | admin.html 转介绍 | customers + followups + products + gifts + activity_participants + opportunities + persons（PMC-11） | — | customer_id/person_id | customers+persons | persons | AI Gateway | PMC-11 已验收（2026-10-09 用户最终确认）（ctx Person 化 + identity 回传，不写库）；**真实模型生产实测 PASS（1 条，虚构客户 788）** | evidence/PMC-11.md §6.3 |
| ai_activity | analyze / prepare / decompose / recommendSpeakers / recommendTopics / participantReview / postReview / learning（PMC-01 登记名 activity_review 为泛称） | admin.html 活动复盘/筹备/讲者/主题/事实单/会后/学习 | activities + activity_participants + activity_speakers + persons + customers/recruit_candidates 回退（PMC-11） | —（postReview 等既有写语义不变） | activity_id / canonical_person_id / person_id | participants+persons | persons | AI Gateway + service_role (CRM_ACTIVITY_REVIEW_DB_API_KEY) | PMC-11 已验收（2026-10-09 用户最终确认）（参与者取名 Person 化，canonical 优先精确外键回退，姓名不作身份证据；独立候选人缺陷已修复；嘉宾名仍取嘉宾域；编造 ID 白名单清洗见 participantReview/postReview；analyze top3 缺白名单=G-PMC11-1 登记）；无虚构测试活动故真实模型未实测 | evidence/PMC-11.md §7/§11 |
| ai_activity | meeting_prep | admin.html 会前准备 | persons + interactions | — | person_id | persons | persons | AI Gateway | 已核实无影响 | — |
| ai_activity | person_basic | admin.html | persons | — | person_id | persons | persons | AI Gateway | 已核实无影响 | — |
| ai_activity | quick_capture | admin.html | — | — | — | — | — | AI Gateway | 仅回归 | — |
| context-engine | recruit_coach 配方（经 skill-registry/assistant 调用；非 ai_activity index.js 分派 action） | Console/AI skill | recruit_candidates + customers→persons（经 PMC-11 person()） | — | candidate_id/customer_id | customers+persons | persons | AI Gateway | PMC-11 已验收（2026-10-09 用户最终确认）（配方 `person(customerId)` 经更新后 person()：legacy 客户→person_id→persons 输出 identity/person_profile；独立候选人（customer_id 为空）经 G-PMC11-2 视图修复后对调用方可见（姓名 COALESCE 取 persons，见 §11.2 G-PMC11-2 行）） | evidence/PMC-11.md；context-engine.js L250-262 |
| ai_activity | today_coach | admin.html | customers + followups + opportunities + recruit_candidates + activities + v_action_center | — | customer_id | customers | persons | AI Gateway | PMC-10 已切换（读取多表含 customers；展示名经 persons 覆盖） | evidence/PMC-10.md |
| today_coach | candidates | admin.html Dashboard | customers + followups + opportunities + recruit_candidates + activities + v_action_center + persons | — | customer_id | customers | persons | service_role (CRM_TODAY_DB_API_KEY) | PMC-10 已切换（loadAll 展示名覆盖，统计字段不动） | evidence/PMC-10.md |
| today_coach | generate | admin.html Dashboard | 同上 | — | customer_id | customers | persons | service_role | PMC-10 已切换（同上） | evidence/PMC-10.md |
| today_coach | daily_review | admin.html 复盘 | 同上 | — | customer_id | customers | persons | service_role | PMC-10 已切换（同上） | evidence/PMC-10.md |
| today_coach | cockpit | admin.html 驾驶舱 | 同上 | — | customer_id | customers | persons | service_role | PMC-10 已切换（同上） | evidence/PMC-10.md |
| funnel_insight | stats | admin.html 漏斗 | v_funnel_stats | — | — | customers | persons | authenticated | PMC-10 核实无影响（纯计数视图，无姓名列，不修改） | evidence/PMC-10.md §6 |
| funnel_insight | explain | admin.html 漏斗 | v_funnel_stats | — | — | customers | persons | authenticated | PMC-10 核实无影响（同上） | evidence/PMC-10.md §6 |

### 七、专项调用链核查结果

#### 7.1 嘉宾创建过程中直接查询或创建 customers

**PMC-13 已修复**：`activity_speakers` 云函数 `create` action 原在未传 `customer_id` 时按姓名查询 `customers` 表无匹配则自动 insert 建档（PMC-01 impact-matrix §7.1 登记）；PMC-13 裁决②已去掉自动建 Person+customers 分支，新行为仅创建 activity_speakers 行，不关联客户。

- 文件：`cloudfunctions/activity_speakers/index.js` L136-148（PMC-13 改造后）
- 状态：**已修改（PMC-13，待用户验收）**——嘉宾身份不自动代表销售客户，不强制创建客户档案；person_id 由 service_role 写入（走 person_360 identity 入口）
- 影响：admin.html 嘉宾管理页（已走 person_360 identity 入口，L6011/L6015→previewIdentity/executeIdentity）

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
- 状态（PMC-10 更新）：
  - `v_funnel_stats`：**核实无影响，不修改**——纯计数视图（funnel/stage/current_count 等），无姓名列，漏斗统计口径不依赖身份展示字段
  - `v_action_center`：**PMC-10 已切换**——5 个人物分支 LEFT JOIN persons，展示名 COALESCE(display_name, customer_name)；`v_recruit_candidates` 视图切换留待招募域包（PMC 后续）

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

---

## PMC-06：数据回填（2026-10-08）

| 对象 | 变更类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `public.customers.person_id` | 数据回填（779 行） | 阶段 2 双写（待 PMC-07+） | PMC-06 | 已回填 | evidence/PMC-06.md §3 |
| `tests/security/.results/pmc06-batch-log.json` | 批次日志（本次单批次 UPDATE） | 审计/回滚依据 | PMC-06 | 已落盘 | evidence/PMC-06.md §4 |
| **未处理项**：A1–A3（customer 786/789/790 无 Person） | 跳过（留待后续确认） | — | PMC-06 | 跳过 | evidence/PMC-06.md §5 |
| **未处理项**：A5（person 787 身份核实） | 跳过（留待后续确认） | — | PMC-06 | 跳过 | evidence/PMC-06.md §5 |
| **未处理项**：D1（occupation 单边差异） | 跳过（留待后续确认） | — | PMC-06 | 跳过 | evidence/PMC-06.md §5 |
| **未处理项**：E1–E7（7 组同名不同人） | 跳过（基础资料全空，需人工核实） | — | PMC-06 | 跳过 | evidence/PMC-06.md §5 |

---

## PMC-10：Today、任务、漏斗和统计的身份来源统一（2026-10-08）

| 对象 | 变更类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `public.v_action_center` | CREATE OR REPLACE（5 个人物分支 JOIN persons，展示名 COALESCE；列/过滤/排序/分桶不变） | admin.html 行动中心 + today_coach + assistant | PMC-10 | 已应用 | evidence/PMC-10.md §3 |
| `cloudbase/rollbacks/20261008223000_pmc10_action_center_person_names_rollback.sql` | 新增：回滚（恢复原视图定义） | 数据库 | PMC-10 | 已落盘（未执行） | evidence/PMC-10.md §3 |
| `cloudfunctions/today_coach/index.js` | 修改：loadAll 加 persons 查询 + personNameMap 展示名覆盖（统计字段不动） | admin.html Dashboard/复盘/驾驶舱 | PMC-10 | 已部署 | evidence/PMC-10.md §4 |
| `cloudfunctions/activity_reports/index.js` | 修改：custName 经 persons 覆盖 + feed 6 处展示名（totals/daily 不动） | admin.html 活动报告 | PMC-10 | 已部署 | evidence/PMC-10.md §4 |
| `cloudfunctions/activity_tasks/index.js` | 修改：enrichRelated customer 分支经 persons 取 related_name | admin.html 活动任务 | PMC-10 | 已部署 | evidence/PMC-10.md §4 |
| `funnel_insight` / `v_funnel_stats` | **不修改**（纯计数，无姓名列） | admin.html 漏斗 | PMC-10 | 核实无影响 | evidence/PMC-10.md §6 |
| `activity_topics` / `assistant` | **不修改**（grep 核实无 customer_name/persons 读取） | admin.html 活动主题 / AI | PMC-10 | 核实无影响 | evidence/PMC-10.md §6 |
| before/after 快照（166 行、6 类计数、distinct_names、null=0） | 统计差异=**零** | 验收证据 | PMC-10 | 已核对 | tests/security/.results/pmc10-before/after-snapshot.json |
| 一致性核查（dup_person_rows=0、cust_with_multi_candidates=0、已映射姓名差异=0） | 无重复计数、展示内容零变化 | 验收证据 | PMC-10 | 已核对 | tests/security/.results/pmc10-consistency-check.json、pmc10-mismatch-breakdown.json |
| **不变项**：优先级/到期/日期分桶/销售阶段/招募阶段/去重/下一步行动规则 | 不修改（本包不新增推荐算法） | 行动中心/Tasks/漏斗/活动量 | PMC-10 | 不变 | evidence/PMC-10.md §7 |
| `public.persons` 权限 | **新增（用户特批方案 A）**：GRANT SELECT TO anon + RLS 策略 `persons_anon_read`（USING deleted_at IS NULL，只读、只暴露未软删行） | rdb() 匿名角色（全部云函数 persons 直读 + security_invoker 视图 JOIN persons） | PMC-10 验收修复 | 已应用（2026-10-08） | evidence/PMC-10.md §9；migration/rollback `20261008231500_pmc10_*` |
| 验收教训 | pg-readonly 管理通道验证不能代表 rdb() 匿名角色权限；权限类回归必须经浏览器真实通道验收 | 后续所有 PMC 包的验证方法 | PMC-10 验收 | 已登记 | evidence/PMC-10.md §9.2 |

---

## PMC-11：AI 上下文、搜索及结果保存适配 Person（2026-10-08 开发／2026-10-09 发布，**2026-10-09 用户最终验收通过**）

### 11.1 字段来源分界

| 来源 | 字段 | 适用 AI 入口 |
| --- | --- | --- |
| persons（经 person_id，未映射回退+禁猜测提示、冲突标注） | display_name、gender、birthday、phone、wechat、occupation、organization、education | 全部本包改造的模型/非模型入口 |
| customers（客户业务域不动） | customer_stage、sales_priority、annual_income、hobbies、marital_status、children_info、properties_info、additional_info、source | ai_recommend/ai_referral/ai_followup(analyze_profile,parse)/policy_review_reports/recruit_* |
| recruit_candidates / v_recruit_candidates（招募业务域不动） | stage/各 priority、annual_income、mbti、motivation、concerns、work_experience、family_situation、personality_tags、career_plan、雷达/赢家报告 | recruit_score/recruit_recommend/ai_followup(analyze_recruit_profile)/ai_activity 参与者 |
| activity_speakers（嘉宾域不动） | name/organization/phone | ai_activity 讲者建议 |
| 活动/参与域（不动） | stage/priority/additional_info、席位/出席事实 | ai_activity 全部 action |
| 派生快照（新写入取 Person 当前名；历史不改写） | ai_recommendations.payload.customer_name、policy_review_reports 快照名 | create/generate 新行；listAll 双名搜索（Person 当前名 + 行内历史快照名） |

### 11.2 变更与部署矩阵

| 对象 | 变更类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `_shared/context-engine.js` | VERSION 1.1.0：FIELDS 扩列；person() 经 customers.person_id 读 persons 输出 person_profile+identity（unmapped/conflicts）；activity_review 身份解析 canonical/精确外键 | assistant skill-registry（person_basic/meeting_prep/recruit_coach/activity_review 配方） | PMC-11 | 已验收（2026-10-09） | evidence/PMC-11.md §3；SHA-256 `9650E7DF…F4013` |
| `ai_activity/context-engine.js` | 母本同步副本（哈希一致）；postReviewV2 唯一现网消费者 | crm/js/modules/activity-review-v2.js | PMC-11 | 已验收（随 ai_activity） | 同上 |
| `ai_activity/index.js` | 8 个 action 参与者取名 Person 化 + loadPersonNameMap/participantPersonId + loadRecruitPeople 修复独立候选人过滤 | admin.html 活动 AI（analyze/prepare/decompose/recommendSpeakers/recommendTopics/participantReview/postReview/learning） | PMC-11 | 已验收（修复后二次部署；真实模型未实测属已知覆盖限制） | evidence/PMC-11.md §3/§7/§9 |
| `ai_recommend/index.js` | identity helper；ctx 基础字段 Person 化；落库快照名取 Person；返回 identity | admin.html AI 推荐 | PMC-11 | 已验收（真实模型未实测属已知覆盖限制，隔离验证） | evidence/PMC-11.md §9 |
| `ai_referral/index.js` | 同模式 ctx Person 化；不写库；返回 identity | admin.html 转介绍 | PMC-11 | 已验收（**真实模型生产 PASS 1 条**） | evidence/PMC-11.md §6.3 |
| `ai_followup/index.js` | 兼容 helper + 客户/候选人双措辞 notice；parse/analyze_profile/analyze_recruit_profile 接入；不写库 | admin.html 跟进解析/画像 | PMC-11 | 已验收（真实模型未实测属已知覆盖限制） | evidence/PMC-11.md §9 |
| `policy_review_reports/index.js` | generate ctx Person 化；TEST_MARKER 判断改 ident.name；落库快照名取 Person | admin.html 保单检视 | PMC-11 | 已验收（真实模型未实测属已知覆盖限制） | evidence/PMC-11.md §9 |
| `recruit_score/index.js` | buildScoringPrompt Person 化；potential_score 回写不变；返回 identity | admin.html 增员评分 | PMC-11 | 已验收（回写有隔离断言；真实模型未实测属已知覆盖限制） | evidence/PMC-11.md §6.2 |
| `recruit_recommend/index.js` | buildUser facts 取 ident；不持久化；返回 identity | admin.html 增员推荐 | PMC-11 | 已验收（**G-PMC11-2 修复后候选人 20 真实模型生产 PASS**） | evidence/PMC-11.md §11/§14 |
| `ai_recommendations/index.js` | **非模型入口**：create 快照名取 Person（select 加 person_id）；listAll 双名搜索；历史行不改写；list/get/update/update_status 不变 | admin.html #/ai-suggestions、手工创建/列表/搜索 | PMC-11 | 已验收（生产前端 listAll 双名搜索浏览器实测 PASS；隔离验证） | evidence/PMC-11.md §14 |
| `tests/pmc/pmc11-identity.test.cjs` | 19 离线用例（拦截 8 函数目录 db 副本 + 确定性模型桩；不触线上） | PMC 测试套件（独立，不入 release gate） | PMC-11 | 19/19 通过 | tests/security/.results/pmc11-isolated.tap.txt |
| assistant / person_360 / ai_parse / _shared/ai.js(AI Gateway) / skill-registry / person-service.js | **不修改**：白名单+GUIDANCE 禁 SQL/禁姓名自选已合规；统一写服务已 Person 原生；模型配置无硬编码 | — | PMC-11 | 核实无影响 | evidence/PMC-11.md §10 |
| ai_tasks/ai_runs/ai_results 与历史 ai_recommendations 行 | **不批量改写**（历史快照保持当时事实） | 审计/历史检索 | PMC-11 | 不变 | evidence/PMC-11.md §2/§12 |
| admin.html / console.html / 全部静态文件 | 零改动 | — | PMC-11 | 不变 | sync-check admin.html SHA 不变 |
| 数据库 | 无 migration/rollback；persons anon 只读复用 PMC-10 20261008231500 授权 | — | PMC-11 | 无变更 | — |
| **G-PMC11-1**（既有缺陷登记） | ai_activity analyze top3/no_followup 仅 parseInt 未按真实参与者 ID 白名单过滤，编造 ID 透传；非本包引入 | analyze 输出消费方 | PMC-11 登记 | **未修**（修复须单独授权；隔离测试锁定现状） | evidence/PMC-11.md §11 |
| **G-PMC11-2**（既有缺陷修复） | `v_recruit_candidates` / `v_recruit_candidates_trash` 视图 INNER JOIN customers 过滤独立候选人（customer_id 为空），recruit_recommend/recruit_score/工作台对其返回「candidate not found」；cbad9aa 已存在，非本包引入 | recruit_recommend / recruit_score / recruit_candidates / ai_activity / ai_parse 等所有读取该视图的入口 | PMC-11 修复（用户单独批准） | **已修复（2026-10-09）**：两视图改 LEFT JOIN customers + LEFT JOIN persons，customer_name 改 `COALESCE(c.customer_name, p.display_name)`，列名/列序/类型/security_invoker/GRANT 不变；验证：14→15 行零差异、trash 3 行一致、浏览器真实链路 PASS、隔离测试复跑 19/19 | evidence/PMC-11.md §11 |

### 11.3 身份与搜索安全核实（静态 + 隔离）

- assistant search-service.js：3 个固定模板、GUIDANCE 明确禁模型生成 SQL/禁按姓名自行选人、查询白名单 `public.crm_search_people_v1`、refs `{table:'persons', id}`、`businessDataWritten:false`——本轮未改，拒绝路径真实触发未实测（evidence §9 未验证项 4）。
- 全部新增 persons 查询带 `deleted_at IS NULL`；ID 全程字符串/整数精确匹配，姓名从不作为身份证据（participantPersonId canonical 优先 → customers/recruit_candidates.person_id 精确回退）。
- 映射基线：customers 779/782 已映射、姓名冲突 0；recruit_candidates 15/15 有 person_id（候选人 20 为独立候选人、customer_id 为空，修复前被视图 INNER JOIN 过滤，**G-PMC11-2 修复后可见**）。

---

## PMC-13：嘉宾模块完成 Person 与合作资料分离（2026-10-09，待用户验收）

### 13.1 字段来源分界

| 来源 | 字段 | 适用入口 |
| --- | --- | --- |
| persons（经 activity_speakers.person_id，Person 优先读+原值回退） | display_name（→name 覆盖）、phone、wechat、organization | activity_speakers list/get（enrichIdentity）、ai_activity 嘉宾参与者 name、recommendTopics 嘉宾池 name |
| activity_speakers（嘉宾业务域，不动） | relationship_stage、expertise、topic_summary、source、cooperation_count、preferred_format、status、notes、customer_id、recruit_candidate_id | activity_speakers 全 action |
| persons 写入 | 本包零写入；person_id 由 person_360 identity command 写入 | — |

### 13.2 变更与部署矩阵

| 对象 | 变更类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `activity_speakers/index.js` enrichIdentity（L72-115） | Person 优先读 name/phone/wechat/organization+linked_person 字段+customers/v_recruit_candidates 回退 | admin.html 嘉宾管理（list/get） | PMC-13 | 已部署（待用户验收） | evidence/PMC-13.md §3 |
| `activity_speakers/index.js` create（L136-148） | 去掉自动建 Person+customers 分支（裁决②）；仅创建 activity_speakers 行 | admin.html 嘉宾管理 | PMC-13 | 已部署（待用户验收） | evidence/PMC-13.md §3 |
| `ai_activity/index.js`（L304-321, L467-481） | 嘉宾参与者 name + recommendTopics 嘉宾池 name Person 优先读（裁决③） | admin.html 活动 AI | PMC-13 | 已部署（待用户验收） | evidence/PMC-13.md §3 |
| `tests/pmc/pmc13-speaker.test.cjs` | 9 离线用例（拦截 db 副本+内存 RDB fixture；不触线上） | PMC 测试套件（独立，不入 release gate） | PMC-13 | 9/9 通过 | — |
| admin.html | **不修改**（裁决④：ensurePersonCustomer 死函数保留不动；嘉宾入口已走 person_360 identity） | — | PMC-13 | 不变 | evidence/PMC-13.md §10 |
| 数据库 | 无 migration/rollback | — | PMC-13 | 无变更 | — |
| activities / activity_tasks / activity_reports / person_360 | **不修改**（activity_tasks/activity_reports PMC-10 已切换；person_360 linkSpeakerPerson/createSpeakerProfile 已 Person 原生） | — | PMC-13 | 核实无影响 | evidence/PMC-13.md §10 |
| customers / persons 数据 | 零修改 | — | PMC-13 | 不变 | — |

## PMC-15：角色及关系数据治理（2026-10-09，已发布，待用户验收）

### 15.1 数据库对象变更

| 对象 | 变更类型 | 消费者 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `person_roles` | origin CHECK 增 `derived`；新增 role CHECK 含 partner/referrer/alumni/other；行对账删 2（id 703/792 快照残留）补 2（person 777 customer/recruit） | 角色目录、筛选、badge | 已部署（生产漂移=0） | evidence/PMC-15.md §4 |
| `crm_person_roles_derive_v1(bigint)` | 新增 SECURITY DEFINER（service_role only）：按人重算 4 类派生角色（customer 直链+legacy 桥双路径、recruit、speaker、participant canonical），永不触碰人工角色 | 5 触发器 | 已部署；WP01 基线登记（anon/auth=false） | evidence/PMC-15.md §3 |
| `crm_person_role_sync_v1()` | 新增触发器函数（SECURITY DEFINER）：按 TG_TABLE_NAME 分支收集受影响 person 去重后调 derive | customers/recruit_candidates/activity_speakers/activity_participants/persons 5 个 AFTER 触发器 | 已部署；WP01 基线登记 | evidence/PMC-15.md §3 |
| `relationships` | 加 source/status/confirmed_at/confirmed_by_uid 4 列 + 类型词表 CHECK + 确认一致性 CHECK（默认 pending/manual；无写入路径，存量 0 行） | person_360、ai_activity、assistant、crm_search_people_v1 | 已部署 | evidence/PMC-15.md §3 |
| `crm_search_people_v1(text,jsonb)` | CREATE OR REPLACE 收紧：relationships 只认 status=confirmed（含模板 3 recent_declining_relationships） | assistant、person_360 搜索 | 已部署；RPC 冒烟 3 模板正常 | evidence/PMC-15.md §6 |
| `households` / `household_members` | 零结构变更，仅补 COMMENT（confirmed_at/by_uid 机制沿用；家庭关系词不与 relationships 混用） | 家庭页 | 已部署（行为不变） | evidence/PMC-15.md §2 |

### 15.2 函数与前端变更

| 对象 | 变更类型 | 调用方/消费者 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `cloudfunctions/_shared/context-engine.js`（ai_activity 副本同步） | FIELDS.relationships 增 status,source；activity_review 关系读取加 `status='confirmed'` | ai_activity | 已部署（两副本 SHA-256 一致） | evidence/PMC-15.md §5 |
| `cloudfunctions/person_360/meeting-prep-context.js` | 双向 relationships 读取加 status eq.confirmed，select 增 status,source | person_360 | 已部署 | evidence/PMC-15.md §5 |
| `crm/js/modules/person-profile.js` | ROLES 扩 8 角色（含 4 人工标记）、ORIGINS 增 derived、说明文案区分自动派生/人工标记 | 人物详情 | 已部署（在线 SHA 一致） | evidence/PMC-15.md §5 |
| `crm/js/modules/console/i18n.js` | 增 participant/role_partner/role_referrer/role_alumni/role_other 中英 key | Console | 已部署 | evidence/PMC-15.md §5 |
| `crm/js/modules/console/pages/people.js` | ROLE_BADGE 扩 8 角色配色；筛选/目录读 RPC（confirmed/派生行为随服务端） | 人物目录 | 已部署 | evidence/PMC-15.md §5 |
| `crm/js/modules/phase14-hubs.js` | 角色映射扩 8 角色 | Hub | 已部署 | evidence/PMC-15.md §5 |
| 其他 26 个云函数（assistant/ai_referral/customers/recruit_* 等） | 只读核查无修改：人物端点均以 person_id 引用；无姓名/客户身份依赖 | — | 核实无影响 | evidence/PMC-15.md §2 |
| admin.html | 不修改 | — | 不变（线上 SHA 一致） | evidence/PMC-15.md §5 |

### 15.3 规则落点

- 角色删除影响：业务角色随业务行有效状态派生，删业务角色（软删业务行）只清派生角色行；relationships/households/人工角色零影响（生产事务回归 s11 验证）。
- 删除恢复：业务行恢复→触发器重建派生角色；relationships 软删释放部分唯一槽，同边可重建。
- 角色缓存/目录/筛选：角色无独立缓存表；crm_search_people_v1 实时 JOIN；person_360 实时读；前端 badge 随返回值，无本地角色副本。

## PMC-16：互动、跟进及其他业务引用与历史记录收口（2026-10-10，已发布，待用户验收）

### 16.1 业务引用图（归属裁决终表，11 表全盘点孤儿=0）

| 表 | 行数 | 业务真实主体 / 锚定 | 快照列（历史证据，不改写） |
| --- | --- | --- | --- |
| interactions | 9（全 manual） | 人物事实；person_id NOT NULL FK | raw_note |
| actions / commitments | 4 / 2 | 人物事实；person_id FK + uid 确认链 | — |
| followups | 250（软删 1） | 客户业务；customer_id FK 保留 | customer_name（5 行漂移=历史证据） |
| opportunities | 9（customer 7 / person-only 2） | 双轨保留（U5 退出另批） | referred_name/referred_relation |
| products / policy_review_reports / gifts / photos / ocr_records / ai_recommendations | 1 / 2 / 189 / 8 / 6 / 26 | 客户业务；customer_id FK 保留 | 各表 customer_name、ocr_records.customer_snapshot、ai_recommendations.nba（生命周期走 nba.status：open 25/skipped 1） |

**无任何 customer_id→person_id 替换；不加 person_id 列；零结构变更（无 migration）。**

### 16.2 函数与前端变更

| 对象 | 变更类型 | 调用方/消费者 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `cloudfunctions/_shared/interaction-service.js` + person_360 副本 | listForPerson 增 activeLegacy 防护（物化 legacy 副本源行已删→不复活；活跃物化行账本优先单条呈现，与 timeline 规则对齐）；现网 0 行物化 legacy 副本，零行为变化 | person_360.listInteractions（Console 互动页签） | 已部署（sync-shared 56 副本一致） | evidence/PMC-16.md §3 |
| `admin.html` OCR 删除分支（L3378-3414） | 恢复闭环修复：检查 customers.update 响应；OCR_SNAPSHOT_RESTORE_CONFLICT→展示「当前值(personSnapshot) vs 快照值」diff→人工确认 forceRestore:true 重试；假成功消除 | admin.html 客户详情 OCR 页签 | 已部署（50 在线资产 SHA 一致） | evidence/PMC-16.md §2.3/§3 |
| customers.update 服务端 / ocr_records.remove | 不修改（PMC-07/08 已有 personSnapshot 返回与冲突门，本包锁定其语义） | — | 核实不变 | 测试 A/C 组 |
| 其余 9 个业务函数（followups/gifts/photos/products/prr/ocr/ai_recommendations/opportunities/actions-commitments 经 person_360） | 只读核查无修改 | — | 核实无影响 | evidence/PMC-16.md §2 |

### 16.3 规则落点

- 时间线双轨：同一跟进=一条业务事实；Legacy 表权威、interactions 物化行仅未来导入产物；去重 key=source_type:source_id；来源标识 `public.表#id` 输出至 Console。
- OCR 恢复安全：跨角色修改后快照恢复受服务端冲突门+前端 diff 双重保护；冲突/失败不销毁恢复依据（冲突清单披露后才允许人工覆盖）；老快照 JSON 文本解析容错保持。
- 历史保护：历史作者（created_by/confirmed_by uid）、发生时姓名、合同/报告快照、AI 历史输出（ai_recommendations 行与 nba）均不改写。
