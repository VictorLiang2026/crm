# PC11 · Person 资料附件与关怀记录整合

日期：2026-10-15（Asia/Shanghai）。范围仅限 PC11；不调整数据库结构、权限、身份映射、统计口径或 Legacy 路由。

## 基线与影响

- 起点：GitHub `master` 提交 `d27902bc2e6f18de32b64121f4c1b56ffc39be3f`，回滚标签 `release-20261015-210613`。修改前完整 sync-check 核对本地、GitHub、CloudBase：29 个既有函数的 182 个源码/配置文件及可达静态资源一致。
- 本轮影响：Person 页面新增“关怀与资料”页签；新增静态模块并扩展 `data.js`、`i18n.js` 和 `console.css`；仅更新既有 `gifts`、`photos` 两个函数。
- 数据关系保持现状：礼品和附件均按 `customer_id` 归属；Person 通过现有 `customers.person_id` 取得客户 ID。无客户关联时只提示约束，不创建 customer。照片列表仍只返回元数据，预览/下载时才调用 `photos.get` 取 base64。没有使用 `activity_id`。
- 礼品仍支持名称、数量、赠送日期、备注的新增/编辑/硬删除；附件沿用 base64 数据 URL，保留类别、文件名、MIME、排序、日期及备注显示；备注可编辑。上传限制为 4 MB/文件，按顺序上传并禁用重复提交。
- 单条礼品/附件删除明确提示永久删除。客户/人物整批软删除与恢复逻辑未改。未新增/删除/重命名数据库对象、视图、函数或路由，也未调整 RLS/权限；无 migration，因此无数据库回滚脚本。

## 回归

- `npm run test:pc11`：3/3 通过，覆盖函数分页/客户范围校验/元数据去 base64/非法类别、Person 页面读取、文件按需获取、重复提交、超 4 MB 文件、模拟上传失败反馈、中英文和 iPad 横竖屏无横向溢出。
- `npm test`：108 PASS、0 FAIL、5 个项目原有条件跳过。客户照片、客户详情、登录、跟进、活动、招募、回收站和 Person360 相邻路径通过。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`。public 目录权限 881 项无漂移；匿名网关 64/64；WP02–WP06 夹具及 Legacy 108 项回归通过。保留既有 3 条参与者身份例外。人工登录、service-role 单独运行时和真机未在本包验证。
- 线上标记数据回归使用现有虚构客户 #788（Person #783）及正式函数调用；没有触碰旧照片 #25/#26：
  - gifts：ID #199，限定客户列表显示；客户 #789 的错误范围更新/删除均拒绝；正确范围编辑名称以外的数量、日期、备注并读回通过；最后按既有硬删除语义清理。
  - photos：ID #28，上传文本附件后元数据列表不含 `photo_url`；客户 #789 的错误范围 get/update/remove 均拒绝；客户 #788 的按需读取返回正确 data URL；备注编辑和读回通过；无效类别被拒绝；最后按既有硬删除语义清理。
  - 前一轮诊断调用临时生成的 gifts #198、photos #27 也已按标记清理。测试跟踪触发器自动登记所有四条派生样本；源记录硬删除后，仅按精确批次、父客户、表和 ID 清除其对应测试台账行。没有变更台账权限。
  - 结束后的 public 只读核对：初始登记行仍为 10；客户 #788 活跃礼品 0 条；活跃照片 2 条；照片 #25/#26 均存在；PC11 礼品/附件/台账残留均为 0。序列已消耗 ID #198/#199、#27/#28，不回退序列。
- 线上业务操作通过 CloudBase 函数命令执行，未使用真实客户信息、未调用 AI、未外发。Person UI 本包以隔离浏览器夹具验收，未声称已完成生产登录态全 UI 操作。

## 发布清单与恢复

- 云函数：仅 `gifts`、`photos`。
- 静态托管：仅 `/crm/js/modules/console/data.js`、`i18n.js`、`pages/person.js`、`care-materials.js` 和 `/crm/css/console.css`。
- 不部署 `admin.html`、整个项目目录、测试或文档；线上页面入口保持 [CRM Console](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/console.html)。
- 代码恢复基于本轮前标签 `release-20261015-210613` 创建恢复提交，只恢复上述 7 个业务产物并重新部署；不强推、不回退数据库序列、不改任何用户数据。
- 代码发布提交：`85c4f5f2da73e5c7483419e8b7f12c3fd44918f1`；标签：`release-20261015-222100`，已推送 GitHub `master`。
- 发布脚本完成提交/标签原子推送及后置完整 sync-check。证据目录：`C:\Temp\crm-pc11-release-audit\crm-cloud-audit-1c7b16a968a74ead9684a31c23ac7b69`；本地、GitHub、CloudBase 静态资源及 29 个函数/182 个源码配置文件一致。
- 云端代码证据：发布前后 `admin.html` HTTP 200 且 SHA-256 一致；56 个可达页面/模块/样式资源及本轮两个函数哈希一致。
