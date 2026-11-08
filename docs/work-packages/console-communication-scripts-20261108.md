# Console 人物沟通话术功能

日期：2026-11-08

## 范围与实现

- 在人物 Console「跟进建议」页的「生成跟进建议」左侧增加「沟通话术」入口；弹窗仅展示当前 Person 已保存的系统版与 GPT 版微信话术，不展示跟进策略或产品建议，不提供编辑控件。
- 每次打开都经既有 `assistant` / `knowledgeLibrary.adviceList` 数据入口重新读取。历史数据按建议记录每页 25 条读取，提供上一页/下一页，避免 100 条上限导致旧话术漏读。
- 每张话术卡片显示对应版本标题、来源、状态、更新时间、版本和话术正文；没有话术的版本不会显示。
- 编辑仍在既有跟进建议编辑器完成。系统/GPT 微信话术变更后，再打开「沟通话术」会显示最新保存值。GPT 编辑纳入现有编辑范围，并兼容旧客户端未传入 GPT 话术时保留旧内容。
- GPT 外部生成契约增加可选 `wechatMessage`，仅通过服务端预览、人员确认后的确认写入流程保存；直接 GPT 保存路径忽略该字段。拒绝测试标记文案。
- 不改变数据库 schema，不新增表/字段/函数/路由，不改 admin.html、登录、权限或客户数据；沿用 `person_followup_advice` 中已有的 Person ID、GPT/系统产品文本打包字段与 callFn 边界。
- 新界面文本由 i18n 字典提供简体中文和英文；样式遵循现有 Console CSS 变量和组件。

## 影响面与恢复

- 页面：Console 人物跟进建议、话术只读弹窗、现有编辑弹窗。
- 静态资源：`crm/js/modules/console/followup-advice.js`、`crm/js/modules/console/data.js`、`crm/js/modules/console/i18n.js`、`crm/css/console.css`。
- 云函数：只改 `assistant` 的跟进建议列表分页、GPT 导入预览契约与既有字段读写；不触碰共享 DB 模块或其他函数。
- 数据/权限：无 schema、迁移、权限和生产业务数据修改。读写仍以 Person ID 和原建议行 ID 约束。
- 回滚：重新部署 `release-20261108-111100` 中的 `assistant` 函数及四个静态文件，随后创建恢复提交；不回滚或清理业务数据。

## 验证

- `node --test tests/knowledge-library/followup-advice-service.test.cjs tests/knowledge-library/followup-advice.browser.cjs`：28/28 通过。覆盖分页边界、系统/GPT 话术编辑/清空、旧消息保留、GPT 预览确认写入、测试标记拒绝、入口顺序、只读列表、翻页、保存后重读及中英文。
- `npm run test:modular`：通过。
- `npm run test:pc03`：4/4 通过，Console More 入口与静态资源比较未回归。
- `npm run test:knowledge-library`：首次 97/100；3 个知识页面浏览器用例在整组浏览器启动时超时，之后逐个重跑均通过；功能相关完整目标用例单独通过。PDF、GPT、内容服务其余用例通过。
- 最新 `npm run test:wp01`：`PASS_WITH_LIMITATIONS`；公开目录断言 1248 项通过；isolated regression 104 PASS / 0 FAIL / 0 FLAKY / 5 SKIP；匿名检查 81/81；WP04 身份审计 `PASS_WITH_EXCEPTIONS`（786 客户、573 招募、6 嘉宾映射；3 条已声明的姓名暂存参与者例外）。
- 数据库证据通过 CloudBase MCP 只读 SQL 获取，限定 `public` schema；无写入。真实人工登录、service runtime、生产业务写入/AI 和手机真机未验证，本功能未执行生产客户操作。

## 发布记录

CloudBase `assistant` 函数部署成功；Console 静态资源 4/4 上传成功（仅本报告列出的四个文件）。部署后 `sync-check.ps1 -CloudOnly` 通过：主页面 HTTP 200 且 SHA-256 匹配，95 个可达页面资源匹配，30 个 CRM 函数 / 243 个源码与配置文件匹配。线上地址：https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html。Git 提交、标签及推送待完成。

本轮开始前已有暂存的 `docs/work-packages/admin-entry-cleanup-20261108.md` 修正继续保留，没有撤销或改写；它会随项目既定 `release.ps1` 提交。
