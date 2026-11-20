# iPad 横屏工具栏与列表密度 — 2026-11-21

## 变更

- 机会页的类型/来源、状态、人物搜索和关键词搜索控件在 iPad 横屏中排为一行，筛选逻辑不变。
- 招募页将搜索、筛选、目标分析和新建人才集中到列表与漏斗上方；候选结果区与八阶段漏斗从同一水平位置开始。
- 知识库的搜索、全文搜索、类别、状态和启用筛选排为一行；操作列使用两列三行布局，六个操作仍各自保留原行为。
- 话术与异议参考的导航、搜索/筛选/新增导入压为一行，优化维护工具作为第二行。
- “发布机构”及相关字段、API 和存储行为完全保留。本工作包不修改数据库、云函数、权限、路由或写入语义。
- 主要实现：`crm/css/console.css`、`crm/js/modules/console/pages/recruit.js`、`crm/js/modules/console/communication-references.js`。

## 验证

- 1366×1024 触控浏览器：机会筛选同一行；招募搜索/筛选/两个操作同一行，列表与漏斗对齐；知识库五项控件同一行，六个操作分为三行；话术参考搜索区一行、维护区第二行；页面无水平溢出。
- 中文与英文视图均完成目标断点的控件布局验证；确认上传表单的发布机构字段仍存在。
- `tests/console/ipad-toolbar-layout.browser.cjs` 与招募列表、机会及 iPhone 相邻浏览器回归：9/9 通过。
- 知识库回归：144/144 通过；完整 `npm run test:wp01` 回归 102 PASS、0 FAIL、5 个历史 SKIP。
- WP01 使用受保护的既有匿名 publishable key 文件（通过 `CRM_PUBLIC_KEY_FILE` 引用，不复制或提交密钥），匿名只读网关检查 119/119 通过；目录快照 1,719 项通过，WP04 映射审计无异常。发布门禁为 `PASS_WITH_LIMITATIONS`，登录、服务角色运行时、线上业务写入和真实移动设备仍按门禁报告标为未验证/需人工登录。
- PC31 的两项活动参与者/设备访问失败在未修改的基线提交 `1d4a2b4d60317b13ffc1cb58a9898d18e0e479ce` 上复现，属于既有失败，不计为本次回归新增失败。

## 发布

- 改前基线：GitHub `master` 与云端资源匹配，提交 `1d4a2b4d60317b13ffc1cb58a9898d18e0e479ce`。
- 发布范围：仅 `crm/css/console.css` 及其引用的已修改 Console 模块，不部署云函数或数据库变更。
- 静态托管上传成功：3/3 文件，未上传云函数或数据库；线上文件为 `crm/css/console.css`、`crm/js/modules/console/pages/recruit.js`、`crm/js/modules/console/communication-references.js`。生产入口：[CRM](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。
- 上传后 `tools/sync-check.ps1 -CloudOnly`：109 个可达页面/模块/样式资产一致；30 个云函数共 346 个源码/配置文件一致；`admin.html` HTTP 200 且 SHA-256 匹配。
- GitHub 提交与发布标签由 `tools/release.ps1` 在 master 工作树完成后补齐。
