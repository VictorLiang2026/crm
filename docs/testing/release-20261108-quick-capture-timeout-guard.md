# 快速记录 100 秒保护与错误诊断 — 2026-11-08

## 现象与基线

- 当前已发布版本的 focused 快速记录把模型请求参数设为 100 秒，但 Node SDK 请求卡住时没有独立的服务端兜底。前端初始化与 `ai_parse` 函数总时限均为 120 秒。
- 线上 `ai_parse` 日志发现一次调用运行到 120000 毫秒后被平台强制结束，日志原因是 `Invoking task timed out after 120 seconds`。强制终止前没有业务错误响应，所以浏览器只收到 `Load failed`。
- 改前提交 `24d51f865c66c6d9646064089258cf309d89b3fc`。CloudBase 全量只读核验：30 个函数、243 个源码/配置文件及 95 个页面可达静态资源与该提交一致。仅核对 `public` schema。

## 变更范围

- focused 快速记录保持 100 秒模型期限，并增加独立 Promise 截止时间；模型调用若不返回，函数在 100 秒返回明确的 `TIMEOUT` 与原因，避免等到云函数 120 秒上限。
- focused `ai_parse` 错误响应保留安全格式的错误码；前端同时展示服务端原因、错误码和 100 秒超时说明。若浏览器没有收到服务器响应，继续明确说明无法取得服务端详情，不伪称已知原因，并保留原文。
- 旧版与 V2 快速记录、解析内容、Person 搜索/确认及业务写入路径不变。无数据库、权限或业务数据变更。

## 回归

- `node --check`：4 个修改后的 JavaScript 文件通过。
- 定向 `quick-capture-focused` 单元与浏览器回归：16 项通过；覆盖 100 秒参数、服务端强制截止、超时原因、错误码展示、原文保留。
- `npm run test:modular`：通过。
- `node --test tests/pc37/quick-capture-person-search.browser.cjs`：1 项通过。
- `npm run test:wp01`：104 项回归通过、5 项既有跳过；权限清单 1248 项通过，匿名探针 81/81；发布门槛 `PASS_WITH_LIMITATIONS`。
- 未在本机重放真实 100 秒等待；强制截止通过短时模拟验证。生产只读日志显示此前存在 120 秒平台强制终止。

## 发布与恢复

- 页面部署目标：`/crm/js/modules/console/write.js`、`/crm/js/modules/console/i18n.js`。
- 函数部署目标：仅 `ai_parse`。
- 无 migration/rollback SQL。恢复时将上述页面文件和 `ai_parse` 恢复到本次前版本，再按项目脚本部署；数据库无回滚操作。
- `ai_parse` 云函数部署成功；静态托管 `/crm/js/modules/console/write.js` 与 `/crm/js/modules/console/i18n.js` 两个文件上传成功。
- 虚构标记实际调用成功，RequestId `8264a774-db4b-4f15-b6c1-1b01bcd16dc7`，耗时 26699 毫秒；仅生成解析草稿，不写业务数据。
- 部署后全量核对通过：30 个函数、243 个源码/配置文件、95 个页面可达资源与云端一致。

## 未验证

- 未使用真实客户内容测试，未创建或修改业务资料。
- 本轮未做真实账号登录回归；WP01 将其保留为人工登录项。
- 浏览器自身连接中断时服务端细节无法到达客户端；界面会如实提示网络层错误，并显示可取得的错误码。
