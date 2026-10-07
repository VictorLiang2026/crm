# Person 中心化迁移：需求、边界与验收标准

状态：PMC-00 建立骨架（2026-10-07）。本文件只登记用户已明确给出的目标与边界；各包的详细需求和验收标准在收到对应 PMC-XX 指令时逐包登记。**未收到的指令不预写。**

## 业务目标（用户已确认）

以 Person 为身份与基础信息的权威来源，把客户（customer）、招募（recruit）、活动（activity）、互动（interaction）等领域中散落的人物身份信息收敛、关联到统一 Person，同时：

1. 保留 Legacy 功能、`callFn` 数据入口、登录/RLS/软删除与恢复语义（AGENTS.md 规则 9、13 及"修改与验证"节）。
2. 业务表保留自己的业务状态和业务外键；Person 只作为基础信息权威来源（execution-contract F）。
3. 身份解析与合并必须经服务端 `PersonService.resolveName()` 加人工确认，不凭同名、同手机号或 AI 推断自动合并（AGENTS.md 规则 14；execution-contract F）。
4. 历史快照、审计证据与当前基础信息分开处理（execution-contract F）。

## 硬边界（继承 AGENTS.md，长期有效）

- 数据操作仅限 `public` schema，SQL 明确限定 schema；不访问、修改或依赖 `pr` / `pr_*` 对象及 `pr_*` 云函数。
- 不删除或重命名已有表、Views、Cloud Functions、Routes，除非用户针对该项单独批准。
- 任何新的数据库变更必须同时提供 migration 与 rollback，并核对依赖视图。
- AI 功能不硬编码模型厂商；模型选择交 AI Gateway / CloudBase 配置；重要 AI 结果 human-in-the-loop。
- 页面验收默认只考虑 iPad；新增界面中英双语，走 `crm/js/modules/console/i18n.js` 字典。
- 不使用用途未确认的体验版环境（如 `crm-victor-d4g3a9vr011807bdb`）作为测试环境。

## 工作包体系

- 编号 PMC-00～PMC-20，由用户逐包下发指令；与已有 WP01～WP28 工作包并行存在、编号独立。
- 一次只执行一个包；PMC 包完成发布并验收后才进入下一包。
- 各包与 WP 体系的依赖关系在收到指令后登记到 `tasks.md`。

## 验收标准（通用底线，各包可加严）

1. 只执行用户指定范围（AGENTS.md 规则 10）；额外问题只记录不修（规则 11）。
2. 修改前基线核对（本地/GitHub/云端/`public` 对象）有实时证据。
3. 影响现有功能前取得针对性确认；影响范围、兼容方案、回归范围有书面记录。
4. 数据库变更 migration + rollback 齐全，依赖视图核对通过，无 CASCADE，双备份到位。
5. 回归覆盖本包范围及相邻功能；公共入口变动覆盖登录、客户列表/详情、跟进、活动、增员、回收站及 Console 对应入口。
6. 发布：仅部署变更产物；提交、推送、`release-YYYYMMDD-HHmm` 标签、三端核对通过；文档包说明云端产物未改变。
7. 未验证项如实列出，不写成通过；失败立即停止并报告。
8. 档案同步：tasks / handoff / evidence / design / decisions / impact-matrix 按执行约定 L 更新。

## 最终端到端验收

待 PMC-01～PMC-20 指令收齐后，由用户确认统一场景；本文件不预设。
