# Conversation Playbook Skill 2.0

基线：`df03ac4350492b766407740390415ea9cd5e1532` / `release-20260930-074907`。修改前 GitHub `master`、生产页面及 27 个 CRM 云函数的 129 个源码/配置文件与本地一致。线上 `public.playbooks` 与 `public.knowledge_items` 已建立但均为 0 行。

本轮将未被业务调用的 `conversation_playbook` 1.0 通用话术契约升级为 2.0。输入为 Person ID、客户异议及可选场景；输出为待确认原因、澄清问题、响应逻辑、Evidence 引用、下一步目标与禁用说法。无开场白/万能话术字段。结果只供人审阅，不直接改变 Person、Fact、Opportunity、Action 等业务记录。模型仍由 AI Gateway / CloudBase 配置选择，Gateway 调用时写 AI Runtime 审计与上下文快照。

新模块只经注入的授权 GET 读取 `public`：Person、最近 Interaction、已确认 Fact、Signal、开放 Opportunity、匹配的 Playbook 及其 Knowledge 引用。每段均有上限与字段裁剪。Playbook 按异议/场景确定性匹配，不匹配时不会把无关内容填入建议。只有 Playbook 的 `evidence_refs` 所指、类型为 `evidence`、人工核验、有效期内、来源明确且 confidence ≥ 0.7 的 Knowledge 才进入可靠证据集合；案例和故事不自动作为 Evidence。模型引用结果会再按该集合过滤。没有有效证据时，返回“必须人工确认”的明确提示，不允许模型将假设当成事实。

兼容边界：不新增页面、路由、函数入口、数据库对象或权限；不改变旧活动分析与其它 Skill。`ai_activity` 内的 Skill Registry 副本与共享契约保持一致并单独部署，原有 action 仍走原流程。新运行模块本轮只有代码和隔离测试，没有生产调用入口；因此无法进行真实异议、真实模型和真人审阅的端到端验证。回滚只需用上一个发布标签恢复 Registry 副本与共享源码，不涉及数据库。

验证：定向测试 11 PASS / 0 FAIL，覆盖无效输入、缺失 Person、上下文上限、未确认 Fact 排除、过期/未核验/低可信 Evidence 排除、异议匹配、虚构引用过滤、缺证据提示、Gateway 调用与业务只读约束。完整 CRM 回归 82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、机会、Today、活动、招募及回收站。共享副本校验、语法检查与 `git diff --check` 通过。仅 `ai_activity` 函数包更新；无业务的未知 action 线上启动探针返回预期 `unknown action`，CloudBase `InvokeResult=0`、`ErrMsg` 为空（RequestId `25969035-42b8-45b1-90e4-4670f47712c5`）。

发布标签拟定为 `release-20260930-083048`；发布脚本会在提交前核对云端源码，并在 Git 推送后再次全量核对。未调用真实模型；现有知识和 Playbook 内容源为空，线上尚不能生成有证据的个性化建议，用户可在后续内容录入和调用入口工作包中完成端到端验证。
