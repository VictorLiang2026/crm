# 目标 CRM：分层设计与迁移路线

状态：规划中；对应 [requirements.md](requirements.md)。本设计只定义实施边界；各工作包开始前必须重新核对线上事实与影响。

## 一条主链路

```mermaid
flowchart LR
  Person --> Context[Relationship / Household / Interaction / Context Item]
  Context --> Candidate[AI 或规则产生候选]
  Candidate --> Preview[服务端预览与人工确认]
  Preview --> Work[Opportunity / Action / Commitment]
  Work --> Outcome
  Outcome --> Learning
  Learning --> Review[可审查反馈指标]
  Review -.不自动改规则.-> Candidate
```

主界面承载“人、今日、机会、活动、招募、AI 助手”；旧完整编辑能力保留在“更多”和原 URL，直到对应功能逐项验收。`admin.html` 继续承载旧业务；新的 AI-native 入口只在 `crm/js/modules/` 实现，复用已有 core/components/css。前端通过现有 `callFn`；权限与写入边界落在服务端。

## 服务与数据职责

| 层 | 主责 | 不负责 |
| --- | --- | --- |
| PersonService | 身份解析、显式关联与防误合并 | 按姓名自动猜人 |
| InteractionService / Legacy Adapter | 统一时间线、来源去重、有限字段查询 | 全量历史复制、把报名冒充到场 |
| Context Engine | 按 recipe 读取最近且必要的字段，附来源并记录快照 | 把全库长记录送给模型 |
| AI Gateway + Skill Registry | 按 capability 调 CloudBase 托管模型，结构化验证、超时/重试/审计 | 在业务代码中固定模型厂商或自动确认事实 |
| Candidate / Command 服务 | 服务端核实证据、预览、确认令牌、幂等执行 | 信任客户端 `confirmed` 或自然语言即执行 |
| Action / Opportunity / Outcome 服务 | 单一事实源及状态迁移 | 旧来源的无条件二次复制 |
| Legacy Compatibility | 保留旧 customer/recruit/activity/insurance URL 与字段语义 | 作为新功能的长期第二事实源 |

数据沿用已经存在的 `public` 底座表，不因空表再建同义表。新字段或数据库函数确有必要时，只在独立工作包提供 migration、rollback、权限矩阵和依赖视图核对；不触碰 `pr` 或 `pr_*`。生产业务写入前，需在函数内核对真实登录身份；敏感表仅通过最小范围的服务端授权访问。服务端权限测试需要同时检查拒绝路径。

## CloudBase AI 的当前取舍

CloudBase 文档支持托管模型通过资源点套餐计费；模型接口仍会带具体模型标识。因此模型标识只在 CloudBase/AI Gateway 配置解析处出现，业务 Skill 仅声明 `capability`。上线前检查目标环境的文本、视觉能力是否可用及套餐资源点状态；视觉不可用时明确显示“暂不可用”，不静默切到第三方，也不在本阶段开发模型管理页面。AI 输出都带任务、运行、结果和用户反馈审计；事实/截止日期从 `public` 读取。参考：[CloudBase AI 介绍](https://docs.cloudbase.net/ai/introduce)、[Node SDK 模型调用](https://docs.cloudbase.net/ai/model/nodejs-access)。

## 演示数据：先隔离，再生成

演示数据留在当前 CRM 的 `public`，不使用另一环境。优先复用 Person 的 `source` 及各对象现有 `source` / `metadata` 标记，统一稳定前缀 `CRM_DEMO_V1`；若某对象缺少可可靠追踪的标记，先在专属工作包设计最小迁移/回滚，不能靠姓名或备注猜测。种子器先给出 dry-run 的对象数、关系和预期 ID，之后用稳定自然键或映射清单在事务中幂等写入。每次只生成足够跑通链路的少量虚构记录；不使用真实电话/保单/身份证件，不上传真实照片，不创建可外发消息或通知的任务。

演示场景建议为 5 位 Person：两位同名但括号限定不同的客户、一位招募候选人、一位活动嘉宾、一位可作为家庭成员的独立 Person。家庭成员关系必须在预填预览中由人确认后才建立，不能因资料提及孩子就自动创建或关联 Person。补最少的关系、互动、上下文、活动、保险摘要、机会候选、行动、承诺、Outcome、Learning 和已核验/待核验证据，覆盖身份冲突、证据充分与不足、逾期和已完成路径。实际字段/数据量以工作包前只读核验为准，绝不按此文档直接拼 SQL。

正常经营查询必须在服务端排除演示记录，包括 Today 排名、漏斗、经营统计、AI 搜索/Context、主动提醒与外发候选；显式演示模式允许同一服务按受控 scope 纳入。页面用醒目的“演示数据”标识，提供一键进入预填演示场景、逐步下一步和重置视图状态；用户无需录入姓名/文字，但确认动作仍由本人点击。若某旧聚合无法识别来源，就暂不为它注入演示记录，先补隔离。保留演示数据是默认行为；将来如需清理，只能按清单精确处理，并重新取得相应授权。

## 收敛旧功能的方法

“入口不重复”与“移除旧实现”分开实施。先让主入口只展示新流程和一个明确的完整旧版链接；不会把同一 Action 同时当作统一 Action 与旧跟进各排一次。为每个领域建立功能矩阵：字段、创建/编辑/删除/恢复、权限、移动端、导出、异常路径、使用量、数据迁移和回滚。替代率达到 100% 且真实账号回归稳定后，旧入口仍保留在“更多”观察 90–180 天或用户批准的观察期。只有没有隐含依赖、已备份、可回滚，并得到逐项删除批准，才可删或改名；否则旧入口继续可用。旧数据不因导航移动而丢失。

## 分段验收门槛

| Gate | 达成条件 |
| --- | --- |
| G0 基线/隔离 | 源码与线上权限基线一致；演示标记与排除规则端到端验证；幂等种子器能 dry-run/重跑。 |
| G1 核心闭环 | Person → Quick Capture → Interaction/Context → Opportunity/Action/Commitment → Today → Outcome 在预填场景走通；关键写入逐项人工确认，旧入口回归通过。 |
| G2 领域闭环 | 活动、招募、保险、知识/话术可从 Person 360 到达完整操作；证据充分/不足两类路径可复现；旧页面数据与权限不回退。 |
| G3 AI/反馈闭环 | AI Gateway 真实调用、结构化结果、来源、用户四类反馈及 Outcome/Learning 可追踪；自然语言动作未经确认均拒绝。 |
| G4 可靠与收敛 | 目标数据量的性能基线、事务/幂等、安全矩阵、运行时与超时均有独立回归记录；新主导航不重复，旧入口按证据逐项保留或另案批准退出。 |

每个 Gate 都要有成功与失败路径证据，不能以空表、模拟函数返回或源码哈希代替真实业务验证。每个工作包单独提交、部署、打标签、核对三端；发布失败则保持未完成状态。
