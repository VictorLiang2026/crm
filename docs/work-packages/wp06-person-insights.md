# WP06 Person 360 统一时间线与上下文

状态：完成标记仅在 `release-20261003-215500` 推送及发布后三端核对通过后生效。专项范围已获用户明确确认。本轮仅实施 WP06，未建立新的数据库对象或样本。

## 基线、影响与兼容

修改前本地、GitHub master、CloudBase 源码一致于 `45118d76c4bee070bf37cf15f1f63df9df73af4f`，回退基线 `release-20261003-184243`。已读根 `AGENTS.md`、环境/安全边界及 `specs/target-crm-v1/` 的需求、设计和任务文件。实时只读核验限于 `public`：客户 #788 对应的已登记虚构 Person #783 有一条旧跟进和一条实际到场；`public.context_items` 当前没有业务行。没有访问其他 schema 或前缀函数。

影响 Person 360 页面、新的 `person_360.getTimelinePage` 和 `getContextGroups` 只读动作、旧客户跟进页签桥接，以及隔离浏览器测试工具的协议等待上限。读取 `public.persons`、`interactions`、`followups`、`recruit_candidates`、`recruit_followups`、`activity_participants`、`activity_speakers`、`activities`、`context_items`；不写表、不改字段、GRANT、RLS、视图或函数签名。原客户、招募、活动、回收站与旧 URL/编辑表单继续负责写入。无需 migration/rollback。

时间线按来源 ID 合并旧客户跟进、招募跟进、已到场活动和人工互动，再排序分页。旧来源是当前事实：若对应的旧跟进已编辑，展示最新旧记录；若被删除，不由已物化的互动副本复活。活动只读 `status=attended`，报名不算到场。每页重新读取，不做历史 backfill。单次来源读取硬上限 400 行；超过时明确失败，避免返回不完整的时间线。上下文按 Fact、Signal、Inference 各读取最近 15 项，标出内容、来源、确认状态、最近时间；生产当前为空，空态如实显示。

测试数据继续参加普通查询，页面和服务端按原台账返回“含测试数据”及来源摘要。只展示/跳转，测试样本不会触发联系或外发。AI Gateway 原有 `AI_GATEWAY_GROUP` / `AI_GATEWAY_MODEL` 配置和 CloudBase 模型管理保持不变；本 WP 的两个只读动作均未调用模型。

## 验证与曾经失败的路径

- WP06 不落库夹具 5 项通过：55 条旧跟进跨页去重、物化来源的编辑/删除同步、实际到场而非报名、三栏确认与来源、非法身份/分页拒绝；隔离浏览器检查翻页、旧跟进跳转、测试提示和 390px 布局。没有写入或新增初始业务行。
- 完整发布门槛最终 `PASS_WITH_LIMITATIONS`：权限目录 646 项、匿名拒绝 50/50、WP02 17 项、WP03 18 项、WP04 8 项、WP05 8 项、WP06 5 项、旧回归 94 项通过，旧回归 0 失败、5 项按原定义未执行。`tests/security/.results/wp01-report.json` 与 `tests/regression/.results/latest.json` 保留原始证据。
- 初次旧回归在 `phase14.ai-more` / `ai.search.entry` 出现 `CDP timeout`；后续失败位置变为 Person 360、Today，且同一代码可完整通过。全部为隔离本地浏览器的 DevTools 协议等待，AI 入口只使用固定夹具，没有调用模型；并行云端核对时浏览器测试显著变慢。将协议单命令超时从 15 秒增至有限的 45 秒后，完整回归通过，路由自身的断言/时限及失败拦截保留。不能据此断言本机卡顿唯一根因；未调整模型、业务请求超时或生产代码的错误处理。
- 最终部署后用 `prtest` 隔离窗口真实只读验收 14/14：测试场景身份、旧跟进、实际到场、同来源去重、虚构标记、测试提示、三栏空态、390px 模拟布局和前后台账计数。初始/衍生/AI 审计为 10/2/3，新增 0；受保护证据在 `tests/security/.results/wp06-live.json`。真实旧跟进编辑/删除用不落库可变夹具验证，未删除生产测试行。

未验证项：实体手机、生产 `context_items` 的非空展示、生产上真实删改旧跟进、服务角色独立运行时及真实 AI 模型调用。WP01 专用登录摘要已过期，门槛明确标为需人工登录；本 WP 的独立 `prtest` 真实验收已通过。线上没有新外发或 AI 审计。

## 发布与恢复

本轮仅部署 `person_360` 函数及 `admin.html`、`crm/js/modules/person-360.js`、`crm/js/modules/person-insights.js`、`crm/css/person-360.css`。新增服务、前端模块、三个 WP06 测试脚本及本报告；更新函数分发、旧页面桥接、页面样式、回归夹具/门槛和 package 测试入口。未部署测试或文档。线上入口：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。

回滚时以 `release-20261003-184243` 为基线创建恢复提交，仅恢复上述函数及四个静态产物后逐项部署并重新核对，不强推。数据库和测试数据无变化，无数据库回滚步骤；隔离测试工具可随恢复提交回退。
