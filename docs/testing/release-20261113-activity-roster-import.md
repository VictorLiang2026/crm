# 活动参与名单导入优化

## 范围

- 影响活动参与名单导入模块、`person_360` 云函数和 `public.crm_activity_roster_v1` RPC。
- 无人物匹配的行可直接导入并可改名；已有同名/括号外同名人物默认选中复用，并要求确认。
- 选择“不是同一人”时，服务端复用人物名单解析与限定词校验；新人物创建和已有未限定人物改名在同一事务中执行，失败则整批回滚。
- 姓名更新沿用人物名单已有语义，会影响该 Person 的全局引用记录；界面逐人列出原姓名与新限定词，并要求人工确认。
- 新增界面文本通过 Console i18n 提供简体中文与英文。工作区外其他未提交活动改动不包含在本发布中。

## 数据库

- Migration: `20261113072400_activity_roster_identity_rules.sql`
- Rollback: `20261113072400_activity_roster_identity_rules.rollback.sql`
- 仅替换 `public.crm_activity_roster_v1(text,text,jsonb)` 函数体和恢复原函数体；不新增/删除表列、数据或权限。
- 两个 SQL 文件已镜像到 `C:\Users\victor\cloudbase\migrations`，SHA-256 与仓库文件一致。

## 验证

- `node --check`：活动名单前端模块、`person_360` 服务和浏览器回归文件通过。
- `tests/activity-roster/roster.test.cjs`：PGlite 1 项通过，包含两种身份、原 Person 限定词改名、新 Person 创建、活动关联及缺少改名确认时拒绝。
- `tests/activity-roster/roster.browser.cjs`：4 项通过，包含桌面/iPad/iPhone 原导入流程与 iPad 身份核对、默认复用、未确认阻断和不同人物姓名限定词预览。
- `tests/wp01/run.cjs` 全套门禁与 `--assert-release`：通过，状态 `PASS_WITH_LIMITATIONS`；未验证项为真实登录、服务角色运行时、线上写入和真机手机验收。
- 生产迁移 `20261113072400`：首次 apply 响应提示迁移尚未登记；没有重试。随后 `describeMigrationTask` 为 `Succeed`、`listMigrations` 显示版本已登记，`migrationDetail` 返回新函数体；只读查询确认新分支存在且仅 service_role 可执行。
- 仅部署 `person_360`：CloudBase code update 成功。静态托管仅上传 `activity-roster.js` 和 `i18n.js`。
- `sync-check.ps1 -CloudOnly`：106 个可达页面/模块/样式与云端一致，30 个 CRM 云函数的 335 个源码/配置文件一致。
- 无 CRM 已授权身份的直接函数调用返回 `DEVICE_ACCESS_DENIED`（RequestId `c1c80855-e9d7-4974-9e8d-584de37e4088`），在身份门禁处停止，未读取或写入业务数据；实际导入仍以本地回归覆盖，不能称为线上业务验收。

## 回滚

先部署旧版 `person_360` 与旧版名单页面模块，再执行配对 rollback 恢复原 RPC 函数体。此更改不保存额外业务数据；已由用户导入的人物和参与者记录保留，不执行数据回滚。

## 生产差异

发布基线核对期间 GitHub master 前进到 `be23569d8a734781f00207d550f3c0c63507754c`，包含已上线的设备审批说明及知识库授权改动。本轮发布以该最新 master 为基线，保留了其 `device_pending` 原文，并只在 i18n 中追加参与名单导入用语。随后重新上传该 i18n 文件，避免中间部署版本覆盖最新 master 文案。知识库授权代码与报告已包含在基线中，不作为本轮改动提交。
