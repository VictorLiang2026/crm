# 发布记录：console 三端响应式与路由可达性

- 日期：2026-11-11
- 基线：`release-20261111-003200`（提交 `e4769fc755e03b30e4a54c5b5e72587bf75e7d6c`）
- 发布目标：生产 CloudBase 静态托管 `crm-d1gkae8ddc930d151`，仅 `console.html` 模块资源；保留 `admin.html` 旧实现。

## 变更范围

- `crm/css/console.css`：触控导航项最小高度 44px；短屏横向 iPhone 使用紧凑布局；统一人物姓名字重。
- `crm/js/modules/console/shell.js`：窄屏和短屏触控设备共用手机导航判断；手机底栏在活动、招募、AI、知识库等更多模块路由中持续高亮“更多”，并补充 `aria-current`。
- `crm/js/modules/console/pages/misc.js`：手机端默认展开工作区入口，覆盖横屏。
- 自动化回归覆盖 iPhone 竖屏/横屏、紧凑 iPad 竖屏、iPad 竖屏/横屏和桌面端。

没有数据库、权限、云函数或业务流程变更；`admin.html` 未修改。

## 部署与验证

- CloudBase 静态托管上传成功：`/crm/css/console.css`、`/crm/js/modules/console/shell.js`、`/crm/js/modules/console/pages/misc.js`。
- 部署后 `tools/sync-check.ps1 -CloudOnly` 通过；主页面 HTTP 200，模块资源闭包一致。
- `git diff --check`、两个修改过的 JS 文件 `node --check` 通过。
- 定向浏览器回归：tri-end-responsive、people-pages、more-navigation、recruit-directory，8/8 通过。
- `npm run test:wp04`：8 项通过；数据库快照中 3 条仅姓名的参与者记录与既有例外清单一致，不涉及本次变更。
- `npm run test:wp01`：安全与回归检查通过，发布门禁 `PASS_WITH_LIMITATIONS`；匿名探针 93/93，通过；regression 104 项通过、5 项既有跳过。
- 真实账号登录、真实手机/iPad 设备视觉验收未执行；项目门禁将其列为未验证项。

## 回滚

以本记录的基线标签 `release-20261111-003200` 为准，仅将以上 3 个托管资源恢复为该标签版本并再次运行 CloudOnly 核验；Git 通过后续恢复提交与标签回退，不强推。无数据库迁移。
