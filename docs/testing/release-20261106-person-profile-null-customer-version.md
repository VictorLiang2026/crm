# 人物资料保存：客户版本为空时仍可安全保存

日期：2026-11-06

## 诊断与修复

- 线上 `public.customers.updated_at` 可为空。受影响人物关联的有效客户行版本为 `NULL`；同样状态的有效客户共有 770 条。
- 旧版 `public.crm_person_profile_save_v1` 同时要求客户 ID 和非空版本，故只要表单修改了客户字段，就会在保存前抛出 `Customer ID and expected version are required`。
- 新 migration 保留必需的客户 ID、人物归属检查、行锁和单事务写入。客户版本改用 `IS DISTINCT FROM` 比较：数据库与表单版本都为 NULL 时视为匹配；一方为空、一方有时间戳时返回客户版本冲突；有时间戳的既有路径保持原语义。
- 不批量修改客户资料；保存成功后，现有 RPC 会按原逻辑为已编辑客户写入新的 `updated_at`。
- 新 migration：`cloudbase/migrations/20261106143000_person_profile_nullable_customer_version.sql`。
- Rollback：`cloudbase/rollbacks/20261106143000_person_profile_nullable_customer_version.rollback.sql`，恢复原先要求非空客户版本的行为。

## 回归与线上核验

- `node --test tests/person-profile-save/*.test.cjs tests/security/run.test.cjs`：12 passed，0 failed。
- `npm run test:pc04`：8 passed，0 failed，覆盖人物单一保存、客户/候选人编辑及版本冲突边界。
- PostgreSQL 只读语义探针确认：NULL 与 NULL 的 `IS DISTINCT FROM` 为 false；有时间戳与 NULL 比较为 true。
- CloudBase migration `20261106143000` 已应用；首次 apply 响应短暂报告迁移历史未同步，之后 `listMigrations` / `migrationDetail` 均确认版本存在、LatestVersion 为 `20261106143000`，远端函数定义含新版本比较。
- 修改只涉及 `public.crm_person_profile_save_v1`；未更改人物/客户数据、表结构、视图、权限或云函数。
- 没有用真实客户记录执行写入式端到端测试。测试覆盖 RPC 输入、SQL 版本语义和相邻人物编辑功能。

## 发布

- 状态：数据库 migration 已部署；会前准备功能已独立发布至 GitHub master，本次修复现基于最新 master 进行发布核验。
- 静态页面与云函数产物没有变化。
- 首次 release verification 曾因 `crm/js/modules/console/data.js` 线上资源与当时 GitHub 基线不一致而停止；会前准备功能随后已在独立提交/标签中发布。本次从最新 GitHub master 创建干净克隆，不包含该功能的修改内容。
- 当前本次 migration 和回归文件仅包含空客户版本修复，正在执行标准提交/标签流程与 CloudBase 一致性检查。
