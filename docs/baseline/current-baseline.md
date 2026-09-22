# 当前 CRM 只读基线

检查日期：2026-09-21（Asia/Shanghai）。环境：crm-d1gkae8ddc930d151。

## 结论与范围

**基线已发生可确认的业务页面行为变化，停止后续工作包。** 本轮仅检查并生成本文件，未修复、部署、提交、推送、打标签或修改 Git 历史；未修改数据库、云资源、环境变量或业务代码。

指定基线：e41f50d7033893e0ccd2cd3d5a09417288e85753 / release-20260920-075851。
当前版本：147bd60a91406c37fa0556824485cebf14a2f1f9 / release-20260921-110000。

在当前工作区及指定基线 docs 文件清单中，未找到独立的原只读盘点报告。不能把旧 architecture-current.md 当作 2026-09-20 的实时数据库快照。本报告分别记录 Git 基线差异、现存旧文档差异及无法证明的历史变化。

数据库只查询限定 public 的元数据，不读取客户记录、不执行迁移。环境列表接口附带返回的 pr_ 函数不纳入 CRM 盘点，没有对其做详情查询、调用或变更；未查询 pr schema。

## Git 状态

| 项目 | 结果 |
| --- | --- |
| 分支 | master |
| HEAD | 147bd60a91406c37fa0556824485cebf14a2f1f9 |
| 检查开始 working tree | 干净，无暂存及未暂存改动 |
| origin fetch / push | https://github.com/VictorLiang2026/crm.git |
| 本地 origin/master | 与 HEAD 相同 |
| 实时远端 HEAD / master | 与 HEAD 相同 |
| 原标签解引用 | e41f50d7033893e0ccd2cd3d5a09417288e85753 |
| 当前标签解引用 | 147bd60a91406c37fa0556824485cebf14a2f1f9 |
| 原标签对象（远端） | 68c0b5a87259c06023d90312949e9ca885c833b3 |
| 当前标签对象（远端） | 2df3839241f5122a10e788c2928af27fb791fd44 |
| 相比基线 | 新增 1 个提交，2 个文件变化，15 行新增、1 行删除 |
| 报告输出后 | 仅新增未跟踪 docs/baseline/current-baseline.md |

远端通过 git ls-remote 实时读取，没有 fetch 或修改引用。默认 Schannel 读取失败后，使用单次命令的 http.sslBackend=openssl 成功；未修改持久 Git 配置。

唯一新增提交：147bd60 fix: preserve quick capture draft when clicking outside dialog。

## 所有可确认差异

| 对象 | 指定 Git 基线 → 当前 | 证据与影响 |
| --- | --- | --- |
| admin.html | 修改 1 行 | openQuickCapture 移除点击背景关闭弹窗的监听，替换为说明注释；快速录入草稿不会因点击背景丢失 |
| docs/release-20260921-quick-capture.md | 新增 14 行 | 记录该修复的发布与验证 |
| cloudfunctions/ | 无 Git 差异 | 代码目录相对基线未变 |
| cloudbaserc.json | 无 Git 差异 | 配置清单相对基线未变 |
| cloudbase/migrations/ | 无 Git 差异 | 31 个文件名称和内容相对基线未变 |
| 前端路由 | 无 Git 差异 | 路由分发函数未改动 |
| 线上 admin.html | 已不同于旧基线，等于本地当前版本 | HTTP 200，SHA-256 逐字节相同 |
| 本报告 | 本轮新增文件 | 仅本地保存，未提交发布 |

线上地址：https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html

- 当前本地/线上 SHA-256：ed857e177b0862768a3e793b5c752195e632697d6cd38dc40434b1fda7e4b6b4。
- 指定基线 Git blob SHA-256：43e85394c6733c0b5ff2bb89cd604592232aba17a3870993e381d58d0bfef282。

## public 数据库对象

实时查询 information_schema.tables（table_schema='public'），返回 29 行，未截断；另用 pg_catalog.pg_class / pg_namespace 限定 public 核实：**19 张普通表、10 个普通视图、0 个物化视图**。此数量不包括序列、索引、类型或数据库函数。

### 表（19）

| public 表名 | 列数 | RLS |
| --- | --- | --- |
| activities | 18 | 开启 |
| activity_participants | 13 | 开启 |
| activity_speakers | 22 | 开启 |
| activity_tasks | 14 | 开启 |
| activity_topics | 14 | 开启 |
| ai_recommendations | 12 | 开启 |
| customers | 28 | 开启 |
| followups | 15 | 开启 |
| gifts | 9 | 开启 |
| ocr_records | 10 | 开启 |
| opportunities | 14 | 开启 |
| photos | 12 | 开启 |
| policy_review_reports | 19 | **关闭** |
| products | 17 | 开启 |
| recruit_candidates | 27 | 开启 |
| recruit_followups | 16 | 开启 |
| recruit_goal_benchmarks | 9 | 开启 |
| recruit_goals | 8 | 开启 |
| recruit_milestones | 8 | 开启 |

RLS 标志只说明当前开关状态；未审计全部授权和策略，不据此认定实际数据暴露或访问安全。

### 视图（10）

定义指纹为 PostgreSQL md5(pg_get_viewdef(oid,true))，供后续同口径比较，不表示历史定义一致。

| public 视图名 | 列数 | 定义 MD5 |
| --- | --- | --- |
| ai_recommendations_view | 21 | 868df78f8ad3b3cbfb688b11e4595388 |
| customers_view | 43 | 36df9f3fb7d1223e863fa47bf8edf722 |
| followups_view | 18 | 2ab8286997a11f03f85126424d5411de |
| gifts_view | 23 | 8b5013564dfe7e20292dee5e6dc962e5 |
| photos_view | 15 | 906990465ea194375f3f10d46bc1633a |
| products_view | 33 | 64c5ef5750d41976c09d8bac06886bd7 |
| v_action_center | 14 | fa97a8e1f40a9af5200d3c370b3096f9 |
| v_funnel_stats | 10 | 2c71499b4d942b63b71415613e4ad032 |
| v_recruit_candidates | 38 | f0dc9254efee30dfa244b7feb96dfe7e |
| v_recruit_candidates_trash | 11 | 3049135b36cd38fe5901b6fa849a43ff |

## CRM Cloud Functions

当前环境函数列表一次请求 limit=100 / offset=0，实际完整返回 52 项；排除 pr_ 后 CRM 为 **26 个**，均 Active。与本地 26 个函数目录和配置清单名称一致。22 个 Nodejs18.15，4 个 Nodejs20.19。

修改时间按云端接口原值记录，不推断其时区。全部早于指定基线提交日期；这不是源码或环境变量逐项一致的证明。

| 函数 | Runtime | 状态 | ModTime（原值） |
| --- | --- | --- | --- |
| activities | Nodejs18.15 | Active | 2026-09-12 11:20:33 |
| activity_reports | Nodejs18.15 | Active | 2026-09-12 11:20:39 |
| activity_speakers | Nodejs18.15 | Active | 2026-09-15 23:15:47 |
| activity_tasks | Nodejs20.19 | Active | 2026-09-12 11:20:49 |
| activity_topics | Nodejs20.19 | Active | 2026-09-12 11:20:54 |
| ai_activity | Nodejs18.15 | Active | 2026-09-12 11:21:00 |
| ai_followup | Nodejs18.15 | Active | 2026-09-12 11:21:06 |
| ai_parse | Nodejs18.15 | Active | 2026-09-15 23:15:51 |
| ai_recommend | Nodejs18.15 | Active | 2026-09-12 11:21:21 |
| ai_recommendations | Nodejs18.15 | Active | 2026-09-12 11:21:28 |
| ai_referral | Nodejs18.15 | Active | 2026-09-12 11:21:33 |
| customers | Nodejs18.15 | Active | 2026-09-12 11:21:38 |
| followups | Nodejs18.15 | Active | 2026-09-12 11:21:44 |
| funnel_insight | Nodejs20.19 | Active | 2026-09-12 11:21:49 |
| gifts | Nodejs18.15 | Active | 2026-09-12 11:21:55 |
| ocr_records | Nodejs18.15 | Active | 2026-09-12 11:22:00 |
| opportunities | Nodejs18.15 | Active | 2026-09-12 11:22:07 |
| photos | Nodejs18.15 | Active | 2026-09-12 11:22:12 |
| policy_review_reports | Nodejs18.15 | Active | 2026-09-12 11:22:18 |
| products | Nodejs18.15 | Active | 2026-09-12 11:22:23 |
| recruit_candidates | Nodejs18.15 | Active | 2026-09-12 11:22:28 |
| recruit_followups | Nodejs18.15 | Active | 2026-09-12 11:22:33 |
| recruit_goals | Nodejs18.15 | Active | 2026-09-12 11:22:38 |
| recruit_recommend | Nodejs18.15 | Active | 2026-09-12 11:22:43 |
| recruit_score | Nodejs18.15 | Active | 2026-09-12 11:22:49 |
| today_coach | Nodejs18.15 | Active | 2026-09-12 11:22:54 |

本轮未完成云端源码包逐文件比对。CLI 只读下载帮助调用遇到 Access denied，未执行下载或修复工具。2026-09-21 发布记录中“26 个函数、108 个文件一致”仅为历史记录，不充当本轮验证结果。未读取环境变量明文。

## 前端路由

来自当前 admin.html 的 route()，**17 个路由模式**（包括首页默认回退）；ID 模式仅匹配数字，未识别 hash 回退工作台。静态托管入口仍为 /crm/admin.html。

| hash 路由 | 页面 |
| --- | --- |
| #/ | 客户工作台 |
| #/customers | 客户列表 |
| #/customers/trash | 客户回收站 |
| #/customer/:id | 客户详情 |
| #/ai-suggestions | AI 建议历史 |
| #/activity/customer | 客户活动量日报 |
| #/recruit | 增员工作台 |
| #/recruit/:id | 候选人详情 |
| #/recruit/goals | 增员目标 |
| #/recruit/trash | 增员回收站 |
| #/activity/recruit | 增员活动量日报 |
| #/today | 今日教练 |
| #/funnels | 漏斗分析 |
| #/activities | 活动列表 |
| #/activity/:id | 活动详情 |
| #/speakers | 讲师管理 |
| #/topics | 主题管理 |

路由静态检查与指定 Git 基线一致；没有登录或调用业务接口做运行回归。

## 与现有旧文档的差异（不是基线之后新增的证明）

docs/architecture-current.md 记载 13 张表、8 个视图、16 个云函数、10 条路由及 16 个迁移文件；当前盘点分别为 19、10、26、17、31。

- 表多列出 6 张：activities、activity_participants、activity_speakers、activity_tasks、activity_topics、opportunities。
- 视图多列出 2 个：v_action_center、v_funnel_stats。
- 路由多列出 7 条：#/recruit/:id、#/today、#/funnels、#/activities、#/activity/:id、#/speakers、#/topics。
- 云函数旧文档 16 个口径已落后；docs/development-environment.md 已记载 26 个，与当前数量一致。
- 对照旧文档函数模块（将其 policy_review 简写对应到 policy_review_reports），当前多列出 10 个：activities、activity_speakers、activity_tasks、activity_topics、ai_activity、ai_followup、ai_referral、funnel_insight、opportunities、today_coach；其中 4 个使用 Nodejs20.19，也不同于旧图全部 Nodejs18.15 的概述。这些不是指定 Git 基线之后新增的函数。
- policy_review_reports 当前 RLS=false，与旧文档“13 张表全部启用”描述不同，无法确定变化时间。
- 迁移旧文档 16 个口径已落后；指定 Git 基线本身就有 31 个，不应报告成此后新增 15 个。
- 缺少原盘点数据库快照，不能确认表、列、视图定义、权限在原报告生成以后是否改变；“迁移文件无变化”不等于“线上数据库无变化”。

## migrations

本地 cloudbase/migrations 共 31 个 SQL 文件，指定基线也为 31 个，名称和内容无差异。只盘点，不执行。public 未发现迁移历史表；不查询其他 schema 的迁移账本，故**线上已执行数量、校验和与本地迁移一致性未验证**。未核对工作区外备份目录。

文件清单见下方附录。

## 未验证项与下一步

1. 先取得原只读盘点报告及生成时间、数据库对象/定义快照，补齐历史比较依据。
2. 将当前已发布提交及标签作为候选新基线供后续工作包评估；本轮不更新其他文件或批准继续。
3. 如需深入检查，另开只读范围核对云函数源码、部署配置和允许范围内的迁移执行证据。
4. 单独评估 policy_review_reports 的 RLS 与授权事实，确认是否为已知设计；本轮不修复。
5. 未执行登录、AI、保存、删除、恢复等业务回归，没有读写真实客户数据。哈希相同不代表功能已通过回归。

**停止状态：已发现与指定基线不一致；本轮结束，不继续后续工作包。**



## 附录：迁移文件清单

- 20260903100000_products_add_items_ppa.sql
- 20260903101702_policy_review_reports.sql
- 20260903114500_ai_recommendations_add_updated_at.sql
- 20260904100000_recruit_candidates.sql
- 20260904110000_recruit_grants.sql
- 20260905100000_recruit_refactor.sql
- 20260905110000_recruit_stages.sql
- 20260905120000_recruit_files.sql
- 20260905130000_recruit_view_files.sql
- 20260905140000_recruit_followups.sql
- 20260905150000_recruit_goals.sql
- 20260905160200_recruit_stages_update.sql
- 20260905170000_recruit_security_baseline.sql
- 20260905171000_ocr_records_rls.sql
- 20260905180000_recruit_candidate_unique_customer.sql
- 20260905190000_recycle_bin_soft_delete.sql
- 20260907090000_ai_recommend_nba.sql
- 20260907110000_customer_profile.sql
- 20260907120000_followups_recommendation_id.sql
- 20260907204000_opportunities.sql
- 20260907210000_activities.sql
- 20260907223000_participant_person_name.sql
- 20260907233000_referral_opportunity.sql
- 20260908100000_recruit_profile.sql
- 20260908170000_activity_tasks.sql
- 20260909000000_activity_speakers.sql
- 20260909100000_activity_topics.sql
- 20260909180000_next_action_baseline.sql
- 20260909210000_action_center_view.sql
- 20260910120000_funnel_stats_view.sql
- 20260910150000_followup_goal_enum_to_text.sql
