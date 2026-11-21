# 每日激励语评分、轮换与多格式导入发布记录（2026-11-21）

## 变更范围

- 每日激励语库管理增加 JSON、Excel（`.xlsx`）、CSV、TSV 导入；支持中英文常见字段名。解析在浏览器本地完成，单文件上限 5 MB、最多 80 行。
- 导入预览由服务端重新计算重复关系：精确重复自动跳过；相似项要求人工选择保留原文或导入新文；其他记录默认导入。写入仍需登录 CRM 操作人确认。
- 展示时段设置与批量导入在 iPad 页面并排显示；语录列表保持在其下方。
- 可逐条维护 0–10 推荐值，设置最低推荐分数，只有达到阈值且已评分的语录可作为展示候选。
- 默认禁止循环用完前重复选择；允许重复时，后端优先展示尚未使用的候选。选用服务端实时轮换和既有调用历史，未增加夜间 AI 预生成。
- `assistant` 的 `daily_inspiration` RPC 增加评分筛选、按用户记录轮换状态、批量导入预览与提交。保留旧版三字段时段设置请求的兼容行为。
- 新增 `public.daily_inspiration_rotation_used` 和两个用户设置字段；迁移同时只对推荐值为空的语录按确定性规则补分，已有推荐值保持原样。提供受保护的 rollback；若表中已有轮换日志或用户修改设置，需先人工评估数据后再回滚。

## 影响范围与数据

- 页面：`admin.html` 中每日激励语管理页的既有模块装配，不替换单文件旧实现。新增解析逻辑位于 `crm/js/modules/console/daily-inspiration-import.js`，页面和字典位于 console 模块。
- 接口/数据：现有受保护的 `assistant` 函数及 `public.crm_daily_inspiration_v1`；public 迁移 `20261121190000`。未改登录、RLS 旧规则、客户数据或既有路由。
- 首次迁移前检测到 5 条未评分语录；部署迁移后这 5 条均已补分，当前分布为 7 分 1 条、8 分 3 条、9 分 1 条。
- 未批量导入新增语录；导入数据仍需操作人在 CRM 页面检查预览并确认。

## 验证与发布

- 定向测试：`tests/ai-gateway/daily-inspiration.cjs` 11 项、`tests/console/daily-inspiration.browser.cjs` 1 项（覆盖 JSON/Excel/CSV/TSV、相似项选择、旧版编辑及双语）通过。
- 相邻 AI gateway 18 项、AI skills 12 项、改动 JavaScript 语法检查通过。
- PGlite 隔离迁移回归覆盖阈值、轮换/重复策略和 rollback 数据保护；生产只执行迁移和只读核对。
- WP01 已在迁移后刷新 public 目录、WP04 身份快照并运行匿名探针；真实登录、service-role 写入路径和真机不在本轮自动验证范围。
- WP01：`PASS_WITH_LIMITATIONS`，安全目录 1,783 项通过，匿名只读探针 124/124，通过后端及隔离浏览器回归 102 项、0 失败、5 项历史跳过；WP04 活动身份覆盖 1,368 条、无例外；PC34 四项通过。
- CloudBase 发布：迁移 `20261121190000` 与 ACL 收紧 `20261121190300` 已应用；`assistant` 已部署；静态仅上传 4 个受影响文件。
- 线上核对：111 个可达页面/模块/样式与本地一致；30 个函数的 347 个源码/配置文件一致，`admin.html` SHA-256 与本地相同。
- 仍未验证：真实用户会话下的手动导入确认和批量数据写入、service-role 写入路径、真实设备视觉验收；未在本轮导入约 60 条语录。

## 回滚

- 代码按前一个发布标签恢复，再单独部署 `assistant` 和本轮上传的静态文件。
- 数据结构回滚使用 `cloudbase/migrations/20261121190000_daily_inspiration_filter_rotation.rollback.sql`。脚本拒绝在轮换记录已产生或设置已被修改时自动删列；语录评分回填保留在原有评分列中。

- 发现并修正 CloudBase 默认表授权：新增 public.daily_inspiration_rotation_used 在创建后曾对 anon/authenticated 有效开放；版本 20261121190300 明确撤销两类客户端权限，只保留 service_role。迁移后只读目录核实两类客户端有效权限均为 false、RLS 强制开启。
- 因安全门禁要求登记新增 public 对象，	ests/security/expected-public-baseline.json 只加入经线上快照核实的该服务端表条目；未放宽已有角色或权限基线。回滚该 ACL 收紧迁移也保留 service-only 权限，避免数据表暂存期间恢复客户端授权。
