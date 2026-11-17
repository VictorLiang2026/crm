# Person 互动日期与跟进日期同步

日期：2026-11-17  
基线：`e4834cdb52d7f4cec6025317b15695c9aaff3407`  
迁移：`20261117170000_person_interaction_followup_dates`

## 变更

- “记录互动”的“发生时间”改为日期输入“本次跟进日期”，按 `Asia/Shanghai` 当日保存；历史时间戳请求仍兼容。
- 所有人物场景都可填写“下次跟进日期”。未提供该值时保留已有日期；明确点按“清除下次跟进日期”才会清除。
- 客户跟进日期写入原 `public.followups` 字段；一般互动日期写入新增的 `public.interactions.next_followup_date`。
- 人物目录与客户工作清单将客户跟进、增员跟进、一般互动汇总在一起：最近日期取最大值，未来下次日期取最早值。
- 互动保存或删除时更新 `public.persons.updated_at`。普通人物资料保存路径继续由资料保存事务更新该字段，不改本次/下次跟进日期。
- 迁移及回滚仅改 `public`；迁移前未发现依赖 `public.interactions` 的视图。回滚在该列仍有非空数据时拒绝删除，避免丢失跟进日期。

## 验收

- PGlite 互动迁移回归：通过。覆盖上海时区日期保存、客户跟进日期同步、日期精度、空白保留、显式清除、人物 `updated_at`、旧时间戳调用兼容及安全回滚。
- 人物目录 SQL 回归：通过。覆盖一般互动进入最近/下次跟进汇总、与既有来源共同汇总以及回滚恢复。
- iPad 双语互动编辑器浏览器回归：通过。覆盖日期输入、一般/客户互动、下次日期显示和显式清除。
- 人物列表回归：7 项通过。
- PC05 旧互动入口回归：通过。
- 模块化前端检查：通过。
- WP01 完整发布门禁：通过；保留现有登录、服务角色运行时、生产写入和移动端未验证项。
- `test:interactions` 单独运行有 8 个既有 Person 360 dispatch 测试因夹具返回 `DEVICE_ACCESS_DENIED` 失败；在未修改的干净 `master` 上同样复现。WP01 综合回归为通过。
- CloudBase 迁移应用工具报告结果与后续状态查询不一致。只读复核确认迁移版本已列入远端历史，日期列已存在，互动 RPC 与三个目录 RPC 均含预期 SQL 片段。
- 生产服务角色目录 RPC 运行探测因只读 SQL 工具使用管理角色而返回 `Unauthorized`，本轮未完成该运行探测；没有对生产业务记录执行创建、更新或删除。

## 发布范围

- 数据库：只执行 `20261117170000_person_interaction_followup_dates`。
- 静态托管：仅上传 `crm/js/modules/console/person-interaction.js` 和 `crm/js/modules/console/i18n.js` 到对应 `/crm/js/modules/console/` 路径。
- 不部署云函数；不触及 `pr` schema 或 `pr_*` 函数。

## 本轮补充复核（2026-11-17）

- GitHub 在发布检查期间由 `e4834cd` 前进至 `23cbe60`，内容正是本互动功能与 migration；发布脚本在检测到本地落后时安全停止，未提交/打标/推送。随后发布工作树 fast-forward 至 `23cbe60`，未强推，也未覆盖并发提交。
- CloudBase 中 `20261117170000_person_interaction_followup_dates` 已存在；新列存在，39 条人工互动里非空 0 条。RPC 只读核对通过日期型输入、旧时间戳兼容、显式清除及 Asia/Shanghai 处理；未重复执行 migration。
- 本轮将两份对应静态文件按明确路径上传，CloudBase 返回 `successCount=2`、`failedFiles=0`。上传后 `tests/wp01/static.cjs` 确认 106 个可达资源与线上一致。
- 定向验证：`node --test tests/interactions/unified-editor.browser.cjs` 1 PASS；`node tests/interactions/unified-migration.cjs` 通过；`node tests/console/directory-participation.cjs <PGlite module>` 通过；变更 JS/测试文件语法检查通过。
- 在干净 GitHub 提交 `23cbe60` 上运行 `npm run test:interactions`，27 项中 19 PASS、8 FAIL。失败集中于既有 `person360-dispatch.cjs` 对无设备授权请求预期 `UNAUTHORIZED`、实际返回 `DEVICE_ACCESS_DENIED`；本工作包未改 Person 360 服务端鉴权代码。最终 WP01 会单独覆盖发布门禁及隔离回归，不能把该套件失败记作通过。
- 教育排序回归：21 PASS / 0 FAIL / 0 SKIP；本互动工作未改教育业务或教育 migration。
- 最终 `npm run test:wp01`：`PASS_WITH_LIMITATIONS`。Catalog 1,646 checks / 0 drift（93 tables、20 views、42 sequences、114 routines）；WP04 0 例外；隔离 regression 102 PASS / 0 FAIL / 5 历史预设 SKIP；匿名权限 113/113。登录、service-runtime、live-writes、mobile 保持未验证。
- `npm run test:interactions` 在干净 GitHub `23cbe60` 上为 19 PASS / 8 FAIL。失败是现有 `person360-dispatch.cjs` 预期与设备访问拒绝码不一致；本工作包没有改该服务端路径。WP01 隔离回归通过。
- 发布前 `npm run check:release-gate` 通过。静态托管上传成功 2/2；完整 `sync-check.ps1 -CloudOnly`：106 个静态资源、30 个函数/340 个源码配置文件一致，线上 `admin.html` HTTP 200 且 SHA-256 一致。
- GitHub 当时已有互动提交 `23cbe60f5b4373dc1b6b2c60cf83d7d36c1e0fed`；最终闭环提交为 `a3ccac5cbfdb5e204fb7bd490712838805966e3d`，标签 `release-20261117-173700`，已原子推送到 `master` 与远端标签。
- 发布后 `sync-check.ps1` 完整通过：本地/GitHub/CloudBase 一致，106 个可达静态资源、30 个函数的 340 个源码/配置文件匹配，线上 `admin.html` HTTP 200 且 SHA-256 一致。复核证据：`D:\Temp\crm-cloud-audit-8e3d04a81738468dbf3e57ea0e18f19c`。
- 发布范围：数据库 migration 已在生产历史中，本轮没有重复应用；静态托管上传 2 个模块；没有云函数、`admin.html` 或权限变更。没有对生产业务记录执行创建、更新、删除、AI 调用或回滚。
- 本地 `D:\CRM\crm` 工作区的旧分支已在确认其为远端祖先且四份未跟踪 migration blob 与 GitHub 完全相同后 fast-forward 到提交 `a3ccac5`；工作区清洁。
