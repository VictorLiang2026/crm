# WP07 Quick Capture V2 确认写入

状态：发布与真实账号验收待最终核对。专项范围已获用户确认。本工作包只对 allowlist 中的测试账号启用 V2；旧 Quick Capture 和旧 V2 函数保持可用。

## 基线与影响

改动前本地与 GitHub master 为 `1bf2b9099a64adf6a96a9056a5999dffb2eef085`，回退标签 `release-20261003-215500`；先前完整源码核对通过。本轮重新读取根 `AGENTS.md`、环境与安全边界及目标 CRM 三份规格文档。新代码只涉及 `admin.html` 的 V2 入口、`crm/js/modules/quick-capture-v2.js`、对应 CSS、`assistant` 函数和 `public` 的两条新迁移。无旧路由、旧表、旧函数的删除或重命名；未改模型厂商选择、登录、软删除和外发通道。

新接口为 `assistant.quickCaptureV2` 的 parse、resolve、plan、preview、confirm、execute 阶段。服务端核验真实登录与 `CRM_TEST_SEED_UIDS`，经 `PersonService.resolveName()` 取得候选，用户显式选择测试 Person。AI Gateway 读取 CloudBase 配置模型并生成带 task/run/result ID 的候选草稿；事实候选默认不勾选，确认后写入的 Fact/Signal 仍为未确认。Plan 在 `public.quick_capture_v2_plan_v1` 中先验证人物、草稿和 AI 审计，再与审计关联一起提交；失败时事务回滚。Preview 绑定账号、人物、版本与 15 分钟有效期，Confirm 必须提交服务端 hash，Execute 使用同一命令 ID 事务写入 Interaction、Context Item、Action、Commitment，并返回逐条 ID；重复 Execute 只返回原结果。机会候选仅展示，不在本工作包写入。所有写入仅关联已登记虚构 Person，初始 10 条样本不增加，不触发真实外发。

数据库新增 `public.quick_capture_v2_commands` 与两个受限 RPC。命令表启用并强制 RLS，仅 service_role 可读写；RPC 仅 service_role 可执行，匿名与 authenticated 无权访问。没有改已有表字段、视图或权限。迁移 `20261003163401_quickcapture.sql` 及 `20261003170000_quickcapture_atomic_audit.sql` 已应用，均有同名 rollback；计划表在上线前为空。回滚原子计划函数可独立执行；主回滚若已有 executed 记录会拒绝，需先审查业务数据及审计 ID，再决定恢复方案，禁止静默删除样本。

## 验证与限制

- 本地 PGlite 编译并验证计划、预览、确认、执行、重放，以及审计关联失败时计划事务回滚；生产两条迁移任务均成功。
- WP07 测试 5/5，旧 V2 5/5，AI Skill 7/7；WP01 安全目录 664 项通过、匿名网关 51/51、隔离旧路由 94 通过/0 失败/5 项按原定义跳过。一次隔离浏览器超时发生时页面和 URL 均已正确渲染，复跑完整门槛通过；测试工具保留 URL/fixture 诊断，不更改业务路由。
- 部署后仅以无登录态调用 `assistant.quickCaptureV2.execute`，返回 `UNAUTHORIZED`；云端 `assistant` 的 Nodejs18.15、90 秒超时及三个必要配置键仍在。云端只读源码核对：主页面 HTTP 200 且 SHA-256 相同、22 个页面引用产物相同、28 个 CRM 函数的 163 个源码/配置文件相同。
- 客户 ID 789、790 与活动参与者 ID 19、20 是新增的未映射记录。2026-10-04 用户确认可暂缓处理；核实没有错误 Person 关联或招募/活动交叉引用。保留记录，并在 WP04 身份审计例外清单逐条列明，不按姓名合并，不删除客户数据。
- 真实账号、生产 AI 模型与确认写入、手机实际设备仍待单独验收；本地夹具、源码哈希和权限目录不能替代这些证据。

## 发布与恢复

仅部署 `assistant` 函数，以及 `admin.html`、`crm/js/modules/quick-capture-v2.js`、`crm/css/quick-capture-v2.css`。测试、迁移和本文档只进入 Git，不上传静态托管。云端页面：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。

代码恢复以 `release-20261003-215500` 为基线创建新提交，重部署本轮四个产物并核对，不强推。数据库先按上述两份 rollback 的顺序逆序评估；若已有执行记录，保留业务和审计行并另案制定数据恢复，不直接运行主 rollback。
