# 2026-11-06 人物页跟进建议按钮样式统一

## 变更范围

- 人物详情页“跟进建议”按钮改用与“对话策略”相同的 `btn-soft` 样式。
- 保持图标、点击事件、路由、接口和数据流不变；无数据库及云函数修改。
- 基于最新 GitHub master `9ab35e9` 实施，保留该版本现有 Person 和 meeting-prep 逻辑。

## 验证

- `node --check crm/js/modules/console/pages/person.js`：通过。
- `node --test tests/pc23/*.browser.cjs`：2/2 通过，包含按钮样式相同、中英文和 iPad 视口回归。
- WP01：`PASS_WITH_LIMITATIONS`；public 目录检查 1,248 项通过，回归 108 项通过、5 项历史跳过，匿名探针 81/81 通过；人工登录、service runtime、线上写入/AI 和移动验收保留为未验证项。

## 部署与回滚

- 只部署 `/crm/js/modules/console/pages/person.js`。
- 无数据库、云函数或托管配置修改。
- 回滚时从本次发布前 GitHub master 恢复该文件并上传原路径，无需数据库回滚。

## 生产验证边界

- 使用项目虚构体验数据的本地浏览器测试；未以真实客户数据执行 AI 请求或写操作。
- 生产账号人工视觉确认未执行。
