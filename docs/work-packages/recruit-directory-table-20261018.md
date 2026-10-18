# 招募目录表格、搜索与分页（2026-10-18）

## Scope

- 将 console 招募目录的候选人卡片改为人物目录风格的可排序表格。
- 表头：姓名、招募阶段、招募优先级、潜力评分、下次跟进日期、阶段停留天数、最近更新日期、编号；各列均支持排序。
- 添加姓名搜索、招募阶段和招募优先级多选筛选；搜索/筛选组合后回到第 1 页。
- 每页显示 30 条并支持前后翻页；收窄八阶段漏斗/月度目标侧栏。
- 只改既有 public 视图的读取参数，不改数据库结构、权限、写入、删除或恢复流程。

## Compatibility

- 新页面仍经既有 `person_360:listRecruitDirectory` 入口读取数据。
- 不带新筛选/排序参数的旧游标请求保留原行为；目录新参数只影响读返回结果。
- 保留 legacy 与 Person-only 招募候选人的合并、人物档案跳转及既有 1,000 条结果上限。
- 招募创建、候选人档案、八阶段漏斗、月度目标和回收站流程不改。
- 中英文新界面文案放在 `crm/js/modules/console/i18n.js`。

## Changed artifacts

- `crm/js/modules/console/pages/recruit.js`
- `crm/css/console.css`
- `crm/js/modules/console/i18n.js`
- `cloudfunctions/person_360/recruit-directory-service.js`
- `tests/pc31/recruit-directory.test.cjs`
- `tests/console/recruit-directory.browser.cjs`
- `package.json`

## Verification

- `npm run test:pc31`: 10 passed, including browser behavior, all eight sortable columns, combined multi-select filters, and 30-row paging.
- `npm run test:people-pages`: 5 passed; `npm run test:pc19`: 10 passed; `npm run test:pc21`: 24 passed; `npm run test:pc28`: 21 passed; `npm run test:modular`: passed.
- `npm run test:wp01`: release gate `PASS_WITH_LIMITATIONS`; catalog 1,031 checks passed, anonymous checks 71/71 passed, regression 108 passed / 0 failed / 5 skipped, WP04 audit passed with 3 documented exceptions. Manual login, service runtime, live writes, and real mobile acceptance remain explicitly unverified.
- Local browser test covers desktop, iPad width, and horizontal table scrolling at phone width. No production mobile visual acceptance was performed.
- Production function invocation was attempted read-only after deployment. CloudBase CLI invoked `person_360` but returned `UNAUTHORIZED` because the invocation had no CRM end-user identity; successful authenticated production list loading remains unverified.

## Release

- Pending final cloud parity check, GitHub push, and release tag.
- Release includes the user-approved existing PC28 commit `6abbc2a`.
- Cloud deployment scope: `crm/css/console.css`, `crm/js/modules/console/i18n.js`, `crm/js/modules/console/pages/recruit.js`, `crm/js/modules/console/recruit-delete.js`, and functions `assistant` (PC28) / `person_360` (directory filters and sorting). No database or permission changes.
