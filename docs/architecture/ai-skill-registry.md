# AI Skill Registry

`cloudfunctions/_shared/skill-registry.js` 是新 AI 任务的版本化契约目录。首批 10 个 Skill 均有 `name`、`version`、`capability`、`contextRecipe`、`inputSchema`、`outputSchema`、`confirmationLevel`、`timeoutClass`。定义中不允许额外的模型或厂商字段；模型选择仍由 AI Gateway/CloudBase 配置完成。现有历史 AI 函数不加载该目录。

| Skill | 抽象能力 | 必需上下文 | 确认级别 | 超时类 |
| --- | --- | --- | --- | --- |
| `quick_capture` | structured_extraction | 无 | confirm_before_write | standard |
| `person_summary` | summarization | person | review | standard |
| `meeting_prep` | planning | person | review | standard |
| `today_coach` | planning | daily_snapshot | review | long |
| `opportunity_analysis` | analysis | opportunity | confirm_before_write | standard |
| `activity_prepare` | planning | activity | confirm_before_write | long |
| `activity_review` | analysis | activity | confirm_before_write | long |
| `recruit_coach` | coaching | candidate | confirm_before_write | standard |
| `conversation_playbook` | coaching | person | confirm_before_write | standard |
| `ai_search` | retrieval | search_results | review | standard |

`contextRecipe` 只声明语义上下文段及各列表上限，不执行数据库查询，也不依赖具体模型。未来接入者须从获授权的 `public` 数据构造这些段，并按既有登录/RLS 边界过滤；其中的 `person`、`activity` 等名称是上下文键，不是直接表名。`review` 表示结果可供人审阅，但不能由 Skill 自动写业务数据；`confirm_before_write` 表示用于业务写入前必须由人明确确认。Gateway 对全部结果仍保持 `requires_confirmation=true`。超时类映射为 short 30 秒、standard 60 秒、long 120 秒，实际云函数超时需在接入时单独匹配。

Registry 使用 Ajv 按 JSON Schema Draft 2020-12 在启动时编译所有输入、输出和上下文 Schema，使用 `ajv-formats` 校验日期与日期时间。严格模式拒绝无效 Schema；校验不会强制类型转换、补默认值或删除多余字段。错误只返回路径、关键字和消息，不回显客户内容。调用 `defaultRegistry.get(name)`、`list()`、`validateInput(name,data)`、`validateContext(name,data)`、`validateOutput(name,data)`；定义递归冻结。Registry 的元数据 Schema 禁止额外键，版本或契约变化必须显式更新 Skill 版本。

Gateway 默认使用此 Registry。未知 Skill、能力不匹配、无效输入/上下文或与注册版本不同的 `outputSchema` 会在审计写入和模型调用前失败；无效模型结果会记为失败 run，不写 `ai_results`。首批 Skill 的输入输出 Schema 是面向新功能的契约草案，不声称兼容同名历史函数的现有响应结构。数据装配、真实模型调用、线上权限与人工确认 UI 留待各业务接入工作包。
