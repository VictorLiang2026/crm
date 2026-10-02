# 目标 CRM 测试样本策略：文档修订发布记录

日期：2026-10-02。修改前基线：`1ec7d9a3d864627abf43da46d999ea8f96dec7d4` / `release-20261002-225147`。修改前完整 `tools/sync-check.ps1` 通过，本地、GitHub、线上页面及 28 个 CRM 云函数源码一致。

## 改动

- 修订 `specs/target-crm-v1/requirements.md` 的 R11/R12 与端到端验收：最多 10 条初始业务样本，允许参与真实 Today、漏斗和 AI。
- 修订 `specs/target-crm-v1/design.md` 的批次标记、ID 台账、计数口径、页面提示和 G0/G1 门槛。
- 修订 `specs/target-crm-v1/tasks.md` 的共通执行要求、WP02/WP03 和后续相冲突的验收条件。
- 新增 `docs/decisions/20261002-test-samples-in-real-flows.md` 固化决策；在初版发布记录顶部注明其策略已被取代，保留历史记录正文。

本轮只改文档。未创建或删除测试记录，未改数据库、权限、CloudBase 配置、页面或云函数。云端业务产物无需部署，真实业务操作回归未执行。验证包括文档引用、28 个 WP 编号、测试样本相关语句一致性、差异与本地/GitHub/云端源码核对。回滚本轮只需基于本轮发布标签恢复相应文档；没有业务数据回滚。
