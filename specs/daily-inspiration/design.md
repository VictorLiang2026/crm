# 技术设计：激励语筛选、轮播与多格式导入

## 用户界面

- iPad 管理页顶部使用紧凑双栏：左栏为“展示时间”卡片（时区、两个时段、推荐值下限、是否可提前重复），右栏为“批量导入”卡片；语录清单及逐条编辑位于下面。
- 导入区支持现有 JSON bundle、XLSX、UTF-8 CSV、TSV。沿用本地已引入的 SheetJS 0.20.3 解析 XLSX；表头支持中英别名，CSV/TSV 有引号解析，单文件上限 5 MB、单批上限 80 条。
- 预览分为完全相同、相似待确认、默认导入三类。完全相同者只跳过；相似者需逐条选择保留已有或仍导入；普通记录默认勾选。确认前不写库。
- 所有新增 UI 文本放在 `crm/js/modules/console/i18n.js` 字典，沿用现有 CRM 色彩、字体、图标和表单样式。

## 服务与存储

- 保持 assistant Function、服务端身份校验、AI Gateway 和现有 public RPC；不新增云函数、不在浏览器访问 PG。
- 对 `daily_inspiration_settings` 增加 `min_recommendation_score smallint NOT NULL DEFAULT 0` 与 `allow_repeat_before_all_used boolean NOT NULL DEFAULT false`。
- 新 RPC 生效前，迁移用与服务端相同的可复现规则为既有空分记录补值，避免默认 0 分下首页候选池为空；已有人为填写的分值不覆盖。
- 新建 `public.daily_inspiration_rotation_used` 保存 UID 轮播周期已用 quote ID，采用 service-role-only RLS 与精确授权。全体合格记录用完后清空该 UID 的周期集合；达到分值门槛的合格集合会优先取未用记录。停用、分数编辑、导入会在选择时重新以当前合格集合核验。
- 修改 `crm_daily_inspiration_v1`：设置读写、当前槽位读取、候选列表、select/replace 都在服务端核对启用状态和 `recommendation_score >= min_recommendation_score`；不合格旧槽位不可返回给前台。新 migration 只作用于 `public` 并有对应 rollback。
- 后端批量预览重新读取现有库，完全相同文本自动剔除；中英文各自归一化后以字符/词组 n-gram 相似度标记潜在重复，返回可比对的已有记录。人工决策是实际导入的必要条件。提交时服务端重算 exact/near 候选，并验证用户对候选逐条提供决策；无近似候选的行默认导入。
- 现有 history 的展示、更换日志保持不变；新增轮播状态独立于 90 天历史保留清理，支持超过 90 天的完整周期。

## 选择与兼容

- 使用服务端实时选择，不做每日 AI 预计算。当前日/时段已有合格槽位时继续稳定读取；新槽位/更换才调用 AI Gateway 受限选择，结果经 RPC 再次核验并写入槽位/轮播状态/历史。
- 默认禁止提前重复；当允许重复时也优先未使用语录。轮播范围按 UID 合并两个时段。
- 现有单条增改、启停、评分、时段变更和 JSON bundle 继续有效。旧 JSON 内的 `formatVersion` 与 `fillMissingScores` 保留；表格文件可以通过 `id` 和 `推荐值` 列补录空分。

## 验证与回滚

- 单元与浏览器回归覆盖导入格式、列映射、分值校验、exact/near 处理、双语、两列布局、阈值过滤、周期完成前不重复、周期重开、旧槽位失效、AI 回退和日志兼容。
- 真实线上账号、导入写入和前台读数需部署后在已登录 CRM 页面完成；不以静态检查替代端到端结果。
- rollback 恢复旧 RPC 并移除新表/设置列；只有轮播表为空且用户仍使用默认门槛/轮播值时才执行，否则拒绝破坏性回滚。迁移补出的推荐值保留在既有字段中。
