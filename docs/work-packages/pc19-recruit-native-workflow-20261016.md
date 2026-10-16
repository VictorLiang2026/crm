# PC19 · 原生招募候选人工作流

日期：2026-10-16。范围按用户确认实施：在现有共享 CRM Web 中增加 Console 招募候选人创建和 Person 360 招募操作；当前仓库没有独立小程序客户端。

## 实施范围

- Console 新建候选人时先通过服务端 `PersonService.resolveName()` 搜索，用户明确选择 Person 后才提交；服务端再次核对候选人身份并关联已有有效客户记录（如有），不会创建客户或 Person 角色。
- Person 360 展示候选人资料、阶段历史、跟进和附件；阶段及里程碑在单个 `public` RPC 事务内更新，并检查 `updated_at` 防止并发覆盖。
- 附件继续使用现有 `recruit` 存储桶；上传成功后才更新候选人文件元数据，保留原文件清理失败提示。
- `admin.html` 既有客户必选、候选人 CRUD、附件、软删除及同批恢复流程保留。
- 新界面文案经 Console i18n 简体中文/英文词条维护，按 iPad 页面范围实现。

## 数据库与权限

- 迁移 `20261016150000_recruit_candidate_commands` 已应用到生产 PG，最新版本核验一致。新增两个 `public` RPC，无新增表或列。
- `crm_recruit_candidate_create_v1` 与 `crm_recruit_candidate_transition_v1` 均为 `SECURITY DEFINER`；固定 `search_path`；执行权限仅授予 `service_role`，`authenticated` 与 `anon` 均无执行权。
- 配套回滚位于 `cloudbase/rollbacks/20261016150000_recruit_candidate_commands.rollback.sql`，仅移除这两个精确签名的函数。
- WP01 权限基线仅增加上述两条经核验的精确函数签名；其它对象与角色授权未调整。

## 回归与审查

- PC19 专项：10/10 通过，覆盖人工选人、服务端复核、防重复/过期阶段、详情身份绑定、候选人资料/阶段/跟进、上传失败不写文件元数据。
- 旧招募兼容：`tests/pmc/pmc12-recruit.test.cjs` 9/9；Person 360 时间线/旧跟进兼容 9/9；模块化检查通过。
- WP01：目录权限 915 项断言通过；隔离旧业务回归 108 项通过、0 失败、5 项既定跳过；匿名公开读取探针 65/65；身份审计保留 3 条既有“姓名待确认”例外。发布门禁 `PASS_WITH_LIMITATIONS`。
- `check:shared`：58 份副本一致；函数语法检查、`git diff --check` 通过。
- CloudBase 人工代码审查：入口拒绝缺少/匿名身份；写入经已核验 `public` RPC；无请求头或环境变量回显；沿用现有招募存储桶与客户端存储包装。

## 未验证项

- 未用真实用户账号执行生产登录；未用服务角色凭据做生产函数运行探针；未在生产创建或修改候选人、阶段、跟进或文件；未发送外部消息。附件流程以隔离浏览器模拟验证。
- 按本任务的 iPad 范围未进行实体手机视觉验收。

## 发布清单

- 云函数：仅 `person_360`。
- 静态文件：仅 Console 的 `app.js`、`data.js`、`i18n.js`、`pages/person.js`、`pages/recruit.js`、`recruit-write.js`。
- 数据库迁移已在生产应用；发布过程不重复应用迁移。
- 发布提交与标签按仓库发布流程记录；云端静态/函数核对在提交前完成，GitHub/生产最终一致性在推送后复核。
