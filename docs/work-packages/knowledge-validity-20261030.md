# 知识条目标记有效修复（2026-10-30）

## 发现

生产 `public.knowledge_items` 的 K-8（ID 8）是来源关联的 `evidence` 草稿，`confidence` 为 `NULL`。约束 `knowledge_items_reviewed_content_check` 要求已验证的 evidence 有 `confidence >= 0.700`。`crm_knowledge_set_valid_v1` 的来源关联分支把状态交给 `crm_knowledge_source_review_v1`，后者直接验证条目，没有补齐缺失置信度，因此更新触发约束失败，assistant 将数据库错误收敛成 `KNOWLEDGE_LIBRARY_FAILED`。

## 修复

迁移 `20261029224926_knowledge_source_confidence_on_review` 仅替换 `public.crm_knowledge_set_valid_v1`。用户明确点击“标记有效”时，对来源关联的 evidence 仅在置信度为空时使用现有手工录入默认值 `0.8`；保留显式分数，数据库 `0.7` 验证约束、来源审核和 verified_by 审计继续生效。迁移不改表/视图/权限，也不直接修改 K-8 数据。

回滚文件：`cloudbase/rollbacks/20261029224926_knowledge_source_confidence_on_review.rollback.sql`。回滚只恢复函数定义，不撤销之后由用户确认的业务状态或置信度；数据回退需单独评估。

## 基线与验证

- 发布基线更新为 GitHub `master` 提交 `8cdb1ee15c2754de5df3b413ae3e46f3f3afffd0`；该提交包含线上 `console.css`，页面文件与生产一致。
- CloudBase 只读检查确认生产 `crm_knowledge_set_valid_v1` 与回滚前函数体一致；迁移预检报告可执行，远端最新版本为 `20261029121200`。
- `tests/knowledge-library/management.test.cjs` 与 `tests/pc22/knowledge-governance.test.cjs`：15 项通过。
- WP01 全量门禁：`PASS_WITH_LIMITATIONS`；权限目录 1166 项无漂移，匿名探针 77/77，通过；隔离回归 108 项通过、0 失败、5 项预设跳过。仍有人工登录、线上写入、service runtime 与移动端未验证项。
- `sync-check.ps1 -CloudOnly`：29 个 CRM 函数的 228 份源码/配置及 91 个可达页面资源与生产一致。
- 迁移版本 `20261029224926` 已登记为生产最新版本；数据库定义复核确认置信度默认已安装且原有 evidence 约束仍在。
- K-8 复核仍为草稿、`confidence=NULL`；迁移没有直接更新 K-8，也未替用户执行“标记有效”。需要用户在界面确认后，该操作才会审核并启用记录。
- 未执行真实账号交互和生产写入验证；发布门禁将其作为明确未验证项保留。
