# 活动人物字段修复

## 当前结果

用户于 2026-09-22 明确授权实施，并随后授权修复剩余失败项；三个受影响函数已部署，部署后全量云端源码核对通过，Git 发布收尾中。

- `activity_tasks/index.js`：通过现有 public.v_recruit_candidates 读取 candidate_id/customer_name，保持 related_id 为候选人 ID、related_name 返回契约。
- `activities/index.js`：增员人物映射改为 candidate_id/customer_name，覆盖搜索、详情姓名补齐、新增参与者、暂存参与者关联。视图已过滤候选人和客户软删除，不查询其不存在的 deleted_at 列。客户、嘉宾仍使用原有表及过滤规则。
- `ai_activity/index.js`：analyze、prepare/decompose 共用上下文、postReview 改为批量按 customer_id 关联 customers；输出兼容 id/name/stage/priority/occupation，其中 priority 来源为用户确认的 recruitment_priority。不新增 schema 字段、视图、权限或 SDK 依赖。
- participantReview 和 activity_speakers 的正确关联实现未改，新增测试保护。

专项 15 PASS：任务姓名、人员搜索的候选人 ID/姓名/职业、筹备上下文优先级、prepare、decompose、analyze、postReview、participantReview、嘉宾增员关联、参与者新增/关联、已删除客户、已删除候选人、未关联参与者、缺失客户。5 个 AI 入口均断言无数据库写入，筹备入口另验证增员优先级及原 plan.suggested_tasks 返回契约。

完整回归 **56 PASS / 0 FAIL / 5 SKIP**，结果快照 `activity-schema-regression.json`。用户明确要求修复失败项后，删除活动详情读取时对 activity_participants 的补写调用，继续在返回内存对象中补齐姓名。显式新增/关联参与者仍保存姓名。原只读断言保留，并断言返回姓名正确、原记录仍为 null。语法检查及 git diff --check 通过。

所有新增测试只用合成内存记录；参与者写入测试不会访问线上。AI 输出被替换，因此不证明真实模型内容质量或线上端到端成功。专项已接入 npm test；也可单独运行 node tests/regression/activity-schema.cjs。

发布验证：执行通道恢复后，三个函数线上旧代码的 12 个源码/配置文件与 HEAD 基线一致；随后仅更新 activities、activity_tasks、ai_activity 代码。部署后页面 HTTP 200/SHA-256 相同，26 个 CRM 函数共 108 个源码/配置文件全部与本地一致，证据目录 C:/Users/victor/AppData/Local/Temp/crm-cloud-audit-cb16c475db5c4f08b24ed48114262bef。现有线上权限修复保持不变，本包没有数据库写入。

线上只读 smoke：activities.searchPerson 用专用测试关键词返回空 rows，RequestId 38e88396-030f-41ee-beb9-9f030d84492f；activity_tasks.list 用不存在负数 ID 返回空 rows，RequestId 544ecd00-7423-406b-b009-23432996869c；ai_activity.prepare 用同一不存在 ID 返回预期 activity not found，RequestId 835f2221-f641-4039-9907-a7757f88466c。三次均 InvokeResult=0，无运行时错误。该 smoke 证明部署加载、增员视图查询及缺失记录保护可用，不替代真实 AI 或完整线上人物样本测试。

推荐提交信息：`fix(activity): resolve recruit identity through customer data`。

## 修复前证据

2026-09-22。以下为实施前的检查记录。

真实 schema 复核：recruit_candidates 无 name、priority、occupation；有 id、customer_id、stage。customers 有 customer_name、occupation、recruitment_priority。v_recruit_candidates 有 candidate_id、customer_name、occupation，但无 priority、recruitment_priority、deleted_at。

定位：activity_tasks.enrichRelated 错读 id/name；activities.personTable 将增员映射到不存在的 name，并导致搜索及关联校验读错；ai_activity 的 analyze、loadActivityContext（prepare/decompose 等共用）、postReview 错读 name/priority/occupation。

确认方案：人物姓名、职业使用已存在的增员视图或按 customer_id 关联 customers；AI priority 从 customers.recruitment_priority 读取。保持候选人 id 与 customer_id 的区分，保留外部 name/priority/occupation 等返回字段和软删除过滤；不增加重复列、不重构活动架构。

新增 tests/regression/activity-schema.cjs，使用合成内存记录执行真实云函数，严格拒绝不存在的增员字段。修复前 5 FAIL、2 PASS：

- FAIL task-recruit-name、participant-search-id、prepare-context、analyze、postReview。
- PASS participantReview、speaker-recruit-link。

AI 测试替换模型输出，不调用真实 AI，不产生线上费用或写入。未关联/删除人物边界及新增、关联参与者验证已在上述专项中补齐。

基线：GitHub master 仍为 147bd60a91406c37fa0556824485cebf14a2f1f9；线上 admin.html hash 与本地一致。完整 sync-check 因前轮未提交产物停止；CloudOnly 函数源码下载仍要求 CLI 登录，未声称云函数本轮全部核对完成。

原 activity-readonly 失败（读取详情补写姓名）暂不改，不隐藏或放宽原测试。
