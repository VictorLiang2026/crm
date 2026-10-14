# 人物回收站 Invalid RPC 修复

日期：2026-10-15（Asia/Shanghai）

## 原因与范围

- Console 人物回收站通过 `person_360.listPersonTrash` 调用 `public.person_trash_page_v1`。
- `person_trash_page_v1` 已存在于生产数据库目录基线，参数与调用一致；`person_360` 的 RPC 名称白名单遗漏该只读函数，导致请求在调用数据库前返回 `Invalid RPC`。
- 修复仅把这个既有只读 RPC 加入 `person_360` 白名单。不改 SQL、角色/优先级条件、函数参数、回收站列表/恢复行为或权限。
- 人物列表筛选按钮空状态只调整文案：简体中文显示“筛选 无”，英文显示“Filter None”。选中数量、提交时机、查询条件和请求路径保持原样。

## 验证

- `node --test tests/wp071/person-delete.test.cjs`：8/8 通过，包含默认 RPC 客户端对白名单和 `public` 参数契约的隔离验证。
- `npm run test:people-pages`：3/3 通过。筛选测试核对空状态显示“筛选 无”，并继续核对选择角色/优先级后只在点击搜索时发请求、请求参数不变、应用筛选后计数仍为 5。
- `node --check cloudfunctions/person_360/index.js`、`node --check crm/js/modules/console/pages/people.js` 通过。
- 发布前干净基线 CloudBase 核验：51 个前端资源和 29 个云函数的 175 份源码/配置文件匹配。
- 发布后 `tools/sync-check.ps1 -CloudOnly`：主页面 SHA-256 一致；51 个可达页面/模块/样式资源一致；29 个云函数、175 份源码/配置逐一一致。
- `npm run test:wp01`：108 项 regression PASS、0 FAIL、5 SKIP；身份覆盖核验 `PASS_WITH_EXCEPTIONS`（4 个类别，保留 3 条已声明参与者例外）；匿名探针 61/61 PASS；门禁 `PASS_WITH_LIMITATIONS`。登录、服务角色运行时、真实写入/恢复和手机验收未执行，见 WP01 报告。
- `npm run check:release-gate`：通过；未验证项为登录、service-runtime、live-writes、mobile。
- 定向回归：回收站 RPC 8/8 通过；人物目录浏览器用例 3/3 通过；Node 语法和 58 份共享副本校验通过。
- 部署：`person_360` 更新成功；仅 `people.js` 和 `i18n.js` 两个静态模块上传成功。未修改数据库/权限。

## 部署和恢复

- 仅部署 `person_360` 函数，以及静态文件 `crm/js/modules/console/pages/people.js`、`crm/js/modules/console/i18n.js`。
- 未改数据库、权限、共享模块、客户/招募业务函数或筛选请求实现。
- 如需恢复，使用发布前标签还原上述函数和静态文件，再按发布流程创建恢复提交；不涉及数据库回滚。

## 未验证

- 浏览器夹具和单元测试使用隔离数据；没有读取、修改或恢复真实回收站记录。
- 未通过真实生产账号实际点击回收站；通过隔离回归、部署成功结果及发布后 29 函数/175 文件和 51 静态资源逐项一致核验。
