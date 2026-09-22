# 删除批次修复验证结果

日期：2026-09-23  
基线：`05cf56aff8e746183ea63ca67d641833f32859bd` / `release-20260922-151500`  
环境：`crm-d1gkae8ddc930d151`，仅 `public` schema

## 修改前事实

- `customers.remove` 与 `recruit_candidates.remove` 通过多次独立 SDK 更新完成级联，不能保证同一事务。
- 两个 restore 均按父 ID 清除全部 `deleted_at`，会恢复早于本次根记录删除的历史独立删除记录。
- 回收站统计包含父记录名下全部已删除记录，不能表达本次实际可恢复范围。
- 单独删除跟进等子记录仍为硬删除，本包不改变该语义。

## 修改后语义

- 9 张相关表新增可空 UUID `delete_batch_id`；不回填历史数据。
- 新删除在 `public.crm_delete_batch` 的单一事务中生成批次，只标记当时仍活动的根记录和级联记录。
- 恢复同时限定父子归属、`deleted_at IS NOT NULL` 和相同批次；不同批次与历史空批次子记录保持删除。
- 历史无批次客户/候选人只恢复根记录，并通过 `legacy_restored` 与页面提示明确告知用户。
- API 保留 `ok`、`deleted_at`、`restored`、`cascaded`、`skipped`，新增 `legacy_restored`；客户回收站新增 `recoverable_counts`，原 `counts` 保留。
- 页面不接收或显示实际批次 UUID。

## Migration 与 rollback

- Migration：`cloudbase/migrations/20260922080000_delete_batches.sql`
- 远端任务：`task-764ef4da`，状态 `Succeed`
- Rollback：`cloudbase/rollbacks/20260922080000_delete_batches.sql`
- 回滚策略：保留列和现有批次恢复，暂停新删除。直接删除列会永久丢失批次归属证据，因此不作为线上回滚。
- 仓库与 `C:\Users\victor\cloudbase\migrations` 双份备份 SHA-256 一致。

## 数据库与权限验证

- 9/9 表存在 `delete_batch_id uuid`。
- `crm_delete_batch` 为 `SECURITY INVOKER`，固定 `search_path=pg_catalog, public`，`lock_timeout=5s`。
- EXECUTE：`anon=true`、`authenticated=false`、`service_role=true`。
- 现有 9 张表 RLS 均保持开启；未修改已有 policy。
- 相关视图为显式列清单，批次字段不属于既有视图/API契约；未重建视图，`security_invoker=true` 保持不变。

## 测试结果

- 本地完整回归：57 PASS / 0 FAIL / 5 SKIP。
- 最后一次页面专项回归：29 PASS / 0 FAIL / 6 SKIP。
- 隔离数据库写测试：PASS。使用 `[CRM_TEST_ONLY]` 与固定负数 ID，在同一 DO 事务中验证后清理。
- 单独硬删除子记录：恢复客户后仍不存在。
- 删除客户与恢复客户：活动子记录、候选人和增员跟进共享批次并精确恢复。
- 历史独立删除：历史客户子记录、候选人和增员跟进均未被错误恢复。
- 候选人单独删除/恢复：只恢复候选人本批次跟进。
- 历史无批次根记录：只恢复根记录，历史子记录保持删除。
- 清理复核：customers/followups/recruit_candidates/recruit_followups 测试 ID 剩余均为 0。
- 线上云函数 RPC：客户与候选人的 remove/restore 均成功走到批次函数；不存在 ID 返回预期结果，无写入。
- 线上 trashList：客户与候选人均返回成功；用无匹配测试关键词验证，没有返回真实业务行。

## 未验证与风险

- 没有用真实客户数据执行删除或恢复；线上写验证只使用可识别、可清理的测试记录。
- 历史记录缺少可靠批次证据，关联记录不会自动恢复；这是已确认的安全兼容规则，需要用户按记录单独处理。
- 回收站仍按现有方式扫描页内相关表统计，数据量显著增长后可再评估索引；本包没有改变查询架构。
- 数据保留型 rollback 会暂时关闭新删除，恢复仍可用；启用时需同步发布回滚说明。
