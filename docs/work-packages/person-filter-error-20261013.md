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

## 2026-10-14 继续诊断

- 生产现状：筛选请求仍会返回通用错误；生产函数源码与仓库基线一致，CLS 已启用且函数日志绑定正常。17:50–18:42（北京时间）查询不到 `person_360` 请求记录；旧 `GetFunctionLogs` 查询接口已下线。
- 之前已批准的诊断改动：`listPeople` 遇到 RPC HTTP 错误时，仅向界面返回 HTTP 状态码和经过白名单校验的 PostgREST / SQL 错误码；不返回数据库原始消息、SQL 或凭据。其他 action 保持原有通用错误。
- 校验器：`tests/wp01/static.cjs` 对比内容前只把 CRLF 归一成 LF；线上 `console.html` 归一后与基线完全一致，其余内容仍逐字节对应文本比较。
- 影响范围：`cloudfunctions/person_360/index.js`、`tests/wp01/static.cjs`。不改页面请求契约、业务数据、数据库结构或权限，也不触及 `pr` schema / 函数。
- 回归：`node --check` 通过；人物目录与 People 浏览器测试 6/6 通过；错误码模拟验证通过（允许的 `PGRST202` 可见，非白名单码和原始响应消息不外泄）；WP01 108 PASS、0 FAIL、5 SKIP，匿名权限探针 61/61，发布门槛 `PASS_WITH_LIMITATIONS`。真实登录、service_role 运行时、写入及手机验收仍按门禁记录为未验证。
- 根因仍未确认；部署后需让生产人物筛选再发出一次真实请求，使用界面返回的状态/错误码或 CLS 请求记录继续定位。不得将诊断改动描述为已修复根因。
- 最新 CLS 查询（2026-10-14 22:00–23:15，北京时间）仍无 `person_360` 请求记录；用户尚未在该窗口触发新的筛选请求。
- 部署：2026-10-14 23:35（北京时间）通过 `tools/deploy-function.ps1 -Function person_360` 更新生产函数；生产详情为 Active / CodeResult success，部署后源码检查确认新诊断逻辑存在。`sync-check.ps1 -CloudOnly` 通过：51 个页面/模块/样式资源、29 个 CRM 函数的 175 份源码/配置文件与云端一致。23:30–23:45 CLS 查询仍没有该函数请求。
- Git 提交与发布标签在本节完成后追加；部署前标签为 `release-20261014-0117`。
- 恢复方式：按发布前标签恢复 `person_360` 函数代码；校验器如需恢复，使用该标签的 `tests/wp01/static.cjs`。不涉及数据库回滚。
