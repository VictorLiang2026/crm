# 人物列表筛选失败修复（2026-10-13）

## 范围与影响

- 页面：`crm/js/modules/console/pages/people.js` 人物列表工具栏筛选按钮。
- 数据请求：沿用 `Person 360` 云函数及 `public.person_directory_filtered_page_v1`，不改变请求契约、业务数据、表结构、权限或云函数代码。
- 数据库：应用 `20261013100000_person_directory_rpc_schema_cache_reload`，发送 PostgREST schema cache reload 通知，使已存在的筛选 RPC 可被 REST RPC 路由发现。迁移不修改持久化 schema、数据或授权；同版本 `.rollback.sql` 再发送一次通知以重新同步缓存。
- UI：筛选按钮由 36px 小号 ghost 按钮改用已有 44px 深色按钮样式，与“新建人物”按钮同高、背景不同。

## 诊断

用户确认只选角色、以及同时选角色和优先级都会失败。前端请求构造和云函数参数映射均保留了数组筛选参数；生产数据库只读核对确认 RPC 存在，签名为 `p_roles text[]`、`p_customer_priorities text[]`、`p_recruit_priorities text[]`、`p_referral_priorities text[]`。基于“所有筛选组合都失败”且列表未筛选路径可用，判断共同的 REST RPC 入口/schema cache 未发现新 RPC 是较可能原因；这属于根据现有证据作出的根因推断，真实浏览器网络响应未能采集。

## 回归与验证

- 浏览器组件回归：`npm run test:people-pages` 3/3 通过，验证筛选按钮与“新建人物”同高、背景不同，角色和优先级多选在点击搜索时传入列表请求，回收站仍无人物筛选器。
- 目录 SQL、RPC 参数及安全回归：9/9 通过。
- WP01 发布门槛：`PASS_WITH_LIMITATIONS`；目录/身份快照、WP02/WP03/WP04/WP05/WP06、总回归 108 项、匿名网关探针 61/61 通过；既有隔离用例共 5 项跳过。
- 生产迁移应用成功，任务 `task-52c61f06` 状态 `Succeed`；远端迁移总数 74，最新版本 `20261013100000`。
- 只读 SQL 已核实筛选 RPC 位于 `public` 且签名包含全部筛选数组。
- 未能通过已打开的生产浏览器账号完成真实筛选后列表刷新；当前可用工具没有已认证的浏览器会话，Person 360 函数日志查询也不可用。因此不得将生产端到端筛选结果记为已验证。

## 发布记录

部署范围：人物页单个模块 `/crm/js/modules/console/pages/people.js`；未部署云函数或上传整个项目。生产环境 `crm-d1gkae8ddc930d151` 上传成功，线上 HTTP 200，文件 11,308 bytes；线上与本地 SHA-256 一致：`16FAB6927973B76CFB4285D79815AC808DDCC093B5FAABA141E90D26A66E2D55`。该资源线上地址为 `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/js/modules/console/pages/people.js`。Git 发布：推送到 `master`，标签 `release-20261014-0117` 指向本次提交；提交 SHA 以该标签在 GitHub 的解析结果及本轮发布报告为准。发布脚本执行完成后复核本地、GitHub 与生产静态资源。

## 回退

- 页面：用发布前版本恢复并仅重新上传 `/crm/js/modules/console/pages/people.js`。
- 数据库通知无持久化结构/数据影响；配对 rollback 文件为 `cloudbase/migrations/20261013100000_person_directory_rpc_schema_cache_reload.rollback.sql`，只重新发送缓存刷新通知。不要回滚任何既有业务迁移或数据。
