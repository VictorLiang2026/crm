# 人物跟进建议技术设计

状态：待确认。所有业务数据仅限 `public` schema。

## 领域模型

- 一条 `public.person_followup_advice` 配对记录作为用户可见主体，包含 Person、标题、系统建议两段、系统版本、GPT 建议两段（允许为空）、GPT 所基于的系统版本、状态、创建/更新时间和软删除标记。
- 系统建议每次编辑递增版本。GPT 内容不随之静默覆盖；`gpt_based_on_system_version` 保留生成依据，界面据此标记“基于旧版本”。
- GPT 状态至少区分缺失、待生成、处理中、已生成、基于旧版本、人工编辑、失败。人工选择保留旧版时需记录其已处理的系统版本，避免任务包重复输出。
- AI Gateway 的 `ai_tasks` / `ai_runs` / `ai_results` 继续承担 CloudBase AI 调用审计；GPT SKILL 的任务批次和导入确认也应可追溯。不得将服务角色凭据发到浏览器。

## 流程与服务边界

1. Console 人物详情调用现有 `callFn` → `assistant` 服务端入口；服务端读取人物及近期互动、有效知识来源，并调用现有 CloudBase AI Gateway，模型由现有配置选择。
2. 系统 AI 输出为一个配对建议对象，含总体策略、产品/服务建议及各自来源；不再将 `strategy_based` 与 `library_based` 作为互斥候选。
3. GPT 任务包服务端按“GPT 缺失或版本待更新”筛选记录，返回必要上下文、知识来源标识和系统建议版本；输出使用固定 JSON 契约。
4. GPT 结果写回先经服务端 Preview：核验建议 ID、Person ID、系统版本、字段长度、来源 ID 和操作者身份；再由人工确认后 Execute，只更新 GPT 字段。版本变化时拒绝过期写入。
5. 删除配对建议使用软删除，不删除 AI 审计历史；确认具体软删除/恢复语义与当前 Person 删除流程兼容。

## 数据库与安全

- 新增对象限定为 `public.person_followup_advice`，RLS 最小授权，浏览器只经现有服务端 `callFn` 访问。
- 新表必须提供 migration 与配套 rollback；rollback 在存在业务/审计数据时拒绝丢弃数据。先核对生产 `public` 结构、权限和迁移版本；不触碰其他 schema。
- 服务端写回使用版本条件更新和幂等批次标识，防止重复导入、错误人物关联和并发覆盖。
- 对知识库产品/服务输出保存受允许来源引用；无有效来源时明确标记缺少依据，不得编造公司条款或本地法律结论。

## 页面与兼容

- 现有 `#/ai/followup/:personId` 作为人物级列表/详情入口继续保留；Person 详情按钮文案改为“跟进建议”。
- 增加可跨人物查看的 GPT 待处理任务包入口，以支撑每日人工批次；旧建议历史仍可读取，不与新配对记录混为一条。
- 新 UI 放在 `crm/js/modules/console/` 和对应 CSS，使用现有 i18n、DOM、data 与 `callFn` 模式；双栏优先 iPad，窄窗口可纵向比较。
- 保留现有 Knowledge Library/AI Runtime 和 `ai_recommendations`；更新双建议专用输出契约时，不改变其他 Gateway Skill、旧函数签名或历史 URL。

## 回归范围

覆盖建议 CRUD、CloudBase 两段结构/知识引用、GPT 任务筛选与版本过期拒绝、Preview/Confirm 写回、并发/重复导入、旧双建议路由与历史、AI Gateway 其他 Skill；并覆盖登录/会话、人物列表/详情、跟进、活动、招募、回收站。使用合成 Person/建议，不对真实客户执行破坏性写入。
