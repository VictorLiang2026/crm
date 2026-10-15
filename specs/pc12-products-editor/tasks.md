# PC12 实施计划

- [x] 1. 基线与发布证据
  - 通过 sync-check；固定分支、提交、标签、线上静态资源和云函数比对证据。
  - 复核 public.products 字段、唯一性候选和迁移回滚副作用。
  - _Requirement: 1_
- [x] 2. 保单写入并发约束
  - 增加 version 和 customer_id 唯一约束的成对 migration/rollback。
  - 扩展 products.list/upsert 的 Person 路径、映射核验、精确金额验证及 CAS；保留 Legacy 请求契约。
  - _Requirement: 2, 3, 4, 5, 6_
- [x] 3. Person 保险编辑器
  - 新增模块化 iPad 编辑 UI 和中英 i18n；覆盖 11 × 5、未知/零、精确整数与来源状态。
  - 保存后刷新保险上下文；无客户关联时提供既有关系入口。
  - _Requirement: 1, 2, 4, 7, 8_
- [x] 4. 自动化与隔离浏览器回归
  - 补单位验证、兼容、并发、来源及失败路径测试。
  - 在受影响模块和相邻旧报告/Legacy 页面执行回归。
  - _Requirement: 1-8_
- [x] 5. 带标记的业务验证与恢复核对
  - 仅按用户明确批准的虚构测试客户和快照方案验证首次插入/更新/冲突；准确恢复或清理衍生数据。
  - 发布后核对三端，写发布记录和测试台账。
  - _Requirement: 1-8_

完成证据：`release.md`。GitHub 提交、发布标签及发布后完整 sync-check 在运行发布脚本后补入该记录。
