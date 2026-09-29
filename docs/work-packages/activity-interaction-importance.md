# 活动重要互动门槛

基线：`a91cc9949aba8f70a2f334c6180c2b6526b910c9` / `release-20260929-184739`。修改前本地、GitHub `master`、线上 `admin.html` 和 27 个 CRM 云函数源码一致。本轮仅使用 `public`，沿用现有 `public.interactions`，没有数据库结构或权限变更，因此不需要 migration/rollback。

活动详情的每位已关联参与者新增“记录重要互动”。写入经现有 `person_360` 真实登录校验、服务端 Person 身份映射、人工确认、时间及事实摘要校验后执行。来源为 `manual`，保留调用者 UID、活动 ID、事件类型、重要度和具体结果。旧活动状态、报名/参与者写入、旧“记录沟通”以及跟进表均保持原样。

| 事件 | 重要度 | 入库规则 |
| --- | --- | --- |
| attendance | 3 | 仅 `status=attended` 且活动、Person 身份有效时，通过只读 Adapter 呈现；不复制到 `interactions`。普通报名、邀请及缺席均不呈现。Person 专属嘉宾可经明确的 Speaker Profile `person_id` 映射。 |
| invitation | ≥3 | 只记录有实际回应、确认参加、明确拒绝或约定下一步的个别邀约；仅设置 `invited` 状态不触发写入。 |
| conversation | ≥3 | 需有实质沟通结果（需求、决定、承诺或关系变化）及至少 12 字事实摘要。 |
| speaker_cooperation | ≥4 | 仅嘉宾参与者，须有确认主题、形式、达成合作或完成合作的具体结果。 |
| post_event_followup | ≥3 | 仅结束/已复盘活动，须实际联系、收到反馈、约定下一步或完成闭环。若同一活动、客户和摘要已有旧跟进，则拒绝重复写入。 |

四种可写事件均要求明确时区的发生时间、人工确认和 3–5 分中的对应最低分；缺少身份、活动、具体结果或摘要时拒绝。重复提交的相同 Person、活动、事件类型、时间和摘要会被拒绝。旧 followups/recruit_followups 与参加活动的只读映射继续保留；若分别从旧跟进入口和新入口写入语义相近但文字不同的记录，系统无法自动判断两者是否同一次接触，需人工避免重复。

验证：线上只读核验确认 `public.interactions` 保持 0 条、RLS 开启、仅 `service_role` 有表授权，`activity_participants.canonical_person_id` 与 `activity_speakers.person_id` 已存在。`npm run test:interactions` 为 21 PASS / 0 FAIL，覆盖门槛、身份、登录拒绝、旧来源重复、嘉宾映射和到场只读；隔离浏览器新增入口和旧页面回归通过。完整离线 CRM 回归为 80 PASS / 0 FAIL / 5 SKIP；语法、共享模块哈希及差异格式检查通过。线上写入需使用明确标记的隔离测试记录；未做线上写入时不能把离线测试等同生产业务验证。

本轮仅部署 `person_360` 函数代码和 `/crm/admin.html`，两项上传成功。线上无登录直调 `recordActivityInteraction` 返回 `UNAUTHORIZED`（RequestId `0a3e618c-1595-467d-80fe-5c5803a9e38e`），未进行线上写入，也未自动生成任何 Interaction。发布后仍须核对源码和 GitHub 标签。
