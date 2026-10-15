# PC07 Context Item Lifecycle 发布记录（2026-10-15）

## 范围

完成 Person 事实页的人工确认、纠错、过期、撤回及 Signal/Inference 转 Fact 审核流程；为 context_items 增加服务端预览/执行审计；让关系摘要、会前准备、保险上下文、关系衰减、机会候选和搜索只把已确认、当前、无冲突的 Fact 当作可信事实。Quick Capture V2 与 Legacy 保存契约未改。

## 生产发布证据

- CloudBase 环境：`crm-d1gkae8ddc930d151`，仅 `public`。
- Migration `20261015100000_context_item_lifecycle`：Task `task-0701c2bf`，`Succeed`，已登记。
- Migration `20261015110000_context_item_trusted_search`：Task `task-ee5498d4`，`Succeed`，已登记；远端迁移总数 77，最新版本 `20261015110000`。
- `public.crm_context_item_commands` 已创建，当前 0 行。执行 RPC 与预览 RPC 存在，执行权限只授予 `service_role` 与数据库内部角色；anon/authenticated 没有审计表读写或 RPC 执行权限。context_items 的 service_role 列级更新仅限确认、确认时间/人员、核验时间和有效期；浏览器角色没有新增写权限。
- `person_360` 与 `assistant` 代码已更新，线上状态均为 `Active`，handler/runtime/timeout/memory 未改。`person_360` 线上代码时间 `2026-10-15 12:14:18`，`assistant` 为 `2026-10-15 12:14:21`。
- 仅上传三个静态文件至 `crm/js/modules/console/`：`context-actions.js`（5749 bytes）、`pages/person.js`（36056 bytes）、`i18n.js`（100966 bytes）。托管列表返回的大小与本地文件一致。
- 发布前已记录 context_items 10 行；发布后新命令审计表为 0 行。本包未执行任何真实人物事实写入或批量清洗。

## 回归

- `npm run test:pc07`：11 项通过（发布前后均运行，含 iPad 横竖屏与中英词典检查）。
- `npm run test:security`：4 项通过；`npm run test:modular`：通过。
- `npm run test:context-engine`：21 项通过；`npm run test:ai-gateway -- --run`：14 项通过；`npm run test:ai-skills`：7 项通过。
- 相邻回归：`test:wp06` 5 项、`test:quick-capture-v2` 5 项、`test:pc04` 8 项、`test:pc05` 1 项，均通过。
- `npm run check:shared`：29 个云函数中的 58 份共享 db.js/ai.js 副本与 canonical 文件一致；修改的 Node 文件语法检查通过。
- 真实生产人物的生命周期写操作、并发冲突及各 AI 消费者端到端调用未执行；这些行为由服务测试与合成浏览器测试覆盖，不记为线上业务验收。

## 回退

- 数据结构与 SQL 函数分别有配对 rollback：`20261015100000_context_item_lifecycle.rollback.sql`、`20261015110000_context_item_trusted_search.rollback.sql`。
- 生命周期 rollback 在已有执行命令或派生记录时会拒绝，避免抹除审计历史；不得强行移除。
- 应用代码回退到本标签的前一发布标签，并仅重新部署对应函数/三个静态文件。
