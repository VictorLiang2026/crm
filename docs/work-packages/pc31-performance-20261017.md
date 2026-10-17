# PC31 关键列表搜索和聚合性能治理

日期：2026-10-17

基线提交：`5490aac5c4325be9e9f2550c5db88af471a8863f`（PC30）

本包数据库范围：只读检查 `public`；没有数据库写入、迁移或权限变更。

## 现状与证据

- CloudBase `public` 元数据：Person 790、客户 783、Activity 14、Action 4、Opportunity 9、Outcome 2；`public.v_recruit_candidates` 574 条，`public.v_recruit_candidates_person_only` 2 条。使用 `pg_stat_user_tables` 与视图计数，没有读取客户字段内容。
- 旧 Console 招募页并行取两个来源的最多 1000 条记录，旧候选人函数对完整视图执行 `select('*')` 后再在内存过滤和分页；人物侧来源也使用固定 1000 条上限。
- Person 活动页先取得第一页 50 条混合时间线，再筛选带活动 ID 的记录；这不能代表人物的全部历史活动。
- `public.interactions` 11 条，已参加活动参与记录 3 条，speaker profile 4 条。当前规模没有证据支持为这些路径加索引。
- CloudBase `person_360` 函数级 FunctionDuration 在观测区间的 5 分钟桶最高约 462 ms、最新桶 288 ms；指标混合所有 action，不能代表查询延迟或 P95。
- `queryPgDatabase` 的只读入口拒绝 `EXPLAIN ANALYZE`；CloudBase CLI 函数调用返回退出码 3，因此未取得重复的端到端调用时间，也没有可归因的冷启动/并发测量。

## 实施

- Console 招募目录切换为 `person_360.listRecruitDirectory`。服务端对两个 `public` 视图各自使用末条记录的 keyset 游标，固定为 `next_action_date DESC NULLS LAST, candidate_id DESC`；按需合并两个来源的最多 51+51 条，并用来源名作最终并列键。每页最多实际读取 102 条、只选择 10 个显示字段；首屏当前数据实际返回 51 条旧候选人与 2 条 Person-only 候选人。后续请求只读游标之后的数据，不重复取之前的前缀。累计显示上限为 1000 条，仍有记录时显示双语截断提示。
- Person 活动页明确说明它只从最近 50 条混合时间线记录中过滤；不再把结果描述成完整活动历史。
- 保留旧 `recruit_candidates` API、旧客户行为和其它 Person/Today/Opportunity/Search/Reports 流程；无 schema 变更，因此不需迁移或 rollback 文件。

## 回归结果

- PC31 混合来源分页专项：4/4 通过，包含跨页无重复/无缺口、稳定排序、1000 条显式截断和超界拒绝。
- 相邻回归通过：PC05 1/1、PC08 12/12、PC15 5/5、PC19 10/10、PC20 5/5、PC21 24/24、PC24 21/21、PC29 7/7、PC30 10/10。
- PC29 首次并发执行时浏览器启动超时，单独重跑 7/7 通过。
- `node --check` 覆盖本次改动 JS 文件；`npm run check:shared` 通过，58 个 shared copies 与母本一致。
- CloudBase 代码审查：新 action 只读；仅增加一个视图到既有 `RECRUIT_READ_TABLES` 白名单；数据库请求仍限于 `public` REST；不接受客户端字段来选择表或排序；字段投影固定。

## 未验证与发布状态

- 尚未取得同条件多次端到端耗时、查询执行计划、P95 或并发/冷启动对比；这不支持宣称达到 PC31 的目标耗时。
- `person_360` 云函数已部署；Console `data.js`、`i18n.js`、`pages/recruit.js` 已上传。CLI 对新只读 action 连续 3 次返回退出码 3，没有取得函数响应，因此线上函数执行、登录态与端到端耗时仍未验证。
- 发布标签 `release-20261017-231510` 对应提交 `7871d4d162708b48b5db380b234a78d14bdd2508`。发布后同步检查确认本地、GitHub、CloudBase 的 29 个函数、198 个函数源码/配置文件和 73 个可达静态资源一致；admin.html HTTP 200 且哈希匹配。
- 本包已发布，但没有同条件的真实旧查询与新查询重复耗时、SQL 执行计划、P95 或并发/冷启动对比。本包减少的是客户端传输量与翻页重复读取，不能据此宣称达到 PC31 的 2 秒/3 秒目标。
