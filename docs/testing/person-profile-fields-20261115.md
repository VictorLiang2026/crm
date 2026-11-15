# Person 资料字段更名发布记录

日期：2026-11-15  
环境：`crm-d1gkae8ddc930d151`（production）

## 变更

- `public.persons.organization` 更名为 `graduation_school`（毕业院校）；`education` 更名为 `department_or_major`（院系或专业）。
- 原两字段中的内容先备份，再以 `原机构：` / `原教育：` 标记合入既有 `occupation`，与原职业内容保留并去重；本次线上备份 12 人，含 12 条机构值和 3 条教育值。
- 前端人物详情、编辑、导入、OCR 与名单传输采用新字段和中英文字典；服务端保存和读取使用新列，同时兼容已有客户端的旧键。
- 更新人物依赖查询/写入函数及四张相关视图；视图恢复 `security_invoker=true` 和原有最小授权。迁移备份表启用 RLS，仅服务角色可读。

## 数据库迁移

- `20261115120200_person_profile_education_fields`：数据备份、值合并、改列、依赖函数/视图更新。
- `20261115120300_person_profile_view_security`：恢复依赖视图的调用者权限检查与精确授权。
- `20261115120400_person_profile_backup_read_policy`：为受保护备份表加服务角色只读策略。
- 回滚顺序为 1204、1203、1202。主迁移回滚会在发现字段或职业已被后续编辑时拒绝覆盖；需先人工审查受影响记录。

## 影响范围与兼容

- 页面：人物资料详情/编辑、人物导入与 OCR 复核、人物名单导入/导出及引用人物资料的活动/招募/AI 读路径。
- API：人物字段读取和保存改用新列，旧 `organization` / `education` 请求键保留兼容映射。
- 数据库：只涉及 `public` schema；未访问 `pr` schema 或 `pr_*` 函数。
- 权限：仅恢复既有视图权限边界；备份表无客户端权限，服务角色只读。

## 验证

- WP01 发布门禁：`PASS_WITH_LIMITATIONS`；目录/匿名探针/身份审计/业务回归全通过，回归 102 PASS、0 FAIL、0 FLAKY、5 SKIP。
- 身份审计：客户 784/784、招募 573/573、讲者 6/6、活动参与者 6/6 均完成映射；无例外。
- `test:person-service`、`test:ai-gateway`、`test:context-engine`、`test:pc19`、`test:pc20`、`test:modular`、人物页面与名单传输/OCR 服务测试均通过。
- 共享模块校验：30 个函数中的 60 份共享副本一致。
- 云端只读目录检查：四个依赖视图的 `security_invoker` 与 grants 符合现有基线；备份表 RLS、策略和授权符合基线。
- 未进行真实用户登录、线上业务写入/恢复及移动真机验收；WP01 中对应项保持未验证，不以源码哈希代替。
- 发布后需记录完整 `sync-check.ps1` 结果及 GitHub 提交/tag。
