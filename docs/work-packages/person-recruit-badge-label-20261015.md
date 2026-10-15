# 人物列表招募标签去重与改名

日期：2026-10-15（Asia/Shanghai）

## 范围

- 人物列表当前会把 `roles` 中的招募角色显示为“增员”，并在 `recruit_id` 存在时再加“在增员”。招募角色已有时只保留一个标签，文案改为“招募”。
- 对只有 `recruit_id`、没有招募 role 的人物保留一个“招募”标签，避免丢失既有招募关联提示。
- 只新增人物列表专用的中英文字典项。全局“增员”和“在增员”字典及其他页面文案保持原样；不改筛选、转换流程、数据或接口。

## 验证

- 发布前 `tools/sync-check.ps1 -CloudOnly`：53 个可达前端资源及 29 个云函数的 180 份源码/配置匹配线上。
- `npm run test:people-pages`：4/4 通过；新用例覆盖角色和 `recruit_id` 两种形态，并断言共用翻译仍为“增员”“在增员”。
- `node --check`（`people.js`、`i18n.js`）与 `git diff --check` 通过。
- `npm run test:wp01`：108 PASS、0 FAIL、5 SKIP；匿名探针 63/63，目录检查 863 项无漂移，身份审计保留 3 条已声明例外；发布门禁 `PASS_WITH_LIMITATIONS`。登录、服务角色运行时、真实写操作和手机验收未执行。

## 部署与恢复

- 仅上传 `/crm/js/modules/console/pages/people.js` 和 `/crm/js/modules/console/i18n.js`。
- 无数据库、权限、云函数或业务数据变更。
- 回退方式：按前一发布版本还原以上两个托管文件，创建恢复提交和标签。

## 未验证

- 未使用真实生产账号执行人物转换；浏览器验证使用隔离夹具。
