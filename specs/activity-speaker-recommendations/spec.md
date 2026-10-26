# P3f Console 活动嘉宾推荐

## 目标与范围

- 在 Console 活动详情“嘉宾与主题”提供新嘉宾候选，复用 AI Gateway 配置与审计。
- 候选只能来自 `public.activity_speakers` 中 active、未软删且已关联有效 `public.persons` 的嘉宾；排除本场已用同一 speaker ID 或已确认 canonical Person ID 的嘉宾。旧姓名暂存参与者仍需操作人员核对。服务端核对模型返回的 ID，姓名只取 Person 主数据。
- 建议不写活动、嘉宾、人物、参与者、任务或机会；操作人员点击“核实并添加”后，仍走现有 Person 姓名解析、人工选择和 `addCanonicalParticipant` 流程。
- 旧 `admin.html` 的嘉宾推荐与旧 `ai_activity.recommendSpeakers` 暂时保留。本包不新增数据库对象或权限。

## 设计与回归

- `ai_activity.recommendSpeakersV2` 要求真实登录和筹备期活动，最多读取 20 位候选，AI Gateway 只返回 ID、匹配分、理由、主题和联系建议；服务端剔除池外、已参与、无有效 Person 的 ID。
- Console 独立小模块负责双语展示和错误状态；点击候选时只预填姓名与嘉宾类型，不预选 Person。
- 测试未登录、活动状态、候选过滤、伪造 ID、无业务写入、人工身份选择，以及活动/人物/招募/回收站回归。
- 回退时恢复本包服务端与前端文件并精确重发受影响产物；AI Runtime 的历史审计记录保留，数据库无需回滚。
