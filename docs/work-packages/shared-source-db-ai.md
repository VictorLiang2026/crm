# db.js / ai.js 共享源码治理（第一阶段）

`cloudfunctions/_shared/db.js` 与 `cloudfunctions/_shared/ai.js` 是唯一编辑源。26 个 CRM 云函数目录内的同名文件是必须随函数打包的部署副本；本阶段保留 `require('./db')` / `require('./ai')` 的现有路径和文件字节，不改变线上调用、数据库或 AI 模型逻辑。

修改共享源后运行 `npm run build:shared`，它只同步清单中 26 个 CRM 函数的这两个文件。`npm run check:shared` 对所有 52 份副本计算 SHA-256；缺文件、哈希偏差、非法清单或复制失败时返回非零状态。CI 和 `tools/sync-check.ps1` 都运行此检查，发布入口因而会阻止有偏差的版本。校验不访问云端，也不调用函数。

后续需要更新云函数源码时，使用 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-function.ps1 -Function <name>`。它先同步、再校验全部副本，然后只执行指定函数的 CloudBase 代码更新；脚本不会改运行时、配置、权限或其他函数。部署后仍执行完整 `tools/sync-check.ps1` 和受影响业务回归。直接通过控制台或其他工具上传代码不会自动触发本地拦截，必须先手动运行构建和校验。

本阶段基线：`db.js` SHA-256 `124c6ac6eced46aaed79a59a5d45c1e4be227da42e513997110096a079115b9a`；`ai.js` SHA-256 `6fa94a418b790de83e451dcb7607f84e9ca9c2d49eaa5f6aad8f7277553bf5f5`。本轮没有改变这两份源码或任何云函数部署产物，因此无需上传云函数。若撤回本轮工具治理，按发布标签恢复工具、文档和 CI 文件即可；线上业务代码无需回滚。

## 本轮验证与发布记录

- 改动前 GitHub `master` 与本地 HEAD 均为 `b7742c548ea7920b81dd684e0cd43d6b9a3720ee`，线上页面 SHA-256 一致，26 个 CRM 函数的 108 个源码/配置文件一致。
- `npm run build:shared` 与 `npm run check:shared` 均通过，52 份副本一致且构建没有改动任何云函数目录。
- 隔离测试验证了发现偏差、只更新 `db.js` / `ai.js`、拒绝非法目标及缺失源文件；旧发布脚本的失败路径测试通过。
- 完整离线回归 `npm test`：57 PASS / 0 FAIL / 5 SKIP。线上真实登录、数据库、AI、写操作与移动端仍由现有测试报告标记为未自动执行。
- 云端部署范围：无。只发布 Git 工具、CI 与文档；线上业务文件保持基线字节不变。新部署入口本轮仅验证了拒绝未列入清单的函数，未执行真实代码上传。
