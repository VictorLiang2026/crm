# 2026-10-30 人物互动归并发布记录

基线：master 958cf54 / release-20261030-204500。用户已批准统一入口、统一读取与公共交流数据迁移三个步骤。本轮执行目录 C:/Users/victor/crm-unified-interactions；未覆盖其他工作区。

## 变更

- Person 时间线使用一个“记录互动”表单，一般交流/客户跟进按场景选择；人工互动和客户跟进均可编辑。客户业务字段按需展开，保留旧表单/API/URL。
- 新结构 public.interactions 保存公共交流字段，followups.interaction_id 一对一关联。旧字段作为兼容镜像；数据库触发器覆盖旧写入者。日期未知保留未知，历史来源不按文字自动合并。
- 时间线、人物摘要、会前准备和客户 AI 建议复用人物历史；保留客户销售指标的业务口径。活动 AI 和机会候选证据过滤删除记录。
- 新编辑 RPC 只允许 service_role，调用者身份取服务端登录态；校验 Person/客户/推荐/活动关系、版本及重复提交。保持人工保存与删除确认，无 AI 自动业务执行。

## 数据库证据

- 20261030220000_unified_interactions：任务 task-de4c398253a24668，成功并已核对迁移历史。
- 20261030220100_unified_interaction_editor：任务 task-49b660ca1d7a4a99，成功并已核对迁移历史。
- 20261030220200_unified_view_invoker：任务 task-3f2250ea86244535，成功。首轮门禁发现 CREATE OR REPLACE VIEW 重置 security_invoker，已立即停止发布并以增量迁移恢复 true；权限基线未放宽，同时补充本地迁移权限断言。
- 251 条跟进全数关联；互动由 19 条变为 270 条。回填前后全部原字段聚合校验值同为 e63c4e09c4a5b1410f4946645c8e13fc，缺失关联为 0。
- 8 条缺日期记录保留 NULL / unknown；11 条无正文记录保留原字段，互动使用类型占位标签。
- 审计 6 个依赖视图；followups_view 原地追加 interaction_id，其他视图不使用该新增字段，保留列、权限和定义。不删除任何表、视图、路由或旧函数。全部操作限 public。
- migration / rollback 同时保存于仓库和 C:/Users/victor/cloudbase/migrations。
- 线上 service_role 执行 tests/interactions/unified-live.sql 成功：合成记录在异常子事务中全部回滚；验证新旧写入、重试、并发版本、删除/恢复。未修改真实客户测试数据。

## 验证与发布范围

已通过本地 PostgreSQL（PGlite）完整迁移/回退演练、50 项互动/分页/摘要/上下文/新旧编辑器测试（包含 iPad 双语）、后端回归 36 PASS / 6 历史预设 SKIP。58 份 db.js / ai.js 共享副本一致。合并进程运行时浏览器测试受到全局 fetch mock 干扰，改为默认进程隔离后 50/50 通过；未修改业务代码来绕过测试。

已部署：person_360、assistant、ai_recommend、ai_referral、ai_followup、ai_activity；前端只上传 person-interaction.js、pages/person.js、i18n.js。admin.html 无修改。

完整门禁、部署证据与发布标签见下方记录；提交以该标签对应的 Git 提交为准，三端一致性以发布脚本最终 PASS 为准。

## 回退及验证边界

应用回退到基线受影响文件；数据库按 editor.rollback → interactions.rollback 顺序停用新增执行器及同步桥。保留新增列、历史互动和引用，不以删数据回退。旧页面继续可读写兼容字段。

本地浏览器使用合成数据；线上 SQL 回归是真实数据库服务角色事务验证。真实账号登录、真实客户跨云函数 AI 调用及模型输出质量须单列验证情况；不把源码一致当作业务完整验收。

## 本轮部署与发布执行

- 目标发布标签：release-20261030-230058；发布脚本先核对云端，再提交、推送 master 与标签，最后重新执行完整 sync-check。仅脚本最终 PASS 代表三端发布完成。
- 6 个指定云函数均部署成功；3 个前端文件均上传成功。部署后逐函数调用校验入口均正常，person_360 / assistant 拒绝未登录访问；其余函数拒绝缺参数或未知操作。未触发真实模型生成。
- WP01 发布门禁通过，blockers 为空。全站隔离回归 108 PASS / 0 FAIL / 5 历史预设 SKIP，匿名访问检查 78/78 PASS；PC34 实际 service_role 只读访问与双语 iPad 检查通过。
- 专项测试最终 51 项通过（50 项组合测试，加新增服务端身份范围测试）；31 个变更 JavaScript 文件语法通过。
- 线上 SQL 事务回归与函数入口探针已执行；真实用户登录后的新表单保存、跨云函数 AI 上下文与模型输出未做在线验收。WP01 通用报告仍列出的 live-writes / service-runtime 不替代本记录中单独取得的 SQL 和服务角色证据。
- 完整日志位于本轮执行目录 tests/security/.results/unified-*.log（忽略入库）；报告不包含密钥或真实客户正文。
