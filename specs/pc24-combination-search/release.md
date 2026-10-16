# PC24 发布记录

日期：2026-10-17（Asia/Shanghai）

## 变更范围

- 新增 `assistant` 的 `searchV2` 只读组合搜索，模型使用 CloudBase 已配置的模型；固定 SQL 分支和七类过滤条件限定在 `public` schema。
- 新增 `public.crm_search_people_v2(jsonb, integer, integer)`，只授予 `service_role`；迁移 `20261017123000`、`20261017130000`、`20261017133000` 均已应用，分别有配对 rollback。rollback 仅移除此搜索 RPC，不改业务数据。
- 更新 AI Gateway skill registry 两份副本，保留旧 `assistant.search`、旧解析 Skill 和既有三模板响应。
- 更新 Console 搜索的双语提示、人工确认 Person 候选、匹配依据及服务端分页；只考虑 iPad 优先布局。

## 回归证据

- `npm run test:pc24`：19/19 通过。
- PC23：14/14；PC20：5/5；PC07：11/11；PC08：12/12；PC09：13/13；PC10：8/8；PC15：5/5；PC17：4/4；PC19：10/10，均通过。
- WP04 身份门禁：8/8 通过；3 条既有未确认姓名映射仍按已登记例外报告，没有自动合并或写入。
- WP01：108 PASS / 0 FAIL / 5 历史预设 SKIP；目录 937 项检查通过；匿名探针 66/66；门禁 `PASS_WITH_LIMITATIONS`。人工登录、service-role 运行时、生产写操作和手机视觉保持未验证。
- 所有新增 JS 文件 `node --check` 通过。
- CloudBase 部署 `assistant` 成功；托管上传 3 个 Console 模块成功。完整 `sync-check.ps1 -CloudOnly` 通过：66 个可达页面/模块/样式资源一致，29 个 CRM 云函数的 189 个源码/配置文件一致。
- PC24 migration 列表显示最新版本 `20261017133000`，总计 93 条。只读 RPC 验证包含零命中和非法条件拒绝；未读取或返回真实客户明细。

## 未验证项

- `manageFunctions.invokeFunction` 在调用前被 CloudBase CAM authentication 拒绝；因此没有真实 assistant 请求/真实配置模型调用，也没有已登录用户界面验收。PC24 的解析器、服务端路径和页面为离线/隔离回归。
- 发布门禁另标记真实登录、service-role 运行时、生产 CRUD 和手机视觉未验证；本包为只读查询，没有线上业务写入。

## 恢复

若要停用 PC24，从 Web 静态托管回退三个 Console 模块并将 `assistant` 恢复到上一标签，然后通过新 migration 执行任一配对 rollback（它会 drop `public.crm_search_people_v2`）。回滚不触碰客户、Person 或测试业务行。
