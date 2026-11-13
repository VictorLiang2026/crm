# 知识库总摘要编辑框宽度修复（2026-11-13）

## 范围

- `crm/js/modules/console/knowledge-document.js`：为多卷知识文档的 GPT 总摘要编辑框加专用 class。
- `crm/css/console.css`：iPad/桌面视口（CSS 宽度 ≥768px）将编辑框设为块级、100% 可用宽度、border-box，并提供可调整高度；小屏现有规则不变。
- `tests/knowledge-library/document-directory.browser.cjs`：820px 平板视口点击“生成总摘要草稿”，确认草稿进入编辑框且编辑框宽度与 GPT 总摘要显示段落一致（误差 <1px）。

## 按钮检查

“生成总摘要草稿”已连接 `documentDraft`：根据当前文档版本和可用的卷摘要生成草稿，打开编辑框供人工修改；只有点击“确认保存总摘要”才调用 `documentGpt` 写回总摘要。按钮有效，生成本身不会自动保存。

当前 `documentDraft` 允许使用已准备好的卷摘要生成；若有卷尚未就绪，界面会展示覆盖页码，草稿仍需人工核对后保存。本轮仅修复编辑宽度，未改变摘要覆盖/可保存规则。

## 验证

- `node --test tests/knowledge-library/document-directory.browser.cjs`：通过；1440、820、390 视口回归，820px 宽度断言通过。
- `npm run test:knowledge-library`：111 项通过。首次并发运行曾因隔离检出缺少 assistant 本地原生依赖及浏览器竞争出现失败；按锁文件 `npm ci --prefix cloudfunctions/assistant` 安装本地测试依赖后重跑全绿。
- `npm run test:wp01`：发布门禁 `PASS_WITH_LIMITATIONS`；catalog 1547 项检查通过、匿名探针 106/106、身份审计 0 例外、回归 102 PASS / 5 历史 SKIP。未验证项：真实交互登录、service runtime、线上写入、真机移动端。
- `npm run check:release-gate`：通过。
- 部署后 `tools/sync-check.ps1 -CloudOnly`：103 个线上可达页面/模块/样式资产一致；30 个云函数的 336 个源码/配置文件一致；admin.html HTTP 200 且 SHA-256 一致。
- 未在真实登录会话中执行保存操作；本轮仅验证隔离浏览器交互及线上静态资产一致性。

## 发布

- 目标环境：`crm-d1gkae8ddc930d151`。
- 静态托管：仅上传 `/crm/js/modules/console/knowledge-document.js` 与 `/crm/css/console.css`；两份文件上传成功。无云函数或数据库变更。
- 回滚：按新发布标签对应上一稳定版本恢复这两个静态文件；不涉及数据回滚。
- GitHub 提交、推送与发布标签由发布脚本完成后补录。
