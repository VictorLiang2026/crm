# WP03 旧客户入口收拢

日期：2026-10-30  
基线：`b4c7bc5a7784ffa6e3ede1cde5978af7f04c00b3`，标签 `release-20261029-213356`

本轮发布标签：`release-20261030-0108`

## 变更

- `admin.html#/customers` 显示简体中文 / 英文迁移提示，并链接到新版 `#/people`；不再调用旧客户列表接口。
- “更多”页移除重复的“传统客户列表”入口。旧 `#/customer/{id}` 详情、`#/customers/trash` 回收站以及其他旧标签继续可访问。
- 旧客户详情的机会区不再允许编辑成交/关闭机会或删除机会；未终结机会维持原跟进、编辑和关闭能力。新版 `#/opportunities` 仍保留服务端预览与人工确认后的终态修订、软删除入口。
- 数据库、迁移、云函数、权限和生产业务数据均未变更。

## 影响与兼容

- 旧客户列表书签会停留在迁移提示页，人物与客户关系由人员在新版人物目录中查找；系统不按客户 ID 或姓名自动猜测 Person。
- 旧客户详情用于兼容跟进、保单检视、照片和 OCR 等既有内部入口，未整体删除。
- 机会终态修订和机会删除只从旧详情移除；历史记录仍可在新版机会目录查找维护。

## 发布范围

- 静态托管文件：`/crm/admin.html`、`/crm/js/modules/legacy-customer-route.js`、`/crm/js/modules/phase14-hubs.js`、`/crm/js/modules/console/i18n.js`。
- 发布地址：[CRM admin](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。
- 未部署云函数；无数据库 migration 或 rollback migration。

## 验证

- `npm run test:wp01`：108 项通过、0 失败、5 项按项目定义标记为未运行；发布门槛 `PASS_WITH_LIMITATIONS`。
- 旧 URL 中英迁移、人物目录搜索、旧详情标签与终态机会只读控制、新版机会维护：隔离浏览器回归通过。
- 生产数据库仅执行 `tests/wp01/catalog.sql` 与 `tests/wp04/audit.sql` 的 public 只读核验；未执行生产写入。
- CloudOnly：线上 admin 哈希匹配；91 个可达页面 / 模块 / 样式及 29 个 CRM 函数、228 个源码/配置文件均匹配本地。
- 数据库 catalog：`public` 对象权限审计 1,166 项通过。WP04 身份映射审计覆盖客户 783/783、候选人 576/576、嘉宾 6/6；活动参与者有 3 条已声明的未确认姓名例外。
- 发布后的完整 GitHub / 云端 `sync-check.ps1`：待 GitHub 发布后完成。
- 未验证项：真实账号手动登录、生产服务角色运行时写入链路、真实移动设备视觉验收；发布门槛明确标记为限制项。

## 回滚

恢复标签 `release-20261029-213356` 对应的 `admin.html` 与三个模块文件并重新上传上述静态路径。无数据库回滚操作；Git 回滚使用新提交，不重写历史。
