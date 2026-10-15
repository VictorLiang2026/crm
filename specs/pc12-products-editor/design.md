# PC12 设计｜保险额度编辑

## 交互

Person 360 保险标签保留现有上下文卡片，增加“保障明细”原生编辑区。11 个类别沿用 Legacy 顺序；iPad 以类别分组呈现 5 个字段，减少横向拥挤。只用现有 Console 组件、CSS token 和 i18n。字段以字符串处理；金额输入不经 JavaScript Number。空白显示“未知/未录入”，0 显示为明确的 0。显示单位“人民币元（沿用旧值原样，不做换算）”，并展示“人工录入，保单真实性待核实”。产品建议仍在报告区按其既有 AI 来源显示，不提供一键采纳。

## 数据与 API

- 继续使用 public.products；不碰 pr schema/对象。
- 一份新 PC12 迁移为 customer_id 建立唯一约束，并增加正整数 version（默认 1、非空）。回滚只删除本轮新增约束和列；部署前检查并拒绝存在重复 customer_id 或空 customer_id 的状态。
- 新 Person 入口调用 products.list/upsert 的 personId 路径。云函数以存活 Person 为起点，从 customers.person_id 查询唯一有效客户，再读取/写入其 products 行；客户端不得指定 customer_id 作为身份来源。
- list 响应增量返回 version；upsert 要求 expectedVersion，使用数据库条件更新完成 compare-and-swap。首次插入由唯一约束防止双行。版本冲突返回明确错误码。
- 旧 Legacy customer_id 入口和响应形状保留。其成功写入须推进 version，使已打开的 Person 编辑器检测到旧快照；旧调用不需要新增参数。
- bigint 金额在浏览器使用十进制字符串验证（0 至 9223372036854775807）；写 PostgreSQL 和 JSON 明细均传字符串；空金额映射到 ap_* NULL，items 保存空字符串。保费、交费年限和已交年数沿用旧页面允许的非负十进制文本契约，以字符串保留精度，日期保持 YYYY-MM-DD/空值。
- 每次保存同时更新 11 个 ap_* 镜像与对应 items.amount。服务端校验全部字段及类别白名单，拒绝负值、溢出、非法 JSON 与跨人物 ID。

## 兼容、报告与上下文

InsuranceContextService 和 policy_review_reports 继续使用相同表/列；无结构消费者改名。新值以字符串保存，避免 JSON bigint 解析精度损失。保存后 Person 页重新读取 insurance context。旧报告生成仍读取现有产品字段，AI 只能提供建议；保障事实写入仅由人工提交。

## 风险与回滚

- 唯一约束是新增数据库行为门槛：虽然当前 products 只有一行且无重复客户组，部署前仍需完整检查 customer_id 重复及 NULL。回滚约束会重新允许重复行，回滚版本列将丢失版本审计计数，但业务保额/JSON值不受影响。
- 迁移后旧 upsert 仍兼容；不删除/重命名现有 API、列、函数或 Legacy 路由。
- 代码回退需部署前一标签中的 products 函数和静态资源；数据库回滚须先核实版本依赖及唯一约束下的行状态。

## Regression

离线覆盖首次插入、更新、空/0 值、负值、bigint 上限和溢出、重复提交、CAS 并发、跨人物拒绝、旧 customer_id 入口、JSON 字符串精度、Person context 与旧报告读取。浏览器按 iPad 横竖屏检查中英界面。生产账号验证限带标记虚构数据，任何数据试验须在精确快照/恢复方案经用户确认后执行。
