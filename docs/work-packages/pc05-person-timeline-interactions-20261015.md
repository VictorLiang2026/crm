# PC05 Person 互动时间线与 Legacy 跟进整合

## 目标与范围

将人工互动和客户跟进纳入 Person 360 时间线的原生写入路径。复用已上线的 `person_360.createInteraction`、`followups` 和 `ai_recommendations`；招募跟进与活动参与继续只读展示并保留来源链接。Legacy 页面、路由、权限与统计口径保持不变。

## 本次实现

- 时间线新增人工互动入口。记录互动类型、当地日期时间、渠道、摘要和原始记录；写入走现有 `person_360.createInteraction`，成功后关闭弹层并刷新当前 Person 页签。
- 只有具有有效客户关联的 Person 显示客户跟进入口。新增/编辑复用 `followups` 的 `list/create/update/remove`，编辑前核对来源记录属于当前客户且未删除。
- 客户跟进表单承载原记录的跟进日期、摘要、完整记录、下一次跟进日期/目标、AI 推荐关联、活动关联、下一步行动和行动日期。保存不复制成第二条互动。
- 硬删除仅作用于原客户跟进记录，经过二次确认并明确说明不可从回收站恢复；招募跟进和活动来源不开放编辑/删除。
- 时间线显示继续复用 `source_type/source_id` 去重结果。Person 写入完成后刷新当前视图，并让总览、时间线、活动关联页签失效，避免已缓存的关联事实过期；Today 在重新进入时由既有路由重新读取。
- 新增文案经统一 i18n 字典提供简体中文与英文。无样式表和数据库结构变更。

## 影响面与兼容

- 页面：`console.html` 下的 Person 360 总览、互动时间线、活动关联页签。
- 既有 API：新增调用仅为已存在的 `person_360.createInteraction`、`followups.list/create/update/remove`、`ai_recommendations.list`；未新增云函数或接口契约。
- 数据：人工互动写入 `public.interactions`；客户跟进新增/修改/硬删除仍作用于 `public.followups`。无迁移、无回填、无测试业务数据写入。浏览器回归全部使用隔离的合成夹具。
- 权限：沿用现有登录态和各函数授权；没有匿名授权、客户端直连数据库或跨 schema 操作。
- 兼容：旧客户跟进入口、Legacy 页面和路由保留；来源记录不重复复制。招募与活动旧记录只读并可沿用现有活动链接。

## 验证记录

- `npm run test:pc05`：通过。隔离浏览器验证了互动新增、当地午夜时间转换、双击单次提交、客户跟进新增/编辑/硬删除、推荐及活动关联字段保留、时间线更新、已缓存活动页签失效、Today 重新进入读取、英语文案及 iPad 竖屏/横屏无横向溢出。
- 相关互动服务回归（4 个测试文件）：26/26 通过。测试含 Legacy Adapter、互动时间线来源去重、活动互动兼容及 person_360 分发权限边界。
- `node --check`：本包 JS 与浏览器测试文件通过。
- `git diff --check`：通过（仅 Git 提示工作区 LF 将由 core.autocrlf 转为 CRLF）。
- 真实生产账号下的写入回归未执行；不以离线合成夹具冒充云端写入验证。
- 数据库迁移：0；云函数部署：0。

## 发布记录

静态托管于 2026-10-15 发布以下四个文件：`crm/js/modules/console/data.js`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/person.js`、`crm/js/modules/console/write.js`。生产返回成功 4/4；生产 Person 模块 HTTP 200 且含客户跟进入口。`sync-check.ps1 -CloudOnly` 通过：51 个可达静态资源一致，29 个函数、175 个源码/配置副本一致。数据库未迁移，云函数未部署，静态托管以外的云端业务产物未变化。

Git 发布按既有流程创建提交并推送 `master` 和标签 `release-20261015-094800`；发布后将以 `sync-check.ps1 -AllowPreservedDocs` 核对本地、GitHub、静态托管、函数与标签。WP01 门禁结果为 `PASS_WITH_LIMITATIONS`：必需自动检查通过；真实登录、service-role 运行时和生产写入没有执行，均保持未验证状态。移动端既有回归通过，但本包未新增手机适配设计。
